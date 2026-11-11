/* ============================================================
   domain.js — 业务领域服务层（基于 FHIR 资源派生业务视图与操作）
   ============================================================ */
(function (App) {
  "use strict";
  const F = App.fhir, D = App.date;

  /* ---------- 读取与组装 ---------- */
  function cases() { return F.all("CaseDiscussion"); }
  function caseById(id) { return F.read("CaseDiscussion", id); }
  function caseByPatientName(name) { return cases().find((c) => c.subject.display === name); }

  function patientOf(c) { return F.read("Patient", refId(c.subject.reference)); }
  function flagOf(c) { return F.read("Flag", refId(c.flag.reference)); }
  function encounterOf(c) { return F.read("Encounter", refId(c.encounter.reference)); }
  function apptOf(c) { return F.all("Appointment").find((a) => a.discussion && refId(a.discussion.reference) === c.id); }
  function compOf(c) { return F.all("Composition").find((x) => x.discussion && refId(x.discussion.reference) === c.id); }
  function tasksOf(c) { return F.all("Task").filter((t) => t.focus && refId(t.focus.reference) === c.id); }
  function labsOf(c) { return F.all("Observation").filter((o) => refId(o.subject.reference) === refId(c.subject.reference) && o.code.text !== "临床评分"); }
  function litsOf(c) { return (c.litRefs || []).map((r) => F.read("DocumentReference", refId(r.reference))).filter(Boolean); }
  function aiOf(c) {
    const d = F.read("DocumentReference", refId(c.aiRef));
    if (!d || !d.content) return null;
    try { return JSON.parse(d.content[0].attachment.data); } catch (e) { return null; }
  }

  function refId(ref) { return ref ? ref.split("/")[1] : null; }
  function mrn(p) { return p && p.identifier && p.identifier[0] ? p.identifier[0].value : ""; }
  function ageOf(p) { return App.auth.ext(p, "age"); }
  function genderText(g) { return g === "male" ? "男" : g === "female" ? "女" : "—"; }

  /* ---------- 任务有效状态（动态计算超时） ---------- */
  function taskStatus(t) {
    const biz = t.businessStatus ? t.businessStatus.text : t.status;
    if (biz === "completed") return "completed";
    const due = t.restriction && t.restriction.period ? t.restriction.period.end : null;
    if (due && D.deadlineState(due, false) === "overdue") return "overdue";
    return biz; // requested / in-progress
  }
  function taskDeadlineState(t) {
    const due = t.restriction && t.restriction.period ? t.restriction.period.end : null;
    return D.deadlineState(due, taskStatus(t) === "completed");
  }
  function dueOf(t) { return t.restriction && t.restriction.period ? t.restriction.period.end : null; }

  /* ---------- 当前用户视角 ---------- */
  function myCases() {
    const u = App.auth.current();
    return cases().filter((c) => refId(c.attending.reference) === u.id);
  }
  function myTasks() {
    const u = App.auth.current();
    return F.all("Task").filter((t) => refId(t.owner.reference) === u.id);
  }
  // 会诊专家：我被邀请参与的会议
  function myMeetings() {
    const u = App.auth.current();
    return F.all("Appointment").filter((a) => (a.participant || []).some((p) => refId(p.actor.reference) === u.id));
  }
  // 当前用户是否为某病例讨论会议的受邀参会人员（不区分角色——例如主管医生受邀参与
  // 自己患者的讨论时，即便其角色导航里没有"讨论组织及跟踪管理"模块，也应视为有权进入）
  function isMeetingParticipant(caseId) {
    const c = caseById(caseId);
    if (!c) return false;
    const a = apptOf(c);
    const u = App.auth.current();
    return !!(a && (a.participant || []).some((p) => refId(p.actor.reference) === u.id));
  }

  // 统一的病例筛选：科室 / 病例类型 / 时间范围（按病例生成/识别时间）
  function filterCases(filter) {
    let cs = cases();
    if (!filter) return cs;
    if (filter.dept) cs = cs.filter((c) => c.dept === filter.dept);
    if (filter.caseType) cs = cs.filter((c) => c.caseType === filter.caseType);
    if (filter.from) cs = cs.filter((c) => new Date(c.createdAt) >= new Date(filter.from + "T00:00:00"));
    if (filter.to) cs = cs.filter((c) => new Date(c.createdAt) <= new Date(filter.to + "T23:59:59"));
    return cs;
  }

  /* ---------- 统计 / KPI ---------- */
  function kpis(filter) {
    const cs = filterCases(filter);
    const csIds = new Set(cs.map((c) => c.id));
    const ts = F.all("Task").filter((t) => csIds.has(refId(t.focus.reference)));
    const discTotal = cs.length;
    const discDone = cs.filter((c) => c.status === "completed").length;
    const taskDone = ts.filter((t) => taskStatus(t) === "completed").length;
    const taskTotal = ts.length;
    // 平均讨论周期：识别 → 会议时间（天）
    const cycles = cs.map((c) => { const a = apptOf(c); return a && a.start ? D.daysBetween(c.createdAt, a.start) : null; }).filter((x) => x != null);
    const avgCycle = cycles.length ? (App.util.sum(cycles) / cycles.length) : 0;
    return {
      discRate: App.util.pct(discDone, discTotal),
      taskRate: App.util.pct(taskDone, taskTotal),
      avgCycle: Math.round(avgCycle * 10) / 10,
      discTotal, discDone, taskTotal, taskDone,
    };
  }

  function deptRanking(filter) {
    const cs0 = filterCases(filter && Object.assign({}, filter, { dept: null })); // 排名维度本身是科室，筛选条件里的科室不参与预过滤
    const byDept = App.util.groupBy(cs0, (c) => c.dept);
    const rows = Object.keys(byDept).map((dept) => {
      const cs = byDept[dept];
      const csIds = new Set(cs.map((c) => c.id));
      const ts = F.all("Task").filter((t) => csIds.has(refId(t.focus.reference)));
      const discRate = App.util.pct(cs.filter((c) => c.status === "completed").length, cs.length);
      const taskRate = App.util.pct(ts.filter((t) => taskStatus(t) === "completed").length, ts.length);
      return { dept, discRate, taskRate, count: cs.length };
    });
    rows.sort((a, b) => b.discRate - a.discRate || b.count - a.count);
    rows.forEach((r, i) => (r.rank = i + 1));
    return rows;
  }

  // 病例数量趋势（按月，近6个月）——按病例实际识别时间/任务完成时间统计，不再使用写死的基线数字
  function monthlyTrend(filter) {
    const cs = filterCases(filter);
    const csIds = new Set(cs.map((c) => c.id));
    const ts = F.all("Task").filter((t) => csIds.has(refId(t.focus.reference)) && taskStatus(t) === "completed");
    const months = [];
    const base = D.now();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      months.push({ y: d.getFullYear(), m: d.getMonth(), label: (d.getMonth() + 1) + "月" });
    }
    const sameMonth = (dstr, mm) => { if (!dstr) return false; const d = new Date(dstr); return d.getFullYear() === mm.y && d.getMonth() === mm.m; };
    return months.map((mm) => {
      const idCount = cs.filter((c) => sameMonth(c.createdAt, mm)).length;
      const discCount = cs.filter((c) => c.status === "completed" && sameMonth(c.createdAt, mm)).length;
      const taskCount = ts.filter((t) => { const last = t.nodes && t.nodes.length ? t.nodes[t.nodes.length - 1].time : t.authoredOn; return sameMonth(last, mm); }).length;
      return { label: mm.label, values: [idCount, discCount, taskCount] };
    });
  }

  /* ---------- 通知 ---------- */
  function myNotifications() {
    const u = App.auth.current();
    return F.all("Communication")
      .filter((c) => (c.recipient || []).some((r) => refId(r.reference) === u.id))
      .sort((a, b) => new Date(b.sent) - new Date(a.sent));
  }
  function unreadCount() { return myNotifications().filter((n) => !n.read).length; }
  function markRead(id) { const c = F.read("Communication", id); if (c) { c.read = true; F.update("Communication", id, c, { audit: false }); } }
  function markAllRead() { myNotifications().forEach((n) => markRead(n.id)); }

  /* ---------- 近期动态（最近7天会议/任务变更） ---------- */
  function recentActivity(limit) {
    const acts = [];
    cases().forEach((c) => {
      const a = apptOf(c);
      if (a && a.start) acts.push({ time: a.start, patient: c.subject.display, caseType: c.caseType, kind: "meeting", status: a.status, c });
      tasksOf(c).forEach((t) => {
        const st = taskStatus(t);
        if (st === "overdue") acts.push({ time: dueOf(t), patient: c.subject.display, caseType: c.caseType, kind: "task-overdue", status: st, task: t, c });
      });
    });
    acts.sort((a, b) => new Date(b.time) - new Date(a.time));
    return acts.slice(0, limit || 8);
  }

  /* ---------- 写操作 ---------- */
  // 安排/创建会议：更新 Appointment + CaseDiscussion 状态
  function scheduleMeeting(caseId, data) {
    const c = caseById(caseId);
    const a = apptOf(c);
    F.update("Appointment", a.id, (cur) => Object.assign({}, cur, {
      status: data.draft ? "pending" : "scheduled",
      start: data.start, minutesDuration: data.duration, location: data.location,
      participant: data.participants, purpose: data.purpose, autoNotify: data.autoNotify, reminders: data.reminders,
      description: data.topic,
    }), { note: data.draft ? "保存会议草稿" : "创建讨论会议" });
    F.update("CaseDiscussion", caseId, { urgency: data.urgency || c.urgency }, { audit: false });
    F.logOp({ opType: "组织", action: "C", what: (data.draft ? "保存会议草稿" : "创建讨论会议") + "：" + c.subject.display, about: "CaseDiscussion/" + caseId });
    // 发送参会邀请通知
    if (!data.draft && data.autoNotify) {
      (data.participants || []).forEach((p) => {
        F.create({
          resourceType: "Communication", status: "completed", category: [{ text: "invitation" }],
          subject: { display: c.subject.display }, about: [{ reference: "Appointment/" + a.id }],
          recipient: [{ reference: p.actor.reference }], sender: { display: App.auth.current().name },
          sent: D.isoNow(), topic: { text: "病例讨论参会邀请" }, read: false,
          payload: [{ contentString: "邀请您参加「" + c.subject.display + " - " + c.diagnosis + "」讨论会议，时间：" + D.fmtDateTime(data.start) }],
        }, { audit: false });
      });
    }
    return a;
  }

  // 保存研讨记录（暂存/签名）
  function saveResearch(caseId, sections, sign) {
    const c = caseById(caseId);
    const apptGuard = apptOf(c);
    if (apptGuard.status === "pending") throw new Error("该讨论会议尚未安排，无法填写/签名研讨记录");
    // 只有实际受邀且已确认参会的人员，才能进行电子签名——科室主任等会议组织者若本人
    // 并未受邀参会，不允许在此签名，避免出现"未参会却被计入签名"的数据错误。
    if (sign) {
      const u0 = App.auth.current();
      const isParticipant = (apptGuard.participant || []).some((p) => refId(p.actor.reference) === u0.id && p.status === "accepted");
      if (!isParticipant) throw new Error("只有已确认参会的人员才能进行电子签名");
    }
    let comp = compOf(c);
    const u = App.auth.current();
    const sectionArr = [
      { title: "病情分析", text: sections.analysis },
      { title: "诊断意见", text: sections.diagnosis },
      { title: "治疗建议", text: sections.treatment },
      { title: "后续随访计划", text: sections.followup },
    ];
    if (!comp) {
      comp = F.create({
        resourceType: "Composition", status: "preliminary", type: { text: "病例研讨记录" },
        subject: { reference: c.subject.reference, display: c.subject.display },
        discussion: { reference: "CaseDiscussion/" + caseId }, date: D.isoNow(),
        section: sectionArr, attester: [], locked: false,
      }, { note: "创建研讨记录" });
    } else {
      F.update("Composition", comp.id, { section: sectionArr }, { note: sign ? "提交研讨记录并签名" : "暂存研讨记录" });
    }
    // 会议进入进行中
    const a = apptOf(c);
    if (a.status === "scheduled") F.update("Appointment", a.id, { status: "ongoing" }, { audit: false });
    if (c.status === "pending") F.update("CaseDiscussion", caseId, { status: "ongoing" }, { audit: false });

    if (sign) {
      comp = F.read("Composition", comp.id);
      const attesters = (comp.attester || []).slice();
      if (!attesters.some((x) => refId(x.party.reference) === u.id)) {
        attesters.push({ party: { reference: "Practitioner/" + u.id, display: u.name }, time: D.isoNow(), mode: "legal" });
      }
      F.update("Composition", comp.id, { attester: attesters }, { audit: false });
      // 同步 Appointment 参与者签名时间
      F.update("Appointment", a.id, (cur) => {
        const ps = (cur.participant || []).map((p) => refId(p.actor.reference) === u.id ? Object.assign({}, p, { signedAt: D.isoNow() }) : p);
        return Object.assign({}, cur, { participant: ps });
      }, { audit: false });
      F.logOp({ opType: "签名", action: "U", what: u.name + " 完成CA电子签名", about: "Composition/" + comp.id });

      // 全部参会专家签名完成 → 会议已完成、讨论已完成、生成诊疗任务
      const appt = F.read("Appointment", a.id);
      const accepted = (appt.participant || []).filter((p) => p.status === "accepted");
      const allSigned = accepted.length > 0 && accepted.every((p) => p.signedAt);
      if (allSigned) {
        F.update("Composition", comp.id, { status: "final", locked: true }, { audit: false });
        F.update("Appointment", a.id, { status: "completed" }, { audit: false });
        F.update("CaseDiscussion", caseId, { status: "completed" }, { audit: false });
        generateTasksFromDiscussion(caseId, sections);
        F.logOp({ opType: "归档", action: "U", what: "全体专家签名完成，研讨记录归档锁定", about: "Composition/" + comp.id });
      }
    }
    return F.read("Composition", comp.id);
  }

  // 将"治疗建议"文本拆分为若干条可执行的调整事项（按换行/分号/编号切分）
  function splitTreatmentItems(text) {
    if (!text) return [];
    return text.split(/[\n；;]+/).map((s) => s.replace(/^\s*\d+[.、]\s*/, "").trim()).filter(Boolean);
  }
  function shortTaskName(item, fallback) {
    if (!item) return fallback;
    return item.length > 16 ? item.slice(0, 16) + "…" : item;
  }
  // 讨论结论自动生成诊疗调整任务：按"治疗建议"实际填写的条目拆分为一个或多个任务，
  // 并按任务名称匹配医嘱/检查/方案对比模板（App.taskTemplates，seed.js 导出），
  // 而不是生成内容空泛的单一任务。
  function generateTasksFromDiscussion(caseId, sections) {
    const c = caseById(caseId);
    if (tasksOf(c).length) return; // 已生成则跳过
    const items = splitTreatmentItems(sections.treatment).slice(0, 3); // 最多拆分3条，避免任务过多
    const fallbackName = c.caseType === "treatment" ? "调整治疗方案" : c.caseType === "rare" ? "启动专科治疗方案" : "调整诊疗方案";
    const names = items.length ? items.map((it) => shortTaskName(it, fallbackName)) : [fallbackName];
    const due = D.fmtDate(D.addDays(D.now(), 3)) + "T00:00:00";
    const created = names.map((name, idx) => {
      const detail = (App.taskTemplates && App.taskTemplates(name)) || {};
      const t = F.create({
        resourceType: "Task", status: "requested", businessStatus: { text: "requested" }, intent: "order",
        code: { text: name }, for: { reference: c.subject.reference, display: c.subject.display },
        owner: { reference: c.attending.reference, display: c.attending.display },
        requester: { reference: "CaseDiscussion/" + caseId }, focus: { reference: "CaseDiscussion/" + caseId },
        authoredOn: D.isoNow(), restriction: { period: { end: due } },
        urgency: c.urgency,
        adjustment: items[idx] || sections.treatment || "按讨论结论执行。",
        orders: detail.orders || ["按讨论结论完成相关检查"],
        checks: (detail.checks || [{ name: "相关复查" }]).map((x) => Object.assign({}, x, { done: false, result: "待录入" })),
        orderConfirm: (detail.orderConfirm || ["确认调整医嘱"]).map((x) => ({ text: typeof x === "string" ? x : x.text, done: false, time: null })),
        comparison: detail.comparison || [{ item: name, old: "原方案", neu: "调整后方案", changed: true }],
        execNotes: [], executionNote: "",
        nodes: [
          { label: "接收任务", done: true, time: D.isoNow() },
          { label: "确认调整医嘱", done: false, time: null },
          { label: "完成检查项", done: false, time: null },
          { label: "反馈执行结果", done: false, time: null },
        ],
      }, { note: "讨论结论自动生成诊疗调整任务" });
      F.logOp({ who: "系统", opType: "系统", action: "C", what: "自动生成诊疗调整任务", about: "Task/" + t.id });
      return t;
    });
    // 待办通知（合并为一条）
    F.create({
      resourceType: "Communication", status: "completed", category: [{ text: "task" }],
      subject: { display: c.subject.display }, recipient: [{ reference: c.attending.reference }],
      sender: { display: "系统" }, sent: D.isoNow(), topic: { text: "诊疗调整待办任务" }, read: false,
      payload: [{ contentString: "您有 " + created.length + " 项新的诊疗调整任务：" + created.map((t) => t.code.text).join("、") + "，截止：" + D.fmtDate(due) }],
    }, { audit: false });
    return created;
  }

  // 科室主任手动新建一条跟踪任务（不依赖自动生成，闭环补充入口）
  function createTask(caseId, data) {
    const c = caseById(caseId);
    const owner = F.read("Practitioner", data.ownerId);
    const detail = (App.taskTemplates && App.taskTemplates(data.name)) || {};
    const t = F.create({
      resourceType: "Task", status: "requested", businessStatus: { text: "requested" }, intent: "order",
      code: { text: data.name }, for: { reference: c.subject.reference, display: c.subject.display },
      owner: { reference: "Practitioner/" + owner.id, display: owner.name[0].text },
      requester: { reference: "CaseDiscussion/" + caseId }, focus: { reference: "CaseDiscussion/" + caseId },
      authoredOn: D.isoNow(), restriction: { period: { end: data.due + "T00:00:00" } },
      urgency: c.urgency, adjustment: data.adjustment || ("按跟踪需要新增：" + data.name),
      orders: detail.orders || ["按需完成相关检查"],
      checks: (detail.checks || [{ name: "相关复查" }]).map((x) => ({ name: x.name, result: "待录入", done: false })),
      orderConfirm: (detail.orderConfirm || ["确认调整医嘱"]).map((x) => ({ text: typeof x === "string" ? x : x.text, done: false, time: null })),
      comparison: detail.comparison || [{ item: data.name, old: "原方案", neu: "调整后方案", changed: true }],
      execNotes: [], executionNote: "",
      nodes: [
        { label: "接收任务", done: true, time: D.isoNow() },
        { label: "确认调整医嘱", done: false, time: null },
        { label: "完成检查项", done: false, time: null },
        { label: "反馈执行结果", done: false, time: null },
      ],
    }, { note: "手动新建诊疗调整任务" });
    F.logOp({ opType: "组织", action: "C", what: App.auth.current().name + " 手动新建诊疗调整任务：" + data.name, about: "Task/" + t.id });
    F.create({
      resourceType: "Communication", status: "completed", category: [{ text: "task" }],
      subject: { display: c.subject.display }, recipient: [{ reference: "Practitioner/" + owner.id }],
      sender: { display: "系统" }, sent: D.isoNow(), topic: { text: "诊疗调整待办任务" }, read: false,
      payload: [{ contentString: "您有新的诊疗调整任务「" + data.name + "」，截止：" + data.due }],
    }, { audit: false });
    return t;
  }

  // 编辑跟踪任务信息（名称/责任人/调整建议/截止时间）
  function updateTaskDetail(taskId, data) {
    const u = App.auth.current();
    const patch = {};
    if (data.name) patch.code = { text: data.name };
    if (data.ownerId) { const owner = F.read("Practitioner", data.ownerId); patch.owner = { reference: "Practitioner/" + owner.id, display: owner.name[0].text }; }
    if (data.adjustment != null) patch.adjustment = data.adjustment;
    if (data.due) patch.restriction = { period: { end: data.due + "T00:00:00" } };
    F.update("Task", taskId, patch, { note: "编辑诊疗调整任务" });
    F.logOp({ who: u.name, opType: "组织", action: "U", what: u.name + " 编辑了任务信息", about: "Task/" + taskId });
    return F.read("Task", taskId);
  }

  // 执行/反馈诊疗任务
  function submitTaskExecution(taskId, data) {
    const t = F.read("Task", taskId);
    const u = App.auth.current();
    const patch = {};
    if (data.orderConfirm) patch.orderConfirm = data.orderConfirm;
    if (data.checks) patch.checks = data.checks;
    if (data.executionNote != null) patch.executionNote = data.executionNote;
    // 推进节点
    const nodes = (t.nodes || []).slice();
    const ordersDone = (data.orderConfirm || t.orderConfirm || []).every((x) => x.done);
    const checksDone = (data.checks || t.checks || []).every((x) => x.done);
    if (ordersDone && nodes[1] && !nodes[1].done) { nodes[1].done = true; nodes[1].time = D.isoNow(); }
    if (checksDone && nodes[2] && !nodes[2].done) { nodes[2].done = true; nodes[2].time = D.isoNow(); }
    let newStatus = "in-progress";
    if (data.complete && ordersDone) {
      if (nodes[3]) { nodes[3].done = true; nodes[3].time = D.isoNow(); }
      newStatus = "completed";
    }
    patch.nodes = nodes;
    patch.status = newStatus === "completed" ? "completed" : "in-progress";
    patch.businessStatus = { text: newStatus };
    F.update("Task", taskId, patch, { audit: false });
    F.logOp({ who: u.name, opType: "执行", action: "U", what: data.complete ? "提交执行结果，任务办结" : "更新任务执行进度", about: "Task/" + taskId });
    return F.read("Task", taskId);
  }
  function addTaskNote(taskId, text) {
    const t = F.read("Task", taskId);
    const u = App.auth.current();
    const notes = (t.execNotes || []).slice();
    notes.push({ text, by: u.name, time: D.isoNow() });
    F.update("Task", taskId, { execNotes: notes }, { audit: false });
    F.logOp({ who: u.name, opType: "执行", action: "U", what: "追加备注：" + text, about: "Task/" + taskId });
  }

  // 提醒确认 / 追加邀请
  function remindParticipant(caseId, practRef) {
    const c = caseById(caseId);
    F.create({
      resourceType: "Communication", status: "completed", category: [{ text: "invitation" }],
      subject: { display: c.subject.display }, recipient: [{ reference: practRef }],
      sender: { display: App.auth.current().name }, sent: D.isoNow(), topic: { text: "参会确认提醒" }, read: false,
      payload: [{ contentString: "请尽快确认是否参加「" + c.subject.display + "」病例讨论会议。" }],
    }, { audit: false });
    F.logOp({ opType: "组织", action: "C", what: "发送参会确认提醒", about: "CaseDiscussion/" + caseId });
  }

  // 受邀人员本人确认/拒绝参会（此前邀请发出后接收人无处可操作，逻辑不闭环）
  function respondInvitation(caseId, decision) {
    const c = caseById(caseId);
    const a = apptOf(c);
    const u = App.auth.current();
    F.update("Appointment", a.id, (cur) => Object.assign({}, cur, {
      participant: (cur.participant || []).map((p) => refId(p.actor.reference) === u.id ? Object.assign({}, p, { status: decision }) : p),
    }), { note: decision === "accepted" ? "确认参会" : "拒绝参会" });
    F.logOp({ who: u.name, opType: "确认", action: "U", what: u.name + (decision === "accepted" ? " 确认参会" : " 拒绝参会"), about: "CaseDiscussion/" + caseId });
    if (a.creator) {
      F.create({
        resourceType: "Communication", status: "completed", category: [{ text: "invitation" }],
        subject: { display: c.subject.display }, recipient: [{ reference: a.creator.reference }],
        sender: { display: u.name }, sent: D.isoNow(), topic: { text: "参会确认回复" }, read: false,
        payload: [{ contentString: u.name + (decision === "accepted" ? " 已确认参加" : " 已拒绝参加") + "「" + c.subject.display + "」讨论会议。" }],
      }, { audit: false });
    }
    return F.read("Appointment", a.id);
  }

  // 追加/调整参会人员邀请（讨论会议详情弹框内联操作，不跳转页面）
  function updateParticipants(caseId, ids) {
    const c = caseById(caseId);
    const a = apptOf(c);
    const existing = a.participant || [];
    const added = [];
    const nextList = ids.map((id) => {
      const ex = existing.find((p) => refId(p.actor.reference) === id);
      if (ex) return ex;
      const p = F.read("Practitioner", id);
      added.push(p);
      return {
        actor: { reference: "Practitioner/" + id, display: p.name[0].text },
        status: "tentative", dept: App.auth.ext(p, "dept"), title: p.qualification[0].code.text, signedAt: null,
      };
    });
    F.update("Appointment", a.id, { participant: nextList }, { note: "调整参会人员邀请" });
    F.logOp({ opType: "组织", action: "U", what: App.auth.current().name + " 调整参会人员邀请（共" + nextList.length + "人）", about: "CaseDiscussion/" + caseId });
    added.forEach((p) => {
      F.create({
        resourceType: "Communication", status: "completed", category: [{ text: "invitation" }],
        subject: { display: c.subject.display }, recipient: [{ reference: "Practitioner/" + p.id }],
        sender: { display: App.auth.current().name }, sent: D.isoNow(), topic: { text: "病例讨论参会邀请" }, read: false,
        payload: [{ contentString: "邀请您参加「" + c.subject.display + " - " + c.diagnosis + "」讨论会议，时间：" + (a.start ? D.fmtDateTime(a.start) : "待安排") }],
      }, { audit: false });
    });
    return F.read("Appointment", a.id);
  }

  App.domain = {
    refId, mrn, ageOf, genderText,
    cases, caseById, caseByPatientName, patientOf, flagOf, encounterOf, apptOf, compOf, tasksOf, labsOf, litsOf, aiOf,
    taskStatus, taskDeadlineState, dueOf,
    myCases, myTasks, myMeetings, isMeetingParticipant,
    kpis, deptRanking, monthlyTrend, filterCases, recentActivity,
    myNotifications, unreadCount, markRead, markAllRead,
    scheduleMeeting, saveResearch, generateTasksFromDiscussion, createTask, updateTaskDetail,
    submitTaskExecution, addTaskNote, remindParticipant, respondInvitation, updateParticipants,
  };
})(window.App);
