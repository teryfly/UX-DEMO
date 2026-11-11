/* =====================================================================
 * 手术安全核查制度闭环管理系统 —— FHIR 数据仿真存储层
 * ---------------------------------------------------------------------
 * 以浏览器内存 + localStorage 作为“缓存”，模拟一个 FHIR R4 服务端的
 * RESTful CRUD（create / read / update / delete / search）。
 * 所有数据操作都会记录到 FHIR 请求日志，供演示时实时查看接口调用。
 * ===================================================================== */
(function () {
  'use strict';
  const SSAQ = (window.SSAQ = window.SSAQ || {});

  const LS_KEY = 'ssaq_fhir_db_v3';
  const LS_SESSION = 'ssaq_session_v2';

  // ---- 工具 ----------------------------------------------------------
  let _seq = 1000;
  function genId(prefix) {
    _seq += 1;
    return (prefix || 'res') + '-' + _seq;
  }
  function nowIso() {
    return new Date().toISOString();
  }
  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  // =====================================================================
  // 角色定义
  // =====================================================================
  const ROLES = {
    admin: { code: 'admin', name: '系统管理员', module: 'config', desc: '负责手术安全核查表模板的配置与维护管理' },
    anesthesiologist: { code: 'anesthesiologist', name: '麻醉医生', module: 'checklist', desc: '负责麻醉前核查的牵头与逐项确认' },
    surgeon: { code: 'surgeon', name: '主刀医生', module: 'checklist', desc: '负责开刀前核查的牵头与逐项确认' },
    scrubNurse: { code: 'scrubNurse', name: '洗手护士', module: 'checklist', desc: '负责离室前核查的牵头与逐项确认' },
    orManager: { code: 'orManager', name: '手术室管理部门', module: 'monitor', desc: '监督核查执行情况与合规管控' },
    qualityManager: { code: 'qualityManager', name: '医疗质量管理部门', module: 'analysis', desc: '核查质量统计分析与报告出具' },
  };
  const ROLE_MODULES = {
    admin: ['config'], anesthesiologist: ['checklist'], surgeon: ['checklist'],
    scrubNurse: ['checklist'], orManager: ['monitor'], qualityManager: ['analysis'],
  };

  const PHASES = [
    { key: 'preAnesthesia', name: '麻醉前核查', lead: 'anesthesiologist', blocks: '麻醉记录流程', short: '麻醉前' },
    { key: 'preIncision', name: '开刀前核查', lead: 'surgeon', blocks: '手术后续流程', short: '开刀前' },
    { key: 'preDeparture', name: '离室前核查', lead: 'scrubNurse', blocks: '患者离室流程', short: '离室前' },
  ];
  const PARTY_ROLES = ['anesthesiologist', 'surgeon', 'scrubNurse'];

  // =====================================================================
  // 标准核查内容（按 阶段 -> 角色 分组），来源：WF-L3-2-x 线框图
  // =====================================================================
  function standardItems() {
    const mk = (texts) => texts.map((t, i) => ({ text: t, required: i < texts.length - 1, order: i + 1 }));
    return {
      preAnesthesia: {
        anesthesiologist: mk(['患者身份确认（姓名+住院号）', '手术部位确认', '拟行术式确认', '知情同意书签署确认', '麻醉方式确认', '麻醉设备检查完成', '过敏史核查完成']),
        surgeon: mk(['患者身份确认（姓名+住院号）', '手术部位确认', '拟行术式确认', '手术部位标识确认', '预计手术时长确认', '特殊器械/备血确认']),
        scrubNurse: mk(['患者身份确认（姓名+住院号）', '手术部位确认', '拟行术式确认', '手术器械清点完成', '无菌物品效期确认', '药品/血制品确认']),
      },
      preIncision: {
        surgeon: mk(['患者身份确认', '手术部位与标识确认', '拟行术式确认', '手术体位确认', '预计失血量与备血确认', '关键步骤与风险预案确认']),
        anesthesiologist: mk(['患者身份确认', '麻醉准备完成确认', '生命体征平稳确认', '抗生素预防使用确认', '输血/补液通道确认']),
        scrubNurse: mk(['患者身份确认', '器械/敷料术前清点确认', '无菌台准备完成', '特殊器械到位确认', '植入物准备确认']),
      },
      preDeparture: {
        scrubNurse: mk(['手术名称确认', '器械/敷料/纱布清点一致', '标本标识与送检确认', '手术用物完整性确认', '皮肤完整性检查']),
        surgeon: mk(['手术名称确认', '实际手术方式确认', '术中情况交接确认', '标本确认', '引流管/置管确认']),
        anesthesiologist: mk(['患者生命体征确认', '复苏状况评估', '转运方式确认', '术后医嘱确认', '患者去向确认']),
      },
    };
  }

  // =====================================================================
  // 种子数据
  // =====================================================================
  function seed() {
    const db = {};
    const put = (type, res) => {
      res.resourceType = type;
      if (!res.id) res.id = genId(type.toLowerCase());
      res.meta = res.meta || {};
      res.meta.versionId = res.meta.versionId || '1';
      res.meta.lastUpdated = res.meta.lastUpdated || nowIso();
      (db[type] = db[type] || {})[res.id] = res;
      return res;
    };

    // --- 组织/科室 ---
    const DEPTS = [
      ['org-gs', '普外科'], ['org-hbp', '肝胆外科'], ['org-ortho', '骨科'], ['org-cardiac', '心外科'],
      ['org-neuro', '神经外科'], ['org-uro', '泌尿外科'], ['org-thoracic', '胸外科'], ['org-gyn', '妇科'],
      ['org-ent', '耳鼻喉科'], ['org-eye', '眼科'],
    ];
    DEPTS.forEach(([id, name]) => put('Organization', { id, name, type: 'dept' }));
    const orgName = (id) => (db.Organization[id] || {}).name;

    // --- 手术间 ---
    ['OR-01', 'OR-02', 'OR-03', 'OR-04', 'OR-05', 'OR-06'].forEach((n) =>
      put('Location', { id: 'loc-' + n, name: n, status: 'active', physicalType: 'room' }));

    // --- 医务人员 + 资质 ---
    function practitioner(id, name, roleCode, orgId, qualValid, licenseNo, note) {
      put('Practitioner', {
        id, name: [{ text: name }],
        identifier: [{ system: 'urn:hospital:staff', value: 'GH' + id.slice(-4).toUpperCase() }],
        qualification: [{ code: { text: ROLES[roleCode].name + '执业资质' }, identifier: licenseNo }],
      });
      put('PractitionerRole', {
        id: 'prole-' + id,
        practitioner: { reference: 'Practitioner/' + id, display: name },
        organization: orgId ? { reference: 'Organization/' + orgId } : undefined,
        code: [{ text: ROLES[roleCode].name }], roleCode, active: qualValid,
        qualification: {
          valid: qualValid, licenseNo,
          validUntil: qualValid ? '2027-12-31' : '2026-03-31',
          note: qualValid ? '资质有效' : (note || '执业资质已于2026-03-31到期，待续注'),
        },
      });
    }
    practitioner('zheng', '郑国维', 'admin', null, true, 'ADM-0001');
    practitioner('wangadm', '王慧', 'admin', null, true, 'ADM-0002');
    practitioner('liadm', '李文博', 'admin', null, true, 'ADM-0003');
    practitioner('zhang', '张明远', 'anesthesiologist', 'org-gs', true, 'MZ-2021-0345');
    practitioner('sun', '孙立', 'anesthesiologist', 'org-gs', false, 'MZ-2019-0712', '麻醉执业资质已于2026-03-31到期，待续注，暂停手术签名权限');
    practitioner('qian', '钱芳', 'anesthesiologist', 'org-cardiac', true, 'MZ-2020-0508');
    practitioner('wang', '王建国', 'surgeon', 'org-gs', true, 'WK-2018-0156');
    practitioner('zhou', '周敏', 'surgeon', 'org-ortho', true, 'WK-2020-0233');
    practitioner('zheng2', '郑伟', 'surgeon', 'org-cardiac', true, 'WK-2017-0099');
    practitioner('feng', '冯雪', 'surgeon', 'org-gyn', true, 'WK-2021-0410');
    practitioner('zhao', '赵丽', 'scrubNurse', 'org-gs', true, 'HS-2022-0588');
    practitioner('wu', '吴霞', 'scrubNurse', 'org-ortho', true, 'HS-2021-0461');
    practitioner('lin', '林楠', 'scrubNurse', 'org-cardiac', true, 'HS-2023-0102');
    practitioner('he', '何静', 'scrubNurse', 'org-neuro', false, 'HS-2024-0307', '护士执业证书在注册有效期外，资质校验不通过');
    practitioner('liu', '刘海涛', 'orManager', null, true, 'MGR-0001');
    practitioner('chen', '陈静', 'qualityManager', null, true, 'QA-0001');
    const staffName = (id) => db.Practitioner[id].name[0].text;

    // --- 患者 ---
    function patient(id, name, gender, age, mrn, bed) {
      return put('Patient', { id, name: [{ text: name }], gender, age, identifier: [{ system: 'urn:hospital:mrn', value: mrn, label: '住院号' }], bed });
    }
    const pLi = patient('pat-li', '李国华', 'male', 45, 'ZY2026030123', '12-03');
    const pChen = patient('pat-chen', '陈秀英', 'female', 58, 'ZY2026030210', '09-01');
    const pZhou = patient('pat-zhou', '周建军', 'male', 63, 'ZY2026030088', '05-02');
    const pSun = patient('pat-sun', '孙丽娟', 'female', 39, 'ZY2026030301', '14-06');
    const pWu = patient('pat-wu', '吴美玲', 'female', 51, 'ZY2026030255', '07-04');
    const pHuang = patient('pat-huang', '黄志强', 'male', 67, 'ZY2026030412', '03-08');

    // --- 风险评估标准（ASA + NNIS）---
    function riskStd(id, name, code, scope, grades) {
      put('RiskStandard', { id, name, basicCode: code, scope, grades });
    }
    riskStd('risk-asa', 'ASA 麻醉风险分级', 'asa-grade', '适用全院全部手术类型，统一风险评估统计口径', [
      { grade: 'ASA Ⅰ', desc: '体格健康，发育营养良好，各器官功能正常', basis: '无系统性疾病', enabled: true },
      { grade: 'ASA Ⅱ', desc: '有轻度系统性疾病，重要器官功能代偿健全', basis: '如轻度高血压、糖尿病控制良好', enabled: true },
      { grade: 'ASA Ⅲ', desc: '有严重系统性疾病，体力活动受限但尚能应付日常活动', basis: '如心绞痛、陈旧性心梗', enabled: true },
      { grade: 'ASA Ⅳ', desc: '有严重系统性疾病，已构成生命威胁', basis: '如严重心肺功能不全', enabled: true },
      { grade: 'ASA Ⅴ', desc: '无论手术与否，生命难以维持24小时的濒死患者', basis: '如腹主动脉瘤破裂', enabled: true },
      { grade: 'ASA Ⅵ', desc: '确诊脑死亡，准备作为器官捐献的患者', basis: '器官移植供体', enabled: false },
    ]);
    riskStd('risk-nnis', 'NNIS 手术风险指数', 'nnis-grade', '用于手术部位感染风险分层统计', [
      { grade: 'NNIS 0', desc: '手术风险低', basis: '切口清洁 + 无合并危险因素', enabled: true },
      { grade: 'NNIS 1', desc: '手术风险中', basis: '具备一项风险因子', enabled: true },
      { grade: 'NNIS 2', desc: '手术风险较高', basis: '具备两项风险因子', enabled: true },
      { grade: 'NNIS 3', desc: '手术风险高', basis: '具备三项风险因子', enabled: false },
    ]);

    // --- 卡控规则（6 条，含拦截条件）---
    const gateRules = [
      { id: 'gate-1', node: 'preAnesthesia', gateType: 'block', blockedProcess: '麻醉记录流程', condition: '麻醉前核查未完成', enabled: true },
      { id: 'gate-2', node: 'preAnesthesia', gateType: 'warn', blockedProcess: '—', condition: '三方签名未完成', enabled: false },
      { id: 'gate-3', node: 'preIncision', gateType: 'block', blockedProcess: '手术后续流程', condition: '开刀前核查未完成', enabled: true },
      { id: 'gate-4', node: 'preIncision', gateType: 'block', blockedProcess: '手术后续流程', condition: '签名人员资质校验未通过', enabled: true },
      { id: 'gate-5', node: 'preDeparture', gateType: 'block', blockedProcess: '患者离室流程', condition: '离室前核查未完成', enabled: true },
      { id: 'gate-6', node: 'preDeparture', gateType: 'block', blockedProcess: '患者离室流程', condition: '手术器械清点未完成', enabled: true },
    ];
    gateRules.forEach((g) => put('GateRule', { ...g, nodeName: (PHASES.find((p) => p.key === g.node) || {}).name }));

    // --- 时间规范（15/15/10）+ 超时分类 ---
    [{ phase: 'preAnesthesia', step: '麻醉前三方逐项确认至签名完成', threshold: 15 },
     { phase: 'preIncision', step: '开刀前三方逐项确认至签名完成', threshold: 15 },
     { phase: 'preDeparture', step: '离室前三方逐项确认至签名完成', threshold: 10 }]
      .forEach((t) => put('TimeNorm', { id: 'tn-' + t.phase, phase: t.phase, step: t.step, threshold: t.threshold, enabled: true }));
    put('TimeoutCategory', {
      id: 'tcat', categories: [
        { code: 'staff', name: '人员延迟', note: '等待核查人员到场导致的超时' },
        { code: 'intraop', name: '术中突发', note: '术中紧急情况导致核查流程中断的超时' },
        { code: 'system', name: '系统异常', note: '系统故障或网络问题导致的超时' },
      ],
    });

    // --- 核查表模板（12 个）---
    const TEMPLATES = [
      { id: 'q-general', name: '普外科手术安全核查表', code: 'SFC-PWK-001', types: ['普外科', '肝胆外科'], status: 'active', version: '2.1', updater: '王慧' },
      { id: 'q-ortho', name: '骨科手术安全核查表', code: 'SFC-ORT-001', types: ['骨科'], status: 'active', version: '1.3', updater: '李文博' },
      { id: 'q-cardiac', name: '心外科手术安全核查表', code: 'SFC-CAR-001', types: ['心外科'], status: 'draft', version: '0.5', updater: '郑国维' },
      { id: 'q-neuro', name: '神经外科手术安全核查表', code: 'SFC-NEU-001', types: ['神经外科'], status: 'inactive', version: '1.0', updater: '王慧' },
      { id: 'q-gyn', name: '妇科手术安全核查表', code: 'SFC-GYN-001', types: ['妇科'], status: 'active', version: '1.2', updater: '李文博' },
      { id: 'q-uro', name: '泌尿外科手术安全核查表', code: 'SFC-URO-001', types: ['泌尿外科'], status: 'active', version: '1.1', updater: '王慧' },
      { id: 'q-eye', name: '眼科手术安全核查表', code: 'SFC-EYE-001', types: ['眼科'], status: 'inactive', version: '1.0', updater: '郑国维' },
      { id: 'q-ent', name: '耳鼻喉科手术安全核查表', code: 'SFC-ENT-001', types: ['耳鼻喉科'], status: 'active', version: '1.0', updater: '李文博' },
      { id: 'q-thoracic', name: '胸外科手术安全核查表', code: 'SFC-THO-001', types: ['胸外科'], status: 'active', version: '1.4', updater: '王慧' },
      { id: 'q-hbp', name: '肝胆外科手术安全核查表', code: 'SFC-HBP-001', types: ['肝胆外科'], status: 'draft', version: '0.3', updater: '郑国维' },
      { id: 'q-vascular', name: '血管外科手术安全核查表', code: 'SFC-VAS-001', types: ['血管外科'], status: 'draft', version: '0.2', updater: '李文博' },
      { id: 'q-general-tpl', name: '通用手术安全核查表（标准模板）', code: 'SFC-COM-001', types: ['通用'], status: 'active', version: '3.0', updater: '王慧' },
    ];
    const std = standardItems();
    TEMPLATES.forEach((t, ti) => {
      const items = [];
      PHASES.forEach((ph) => PARTY_ROLES.forEach((role) =>
        (std[ph.key][role] || []).forEach((it) => items.push({ phase: ph.key, party: role, text: it.text, required: it.required, order: it.order }))));
      const lu = ['2026-06-03T14:30:00Z', '2026-06-02T10:00:00Z', '2026-05-28T16:00:00Z', '2026-05-25T09:00:00Z', '2026-05-20T11:00:00Z', '2026-05-18T14:00:00Z', '2026-05-15T10:00:00Z', '2026-05-10T09:00:00Z', '2026-05-08T15:00:00Z', '2026-05-05T11:00:00Z', '2026-05-02T09:00:00Z', '2026-04-28T16:00:00Z'][ti];
      put('Questionnaire', { id: t.id, name: t.name, title: t.name, code: t.code, surgeryTypes: t.types, status: t.status, version: t.version, updater: t.updater, item: items, meta: { versionId: '1', lastUpdated: lu } });
    });

    // 配置 / 版本变更日志（Provenance）
    function prov(target, who, kind, type, summary, when, version) {
      put('Provenance', { id: genId('prov'), target: [{ reference: target }], recorded: when || nowIso(), activity: { text: type }, kind, opType: type, agent: [{ who: { display: who } }], summary, version });
    }
    prov('Questionnaire/q-general', '王慧', 'config', '编辑', '新增麻醉前核查项“过敏史核查完成”', '2026-06-03T14:30:00Z', 'v2.1');
    prov('Questionnaire/q-general', '王慧', 'config', '编辑', '调整开刀前核查项排序', '2026-05-28T14:15:00Z', 'v2.0');
    prov('Questionnaire/q-general', '李文博', 'config', '编辑', '修改离室前核查项描述', '2026-05-20T09:00:00Z', 'v1.1');
    prov('Questionnaire/q-general', '李文博', 'config', '新增', '初始版本创建，含三阶段核查内容', '2026-05-15T09:30:00Z', 'v1.0');
    prov('Questionnaire/q-ortho', '李文博', 'config', '编辑', '确认生效，发布 v1.3', '2026-06-02T10:00:00Z', 'v1.3');
    prov('Questionnaire/q-ortho', '李文博', 'config', '新增', '初始版本创建', '2026-04-18T14:05:00Z', 'v1.0');
    prov('GateRule/gate-2', '王慧', 'config', '禁用', '禁用规则：麻醉前三方签名未完成警告', '2026-06-02T09:00:00Z');
    prov('GateRule/gate-6', '李文博', 'config', '新增', '新增规则：离室前器械清点未完成拦截', '2026-05-28T14:00:00Z');
    prov('GateRule/gate-4', '王慧', 'config', '编辑', '修改规则：开刀前资质校验未通过拦截', '2026-05-20T10:00:00Z');
    prov('GateRule/gate-1', '李文博', 'config', '新增', '初始创建 6 条卡控规则', '2026-05-15T09:00:00Z');
    prov('TimeNorm/tn-preAnesthesia', '王慧', 'config', '编辑', '麻醉前核查超时阈值 5→15 分钟', '2026-06-01T10:00:00Z');
    prov('TimeNorm/tn-preIncision', '李文博', 'config', '新增', '新增超时分类“术中突发”', '2026-05-25T14:00:00Z');
    prov('TimeNorm/tn-preDeparture', '王慧', 'config', '新增', '初始创建时间规范配置', '2026-05-15T09:00:00Z');
    prov('RiskStandard/risk-asa', '郑国维', 'config', '编辑', '停用 ASA Ⅵ 级（脑死亡供体）', '2026-05-30T10:00:00Z');
    prov('RiskStandard/risk-nnis', '王慧', 'config', '新增', '新增 NNIS 手术风险指数标准', '2026-05-22T11:00:00Z');
    prov('RiskStandard/risk-asa', '郑国维', 'config', '新增', '初始创建 ASA 分级标准', '2026-05-15T09:00:00Z');

    // --- 手术（Encounter）+ 术式 + 风险 ---
    function surgery(o) {
      put('Encounter', {
        id: o.id, status: o.status, class: { code: 'SURG', display: '手术' },
        subject: { reference: 'Patient/' + o.patient.id, display: o.patient.name[0].text },
        location: [{ location: { reference: 'Location/loc-' + o.room, display: o.room } }],
        serviceProvider: { reference: 'Organization/' + o.org, display: orgName(o.org) },
        room: o.room, department: orgName(o.org), surgeryDate: o.date,
        participant: PARTY_ROLES.map((r) => ({ role: r, actor: { reference: 'Practitioner/' + o[r], display: staffName(o[r]) } })),
        questionnaire: o.questionnaire, currentPhase: o.currentPhase, phaseStatus: o.phaseStatus,
      });
      put('Procedure', {
        id: 'proc-' + o.id, status: 'preparation', subject: { reference: 'Patient/' + o.patient.id },
        encounter: { reference: 'Encounter/' + o.id }, code: { text: o.procedure },
        bodySite: [{ text: o.bodySite }], requestedBodySite: o.requestedBodySite || o.bodySite,
      });
      put('Observation', {
        id: 'obs-asa-' + o.id, status: 'final', category: 'risk-assessment', code: { text: 'ASA 分级' },
        subject: { reference: 'Patient/' + o.patient.id }, encounter: { reference: 'Encounter/' + o.id },
        valueCodeableConcept: { text: o.asa },
      });
    }
    // OR-03 普外 阑尾切除 —— 临床演示主案例（麻醉前进行中）
    surgery({ id: 'enc-or03', patient: pLi, room: 'OR-03', org: 'org-gs', date: '2026-06-20',
      anesthesiologist: 'zhang', surgeon: 'wang', scrubNurse: 'zhao', questionnaire: 'q-general', procedure: '阑尾切除术',
      bodySite: '右下腹', asa: 'ASA Ⅱ', status: 'in-progress', currentPhase: 'preAnesthesia',
      phaseStatus: { preAnesthesia: 'inProgress', preIncision: 'notStarted', preDeparture: 'notStarted' } });
    // OR-01 骨科 膝关节镜 —— 开刀前进行中（麻醉前已通过）
    surgery({ id: 'enc-or01', patient: pChen, room: 'OR-01', org: 'org-ortho', date: '2026-06-20',
      anesthesiologist: 'zhang', surgeon: 'zhou', scrubNurse: 'wu', questionnaire: 'q-ortho', procedure: '右膝关节镜手术',
      bodySite: '右膝', asa: 'ASA Ⅱ', status: 'in-progress', currentPhase: 'preIncision',
      phaseStatus: { preAnesthesia: 'passed', preIncision: 'inProgress', preDeparture: 'notStarted' } });
    // OR-02 心外 冠脉搭桥 —— 开刀前进行中
    surgery({ id: 'enc-or02', patient: pZhou, room: 'OR-02', org: 'org-cardiac', date: '2026-06-20',
      anesthesiologist: 'qian', surgeon: 'zheng2', scrubNurse: 'lin', questionnaire: 'q-cardiac', procedure: '冠状动脉旁路移植术',
      bodySite: '胸部', requestedBodySite: '右股骨', asa: 'ASA Ⅲ', status: 'in-progress', currentPhase: 'preIncision',
      phaseStatus: { preAnesthesia: 'passed', preIncision: 'inProgress', preDeparture: 'notStarted' } });
    // OR-04 神外 —— 麻醉前卡控拦截 + 资质异常（孙立资质过期）
    surgery({ id: 'enc-or04', patient: pSun, room: 'OR-04', org: 'org-neuro', date: '2026-06-20',
      anesthesiologist: 'sun', surgeon: 'wang', scrubNurse: 'he', questionnaire: 'q-neuro', procedure: '腰椎间盘髓核摘除术',
      bodySite: '腰部', asa: 'ASA Ⅱ', status: 'in-progress', currentPhase: 'preAnesthesia',
      phaseStatus: { preAnesthesia: 'blocked', preIncision: 'notStarted', preDeparture: 'notStarted' } });
    // OR-05 妇科 —— 离室前已完成（全流程通过）
    surgery({ id: 'enc-or05', patient: pWu, room: 'OR-05', org: 'org-gyn', date: '2026-06-19',
      anesthesiologist: 'qian', surgeon: 'feng', scrubNurse: 'lin', questionnaire: 'q-gyn', procedure: '腹腔镜子宫肌瘤剔除术',
      bodySite: '盆腔', requestedBodySite: '左乳腺', asa: 'ASA Ⅱ', status: 'finished', currentPhase: 'preDeparture',
      phaseStatus: { preAnesthesia: 'passed', preIncision: 'passed', preDeparture: 'passed' } });
    // OR-06 泌尿 —— 待核查（麻醉前未开始）
    surgery({ id: 'enc-or06', patient: pHuang, room: 'OR-06', org: 'org-uro', date: '2026-06-20',
      anesthesiologist: 'zhang', surgeon: 'wang', scrubNurse: 'zhao', questionnaire: 'q-uro', procedure: '经尿道前列腺电切术',
      bodySite: '前列腺', asa: 'ASA Ⅲ', status: 'in-progress', currentPhase: 'preAnesthesia',
      phaseStatus: { preAnesthesia: 'notStarted', preIncision: 'notStarted', preDeparture: 'notStarted' } });

    // --- 历史 QuestionnaireResponse ---
    function buildResponse(encId, phaseKey, qId, completed, baseTime, duration) {
      const enc = db.Encounter[encId];
      const q = db.Questionnaire[qId];
      const parties = {};
      PARTY_ROLES.forEach((role) => {
        const partItems = q.item.filter((it) => it.phase === phaseKey && it.party === role);
        const actor = enc.participant.find((p) => p.role === role).actor;
        parties[role] = {
          role, actorRef: actor.reference, actorName: actor.display,
          items: partItems.map((it) => ({ text: it.text, required: it.required, confirmed: completed })),
          signed: completed, qualificationValid: true, signedAt: completed ? baseTime : null,
          provenance: completed ? 'Provenance/seed-' + encId + '-' + phaseKey + '-' + role : null,
        };
      });
      put('QuestionnaireResponse', {
        id: 'qr-' + encId + '-' + phaseKey, status: completed ? 'completed' : 'in-progress',
        questionnaire: 'Questionnaire/' + qId, encounter: { reference: 'Encounter/' + encId }, subject: enc.subject,
        phase: phaseKey, authored: baseTime, completedAt: completed ? baseTime : null, durationMinutes: completed ? duration : null,
        parties,
      });
    }
    buildResponse('enc-or01', 'preAnesthesia', 'q-ortho', true, '2026-06-20T08:05:00Z', 4);
    buildResponse('enc-or02', 'preAnesthesia', 'q-cardiac', true, '2026-06-20T07:50:00Z', 6);
    buildResponse('enc-or05', 'preAnesthesia', 'q-gyn', true, '2026-06-19T08:10:00Z', 5);
    buildResponse('enc-or05', 'preIncision', 'q-gyn', true, '2026-06-19T08:40:00Z', 5);
    buildResponse('enc-or05', 'preDeparture', 'q-gyn', true, '2026-06-19T11:20:00Z', 7);

    // --- 违规记录 AuditEvent ---
    function audit(o) {
      put('AuditEvent', { id: genId('audit'), type: o.type, subtype: o.subtype || null, recorded: o.when, outcome: '4',
        room: o.room, department: o.dept, encounter: o.encounter || '历史手术', patientName: o.patientName,
        agentName: o.agentName, phase: o.phase, detail: o.detail });
    }
    audit({ type: 'block', when: '2026-06-20T09:18:00Z', room: 'OR-04', dept: '神经外科', encounter: 'enc-or04', patientName: '孙丽娟', agentName: '系统', phase: 'preAnesthesia', detail: '麻醉前核查未完成（签名人资质异常），拦截麻醉记录流程启动' });
    audit({ type: 'qualification', when: '2026-06-20T09:20:00Z', room: 'OR-04', dept: '神经外科', encounter: 'enc-or04', patientName: '孙丽娟', agentName: '孙立', phase: 'preAnesthesia', detail: '签名人“孙立”麻醉执业资质已过期，资质校验未通过，拒绝签名' });
    audit({ type: 'timeout', subtype: 'intraop', when: '2026-06-20T10:35:00Z', room: 'OR-02', dept: '心外科', encounter: 'enc-or02', patientName: '周建军', agentName: '全体', phase: 'preIncision', detail: '开刀前核查耗时18分钟，超过15分钟阈值（术中突发出血处理）' });
    audit({ type: 'timeout', subtype: 'staff', when: '2026-06-20T11:10:00Z', room: 'OR-01', dept: '骨科', encounter: 'enc-or01', patientName: '陈秀英', agentName: '全体', phase: 'preIncision', detail: '开刀前核查耗时12分钟（等待主刀医生到场）' });
    audit({ type: 'qualification', when: '2026-06-17T15:40:00Z', room: 'OR-04', dept: '神经外科', encounter: 'enc-or04', patientName: '孙丽娟', agentName: '何静', phase: 'preDeparture', detail: '签名人“何静”护士执业证书在注册有效期外，资质校验不通过' });
    audit({ type: 'block', when: '2026-06-17T10:05:00Z', room: 'OR-06', dept: '泌尿外科', encounter: 'enc-or06', patientName: '黄志强', agentName: '系统', phase: 'preIncision', detail: '开刀前核查未完成，拦截手术后续流程启动' });

    // --- 历史质量报告 ---
    put('DocumentReference', {
      id: 'doc-2026-05', status: 'current', type: { text: '手术室核查质量评价报告' },
      title: '2026年5月手术室核查质量评价报告', period: '2026-05', department: '全院',
      date: '2026-06-01T09:00:00Z', archived: true,
      content: { totalSurgery: 1284, completionRate: 97.8, violationRate: 2.2, summary: '2026年5月全院共开展手术1,284台，三方核查完成率97.8%，较上月提升1.2个百分点，违规率2.2%。' },
    });
    put('DocumentReference', {
      id: 'doc-2026-04', status: 'current', type: { text: '手术室核查质量评价报告' },
      title: '2026年4月手术室核查质量评价报告', period: '2026-04', department: '全院',
      date: '2026-05-01T09:00:00Z', archived: true,
      content: { totalSurgery: 1196, completionRate: 96.6, violationRate: 3.4, summary: '2026年4月全院共开展手术1,196台，三方核查完成率96.6%，违规率3.4%。' },
    });

    return db;
  }

  // =====================================================================
  // Store —— FHIR RESTful 仿真
  // =====================================================================
  const listeners = new Set();
  const logListeners = new Set();

  const store = {
    db: {}, log: [],
    session: { roleCode: 'anesthesiologist', selectedEncounter: 'enc-or03' },
    ROLES, ROLE_MODULES, PHASES, PARTY_ROLES,

    persist() {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.db)); localStorage.setItem(LS_SESSION, JSON.stringify(this.session)); } catch (e) {}
    },
    load() {
      try {
        const raw = localStorage.getItem(LS_KEY); const ses = localStorage.getItem(LS_SESSION);
        if (raw) this.db = JSON.parse(raw); if (ses) this.session = JSON.parse(ses);
      } catch (e) {}
      if (!this.db || !this.db.Patient) { this.db = seed(); this.persist(); }
    },
    reset() {
      _seq = 1000; this.db = seed(); this.log = [];
      this.session = { roleCode: 'anesthesiologist', selectedEncounter: 'enc-or03' };
      this.persist(); this._notify(); this._notifyLog();
    },

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    subscribeLog(fn) { logListeners.add(fn); return () => logListeners.delete(fn); },
    _notify() { listeners.forEach((fn) => fn()); },
    _notifyLog() { logListeners.forEach((fn) => fn()); },
    _pushLog(method, url, status, body) {
      this.log.unshift({ id: genId('log'), ts: nowIso(), method, url, status, body });
      if (this.log.length > 200) this.log.length = 200; this._notifyLog();
    },

    search(type, predicate) {
      const all = Object.values(this.db[type] || {});
      const res = predicate ? all.filter(predicate) : all;
      this._pushLog('GET', '/fhir/' + type + (predicate ? '?_filter=…' : ''), 200, { total: res.length });
      return clone(res);
    },
    read(type, id) {
      const r = (this.db[type] || {})[id];
      this._pushLog('GET', '/fhir/' + type + '/' + id, r ? 200 : 404, r ? { id } : null);
      return r ? clone(r) : null;
    },
    create(type, resource, opts) {
      resource = clone(resource); resource.resourceType = type;
      if (!resource.id) resource.id = genId(type.toLowerCase());
      resource.meta = { versionId: '1', lastUpdated: nowIso() };
      (this.db[type] = this.db[type] || {})[resource.id] = resource;
      this._pushLog('POST', '/fhir/' + type, 201, { id: resource.id }); this.persist();
      if (!(opts && opts.silent)) this._notify();
      return clone(resource);
    },
    update(type, id, resource, opts) {
      resource = clone(resource); resource.resourceType = type; resource.id = id;
      const prev = (this.db[type] || {})[id];
      const v = prev && prev.meta ? String(parseInt(prev.meta.versionId || '1', 10) + 1) : '1';
      resource.meta = { versionId: v, lastUpdated: nowIso() };
      (this.db[type] = this.db[type] || {})[id] = resource;
      this._pushLog('PUT', '/fhir/' + type + '/' + id, 200, { id, versionId: v }); this.persist();
      if (!(opts && opts.silent)) this._notify();
      return clone(resource);
    },
    remove(type, id, opts) {
      if (this.db[type]) delete this.db[type][id];
      this._pushLog('DELETE', '/fhir/' + type + '/' + id, 204, { id }); this.persist();
      if (!(opts && opts.silent)) this._notify();
    },

    setRole(roleCode) { this.session.roleCode = roleCode; this.persist(); this._notify(); },
    setEncounter(encId) { this.session.selectedEncounter = encId; this.persist(); this._notify(); },
    currentRole() { return ROLES[this.session.roleCode]; },
    practitionerForRole(encId, roleCode) {
      const enc = (this.db.Encounter || {})[encId]; if (!enc) return null;
      const part = enc.participant.find((p) => p.role === roleCode); if (!part) return null;
      return (this.db.Practitioner || {})[part.actor.reference.split('/')[1]] || null;
    },
    practitionerRole(practitionerId) { return (this.db.PractitionerRole || {})['prole-' + practitionerId] || null; },
  };

  store.load();
  SSAQ.store = store;
  SSAQ.genId = genId;
  SSAQ.nowIso = nowIso;
})();
