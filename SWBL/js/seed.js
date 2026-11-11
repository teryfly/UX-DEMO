/* =====================================================================
 * seed.js —— 基础数据与配置种子（第 1 步）
 * ---------------------------------------------------------------------
 * 「对于相关依赖数据可以在缓存中编造符合业务逻辑的初始化基础数据」：
 * 科室、医务人员与角色、ICD-10 死亡原因编码、讨论记录/上报单模板、
 * 时限规则、死亡类型自动分类规则、通知场景、审批流程、角色权限、
 * Measure 指标定义、全部扩展的 StructureDefinition 声明。
 *
 * 时间基准：T0 = 页面打开的真实时刻，全部种子时间相对 T0 偏移，
 * 因此倒计时/超时预警在任何日期演示都成立；随机量使用固定种子 PRNG，
 * 保证同一时刻刷新数据完全一致（可复现）。
 * ===================================================================== */
(function (global) {
  'use strict';

  var F = global.FHIR, V = global.Vocab, BASE = global.FHIRExt.BASE;
  var SYS = V.SYS;

  var T0 = Date.now();
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;

  function at(offsetMs) { return new Date(T0 + offsetMs).toISOString(); }
  function days(n) { return n * DAY; }
  function rnd(seed) {
    var s = seed >>> 0;
    return function () {
      s += 0x6D2B79F5; var z = s;
      z = Math.imul(z ^ (z >>> 15), 1 | z);
      z ^= z + Math.imul(z ^ (z >>> 7), 61 | z);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
  }
  var R = rnd(20260924);
  function pick(arr) { return arr[Math.floor(R() * arr.length) % arr.length]; }
  function int(min, max) { return min + Math.floor(R() * (max - min + 1)); }

  /* 引用与编码助手 */
  function R_(type, id, display) { return { reference: type + '/' + id, display: display }; }
  function coding(kind, code, display) { return { system: SYS + kind, code: code, display: display || code }; }
  function cc(kind, code, display) { return { coding: [coding(kind, code, display)], text: display || code }; }
  /* 问题项级扩展：FHIR Questionnaire.item 无 minLength，按规范以 extension 承载 */
  function qiExt(min, max) {
    var out = [];
    if (min != null) out.push({ url: BASE + 'QuestionnaireItem-minLength', valueInteger: min });
    if (max != null) out.push({ url: BASE + 'QuestionnaireItem-maxLength', valueInteger: max });
    return out.length ? out : undefined;
  }
  function qitem(o) {
    var it = {
      linkId: o.id, type: o.type, text: o.label,
      required: !!o.required, repeats: !!o.repeats
    };
    if (o.max != null || o.min != null) {
      var e = qiExt(o.min, o.max);
      if (e) it.extension = e;
      if (o.max != null) it.maxLength = o.max;
    }
    if (o.options) it.answerOption = o.options.map(function (op) {
      return typeof op === 'string' ? { valueString: op } : { valueCoding: { code: op[0], display: op[1] } };
    });
    if (o.readonly) it.extension = (it.extension || []).concat([{ url: BASE + 'QuestionnaireItem-prefilled', valueBoolean: true }]);
    if (o.enableWhen) it.enableWhen = o.enableWhen;
    if (o.item) it.item = o.item.map(qitem);
    return it;
  }

  /* ───── 1. 科室 ───── */
  var DEPTS = [
    { code: 'CARD', name: '心血管内科', beds: 86, kind: '临床' },
    { code: 'RESP', name: '呼吸内科', beds: 72, kind: '临床' },
    { code: 'GAST', name: '消化内科', beds: 68, kind: '临床' },
    { code: 'NEUR', name: '神经内科', beds: 64, kind: '临床' },
    { code: 'NSUR', name: '神经外科', beds: 58, kind: '临床' },
    { code: 'GSUR', name: '普通外科', beds: 76, kind: '临床' },
    { code: 'ORTH', name: '骨科', beds: 66, kind: '临床' },
    { code: 'UROL', name: '泌尿外科', beds: 52, kind: '临床' },
    { code: 'ONCO', name: '肿瘤科', beds: 120, kind: '临床' },
    { code: 'ICU', name: '重症医学科', beds: 32, kind: '临床' },
    { code: 'EMER', name: '急诊医学科', beds: 24, kind: '临床' },
    { code: 'HEMA', name: '血液内科', beds: 60, kind: '临床' },
    { code: 'MEDA', name: '医务部', beds: 0, kind: '职能' },
    { code: 'MR', name: '病案室', beds: 0, kind: '医技' }
  ];

  function seedOrgs() {
    DEPTS.forEach(function (d, i) {
      F.seed({
        resourceType: 'Organization', id: 'Organization-' + String(i + 1).padStart(4, '0'),
        identifier: [{ system: 'urn:swbl:dept-code', value: d.code }],
        name: d.name, active: true,
        type: [cc('org-type', d.kind === '临床' ? 'dept-clinical' : (d.kind === '职能' ? 'dept-admin' : 'dept-tech'), d.kind + '科室')],
        ext: { deptCode: d.code, beds: d.beds, isClinical: d.kind === '临床', deptKind: d.kind }
      });
    });
  }

  /* ───── 2. 医务人员与角色（Practitioner + PractitionerRole） ───── */
  /* 科室 i（1 起）人员编号 = i*10 + 位序，保证演示账号命中固定 id：
   * dept-1 → 0011 主管医师 李海峰 / 0012 上级医师 王建国 / 0013 科主任 张德明 / 0014 科室医师 赵敏
   * dept-2 → 0023 科主任 钱立群；职能科室另置（0151 起） */
  var SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘蒋蔡余杜叶程苏魏吕丁任沈姚卢'.split('');
  var GIVEN = ['建国', '志强', '秀兰', '海燕', '晓明', '文博', '晓东', '玉兰', '凯旋', '明远', '佳怡', '子谦', '思远', '雅静', '国强', '立群', '德明', '文华', '海峰', '雨欣', '泽宇', '嘉怡', '瑞霖', '书宁'];
  var TITLES = { director: ['chief', '主任医师'], senior: ['deputy', '副主任医师'], attending: ['attend', '主治医师'], doctor: ['resident', '住院医师'] };
  var SLOTS = { attending: [1, 5, 7], senior: [2, 6], director: [3], doctor: [4, 8] };

  function personId(deptIdx, kind, n) {
    return String(deptIdx * 10 + SLOTS[kind][n]).padStart(4, '0');
  }
  function seedPeople() {
    var clinical = DEPTS.map(function (d, i) { return { d: d, i: i + 1 }; }).filter(function (x) { return x.d.kind === '临床'; });
    var demoBySlot = {
      '1-attending-0': 'u-attending', '1-senior-0': 'u-senior',
      '1-director-0': 'u-director', '2-director-0': 'u-director2', '1-doctor-0': 'u-doctor'
    };
    clinical.forEach(function (x) {
      var deptIdx = x.i;
      [{ kind: 'attending', count: 3 }, { kind: 'senior', count: 2 }, { kind: 'director', count: 1 }, { kind: 'doctor', count: 2 }]
        .forEach(function (p) {
          for (var n = 0; n < p.count; n++) {
            var id = personId(deptIdx, p.kind, n);
            var demoUser = global.Domain.user(demoBySlot[deptIdx + '-' + p.kind + '-' + n]);
            var t = TITLES[p.kind];
            var name = demoUser ? demoUser.name : (pick(SURNAMES) + pick(GIVEN));
            F.seed({
              resourceType: 'Practitioner', id: 'Practitioner-' + id,
              identifier: [{ system: 'urn:swbl:emp-no', value: 'EMP' + id }],
              name: [{ text: name }], gender: R() > .45 ? 'male' : 'female',
              qualification: [{ code: { coding: [{ system: 'urn:swbl:title', code: t[0], display: t[1] }], text: t[1] } }],
              telecom: [{ system: 'phone', value: '138' + String(10000000 + Math.floor(R() * 89999999)) }],
              active: true,
              ext: { title: t[1], titleCode: t[0], phone: '138****' + String(1000 + int(0, 8999)) }
            });
            F.seed({
              resourceType: 'PractitionerRole', id: 'PractitionerRole-' + id,
              practitioner: R_('Practitioner', 'Practitioner-' + id, name),
              organization: R_('Organization', 'Organization-' + String(deptIdx).padStart(4, '0'), x.d.name),
              code: [coding('scene', p.kind, global.Domain.sceneName(p.kind))],
              status: 'active', period: { start: '2016-07-01' },
              ext: { dataScope: 'dept', scenes: [p.kind], navRole: p.kind === 'director' ? 'director' : 'clinician', isDemoUser: !!demoUser }
            });
          }
        });
    });
    // 职能科室：医务部（全院数据范围）与病案室
    [['0151', '刘文华', '医务部管理员', 'Organization-0013', '医务部', 'quality', 'hospital', 'u-quality'],
     ['0152', '孙立', '医务部干事', 'Organization-0013', '医务部', 'quality', 'hospital', null],
     ['0161', '高燕', '病案室编码员', 'Organization-0014', '病案室', 'doctor', 'hospital', null]].forEach(function (m) {
      var id = m[0];
      F.seed({
        resourceType: 'Practitioner', id: 'Practitioner-' + id,
        identifier: [{ system: 'urn:swbl:emp-no', value: 'EMP' + id }],
        name: [{ text: m[1] }], gender: 'female',
        qualification: [{ code: { coding: [{ system: 'urn:swbl:title', code: 'admin', display: m[2] }], text: m[2] } }],
        active: true, ext: { title: m[2], titleCode: 'admin', phone: '139****' + String(1000 + int(0, 8999)) }
      });
      F.seed({
        resourceType: 'PractitionerRole', id: 'PractitionerRole-' + id,
        practitioner: R_('Practitioner', 'Practitioner-' + id, m[1]),
        organization: R_('Organization', m[3], m[4]),
        code: [coding('scene', m[5], global.Domain.sceneName(m[5]))], status: 'active',
        ext: { dataScope: m[6], scenes: [m[5]], navRole: m[5] === 'quality' ? 'quality' : 'clinician', isDemoUser: !!m[7] }
      });
    });
  }

  /* ───── 3. ICD-10 基础数据（CodeSystem + ValueSet） ───── */
  function seedIcd() {
    var concepts = V.ICD_GROUPS.map(function (g) {
      return {
        code: 'CAT-' + g.cat, display: g.cat, definition: g.cat,
        concept: g.items.map(function (it) {
          return { code: it[0], display: it[1], definition: it[3], property: [{ code: 'weight', valueDecimal: it[2], valueString: String(it[2]) }, { code: 'cat', valueCode: g.cat }] };
        })
      };
    });
    F.seed({
      resourceType: 'CodeSystem', id: 'CodeSystem-icd10-death',
      url: 'https://fhir.swbl-demo.example/CodeSystem/icd10-death', name: 'ICD10DeathCause',
      title: 'ICD-10 死亡原因编码', status: 'active', experimental: false,
      content: 'complete', caseSensitive: false, version: '2026',
      description: '死亡病例讨论制度闭环管理使用的 ICD-10 死亡原因编码，支持「基础数据管理」页增删改查，并驱动死亡类型自动分类与死因统计分析。',
      count: V.icdFlat().length,
      property: [{ code: 'weight', description: '种子生成相对权重', type: 'decimal' }, { code: 'cat', description: '所属 ICD 大类', type: 'code' }],
      concept: concepts,
      ext: { groupCount: V.ICD_GROUPS.length, conceptCount: V.icdFlat().length }
    });
    F.seed({
      resourceType: 'ValueSet', id: 'ValueSet-icd10-death',
      url: 'https://fhir.swbl-demo.example/ValueSet/icd10-death', name: 'ICD10DeathCauseVS',
      title: 'ICD-10 死亡原因编码值集', status: 'active', experimental: false,
      compose: { include: [{ system: 'https://fhir.swbl-demo.example/CodeSystem/icd10-death' }] },
      ext: { boundTo: 'Condition.code' }
    });
    // 其他受控词表以 CodeSystem 资源声明（供 FHIR 查看器追溯）
    Object.keys(V.Vocab).forEach(function (kind) {
      F.seed({
        resourceType: 'CodeSystem', id: 'CodeSystem-' + kind,
        url: SYS + kind, name: kind, title: '值表：' + kind, status: 'active', experimental: false,
        content: 'complete', caseSensitive: true,
        count: V.Vocab[kind].length,
        concept: V.Vocab[kind].map(function (c) { return { code: c[0], display: c[1] }; })
      });
    });
  }

  /* ───── 4. 模板（Questionnaire：讨论记录 8 模块 / 上报单 6 模块） ───── */
  var DISCUSS_MODULES = [
    { id: 'm1', title: '① 患者基本信息', note: 'EMR 自动带入，不可修改', fields: [
      { id: 'm1.name', label: '姓名', type: 'string', required: true, readonly: true },
      { id: 'm1.age', label: '年龄', type: 'string', required: true, readonly: true },
      { id: 'm1.gender', label: '性别', type: 'string', required: true, readonly: true },
      { id: 'm1.mrn', label: '住院号', type: 'string', required: true, readonly: true },
      { id: 'm1.admitDate', label: '入院日期', type: 'date', required: true, readonly: true },
      { id: 'm1.deathDate', label: '死亡日期', type: 'date', required: true, readonly: true },
      { id: 'm1.los', label: '住院天数', type: 'string', required: true, readonly: true }
    ] },
    { id: 'm2', title: '② 入院诊断与死亡诊断', fields: [
      { id: 'm2.admitDx', label: '入院主要诊断', type: 'text', required: true, min: 5, max: 500 },
      { id: 'm2.deathDx', label: '死亡主要诊断', type: 'text', required: true, min: 5, max: 500 },
      { id: 'm2.concordance', label: '诊断符合情况', type: 'choice', required: true, options: [['match', '符合'], ['partly', '部分符合'], ['unmatch', '不符合']] }
    ] },
    { id: 'm3', title: '③ 病例摘要', fields: [
      { id: 'm3.chief', label: '主诉', type: 'text', required: true, min: 10, max: 2000 },
      { id: 'm3.presentIllness', label: '现病史', type: 'text', required: true, min: 20, max: 4000 },
      { id: 'm3.exams', label: '主要检查检验结果', type: 'text', required: true, min: 20, max: 4000 },
      { id: 'm3.treatments', label: '主要治疗措施', type: 'text', required: true, min: 20, max: 4000 },
      { id: 'm3.progress', label: '病情演变过程', type: 'text', required: true, min: 20, max: 4000 }
    ] },
    { id: 'm4', title: '④ 死亡原因分析', fields: [
      { id: 'm4.directCause', label: '直接死因', type: 'string', required: true, min: 1, max: 200 },
      { id: 'm4.rootCause', label: '根本死因', type: 'string', required: true, min: 1, max: 200 },
      { id: 'm4.process', label: '死亡过程分析', type: 'text', required: true, min: 20, max: 3000 },
      { id: 'm4.avoidable', label: '是否可避免', type: 'choice', required: true, options: [['avoidable', '可避免'], ['partly', '部分可避免'], ['unavoidable', '不可避免']] }
    ] },
    { id: 'm5', title: '⑤ 诊疗过程评价', fields: [
      { id: 'm5.dxTimely', label: '诊断是否及时准确', type: 'choice', required: true, options: [['yes', '是'], ['no', '否'], ['partly', '部分']] },
      { id: 'm5.dxNote', label: '诊断补充说明', type: 'text', required: false, max: 2000 },
      { id: 'm5.txReasonable', label: '治疗方案是否合理', type: 'choice', required: true, options: [['yes', '是'], ['no', '否'], ['partly', '部分']] },
      { id: 'm5.txNote', label: '治疗补充说明', type: 'text', required: false, max: 2000 },
      { id: 'm5.rescueProper', label: '抢救措施是否得当', type: 'choice', required: true, options: [['yes', '是'], ['no', '否'], ['partly', '部分']] },
      { id: 'm5.rescueNote', label: '抢救补充说明', type: 'text', required: false, max: 2000 },
      { id: 'm5.deficiency', label: '是否存在诊疗不足', type: 'choice', required: true, options: [['yes', '是'], ['no', '否']] },
      { id: 'm5.deficiencyNote', label: '诊疗不足说明', type: 'text', required: false, min: 10, max: 2000,
        enableWhen: [{ question: 'm5.deficiency', operator: '=', answerString: '是' }] }
    ] },
    { id: 'm6', title: '⑥ 讨论意见', note: '按发言人动态添加多条记录', fields: [
      { id: 'm6.speakers', label: '发言人记录', type: 'group', required: true, repeats: true, item: [
        { id: 'm6.speaker', label: '发言人', type: 'string', required: true, min: 1, max: 50 },
        { id: 'm6.role', label: '角色', type: 'string', required: true, min: 1, max: 50 },
        { id: 'm6.opinion', label: '意见内容', type: 'text', required: true, min: 20, max: 3000 }
      ] }
    ] },
    { id: 'm7', title: '⑦ 经验教训总结', fields: [
      { id: 'm7.experience', label: '成功经验', type: 'text', required: true, min: 20, max: 3000 },
      { id: 'm7.problems', label: '存在问题', type: 'text', required: true, min: 20, max: 3000 },
      { id: 'm7.direction', label: '改进方向', type: 'text', required: true, min: 20, max: 3000 }
    ] },
    { id: 'm8', title: '⑧ 改进措施', note: '每条措施含具体内容、责任人、完成时限、预期效果', fields: [
      { id: 'm8.measures', label: '改进措施', type: 'group', required: true, repeats: true, item: [
        { id: 'm8.content', label: '具体改进措施', type: 'string', required: true, min: 10, max: 500 },
        { id: 'm8.owner', label: '责任人', type: 'reference', required: true },
        { id: 'm8.due', label: '完成时限', type: 'date', required: true },
        { id: 'm8.expected', label: '预期效果', type: 'text', required: true, min: 10, max: 500 }
      ] }
    ] }
  ];

  var REPORT_MODULES = [
    { id: 'r1', title: '① 患者基本信息', note: 'HIS/EMR 预填充，请核实', fields: [
      { id: 'r1.name', label: '姓名', type: 'string', required: true, readonly: true },
      { id: 'r1.gender', label: '性别', type: 'string', required: true, readonly: true },
      { id: 'r1.age', label: '年龄', type: 'string', required: true, readonly: true },
      { id: 'r1.mrn', label: '住院号', type: 'string', required: true, readonly: true },
      { id: 'r1.admitDate', label: '入院日期', type: 'date', required: true, readonly: true },
      { id: 'r1.deathDate', label: '死亡日期', type: 'date', required: true, readonly: true },
      { id: 'r1.los', label: '住院天数', type: 'string', required: true, readonly: true }
    ] },
    { id: 'r2', title: '② 入院诊断与死亡诊断', fields: [
      { id: 'r2.admitDx', label: '入院主要诊断', type: 'text', required: true, min: 10, max: 500 },
      { id: 'r2.deathDx', label: '死亡主要诊断', type: 'text', required: true, min: 10, max: 500 },
      { id: 'r2.secondaryDx', label: '死亡次要诊断', type: 'text', required: true, max: 1000 },
      { id: 'r2.rootReason', label: '死亡根本原因', type: 'text', required: true, min: 10, max: 500 }
    ] },
    { id: 'r3', title: '③ 诊疗过程简述', fields: [
      { id: 'r3.measures', label: '主要诊疗措施', type: 'text', required: true, min: 20, max: 3000 },
      { id: 'r3.keyNodes', label: '关键治疗节点', type: 'text', required: true, min: 20, max: 3000 },
      { id: 'r3.change', label: '病情变化过程', type: 'text', required: true, min: 20, max: 3000 }
    ] },
    { id: 'r4', title: '④ 死亡原因分析', fields: [
      { id: 'r4.directCause', label: '直接死因', type: 'string', required: true, min: 1, max: 200 },
      { id: 'r4.rootCause', label: '根本死因', type: 'string', required: true, min: 1, max: 200 },
      { id: 'r4.trigger', label: '诱因', type: 'string', required: false, max: 200 }
    ] },
    { id: 'r5', title: '⑤ 死亡类型判定', fields: [
      { id: 'r5.deathType', label: '死亡类型', type: 'choice', required: true, options: [['expected', '预期死亡'], ['unexpected', '非预期死亡']] },
      { id: 'r5.avoidable', label: '是否可避免', type: 'choice', required: true, options: [['avoidable', '可避免'], ['unavoidable', '不可避免']] },
      { id: 'r5.negligence', label: '是否存在医疗过失', type: 'choice', required: true, options: [['yes', '是'], ['no', '否']] }
    ] },
    { id: 'r6', title: '⑥ 抢救措施', fields: [
      { id: 'r6.rescueStart', label: '抢救开始时间', type: 'dateTime', required: true },
      { id: 'r6.rescueEnd', label: '抢救结束时间', type: 'dateTime', required: true },
      { id: 'r6.rescueMeasures', label: '抢救措施内容', type: 'text', required: true, min: 20, max: 2000 },
      { id: 'r6.rescueEffect', label: '抢救效果', type: 'text', required: true, min: 10, max: 1000 }
    ] }
  ];

  function modulesToItems(mods) {
    var out = [];
    mods.forEach(function (m) {
      out.push({
        linkId: m.id, type: 'group', text: m.title, required: true,
        extension: [{ url: BASE + 'QuestionnaireItem-moduleNote', valueString: m.note || '' }],
        item: m.fields.map(qitem)
      });
    });
    return out;
  }
  function flatten(mods) {
    var out = [];
    mods.forEach(function (m) {
      m.fields.forEach(function (f) {
        if (f.type === 'group') {
          out.push({ moduleId: m.id, module: m.title, id: f.id, label: f.label, type: 'group', repeats: true, children: f.item.map(function (c) { return { id: c.linkId, label: c.text, type: c.type, required: !!c.required, min: c.min, max: c.max }; }), required: true });
        } else {
          out.push({ moduleId: m.id, module: m.title, id: f.id, label: f.label, type: f.type, required: !!f.required, min: f.min, max: f.max, options: f.options, readonly: !!f.readonly, enableWhen: f.enableWhen });
        }
      });
    });
    return out;
  }

  function seedTemplates() {
    [['Questionnaire-record', '死亡病例讨论记录模板（8 大模块）', 'record', DISCUSS_MODULES, '讨论记录'],
     ['Questionnaire-report', '死亡病例上报单模板（6 大模块）', 'report', REPORT_MODULES, '上报单']].forEach(function (t) {
      F.seed({
        resourceType: 'Questionnaire', id: t[0],
        url: 'https://fhir.swbl-demo.example/Questionnaire/' + (t[2] === 'record' ? 'death-case-discussion-record' : 'death-case-report'),
        name: t[2] === 'record' ? 'DeathCaseDiscussionRecord' : 'DeathCaseReport',
        title: t[1], status: 'active', experimental: false, date: at(-days(120)), version: '1.2',
        description: '对应《信息架构图》IA-2.4 / IA-2.6 的结构化模板，「系统管理 → 模板管理」可维护字段并在业务表单实时生效。',
        subjectType: ['Patient', 'Encounter'],
        item: modulesToItems(t[3]),
        ext: { templateKind: t[2], modules: JSON.parse(JSON.stringify(t[3])), history: [
          { version: '1.0', by: '刘文华', at: at(-days(300)), note: '按 2024 版死亡病例讨论制度初始化模板' },
          { version: '1.1', by: '刘文华', at: at(-days(180)), note: '新增「诊断符合情况」必填项' },
          { version: '1.2', by: '刘文华', at: at(-days(120)), note: '改进措施增加「预期效果」字段' }
        ] }
      });
    });
  }

  /* ───── 5. 时限规则 / 自动分类规则 / 通知场景 / 审批流 / 权限（Basic + PlanDefinition） ───── */
  function seedTimeout() {
    F.seed({
      resourceType: 'Basic', id: 'Basic-timeout-config',
      code: cc('obs-code', 'dx-concordance', '时限规则配置'),
      ext: { configKind: 'timeout-config', config: JSON.parse(JSON.stringify(global.Limit.DEFAULTS)) }
    });
  }

  var CLASSIFY_RULES = [
    { id: 'CR-01', name: '麻醉意外死亡', deathType: 'special', priority: 1, field: 'deathDx', op: 'contains', value: ['麻醉意外', '麻醉并发症', '全麻意外'] },
    { id: 'CR-02', name: '输血反应死亡', deathType: 'special', priority: 2, field: 'deathDx', op: 'contains', value: ['输血反应', '溶血反应', '输血相关'] },
    { id: 'CR-03', name: '药物过敏死亡', deathType: 'special', priority: 3, field: 'deathDx', op: 'contains', value: ['药物过敏', '过敏性休克', '药疹'] },
    { id: 'CR-04', name: '医疗纠纷相关死亡', deathType: 'special', priority: 4, field: 'hasDispute', op: 'bool', value: true },
    { id: 'CR-05', name: '入院 48 小时内死亡', deathType: 'unexpected', priority: 5, field: 'losHours', op: 'lte', value: 48 },
    { id: 'CR-06', name: '术后 30 天内死亡', deathType: 'unexpected', priority: 6, field: 'daysSinceSurgery', op: 'lte', value: 30 },
    { id: 'CR-07', name: '诊疗过程中突然死亡', deathType: 'unexpected', priority: 7, field: 'suddenDeath', op: 'bool', value: true },
    { id: 'CR-08', name: '抢救无效死亡', deathType: 'unexpected', priority: 8, field: 'rescueFailed', op: 'bool', value: true },
    { id: 'CR-09', name: '恶性肿瘤晚期', deathType: 'expected', priority: 9, field: 'icdCat', op: 'contains', value: ['恶性肿瘤'] },
    { id: 'CR-10', name: '慢性疾病终末期', deathType: 'expected', priority: 10, field: 'terminal', op: 'bool', value: true },
    { id: 'CR-11', name: '高龄患者自然死亡', deathType: 'expected', priority: 11, field: 'age', op: 'gte', value: 80 },
    { id: 'CR-12', name: '已签署放弃抢救同意书', deathType: 'expected', priority: 12, field: 'signedWaiver', op: 'bool', value: true }
  ];
  function seedClassifyRules() {
    F.seed({
      resourceType: 'Basic', id: 'Basic-death-classify-rules',
      code: cc('obs-code', 'severity-score', '死亡类型自动分类规则'),
      ext: {
        configKind: 'classify-rules',
        rules: CLASSIFY_RULES.map(function (r) {
          return {
            id: r.id, name: r.name, deathType: r.deathType, enabled: true, priority: r.priority,
            match: { field: r.field, op: r.op, value: r.value },
            note: r.name + ' → ' + global.Domain.deathTypeName(r.deathType)
          };
        })
      }
    });
  }

  function seedNotifyScenes() {
    var S = [
      ['task-created', '任务生成通知', '讨论/上报任务自动生成时', ['director', 'attending', 'quality'], ['site', 'app'], 'immediate', null,
        '【新任务】{患者姓名} 死亡病例{任务类型}', '{患者姓名}（住院号 {住院号}）于 {死亡时间} 死亡，死亡类型 {死亡类型}，请在 {时限} 内完成「{任务名称}」，逾期将触发预警。'],
      ['meeting-invite', '会议通知', '科主任确定会议时间地点并下发时', ['director', 'attending', 'senior', 'doctor'], ['site', 'app', 'wechat'], 'immediate', null,
        '【会议通知】{患者姓名} 死亡病例讨论会', '定于 {会议时间} 在 {会议地点} 召开 {患者姓名} 死亡病例讨论会，请准时参会并及时确认。'],
      ['attend-remind', '参会确认提醒', '会议通知后仍未确认人员，定时提醒', ['doctor', 'attending', 'senior'], ['site', 'sms'], 'delay', 1440,
        '【参会确认提醒】{患者姓名} 死亡病例讨论会', '您尚未确认参加 {会议时间} 的 {患者姓名} 死亡病例讨论会，请尽快确认；确需请假请向科主任报批。'],
      ['review-task', '审核任务通知', '上报单流转至本级审核节点时', ['senior', 'director', 'quality'], ['site', 'app'], 'immediate', null,
        '【待审核】{患者姓名} 死亡病例上报单', '{提交人} 已提交 {患者姓名}（住院号 {住院号}）的死亡病例上报单，请在 {审核时限} 内完成本级审核。'],
      ['review-result', '审核结果通知', '每级审核完成（通过/退回）时', ['attending'], ['site', 'app'], 'immediate', null,
        '【审核{审核结果}】{患者姓名} 上报单', '{审核人}（{审核层级}）对 {患者姓名} 上报单的审核结果：{审核结果}。{审核意见}'],
      ['warn-yellow', '时限黄色预警', '剩余时间低于黄色阈值', ['attending', 'director'], ['site'], 'immediate', null,
        '【黄色预警】{任务名称} 剩余时间不足 {剩余占比}', '{患者姓名} 的「{任务名称}」剩余时间已不足 {剩余占比}，请于 {截止时间} 前完成。'],
      ['warn-orange', '时限橙色预警', '剩余时间低于橙色阈值', ['attending', 'director'], ['site', 'sms'], 'immediate', null,
        '【橙色预警】{任务名称} 即将超时', '{患者姓名} 的「{任务名称}」将于 {截止时间} 超时，请立即处理。'],
      ['warn-red', '时限超时预警', '已超过规定时限', ['attending', 'director', 'quality'], ['site', 'sms', 'app'], 'immediate', null,
        '【已超时】{任务名称} 超时 {超时时长}', '{患者姓名} 的「{任务名称}」已超时 {超时时长}，系统已记录并纳入时效统计。'],
      ['escalate', '超时升级通知', '超时后向上一级管理角色推送', ['director', 'quality'], ['site', 'sms'], 'immediate', null,
        '【超时升级】{科室} {任务名称} 超时', '{科室} {患者姓名} 的「{任务名称}」超时未完成，已升级推送至科主任/医务部。'],
      ['improve-remind', '改进任务提醒', '完成时限前 N 天提醒责任人', ['attending', 'doctor', 'senior'], ['site', 'app'], 'immediate', null,
        '【改进任务提醒】距截止 {剩余天数} 天', '您负责的改进措施「{措施摘要}」应于 {完成时限} 前完成，请及时更新执行进度。'],
      ['completion-report', '完成报告通知', '责任人提交完成报告时', ['director'], ['site', 'app'], 'immediate', null,
        '【待评估】{责任人} 提交改进完成报告', '{患者姓名} 相关改进措施「{措施摘要}」已提交完成报告，请开展效果评估。'],
      ['eval-result', '评估结果通知', '科主任提交效果评估时', ['attending', 'doctor', 'quality'], ['site'], 'immediate', null,
        '【评估结果】{措施摘要} {评估结论}', '科主任对「{措施摘要}」的评估结论：{评估结论}。{评估意见}']
    ];
    F.seed({
      resourceType: 'Basic', id: 'Basic-notify-scenes',
      code: cc('obs-code', 'dx-concordance', '通知场景配置'),
      ext: {
        configKind: 'notify-scenes',
        items: S.map(function (s) {
          return {
            id: s[0], name: s[1], trigger: s[2], targets: s[3], channels: s[4],
            timing: s[5], delayMin: s[6] || 0, titleTpl: s[7], bodyTpl: s[8], enabled: true,
            kind: s[0].indexOf('warn') === 0 || s[0] === 'escalate' ? '预警' : (s[0].indexOf('review') === 0 ? '审核' : (s[0].indexOf('improve') === 0 || s[0].indexOf('completion') === 0 || s[0].indexOf('eval') === 0 ? '改进' : (s[0].indexOf('meeting') === 0 || s[0].indexOf('attend') === 0 ? '会议' : '任务')))
          };
        })
      }
    });
  }

  function seedApprovalFlow() {
    F.seed({
      resourceType: 'PlanDefinition', id: 'PlanDefinition-report-approval',
      url: 'https://fhir.swbl-demo.example/PlanDefinition/death-case-report-approval',
      name: 'DeathCaseReportApproval', title: '死亡病例上报三级审核流程', status: 'active',
      experimental: false, date: at(-days(200)), version: '1',
      description: '对应 IA-2.21 / L3-5-6：主管医师提交 → 一级（上级医师）→ 二级（科主任）→ 三级（医务部管理员）→ 上报完成。',
      ext: {
        flowKind: 'report-approval',
        nodes: [
          { level: 1, name: '一级审核', roleCode: 'senior', roleName: '上级医师', hours: 48, escalate: true, order: 1, enabled: true },
          { level: 2, name: '二级审核', roleCode: 'director', roleName: '科主任', hours: 48, escalate: true, order: 2, enabled: true },
          { level: 3, name: '三级审核（终审）', roleCode: 'quality', roleName: '医务部管理员', hours: 24, escalate: false, order: 3, enabled: true }
        ]
      }
    });
  }

  function seedRolePermissions() {
    var routes = {};
    global.Domain.MODULES.forEach(function (m) {
      m.pages.forEach(function (p) { if (!p.hidden) routes[p.route] = p.roles.slice(); });
    });
    F.seed({
      resourceType: 'Basic', id: 'Basic-role-permissions',
      code: cc('obs-code', 'severity-score', '角色功能与数据权限'),
      ext: {
        configKind: 'role-permissions',
        pages: routes,
        scopes: { clinician: 'dept', director: 'dept', quality: 'hospital' },
        items: [
          { role: 'clinician', name: '临床医师', desc: '主管医师/上级医师/科室全体医师/任务责任人合并', dataScope: 'dept',
            perms: ['home:view', 'discuss:view', 'discuss:write-record', 'discuss:sign', 'discuss:view-chart', 'report:fill', 'report:submit', 'report:review-1', 'improve:execute', 'improve:report'] },
          { role: 'director', name: '科主任', desc: '组织讨论、二级审核、效果评估', dataScope: 'dept',
            perms: ['home:view', 'discuss:view', 'discuss:arrange-meeting', 'discuss:urge', 'discuss:write-record', 'discuss:sign', 'discuss:view-chart', 'report:review-2', 'report:view', 'improve:evaluate', 'improve:edit', 'improve:mark-excellent'] },
          { role: 'quality', name: '医务部管理员', desc: '三级终审、人工判定、统计与系统管理', dataScope: 'hospital',
            perms: ['home:view', 'discuss:view', 'discuss:manual-judge', 'report:review-3', 'report:view-all', 'report:export', 'improve:view', 'stat:view', 'stat:export', 'sys:template', 'sys:timeout', 'sys:basedata', 'sys:role', 'sys:notify', 'sys:approval'] }
        ]
      }
    });
  }

  function seedReportSchedule() {
    F.seed({
      resourceType: 'Basic', id: 'Basic-report-schedule',
      code: cc('obs-code', 'dx-concordance', '报表定时统计设置'),
      ext: { configKind: 'report-schedule', config: { enabled: true, when: 'month-end', types: ['monthly', 'unexpected'], keepHistory: 24, notify: true } }
    });
  }

  function seedMeasures() {
    [['Measure-death-overview', 'death-overview', '死亡病例综合指标'],
     ['Measure-death-rate', 'death-rate', '死亡率（死亡数/出院数）'],
     ['Measure-discussion-completion', 'discussion-completion', '讨论完成率'],
     ['Measure-report-completion', 'report-completion', '上报完成率'],
     ['Measure-improvement-landing', 'improvement-landing', '改进措施落实率'],
     ['Measure-timeliness', 'timeliness', '各环节时限达标率'],
     ['Measure-cause-rank', 'cause-rank', '死因构成与 TOP 排行'],
     ['Measure-trend', 'trend', '死亡率趋势（同比/环比）']].forEach(function (m) {
      F.seed({
        resourceType: 'Measure', id: m[0], url: 'https://fhir.swbl-demo.example/Measure/' + m[1],
        name: m[1], title: m[2], status: 'active', experimental: false,
        description: '统计口径：按死亡时间归属统计周期；数据来源 Encounter/Task/QuestionnaireResponse/Composition。',
        scoring: { coding: [{ code: 'proportion', display: '比例' }] },
        group: [{ population: [
          { code: { coding: [{ code: 'initial-population', display: '应处理病例数' }] } },
          { code: { coding: [{ code: 'numerator', display: '已达标病例数' }] } },
          { code: { coding: [{ code: 'denominator', display: '分母病例数' }] } }
        ], stratifier: [{ code: { coding: [{ code: 'org', display: '按科室分层' }] } }] }],
        ext: { measureKind: m[1], formula: 'numerator / denominator' }
      });
    });
  }

  function seedProfiles() {
    var list = V.structureDefinitions(BASE);
    list.forEach(function (sd, i) {
      sd.id = 'StructureDefinition-' + String(i + 1).padStart(3, '0');
      sd.status = 'active'; sd.experimental = false; sd.fhirVersion = '4.0.1';
      F.seed(sd);
    });
    // 问题项级扩展声明（不属于资源级 ext，故显式声明）
    [['QuestionnaireItem-minLength', '最短填写长度（字符）', 'valueInteger'],
     ['QuestionnaireItem-maxLength', '最长填写长度（字符）', 'valueInteger'],
     ['QuestionnaireItem-prefilled', '字段由 EMR/HIS 预填充且不可修改', 'valueBoolean'],
     ['QuestionnaireItem-moduleNote', '模块书写提示说明', 'valueString']].forEach(function (e, i) {
      F.seed({
        resourceType: 'StructureDefinition', id: 'StructureDefinition-item-' + (i + 1),
        url: BASE + e[0], name: e[0], title: 'Questionnaire.item 扩展：' + e[0],
        status: 'active', experimental: false, kind: 'complex-type', abstract: false,
        type: 'Extension', baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Extension', derivation: 'constraint',
        context: [{ type: 'element', expression: 'Questionnaire.item' }],
        description: e[1] + '；取值元素：' + e[2] + '。',
        ext: { fieldKind: 'item', note: 'Questionnaire.item Profile' }
      });
    });
  }

  function seedSystemInfo() {
    F.seed({
      resourceType: 'Basic', id: 'Basic-system-meta',
      code: cc('obs-code', 'detail', '系统演示元信息'),
      ext: {
        configKind: 'system-meta',
        config: {
          spec: 'BA-UX-design-SWBL（v2.0）.md', version: 'v2.0', fhir: 'FHIR R4',
          hospital: '示例综合三甲医院', t0: new Date(T0).toISOString(),
          pages: 21, identities: global.Domain.DEMO_USERS.length
        }
      }
    });
  }

  /* ───── 执行 ───── */
  var baseSteps = [seedOrgs, seedPeople, seedIcd, seedTemplates, seedTimeout, seedClassifyRules,
    seedNotifyScenes, seedApprovalFlow, seedRolePermissions, seedReportSchedule,
    seedMeasures, seedProfiles, seedSystemInfo];

  function runBase() {
    baseSteps.forEach(function (fn) { fn(); });
  }

  global.Seed = {
    T0: T0, at: at, days: days, day: DAY, hour: HOUR, min: MIN,
    R: function () { return R(); }, rnd: rnd, pick: pick, int: int,
    R_: R_, coding: coding, cc: cc, qitem: qitem, personId: personId,
    DEPTS: DEPTS, DISCUSS_MODULES: DISCUSS_MODULES, REPORT_MODULES: REPORT_MODULES,
    CLASSIFY_RULES: CLASSIFY_RULES, flatten: flatten,
    runBase: runBase, steps: []
  };
})(typeof window !== 'undefined' ? window : globalThis);
