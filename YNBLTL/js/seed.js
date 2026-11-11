/* ============================================================
   seed.js — 初始化基础演示数据（符合业务逻辑、相互关联）
   ------------------------------------------------------------
   生成 FHIR 资源：Organization / Practitioner / Patient / Encounter /
   Condition / Observation / DiagnosticReport / Flag(疑难病例标识) /
   CaseDiscussion(病例讨论) / Appointment(会议) / Composition(研讨记录) /
   Task(诊疗调整任务) / Communication(通知) / DocumentReference(文献) /
   AuditEvent(操作日志)，以及应用配置（业务规则/接口/权限）。
   ============================================================ */
(function (App) {
  "use strict";
  const F = App.fhir;
  const D = App.date;

  function ymd(s) { return new Date(s + "T00:00:00").toISOString(); }
  function dt(s) { return new Date(s).toISOString(); }

  function seedAll() {
    F.initEmpty();
    const db = {};

    /* ---------------- 科室 Organization ---------------- */
    const depts = ["心内科", "心外科", "呼吸科", "ICU", "急诊科", "骨科", "风湿免疫科", "血液科", "感染科", "神经内科",
      "消化内科", "普外科", "肿瘤科", "儿科", "妇产科", "麻醉科"];
    const orgs = {};
    depts.forEach((name, i) => {
      const id = "org-" + (i + 1);
      orgs[name] = id;
      put(db, { resourceType: "Organization", id, name, type: [{ text: "科室" }] });
    });

    /* ---------------- 医生/用户 Practitioner ---------------- */
    // role: attending(主管医生) director(科室主任) expert(会诊专家) qa(质管) admin(系统管理员)
    const docs = [
      { id: "prac-zmh", name: "张明华", dept: "心内科", title: "主治医师", role: "attending" },
      { id: "prac-lw", name: "李伟", dept: "呼吸科", title: "主治医师", role: "attending" },
      { id: "prac-ljg", name: "李建国", dept: "心内科", title: "主任医师", role: "director", alias: "李主任" },
      { id: "prac-zcz", name: "赵长征", dept: "骨科", title: "主任医师", role: "director", alias: "赵主任" },
      { id: "prac-ww", name: "王伟", dept: "心内科", title: "主任医师", role: "expert", alias: "王主任" },
      { id: "prac-zm", name: "赵敏", dept: "心外科", title: "副主任医师", role: "expert", alias: "赵副主任" },
      { id: "prac-ly", name: "刘洋", dept: "ICU", title: "主治医师", role: "expert", alias: "刘医生" },
      { id: "prac-cq", name: "陈强", dept: "呼吸科", title: "主任医师", role: "expert", alias: "陈主任" },
      { id: "prac-sl", name: "孙磊", dept: "急诊科", title: "主治医师", role: "expert", alias: "孙医生" },
      { id: "prac-wq", name: "吴强", dept: "骨科", title: "副主任医师", role: "expert", alias: "吴医生" },
      { id: "prac-zhm", name: "周敏", dept: "神经内科", title: "主任医师", role: "expert", alias: "周主任" },
      { id: "prac-lj", name: "李静", dept: "医疗质量管理部", title: "质控专员", role: "qa", alias: "李干事" },
      { id: "prac-zq", name: "赵强", dept: "信息中心", title: "系统管理员", role: "admin", alias: "赵管理" },
    ];
    // 追加更多在职医护人员，使其成为真实的医院科室及医生人员主数据（Practitioner），
    // 而不是仅存在于权限配置里的"孤立姓名"——这样权限配置「新增」时才能真正从人员名录中选择。
    const extraStaff = [
      ["林晓", "心内科"], ["黄涛", "呼吸科"], ["徐慧", "消化内科"], ["马俊", "神经内科"], ["高鹏", "普外科"],
      ["韩雪", "骨科"], ["曹斌", "肿瘤科"], ["彭丽", "儿科"], ["邓刚", "妇产科"], ["袁芳", "麻醉科"],
      ["蒋伟", "心内科"], ["沈洁", "呼吸科"], ["卢明", "消化内科"], ["范勇", "神经内科"], ["苏婷", "普外科"], ["钟晨", "骨科"],
    ];
    const roleCycle = ["attending", "attending", "attending", "expert", "expert", "director", "qa"];
    const titleByRole = { attending: "主治医师", expert: "主任医师", director: "主任医师", qa: "质控专员" };
    extraStaff.forEach(([name, dept], i) => {
      const role = roleCycle[i % roleCycle.length];
      const title = role === "expert" && i % 2 === 0 ? "副主任医师" : titleByRole[role];
      docs.push({ id: "prac-ext-" + i, name, dept, title, role, alias: name + "（" + dept + "）" });
    });
    docs.forEach((d) => {
      put(db, {
        resourceType: "Practitioner", id: d.id,
        name: [{ text: d.name }],
        qualification: [{ code: { text: d.title } }],
        extension: [
          { url: "dept", valueString: d.dept },
          { url: "role", valueString: d.role },
          { url: "alias", valueString: d.alias || d.name },
        ],
      });
    });
    const docName = (id) => { const p = docs.find((x) => x.id === id); return p ? p.name : id; };
    // 排班状态统一维护于 App.enums.scheduleMap（供会议创建页/追加邀请复用，避免多处数据不一致）

    /* ---------------- 病例定义（中心驱动数据） ---------------- */
    // 每个 case 派生：Patient/Encounter/Condition/Observation/Flag/CaseDiscussion/Appointment/Composition/Task/...
    const today = "2026-06-21";
    const cases = [
      {
        key: "zs", patient: "张三", gender: "male", age: 58, dept: "心内科", diagnosis: "急性心肌梗死",
        caseType: "diagnostic", urgency: "high", attending: "prac-zmh", director: "prac-ljg",
        dStatus: "completed", mStatus: "completed",
        admitDate: "2026-05-20", bed: "12床", code: "DIS20250612",
        identifiedAt: "2026-06-07T09:00:00", meetingTime: "2026-06-12T14:00:00", duration: 60, location: "心内科会议室A",
        chief: "突发胸痛4小时", present: "患者4小时前无明显诱因出现胸骨后压榨性疼痛，伴大汗、恶心，含服硝酸甘油不能缓解。", past: "高血压10年，2型糖尿病5年。",
        criteria: { stay: 32, keyword: "心肌病", adjust: 3, score: 82 },
        ai: { dirs: ["急性ST段抬高型心肌梗死（前壁）可能性高", "多支病变需评估介入指征"], risks: ["心源性休克风险", "高危出血风险"], time: "2026-06-07T08:55:00" },
        labs: [
          { name: "凝血四项", date: "2026-06-06", abn: true, summary: "PT 22.5s ↑  APTT 45s ↑" },
          { name: "心肌酶谱", date: "2026-06-03", abn: true, summary: "CK-MB 85U/L ↑  TnI 3.2 ↑" },
          { name: "冠脉CTA", date: "2026-06-05", abn: true, summary: "左前降支近段狭窄85%" },
        ],
        lits: ["2024 ESC急性冠脉综合征管理指南", "多支病变介入策略选择专家共识（2023）", "急性心梗抗凝方案最新临床研究"],
        record: { analysis: "患者急性心梗合并多支病变，心功能II级，凝血功能异常，需评估介入指征。", diagnosis: "急性ST段抬高型心肌梗死（前壁），建议行冠脉造影进一步评估。", treatment: "1. 调整抗凝方案为利伐沙班；2. 完善冠脉造影评估介入指征。", followup: "72h内复查凝血功能，1周后复查冠脉造影，持续监测心功能。" },
        participants: [
          { p: "prac-ww", status: "accepted", signed: "2026-06-12T15:20:00" },
          { p: "prac-zm", status: "accepted", signed: "2026-06-12T15:25:00" },
          { p: "prac-ly", status: "accepted", signed: "2026-06-12T15:30:00" },
          { p: "prac-cq", status: "accepted", signed: "2026-06-12T15:35:00" },
          { p: "prac-sl", status: "declined", signed: null },
        ],
        tasks: [
          { name: "调整抗凝方案", owner: "prac-zmh", status: "in-progress", due: "2026-06-22", node: 2 },
          { name: "72h内复查凝血功能", owner: "prac-zmh", status: "in-progress", due: "2026-06-23", node: 1 },
          // 注：due 必须晚于会议时间（2026-06-12）——任务是讨论会议的产物，不能早于会议本身，
          // 否则全流程时间轴会出现"已超时"节点排在"创建讨论会议"节点之前的错误顺序。
          { name: "调整降压用药方案", owner: "prac-lw", status: "overdue", due: "2026-06-15", node: 1 },
        ],
      },
      {
        key: "ls", patient: "李四", gender: "female", age: 45, dept: "风湿免疫科", diagnosis: "罕见系统性免疫疾病",
        caseType: "rare", urgency: "mid", attending: "prac-lw", director: "prac-ljg",
        dStatus: "pending", mStatus: "pending",
        admitDate: "2026-06-04", bed: "08床", code: "RAR20250605",
        identifiedAt: "2026-06-05T09:00:00", meetingTime: null, duration: 60, location: "",
        chief: "反复关节肿痛伴发热2月", present: "患者2月来反复多关节肿痛，间断发热，外院多种治疗效果不佳。", past: "既往体健。",
        criteria: { stay: 17, keyword: "罕见免疫", adjust: 2, score: 74 },
        ai: { dirs: ["疑似罕见自身免疫性疾病", "需完善自身抗体谱与基因检测"], risks: ["多器官受累风险", "诊断延迟风险"], time: "2026-06-05T08:50:00" },
        labs: [
          { name: "自身抗体谱", date: "2026-06-05", abn: true, summary: "ANA 1:1000 ↑ 多项阳性" },
          { name: "炎症指标", date: "2026-06-05", abn: true, summary: "ESR 78mm/h ↑  CRP 56mg/L ↑" },
        ],
        lits: ["罕见自身免疫病诊治专家共识（2023）", "系统性自身免疫病多学科诊疗路径"],
        record: null,
        participants: [],
        tasks: [],
      },
      {
        key: "ww", patient: "王五", gender: "male", age: 62, dept: "骨科", diagnosis: "复杂多发骨折",
        caseType: "treatment", urgency: "high", attending: "prac-zmh", director: "prac-zcz",
        dStatus: "ongoing", mStatus: "ongoing",
        admitDate: "2026-06-01", bed: "21床", code: "TRT20250609",
        identifiedAt: "2026-06-06T10:00:00", meetingTime: "2026-06-21T09:00:00", duration: 60, location: "骨科会议室B",
        chief: "外伤后多处疼痛活动受限1天", present: "患者高处坠落致多发骨折，合并骨质疏松，内固定方案选择困难。", past: "骨质疏松，慢性肾病3期。",
        criteria: { stay: 20, keyword: "复杂骨折", adjust: 2, score: 76 },
        ai: { dirs: ["复杂多发骨折，需评估手术与保守治疗指征", "合并肾功能不全影响用药选择"], risks: ["围手术期出血风险", "深静脉血栓风险"], time: "2026-06-06T09:50:00" },
        labs: [
          { name: "血常规", date: "2026-06-20", abn: true, summary: "Hb 92g/L ↓" },
          { name: "肾功能", date: "2026-06-20", abn: true, summary: "Cr 186μmol/L ↑" },
          { name: "骨密度", date: "2026-06-19", abn: true, summary: "T值 -3.2 重度骨质疏松" },
        ],
        lits: ["老年复杂骨折围手术期管理指南", "骨质疏松性骨折内固定策略"],
        record: { analysis: "复杂多发骨折合并重度骨质疏松及肾功能不全，需多学科评估手术指征与抗凝策略。", diagnosis: "多发骨折（待手术评估）。", treatment: "建议限期手术，围手术期个体化抗凝，调整镇痛方案避免肾毒性。", followup: "术后复查肾功能与凝血，康复随访。" },
        participants: [
          { p: "prac-wq", status: "accepted", signed: "2026-06-21T09:40:00" },
          { p: "prac-zm", status: "accepted", signed: "2026-06-21T09:45:00" },
          { p: "prac-ww", status: "accepted", signed: null },
          { p: "prac-ly", status: "accepted", signed: null },
        ],
        tasks: [],
      },
      {
        key: "zl", patient: "赵六", gender: "male", age: 50, dept: "呼吸科", diagnosis: "重症肺部感染",
        caseType: "diagnostic", urgency: "low", attending: "prac-lw", director: "prac-ljg",
        dStatus: "completed", mStatus: "completed",
        admitDate: "2026-05-22", bed: "15床", code: "DIS20250528",
        identifiedAt: "2026-05-28T09:00:00", meetingTime: "2026-06-05T09:00:00", duration: 60, location: "呼吸科会议室",
        chief: "发热咳嗽伴气促1周", present: "患者1周来高热、咳嗽、气促，胸部CT示双肺多发渗出。", past: "慢性阻塞性肺疾病。",
        criteria: { stay: 24, keyword: "重症肺炎", adjust: 2, score: 72 },
        ai: { dirs: ["重症社区获得性肺炎可能", "需排查特殊病原体感染"], risks: ["呼吸衰竭风险", "脓毒症风险"], time: "2026-05-28T08:40:00" },
        labs: [
          { name: "降钙素原", date: "2026-05-27", abn: true, summary: "PCT 4.6ng/mL ↑" },
          { name: "胸部CT", date: "2026-05-26", abn: true, summary: "双肺多发渗出实变" },
        ],
        lits: ["中国成人社区获得性肺炎诊治指南", "重症肺炎抗感染治疗共识"],
        record: { analysis: "重症肺部感染，经验性抗感染效果欠佳，需调整方案。", diagnosis: "重症社区获得性肺炎。", treatment: "升级抗生素方案，加强呼吸支持。", followup: "复查炎症指标与影像，评估疗效。" },
        participants: [
          { p: "prac-cq", status: "accepted", signed: "2026-06-05T10:00:00" },
          { p: "prac-ly", status: "accepted", signed: "2026-06-05T10:05:00" },
          { p: "prac-sl", status: "accepted", signed: "2026-06-05T10:08:00" },
        ],
        tasks: [
          { name: "更换抗生素方案", owner: "prac-lw", status: "completed", due: "2026-06-08", node: 4 },
          { name: "复查炎症指标", owner: "prac-lw", status: "completed", due: "2026-06-07", node: 4 },
        ],
      },
      {
        key: "zq", patient: "周七", gender: "female", age: 67, dept: "ICU", diagnosis: "重症急性胰腺炎",
        caseType: "treatment", urgency: "high", attending: "prac-zmh", director: "prac-ljg",
        dStatus: "completed", mStatus: "completed",
        admitDate: "2026-06-02", bed: "ICU-3床", code: "TRT20250618",
        identifiedAt: "2026-06-12T09:00:00", meetingTime: "2026-06-18T15:00:00", duration: 60, location: "ICU会议室",
        chief: "上腹剧痛伴恶心呕吐2天", present: "患者暴饮暴食后上腹剧痛，血淀粉酶显著升高，合并器官功能障碍。", past: "胆囊结石。",
        criteria: { stay: 19, keyword: "重症胰腺炎", adjust: 3, score: 88 },
        ai: { dirs: ["重症急性胰腺炎（胆源性）", "合并多器官功能障碍"], risks: ["休克风险", "感染性坏死风险"], time: "2026-06-12T08:45:00" },
        labs: [
          { name: "血淀粉酶", date: "2026-06-11", abn: true, summary: "AMY 1260U/L ↑" },
          { name: "腹部CT", date: "2026-06-10", abn: true, summary: "胰腺肿大伴渗出" },
        ],
        lits: ["中国急性胰腺炎诊治指南", "重症胰腺炎液体复苏策略"],
        record: { analysis: "重症急性胰腺炎合并器官功能障碍，需个体化液体复苏及营养支持。", diagnosis: "重症急性胰腺炎（胆源性）。", treatment: "目标导向液体复苏，早期肠内营养，必要时干预胆道。", followup: "动态监测器官功能与感染指标。" },
        participants: [
          { p: "prac-ly", status: "accepted", signed: "2026-06-18T16:10:00" },
          { p: "prac-cq", status: "accepted", signed: "2026-06-18T16:15:00" },
        ],
        tasks: [
          { name: "调整液体复苏方案", owner: "prac-zmh", status: "in-progress", due: "2026-06-24", node: 2 },
        ],
      },
      {
        key: "wb", patient: "吴八", gender: "male", age: 39, dept: "感染科", diagnosis: "不明原因发热",
        caseType: "diagnostic", urgency: "mid", attending: "prac-lw", director: "prac-ljg",
        dStatus: "pending", mStatus: "pending",
        admitDate: "2026-06-09", bed: "06床", code: "DIS20250615",
        identifiedAt: "2026-06-15T09:00:00", meetingTime: null, duration: 60, location: "",
        chief: "反复发热3周原因未明", present: "患者3周来反复发热，多项检查未明确病因。", past: "无特殊。",
        criteria: { stay: 16, keyword: "不明发热", adjust: 2, score: 71 },
        ai: { dirs: ["发热待查，需排查感染/肿瘤/结缔组织病", "建议完善PET-CT与骨髓检查"], risks: ["诊断延误风险"], time: "2026-06-15T08:30:00" },
        labs: [{ name: "炎症指标", date: "2026-06-14", abn: true, summary: "CRP 48mg/L ↑" }],
        lits: ["不明原因发热诊断流程专家共识"],
        record: null, participants: [], tasks: [],
      },
      {
        key: "zj", patient: "郑九", gender: "male", age: 71, dept: "血液科", diagnosis: "多发性骨髓瘤",
        caseType: "rare", urgency: "mid", attending: "prac-lw", director: "prac-ljg",
        dStatus: "completed", mStatus: "completed",
        admitDate: "2026-05-18", bed: "11床", code: "RAR20250602",
        identifiedAt: "2026-06-02T09:00:00", meetingTime: "2026-06-09T10:00:00", duration: 60, location: "血液科会议室",
        chief: "腰背痛伴乏力3月", present: "患者腰背痛、贫血，实验室检查提示单克隆免疫球蛋白升高。", past: "高血压。",
        criteria: { stay: 21, keyword: "骨髓瘤", adjust: 2, score: 79 },
        ai: { dirs: ["多发性骨髓瘤可能", "需骨髓穿刺及流式确诊"], risks: ["病理性骨折风险", "肾损害风险"], time: "2026-06-02T08:35:00" },
        labs: [{ name: "血清蛋白电泳", date: "2026-06-01", abn: true, summary: "M蛋白阳性" }],
        lits: ["多发性骨髓瘤诊断与治疗指南"],
        record: { analysis: "多发性骨髓瘤，合并贫血与骨损害。", diagnosis: "多发性骨髓瘤。", treatment: "启动规范化化疗方案，骨保护治疗。", followup: "定期复查血液学指标。" },
        participants: [{ p: "prac-cq", status: "accepted", signed: "2026-06-09T11:00:00" }, { p: "prac-zhm", status: "accepted", signed: "2026-06-09T11:05:00" }],
        tasks: [{ name: "启动化疗方案", owner: "prac-lw", status: "completed", due: "2026-06-12", node: 4 }],
      },
      {
        key: "qs", patient: "钱十", gender: "female", age: 34, dept: "心外科", diagnosis: "复杂先天性心脏病",
        caseType: "treatment", urgency: "high", attending: "prac-zmh", director: "prac-ljg",
        dStatus: "pending", mStatus: "scheduled",
        admitDate: "2026-06-12", bed: "心外-5床", code: "TRT20250625",
        identifiedAt: "2026-06-16T09:00:00", meetingTime: "2026-06-25T14:00:00", duration: 90, location: "心外科会议室A / 线上链接",
        chief: "活动后心悸气促加重", present: "患者复杂先心病，近期症状加重，手术方案需多学科评估。", past: "先天性心脏病。",
        criteria: { stay: 15, keyword: "复杂先心", adjust: 2, score: 80 },
        ai: { dirs: ["复杂先天性心脏病，需评估手术时机与术式", "合并肺动脉高压"], risks: ["手术风险高", "肺高压危象风险"], time: "2026-06-16T08:40:00" },
        labs: [{ name: "心脏超声", date: "2026-06-15", abn: true, summary: "复杂畸形伴肺动脉高压" }],
        lits: ["复杂先心病外科治疗指南"],
        record: null,
        participants: [
          { p: "prac-zm", status: "accepted", signed: null },
          { p: "prac-ww", status: "tentative", signed: null },
          { p: "prac-ly", status: "tentative", signed: null },
        ],
        tasks: [],
      },
    ];

    /* ---------------- 展开每个病例为 FHIR 资源 ---------------- */
    cases.forEach((c) => {
      const patientId = "pat-" + c.key;
      const mrn = "2025" + String(Math.floor(100000 + Math.random() * 800000));
      // Patient
      put(db, {
        resourceType: "Patient", id: patientId,
        identifier: [{ system: "住院号", value: mrn }],
        name: [{ text: c.patient }],
        gender: c.gender,
        extension: [{ url: "age", valueInteger: c.age }, { url: "dept", valueString: c.dept }],
      });
      // Encounter（住院）
      const encId = "enc-" + c.key;
      put(db, {
        resourceType: "Encounter", id: encId, status: "in-progress",
        subject: { reference: "Patient/" + patientId, display: c.patient },
        period: { start: ymd(c.admitDate) },
        serviceProvider: { display: c.dept },
        location: [{ location: { display: c.bed } }],
        reasonCode: [{ text: c.chief }],
        extension: [
          { url: "present-illness", valueString: c.present },
          { url: "past-history", valueString: c.past },
        ],
      });
      // Condition（诊断）
      put(db, {
        resourceType: "Condition", id: "cond-" + c.key,
        subject: { reference: "Patient/" + patientId },
        encounter: { reference: "Encounter/" + encId },
        code: { text: c.diagnosis },
        recordedDate: ymd(c.admitDate),
      });
      // Observation（检验检查报告）
      c.labs.forEach((lab, i) => {
        put(db, {
          resourceType: "Observation", id: "obs-" + c.key + "-" + i,
          status: "final", subject: { reference: "Patient/" + patientId },
          code: { text: lab.name }, effectiveDateTime: ymd(lab.date),
          valueString: lab.summary,
          interpretation: lab.abn ? [{ text: "异常" }] : [{ text: "正常" }],
        });
      });
      // 临床评分 Observation
      put(db, {
        resourceType: "Observation", id: "obs-score-" + c.key, status: "final",
        subject: { reference: "Patient/" + patientId }, code: { text: "临床评分" },
        valueQuantity: { value: c.criteria.score, unit: "分" },
      });
      // 医学文献 DocumentReference
      const litRefs = c.lits.map((title, i) => {
        const id = "doc-" + c.key + "-" + i;
        put(db, { resourceType: "DocumentReference", id, status: "current", type: { text: "医学文献" }, subject: { reference: "Patient/" + patientId }, description: title });
        return { reference: "DocumentReference/" + id, display: title };
      });
      // AI 病情分析 DocumentReference
      put(db, {
        resourceType: "DocumentReference", id: "ai-" + c.key, status: "current",
        type: { text: "AI病情分析" }, subject: { reference: "Patient/" + patientId },
        date: dt(c.ai.time),
        content: [{ attachment: { data: JSON.stringify(c.ai) } }],
      });
      // Flag（疑难病例识别标识）
      const rules = F.config.get("rules") || defaultRules();
      const idRule = rules.identify;
      const crit = c.criteria;
      const critRows = [
        { name: "住院时长", value: crit.stay + "天", threshold: "≥" + idRule.stayDays + "天", met: crit.stay >= idRule.stayDays },
        { name: "诊断关键词", value: crit.keyword, threshold: "-", met: true },
        { name: "治疗方案调整次数", value: crit.adjust + "次", threshold: "≥" + idRule.adjustTimes + "次", met: crit.adjust >= idRule.adjustTimes },
        { name: "临床评分", value: crit.score + "分", threshold: "≥" + idRule.score + "分", met: crit.score >= idRule.score },
      ];
      put(db, {
        resourceType: "Flag", id: "flag-" + c.key, status: "active",
        subject: { reference: "Patient/" + patientId },
        code: { text: "疑难病例：" + App.caseTypeLabel(c.caseType) },
        period: { start: dt(c.identifiedAt) },
        extension: [
          { url: "case-type", valueString: c.caseType },
          { url: "urgency", valueString: c.urgency },
          { url: "source", valueString: "auto" },
          { url: "trigger-rule", valueString: "住院时长≥" + idRule.stayDays + "天 + 治疗方案调整≥" + idRule.adjustTimes + "次" },
          { url: "criteria", valueString: JSON.stringify(critRows) },
        ],
      });

      // CaseDiscussion（病例讨论，中心实体）
      const cdId = "cd-" + c.key;
      put(db, {
        resourceType: "CaseDiscussion", id: cdId, status: c.dStatus,
        caseCode: c.code,
        subject: { reference: "Patient/" + patientId, display: c.patient },
        encounter: { reference: "Encounter/" + encId },
        flag: { reference: "Flag/flag-" + c.key },
        attending: { reference: "Practitioner/" + c.attending, display: docName(c.attending) },
        director: { reference: "Practitioner/" + c.director, display: docName(c.director) },
        caseType: c.caseType, urgency: c.urgency, dept: c.dept, diagnosis: c.diagnosis,
        createdAt: dt(c.identifiedAt),
        aiRef: "DocumentReference/ai-" + c.key,
        litRefs,
      });

      // 确保责任医生（主管医生）在已产生会议安排的病例中本身也是参会人员之一——
      // 病例讨论正是围绕其患者展开，若唯独遗漏责任医生，会导致其无法进入研讨记录页
      // （"进入研讨"被判定为无权限）。已完成的会议中一并补齐其签名，保持数据自洽。
      if (c.mStatus !== "pending" && !c.participants.some((pp) => pp.p === c.attending)) {
        c.participants = c.participants.concat([{
          p: c.attending, status: "accepted",
          signed: c.dStatus === "completed" ? addMin(c.meetingTime, 5) : null,
        }]);
      }

      // Appointment（会议安排）
      const apptId = "appt-" + c.key;
      const partList = c.participants.map((pp) => ({
        actor: { reference: "Practitioner/" + pp.p, display: docName(pp.p) },
        status: pp.status,
        dept: (docs.find((d) => d.id === pp.p) || {}).dept,
        title: (docs.find((d) => d.id === pp.p) || {}).title,
        signedAt: pp.signed ? dt(pp.signed) : null,
      }));
      put(db, {
        resourceType: "Appointment", id: apptId, status: c.mStatus,
        description: c.diagnosis + "疑难病例讨论",
        discussion: { reference: "CaseDiscussion/" + cdId },
        start: c.meetingTime ? dt(c.meetingTime) : null,
        minutesDuration: c.duration,
        location: c.location,
        creator: { reference: "Practitioner/" + c.director, display: docName(c.director) },
        participant: partList,
        purpose: c.dept === "心内科" ? "明确诊断方向，制定后续治疗方案" : "多学科评估，制定个体化诊疗方案",
        reminders: ["会前1小时", "会前24小时"],
        autoNotify: true,
        sourceType: "auto",
      });

      // Composition（病例研讨记录 + 电子签名）
      if (c.record) {
        const attesters = c.participants.filter((p) => p.signed).map((p) => ({ party: { reference: "Practitioner/" + p.p, display: docName(p.p) }, time: dt(p.signed), mode: "legal" }));
        const locked = c.dStatus === "completed";
        put(db, {
          resourceType: "Composition", id: "comp-" + c.key,
          status: locked ? "final" : "preliminary",
          type: { text: "病例研讨记录" },
          subject: { reference: "Patient/" + patientId, display: c.patient },
          discussion: { reference: "CaseDiscussion/" + cdId },
          date: c.meetingTime ? dt(c.meetingTime) : null,
          section: [
            { title: "病情分析", text: c.record.analysis },
            { title: "诊断意见", text: c.record.diagnosis },
            { title: "治疗建议", text: c.record.treatment },
            { title: "后续随访计划", text: c.record.followup },
          ],
          attester: attesters,
          locked,
        });
      }

      // Task（诊疗调整任务）
      c.tasks.forEach((t, i) => {
        const taskId = "task-" + c.key + "-" + i;
        const detail = taskDetail(t.name);
        const nodes = execNodes(t.node, t.status, c.meetingTime || c.identifiedAt);
        const statusFhir = t.status === "overdue" ? "in-progress" : t.status; // FHIR无overdue，用businessStatus标记
        put(db, {
          resourceType: "Task", id: taskId,
          status: statusFhir,
          businessStatus: { text: t.status },     // requested / in-progress / completed / overdue
          intent: "order",
          code: { text: t.name },
          for: { reference: "Patient/" + patientId, display: c.patient },
          owner: { reference: "Practitioner/" + t.owner, display: docName(t.owner) },
          requester: { reference: "CaseDiscussion/" + cdId },
          focus: { reference: "CaseDiscussion/" + cdId },
          authoredOn: dt(addMin(c.meetingTime || c.identifiedAt, 100)),
          restriction: { period: { end: ymd(t.due) } },
          urgency: c.urgency,
          adjustment: detail.adjustment,
          orders: detail.orders,
          checks: detail.checks.map((x, j) => Object.assign({}, x, { done: t.status === "completed" || (t.status === "in-progress" && t.node >= 3 && j === 0) })),
          orderConfirm: detail.orderConfirm.map((x) => ({ text: x, done: t.node >= 2 || t.status === "completed", time: (t.node >= 2 || t.status === "completed") ? dt(addMin(c.meetingTime || c.identifiedAt, 130)) : null })),
          comparison: detail.comparison,
          execNotes: t.node >= 2 ? [{ text: "患者耐受良好，暂无明显不良反应，继续观察。", by: docName(t.owner), time: dt(addMin(c.meetingTime || c.identifiedAt, 1200)) }] : [],
          executionNote: t.status === "completed" ? "患者耐受良好，暂无明显不良反应，继续观察。" : "",
          nodes,
        });
        // 任务操作日志（AuditEvent）
        F.logOp({ who: "系统", action: "C", opType: "系统", what: "自动生成诊疗调整任务", about: "Task/" + taskId });
        if (t.node >= 1) F.logOp({ who: docName(t.owner), action: "R", opType: "查看", what: "查看任务详情", about: "Task/" + taskId });
        if (t.node >= 2) {
          F.logOp({ who: docName(t.owner), action: "U", opType: "执行", what: "确认调整医嘱：" + detail.orderConfirm.join("、"), about: "Task/" + taskId });
        }
        if (t.node >= 3) F.logOp({ who: docName(t.owner), action: "U", opType: "执行", what: "录入检查结果", about: "Task/" + taskId });
        if (t.status === "completed") F.logOp({ who: docName(t.owner), action: "U", opType: "执行", what: "提交执行结果，任务办结", about: "Task/" + taskId });
      });

      // Communication（通知）：讨论任务通知、参会邀请、待办、超时预警
      addNotice(db, {
        category: "discussion", subject: cdId, patient: c.patient,
        recipient: c.director, sender: "系统",
        sent: c.identifiedAt,
        title: "疑难病例讨论任务通知",
        body: "患者" + c.patient + "（住院号" + mrn + "）识别为" + App.caseTypeLabel(c.caseType) + "，任务来源：系统自动识别。",
      });
      c.participants.forEach((pp) => {
        if (c.meetingTime) addNotice(db, {
          category: "invitation", subject: apptId, patient: c.patient, recipient: pp.p, sender: c.director,
          sent: c.meetingTime, title: "病例讨论参会邀请",
          body: "邀请您参加「" + c.patient + " - " + c.diagnosis + "」讨论会议，时间：" + D.fmtDateTime(c.meetingTime),
        });
      });
      c.tasks.forEach((t) => {
        addNotice(db, {
          category: "task", subject: "Task", patient: c.patient, recipient: t.owner, sender: "系统",
          sent: addMin(c.meetingTime || c.identifiedAt, 100), title: "诊疗调整待办任务",
          body: "您有新的诊疗调整任务「" + t.name + "」，截止：" + t.due,
        });
        if (t.status === "overdue") addNotice(db, {
          category: "alert", subject: "Task", patient: c.patient, recipient: c.director, sender: "系统",
          sent: t.due, title: "⚠ 任务超时预警", level: "danger",
          body: "任务「" + t.name + "」（责任人" + docName(t.owner) + "）已超时未执行。",
        });
      });
    });

    /* ---------------- 应用配置：业务规则 / 接口 / 权限 ---------------- */
    F.config._init({
      rules: defaultRules(),
      interfaces: defaultInterfaces(),
      permissions: defaultPermissions(docs),
      permLogs: [
        { by: "赵管理", target: "王主任", change: "角色变更：主管医生→科室主任", time: "2026-06-07T14:30:00" },
        { by: "赵管理", target: "孙医生", change: "权限状态：启用→禁用", time: "2026-06-06T09:15:00" },
        { by: "赵管理", target: "陈教授", change: "新增权限配置", time: "2026-06-05T16:00:00" },
      ],
      configChanges: [
        { by: "赵管理", what: "住院阈值30→40天", time: "2026-06-09T10:00:00", module: "业务规则配置" },
        { by: "赵管理", what: "权限：王主任 主管医生→科室主任", time: "2026-06-07T14:30:00", module: "权限配置" },
        { by: "赵管理", what: "更新文献库接口Token", time: "2026-06-05T11:20:00", module: "接口维护" },
      ],
    });

    F._mergeDb(db);
  }

  /* ---------------- 默认配置生成器 ---------------- */
  function defaultRules() {
    return {
      // 说明：病例识别/分类/通知三类规则均为系统正常运行的必要配置，不提供"停用"开关
      // （识别规则一旦停用系统将无法判断疑难病例），因此不再保留 status 字段与版本回滚，
      // 仅保留 lastModified + 操作日志用于追溯变更。
      identify: {
        stayDays: 14, keywords: ["心肌病", "罕见", "重症", "复杂", "不明原因", "骨髓瘤"],
        adjustTimes: 2, score: 70, lastModified: "2026-06-09T10:00:00",
        logs: [
          { by: "张管理", time: "2026-06-09", what: "住院阈值30→40天", type: "修改" },
          { by: "张管理", time: "2026-05-15", what: "新增诊断关键词3个", type: "修改" },
          { by: "张管理", time: "2026-04-01", what: "初始配置", type: "新增" },
        ],
      },
      classify: {
        diagnostic: "诊断不明确、需多学科会诊明确诊断方向",
        treatment: "诊断明确但治疗方案选择困难或疗效不佳",
        rare: "符合罕见病目录或发病率极低的疑难病例",
        priority: ["诊断疑难", "治疗疑难", "罕见病"],
        lastModified: "2026-06-01T09:00:00",
        logs: [{ by: "张管理", time: "2026-06-01", what: "调整类型优先级", type: "修改" }],
      },
      notify: {
        triggers: { onIdentify: true, onDiscuss: true, onDue: true },
        channels: { inApp: true, sms: false },
        target: ["director", "attending", "expert"],   // 勾选式：通知对象角色
        frequency: "instant", customTime: "09:00",       // 自定义频率时的推送时间
        lastModified: "2026-05-20T09:00:00",
        logs: [{ by: "张管理", time: "2026-05-20", what: "初始配置", type: "新增" }],
      },
    };
  }

  function defaultInterfaces() {
    return [
      { id: "if-his", name: "HIS接口", system: "HIS系统", status: "normal", responseMs: 120, lastCheck: "2026-06-09T14:30:00", url: "https://his.hospital.cn/api/v1/patient", auth: "OAuth2.0", freq: "实时", syncLogs: defaultSync(true) },
      { id: "if-emr", name: "电子病历接口", system: "电子病历系统", status: "normal", responseMs: 85, lastCheck: "2026-06-09T14:30:00", url: "https://emr.hospital.cn/api/v1/record", auth: "OAuth2.0", freq: "实时", syncLogs: defaultSync(true) },
      { id: "if-ai", name: "AI中台接口", system: "AI分析中台", status: "normal", responseMs: 230, lastCheck: "2026-06-09T14:30:00", url: "https://ai.hospital.cn/api/v1/analyze", auth: "Token认证", freq: "实时", syncLogs: defaultSync(true) },
      {
        id: "if-lib", name: "文献库接口", system: "医学文献库", status: "error", responseMs: null, lastCheck: "2026-06-09T14:30:00",
        url: "https://lib.hospital.cn/api/v2/literature", auth: "Token认证", freq: "每6小时", token: "lib-token-9f8e7d6c5b4a",
        anomaly: { type: "连接超时", start: "2026-06-09T13:45:00", durationMin: 45, scope: "文献检索与推荐功能不可用" },
        syncLogs: defaultSync(false),
      },
      { id: "if-ca", name: "CA签名接口", system: "CA签名系统", status: "normal", responseMs: 95, lastCheck: "2026-06-09T14:30:00", url: "https://ca.hospital.cn/api/v1/sign", auth: "Token认证", freq: "实时", syncLogs: defaultSync(true) },
    ];
  }
  function defaultSync(ok) {
    const base = [
      { time: "2026-06-09T12:00:00", count: 156, status: ok ? "success" : "fail", cost: ok ? "1.3s" : "超时", note: ok ? "-" : "连接超时" },
      { time: "2026-06-09T06:00:00", count: 203, status: "success", cost: "1.2s", note: "-" },
      { time: "2026-06-09T00:00:00", count: 189, status: "success", cost: "1.5s", note: "-" },
      { time: "2026-06-08T18:00:00", count: 175, status: "success", cost: "1.1s", note: "-" },
      { time: "2026-06-08T12:00:00", count: 198, status: "partial", cost: "2.8s", note: "3条数据格式异常" },
    ];
    return base;
  }

  function defaultPermissions(docs) {
    const moduleMap = {
      attending: { mods: ["个人工作台"], matrix: { "个人工作台": [1, 1, 0, 1] } },
      director: { mods: ["讨论组织及跟踪管理", "质量监控报表"], matrix: { "讨论组织及跟踪管理": [1, 1, 1, 1], "质量监控报表": [1, 0, 0, 1] } },
      expert: { mods: ["讨论组织及跟踪管理(部分)"], matrix: { "讨论组织及跟踪管理": [1, 1, 0, 1] } },
      qa: { mods: ["质量监控报表"], matrix: { "质量监控报表": [1, 0, 0, 1] } },
      admin: { mods: ["系统配置管理"], matrix: { "系统配置管理": [1, 1, 1, 1] } },
    };
    const roleLabel = { attending: "主管医生", director: "科室主任", expert: "会诊专家", qa: "医疗质量管理部门", admin: "系统管理员" };
    // 所有人员（含扩充的在职医护人员）均已作为真实 Practitioner 主数据存在，
    // 权限配置列表按人员名录统一生成，保证"用户名"与医院科室/医生人员信息一致。
    const list = docs.map((d, i) => ({
      id: "perm-" + d.id, userId: d.id, user: d.alias || d.name, role: roleLabel[d.role],
      roleKey: d.role, modules: moduleMap[d.role].mods, matrix: clone(moduleMap[d.role].matrix),
      enabled: !(d.id === "prac-sl" || i % 11 === 0 && d.id.indexOf("prac-ext-") === 0),
    }));
    return list;
  }

  /* ---------------- 任务详情模板（按任务名称） ---------------- */
  function taskDetail(name) {
    if (name.indexOf("抗凝") >= 0) {
      return {
        adjustment: "根据病例讨论结论，建议将当前华法林方案调整为利伐沙班，需密切监测凝血功能变化。",
        orders: ["凝血功能检查（PT/APTT）— 需在用药前完成", "肝肾功能复查 — 调整用药后48小时内"],
        orderConfirm: ["已停用华法林 2.5mg qd", "已起用利伐沙班 15mg bid", "已下达凝血功能检查医嘱"],
        treatment: ["停用华法林 2.5mg qd", "起用利伐沙班 15mg bid（前21天），后改为20mg qd", "72小时内复查凝血四项"],
        checks: [{ name: "凝血功能检查", result: "PT 18.5s / APTT 42s" }, { name: "肝肾功能复查", result: "正常" }],
        comparison: [
          { item: "抗凝用药", old: "华法林 2.5mg qd", neu: "利伐沙班 15mg bid（前21天）→ 20mg qd", changed: true },
          { item: "凝血功能监测", old: "每周1次", neu: "调整后72h内复查", changed: true },
          { item: "肝肾功能复查", old: "每月1次", neu: "调整后48h内", changed: true },
        ],
      };
    }
    if (name.indexOf("抗生素") >= 0) {
      return {
        adjustment: "经验性抗感染疗效不佳，建议升级抗生素方案并完善病原学检查。",
        orders: ["痰培养及药敏 — 用药前留取", "降钙素原复查 — 48小时后"],
        orderConfirm: ["已停用一线抗生素", "已升级为广谱抗生素方案", "已下达病原学检查医嘱"],
        treatment: ["升级抗生素方案", "加强呼吸支持", "动态评估疗效"],
        checks: [{ name: "降钙素原复查", result: "PCT 1.2ng/mL ↓" }, { name: "胸部CT复查", result: "渗出较前吸收" }],
        comparison: [
          { item: "抗生素方案", old: "一线经验性方案", neu: "广谱升级方案", changed: true },
          { item: "病原学检查", old: "未完善", neu: "痰培养+药敏", changed: true },
        ],
      };
    }
    if (name.indexOf("降压") >= 0) {
      return {
        adjustment: "血压控制不佳，建议调整降压用药方案。",
        orders: ["动态血压监测", "电解质复查"],
        orderConfirm: ["已调整降压药物组合", "已下达动态血压监测医嘱"],
        treatment: ["联合用药方案调整", "目标血压<130/80mmHg"],
        checks: [{ name: "动态血压监测", result: "待录入" }, { name: "电解质复查", result: "待录入" }],
        comparison: [
          { item: "降压方案", old: "单药控制", neu: "联合用药方案", changed: true },
          { item: "血压监测", old: "每日1次", neu: "动态血压监测", changed: true },
        ],
      };
    }
    if (name.indexOf("复查凝血") >= 0) {
      return {
        adjustment: "调整抗凝方案后需按时复查凝血功能，评估抗凝效果与出血风险。",
        orders: ["凝血四项 — 调整后72小时复查"],
        orderConfirm: ["已下达72h凝血复查医嘱"],
        treatment: ["72h内复查凝血四项", "根据结果调整剂量"],
        checks: [{ name: "凝血四项复查", result: "待录入" }],
        comparison: [{ item: "凝血监测频率", old: "每周1次", neu: "调整后72h复查", changed: true }],
      };
    }
    // 通用
    return {
      adjustment: "根据讨论结论，制定" + name + "的个体化执行方案。",
      orders: ["相关检查 — 按医嘱完成"],
      orderConfirm: ["已确认调整医嘱"],
      treatment: ["按讨论结论执行" + name],
      checks: [{ name: "相关复查", result: "待录入" }],
      comparison: [{ item: name, old: "原方案", neu: "调整后方案", changed: true }],
    };
  }

  // 执行节点
  function execNodes(node, status, baseTime) {
    const labels = ["接收任务", "确认调整医嘱", "完成检查项", "反馈执行结果"];
    const times = [30, 100, 600, 1400];
    const doneCount = status === "completed" ? 4 : node;
    return labels.map((l, i) => ({
      label: l, done: i < doneCount,
      time: i < doneCount ? dt(addMin(baseTime, times[i])) : null,
    }));
  }

  /* ---------------- 通知工具 ---------------- */
  function addNotice(db, n) {
    const id = App.util.uid("comm");
    put(db, {
      resourceType: "Communication", id, status: "completed",
      category: [{ text: n.category }],
      subject: n.patient ? { display: n.patient } : undefined,
      about: n.subject ? [{ reference: n.subject }] : undefined,
      recipient: [{ reference: "Practitioner/" + n.recipient }],
      sender: { display: n.sender },
      sent: dt(n.sent),
      payload: [{ contentString: n.body }],
      topic: { text: n.title },
      priority: n.level === "danger" ? "urgent" : "routine",
      read: false,
    });
  }

  /* ---------------- 杂项 ---------------- */
  function put(db, res) { (db[res.resourceType] = db[res.resourceType] || {})[res.id] = res; return res; }
  function addMin(base, min) { const d = new Date(base); d.setMinutes(d.getMinutes() + min); return d.toISOString(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // 暴露任务模板生成器，供 domain.js 自动生成诊疗调整任务时复用（此前未导出，
  // 自动生成的任务因此拿不到医嘱/检查/方案对比模板，内容过于笼统）。
  App.taskTemplates = taskDetail;

  App.seed = { seedAll, ensure() { if (!App.fhir.isSeeded()) seedAll(); } };
})(window.App);
