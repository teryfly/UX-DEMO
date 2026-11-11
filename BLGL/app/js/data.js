/* ============================================================
   FHIR 风格数据层 —— 病历管理制度闭环管理系统
   资源以 FHIR R4 资源类型组织（Patient / Encounter / Practitioner /
   Organization / Composition(病历文书) / Task(整改任务) /
   DetectedIssue(质控异常) / Communication(通知) / AuditEvent(审计) /
   Provenance(流转) / PlanDefinition(质控规则) / ActivityDefinition(时限规则)）。
   所有数据缓存于内存并持久化至 localStorage，可一键重置为种子数据。
   ============================================================ */
const FHIR = (() => {
  const NOW = new Date('2026-06-20T10:00:00');
  const LS_KEY = 'emr_qc_demo_db_v1';

  // ---- 工具 ----
  const hours = h => h * 3600e3;
  const at = iso => new Date(iso);
  const fmt = (d, withTime = true) => {
    if (!d) return '—';
    const x = (d instanceof Date) ? d : new Date(d);
    const p = n => String(n).padStart(2, '0');
    const s = `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
    return withTime ? `${s} ${p(x.getHours())}:${p(x.getMinutes())}` : s;
  };
  const mdhm = d => fmt(d).slice(5);
  let _seq = 1000;
  const uid = p => `${p}-${++_seq}`;

  // ---- 科室 Organization ----
  const ORGS = [
    { resourceType: 'Organization', id: 'org-xn', name: '心内科', type: '临床科室' },
    { resourceType: 'Organization', id: 'org-gk', name: '骨科', type: '临床科室' },
    { resourceType: 'Organization', id: 'org-pw', name: '普外科', type: '临床科室' },
    { resourceType: 'Organization', id: 'org-hx', name: '呼吸科', type: '临床科室' },
    { resourceType: 'Organization', id: 'org-sn', name: '神内科', type: '临床科室' },
    { resourceType: 'Organization', id: 'org-ba', name: '病案室', type: '职能科室' },
    { resourceType: 'Organization', id: 'org-zk', name: '医疗质量管理部门', type: '职能科室' },
  ];

  // ---- 角色定义 ----
  const ROLES = {
    clinician: { key: 'clinician', name: '临床医生', icon: '🩺' },
    deptHead:  { key: 'deptHead',  name: '科室负责人', icon: '👔' },
    archivist: { key: 'archivist', name: '病案室', icon: '🗄️' },
    qc:        { key: 'qc',        name: '医疗质量管理部门', icon: '📊' },
    admin:     { key: 'admin',     name: '系统管理员', icon: '⚙️' },
  };

  // ---- 用户 Practitioner（含 PractitionerRole）----
  const USERS = [
    { resourceType: 'Practitioner', id: 'u-zhang', name: '张医生', role: 'clinician', org: 'org-xn', active: true, lastLogin: '2026-06-20T08:30:00' },
    { resourceType: 'Practitioner', id: 'u-liu',   name: '刘医生', role: 'clinician', org: 'org-xn', active: true, lastLogin: '2026-06-19T16:20:00' },
    { resourceType: 'Practitioner', id: 'u-li',    name: '李主任', role: 'deptHead',  org: 'org-xn', active: true, lastLogin: '2026-06-20T07:45:00' },
    { resourceType: 'Practitioner', id: 'u-zhao',  name: '赵病案', role: 'archivist', org: 'org-ba', active: true, lastLogin: '2026-06-20T09:00:00' },
    { resourceType: 'Practitioner', id: 'u-qian',  name: '钱管理', role: 'qc',        org: 'org-zk', active: true, lastLogin: '2026-06-20T09:10:00' },
    { resourceType: 'Practitioner', id: 'u-admin', name: 'admin',  role: 'admin',     org: 'org-zk', active: true, lastLogin: '2026-06-20T08:55:00' },
    // 其它科室医生（用于全院统计）
    { resourceType: 'Practitioner', id: 'u-doc-gk', name: '李医生', role: 'clinician', org: 'org-gk', active: true, lastLogin: '2026-06-19T10:25:00' },
    { resourceType: 'Practitioner', id: 'u-doc-pw', name: '王医生', role: 'clinician', org: 'org-pw', active: true, lastLogin: '2026-06-19T16:45:00' },
    { resourceType: 'Practitioner', id: 'u-doc-hx', name: '赵医生', role: 'clinician', org: 'org-hx', active: true, lastLogin: '2026-06-18T14:15:00' },
    { resourceType: 'Practitioner', id: 'u-doc-sn', name: '钱医生', role: 'clinician', org: 'org-sn', active: true, lastLogin: '2026-06-18T11:20:00' },
    { resourceType: 'Practitioner', id: 'u-sun',   name: '孙医生', role: 'clinician', org: 'org-xn', active: false, lastLogin: '2026-05-28T10:30:00' },
  ];

  // ---- 文书类型 + 时限（ActivityDefinition）---- 与 EMR 系统模块树保持一致
  const DOC_TYPES = ['入院记录', '首次病程记录', '日常病程记录', '术前讨论记录', '手术记录', '出院记录', '医嘱', '体温单', '护理记录'];
  // 生效范围科室须与统计监督模块中出现的科室（Organization「临床科室」）保持一致，支持多科室（顿号分隔）
  const TIME_RULES = [
    { resourceType: 'ActivityDefinition', id: 'tr-1', docType: '入院记录',     hours: 24, anchor: '入院时间', scope: '全院', active: true,  modifiedAt: '2026-06-10T14:30:00', by: '钱管理' },
    { resourceType: 'ActivityDefinition', id: 'tr-2', docType: '首次病程记录', hours: 8,  anchor: '入院时间', scope: '全院', active: true,  modifiedAt: '2026-06-10T14:30:00', by: '钱管理' },
    { resourceType: 'ActivityDefinition', id: 'tr-3', docType: '术前讨论记录', hours: 24, anchor: '手术前',   scope: '骨科、普外科', active: true,  modifiedAt: '2026-06-08T10:15:00', by: '钱管理' },
    { resourceType: 'ActivityDefinition', id: 'tr-4', docType: '手术记录',     hours: 24, anchor: '手术完成', scope: '骨科、普外科', active: true,  modifiedAt: '2026-06-08T10:15:00', by: '钱管理' },
    { resourceType: 'ActivityDefinition', id: 'tr-6', docType: '日常病程记录', hours: 24, anchor: '创建时间', scope: '全院', active: true,  modifiedAt: '2026-06-05T16:40:00', by: '钱管理' },
    { resourceType: 'ActivityDefinition', id: 'tr-5', docType: '出院记录',     hours: 24, anchor: '出院前',   scope: '全院', active: false, modifiedAt: '2026-05-20T09:00:00', by: '钱管理' },
  ];

  // ---- 质控规则（PlanDefinition）----
  const QC_RULES = [
    { resourceType: 'PlanDefinition', id: 'qr-1', name: '入院记录必填项校验', node: '入院记录完成时', cond: '必填项校验', desc: '主诉、现病史、既往史不得为空', conditions: [{ name: '必填项校验', desc: '主诉不得为空' }, { name: '必填项校验', desc: '现病史不得为空' }, { name: '必填项校验', desc: '既往史不得为空' }], status: true, version: 'v1.2', scope: '全院', modifiedAt: '2026-06-10T14:30:00', by: '钱管理' },
    { resourceType: 'PlanDefinition', id: 'qr-2', name: '首次病程及时性检查', node: '首次病程完成时', cond: '8小时内完成', desc: '首次病程记录须于入院后8小时内完成', conditions: [{ name: '时限校验', desc: '入院后8小时内完成' }], status: true, version: 'v1.1', scope: '全院', modifiedAt: '2026-06-09T09:00:00', by: '钱管理' },
    { resourceType: 'PlanDefinition', id: 'qr-3', name: '术前讨论完整性检查', node: '术前讨论完成时', cond: '讨论记录必填项校验', desc: '术前讨论须含讨论意见与主持人签字', conditions: [{ name: '必填项校验', desc: '讨论意见不得为空' }, { name: '签字校验', desc: '主持人须签字' }], status: true, version: 'v2.0', scope: '骨科、普外科', modifiedAt: '2026-06-08T10:15:00', by: '钱管理' },
    { resourceType: 'PlanDefinition', id: 'qr-4', name: '手术记录及时性检查', node: '手术记录完成时', cond: '24小时内完成', desc: '手术记录须于术后24小时内完成', conditions: [{ name: '时限校验', desc: '术后24小时内完成' }], status: false, version: 'v1.0', scope: '骨科、普外科', modifiedAt: '2026-05-20T09:00:00', by: '钱管理' },
    { resourceType: 'PlanDefinition', id: 'qr-5', name: '出院记录完整性检查', node: '出院记录完成时', cond: '必填项+签字校验', desc: '出院小结、出院医嘱须完整并签字', conditions: [{ name: '必填项校验', desc: '出院小结不得为空' }, { name: '必填项校验', desc: '出院医嘱不得为空' }, { name: '签字校验', desc: '经治医师须签字' }], status: true, version: 'v1.3', scope: '全院', modifiedAt: '2026-06-06T11:00:00', by: '钱管理' },
  ];

  // 质控规则版本追溯
  const QC_VERSIONS = [
    { id: uid('ver'), version: 'v1.2', ruleId: 'qr-1', by: '钱管理', op: '修改', content: '入院记录必填项新增3项', at: '2026-06-10T14:30:00' },
    { id: uid('ver'), version: 'v2.0', ruleId: 'qr-3', by: '钱管理', op: '修改', content: '术前讨论完整性规则重构', at: '2026-06-08T10:15:00' },
    { id: uid('ver'), version: 'v1.0', ruleId: 'qr-4', by: '钱管理', op: '新增', content: '新增手术记录及时性规则', at: '2026-05-20T09:00:00' },
  ];

  // 通知设置
  const NOTIFY_CFG = {
    overdueWarn: { on: true, leadHours: 1, channels: { sys: true, sms: false, mail: false }, repeatDaily: true,
      tpl: '【书写时限预警】{患者姓名}的{文书类型}将于{剩余时间}后超时，请及时完成书写。截止时间：{截止时间}' },
    urge: { on: true, afterDays: 1, channels: { sys: true, sms: true, mail: false }, repeatDays: 2, ccDeptHead: true,
      tpl: '【整改催办提醒】{患者姓名}的病历整改任务已超时{超时天数}天，请尽快完成整改。任务编号：{任务编号}' },
    intercept: { on: true, channels: { sys: true, sms: true, mail: false }, toDoctor: true, toDeptHead: true,
      tpl: '【归档拦截通知】{患者姓名}的病历因{拦截原因}被系统拦截，请及时处理整改。病历类型：{文书类型}' },
  };

  // ---- 文书内容模板 ----
  const tplContent = (type, filled = true, patient = {}) => {
    if (type === '入院记录') return {
      主诉: filled ? '反复胸闷3天，加重伴气促1天' : '',
      现病史: filled ? '患者于3天前无明显诱因出现胸闷，活动后加重，休息可缓解，1天前症状加重伴气促，遂来我院就诊。' : '',
      既往史: '否认高血压、糖尿病史，否认肝炎结核等传染病史。',
      个人史: '生于原籍，无外地久居史，无疫区接触史，无烟酒嗜好。',
      家族史: '否认家族遗传病史及传染病史。',
      体格检查: 'T 36.5℃ P 82次/分 R 18次/分 BP 130/85mmHg，神清，双肺呼吸音清，心律齐。',
      辅助检查: '心电图示窦性心律，胸片未见明显异常。',
      病史陈述者: '患者本人',
      陈述者与患者关系: '本人',
    };
    if (type === '首次病程记录') return {
      病例特点: '老年男性，急性起病，以胸闷气促为主要表现。',
      初步诊断: '冠心病 不稳定型心绞痛？',
      诊疗计划: '完善心肌酶、冠脉CTA，予抗血小板、扩冠治疗，监测生命体征。',
    };
    if (type === '术前讨论记录') return { 讨论意见: filled ? '拟行手术治疗，麻醉方式全麻，已评估手术风险。' : '', 主持人: filled ? '李主任' : '' };
    if (type === '手术记录') return { 手术名称: '冠状动脉造影术', 手术经过: '常规消毒铺巾，穿刺右桡动脉…手术顺利。' };
    if (type === '日常病程记录') return { 记录: '患者诉胸闷较前好转，查体同前，继续目前治疗。' };
    if (type === '出院记录') return {
      入院诊断: '冠状动脉粥样硬化性心脏病',
      出院诊断: '冠状动脉粥样硬化性心脏病 不稳定型心绞痛',
      入院情况: '患者因"反复胸闷3天，加重伴气促1天"入院，查体一般情况可。',
      诊疗经过: '入院后完善相关检查，予抗血小板聚集、调脂、扩冠等对症治疗，患者病情逐渐好转。',
      出院情况: '患者胸闷、气促症状缓解，生命体征平稳。',
      出院小结: '经治疗患者症状缓解，准予出院。',
      出院医嘱: '低盐低脂饮食，规律服药，门诊随访。',
      出院带药: '阿司匹林、阿托伐他汀。',
      随访计划: '出院后2周门诊心内科随访，如有不适随时就诊。',
    };
    if (type === '医嘱') return { 长期医嘱: '低盐低脂饮食；阿司匹林100mg qd', 临时医嘱: '心电图、心肌酶检查' };
    return { 内容: filled ? '已填写内容' : '' };
  };

  // ---- 构造一份病历文书（Composition）----
  let blSeq = 2083;
  const mkDoc = (encId, type, opts = {}) => {
    const created = at(opts.createdAt);
    const rule = TIME_RULES.find(r => r.docType === type && r.active);
    const deadline = opts.deadlineAt ? at(opts.deadlineAt)
      : rule ? new Date(created.getTime() + hours(rule.hours)) : null;
    return {
      resourceType: 'Composition', id: uid('doc'), encounter: encId, type,
      status: opts.status || 'final',                 // preliminary(书写中) / final(完成)
      createdAt: created, deadlineAt: deadline,
      completedAt: opts.completedAt ? at(opts.completedAt) : null,
      content: opts.content || tplContent(type, opts.filled !== false),
      required: opts.required !== false,
    };
  };

  // ---- 构造一次就诊 + 病历 ----
  const buildEncounter = (cfg) => {
    const encId = uid('enc');
    const enc = {
      resourceType: 'Encounter', id: encId, patientName: cfg.name, sex: cfg.sex, age: cfg.age,
      org: cfg.org, doctor: cfg.doctor, bed: cfg.bed, mrn: cfg.mrn, type: cfg.mrn.startsWith('MZ') ? '门诊' : '住院',
      admitAt: cfg.admitAt, blNo: cfg.blNo || null,
      archiveStatus: cfg.archiveStatus || 'none', // none未提交 / archiving归档中 / archived已归档 / intercepted已拦截
      submittedAt: cfg.submittedAt || null, archivedAt: cfg.archivedAt || null,
    };
    const docs = (cfg.docs || []).map(d => mkDoc(encId, d.type, d));
    return { enc, docs };
  };

  // ============================================================
  //  病案首页 / 医嘱 / 体温单 / 护理记录 —— 扩展档案数据生成
  //  （本系统的数据均"同步自EMR系统"，此处按国家标准住院病案首页与
  //   护理文书的常见结构生成确定性演示数据，供病历详情页完整展示）
  // ============================================================
  const NATIONS = ['汉族', '满族', '回族', '壮族', '蒙古族'];
  const MARITALS = ['未婚', '已婚', '离异', '丧偶'];
  const RELATIONS = ['配偶', '子女', '父母', '兄弟姐妹', '本人'];
  const BLOOD = ['A', 'B', 'O', 'AB'];
  const DX_BY_ORG = {
    'org-xn': { name: '冠状动脉粥样硬化性心脏病 不稳定型心绞痛', code: 'I25.103' },
    'org-gk': { name: '股骨颈骨折', code: 'S72.001' },
    'org-pw': { name: '急性阑尾炎', code: 'K35.900' },
    'org-hx': { name: '慢性阻塞性肺疾病急性加重期', code: 'J44.101' },
    'org-sn': { name: '脑梗死', code: 'I63.900' },
  };
  const seedNum = (s) => { let h = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  const nameOf = (id) => (USERS.find(u => u.id === id) || {}).name || '—';

  function extendProfile(e) {
    const h = seedNum(e.mrn || e.id);
    const birthYear = 2026 - (e.age || 50);
    e.birthDate = `${birthYear}-${String(1 + h % 12).padStart(2, '0')}-${String(1 + (h >> 4) % 28).padStart(2, '0')}`;
    e.idNumber = `1101${birthYear}${String(1 + h % 12).padStart(2, '0')}${String(1 + (h >> 4) % 28).padStart(2, '0')}${String(1000 + h % 9000)}`;
    e.nation = NATIONS[h % NATIONS.length];
    e.marital = MARITALS[(h >> 2) % MARITALS.length];
    e.occupation = ['职员', '工人', '农民', '退休', '自由职业'][(h >> 3) % 5];
    e.phone = `1${3 + h % 7}${String(10000000 + (h % 89999999)).slice(0, 8)}`;
    e.regAddr = `${['北京市', '上海市', '广东省', '浙江省', '江苏省'][h % 5]}某某区某某街道${1 + h % 99}号`;
    e.curAddr = e.regAddr;
    e.contactName = ['王建国', '李桂英', '张淑芬', '刘海燕'][h % 4];
    e.contactRelation = RELATIONS[h % RELATIONS.length];
    e.contactPhone = e.phone;
    e.bloodType = BLOOD[h % 4];
    e.rh = (h % 20 === 0) ? '阴性' : '阳性';
    e.allergyHistory = (h % 5 === 0) ? '青霉素过敏' : '否认药物过敏史';
    e.admissionCondition = ['一般', '一般', '急', '重'][h % 4];
    e.ward = `${orgNameSeed(e.org)}病区`;
    const dx = DX_BY_ORG[e.org] || { name: '待明确诊断', code: '—' };
    e.diagnoses = [{ seq: 1, name: dx.name, code: dx.code, admitCondition: '有', outcome: e.archiveStatus === 'archived' ? '好转' : '—' }];
    e.pathology = '';
    e.damagePoison = '';
    e.surgeries = (e.org === 'org-gk' || e.org === 'org-pw') && h % 3 === 0
      ? [{ name: dx.name.includes('骨折') ? '股骨颈骨折内固定术' : '阑尾切除术', date: F_fmtDate(e.admitAt, 2), surgeon: nameOf(e.doctor), anesthetist: '麻醉科医师', anesthesia: '全身麻醉', level: 'Ⅱ级' }]
      : [];
    e.qc = { grade: ['甲', '甲', '乙'][h % 3], scorer: '病案质控科', score: 90 + (h % 10), checkedAt: e.archivedAt || e.admitAt };
    e.signatures = { resident: nameOf(e.doctor), attending: nameOf(e.doctor), chief: '李主任' };
    e.personalHistory = '生于原籍，无外地久居史，无疫区接触史，无烟酒嗜好。';
    e.familyHistory = '否认家族遗传病史及传染病史。';
    e.historian = e.contactName; e.historianRelation = '本人';
    return e;
  }
  function F_fmtDate(iso, addDays = 0) { const d = new Date(iso); d.setDate(d.getDate() + addDays); return fmt(d, false); }

  // 医嘱（长期 / 临时）—— 供 EMR「医嘱」树节点展示具体开立时间、开立人、用法用量
  function mkOrders(e) {
    const base = new Date(e.admitAt);
    const longTerm = [
      { drug: '0.9%氯化钠注射液', usage: '静脉滴注', dose: '250ml', freq: 'qd' },
      { drug: '阿司匹林肠溶片', usage: '口服', dose: '100mg', freq: 'qd' },
      { drug: '阿托伐他汀钙片', usage: '口服', dose: '20mg', freq: 'qn' },
    ];
    const temp = [
      { drug: '心电图检查', usage: '床旁检查', dose: '—', freq: 'st' },
      { drug: '血常规+生化全套', usage: '静脉采血', dose: '—', freq: 'st' },
    ];
    const mk = (arr, kind, offset) => arr.map((o, i) => ({
      id: `${e.id}-ord-${kind}-${i}`, kind, drug: o.drug, usage: o.usage, dose: o.dose, freq: o.freq,
      orderedAt: new Date(base.getTime() + (offset + i + 1) * 1800e3).toISOString(),
      orderedBy: nameOf(e.doctor), status: kind === '长期' ? '执行中' : '已执行',
    }));
    return mk(longTerm, '长期', 0).concat(mk(temp, '临时', 3));
  }

  // 体温单：每日 4/8/12/16/20/24 时点体温脉搏呼吸读数
  function mkVitals(e) {
    const h = seedNum(e.mrn || e.id);
    const base = new Date(e.admitAt); base.setHours(0, 0, 0, 0);
    const days = 4, readings = [];
    for (let d = 0; d < days; d++) {
      [4, 8, 12, 16, 20, 24].forEach((hr, i) => {
        const idx = d * 6 + i;
        const t = Math.round((36.3 + ((h + idx * 7) % 9) / 10 + (d === 0 && i < 2 ? 0.6 : 0)) * 10) / 10;
        const p = 70 + ((h + idx * 5) % 22);
        const r = 18 + ((h + idx * 3) % 4);
        readings.push({ day: d + 1, hour: hr, t, p, r, at: new Date(base.getTime() + d * 86400e3 + hr * 3600e3).toISOString() });
      });
    }
    return readings;
  }
  // 体温单下方出入量表格（按日汇总）
  function mkFluidChart(e) {
    const h = seedNum(e.mrn || e.id);
    const days = 4, rows = [];
    for (let d = 0; d < days; d++) {
      rows.push({ day: d + 1, stool: (h + d) % 3, urine: 1200 + (h + d * 30) % 600, sputum: (h % 3 === 0) ? (10 + d * 2) : 0,
        drain: 0, vomit: 0, intake: 1800 + (h + d * 20) % 500, output: 1500 + (h + d * 25) % 500,
        bp: `${110 + (h + d) % 20}/${70 + (h + d) % 10}`, weight: 60 + (h % 20), postOpDay: d === 0 ? '—' : `${d}` });
    }
    return rows;
  }
  // 护理记录
  function mkNursing(e) {
    const base = new Date(e.admitAt);
    const notes = ['入院评估已完成，Ⅱ级护理，病情观察中。', '协助患者晨间护理，生命体征平稳。', '遵医嘱予以静脉输液，观察无不良反应。', '夜间巡视，患者安睡，未诉不适。'];
    return notes.map((n, i) => ({ at: new Date(base.getTime() + (i + 1) * 6 * 3600e3).toISOString(), level: 'Ⅱ级护理', note: n, nurse: '护士站' }));
  }
  const orgNameSeed = (id) => (ORGS.find(o => o.id === id) || {}).name || '—';

  // ============= 种子数据生成 =============
  function seed() {
    _seq = 1000; blSeq = 2083;
    const encounters = [], documents = [], tasks = [], issues = [], comms = [], provenance = [], audits = [];

    // ---------- 心内科 张医生 活跃面板 ----------
    const A = '2026-06-19T08:00:00'; // 入院基准
    const panels = [
      { name: '张三', sex: '男', age: 56, bed: '12床', mrn: 'ZY2026061901', doctor: 'u-zhang', org: 'org-xn',
        admitAt: '2026-06-18T08:00:00', archiveStatus: 'none',
        docs: [
          { type: '入院记录', createdAt: '2026-06-18T08:00:00', completedAt: null, status: 'preliminary', filled: false }, // 已超时+缺主诉/现病史
          { type: '首次病程记录', createdAt: '2026-06-18T08:00:00', completedAt: '2026-06-18T13:00:00' },
          { type: '术前讨论记录', createdAt: '2026-06-18T09:00:00', completedAt: '2026-06-18T20:00:00' },
          { type: '日常病程记录', createdAt: '2026-06-19T09:00:00', completedAt: '2026-06-19T15:00:00' },
          { type: '医嘱', createdAt: '2026-06-18T08:30:00', completedAt: '2026-06-18T09:00:00' },
        ] },
      { name: '李四', sex: '男', age: 48, bed: '05床', mrn: 'ZY2026061905', doctor: 'u-zhang', org: 'org-xn',
        admitAt: '2026-06-20T03:30:00', archiveStatus: 'none',
        docs: [
          { type: '入院记录', createdAt: '2026-06-20T03:30:00', completedAt: '2026-06-20T06:00:00' },
          { type: '首次病程记录', createdAt: '2026-06-20T03:30:00', completedAt: null, status: 'preliminary' }, // 即将超时(8h, 11:30截止)
          { type: '日常病程记录', createdAt: '2026-06-20T08:00:00', completedAt: '2026-06-20T09:00:00' },
          { type: '医嘱', createdAt: '2026-06-20T04:00:00', completedAt: '2026-06-20T04:30:00' },
        ] },
      { name: '王五', sex: '女', age: 63, bed: '08床', mrn: 'ZY2026061808', doctor: 'u-zhang', org: 'org-xn',
        admitAt: '2026-06-17T10:00:00', archiveStatus: 'archiving', submittedAt: '2026-06-20T09:30:00',
        docs: [
          { type: '入院记录', createdAt: '2026-06-17T10:00:00', completedAt: '2026-06-17T18:00:00' },
          { type: '首次病程记录', createdAt: '2026-06-17T10:00:00', completedAt: '2026-06-17T15:00:00' },
          { type: '日常病程记录', createdAt: '2026-06-18T09:00:00', completedAt: '2026-06-18T14:00:00' },
          { type: '出院记录', createdAt: '2026-06-20T08:00:00', completedAt: '2026-06-20T09:00:00' },
          { type: '医嘱', createdAt: '2026-06-17T10:30:00', completedAt: '2026-06-17T11:00:00' },
        ] },
      { name: '赵六', sex: '男', age: 71, bed: '03床', mrn: 'ZY2026061703', doctor: 'u-zhang', org: 'org-xn',
        admitAt: '2026-06-16T09:00:00', archiveStatus: 'intercepted', submittedAt: '2026-06-19T14:00:00',
        docs: [
          { type: '入院记录', createdAt: '2026-06-16T09:00:00', completedAt: '2026-06-17T15:00:00' }, // 完成但曾超时
          { type: '首次病程记录', createdAt: '2026-06-16T09:00:00', completedAt: '2026-06-16T14:00:00' },
          { type: '出院记录', createdAt: '2026-06-19T08:00:00', completedAt: '2026-06-19T13:00:00', filled: false }, // 终末质控发现签字缺失
          { type: '医嘱', createdAt: '2026-06-16T09:30:00', completedAt: '2026-06-16T10:00:00' },
        ] },
      { name: '钱七', sex: '女', age: 59, bed: '11床', mrn: 'ZY2026061511', doctor: 'u-zhang', org: 'org-xn',
        admitAt: '2026-06-14T10:00:00', archiveStatus: 'archived', submittedAt: '2026-06-18T13:30:00',
        archivedAt: '2026-06-18T14:35:00', blNo: 'BL-2088',
        docs: [
          { type: '入院记录', createdAt: '2026-06-14T10:00:00', completedAt: '2026-06-14T16:00:00' },
          { type: '首次病程记录', createdAt: '2026-06-14T10:00:00', completedAt: '2026-06-14T14:00:00' },
          { type: '出院记录', createdAt: '2026-06-18T08:00:00', completedAt: '2026-06-18T12:00:00' },
          { type: '医嘱', createdAt: '2026-06-14T10:30:00', completedAt: '2026-06-14T11:00:00' },
        ] },
      // 刘医生的患者（心内科，用于统计）
      { name: '周八', sex: '男', age: 45, bed: '15床', mrn: 'ZY2026061815', doctor: 'u-liu', org: 'org-xn',
        admitAt: '2026-06-18T11:00:00', archiveStatus: 'none',
        docs: [
          { type: '入院记录', createdAt: '2026-06-18T11:00:00', completedAt: '2026-06-19T13:00:00' }, // 超时
          { type: '首次病程记录', createdAt: '2026-06-18T11:00:00', completedAt: '2026-06-18T17:00:00' },
          { type: '医嘱', createdAt: '2026-06-18T11:30:00', completedAt: '2026-06-18T12:00:00' },
        ] },
    ];

    panels.forEach(p => {
      const { enc, docs } = buildEncounter(p);
      encounters.push(enc); documents.push(...docs);
    });

    // 取文书引用
    const docOf = (mrn, type) => documents.find(d => {
      const e = encounters.find(x => x.id === d.encounter);
      return e && e.mrn === mrn && d.type === type;
    });
    const encOf = mrn => encounters.find(e => e.mrn === mrn);

    // ---------- 整改任务 + 质控异常 ----------
    const mkIssue = (doc, type, loc, desc, req) => {
      const iss = { resourceType: 'DetectedIssue', id: uid('iss'), doc: doc.id, type, location: loc, desc, requirement: req };
      issues.push(iss); return iss;
    };
    let zgSeq = 40;
    const mkTask = (cfg) => {
      const t = {
        resourceType: 'Task', id: `ZG-00${++zgSeq}`, encounter: cfg.encId, patientName: cfg.patientName,
        doctor: cfg.doctor, org: cfg.org, issue: cfg.issue, source: cfg.source, // 环节质控 / 终末质控
        problemType: cfg.problemType, requirement: cfg.requirement, location: cfg.location,
        status: cfg.status, // 待整改 / 已完成
        dueAt: cfg.dueAt, createdAt: cfg.createdAt, fixedAt: cfg.fixedAt || null,
        reviewPass: cfg.reviewPass ?? null, reviewNote: cfg.reviewNote || '',
        timeline: cfg.timeline || [],
      };
      tasks.push(t); return t;
    };

    // 张三：环节质控 2 项待整改
    const z3enc = encOf('ZY2026061901'), z3doc = docOf('ZY2026061901', '入院记录');
    const z3i1 = mkIssue(z3doc, '内容缺失', '入院记录 > 主诉', '主诉内容为空，需填写患者主要症状及持续时间', '补充主诉内容，要求包含主要症状、持续时间及诱因。参考："反复胸闷3天，加重伴气促1天"');
    const z3i2 = mkIssue(z3doc, '内容不完整', '入院记录 > 现病史', '现病史描述不完整，需补充症状演变过程', '补充症状演变过程。参考："3天前无明显诱因出现胸闷，活动后加重…"');
    mkTask({ encId: z3enc.id, patientName: '张三', doctor: 'u-zhang', org: 'org-xn', issue: z3i1.id, source: '环节质控',
      problemType: '内容缺失', requirement: z3i1.requirement, location: '入院记录 > 主诉', status: '待整改',
      createdAt: '2026-06-18T14:20:00', dueAt: '2026-06-19T18:00:00',
      timeline: [{ at: '2026-06-18T14:20:00', tt: '整改任务下发', by: '系统', note: '入院记录主诉内容为空' },
                 { at: '2026-06-19T18:00:00', tt: 'ZG-0041 截止', by: '系统', note: '仍未提交整改', muted: true }] });
    mkTask({ encId: z3enc.id, patientName: '张三', doctor: 'u-zhang', org: 'org-xn', issue: z3i2.id, source: '环节质控',
      problemType: '内容不完整', requirement: z3i2.requirement, location: '入院记录 > 现病史', status: '待整改',
      createdAt: '2026-06-18T14:20:00', dueAt: '2026-06-19T18:00:00',
      timeline: [{ at: '2026-06-18T14:20:00', tt: '整改任务下发', by: '系统', note: '现病史描述不完整' }] });

    // 赵六：终末质控拦截 1 项待整改
    const z6enc = encOf('ZY2026061703'), z6doc = docOf('ZY2026061703', '出院记录');
    const z6i = mkIssue(z6doc, '签字缺失', '出院记录 > 出院小结', '出院小结医师签字缺失，且出院诊断未填写', '补全出院诊断并完成医师签字');
    mkTask({ encId: z6enc.id, patientName: '赵六', doctor: 'u-zhang', org: 'org-xn', issue: z6i.id, source: '终末质控',
      problemType: '签字缺失', requirement: z6i.requirement, location: '出院记录 > 出院小结', status: '待整改',
      createdAt: '2026-06-19T14:01:00', dueAt: '2026-06-22T18:00:00',
      timeline: [{ at: '2026-06-19T14:00:00', tt: '提交归档申请', by: '张医生' },
                 { at: '2026-06-19T14:00:00', tt: '进入终末质控', by: '系统' },
                 { at: '2026-06-19T14:01:00', tt: '终末质控拦截', by: '系统', note: '出院小结签字缺失' }] });
    // 赵六拦截通知 + provenance（记录拦截前的完整流转；医生整改后重新提交时，
    // Biz.submitArchive 会在此记录基础上继续追加"医生修改病历→提交归档申请→…→归档完成"）
    comms.push({ resourceType: 'Communication', id: uid('com'), category: '归档拦截', to: 'u-zhang',
      subject: encOf('ZY2026061703').patientName, sentAt: '2026-06-19T14:01:00', read: false,
      text: '【归档拦截通知】赵六的病历因出院小结签字缺失被系统拦截，请及时处理整改。病历类型：出院记录' });
    provenance.push({ resourceType: 'Provenance', id: uid('prv'), encounter: z6enc.id, blNo: null,
      events: [
        { at: fmt(z6enc.admitAt), tt: '入院', by: '系统' },
        { at: '2026-06-19T14:00:00', tt: '提交归档申请', by: '张医生' },
        { at: '2026-06-19T14:00:00', tt: '进入终末质控', by: '系统' },
        { at: '2026-06-19T14:01:00', tt: '终末质控拦截', by: '系统', note: '出院小结签字缺失' },
      ] });

    // 李四：1 项已完成整改（历史）
    const l4enc = encOf('ZY2026061905');
    mkTask({ encId: l4enc.id, patientName: '李四', doctor: 'u-zhang', org: 'org-xn', issue: null, source: '环节质控',
      problemType: '内容不完整', requirement: '补充入院记录辅助检查结果', location: '入院记录 > 辅助检查', status: '已完成',
      createdAt: '2026-06-20T05:00:00', dueAt: '2026-06-20T18:00:00', fixedAt: '2026-06-20T07:10:00',
      reviewPass: true, reviewNote: '复核通过，必填项已补全',
      timeline: [{ at: '2026-06-20T05:00:00', tt: '整改任务下发', by: '系统' },
                 { at: '2026-06-20T07:00:00', tt: '提交整改', by: '李四'.replace('李四','张医生') },
                 { at: '2026-06-20T07:10:00', tt: '自动复核通过', by: '系统' }] });

    // ---------- 跨科室整改任务（用于"整改任务追踪/质量概览"全院视图）----------
    const crossPatients = [
      { name: '孙九', org: 'org-gk', doctor: 'u-doc-gk', bed: '05床', mrn: 'ZY2026061205', source: '终末质控', pt: '签字缺失', req: '补全手术记录术者签字', status: '待整改', due: '2026-06-21T18:00:00', created: '2026-06-18T10:00:00', overdue: false },
      { name: '吴十', org: 'org-pw', doctor: 'u-doc-pw', bed: '08床', mrn: 'ZY2026061008', source: '环节质控', pt: '内容缺失', req: '补充术前小结', status: '待整改', due: '2026-06-18T18:00:00', created: '2026-06-15T10:00:00', overdue: true },
      { name: '郑十一', org: 'org-hx', doctor: 'u-doc-hx', bed: '03床', mrn: 'ZY2026060803', source: '环节质控', pt: '格式不规范', req: '调整病程记录格式', status: '已完成', due: '2026-06-12T18:00:00', created: '2026-06-10T10:00:00', fixed: '2026-06-11T09:00:00' },
      { name: '冯十二', org: 'org-sn', doctor: 'u-doc-sn', bed: '06床', mrn: 'ZY2026060706', source: '终末质控', pt: '内容不完整', req: '补充神经系统查体', status: '待整改', due: '2026-06-17T18:00:00', created: '2026-06-14T10:00:00', overdue: true },
      { name: '陈十三', org: 'org-gk', doctor: 'u-doc-gk', bed: '09床', mrn: 'ZY2026061309', source: '环节质控', pt: '内容缺失', req: '补充既往史', status: '已完成', due: '2026-06-14T18:00:00', created: '2026-06-12T10:00:00', fixed: '2026-06-13T11:00:00' },
    ];
    crossPatients.forEach(cp => {
      const encId = uid('enc');
      encounters.push({ resourceType: 'Encounter', id: encId, patientName: cp.name, sex: '男', age: 60, org: cp.org,
        doctor: cp.doctor, bed: cp.bed, mrn: cp.mrn, type: '住院', admitAt: cp.created, archiveStatus: cp.source === '终末质控' ? 'intercepted' : 'none' });
      mkTask({ encId, patientName: cp.name, doctor: cp.doctor, org: cp.org, issue: null, source: cp.source,
        problemType: cp.pt, requirement: cp.req, location: '—', status: cp.status,
        createdAt: cp.created, dueAt: cp.due, fixedAt: cp.fixed || null, reviewPass: cp.status === '已完成' ? true : null,
        timeline: [{ at: cp.created, tt: '整改任务下发', by: '系统' }].concat(cp.fixed ? [{ at: cp.fixed, tt: '自动复核通过', by: '系统' }] : []) });
    });

    // ---------- 已归档历史病历（病案室 / 统计）----------
    const archivedHist = [
      { bl: 'BL-2087', name: '李四', org: 'org-gk', doctor: 'u-doc-gk', mrn: 'ZY2026060905', at: '2026-06-11T10:25:00' },
      { bl: 'BL-2086', name: '王五', org: 'org-pw', doctor: 'u-doc-pw', mrn: 'ZY2026060803', at: '2026-06-10T16:45:00' },
      { bl: 'BL-2085', name: '赵六', org: 'org-hx', doctor: 'u-doc-hx', mrn: 'MZ2026060802', at: '2026-06-10T14:15:00' },
      { bl: 'BL-2084', name: '钱七', org: 'org-sn', doctor: 'u-doc-sn', mrn: 'ZY2026060708', at: '2026-06-09T11:20:00' },
      { bl: 'BL-2083', name: '杨十四', org: 'org-xn', doctor: 'u-liu', mrn: 'ZY2026060512', at: '2026-06-08T09:40:00' },
    ];
    archivedHist.forEach(h => {
      const encId = uid('enc');
      encounters.push({ resourceType: 'Encounter', id: encId, patientName: h.name, sex: '男', age: 55, org: h.org,
        doctor: h.doctor, bed: '—', mrn: h.mrn, type: h.mrn.startsWith('MZ') ? '门诊' : '住院', admitAt: '2026-06-07T08:00:00',
        archiveStatus: 'archived', blNo: h.bl, submittedAt: h.at, archivedAt: h.at });
      ['入院记录', '首次病程记录', '出院记录', '医嘱'].forEach(t => {
        documents.push(mkDoc(encId, t, { createdAt: '2026-06-07T08:00:00', completedAt: '2026-06-07T12:00:00' }));
      });
    });

    // ============= 统计背景人群（逼真数据量，驱动全院/科室统计与归档检索）=============
    const SUR = '王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧'.split('');
    const GIV = ['伟', '芳', '娜', '秀英', '敏', '静', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀兰', '霞', '建国', '桂英', '志强', '丽华', '海燕', '建华', '玉兰', '国强', '淑芬'];
    const REQ_BY_TYPE = {
      '内容缺失': { req: '补充缺失的必填项内容（主诉/现病史等）', loc: '入院记录 > 主诉' },
      '格式不规范': { req: '按病历书写规范调整记录格式与项目顺序', loc: '病程记录 > 格式' },
      '内容不完整': { req: '补充完整的症状演变、查体或诊疗描述', loc: '入院记录 > 现病史' },
      '时限超时': { req: '注意书写时限，按时完成各类文书书写', loc: '首次病程记录' },
      '签字缺失': { req: '补全相应医师签字及上级审核签名', loc: '出院记录 > 出院小结' },
    };
    const T_KEYS = Object.keys(REQ_BY_TYPE);
    let popSeq = 0, popTask = 0, popBl = 1100;
    const DEPT_POP = [
      { org: 'org-hx', doctor: 'u-doc-hx', n: 9,  lateRate: 0.05, issues: 3,  fixRate: 1.00, overdue: 0, archRatio: 0.7 },
      { org: 'org-gk', doctor: 'u-doc-gk', n: 11, lateRate: 0.08, issues: 5,  fixRate: 0.88, overdue: 1, archRatio: 0.7 },
      { org: 'org-xn', doctor: 'u-liu',    n: 9,  lateRate: 0.13, issues: 6,  fixRate: 0.80, overdue: 1, archRatio: 0.6 },
      { org: 'org-pw', doctor: 'u-doc-pw', n: 11, lateRate: 0.18, issues: 10, fixRate: 0.75, overdue: 3, archRatio: 0.6 },
      { org: 'org-sn', doctor: 'u-doc-sn', n: 10, lateRate: 0.22, issues: 12, fixRate: 0.70, overdue: 4, archRatio: 0.5 },
    ];
    DEPT_POP.forEach(cfg => {
      const encs = [], counted = [];
      for (let i = 0; i < cfg.n; i++) {
        const gi = ++popSeq;
        const name = SUR[gi % SUR.length] + GIV[(gi * 7) % GIV.length];
        const admit = new Date(2026, 4, 20 + (gi % 28), 8 + (gi % 6), 0, 0); // 5月下旬~6月
        const mrn = `ZY202606${1000 + gi}`;
        const archived = i < Math.round(cfg.n * cfg.archRatio);
        const encId = uid('enc');
        let archivedAt = null;
        if (archived) {
          const d = i < 2 ? new Date('2026-06-20T' + ['09:20:00', '11:05:00'][i]) : new Date(2026, 5, Math.min(19, 5 + i), 10 + (i % 6), 15);
          archivedAt = d.toISOString();
        }
        const e = { resourceType: 'Encounter', id: encId, patientName: name, sex: gi % 2 ? '男' : '女', age: 38 + (gi % 46),
          org: cfg.org, doctor: cfg.doctor, bed: `${(gi % 38) + 1}床`, mrn, type: '住院', admitAt: admit.toISOString(),
          archiveStatus: archived ? 'archived' : 'none', blNo: archived ? `BL-${++popBl}` : null,
          submittedAt: archived ? new Date(admit.getTime() + 4 * 86400e3).toISOString() : null, archivedAt };
        encounters.push(e); encs.push(e);
        const dtypes = archived ? ['入院记录', '首次病程记录', '日常病程记录', '出院记录', '医嘱'] : ['入院记录', '首次病程记录', '日常病程记录', '医嘱'];
        dtypes.forEach(t => {
          const created = admit.toISOString();
          const compl = new Date(admit.getTime() + (t === '首次病程记录' ? 4 : 10) * 3600e3).toISOString();
          const d = mkDoc(encId, t, { createdAt: created, completedAt: compl });
          documents.push(d); if (d.deadlineAt) counted.push(d);
        });
      }
      // 控制及时率：将一部分已完成文书标记为超时完成
      const lateN = Math.round(counted.length * cfg.lateRate);
      const used = new Set();
      for (let j = 0; j < lateN; j++) { const idx = Math.round(j * counted.length / Math.max(1, lateN)) % counted.length; if (used.has(idx)) continue; used.add(idx); const d = counted[idx]; d.completedAt = new Date(d.deadlineAt.getTime() + (2 + (j % 6)) * 3600e3); }
      // 整改任务：控制完成率/超时数/异常类型分布
      // 仅从"未归档"病历中挑选（已归档 = 终末质控已通过，不应再挂有待处理的整改任务，
      // 否则会出现"病案室看到已归档、临床医生看到该病历仍超时未整改"的矛盾，见一致性校验）
      const actEncs = encs.filter(e => e.archiveStatus !== 'archived');
      const doneN = Math.round(cfg.issues * cfg.fixRate);
      // 内容类问题（内容缺失/内容不完整）须与病历文书的实际内容保持一致：
      // 任务声称"待整改"时，对应字段在文书里必须真的是空/不完整，
      // 避免"任务提示缺失但实际已填写且判定合规"的前后矛盾
      const CONTENT_DEFECT = {
        '内容缺失': { docType: '入院记录', field: '主诉' },
        '内容不完整': { docType: '入院记录', field: '现病史' },
      };
      for (let j = 0; j < cfg.issues && actEncs.length; j++) {
        const e = actEncs[j % actEncs.length];
        const pt = T_KEYS[j % T_KEYS.length];
        const isDone = j < doneN;
        const isOver = !isDone && (j - doneN) < cfg.overdue;
        const src = j % 3 === 0 ? '终末质控' : '环节质控';
        if (!isDone && src === '终末质控') e.archiveStatus = 'intercepted';
        const created = new Date(NOW.getTime() - (3 + (j % 5)) * 86400e3);
        const due = isOver ? new Date(NOW.getTime() - (1 + j % 3) * 86400e3) : new Date(NOW.getTime() + (2 + j % 4) * 86400e3);
        const fixed = isDone ? new Date(created.getTime() + 86400e3) : null;
        if (!isDone) {
          const defect = CONTENT_DEFECT[pt];
          if (defect) {
            const targetDoc = documents.find(d => d.encounter === e.id && d.type === defect.docType);
            if (targetDoc) targetDoc.content[defect.field] = '';
          }
        }
        tasks.push({ resourceType: 'Task', id: `ZG-${2000 + (++popTask)}`, encounter: e.id, patientName: e.patientName,
          doctor: cfg.doctor, org: cfg.org, issue: null, source: src, problemType: pt,
          requirement: REQ_BY_TYPE[pt].req, location: REQ_BY_TYPE[pt].loc, status: isDone ? '已完成' : '待整改',
          createdAt: created.toISOString(), dueAt: due.toISOString(), fixedAt: fixed ? fixed.toISOString() : null,
          reviewPass: isDone ? true : null, reviewNote: isDone ? '系统自动复核通过，问题已整改' : '',
          timeline: [{ at: created.toISOString(), tt: '整改任务下发', by: '系统', note: REQ_BY_TYPE[pt].req }]
            .concat(fixed ? [{ at: fixed.toISOString(), tt: '提交整改', by: (USERS.find(u => u.id === cfg.doctor) || {}).name || '医生' }, { at: fixed.toISOString(), tt: '自动复核通过', by: '系统' }] : []) });
      }
    });

    // ---------- 流转记录 Provenance（钱七已归档样例）----------
    const q7 = encOf('ZY2026061511');
    provenance.push({ resourceType: 'Provenance', id: uid('prv'), encounter: q7.id, blNo: 'BL-2088',
      events: [
        { at: '2026-06-14T10:00:00', tt: '入院', by: '系统' },
        { at: '2026-06-14T14:00:00', tt: '首次病程记录完成', by: '张医生' },
        { at: '2026-06-18T08:00:00', tt: '出院记录完成', by: '张医生' },
        { at: '2026-06-18T13:30:00', tt: '提交归档申请', by: '张医生' },
        { at: '2026-06-18T13:30:00', tt: '进入终末质控', by: '系统' },
        { at: '2026-06-18T13:31:00', tt: '终末质控通过', by: '系统' },
        { at: '2026-06-18T14:35:00', tt: '归档完成（已同步至病历归档系统）', by: '系统' },
      ] });

    // ---------- 通知 / 预警 Communication ----------
    comms.push(
      { resourceType: 'Communication', id: uid('com'), category: '超时预警', to: 'u-zhang', subject: '张三', sentAt: '2026-06-19T08:15:00', read: false,
        text: '【书写时限预警】张三的入院记录已超时，请及时完成书写。' },
      { resourceType: 'Communication', id: uid('com'), category: '整改通知', to: 'u-zhang', subject: '张三', sentAt: '2026-06-18T14:20:00', read: false,
        text: '术前讨论记录需补充讨论意见，请及时整改。' },
      { resourceType: 'Communication', id: uid('com'), category: '超时预警', to: 'u-zhang', subject: '李四', sentAt: '2026-06-20T10:30:00', read: false,
        text: '【书写时限预警】李四的首次病程记录将于约1.5小时后超时。' },
    );

    // ---------- 审计 AuditEvent ----------
    audits.push(
      { resourceType: 'AuditEvent', id: uid('aud'), area: '时限配置', at: '2026-06-10T14:30:00', by: '钱管理', op: '修改', content: '修改「入院记录」时限：24小时' },
      { resourceType: 'AuditEvent', id: uid('aud'), area: '时限配置', at: '2026-06-10T14:30:00', by: '钱管理', op: '新增', content: '新增「首次病程记录」时限：8小时' },
      { resourceType: 'AuditEvent', id: uid('aud'), area: '时限配置', at: '2026-06-08T10:15:00', by: '钱管理', op: '修改', content: '修改「术前讨论记录」生效范围：全院→骨科、普外科' },
      { resourceType: 'AuditEvent', id: uid('aud'), area: '时限配置', at: '2026-05-20T09:00:00', by: '钱管理', op: '停用', content: '停用「出院记录」时限规则' },
      { resourceType: 'AuditEvent', id: uid('aud'), area: '权限', at: '2026-06-11T15:30:00', by: 'admin', op: '权限修改', content: '修改张医生角色：临床医生→科室负责人' },
      { resourceType: 'AuditEvent', id: uid('aud'), area: '模板', at: '2026-06-10T14:00:00', by: 'admin', op: '模板修改', content: '修改科室负责人模板：新增书写及时率统计访问权限' },
      { resourceType: 'AuditEvent', id: uid('aud'), area: '权限', at: '2026-06-08T09:30:00', by: 'admin', op: '权限修改', content: '停用孙医生账号' },
      { resourceType: 'AuditEvent', id: uid('aud'), area: '模板', at: '2026-06-05T10:00:00', by: 'admin', op: '模板修改', content: '修改病案室模板：数据范围调整为全院' },
    );

    // ---------- 扩展档案数据：病案首页字段 / 医嘱明细 / 体温单 / 护理记录 ----------
    encounters.forEach(e => {
      extendProfile(e);
      e.orders = mkOrders(e);
      e.vitals = mkVitals(e);
      e.fluidChart = mkFluidChart(e);
      e.nursing = mkNursing(e);
    });

    // ---------- 归档流转记录兜底：确保每份"归档中/已拦截/已归档"病历都有 Provenance ----------
    // （避免归档详情页在无流转记录时臨时拼凑，导致展示的流转链路与实际状态不一致）
    const provByEnc = new Set(provenance.map(p => p.encounter));
    encounters.forEach(e => {
      if (provByEnc.has(e.id) || !['archiving', 'intercepted', 'archived'].includes(e.archiveStatus)) return;
      if (!e.submittedAt) e.submittedAt = new Date(new Date(e.admitAt).getTime() + 3 * 86400e3).toISOString();
      const events = [{ at: fmt(e.admitAt), tt: '入院', by: '系统' }];
      if (e.submittedAt) {
        events.push({ at: fmt(e.submittedAt), tt: '提交归档申请', by: nameOf(e.doctor) });
        events.push({ at: fmt(e.submittedAt), tt: '进入终末质控', by: '系统' });
      }
      if (e.archiveStatus === 'intercepted') {
        const t = tasks.find(x => x.encounter === e.id && x.source === '终末质控');
        events.push({ at: fmt(e.submittedAt), tt: '终末质控拦截', by: '系统', note: (t && t.requirement) || '终末质控发现问题' });
      } else if (e.archiveStatus === 'archived') {
        events.push({ at: fmt(e.submittedAt), tt: '终末质控通过', by: '系统' });
        events.push({ at: fmt(e.archivedAt), tt: '归档完成（已同步至病历归档系统）', by: '系统' });
      }
      provenance.push({ resourceType: 'Provenance', id: uid('prv'), encounter: e.id, blNo: e.blNo || null, events });
    });

    // ---------- 数据一致性校验：已归档病历不应再挂有未完成的整改任务 ----------
    // （病案室看到"已归档"、临床医生却在整改任务处理里看到该病历仍"待整改/已超时"，
    //  是明显的前后矛盾；已归档 = 终末质控已通过，其下任务理应全部为"已完成"）
    const archivedEncIds = new Set(encounters.filter(e => e.archiveStatus === 'archived').map(e => e.id));
    tasks.forEach(t => {
      if (t.status !== '已完成' && archivedEncIds.has(t.encounter)) {
        t.status = '已完成'; t.reviewPass = true;
        t.fixedAt = t.fixedAt || NOW.toISOString();
        t.reviewNote = t.reviewNote || '系统自动复核通过，问题已整改';
        t.timeline = (t.timeline || []).concat([{ at: NOW.toISOString(), tt: '自动复核通过', by: '系统' }]);
      }
    });

    return {
      meta: { seededAt: NOW.toISOString() },
      Organization: ORGS, Practitioner: USERS,
      Encounter: encounters, Composition: documents, Task: tasks, DetectedIssue: issues,
      Communication: comms, Provenance: provenance, AuditEvent: audits,
      ActivityDefinition: JSON.parse(JSON.stringify(TIME_RULES)),
      PlanDefinition: JSON.parse(JSON.stringify(QC_RULES)),
      qcVersions: JSON.parse(JSON.stringify(QC_VERSIONS)),
      notifyCfg: JSON.parse(JSON.stringify(NOTIFY_CFG)),
    };
  }

  // ============= 存储 / 持久化 =============
  let DB = null;
  const revive = (obj) => { // 将日期字符串恢复为 Date
    DB = obj;
    DB.Encounter.forEach(e => { ['admitAt','submittedAt','archivedAt'].forEach(k => e[k] = e[k] ? new Date(e[k]) : null); });
    DB.Composition.forEach(d => { ['createdAt','deadlineAt','completedAt'].forEach(k => d[k] = d[k] ? new Date(d[k]) : null); });
  };
  function load() {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { try { revive(JSON.parse(raw)); return; } catch (e) {} }
    DB = seed(); save();
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch (e) {} }
  function reset() { localStorage.removeItem(LS_KEY); DB = seed(); save(); }

  load();

  // ============= 通用访问 API =============
  const col = t => DB[t] || [];
  const byId = (t, id) => col(t).find(x => x.id === id);
  const orgName = id => (byId('Organization', id) || {}).name || '—';
  const user = id => byId('Practitioner', id);
  const userName = id => (user(id) || {}).name || '—';

  return {
    NOW: () => NOW, ROLES, DOC_TYPES,
    db: () => DB, save, reset, col, byId, orgName, user, userName, fmt, mdhm, uid,
    rawSeed: seed,
  };
})();
window.FHIR = FHIR;
