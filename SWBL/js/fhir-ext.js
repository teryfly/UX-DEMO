/* =====================================================================
 * fhir-ext.js —— FHIR 扩展机制（Extension / ModifierExtension）编解码
 * ---------------------------------------------------------------------
 * 基础 FHIR R4 资源无法完整表达的业务数据，按 FHIR 规范通过「扩展」承载：
 *   - extension        ：附加数据，不改变资源原义
 *   - modifierExtension：会改变资源含义/处理方式的数据（如死亡类型——它决定
 *                        时限与优先级；dataScope——它决定数据可见范围）
 *   - 复杂嵌套结构（审核链路、完成报告、统计数据集等）在 real-world FHIR 中
 *     常以 valueString 承载 JSON，本系统同样如此处理，并在自动生成的
 *     StructureDefinition 中显式声明，保证可追溯。
 *
 * 每个扩展拥有规范化 canonical url，见 BASE。
 * 本模块提供 encode/decode，在内存库读写时在「规范扩展数组」与
 * 「开发友好的 ext 投影对象」之间双向转换。
 * ===================================================================== */
(function (global) {
  'use strict';

  var BASE = 'https://fhir.swbl-demo.example/StructureDefinition/';

  /* Profile 注册表（等价于各资源的 StructureDefinition 约束）：
   *   modifier：归入 modifierExtension 的字段（改变资源含义）
   *   list     ：标量数组字段（即使单元素也还原为数组）
   *   json     ：复杂嵌套字段，以 valueString 承载 JSON
   * 未列出的字段按 JS 类型自动编码为标量扩展。 */
  var REGISTRY = {
    // —— 组织结构与人员 ——
    Organization: { list: ['aliases'] },
    Practitioner: {},
    PractitionerRole: { modifier: ['dataScope'], list: ['scenes'] },

    // —— 患者与就诊 ——
    Patient: {},
    Encounter: { modifier: ['deathType'], json: ['partyNote'] },
    Condition: {},
    Procedure: {},
    Observation: { json: ['dataset', 'detail'] },

    // —— 病历资料文档 ——
    DocumentReference: { modifier: ['fetchError'] },

    // —— 任务（讨论 / 上报 / 改进 共用 Task，以 code 判别）——
    Task: {
      modifier: ['taskKind'],
      list: ['expectedEffect', 'tags'],
      json: ['approvalFlow', 'completionReport', 'deadlineSig', 'pdca', 'caseInfo', 'decision', 'returnReason']
    },

    // —— 讨论会议 ——
    Appointment: { json: ['meeting', 'partyMeta'], list: ['notifyChannels'] },

    // —— 模板与表单 ——
    Questionnaire: { json: ['modules', 'history'] },
    QuestionnaireResponse: { json: ['draftMeta'] },
    Composition: { json: ['archiveMeta'] },

    // —— 审批流程定义 ——
    PlanDefinition: { json: ['nodes'] },

    // —— 统计与报表 ——
    Measure: {},
    MeasureReport: { json: ['dataset'], list: [] },

    // —— 通知与留痕 ——
    Communication: { list: ['medium'], json: ['payload'] },
    Provenance: { json: ['change'] },
    Basic: { json: ['rules', 'items', 'pages', 'config', 'scopes', 'settings'] },
    CodeSystem: { json: ['concept'] },
    ValueSet: {},
    StructureDefinition: {}
  };

  // 应编码为 valueCode（编码型）而非 valueString 的字段
  var CODE_FIELDS = {
    deathType: 1, taskKind: 1, dataScope: 1, fetchError: 1, category: 1,
    scenes: 1, medium: 1, tags: 1, from: 1, to: 1, type: 1
  };

  function reg(rt) { return REGISTRY[rt] || {}; }
  function has(arr, k) { return arr && arr.indexOf(k) >= 0; }

  function valueEntry(url, field, v) {
    var e = { url: url };
    if (typeof v === 'boolean') e.valueBoolean = v;
    else if (typeof v === 'number') e[Number.isInteger(v) ? 'valueInteger' : 'valueDecimal'] = v;
    else e[CODE_FIELDS[field] ? 'valueCode' : 'valueString'] = String(v);
    return e;
  }

  function readValue(e) {
    if ('valueBoolean' in e) return e.valueBoolean;
    if ('valueInteger' in e) return e.valueInteger;
    if ('valueDecimal' in e) return e.valueDecimal;
    if ('valueCode' in e) return e.valueCode;
    if ('valueString' in e) return e.valueString;
    return null;
  }

  /* 将开发友好的 ext 对象编码为标准 FHIR extension / modifierExtension 数组 */
  function encode(rt, ext) {
    var r = reg(rt), extension = [], modifier = [];
    Object.keys(ext || {}).forEach(function (field) {
      var v = ext[field];
      if (v === undefined) return;
      var url = BASE + rt + '-' + field;
      var target = has(r.modifier, field) ? modifier : extension;
      if (v === null) { target.push({ url: url, valueString: '' }); return; }
      var isJson = has(r.json, field) ||
        (typeof v === 'object' && !Array.isArray(v)) ||
        (Array.isArray(v) && v.length && typeof v[0] === 'object');
      if (isJson) { target.push({ url: url, valueString: JSON.stringify(v) }); return; }
      if (Array.isArray(v)) { v.forEach(function (item) { target.push(valueEntry(url, field, item)); }); return; }
      target.push(valueEntry(url, field, v));
    });
    return { extension: extension, modifierExtension: modifier };
  }

  /* 从标准 FHIR extension / modifierExtension 数组还原 ext 对象 */
  function decode(rt, resource) {
    var r = reg(rt), prefix = BASE + rt + '-', groups = {};
    ['extension', 'modifierExtension'].forEach(function (which) {
      (resource[which] || []).forEach(function (e) {
        if (!e.url || e.url.indexOf(prefix) !== 0) return;
        var field = e.url.slice(prefix.length);
        (groups[field] = groups[field] || []).push(e);
      });
    });
    var ext = {};
    Object.keys(groups).forEach(function (field) {
      var entries = groups[field];
      if (has(r.json, field)) { ext[field] = parseJson(entries[0]); return; }
      if (has(r.list, field) || entries.length > 1) { ext[field] = entries.map(readValue); return; }
      var val = readValue(entries[0]);
      if (typeof val === 'string' && (val.charAt(0) === '{' || val.charAt(0) === '[')) {
        try { ext[field] = JSON.parse(val); return; } catch (_) { /* 普通字符串 */ }
      }
      ext[field] = val;
    });
    (r.list || []).forEach(function (field) { if (!(field in ext)) ext[field] = []; });
    return ext;
  }

  function parseJson(e) {
    var s = readValue(e);
    try { return JSON.parse(s); } catch (_) { return s; }
  }

  global.FHIRExt = { BASE: BASE, REGISTRY: REGISTRY, CODE_FIELDS: CODE_FIELDS, encode: encode, decode: decode };
})(typeof window !== 'undefined' ? window : globalThis);
