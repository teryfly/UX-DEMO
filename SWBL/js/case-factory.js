/* =====================================================================
 * case-factory.js —— 死亡病例与全流程工件工厂
 * ---------------------------------------------------------------------
 * 输入一份「病例剧本」plan，产出一例死亡病例在 FHIR 上的全部事实：
 *   Patient → Encounter → Condition/Observation/Procedure → DocumentReference
 *   → Task(讨论) → Appointment → QuestionnaireResponse(讨论记录) → Composition(签名归档)
 *   → Task(上报) → QuestionnaireResponse(上报单) + 三级审核链
 *   → Task(改进) + 执行记录 + 完成报告 + Observation(效果评估) + PDCA 轮次
 *   → Communication(通知) + Provenance(留痕)
 *
 * 死亡类型一律由 Classify（基础数据管理中的规则表）按业务事实推导，
 * 时限一律由 Limit（时限规则配置）推导，工厂不写死任何天数与阈值。
 * 「实际完成时间」是时效与达标统计的唯一事实来源：
 *   讨论 → Task.executionPeriod.end（与 Appointment 同步）
 *   上报 → Task.completedDate
 *   改进 → Task.completedDate
 * ===================================================================== */
(function (global) {
  'use strict';

  var F = global.FHIR, S = global.Seed, D = global.Domain, Limit = global.Limit, V = global.Vocab, Flow = global.Flow;
  var DAY = S.day, HOUR = S.hour, MIN = S.min;
  var R = S.R, pick = S.pick, int = S.int;

  function R_(type, id, display) { return { reference: type + '/' + id, display: display }; }
  function NOW_REF() { return S.T0; }
  function b64(text) {
    var g = (typeof window !== 'undefined' ? window : global);
    if (g.btoa) return g.btoa(unescape(encodeURIComponent(text)));
    return Buffer.from(text, 'utf8').toString('base64');
  }
  function fmtDay(ms) { var d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function codingOf(kind, code) { return { system: V.SYS + kind, code: code, display: code }; }
  function sceneName(code) { return D.sceneName(code); }

  /* ───── 人员索引 ───── */
  var STAFF = { quality: [] };
  function buildStaff() {
    F.scan('PractitionerRole').forEach(function (raw) {
      var r = F.decode(raw);
      var org = r.organization && r.organization.reference ? r.organization.reference.split('/')[1] : null;
      var idx = org ? parseInt(org.split('-')[1], 10) : 0;
      var scene = (r.ext.scenes || [])[0];
      var orgName = r.organization ? r.organization.display : '';
      var item = { pid: r.practitioner.reference.split('/')[1], name: r.practitioner.display, role: r.id, deptIdx: idx, deptName: orgName };
      var isQuality = (r.ext.dataScope === 'hospital');
      if (isQuality) { if (scene === 'quality') STAFF.quality.push(item); return; }
      STAFF[idx] = STAFF[idx] || { attending: [], senior: [], director: [], doctor: [] };
      if (STAFF[idx][scene]) STAFF[idx][scene].push(item);
    });
  }
  function staff(deptIdx, scene, n) {
    var list = (STAFF[deptIdx] || {})[scene] || [];
    if (!list.length) list = STAFF[1] ? STAFF[1][scene] : [];
    if (!list.length) return { pid: 'Practitioner-0011', name: '李海峰', role: 'PractitionerRole-0011', deptIdx: 1, deptName: '心血管内科' };
    return list[Math.abs(n || 0) % list.length];
  }
  function qualityStaff() { return STAFF.quality[0] || { pid: 'Practitioner-0151', name: '刘文华', role: 'PractitionerRole-0151' }; }

  /* ───── ICD 与科室亲和度 ───── */
  var ICD = V.icdFlat();
  var DEPT_ICD = {
    1: ['循环系统疾病', '脑血管疾病', '症状和体征'],
    2: ['呼吸系统疾病', '感染性与寄生虫疾病', '循环系统疾病'],
    3: ['消化系统疾病', '恶性肿瘤', '感染性与寄生虫疾病'],
    4: ['脑血管疾病', '神经系统疾病', '精神行为障碍'],
    5: ['脑血管疾病', '损伤与中毒', '手术、治疗与麻醉并发症'],
    6: ['消化系统疾病', '损伤与中毒', '手术、治疗与麻醉并发症'],
    7: ['损伤与中毒', '肌肉骨骼结缔组织疾病', '手术、治疗与麻醉并发症'],
    8: ['泌尿生殖系统疾病', '感染性与寄生虫疾病', '手术、治疗与麻醉并发症'],
    9: ['恶性肿瘤', '感染性与寄生虫疾病', '血液免疫系统疾病'],
    10: ['感染性与寄生虫疾病', '循环系统疾病', '内分泌营养代谢疾病'],
    11: ['损伤与中毒', '循环系统疾病', '症状和体征'],
    12: ['血液免疫系统疾病', '感染性与寄生虫疾病', '恶性肿瘤']
  };
  function pickIcd(deptIdx) {
    var cats = DEPT_ICD[deptIdx] || ['循环系统疾病'];
    var pool = ICD.filter(function (i) { return cats.indexOf(i.cat) >= 0; });
    if (!pool.length) pool = ICD;
    var total = pool.reduce(function (a, b) { return a + b.weight; }, 0);
    var x = R() * total, acc = 0;
    for (var i = 0; i < pool.length; i++) { acc += pool[i].weight; if (x <= acc) return pool[i]; }
    return pool[pool.length - 1];
  }
  function icdByCode(code) {
    for (var i = 0; i < ICD.length; i++) if (ICD[i].code === code) return ICD[i];
    return ICD[0];
  }

  var SURN = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘蒋蔡'.split('');
  var GIVENS = ['秀兰', '建国', '国华', '桂香', '志明', '玉梅', '德福', '淑芬', '振国', '丽华', '文斌', '凤英', '海涛', '雅琴', '长庚', '宝珍', '连生', '桂兰', '崇文', '茂林'];
  function patientName() { return pick(SURN) + pick(GIVENS); }
  function chance(p) { return R() < p; }
  function weighted(map) {
    var ks = Object.keys(map), total = 0;
    ks.forEach(function (k) { total += map[k]; });
    var x = R() * total;
    for (var i = 0; i < ks.length; i++) { x -= map[ks[i]]; if (x <= 0) return ks[i]; }
    return ks[ks.length - 1];
  }

  var SEQ = { n: 0 };

  /* 实际完成时间：onTime 时落在时限内，否则超时 */
  function actualMs(kind, ctx, onTime) {
    var total = Limit.totalMsOf(kind, ctx) || 3 * DAY;
    return ctx.deathMs + (onTime ? total * (0.15 + 0.7 * R()) : total * (1.08 + 0.55 * R()));
  }

  /* ═════════════ 工厂主入口 ═════════════ */
  function make(plan) {
    SEQ.n++;
    var deptIdx = plan.deptIdx;
    var org = F.view('Organization', 'Organization-' + String(deptIdx).padStart(4, '0'));
    var deptName = org ? org.name : '未知科室';
    var deathMs = plan.deathMs;
    var mode = plan.mode || 'stub';
    var icd = plan.icd ? icdByCode(plan.icd) : pickIcd(deptIdx);
    var p = plan.patient || {};
    var age = p.age != null ? p.age : (icd.cat === '围产期疾病' ? 0 : icd.cat === '恶性肿瘤' ? int(48, 84) : int(41, 93));
    var losHours = plan.losHours != null ? plan.losHours : weighted({ short: 18, mid: 30, long: 52 });
    if (typeof losHours === 'string') losHours = losHours === 'short' ? int(4, 46) : (losHours === 'mid' ? int(48, 168) : int(169, 960));
    var admitMs = deathMs - losHours * HOUR;
    var gender = p.gender || (chance(0.54) ? 'male' : 'female');
    var name = p.name || patientName();
    var mrn = plan.mrn || ('20' + String(new Date(admitMs).getFullYear()).slice(2) + String(100000 + SEQ.n * 37 + int(0, 30)).slice(-6));

    var attending = plan.attending ? resolveByName(plan.attending, deptIdx) : staff(deptIdx, 'attending', int(0, 2));
    var senior = plan.senior ? resolveByName(plan.senior, deptIdx) : staff(deptIdx, 'senior', int(0, 1));
    var director = plan.director ? resolveByName(plan.director, deptIdx) : staff(deptIdx, 'director', 0);
    var qm = qualityStaff();

    /* —— 业务事实 → 分类规则引擎 —— */
    var hasSurgery = plan.hasSurgery != null ? plan.hasSurgery : chance(deptIdx >= 4 && deptIdx <= 8 ? 0.42 : 0.12);
    var daysSinceSurgery = hasSurgery ? (plan.daysSinceSurgery != null ? plan.daysSinceSurgery : weighted({ d0_30: 55, d30p: 45 })) : null;
    if (typeof daysSinceSurgery === 'string') daysSinceSurgery = daysSinceSurgery === 'd0_30' ? int(0, 30) : int(31, 120);
    var facts = {
      age: age, losHours: losHours, daysSinceSurgery: daysSinceSurgery,
      deathDx: icd.name, icdCat: icd.cat,
      terminal: terminalChance(icd.cat),
      suddenDeath: chance(0.14), rescueFailed: chance(0.24),
      hasDispute: chance(0.035), signedWaiver: icd.cat === '恶性肿瘤' && chance(0.3)
    };
    // 特殊死亡：麻醉意外 / 输血反应 / 药物过敏 通过死亡诊断文本命中规则（约 8%）
    if (plan.facts && plan.facts.forceSpecial) {
      facts.deathDx = pick(['麻醉意外', '输血反应致溶血反应', '药物过敏致过敏性休克']);
      facts.icdCat = '手术、治疗与麻醉并发症';
    } else if (!plan.facts && chance(0.08) && deptIdx >= 4 && deptIdx <= 8) {
      facts.deathDx = pick(['麻醉意外', '输血反应', '药物过敏致过敏性休克']);
    }
    if (plan.facts) Object.keys(plan.facts).forEach(function (k) { facts[k] = plan.facts[k]; });
    var cls = global.Classify.deathTypeOf(facts);
    var deathType = cls.deathType;
    var priority = plan.priority || global.Classify.priorityOf(deathType, facts);

    var ctx = {
      seq: SEQ.n, deptIdx: deptIdx, deptName: deptName, mode: mode,
      name: name, gender: gender, age: age, mrn: mrn, admitMs: admitMs, deathMs: deathMs,
      attending: attending, senior: senior, director: director, quality: qm,
      icd: icd, facts: facts, concordance: plan.concordance || weighted({ match: 62, partly: 26, unmatch: 12 }),
      severity: severityOf(facts), hasSurgery: hasSurgery, daysSinceSurgery: daysSinceSurgery,
      deathType: deathType, priority: priority, classifyRule: cls.rule, plan: plan
    };

    patient(ctx);
    encounter(ctx);
    conditions(ctx);
    concordanceObs(ctx);
    if (hasSurgery) procedureRes(ctx);
    if (mode === 'full') { labs(ctx); }

    discussTask(ctx);
    reportTask(ctx);

    if (mode === 'full') {
      documents(ctx);
      var st = (plan.discuss && plan.discuss.state) || 'to-organize';
      if (st === 'booked' || st === 'draft' || st === 'to-sign' || st === 'archived') meeting(ctx);
      if (st === 'draft' || st === 'to-sign' || st === 'archived') record(ctx);
      if (st === 'to-sign') partialSign(ctx);
      if (st === 'archived') archive(ctx);
      else if (st !== 'to-organize' && st !== 'booked') { /* draft：仅记录，无签名 */ }
      reportForm(ctx);
    } else {
      stubClose(ctx);
    }
    notifications(ctx);
    if (plan.showcase) provenanceShowcase(ctx, plan);
    return ctx;
  }

  function terminalChance(cat) {
    if (cat === '恶性肿瘤') return chance(0.88);
    if (cat === '损伤与中毒' || cat === '手术、治疗与麻醉并发症' || cat === '妊娠分娩产褥期并发症' || cat === '围产期疾病') return chance(0.06);
    if (cat === '精神行为障碍' || cat === '先天畸形') return chance(0.25);
    return chance(0.55);
  }
  function severityOf(f) {
    if (f.rescueFailed || f.suddenDeath || f.hasDispute) return 'critical';
    if (f.terminal) return 'severe';
    return weighted({ mild: 12, moderate: 30, severe: 40, critical: 18 });
  }
  function severityScore(s) { return { mild: 2, moderate: 9, severe: 17, critical: 24 }[s] + int(0, 5); }
  function resolveByName(name, deptIdx) {
    var g = STAFF[deptIdx] || {};
    var all = [].concat(g.attending || [], g.senior || [], g.director || [], g.doctor || []);
    for (var i = 0; i < all.length; i++) if (all[i].name === name) return all[i];
    return staff(deptIdx, 'attending', 0);
  }

  /* —— 1. Patient —— */
  function patient(ctx) {
    var y = new Date(ctx.deathMs).getFullYear() - ctx.age;
    ctx.pid = F.seed({
      resourceType: 'Patient',
      identifier: [{ system: 'urn:swbl:mrn', value: ctx.mrn }],
      name: [{ text: ctx.name }], gender: ctx.gender,
      birthDate: Math.max(1900, y) + '-' + String(int(1, 12)).padStart(2, '0') + '-' + String(int(1, 28)).padStart(2, '0'),
      deceasedDateTime: new Date(ctx.deathMs).toISOString(),
      active: true,
      telecom: [{ system: 'phone', value: '137****' + String(1000 + int(0, 8999)) }],
      ext: { mrn: ctx.mrn, ageYears: ctx.age, bedNo: 'W' + ctx.deptIdx + '-' + int(1, 58), signedWaiver: !!ctx.facts.signedWaiver }
    }).id;
  }

  /* —— 2. Encounter —— */
  function encounter(ctx) {
    ctx.encId = F.seed({
      resourceType: 'Encounter', status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP', display: '住院' },
      type: [{ text: '死亡病例住院就诊' }],
      subject: R_('Patient', ctx.pid, ctx.name),
      serviceProvider: R_('Organization', 'Organization-' + String(ctx.deptIdx).padStart(4, '0'), ctx.deptName),
      participant: [{
        type: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType', code: 'ATND', display: '主管医师' }] }],
        individual: R_('Practitioner', ctx.attending.pid, ctx.attending.name)
      }],
      period: { start: new Date(ctx.admitMs).toISOString(), end: new Date(ctx.deathMs).toISOString() },
      hospitalization: { dischargeDisposition: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/discharge-disposition', code: 'expired', display: '死亡' }], text: '死亡' } },
      ext: {
        deathType: ctx.deathType, caseNo: ctx.mrn, attendingName: ctx.attending.name,
        autoClassified: !!ctx.classifyRule, classifyRuleId: ctx.classifyRule ? ctx.classifyRule.id : 'MANUAL',
        deathPlace: weighted({ 病房: 46, ICU: 30, 急诊抢救室: 16, 手术室: 8 }),
        losDays: Math.max(1, Math.round((ctx.deathMs - ctx.admitMs) / DAY))
      }
    }).id;
  }

  /* —— 3. 诊断 / 符合性 / 严重程度 —— */
  function cond(ctx, cat, text, code, severity, isPrimary) {
    return F.seed({
      resourceType: 'Condition',
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active', display: '活动' }] },
      verificationStatus: { coding: [{ code: 'confirmed', display: '已确认' }] },
      category: [{ coding: [codingOf('condition-category', cat)], text: V.cc('condition-category', cat).text }],
      severity: { coding: [codingOf('severity', severity)], text: D.severityName(severity) },
      code: { coding: [{ system: 'https://fhir.swbl-demo.example/CodeSystem/icd10-death', code: code, display: text }], text: text },
      subject: R_('Patient', ctx.pid, ctx.name), encounter: R_('Encounter', ctx.encId),
      recordedDate: new Date(ctx.deathMs).toISOString(),
      ext: { catCode: cat, isPrimary: !!isPrimary }
    }).id;
  }
  function conditions(ctx) {
    ctx.admitConditionId = cond(ctx, 'admission', ctx.icd.name + '（' + ctx.icd.code + '）', ctx.icd.code, ctx.severity, true);
    ctx.deathConditionId = cond(ctx, 'death-main', mainDeathDx(ctx), ctx.icd.code, ctx.severity, true);
    if (chance(0.7)) cond(ctx, 'death-secondary', pick(['呼吸循环衰竭', '多器官功能障碍综合征', '感染性休克', '心力衰竭', '意识障碍', '低氧血症']), 'R09.2', 'severe');
    if (chance(0.8)) cond(ctx, 'comorbidity', pick(['2型糖尿病', '高血压3级', '慢性肾脏病', '冠状动脉粥样硬化性心脏病', '慢阻肺', '脑梗死后遗症', '心房颤动', '贫血']), pick(['E11.9', 'I10', 'N18.9', 'I25.1', 'J44.1', 'I69.3', 'I48.9', 'D64.9']), 'moderate');
  }
  function mainDeathDx(ctx) {
    return ctx.icd.name + '，' + pick(['心源性休克', '呼吸循环衰竭', '多器官功能障碍综合征', '感染性休克', '脑疝', '消化道大出血']);
  }
  function concordanceObs(ctx) {
    F.seed({
      resourceType: 'Observation', status: 'final',
      code: { coding: [codingOf('obs-code', 'dx-concordance')], text: '入院-死亡诊断符合性' },
      subject: R_('Patient', ctx.pid, ctx.name), encounter: R_('Encounter', ctx.encId),
      effectiveDateTime: new Date(ctx.deathMs).toISOString(),
      valueCodeableConcept: { coding: [codingOf('concordance', ctx.concordance)], text: D.concordanceName(ctx.concordance) },
      ext: { obsKind: 'dx-concordance' }
    });
    F.seed({
      resourceType: 'Observation', status: 'final',
      code: { coding: [codingOf('obs-code', 'severity-score')], text: '疾病严重程度评分' },
      subject: R_('Patient', ctx.pid, ctx.name), encounter: R_('Encounter', ctx.encId),
      effectiveDateTime: new Date(ctx.deathMs).toISOString(),
      valueQuantity: { value: severityScore(ctx.severity), unit: '分', system: 'http://unitsofmeasure.org', code: 'score' },
      ext: { obsKind: 'severity-score', detail: { severity: ctx.severity } }
    });
  }
  function procedureRes(ctx) {
    F.seed({
      resourceType: 'Procedure', status: 'completed',
      code: { text: pick(['急诊经皮冠状动脉介入治疗', '腹腔镜下胆囊切除术', '全髋关节置换术', '开颅血肿清除术', '胃癌根治术', '肺叶切除术', '骨折切开复位内固定术', '气管切开术']) },
      category: [{ coding: [{ code: 'surgery', display: '手术' }] }],
      subject: R_('Patient', ctx.pid, ctx.name), encounter: R_('Encounter', ctx.encId),
      performedDateTime: new Date(ctx.deathMs - ctx.daysSinceSurgery * DAY).toISOString(),
      ext: { surgeryName: '手术', opGrade: pick(['三级', '四级']), anaesthesia: pick(['全身麻醉', '椎管内麻醉', '局部麻醉']), outcome: '术后返回病房' }
    });
  }
  function labs(ctx) {
    [['肌钙蛋白T', 'ng/mL', 0.02, 12.5], ['BNP', 'pg/mL', 60, 1560], ['血乳酸', 'mmol/L', 0.8, 8.6],
     ['血红蛋白', 'g/L', 62, 145], ['血肌酐', 'μmol/L', 45, 388], ['白细胞', '10^9/L', 2.1, 26.5]].forEach(function (it) {
      var v = +(it[2] + R() * (it[3] - it[2])).toFixed(2);
      var hi = v > (it[2] + it[3]) / 2;
      F.seed({
        resourceType: 'Observation', status: 'final',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: '检验' }] }],
        code: { coding: [{ system: 'urn:swbl:lab', code: it[0], display: it[0] }], text: it[0] },
        subject: R_('Patient', ctx.pid, ctx.name), encounter: R_('Encounter', ctx.encId),
        effectiveDateTime: new Date(ctx.deathMs - int(1, 48) * HOUR).toISOString(),
        valueQuantity: { value: v, unit: it[1], system: 'http://unitsofmeasure.org', code: it[1] },
        interpretation: [{ coding: [{ code: hi ? 'H' : 'L', display: hi ? '偏高' : '偏低' }] }],
        ext: { obsKind: 'lab-result', abnormal: hi, refRange: it[2] + '–' + it[3] }
      });
    });
  }

  /* —— 4. 病历资料文档（6 类，支持接口异常与手动补充） —— */
  function documents(ctx) {
    var plan = ctx.plan;
    V.Vocab['doc-type'].forEach(function (t) {
      var kind = t[0];
      if (kind === 'surgery' && !ctx.hasSurgery) return;
      var isError = (plan.docError || []).indexOf(kind) >= 0;
      var isManual = (plan.docManual || []).indexOf(kind) >= 0;
      if (isError && isManual) return;
      var text = docContent(kind, ctx);
      F.seed({
        resourceType: 'DocumentReference',
        status: isError ? 'entered-in-error' : 'current',
        docStatus: isManual ? 'final' : 'preliminary',
        type: { coding: [codingOf('doc-type', kind)], text: t[1] },
        subject: R_('Patient', ctx.pid, ctx.name),
        author: [R_('Practitioner', ctx.attending.pid, ctx.attending.name)],
        date: new Date(kind === 'admission' ? ctx.admitMs : ctx.deathMs - int(0, 24) * HOUR).toISOString(),
        description: t[1] + '（' + ctx.name + ' · ' + ctx.mrn + '）',
        custodian: { reference: 'Organization/' + 'Organization-' + String(ctx.deptIdx).padStart(4, '0'), display: ctx.deptName },
        context: { encounter: [R_('Encounter', ctx.encId)] },
        content: isError ? [] : [{
          attachment: {
            contentType: 'text/plain;charset=utf-8', language: 'zh-CN',
            data: b64(text), title: t[1]
          },
          format: { system: 'urn:ihe:mrmi', code: 'text' }
        }],
        ext: {
          docType: kind, docTitle: t[1], fetchError: !!isError,
          sourceType: isManual ? 'manual' : 'emr',
          uploadedBy: isManual ? ctx.attending.name : undefined,
          periodText: kind === 'progress' ? fmtDay(ctx.admitMs) + ' ~ ' + fmtDay(ctx.deathMs) : fmtDay(kind === 'admission' ? ctx.admitMs : ctx.deathMs)
        }
      });
    });
  }
  function docContent(kind, ctx) {
    var n = ctx.name, f = ctx.facts;
    var M = {
      admission: '【入院记录】\n姓名：' + n + '　性别：' + (ctx.gender === 'male' ? '男' : '女') + '　年龄：' + ctx.age + ' 岁\n住院号：' + ctx.mrn + '　科室：' + ctx.deptName + '　主管医师：' + ctx.attending.name +
        '\n入院时间：' + Limit.dt(ctx.admitMs) +
        '\n主诉：' + pick(['突发胸痛 6 小时', '气短伴咳嗽 1 周，加重 2 天', '意识障碍 3 小时', '上腹痛伴呕吐 2 天']) +
        '\n现病史：患者入院前' + pick(['无明显诱因出现相关症状并逐渐加重', '于外院对症处理后症状无改善']) + '，门诊以「' + ctx.icd.name + '」收入院。' +
        '\n体格检查：T 36.' + int(0, 9) + '℃　P ' + int(66, 122) + ' 次/分　R ' + int(16, 26) + ' 次/分　BP ' + int(90, 160) + '/' + int(55, 95) + ' mmHg。' +
        '\n初步诊断：' + ctx.icd.name + '（' + ctx.icd.code + '）\n诊疗计划：完善相关检查，予' + pick(['抗感染', '改善心肌供血', '降颅压脱水', '抑酸护胃', '解痉平喘']) + '及对症支持治疗。',
      progress: '【病程记录】' + fmtDay(ctx.admitMs) + ' ~ ' + fmtDay(ctx.deathMs) + '\n' + pick(['患者仍诉胸闷、气短，查体同前，继续目前治疗方案；', '复查炎症指标较前升高，调整抗菌药物；', '意识由清转浅昏迷，通知病重，与家属沟通病情；']) +
        '\n上级医师 ' + ctx.senior.name + ' 查房后指示：' + pick(['警惕病情变化，必要时转 ICU 治疗', '完善影像与实验室检查，明确病因', '加强支持治疗，密切监测生命体征']) + '。',
      surgery: '【手术记录】\n手术名称：' + pick(['急诊经皮冠状动脉介入治疗（PCI）', '腹腔镜下胆囊切除术', '开颅血肿清除术', '骨折切开复位内固定术']) +
        '\n麻醉方式：' + pick(['全身麻醉', '椎管内麻醉', '局部浸润麻醉']) +
        '\n术中所见与经过：常规消毒铺巾，建立入路，' + pick(['于左前降支植入药物洗脱支架 1 枚', '清除胆囊床并置管引流', '清除血肿并去骨瓣减压', '完成骨折复位并内固定']) + '，出血约 ' + int(20, 400) + ' ml，术中生命体征' + (chance(0.7) ? '平稳' : '一过性波动，处理后恢复') + '，术毕安返' + pick(['病房', 'CCU', 'ICU']) + '。' +
        '\n术后处理：' + pick(['抗凝、抗血小板、他汀', '抗感染、补液、营养支持', '脱水降颅压、神经营养']) + '，密切观察' + (ctx.daysSinceSurgery != null ? '。术后 ' + ctx.daysSinceSurgery + ' 天患者病情发生变化。' : '。'),
      rescue: '【抢救记录】\n患者于 ' + Limit.dt(ctx.deathMs - int(1, 4) * HOUR) + ' 出现' + pick(['血压骤降、心率增快、四肢湿冷', '意识丧失、大动脉搏动消失、呼吸暂停', '血氧饱和度进行性下降']) + '，' +
        '立即' + pick(['启动心肺复苏、气管插管接呼吸机辅助通气', '电除颤 3 次并静推肾上腺素', '开放两条静脉通路予血管活性药物']) + '，' +
        '持续抢救 ' + int(40, 180) + ' 分钟无效，于 ' + Limit.dt(ctx.deathMs) + ' 宣布临床死亡。已向家属充分告知抢救过程。',
      death: '【死亡记录】\n姓名：' + n + '　住院号：' + ctx.mrn + '　科室：' + ctx.deptName +
        '\n入院日期：' + fmtDay(ctx.admitMs) + '　死亡日期：' + fmtDay(ctx.deathMs) + '　住院天数：' + Math.max(1, Math.round((ctx.deathMs - ctx.admitMs) / DAY)) + ' 天' +
        '\n入院诊断：' + ctx.icd.name + '\n死亡诊断：' + mainDeathDx(ctx) +
        '\n死亡原因：' + ctx.icd.name + '所致' + pick(['呼吸循环衰竭', '多器官功能障碍综合征', '心源性休克']) + '。' +
        '\n抢救经过：详见抢救记录，抢救无效。' + (f.hasDispute ? '\n家属对诊疗过程提出异议，已按流程告知相关权利。' : '\n家属对诊疗过程无异议。'),
      exam: '【检查检验结果】\n' + pick(['心电图：广泛前壁 ST 段抬高', '胸部 CT：双肺炎症表现伴少量胸腔积液', '头颅 MRI：大面积脑梗死伴中线移位', '床旁超声：下腔静脉塌陷、心功能减低']) +
        '\n肌钙蛋白 T ' + (0.5 + R() * 12).toFixed(1) + ' ng/mL（↑）　BNP ' + int(300, 2000) + ' pg/mL（↑）' +
        '\n血气分析：pH 7.' + int(10, 30) + '　PaO2 ' + int(45, 70) + ' mmHg　PaCO2 ' + int(28, 52) + ' mmHg　Lac ' + (2 + R() * 6).toFixed(1) + ' mmol/L（↑）' +
        '\n血常规：WBC ' + (4 + R() * 20).toFixed(1) + '×10⁹/L　Hb ' + int(62, 145) + ' g/L　PLT ' + int(40, 300) + '×10⁹/L'
    };
    return M[kind] || ('【' + t0name(kind) + '】演示内容略。');
  }
  function t0name(kind) {
    var t = V.Vocab['doc-type'].filter(function (x) { return x[0] === kind; })[0];
    return t ? t[1] : kind;
  }

  /* —— 5. 讨论任务 —— */
  function discussTask(ctx) {
    var st = (ctx.plan.discuss && ctx.plan.discuss.state) || (ctx.mode === 'full' ? 'to-organize' : 'archived');
    var biz = { 'to-organize': 'to-organize', booked: 'in-progress', draft: 'in-progress', 'to-sign': 'to-sign', archived: 'archived', never: 'to-organize' }[st] || 'to-organize';
    var done = biz === 'archived';
    var actual = null;
    if (ctx.mode === 'stub') actual = done ? actualMs('discussion', ctx, !(ctx.plan.discuss && ctx.plan.discuss.late)) : null;
    var due = Limit.deadlineOf('discussion', ctx);
    ctx.discussBiz = biz;
    ctx.discussTaskId = F.seed({
      resourceType: 'Task',
      instantiatesCanonical: 'Questionnaire/Questionnaire-record',
      identifier: [{ system: 'urn:swbl:task-no', value: 'DT' + new Date(ctx.deathMs).getFullYear() + String(1000 + ctx.seq) }],
      status: done ? 'completed' : (biz === 'to-organize' ? 'requested' : 'in-progress'),
      businessStatus: { coding: [codingOf('business-status', biz)], text: D.discussStatusName(biz) },
      intent: 'plan', priority: ctx.priority,
      code: { coding: [codingOf('task-kind', 'discussion')], text: '组织死亡病例讨论' },
      description: '组织 ' + ctx.name + '（' + ctx.deptName + '·' + D.deathTypeName(ctx.deathType) + '）死亡病例讨论并归档记录',
      encounter: R_('Encounter', ctx.encId, ctx.name),
      for: R_('Patient', ctx.pid, ctx.name),
      owner: R_('Practitioner', ctx.director.pid, ctx.director.name),
      requestedPerformer: { reference: 'PractitionerRole/' + ctx.director.role, display: ctx.director.name },
      authoredOn: new Date(ctx.deathMs + 3 * MIN).toISOString(),
      lastModified: new Date(ctx.deathMs + 3 * MIN).toISOString(),
      executionPeriod: actual ? { start: new Date(ctx.deathMs + DAY).toISOString(), end: new Date(actual).toISOString() } : undefined,
      note: [{
        authorReference: { display: '系统（EMR 死亡记录事件）' }, time: new Date(ctx.deathMs + 2 * MIN).toISOString(),
        text: 'EMR 保存死亡记录 → 自动识别死亡事件并完成分类：' + D.deathTypeName(ctx.deathType) +
          '（' + (ctx.classifyRule ? '命中规则 ' + ctx.classifyRule.id + ' ' + ctx.classifyRule.name : '未命中规则，转人工判定') + '）；' +
          '讨论时限 ' + Limit.daysOf('discussion', ctx.deathType) + ' 天，优先级「' + D.priorityName(ctx.priority) + '」。'
      }],
      ext: { taskKind: 'discussion', deadlineSig: sig('discussion', ctx) }
    }, due).id;
    if (due) setDue(ctx.discussTaskId, due);
    ctx.discussActualMs = actual;
  }
  function sig(kind, ctx) { return Limit.configSig() + ':' + kind + ':' + ctx.deathType; }
  function setDue(id, dueMs) {
    var t = F.view('Task', id);
    F.update(Object.assign({}, t, { dueDate: new Date(dueMs).toISOString() }));
  }

  /* —— 5. 上报任务 + 审核链 + 上报单 —— */
  function reportTask(ctx) {
    var rp = ctx.plan.report || {};
    var st = rp.state || (ctx.mode === 'full' ? 'to-fill' : (rp.never ? 'to-fill' : 'done'));
    var flow = buildFlow(ctx, st, rp);
    var biz = st === 'done' ? 'done' : (st === 'to-fill' ? 'to-fill' : Flow.reportStatusOf({ status: 'submitted' }, flow));
    var actual = biz === 'done' ? actualMs('report', ctx, !rp.late) : null;
    var due = Limit.deadlineOf('report', ctx);
    ctx.reportBiz = biz;
    ctx.reportFlow = flow;
    ctx.reportTaskId = F.seed({
      resourceType: 'Task',
      instantiatesCanonical: 'PlanDefinition/PlanDefinition-report-approval',
      identifier: [{ system: 'urn:swbl:task-no', value: 'RP' + new Date(ctx.deathMs).getFullYear() + String(1000 + ctx.seq) }],
      status: biz === 'done' ? 'completed' : (biz === 'to-fill' ? 'requested' : 'in-progress'),
      businessStatus: { coding: [codingOf('business-status', biz)], text: D.reportStatusName(biz) },
      intent: 'plan', priority: ctx.priority,
      code: { coding: [codingOf('task-kind', 'report')], text: '填写并审核死亡病例上报单' },
      description: ctx.name + '（' + ctx.deptName + '）死亡病例上报，死亡类型 ' + D.deathTypeName(ctx.deathType) + '，上报时限 ' + Limit.daysOf('report', ctx.deathType) + ' 天',
      encounter: R_('Encounter', ctx.encId, ctx.name),
      for: R_('Patient', ctx.pid, ctx.name),
      owner: R_('Practitioner', ctx.attending.pid, ctx.attending.name),
      authoredOn: new Date(ctx.deathMs + 4 * MIN).toISOString(),
      lastModified: new Date(ctx.deathMs + 4 * MIN).toISOString(),
      ext: {
        taskKind: 'report', approvalFlow: flow, deadlineSig: sig('report', ctx),
        returnReason: biz === 'returned' ? returnReason(ctx, flow, rp) : undefined
      }
    }).id;
    if (due) {
      var t = F.view('Task', ctx.reportTaskId);
      F.update(Object.assign({}, t, { dueDate: new Date(due).toISOString(), completedDate: actual ? new Date(actual).toISOString() : undefined }));
    }
    ctx.reportActualMs = actual;
  }
  function returnReason(ctx, flow, rp) {
    var n = Flow.returnedNode(flow) || flow[0];
    return {
      level: n.level, levelName: n.name, by: n.actorName, role: n.roleName,
      at: Limit.dt(ctx.deathMs + int(6, 40) * HOUR),
      text: rp.returnNote || '死亡原因分析不够准确，请补充直接死因与根本死因的因果关系后重新提交。'
    };
  }
  function buildFlow(ctx, st, rp) {
    var pd = F.view('PlanDefinition', 'PlanDefinition-report-approval');
    var nodes = pd && pd.ext && pd.ext.nodes ? pd.ext.nodes : [];
    var names = { senior: ctx.senior, director: ctx.director, quality: ctx.quality };
    var order = { 'to-fill': 0, 'level-1': 1, 'level-2': 2, 'level-3': 3, 'returned': rp.returnedLevel || 1, 'done': 99 }[st];
    if (order == null) order = 1;
    var submittedAt = ctx.deathMs + int(3, 24) * HOUR;
    return nodes.map(function (n, i) {
      var who = names[n.roleCode] || ctx.senior;
      var level = n.level;
      var status = 'pending';
      if (level < order) status = 'approved';
      else if (level === order) status = st === 'returned' ? 'returned' : 'current';
      var acted = status === 'approved' || status === 'returned';
      return {
        level: level, name: n.name, roleCode: n.roleCode, roleName: n.roleName,
        actorName: who.name, actorPid: who.pid, actorRole: who.role,
        demoUser: n.roleCode === 'senior' ? 'u-senior' : (n.roleCode === 'director' ? D.deptDirectorUser(ctx.deptIdx) : 'u-quality'),
        status: status,
        assignedAt: Limit.dt(submittedAt + i * int(4, 18) * HOUR),
        actedAt: acted ? Limit.dt(submittedAt + i * int(5, 22) * HOUR + HOUR) : null,
        decision: status === 'approved' ? '审核通过' : (status === 'returned' ? '退回修改' : null),
        opinion: status === 'approved' ? pick(['上报内容完整，死亡原因分析合理，同意上报。', '诊疗过程记录清晰，同意上报。', '符合上报要求，同意。'])
          : (status === 'returned' ? (rp.returnNote || '死亡原因分析不够准确，请修改后重新提交。') : '')
      };
    });
  }
  function reportForm(ctx) {
    var st = ctx.reportBiz;
    if (st === 'to-fill' && !(ctx.plan.report && ctx.plan.report.draftFilled)) return;
    var items = reportItems(ctx);
    ctx.reportQrId = F.seed({
      resourceType: 'QuestionnaireResponse',
      questionnaire: 'https://fhir.swbl-demo.example/Questionnaire/death-case-report',
      status: st === 'to-fill' ? 'draft' : 'submitted',
      subject: R_('Patient', ctx.pid, ctx.name),
      author: R_('Practitioner', ctx.attending.pid, ctx.attending.name),
      source: R_('Practitioner', ctx.attending.pid, ctx.attending.name),
      basedOn: [{ reference: 'Task/' + ctx.reportTaskId }],
      authored: new Date(ctx.deathMs + int(3, 24) * HOUR).toISOString(),
      item: items,
      ext: { draftMeta: { savedAt: Limit.dt(ctx.deathMs + int(2, 20) * HOUR), submittedAt: st === 'to-fill' ? null : Limit.dt(ctx.deathMs + int(3, 24) * HOUR) }, respondentName: ctx.attending.name }
    }).id;
    var t = F.view('Task', ctx.reportTaskId);
    F.update(Object.assign({}, t, { focus: R_('QuestionnaireResponse', ctx.reportQrId, '死亡病例上报单') }));
  }
  function reportItems(ctx) {
    var vals = reportValues(ctx);
    var items = [];
    S.REPORT_MODULES.forEach(function (m) {
      var children = [];
      m.fields.forEach(function (fd) {
        if (fd.type === 'group') return;
        children.push(Object.assign({ linkId: fd.id, text: fd.label }, valueOf(fd, vals[fd.id])));
      });
      items.push({ linkId: m.id, text: m.title, type: 'group', item: children });
    });
    return items;
  }
  function reportValues(ctx) {
    var f = ctx.facts, los = Math.max(1, Math.round((ctx.deathMs - ctx.admitMs) / DAY));
    return {
      'r1.name': ctx.name, 'r1.gender': ctx.gender === 'male' ? '男' : '女', 'r1.age': ctx.age + '岁',
      'r1.mrn': ctx.mrn, 'r1.admitDate': fmtDay(ctx.admitMs), 'r1.deathDate': fmtDay(ctx.deathMs), 'r1.los': los + '天',
      'r2.admitDx': ctx.icd.name + '（' + ctx.icd.code + '）',
      'r2.deathDx': mainDeathDx(ctx),
      'r2.secondaryDx': pick(['呼吸循环衰竭', '多器官功能障碍综合征', '心源性休克', '感染性休克']),
      'r2.rootReason': ctx.icd.name + '进展导致重要器官功能不可逆衰竭；住院期间已给予规范诊疗与积极抢救。',
      'r3.measures': '入院后完善相关检查，予' + pick(['急诊 PCI 术并植入药物洗脱支架，术后抗凝、抗血小板、他汀治疗', '抗感染、化痰、解痉平喘及氧疗', '降颅压、脱水及神经营养治疗', '抗肿瘤及营养支持等综合治疗']) + '；持续心电监护，必要时血管活性药物维持血流动力学稳定。',
      'r3.keyNodes': fmtDay(ctx.admitMs) + ' 入院；' + pick(['入院当日完成急诊手术', '入院第 2 天病情突然变化并转 ICU', '入院第 3 天出现意识障碍加深']) + '；' + fmtDay(ctx.deathMs) + ' 抢救无效死亡。',
      'r3.change': '患者入院后病情' + (f.terminal ? '进行性恶化' : '反复波动') + '，' + pick(['出现血压进行性下降（85/52mmHg）、心率增快（120bpm）、尿量减少、四肢湿冷', '突发意识丧失、大动脉搏动消失、呼吸暂停', '氧合指数持续下降，复查影像提示病灶明显进展']) + '，经' + pick(['去甲肾上腺素与多巴胺升压', '心肺复苏、电除颤、气管插管机械通气', '加强呼吸机支持与俯卧位通气']) + '等积极抢救无效，于 ' + Limit.dt(ctx.deathMs) + ' 宣布临床死亡。',
      'r4.directCause': pick(['心源性休克', '呼吸循环衰竭', '感染性休克', '多器官功能障碍综合征']),
      'r4.rootCause': ctx.icd.name,
      'r4.trigger': pick(['冠状动脉急性血栓形成', '严重感染', '术后出血', '有效循环血量不足', '']),
      'r5.deathType': ctx.deathType === 'expected' ? 'expected' : 'unexpected',
      'r5.avoidable': weighted({ avoidable: 20, unavoidable: 80 }),
      'r5.negligence': f.hasDispute ? 'yes' : 'no',
      'r6.rescueStart': Limit.dt(ctx.deathMs - int(1, 3) * HOUR),
      'r6.rescueEnd': Limit.dt(ctx.deathMs),
      'r6.rescueMeasures': '持续心肺复苏、电除颤 3 次、肾上腺素与去甲肾上腺素静推及泵入、气管插管接呼吸机辅助通气、' + pick(['床旁超滤', '主动脉内球囊反搏', '血浆置换']) + '，共抢救 ' + int(45, 180) + ' 分钟。',
      'r6.rescueEffect': '抢救无效，' + Limit.dt(ctx.deathMs) + ' 宣布临床死亡；已向家属充分告知病情并签署相关知情文件。'
    };
  }
  function valueOf(fd, v) {
    if (v == null) v = '';
    if (fd.type === 'choice') {
      var opt = (fd.options || []).filter(function (o) { return o[0] === v; })[0];
      var disp = opt ? opt[1] : v;
      return { valueCoding: { code: v, display: disp }, text: disp };
    }
    if (fd.type === 'reference') return { valueReference: { display: v } };
    if (fd.type === 'boolean') return { valueBoolean: v === true || v === '是' };
    return { valueString: String(v) };
  }

  /* —— 6. 会议 —— */
  function meeting(ctx) {
    var dp = (ctx.plan.discuss || {});
    var meetingMs = dp.meetingMs != null ? dp.meetingMs : ctx.deathMs + int(20, 70) * HOUR;
    var fulfilled = dp.state === 'draft' || dp.state === 'to-sign' || dp.state === 'archived';
    var parties = [
      { p: ctx.director, role: '科主任', required: true, status: 'accepted' },
      { p: ctx.attending, role: '主管医师', required: true, status: 'accepted' },
      { p: ctx.senior, role: '上级医师', required: true, status: dp.attendMixed ? 'needs-action' : 'accepted' }
    ];
    var others = [staff(ctx.deptIdx, 'doctor', 0), staff(ctx.deptIdx, 'attending', 1), staff(ctx.deptIdx, 'doctor', 1)];
    others.forEach(function (o, i) {
      parties.push({ p: o, role: '科室医师', required: false, status: dp.attendMixed ? (i === 0 ? 'needs-action' : (i === 1 ? 'declared-leave' : 'accepted')) : 'accepted' });
    });
    var savedAt = ctx.deathMs + int(6, 48) * HOUR;
    ctx.meetingMs = meetingMs;
    ctx.apptId = F.seed({
      resourceType: 'Appointment',
      status: fulfilled ? 'fulfilled' : 'booked', intent: 'book',
      priority: ctx.priority === 'high' ? 1 : 3,
      description: ctx.name + '死亡病例讨论会',
      subject: [R_('Patient', ctx.pid, ctx.name), R_('Encounter', ctx.encId)],
      start: new Date(meetingMs).toISOString(),
      end: new Date(meetingMs + int(60, 120) * MIN).toISOString(),
      participant: parties.map(function (x) {
        return { actor: R_('Practitioner', x.p.pid, x.p.name), required: x.required ? 'required' : 'optional', status: x.status === 'declared-leave' ? 'needs-action' : x.status };
      }),
      authorship: R_('Practitioner', ctx.director.pid, ctx.director.name),
      instruction: '请参会人员提前调阅病历资料，主管医师准备病例汇报。',
      ext: {
        meeting: {
          title: ctx.name + '死亡病例讨论', location: pick(['示教室', '医师办公室', '全科读片室']) + int(1, 5) + ' 室',
          preparedBy: ctx.attending.name, dept: ctx.deptName,
          savedAt: new Date(savedAt).toISOString(), notifiedAt: new Date(savedAt).toISOString()
        },
        partyMeta: parties.map(function (x) {
          return { pid: x.p.pid, name: x.p.name, role: x.role, dept: ctx.deptName, status: x.status, leaveReason: x.status === 'declared-leave' ? '门诊排班冲突，已向科主任请假并获批' : '' };
        }),
        notifyChannels: ['site', 'app', 'wechat']
      }
    }).id;
  }

  /* —— 7. 讨论记录 —— */
  function record(ctx) {
    var dp = ctx.plan.discuss || {};
    var partial = dp.state === 'draft' && !dp.draftComplete;
    var skip = partial ? (dp.missing || { 'm4.process': 1, 'm5.dxTimely': 1, 'm6.speakers': 1, 'm7.problems': 1, 'm8.measures': 1 })
      : (dp.missing || {});
    var vals = recordValues(ctx);
    var items = [];
    S.DISCUSS_MODULES.forEach(function (m) {
      var children = [];
      m.fields.forEach(function (fd) {
        if (fd.type === 'group') {
          if (skip[fd.id]) return;
          var rows = vals[fd.id] || [];
          children.push({
            linkId: fd.id, text: fd.label, type: 'group', repeats: true,
            item: rows.map(function (row) {
              return {
                item: Object.keys(row).map(function (k) {
                  var lab = '';
                  fd.item.forEach(function (c) { if (c.linkId === k) lab = c.text; });
                  return Object.assign({ linkId: k, text: lab }, valueOf({ type: k.indexOf('owner') >= 0 ? 'reference' : (k.indexOf('due') >= 0 ? 'date' : 'text') }, row[k]));
                })
              };
            })
          });
          return;
        }
        if (skip[fd.id]) return;
        children.push(Object.assign({ linkId: fd.id, text: fd.label }, valueOf(fd, vals[fd.id])));
      });
      items.push({ linkId: m.id, text: m.title, type: 'group', item: children });
    });
    var authoredMs = (ctx.meetingMs || ctx.deathMs) + 2 * HOUR;
    ctx.recordId = F.seed({
      resourceType: 'QuestionnaireResponse',
      questionnaire: 'https://fhir.swbl-demo.example/Questionnaire/death-case-discussion-record',
      status: dp.state === 'draft' ? 'draft' : 'submitted',
      subject: R_('Patient', ctx.pid, ctx.name),
      author: R_('Practitioner', ctx.attending.pid, ctx.attending.name),
      source: R_('Practitioner', ctx.attending.pid, ctx.attending.name),
      basedOn: [{ reference: 'Task/' + ctx.discussTaskId }],
      authored: new Date(authoredMs).toISOString(),
      item: items,
      ext: {
        draftMeta: {
          savedAt: Limit.dt(authoredMs), autoSavedAt: Limit.dt(authoredMs - 12 * MIN),
          submittedAt: dp.state === 'draft' ? null : Limit.dt(authoredMs),
          discussDate: fmtDay(ctx.meetingMs || ctx.deathMs),
          location: (F.view('Appointment', ctx.apptId) || { ext: { meeting: {} } }).ext.meeting.location || '示教室',
          moderator: ctx.director.name, scribe: ctx.attending.name
        },
        respondentName: ctx.attending.name
      }
    }).id;
    ctx.recordAuthoredMs = authoredMs;
  }
  function recordValues(ctx) {
    var f = ctx.facts, v = reportValues(ctx);
    var los = Math.max(1, Math.round((ctx.deathMs - ctx.admitMs) / DAY));
    var owners = [ctx.attending, ctx.senior, staff(ctx.deptIdx, 'doctor', 0)];
    var measureTexts = [
      '加强危重患者病情动态评估，落实每 4 小时预警评分记录并纳入交接班清单',
      '建立术后 30 天内高危患者随访路径，由系统自动提醒复查与门诊随诊',
      '组织全科死亡病例讨论制度与急救流程专题培训，并进行理论与操作考核',
      '完善夜间与交接班高风险环节书面清单，实行双签名确认',
      '优化抢救设备与急救药品定点检查制度，保证班班交接随时可用'
    ];
    var n = int(2, 3);
    var measures = [];
    for (var i = 0; i < n; i++) {
      measures.push({
        'm8.content': measureTexts[(ctx.seq + i) % measureTexts.length],
        'm8.owner': owners[i % owners.length].name,
        'm8.due': fmtDay(ctx.deathMs + int(12, 45) * DAY),
        'm8.expected': '相关环节执行率达到 90% 以上，' + pick(['评分记录缺失问题清零', '术后随访及时率提升至 95%', '考核合格率 100%', '交接班缺陷项清零']) + '。'
      });
    }
    return {
      'm1.name': ctx.name, 'm1.age': ctx.age + '岁', 'm1.gender': ctx.gender === 'male' ? '男' : '女',
      'm1.mrn': ctx.mrn, 'm1.admitDate': fmtDay(ctx.admitMs), 'm1.deathDate': fmtDay(ctx.deathMs), 'm1.los': los + '天',
      'm2.admitDx': v['r2.admitDx'], 'm2.deathDx': ctx.icd.name, 'm2.concordance': ctx.concordance,
      'm3.chief': pick(['突发胸痛 6 小时', '气短、咳嗽 1 周，加重 2 天', '意识障碍 3 小时', '上腹痛伴呕吐 2 天', '双下肢水肿伴夜间阵发性呼吸困难 10 天']),
      'm3.presentIllness': '患者于入院前' + pick(['无明显诱因出现相关症状并逐渐加重', '劳累后症状明显加重，休息后缓解不明显', '于外院对症处理后症状无改善']) + '，门诊以「' + ctx.icd.name + '」收入' + ctx.deptName + '。入院时' + pick(['精神差，饮食睡眠不佳', '意识清楚，言语切题', '间断胸闷、活动后气促']) + '；查体 T 36.' + int(0, 9) + '℃，P ' + int(70, 120) + ' 次/分，R ' + int(16, 26) + ' 次/分，BP ' + int(90, 160) + '/' + int(55, 95) + ' mmHg。',
      'm3.exams': '心电图示' + pick(['广泛前壁 ST 段抬高', '心房颤动伴继发 ST-T 改变', '窦性心律大致正常']) + '；肌钙蛋白 T ' + (0.5 + R() * 12).toFixed(1) + ' ng/mL（↑）；BNP ' + int(300, 2000) + ' pg/mL（↑）；血气 pH 7.18、PaO2 55 mmHg、Lac 8.6 mmol/L（↑）；影像提示' + pick(['双肺炎症伴少量胸腔积液', '大面积脑梗死伴中线移位', '肝内占位伴多发转移']) + '。',
      'm3.treatments': v['r3.measures'],
      'm3.progress': v['r3.change'],
      'm4.directCause': v['r4.directCause'], 'm4.rootCause': v['r4.rootCause'],
      'm4.process': '患者因' + ctx.icd.name + '入院，住院期间' + (f.terminal ? '基础疾病进入终末期' : '病情急剧变化') + '，出现' + pick(['有效循环血量不足与组织灌注不良', '气体交换严重障碍', '全身炎症反应与多器官功能受累']) + '，经积极抢救 ' + int(45, 180) + ' 分钟无效死亡。死亡诊断与入院诊断' + D.concordanceName(ctx.concordance) + '，死因判断' + (ctx.concordance === 'unmatch' ? '需进一步结合尸检与检查资料复核。' : '与临床经过相符。'),
      'm4.avoidable': weighted({ avoidable: 18, partly: 22, unavoidable: 60 }),
      'm5.dxTimely': weighted({ yes: 62, partly: 28, no: 10 }),
      'm5.dxNote': pick(['入院后 30 分钟内完成初步评估并及时启动诊疗。', '辅助检查回报偏晚，影响判断时效。', '']),
      'm5.txReasonable': weighted({ yes: 66, partly: 26, no: 8 }),
      'm5.txNote': pick(['治疗方案符合诊疗规范与指南推荐。', '抗感染药物降阶梯时机可再提前。', '']),
      'm5.rescueProper': weighted({ yes: 74, partly: 20, no: 6 }),
      'm5.rescueNote': pick(['抢救流程规范，人员到位及时。', '抢救期间除颤仪到位稍晚，需优化布局。', '']),
      'm5.deficiency': weighted({ no: 68, yes: 32 }),
      'm5.deficiencyNote': '对病情变化趋势的预判不足，危重评分记录间隔偏长，交接班对高风险环节提示不够具体。',
      'm6.speakers': [
        { 'm6.speaker': ctx.director.name, 'm6.role': '科主任 / 主持人', 'm6.opinion': '本例死亡诊断明确，诊疗过程总体符合规范；' + pick(['要进一步加强危重患者病情动态评估与记录', '术后高危患者的预警识别需落实到班组', '对终末期患者的沟通与人文关怀要更充分']) + '。同意本记录归档。' },
        { 'm6.speaker': ctx.senior.name, 'm6.role': '上级医师', 'm6.opinion': '患者病情变化迅速，' + pick(['一线医师对休克早期的识别存在一定滞后', '抢救用药与液体管理选择合理', '影像随访间隔可适当缩短']) + '，建议完善相关流程与培训。' },
        { 'm6.speaker': ctx.attending.name, 'm6.role': '主管医师 / 病例汇报', 'm6.opinion': '入院后按诊疗常规处理，病情变化时及时升级监护与用药；复盘看' + pick(['预警评分记录频次应提高', '家属告知的书面记录需进一步完善']) + '。' }
      ],
      'm7.experience': pick(['多学科协作响应及时，抢救流程执行规范；', '入院早期即启动风险评估，为治疗争取时间；', '与家属沟通充分，知情同意告知及时且书面留痕完整；']) + '本例中的规范处理可作为科室同类病例的参考。',
      'm7.problems': pick(['危重患者病情动态观察记录间隔偏长，趋势预警不足；', '术后 30 天内高危患者的随访与复查提醒依赖人工；', '夜间与交接班时段的高风险环节提示不够具体；']) + '制度执行的一致性有待提高。',
      'm7.direction': pick(['建立死亡病例预警评分定时记录制度；', '完善术后高危患者随访路径并实现系统自动提醒；', '强化交接班清单管理与科内培训考核；']) + '并纳入科室质量改进计划跟踪落实。',
      'm8.measures': measures
    };
  }
  function partialSign(ctx) {
    var dp = ctx.plan.discuss || {};
    var signed = dp.signed != null ? dp.signed : 1;
    var list = [
      { p: ctx.attending, role: '主管医师', mode: 'legal', required: true },
      { p: ctx.director, role: '科主任 / 主持人', mode: 'official', required: true },
      { p: ctx.senior, role: '上级医师', mode: 'legal', required: true }
    ];
    var at0 = (ctx.recordAuthoredMs || ctx.deathMs) + HOUR;
    ctx.compId = F.seed({
      resourceType: 'Composition', status: 'preliminary',
      type: { coding: [{ system: 'http://loinc.org', code: '34117-4', display: '死亡病例讨论记录' }], text: '死亡病例讨论记录' },
      subject: R_('Patient', ctx.pid, ctx.name),
      date: new Date(at0).toISOString(),
      author: [R_('Practitioner', ctx.attending.pid, ctx.attending.name)],
      title: ctx.name + ' 死亡病例讨论记录',
      attester: list.slice(0, signed).map(function (a, i) {
        return { mode: a.mode, time: new Date(at0 + i * 30 * MIN).toISOString(), party: R_('Practitioner', a.p.pid, a.p.name) };
      }),
      custodian: R_('Organization', 'Organization-' + String(ctx.deptIdx).padStart(4, '0'), ctx.deptName),
      section: [{ title: '讨论记录（待签名）', code: { text: 'm1' }, text: { status: 'additional', div: '<div xmlns="http://www.w3.org/1999/xhtml">内容见 QuestionnaireResponse/' + ctx.recordId + '</div>' } }],
      ext: { archiveMeta: { archivedAt: null, emrSync: 'pending', eventPublished: false }, recordNo: 'DIS' + new Date(ctx.deathMs).getFullYear() + String(1000 + ctx.seq) }
    }).id;
  }

  /* —— 8. 签名归档 + 改进任务 —— */
  function archive(ctx) {
    var dp = ctx.plan.discuss || {};
    var signedAt = dp.signedAtMs != null ? dp.signedAtMs : (ctx.recordAuthoredMs || ctx.meetingMs || ctx.deathMs) + 3 * HOUR;
    var attesters = [
      { mode: 'legal', p: ctx.attending, role: '主管医师', required: true },
      { mode: 'official', p: ctx.director, role: '科主任 / 主持人', required: true },
      { mode: 'legal', p: ctx.senior, role: '上级医师', required: true }
    ];
    var optionalDoc = staff(ctx.deptIdx, 'doctor', 0);
    var atts = attesters.map(function (a, i) {
      return { mode: a.mode, time: new Date(signedAt + i * 40 * MIN).toISOString(), party: R_('Practitioner', a.p.pid, a.p.name) };
    });
    var meta = (F.view('Appointment', ctx.apptId) || { ext: { partyMeta: [] } }).ext.partyMeta || [];
    var optional = meta.filter(function (m) { return m.role === '科室医师'; });
    optional.forEach(function (o, i) {
      if (o.status === 'declared-leave') return;
      atts.push({ mode: 'personal', time: new Date(signedAt + (3 + i) * 30 * MIN).toISOString(), party: R_('Practitioner', o.pid, o.name) });
    });
    var archivedAt = signedAt + 3 * HOUR;
    var recordNo = 'DIS' + new Date(ctx.deathMs).getFullYear() + String(1000 + ctx.seq);
    ctx.compId = F.seed({
      resourceType: 'Composition', status: 'final',
      type: { coding: [{ system: 'http://loinc.org', code: '34117-4', display: '死亡病例讨论记录' }], text: '死亡病例讨论记录' },
      subject: R_('Patient', ctx.pid, ctx.name),
      date: new Date(signedAt).toISOString(),
      author: [R_('Practitioner', ctx.attending.pid, ctx.attending.name)],
      title: ctx.name + ' 死亡病例讨论记录',
      attester: atts,
      custodian: R_('Organization', 'Organization-' + String(ctx.deptIdx).padStart(4, '0'), ctx.deptName),
      section: S.DISCUSS_MODULES.map(function (m) {
        return {
          title: m.title, code: { coding: [{ code: m.id, display: m.title }], text: m.title },
          text: { status: 'additional', div: '<div xmlns="http://www.w3.org/1999/xhtml">' + m.title + '（详见 QuestionnaireResponse/' + (ctx.recordId || '') + '）</div>' }
        };
      }),
      relatesTo: [{ code: 'transforms', target: R_('QuestionnaireResponse', ctx.recordId || '', '讨论记录结构化数据') }],
      ext: {
        archiveMeta: { archivedAt: new Date(archivedAt).toISOString(), emrSync: 'success', eventPublished: true },
        archivedAt: new Date(archivedAt).toISOString(), recordNo: recordNo
      }
    }).id;
    ctx.archivedAtMs = archivedAt;

    // 讨论任务收口：completed + 实际讨论时间
    var dt = F.view('Task', ctx.discussTaskId);
    F.update(Object.assign({}, dt, {
      status: 'completed',
      businessStatus: { coding: [codingOf('business-status', 'archived')], text: '已完成' },
      executionPeriod: { start: new Date(ctx.deathMs).toISOString(), end: new Date(archivedAt).toISOString() },
      focus: R_('Composition', ctx.compId, '讨论记录')
    }));
    ctx.discussActualMs = archivedAt;

    // 归档到病历（DocumentReference）
    F.seed({
      resourceType: 'DocumentReference', status: 'current', docStatus: 'final',
      type: { coding: [codingOf('doc-type', 'death')], text: '死亡病例讨论记录（归档）' },
      subject: R_('Patient', ctx.pid, ctx.name),
      date: new Date(archivedAt).toISOString(),
      author: [R_('Practitioner', ctx.attending.pid, ctx.attending.name)],
      description: '死亡病例讨论记录归档至 EMR：' + recordNo,
      content: [{ attachment: { contentType: 'text/plain;charset=utf-8', data: b64('【死亡病例讨论记录归档】' + ctx.name + ' ' + recordNo + ' 已签名归档，记录锁定不可修改。'), title: recordNo } }],
      context: { related: [{ reference: 'Composition/' + ctx.compId }] },
      ext: { docType: 'archive', docTitle: '死亡病例讨论记录', sourceType: 'emr', periodText: fmtDay(archivedAt) }
    });

    // 自动提取改进措施 → 改进任务
    var rows = measureRows(ctx);
    ctx.improveTaskIds = [];
    rows.forEach(function (row, i) {
      var states = (ctx.plan.improve && ctx.plan.improve.states) || null;
      var biz = states ? states[i % states.length] : (ctx.mode === 'stub' ? improveStubState(ctx, i) : improveOpenState(ctx, i));
      createImprove(ctx, row, biz, 1, null, i);
    });

    // 事件留痕
    F.seed({
      resourceType: 'Provenance',
      activity: { coding: [codingOf('provenance-activity', 'archive')], text: '归档' },
      recorded: new Date(archivedAt).toISOString(),
      reason: [{ text: '讨论记录完成全部必签并归档至 EMR，发布「死亡病例讨论完成」事件' }],
      agent: [{ who: R_('Practitioner', ctx.attending.pid, ctx.attending.name), role: { coding: [{ code: 'attending', display: '主管医师' }] } }],
      entity: [{ role: 'source', what: R_('Composition', ctx.compId, '讨论记录') }]
        .concat(ctx.improveTaskIds.map(function (id) { return { role: 'result', what: R_('Task', id, '改进跟踪任务') }; })),
      ext: { activity: 'archive', note: '自动提取改进措施 ' + ctx.improveTaskIds.length + ' 条生成跟踪任务', bizKind: 'case', bizId: ctx.encId, operatorName: ctx.attending.name }
    });
  }
  function measureRows(ctx) {
    var qr = ctx.recordId ? F.view('QuestionnaireResponse', ctx.recordId) : null;
    var rows = [];
    if (qr) {
      var m8 = (qr.item || []).filter(function (x) { return x.linkId === 'm8'; })[0];
      if (m8) (m8.item || []).forEach(function (g) {
        var row = {};
        (g.item || []).forEach(function (leaf) {
          row[leaf.linkId] = leaf.valueString != null ? leaf.valueString
            : (leaf.valueCoding ? (leaf.valueCoding.display || leaf.valueCoding.code) : (leaf.valueReference ? leaf.valueReference.display : ''));
        });
        if (row['m8.content']) rows.push(row);
      });
    }
    if (!rows.length) {
      rows = [{
        'm8.content': '加强危重患者病情动态评估，落实每 4 小时预警评分记录并纳入交接班清单',
        'm8.owner': ctx.attending.name, 'm8.due': fmtDay(ctx.deathMs + 30 * DAY),
        'm8.expected': '评分记录完整率达到 95% 以上，缺陷项清零。'
      }];
    }
    return rows;
  }
  function improveStubState(ctx, i) {
    // 历史（stub）病例的改进任务只产终态，避免污染「超时未落实清单」
    return weighted({ done: 92, cancelled: 8 });
  }
  function improveOpenState(ctx, i) {
    return weighted({ done: 55, 'in-progress': 15, 'not-started': 10, 'to-evaluate': 12, cancelled: 8 });
  }
  function createImprove(ctx, row, biz, round, parentTaskId, i) {
    var owner = resolveByName(row['m8.owner'], ctx.deptIdx);
    var dueMs = Limit.parse(row['m8.due']) || (ctx.archivedAtMs || ctx.deathMs) + 30 * DAY;
    // 演示用：开放态改进任务的截止时刻可由剧本指定（保证正常/临近/超时三态都有）
    var targets = (ctx.plan.improve && ctx.plan.improve.due) || (ctx.mode === 'full' ? ['normal', 'normal', 'soon', 'overdue'] : null);
    var openState = ['not-started', 'in-progress', 'to-evaluate'].indexOf(biz) >= 0;
    if (targets && openState) {
      var t = targets[i % targets.length];
      dueMs = t === 'soon' ? NOW_REF() + int(1, Limit.config().improveRemindDays) * DAY
        : (t === 'overdue' ? NOW_REF() - int(1, 9) * DAY : NOW_REF() + int(12, 40) * DAY);
    }
    var created = ctx.archivedAtMs || ctx.deathMs + 8 * DAY;
    var actual = biz === 'done' ? (biz === 'done' && ctx.plan.improve && ctx.plan.improve.late ? dueMs + int(2, 9) * DAY : dueMs - int(1, 6) * DAY) : null;
    if (ctx.mode === 'stub') actual = biz === 'done' ? actualMs('improve', ctx, !ctx.plan.improve || !ctx.plan.improve.late) : null;
    var id = F.seed({
      resourceType: 'Task',
      identifier: [{ system: 'urn:swbl:task-no', value: 'IM' + new Date(ctx.deathMs).getFullYear() + String(1000 + ctx.seq) + '-' + round + (i + 1) }],
      status: biz === 'done' ? 'completed' : (biz === 'cancelled' ? 'cancelled' : (biz === 'not-started' ? 'requested' : 'in-progress')),
      businessStatus: { coding: [codingOf('business-status', biz)], text: D.improveStatusName(biz) },
      intent: 'plan', priority: ctx.priority === 'high' ? 'high' : 'medium',
      code: { coding: [codingOf('task-kind', 'improvement')], text: '改进措施执行跟踪' },
      description: row['m8.content'],
      for: R_('Patient', ctx.pid, ctx.name),
      encounter: R_('Encounter', ctx.encId),
      owner: R_('Practitioner', owner.pid, owner.name),
      requestedPerformer: { reference: 'PractitionerRole/' + owner.role, display: owner.name },
      partOf: [{ reference: 'Task/' + (parentTaskId || ctx.discussTaskId) }],
      basedOn: [{ reference: 'Composition/' + (ctx.compId || ''), display: '来源讨论记录' }],
      authoredOn: new Date(created).toISOString(),
      lastModified: new Date(created).toISOString(),
      dueDate: new Date(dueMs).toISOString(),
      completedDate: actual ? new Date(actual).toISOString() : undefined,
      note: execNotes(ctx, owner, biz, created),
      ext: {
        taskKind: 'improvement', measureText: row['m8.content'], expectedEffect: row['m8.expected'],
        pdca: { round: round, root: parentTaskId || null, createdBy: '系统自动提取（讨论记录模块⑧）', confirmedBy: ctx.director.name },
        completionReport: (biz === 'to-evaluate' || biz === 'done') ? completionReport(ctx, owner, created) : null,
        excellent: biz === 'done' && weighted({ y: 8, n: 92 }) === 'y'
      }
    }).id;
    ctx.improveTaskIds = (ctx.improveTaskIds || []).concat([id]);
    if (biz === 'done') evaluate(id, ctx, true, created);
    if (biz === 'to-evaluate') { /* 尚未评估：等责任人报告后由科主任评估 */ }
    return id;
  }
  function completionReport(ctx, owner, created) {
    return {
      summary: '已按措施要求完成整改：' + pick(['组织全科培训并留存签到与考核记录；', '抽查近 40 份病历，相关记录完整率 96%；', '上线系统自动提醒功能并完成联调验收；']) + '佐证材料已上传。',
      effect: '实际效果' + pick(['与预期一致，关键指标改善明显；', '基本达到预期，同类问题未再发生；', '优于预期，流程执行稳定可持续。']),
      attachments: [{ name: '整改检查记录.xlsx', size: int(80, 900) + ' KB' }, { name: '培训考核签到表.pdf', size: int(200, 900) + ' KB' }],
      savedAt: Limit.dt(created + 11 * DAY), submittedAt: Limit.dt(created + 12 * DAY), by: owner.name
    };
  }
  function execNotes(ctx, owner, biz, created) {
    if (biz === 'not-started' || biz === 'cancelled') return [];
    var out = [{ authorReference: { display: owner.name }, time: new Date(created + 2 * DAY).toISOString(), text: '已按措施要求启动，完成责任分工与时间安排。' }];
    if (biz === 'in-progress') out.push({ authorReference: { display: owner.name }, time: new Date(created + 6 * DAY).toISOString(), text: '执行中：' + pick(['首轮培训已完成，考核安排中；', '清单已试运行，正在收集反馈；', '系统提醒功能联调中。']) });
    if (biz === 'to-evaluate' || biz === 'done') {
      out.push({ authorReference: { display: owner.name }, time: new Date(created + 9 * DAY).toISOString(), text: '措施全部落地，组织科内检查并留存记录。' });
      out.push({ authorReference: { display: owner.name }, time: new Date(created + 11 * DAY).toISOString(), text: '检查发现个别记录仍不规范，已现场整改并二次复核。' });
    }
    return out;
  }
  function evaluate(taskId, ctx, done, created) {
    var good = done ? weighted({ y: 84, n: 16 }) === 'y' : false;
    var need = good ? 'no' : 'yes';
    F.seed({
      resourceType: 'Observation', status: 'final',
      code: { coding: [codingOf('obs-code', 'improvement-eval')], text: '改进效果评估' },
      subject: { reference: 'Task/' + taskId },
      effectiveDateTime: new Date(created + 14 * DAY).toISOString(),
      performer: [R_('Practitioner', ctx.director.pid, ctx.director.name)],
      component: [
        { code: { coding: [{ code: 'implemented', display: '措施是否落实' }], text: '措施是否落实' }, valueCodeableConcept: { coding: [codingOf('eval', good ? 'yes' : 'partly')], text: good ? '已落实' : '部分落实' } },
        { code: { coding: [{ code: 'effective', display: '效果是否达到预期' }], text: '效果是否达到预期' }, valueCodeableConcept: { coding: [codingOf('eval', good ? 'yes' : 'partly')], text: good ? '达到预期' : '部分达到' } },
        { code: { coding: [{ code: 'continue', display: '是否需要持续改进' }], text: '是否需要持续改进' }, valueCodeableConcept: { coding: [codingOf('eval', need)], text: need === 'yes' ? '需要' : '不需要' } }
      ],
      ext: {
        obsKind: 'improvement-eval',
        detail: {
          opinion: good ? '措施落实到位，效果达到预期，同意关闭任务并纳入后续病例讨论参考。' : '措施部分落实，个别环节记录仍不完整，建议再跟踪一轮。',
          by: ctx.director.name, at: Limit.dt(created + 14 * DAY), excellent: good && weighted({ y: 10, n: 90 }) === 'y', nextRound: need === 'yes'
        }
      }
    });
    if (need === 'yes') {
      // 新一轮 PDCA 任务（第 2 轮），partOf 指向上一轮
      var t = F.view('Task', taskId);
      var prevRound = (t.ext.pdca || {}).round || 1;
      var row = {
        'm8.content': '（第 ' + (prevRound + 1) + ' 轮）继续巩固：' + (t.description || '') + '，重点整改上一轮发现的薄弱环节',
        'm8.owner': t.owner ? t.owner.display : ctx.attending.name,
        'm8.due': fmtDay(created + 45 * DAY),
        'm8.expected': '上一轮遗留缺陷项清零，相关指标稳定达标。'
      };
      createImprove(ctx, row, weighted({ 'in-progress': 60, 'not-started': 40 }), prevRound + 1, taskId, 9);
    }
  }

  /* —— 9. stub 收口（历史病例只产统计所需事实） —— */
  function stubClose(ctx) {
    var dp = ctx.plan.discuss || {}, rp = ctx.plan.report || {};
    if (!dp.never) {
      var actual = dp.late ? actualMs('discussion', ctx, false) : actualMs('discussion', ctx, true);
      var t = F.view('Task', ctx.discussTaskId);
      F.update(Object.assign({}, t, {
        executionPeriod: { start: new Date(ctx.deathMs).toISOString(), end: new Date(actual).toISOString() }
      }));
      ctx.discussActualMs = actual;
      var rows = [{
        'm8.content': pick(['加强危重患者病情动态评估与预警评分记录', '完善术后高危患者随访提醒机制', '组织急救流程与制度培训并考核', '规范交接班高风险环节清单']),
        'm8.owner': staff(ctx.deptIdx, weighted({ attending: 2, doctor: 1, senior: 1 }), 0).name,
        'm8.due': fmtDay(ctx.deathMs + int(15, 45) * DAY),
        'm8.expected': '相关环节执行率达到 90% 以上，缺陷项清零。'
      }];
      ctx.archivedAtMs = actual;
      ctx.compId = null;
      rows.forEach(function (row, i) {
        var biz = rp.never ? 'not-started' : improveStubState(ctx, i);
        createImprove(ctx, row, biz, 1, null, i);
      });
    }
    if (rp.never || rp.state === 'to-fill') { ctx.reportActualMs = null; return; }
    if (rp.late || rp.neverReport) { ctx.reportActualMs = actualMs('report', ctx, false); }
  }

  /* —— 10. 通知 —— */
  function notifications(ctx) {
    if (ctx.mode !== 'full') return;
    var dp = ctx.plan.discuss || {}, biz = ctx.reportBiz;
    if (dp.state === 'to-organize' || dp.never) {
      notify('task-created', ctx, { 任务名称: '组织死亡病例讨论', 时限: Limit.daysOf('discussion', ctx.deathType) + ' 天' });
      notify('task-created', ctx, { 任务名称: '填写死亡病例上报单', 时限: Limit.daysOf('report', ctx.deathType) + ' 天' });
    }
    if (dp.state === 'booked') {
      notify('meeting-invite', ctx, { 会议时间: Limit.dt(ctx.meetingMs) });
      notify('attend-remind', ctx, { 会议时间: Limit.dt(ctx.meetingMs) });
    }
    if (dp.state === 'to-sign') notify('task-created', ctx, { 任务名称: '讨论记录 CA 电子签名' });
    if (biz === 'level-1' || biz === 'level-2' || biz === 'level-3') {
      var n = Flow.currentNode(ctx.reportFlow);
      notify('review-task', ctx, { 提交人: ctx.attending.name, 审核时限: Limit.reviewHoursOf(n ? n.level : 1) + ' 小时' });
    }
    if (biz === 'returned') notify('review-result', ctx, { 审核人: (ctx.reportFlow.filter(function (x) { return x.status === 'returned'; })[0] || {}).actorName, 审核层级: '本级', 审核结果: '退回', 审核意见: '' });
    if (biz === 'done') notify('review-result', ctx, { 审核人: ctx.quality.name, 审核层级: '三级终审', 审核结果: '通过', 审核意见: '符合上报要求。' });
    // 超时/预警
    var cd = Limit.countdownOf('discussion', ctx);
    if (cd.overdue && (ctx.plan.discuss || {}).state !== 'archived') {
      notify('warn-red', ctx, { 任务名称: '组织死亡病例讨论', 超时时长: Limit.overdueDays(cd.deadline, null) + ' 天', 剩余占比: '0%' });
      notify('escalate', ctx, { 任务名称: '组织死亡病例讨论' });
    }
    var rc = Limit.countdownOf('report', ctx);
    if (rc.overdue && biz !== 'done') {
      notify('warn-red', ctx, { 任务名称: '死亡病例上报', 超时时长: Limit.overdueDays(rc.deadline, null) + ' 天' });
    } else if (rc.level === 'orange' && biz !== 'done') {
      notify('warn-orange', ctx, { 任务名称: '死亡病例上报', 截止时间: Limit.dt(rc.deadline) });
    }
    (ctx.improveTaskIds || []).forEach(function (id) {
      var t = F.view('Task', id);
      if (!t || !t.dueDate) return;
      var dueMs = Limit.parse(t.dueDate);
      var st = Limit.improveStateOf(dueMs);
      if (t.businessStatus && t.businessStatus.coding[0] && ['done', 'cancelled'].indexOf(t.businessStatus.coding[0].code) >= 0) return;
      if (st.state === 'overdue') { notify('warn-red', ctx, { 任务名称: '改进措施落实', 超时时长: st.text }); notify('escalate', ctx, { 任务名称: '改进措施落实' }); }
      else if (st.state === 'soon') notify('improve-remind', ctx, { 剩余天数: Math.ceil((dueMs - Date.now()) / DAY) + '', 完成时限: fmtDay(dueMs), 措施摘要: (t.description || '').slice(0, 18) });
    });
  }

  function notify(scene, ctx, vars) {
    var basic = F.view('Basic', 'Basic-notify-scenes');
    var list = basic && basic.ext && basic.ext.items ? basic.ext.items : [];
    var sc = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === scene) sc = list[i];
    if (!sc || !sc.enabled) return;
    var payload = {
      患者姓名: ctx.name, 住院号: ctx.mrn, 死亡时间: Limit.dt(ctx.deathMs),
      死亡类型: D.deathTypeName(ctx.deathType), 科室: ctx.deptName, 任务类型: ''
    };
    Object.keys(vars || {}).forEach(function (k) { payload[k] = vars[k]; });
    var title = render(sc.titleTpl, payload), body = render(sc.bodyTpl, payload);
    var targetUser = (sc.targets || []).map(function (t) {
      return t === 'quality' ? 'u-quality' : (t === 'director' ? D.deptDirectorUser(ctx.deptIdx) : ({ attending: 'u-attending', senior: 'u-senior', doctor: 'u-doctor' }[t] || t));
    });
    F.seed({
      resourceType: 'Communication', status: 'completed',
      category: [{ coding: [codingOf('notify-scene', scene)], text: sc.name }],
      sent: new Date(Date.now() - int(0, 40) * HOUR).toISOString(),
      subject: R_('Encounter', ctx.encId, ctx.name + ' 死亡病例'),
      recipient: (sc.targets || []).map(function (t) { return { reference: 'PractitionerRole/' + t, display: sceneName(t) }; }),
      medium: (sc.channels || []).map(function (c) {
        var ch = D.NOTIFY_CHANNELS.filter(function (x) { return x.code === c; })[0] || { name: c };
        return { coding: [codingOf('medium', c)], text: ch.name };
      }),
      payload: [{ contentString: body }],
      about: [{ reference: 'Encounter/' + ctx.encId }],
      ext: {
        scene: scene, title: title, read: chance(0.35), bizKind: 'encounter', bizId: ctx.encId,
        level: scene.indexOf('warn') === 0 ? scene.split('-')[1] : '',
        targetRole: (sc.targets || []).join(','), targetUser: targetUser.join(','),
        payload: { sceneName: sc.name, dept: ctx.deptName }
      }
    });
  }
  function render(tpl, vars) {
    return String(tpl).replace(/\{([^}]+)\}/g, function (m, k) { return vars[k] != null && vars[k] !== '' ? vars[k] : ''; });
  }

  function provenanceShowcase(ctx, plan) {
    (plan.provenance || []).forEach(function (p) {
      F.seed({
        resourceType: 'Provenance',
        activity: { coding: [codingOf('provenance-activity', p.code)], text: p.text },
        recorded: new Date(p.at || Date.now() - int(1, 40) * HOUR).toISOString(),
        agent: [{ who: R_('Practitioner', p.pid || ctx.attending.pid, p.name || ctx.attending.name) }],
        entity: [{ role: 'source', what: R_('Encounter', ctx.encId, ctx.name) }],
        ext: { activity: p.code, note: p.note, bizKind: 'encounter', bizId: ctx.encId, operatorName: p.name || ctx.attending.name }
      });
    });
  }

  /* —— 出院人数（死亡率分母）：按科室 × 月份 —— */
  function dischargeCounts(months) {
    var out = 0;
    for (var m = 0; m < months; m++) {
      var d = new Date(Date.now());
      d.setDate(1); d.setMonth(d.getMonth() - m);
      F.scan('Organization').forEach(function (raw) {
        var o = F.decode(raw);
        if (!o.ext.isClinical) return;
        var beds = o.ext.beds || 60;
        var value = Math.round(beds * (2.6 + R() * 1.3));
        F.seed({
          resourceType: 'Observation', status: 'final',
          code: { coding: [codingOf('obs-code', 'serv-pop-discharges')], text: '同期出院人数' },
          subject: { reference: 'Organization/' + o.id, display: o.name },
          effectivePeriod: { start: new Date(d.getFullYear(), d.getMonth(), 1).toISOString(), end: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59).toISOString() },
          valueQuantity: { value: value, unit: '人次', system: 'http://unitsofmeasure.org', code: '1' },
          ext: { obsKind: 'discharge-count', detail: { month: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), dept: o.name } }
        });
        out++;
      });
    }
    return out;
  }

  global.CaseFactory = {
    buildStaff: buildStaff, make: make, staff: staff, qualityStaff: qualityStaff,
    resolveByName: resolveByName, pickIcd: pickIcd, icdByCode: icdByCode,
    patientName: patientName, chance: chance, weighted: weighted, fmtDay: fmtDay, b64: b64,
    notify: notify, dischargeCounts: dischargeCounts, createImprove: createImprove,
    archive: archive, record: record, recordValues: recordValues, reportValues: reportValues,
    reportItems: reportItems, meeting: meeting, partialSign: partialSign, buildFlow: buildFlow,
    valueOf: valueOf, measureRows: measureRows, actualMs: actualMs, ICD: ICD, STAFF: STAFF,
    completionReport: completionReport, evaluate: evaluate, seq: function () { return SEQ.n; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
