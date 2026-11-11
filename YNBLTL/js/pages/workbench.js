/* ============================================================
   workbench.js — L2-1 个人工作台 / L3-1-1 病例讨论列表 / L3-1-2 任务执行列表
   同时定义跨页面复用的 App.views（患者信息/识别依据/资料Tab/签名状态等）
   ============================================================ */
(function (App) {
  "use strict";
  const { h, clear } = App.dom;
  const ui = App.ui, dm = App.domain, dt = App.date;
  const nav = (x) => App.router.navigate(x);

  /* ============================================================
     共享视图（病例详情各模块复用）
     ============================================================ */
  const views = {};

  views.patientSummary = function (c) {
    const p = dm.patientOf(c);
    return h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "👤 患者基本信息"),
      h("div", { class: "kv-grid" }, [
        kv("姓名", p.name[0].text), kv("性别", dm.genderText(p.gender)),
        kv("年龄", dm.ageOf(p) + "岁"), kv("科室", c.dept),
        kv("住院号", dm.mrn(p)), kv("主要诊断", c.diagnosis),
      ]),
    ]);
  };

  views.criteriaCard = function (c) {
    const flag = dm.flagOf(c);
    let rows = [];
    try { rows = JSON.parse(App.auth.ext(flag, "criteria")); } catch (e) {}
    return h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "🔎 病例识别依据"),
      h("table", { class: "criteria-table" }, [
        h("thead", {}, h("tr", {}, [th("识别指标"), th("当前值"), th("阈值"), th("是否满足")])),
        h("tbody", {}, rows.map((r) => h("tr", {}, [
          td(r.name), td(r.value), td(r.threshold),
          h("td", { class: r.met ? "met" : "nomet" }, r.met ? "✓" : "—"),
        ]))),
      ]),
    ]);
  };

  views.sourceInfo = function (c) {
    const flag = dm.flagOf(c);
    return h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "🧭 任务来源信息"),
      h("div", { class: "kv-grid" }, [
        kv("任务来源", App.auth.ext(flag, "source") === "auto" ? "系统自动识别" : "人工发起"),
        kv("识别时间", dt.fmtDateTime(flag.period.start)),
        kv("触发规则", App.auth.ext(flag, "trigger-rule")),
      ]),
    ]);
  };

  // 资料Tab：AI病情分析 / 住院病历 / 检验检查报告 / 医学文献
  views.materialTabs = function (c, vertical) {
    const content = h("div", {});
    const items = [
      { key: "ai", label: "AI病情分析" },
      { key: "record", label: "住院病历" },
      { key: "labs", label: "检验检查报告" },
      { key: "lit", label: "医学文献" },
    ];
    function renderTab(k) {
      clear(content);
      if (k === "ai") {
        const ai = dm.aiOf(c) || { dirs: [], risks: [], time: null };
        content.appendChild(h("div", { class: "readonly-box" }, [
          h("div", {}, h("b", {}, "参考诊断方向：")),
          h("ul", { style: { margin: "4px 0 10px", paddingLeft: "18px" } }, ai.dirs.map((d) => h("li", {}, d))),
          h("div", {}, h("b", {}, "关键风险提示：")),
          h("div", { style: { margin: "4px 0 10px" } }, ai.risks.map((r) => ui.tag(r, "red"))),
          h("div", { class: "small muted" }, "AI分析时间：" + dt.fmtDateTime(ai.time)),
        ]));
      } else if (k === "record") {
        content.appendChild(emrTreeViewer(c));
      } else if (k === "labs") {
        const labs = dm.labsOf(c);
        content.appendChild(ui.table({
          columns: [
            { title: "报告名称", render: (r) => r.code.text },
            { title: "报告日期", render: (r) => dt.fmtDate(r.effectiveDateTime) },
            { title: "结果摘要", render: (r) => h("span", { class: (r.interpretation && r.interpretation[0] && r.interpretation[0].text === "异常") ? "text-danger" : "" }, r.valueString) },
            { title: "操作", render: () => h("button", { class: "btn-link", onClick: () => ui.toast("已调阅报告详情（演示）", "info") }, "查看") },
          ], rows: labs, empty: "暂无检验检查报告",
        }));
      } else {
        const lits = dm.litsOf(c);
        content.appendChild(h("ul", { class: "lit-list" }, lits.map((l) =>
          h("li", {}, [h("span", {}, "📄 " + l.description), h("button", { class: "btn-link", onClick: () => ui.toast("已打开文献（演示）", "info") }, "查看")]))));
      }
    }
    renderTab("ai");
    if (vertical) {
      const vt = h("div", { class: "vtabs" });
      items.forEach((it, i) => vt.appendChild(h("button", { class: "vtab" + (i === 0 ? " active" : ""), onClick: (e) => { vt.querySelectorAll(".vtab").forEach((x) => x.classList.remove("active")); e.target.classList.add("active"); renderTab(it.key); } }, it.label)));
      return h("div", { style: { display: "grid", gridTemplateColumns: "150px 1fr", gap: "14px" } }, [vt, content]);
    }
    const t = ui.tabs(items, renderTab, "ai");
    return h("div", {}, [t.el, content]);
  };

  // 住院病历（从 EMR 导入）：左侧为病历树形结构，右侧为选中文档的预览区。
  // 此前"住院病历"只是几行现病史/既往史的摘要，不符合"从EMR导入、内容很多"的实际情况。
  function emrTree(c) {
    const e = dm.encounterOf(c);
    const p = dm.patientOf(c);
    const bed = e.location && e.location[0] ? e.location[0].location.display : "-";
    const chief = e.reasonCode && e.reasonCode[0] ? e.reasonCode[0].text : "-";
    const present = App.auth.ext(e, "present-illness");
    const past = App.auth.ext(e, "past-history");
    const hasSurgery = c.caseType === "treatment";
    const discharged = false; // 演示数据均为在院患者
    return [
      { title: "病案首页", text: "姓名：" + p.name[0].text + "　性别：" + dm.genderText(p.gender) + "　年龄：" + dm.ageOf(p) + "岁\n科室：" + c.dept + "　床号：" + bed + "　住院号：" + dm.mrn(p) + "\n入院日期：" + dt.fmtDate(e.period.start) + "\n入院诊断：" + c.diagnosis },
      { title: "入院记录", text: "主诉：" + chief + "\n现病史：" + present + "\n既往史：" + past + "\n入院诊断：" + c.diagnosis },
      { title: "病程记录", text: "（演示内容）住院期间每日病程记录摘要：患者病情较前" + (c.urgency === "high" ? "无明显缓解，持续密切监护中。" : "平稳，遵医嘱继续现行治疗方案，观察疗效与不良反应。") },
      { title: "医嘱", text: "（演示内容）长期医嘱：按当前诊疗方案执行相关药物治疗与护理级别。\n临时医嘱：按需完善相关检验检查。" },
      { title: "护理文书", text: "（演示内容）体温单、护理记录单：生命体征平稳，遵医嘱完成各项护理措施，未发生护理不良事件。" },
      { title: "手术记录", text: hasSurgery ? "（演示内容）拟行/已行相关手术，具体术式与麻醉方式详见手术知情同意及术后记录。" : "该患者本次住院暂无手术记录。" },
      { title: "出院记录", text: discharged ? "（演示内容）出院医嘱与出院小结。" : "患者目前仍在住院治疗中，暂无出院记录。" },
    ];
  }
  function emrTreeViewer(c) {
    const nodes = emrTree(c);
    const tree = h("div", { class: "vtabs" });
    const preview = h("div", { class: "readonly-box" });
    function select(i) {
      Array.from(tree.children).forEach((el, j) => el.classList.toggle("active", j === i));
      App.dom.clear(preview);
      preview.appendChild(h("div", { style: { fontWeight: "700", marginBottom: "6px" } }, nodes[i].title));
      preview.appendChild(h("div", {}, nodes[i].text));
    }
    nodes.forEach((n, i) => tree.appendChild(h("button", { class: "vtab", onClick: () => select(i) }, n.title)));
    select(0);
    return h("div", { style: { display: "grid", gridTemplateColumns: "160px 1fr", gap: "14px" } }, [tree, preview]);
  }

  views.signStatus = function (c) {
    const comp = dm.compOf(c);
    const appt = dm.apptOf(c);
    const accepted = (appt.participant || []).filter((p) => p.status === "accepted");
    const signed = comp ? (comp.attester || []) : [];
    const signedIds = new Set(signed.map((s) => dm.refId(s.party.reference)));
    const lines = accepted.map((p) => {
      const sid = dm.refId(p.actor.reference);
      const att = signed.find((s) => dm.refId(s.party.reference) === sid);
      return h("span", { class: "sign-line" }, att
        ? ["✅ ", p.actor.display + " " + dt.fmtMDTime(att.time)]
        : ["⏳ ", p.actor.display + " 待签名"]);
    });
    return h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "✍️ 电子签名状态"),
      accepted.length ? h("div", {}, [h("div", {}, lines), h("div", { class: "small muted mt-8" }, "已签名 " + signedIds.size + "/" + accepted.length)]) : h("div", { class: "muted" }, "暂无签名记录"),
    ]);
  };

  views.recordViewer = function (c) {
    const comp = dm.compOf(c);
    if (!comp) return h("div", { class: "muted" }, "暂无研讨记录");
    return h("div", {}, comp.section.map((s) => h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, s.title), h("div", {}, s.text),
    ])));
  };

  // 参会人员表格（患者/会议详情通用）：既展示确认状态，
  // 也让受邀本人可以直接「确认参会/拒绝参会」（此前邀请发出后接收人无处可操作，逻辑不闭环）。
  views.participantTable = function (c, a, refresh) {
    const parts = a.participant || [];
    const u = App.auth.current();
    const stat = {
      accepted: parts.filter((p) => p.status === "accepted").length,
      tentative: parts.filter((p) => p.status === "tentative").length,
      declined: parts.filter((p) => p.status === "declined").length,
    };
    function action(p) {
      const isMe = dm.refId(p.actor.reference) === u.id;
      if (isMe && p.status === "tentative") {
        return h("span", { class: "flex gap-8" }, [
          h("button", { class: "btn-link", onClick: () => { dm.respondInvitation(c.id, "accepted"); ui.toast("已确认参会", "success"); App.app.refreshMsgBadge(); if (refresh) refresh(); } }, "确认参会"),
          h("button", { class: "btn-link", onClick: () => { dm.respondInvitation(c.id, "declined"); ui.toast("已拒绝参会", "info"); App.app.refreshMsgBadge(); if (refresh) refresh(); } }, "拒绝参会"),
        ]);
      }
      const rk = App.auth.currentRoleKey();
      if (isMe || rk === "expert") return h("span", { class: "muted" }, "-");
      if (p.status === "tentative") return h("button", { class: "btn-link", onClick: () => { dm.remindParticipant(c.id, p.actor.reference); ui.toast("已向 " + p.actor.display + " 发送参会确认提醒", "success"); App.app.refreshMsgBadge(); if (refresh) refresh(); } }, "提醒确认");
      if (p.status === "declined") return h("button", { class: "btn-link", onClick: () => { ui.confirmBox({ title: "重新邀请", message: "确认重新邀请该专家（" + p.actor.display + "）？" }).then((ok) => { if (!ok) return; dm.remindParticipant(c.id, p.actor.reference); ui.toast("已重新邀请 " + p.actor.display, "success"); App.app.refreshMsgBadge(); if (refresh) refresh(); }); } }, "重新邀请");
      return h("span", { class: "muted" }, "-");
    }
    return h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "👥 参会人员"),
      h("div", { class: "small muted mb-8" }, "已确认：" + stat.accepted + "人 · 待确认：" + stat.tentative + "人 · 已拒绝：" + stat.declined + "人 · 共邀请：" + parts.length + "人"),
      ui.table({
        columns: [
          { title: "姓名", render: (p) => p.actor.display },
          { title: "科室", render: (p) => p.dept || "-" },
          { title: "职称", render: (p) => p.title || "-" },
          { title: "确认状态", render: (p) => ui.statusTag(App.enums.partStatus, p.status) },
          { title: "操作", render: action },
        ], rows: parts, empty: "暂无参会人员",
      }),
    ]);
  };

  App.views = views;

  /* ============================================================
     页面入口
     ============================================================ */
  App.pages._crumb = App.pages._crumb || {};
  App.pages._crumb.workbench = function (p) {
    if (p.tab === "tasks") return [["个人工作台", "#/workbench"], ["任务执行列表", null]];
    if (p.tab === "cases") return [["个人工作台", "#/workbench"], ["病例讨论列表", null]];
    return null;
  };

  function workbench(params) {
    if (params.tab === "cases") return caseListPage();
    if (params.tab === "tasks") return taskListPage();
    return overviewPage();
  }

  /* ---------- L2-1 概览 ---------- */
  function overviewPage() {
    const myCases = dm.myCases();
    const myTasks = dm.myTasks();
    const byStatus = (arr, st) => arr.filter(st).length;
    const wrap = h("div", {});
    wrap.appendChild(pageHead("📋 个人工作台", "汇总归属本人的病例讨论任务与诊疗执行任务"));

    wrap.appendChild(h("div", { class: "grid grid-2 section" }, [
      h("div", { class: "card card-pad" }, [
        h("div", { class: "section-title" }, [h("span", { class: "bar" }), "病例讨论任务概览"]),
        h("div", { class: "flex gap-16", style: { marginTop: "6px" } }, [
          miniStat("待讨论", byStatus(myCases, (c) => c.status === "pending"), "gray"),
          miniStat("讨论中", byStatus(myCases, (c) => c.status === "ongoing"), "orange"),
          miniStat("已完成", byStatus(myCases, (c) => c.status === "completed"), "green"),
        ]),
        h("div", { class: "mt-12" }, h("a", { href: "#/workbench?tab=cases" }, "进入病例讨论列表 →")),
      ]),
      h("div", { class: "card card-pad" }, [
        h("div", { class: "section-title" }, [h("span", { class: "bar" }), "诊疗执行任务概览"]),
        h("div", { class: "flex gap-16", style: { marginTop: "6px" } }, [
          miniStat("待执行", byStatus(myTasks, (t) => dm.taskStatus(t) === "requested"), "gray"),
          miniStat("执行中", byStatus(myTasks, (t) => dm.taskStatus(t) === "in-progress"), "blue"),
          miniStat("已完成", byStatus(myTasks, (t) => dm.taskStatus(t) === "completed"), "green"),
          miniStat("已超时", byStatus(myTasks, (t) => dm.taskStatus(t) === "overdue"), "red"),
        ]),
        h("div", { class: "mt-12" }, h("a", { href: "#/workbench?tab=tasks" }, "进入任务执行列表 →")),
      ]),
    ]));

    // 高优先级病例提醒
    const hi = myCases.filter((c) => c.urgency === "high" && c.status !== "completed");
    wrap.appendChild(h("div", { class: "card card-pad section" }, [
      h("div", { class: "section-title" }, [h("span", { class: "bar" }), "高优先级病例提醒"]),
      hi.length ? h("ul", { class: "timeline-simple" }, hi.map((c) => h("li", {}, [
        h("div", {}, [c.subject.display + "（" + App.caseTypeLabel(c.caseType) + "）", ui.urgencyView(c.urgency)]),
        h("div", { class: "t-time" }, "诊断：" + c.diagnosis),
      ]))) : h("div", { class: "muted" }, "暂无高优先级病例"),
    ]));

    // 近期任务时间线
    const upcoming = myTasks.filter((t) => dm.taskStatus(t) !== "completed").sort((a, b) => new Date(dm.dueOf(a)) - new Date(dm.dueOf(b)));
    wrap.appendChild(h("div", { class: "card card-pad section" }, [
      h("div", { class: "section-title" }, [h("span", { class: "bar" }), "近期任务时间线"]),
      upcoming.length ? h("ul", { class: "timeline-simple" }, upcoming.map((t) => h("li", {}, [
        h("div", {}, t.code.text + "（" + t.for.display + "）"),
        h("div", { class: "t-time" }, "截止：" + dt.fmtDate(dm.dueOf(t)) + (dm.taskStatus(t) === "overdue" ? " · 已超时" : "")),
      ]))) : h("div", { class: "muted" }, "暂无即将到期任务"),
    ]));

    // 近期会议安排：本人名下病例的已安排会议
    const myAppts = myCases.map(dm.apptOf).filter(Boolean);
    const upcomingMeetings = myAppts.filter((a) => a.start && new Date(a.start) >= dt.now() && a.status === "scheduled").sort((a, b) => new Date(a.start) - new Date(b.start));
    wrap.appendChild(h("div", { class: "card card-pad section" }, [
      h("div", { class: "section-title" }, [h("span", { class: "bar" }), "近期会议安排"]),
      upcomingMeetings.length ? h("ul", { class: "timeline-simple" }, upcomingMeetings.map((a) => {
        const c = dm.caseById(dm.refId(a.discussion.reference));
        const confirmed = (a.participant || []).filter((p) => p.status === "accepted").length;
        return h("li", {}, [h("div", {}, c.subject.display + "-" + c.diagnosis), h("div", { class: "t-time" }, dt.fmtDateTime(a.start) + " · 已确认 " + confirmed + " 人")]);
      })) : h("div", { class: "muted" }, "近期暂无已安排会议"),
    ]));

    // 异常任务预警：本人名下超时未执行的诊疗调整任务
    const overdueTasks = myTasks.filter((t) => dm.taskStatus(t) === "overdue");
    wrap.appendChild(h("div", { class: "card card-pad section" }, [
      h("div", { class: "section-title" }, [h("span", { class: "bar" }), "异常任务预警"]),
      overdueTasks.length ? h("ul", { class: "timeline-simple" }, overdueTasks.map((t) => h("li", {}, [
        h("div", { class: "text-danger" }, "⚠ " + t.code.text + "（" + t.for.display + "）超时未执行"),
        h("div", { class: "t-time" }, "截止：" + dt.fmtDate(dm.dueOf(t))),
      ]))) : h("div", { class: "muted" }, "暂无异常任务"),
    ]));

    return wrap;
  }

  /* ---------- L3-1-1 病例讨论列表 ---------- */
  function caseListPage() {
    const state = { caseType: "", status: "", urgency: "", kw: "", from: "", to: "", page: 1 };
    const root = h("div", {});
    root.appendChild(pageHead("📋 病例讨论列表", "归属本人的疑难病例讨论任务，支持筛选与查看任务详情"));
    const filter = h("div", { class: "filter-bar" });
    const listBox = h("div", {});
    root.appendChild(filter); root.appendChild(listBox);

    function buildFilter() {
      clear(filter);
      filter.appendChild(h("div", { class: "filter-row" }, [
        selField("病例类型", App.enums.caseType, state.caseType, (v) => state.caseType = v),
        selField("任务状态", labelMap(App.enums.discussionStatus), state.status, (v) => state.status = v),
        selField("紧急程度", { high: "高", mid: "中", low: "低" }, state.urgency, (v) => state.urgency = v),
        textField("搜索", "请输入患者姓名/关键字", state.kw, (v) => state.kw = v),
        dateRange(state, "会议时间"),
        h("div", { class: "filter-actions" }, [
          h("button", { class: "btn primary", onClick: () => { state.page = 1; renderList(); } }, "查询"),
          h("button", { class: "btn", onClick: () => { Object.assign(state, { caseType: "", status: "", urgency: "", kw: "", from: "", to: "", page: 1 }); buildFilter(); renderList(); } }, "重置"),
        ]),
      ]));
    }

    // 会议时间筛选：仅当填写了时间范围时才生效；未安排会议（无会议时间）的病例在
    // 指定范围查询时应被排除，而不是始终通过（此前 inRange 对空值一律放行）。
    function inMeetingRange(a) {
      if (!state.from && !state.to) return true;
      if (!a || !a.start) return false;
      return inRange(a.start, state.from, state.to);
    }

    function renderList() {
      clear(listBox);
      let rows = dm.myCases().map((c) => ({ c, a: dm.apptOf(c) })).filter((x) =>
        (!state.caseType || x.c.caseType === state.caseType) &&
        (!state.status || x.c.status === state.status) &&
        (!state.urgency || x.c.urgency === state.urgency) &&
        (!state.kw || x.c.subject.display.indexOf(state.kw) >= 0 || x.c.diagnosis.indexOf(state.kw) >= 0 || (x.a && x.a.description || "").indexOf(state.kw) >= 0) &&
        inMeetingRange(x.a));
      rows.sort((a, b) => new Date(b.c.createdAt) - new Date(a.c.createdAt));
      const total = rows.length, ps = 20;
      const pageRows = rows.slice((state.page - 1) * ps, state.page * ps);
      listBox.appendChild(ui.table({
        columns: [
          { title: "病例名称", render: (x) => h("span", { class: "cell-strong" }, x.c.subject.display + "-" + ((x.a && x.a.description) || x.c.diagnosis)) },
          { title: "发起科室", render: (x) => x.c.dept },
          { title: "住院号", render: (x) => dm.mrn(dm.patientOf(x.c)) },
          { title: "病例类型", render: (x) => ui.caseTypeTag(x.c.caseType) },
          { title: "任务状态", render: (x) => ui.statusTag(App.enums.discussionStatus, x.c.status) },
          { title: "会议时间", render: (x) => x.a && x.a.start ? dt.fmtDate(x.a.start) : "-" },
          { title: "紧急程度", render: (x) => ui.urgencyView(x.c.urgency) },
          { title: "操作", render: (x) => h("button", { class: "btn-link", onClick: () => caseDetailModal(x.c.id) }, "详情") },
        ],
        rows: pageRows, rowClass: (x) => x.c.urgency === "high" ? "urgent-high" : "",
        empty: "暂无归属您的疑难病例讨论任务",
      }));
      if (total > ps) listBox.appendChild(ui.pager({ total, pageSize: ps, page: state.page, onPage: (p) => { state.page = p; renderList(); } }));
      else listBox.appendChild(h("div", { class: "pager" }, h("span", {}, "共 " + total + " 条")));
    }
    buildFilter(); renderList();
    return root;
  }

  function caseDetailModal(caseId) {
    const c = dm.caseById(caseId);
    const p = dm.patientOf(c);
    const sub = [
      "住院号 " + dm.mrn(p),
      "状态：" + App.enums.discussionStatus[c.status].label,
      h("span", {}, ["紧急程度：", ui.urgencyView(c.urgency)]),
    ];
    const body = h("div", {});
    const seg = ui.segTabs([
      { key: "info", label: "患者基本信息" },
      { key: "meeting", label: "会议及病例研讨记录" },
      { key: "tasks", label: "任务列表" },
    ], render);
    body.appendChild(seg.el);
    const content = h("div", {}); body.appendChild(content);

    function render(k) {
      clear(content);
      if (k === "info") {
        content.appendChild(views.patientSummary(c));
        content.appendChild(h("div", { class: "info-block" }, [h("div", { class: "ib-title" }, "📚 病历资料"), views.materialTabs(c)]));
        content.appendChild(views.criteriaCard(c));
        content.appendChild(notifyRecords(c));
      } else if (k === "meeting") {
        const a = dm.apptOf(c);
        content.appendChild(meetingInfoBlock(c, a));
        content.appendChild(views.participantTable(c, a, () => render("meeting")));
        // 研讨记录：只要会议已安排（scheduled/ongoing/completed）即可查看/进入，
        // 不再以「讨论任务状态」是否为 ongoing 作为唯一判断（会议提前召开时两者可能不同步）。
        if (a.status !== "pending") {
          content.appendChild(h("div", { class: "info-block" }, [
            h("div", { class: "ib-title" }, "📝 研讨记录"),
            dm.compOf(c) ? views.recordViewer(c) : h("div", { class: "muted" }, "暂无研讨记录"),
            (a.status === "scheduled" || a.status === "ongoing") ? h("div", { class: "mt-8" }, h("button", { class: "btn primary sm", onClick: () => { closeAll(); nav("#/research?case=" + c.id); } }, "进入研讨")) : null,
          ]));
        } else content.appendChild(h("div", { class: "info-block" }, [h("div", { class: "ib-title" }, "📝 研讨记录"), h("div", { class: "muted" }, "暂无研讨记录")]));
        if (a.status === "completed") content.appendChild(views.signStatus(c));
      } else {
        const tasks = dm.tasksOf(c);
        content.appendChild(tasks.length ? taskMiniTable(tasks) : h("div", { class: "info-block muted" }, "暂无诊疗调整任务"));
      }
    }
    render("info");
    ui.modal({ title: "病例讨论详情 · " + c.subject.display, sub, body });
  }

  function meetingInfoBlock(c, a) {
    a = a || dm.apptOf(c);
    return h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "📅 讨论会议信息"),
      h("div", { class: "kv-grid" }, [
        kv("讨论主题", a.description),
        kv("会议时间", a.start ? dt.fmtDateTime(a.start) : "待安排"),
        kv("会议地点", a.location || "-"),
        kv("预计时长", (a.minutesDuration || 60) + "分钟"),
        kv("会议状态", App.enums.meetingStatus[a.status].label),
        kv("发起人", a.creator ? a.creator.display : "-"),
        kv("参会专家", (a.participant || []).length ? (a.participant.length + "人") : "-"),
      ]),
    ]);
  }

  function notifyRecords(c) {
    const notes = App.fhir.all("Communication").filter((m) => (m.about || []).some((r) => dm.refId(r.reference) === c.id) || (m.subject && m.subject.display === c.subject.display && (m.category[0].text === "discussion")));
    return h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "🔔 讨论通知记录"),
      notes.length ? h("ul", { class: "timeline-simple" }, notes.map((m) => h("li", {}, [
        h("div", {}, (m.topic ? m.topic.text + "：" : "") + (m.payload ? m.payload[0].contentString : "")),
        h("div", { class: "t-time" }, dt.fmtDateTime(m.sent)),
      ]))) : h("div", { class: "muted" }, "暂无通知记录"),
    ]);
  }

  function taskMiniTable(tasks) {
    return ui.table({
      columns: [
        { title: "任务名称", render: (t) => t.code.text },
        { title: "执行状态", render: (t) => ui.statusTag(App.enums.taskStatus, dm.taskStatus(t)) },
        { title: "责任人", render: (t) => t.owner.display },
        { title: "截止时间", render: (t) => dueCell(t) },
        { title: "操作", render: (t) => h("button", { class: "btn-link", onClick: () => taskDetailModal(t.id) }, "查看") },
      ], rows: tasks, empty: "暂无诊疗调整任务",
    });
  }

  /* ---------- L3-1-2 任务执行列表 ---------- */
  function taskListPage() {
    const state = { status: "", kw: "", from: "", to: "", page: 1 };
    const root = h("div", {});
    root.appendChild(pageHead("🩺 任务执行列表", "分配给本人的诊疗调整待办任务，支持执行进度跟踪与操作记录"));
    const filter = h("div", { class: "filter-bar" });
    const listBox = h("div", {});
    root.appendChild(filter); root.appendChild(listBox);

    function buildFilter() {
      clear(filter);
      filter.appendChild(h("div", { class: "filter-row" }, [
        selField("执行状态", labelMap(App.enums.taskStatus), state.status, (v) => state.status = v),
        textField("病历名称", "输入关键词", state.kw, (v) => state.kw = v),
        dateRange(state, "截止时间"),
        h("div", { class: "filter-actions" }, [
          h("button", { class: "btn primary", onClick: () => { state.page = 1; renderList(); } }, "查询"),
          h("button", { class: "btn", onClick: () => { Object.assign(state, { status: "", kw: "", from: "", to: "", page: 1 }); buildFilter(); renderList(); } }, "重置"),
        ]),
      ]));
    }

    function renderList() {
      clear(listBox);
      let rows = dm.myTasks().filter((t) => {
        const st = dm.taskStatus(t);
        return (!state.status || st === state.status) &&
          (!state.kw || (t.for.display.indexOf(state.kw) >= 0 || t.code.text.indexOf(state.kw) >= 0)) &&
          inRange(dm.dueOf(t), state.from, state.to);
      });
      const total = rows.length, ps = 20;
      const pageRows = rows.slice((state.page - 1) * ps, state.page * ps);
      listBox.appendChild(ui.table({
        columns: [
          { title: "任务名称", render: (t) => h("span", { class: "cell-strong" }, t.code.text) },
          { title: "病历名称", render: (t) => t.for.display + "-" + (dm.apptOf(dm.caseById(dm.refId(t.focus.reference))).description || dm.caseById(dm.refId(t.focus.reference)).diagnosis) },
          { title: "病历类型", render: (t) => ui.caseTypeTag(dm.caseById(dm.refId(t.focus.reference)).caseType) },
          { title: "执行状态", render: (t) => ui.statusTag(App.enums.taskStatus, dm.taskStatus(t)) },
          { title: "截止时间", render: (t) => dueCell(t) },
          { title: "紧急", render: (t) => dm.taskStatus(t) === "completed" ? "-" : ui.urgencyView(t.urgency) },
          { title: "操作", render: (t) => taskActions(t, renderList) },
        ],
        rows: pageRows, rowClass: (t) => dm.taskStatus(t) === "overdue" ? "row-danger" : (t.urgency === "high" ? "urgent-high" : ""),
        empty: "暂无待执行的诊疗调整任务",
      }));
      if (total > ps) listBox.appendChild(ui.pager({ total, pageSize: ps, page: state.page, onPage: (p) => { state.page = p; renderList(); } }));
      else listBox.appendChild(h("div", { class: "pager" }, h("span", {}, "共 " + total + " 条")));
    }
    buildFilter(); renderList();
    return root;
  }

  function taskActions(t, refresh) {
    const st = dm.taskStatus(t);
    const frag = h("span", { class: "col-actions" });
    if (st === "requested") frag.appendChild(h("button", { class: "btn-link", onClick: () => taskDetailModal(t.id, refresh) }, "执行"));
    frag.appendChild(h("button", { class: "btn-link", onClick: () => taskDetailModal(t.id, refresh) }, "详情"));
    return frag;
  }

  function taskDetailModal(taskId, refresh) {
    const t = () => App.fhir.read("Task", taskId);
    const cur = t();
    const c = dm.caseById(dm.refId(cur.focus.reference));
    const st = dm.taskStatus(cur);
    const readonly = st === "completed";
    const sub = [
      "关联病例：" + cur.for.display,
      "执行状态：" + App.enums.taskStatus[st].label,
      "截止：" + dt.fmtDate(dm.dueOf(cur)),
      h("span", {}, ["紧急程度：", ui.urgencyView(cur.urgency)]),
    ];
    const body = h("div", {});
    const seg = ui.segTabs([
      { key: "detail", label: "调整详情" },
      { key: "compare", label: "方案对比" },
      { key: "exec", label: "执行与记录" },
    ], render);
    body.appendChild(seg.el);
    const content = h("div", {}); body.appendChild(content);
    const m = ui.modal({ title: "诊疗调整任务 · " + cur.code.text, sub, body });

    function render(k) {
      clear(content);
      const task = t();
      if (k === "detail") {
        content.appendChild(infoBox("💊 诊疗调整建议", task.adjustment));
        content.appendChild(listBox2("🧾 医嘱检查提示", task.orders));
        content.appendChild(listBox2("📋 治疗方案调整建议", (App.taskTreatment && App.taskTreatment(task)) || treatmentList(task)));
      } else if (k === "compare") {
        content.appendChild(compareView(task.comparison));
      } else {
        renderExec(content, taskId, readonly, m, refresh);
      }
    }
    render("detail");
  }

  function renderExec(content, taskId, readonly, modal, refresh) {
    const task = App.fhir.read("Task", taskId);
    // 执行进度
    content.appendChild(h("div", { class: "info-block" }, [h("div", { class: "ib-title" }, "📈 执行进度"), ui.steps(task.nodes)]));

    // 执行操作区
    const orderState = (task.orderConfirm || []).map((o) => Object.assign({}, o));
    const checkState = (task.checks || []).map((c) => Object.assign({}, c));
    const opBox = h("div", { class: "info-block" });
    opBox.appendChild(h("div", { class: "ib-title" }, "✅ 执行操作区" + (readonly ? "（已完成 · 只读）" : "")));
    opBox.appendChild(h("div", { style: { fontWeight: "600", margin: "4px 0" } }, "医嘱执行确认："));
    orderState.forEach((o, i) => {
      opBox.appendChild(checkboxRow(o.text, o.done, readonly, (v) => { orderState[i].done = v; if (v && !orderState[i].time) orderState[i].time = dt.isoNow(); }, o.time));
    });
    opBox.appendChild(h("div", { style: { fontWeight: "600", margin: "10px 0 4px" } }, "检查完成情况："));
    checkState.forEach((cobj, i) => {
      const row = h("div", { class: "flex items-center gap-8", style: { padding: "4px 0" } });
      const cb = h("input", { type: "checkbox", disabled: readonly, checked: cobj.done });
      cb.addEventListener("change", () => { checkState[i].done = cb.checked; });
      row.appendChild(cb);
      row.appendChild(h("span", {}, cobj.name + "已完成"));
      row.appendChild(h("span", { class: "muted small" }, "结果："));
      const inp = h("input", { value: cobj.result === "待录入" ? "" : cobj.result, placeholder: "输入/上传结果", disabled: readonly, style: { width: "200px" } });
      inp.addEventListener("input", () => { checkState[i].result = inp.value || "待录入"; });
      row.appendChild(inp);
      opBox.appendChild(row);
    });
    opBox.appendChild(h("div", { style: { fontWeight: "600", margin: "10px 0 4px" } }, "执行说明："));
    const noteArea = h("textarea", { class: "input-full", placeholder: "输入补充说明...", disabled: readonly }, task.executionNote || "");
    opBox.appendChild(noteArea);
    if (!readonly) {
      opBox.appendChild(h("div", { class: "btn-row mt-12" }, [
        h("button", { class: "btn", onClick: () => { dm.submitTaskExecution(taskId, { orderConfirm: orderState, checks: checkState, executionNote: noteArea.value }); ui.toast("已暂存执行进度", "success"); rerender(); } }, "暂存"),
        h("button", { class: "btn primary", onClick: () => {
          if (!orderState.some((o) => o.done)) { ui.toast("请确认至少一项医嘱执行情况", "error"); return; }
          if (!orderState.every((o) => o.done)) { ui.toast("请先完成全部医嘱执行确认", "error"); return; }
          ui.confirmBox({ title: "提交执行结果", message: "确认提交执行结果？提交后任务将标记为已完成并归档操作记录。", okText: "确认提交" }).then((ok) => {
            if (!ok) return;
            dm.submitTaskExecution(taskId, { orderConfirm: orderState, checks: checkState, executionNote: noteArea.value, complete: true });
            ui.toast("已提交执行结果，任务办结", "success");
            modal.close(); if (refresh) refresh(); App.app.refreshMsgBadge();
          });
        } }, "提交执行结果"),
      ]));
    }
    content.appendChild(opBox);

    // 执行备注
    const noteList = h("div", {});
    function renderNotes() { clear(noteList); (App.fhir.read("Task", taskId).execNotes || []).forEach((n) => noteList.appendChild(h("div", { class: "small", style: { padding: "3px 0" } }, "· " + dt.fmtMDTime(n.time) + " " + n.text + " — " + n.by))); }
    renderNotes();
    const noteInput = h("input", { class: "input-full", placeholder: "输入备注..." });
    content.appendChild(h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "🗒️ 执行备注"),
      h("div", { class: "flex gap-8" }, [noteInput, h("button", { class: "btn sm", onClick: () => { if (!noteInput.value.trim()) return; dm.addTaskNote(taskId, noteInput.value.trim()); noteInput.value = ""; renderNotes(); ui.toast("已添加备注", "success"); } }, "提交")]),
      noteList,
    ]));

    // 操作日志
    content.appendChild(h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "📜 操作日志"),
      opLogTable("Task/" + taskId),
    ]));

    function rerender() { clear(content); renderExec(content, taskId, dm.taskStatus(App.fhir.read("Task", taskId)) === "completed", modal, refresh); }
  }

  function opLogTable(reference) {
    const logs = App.fhir.opsFor(reference);
    return ui.table({
      columns: [
        { title: "操作人", render: (l) => l.who },
        { title: "操作时间", render: (l) => dt.fmtMDTime(l.recorded) },
        { title: "操作内容", render: (l) => l.what },
      ], rows: logs, empty: "暂无操作记录",
    });
  }

  /* ---------- 共享小组件 ---------- */
  function compareView(cmp) {
    const box = h("div", {});
    box.appendChild(h("div", { class: "compare" }, [
      h("div", { class: "col-head" }, "原诊疗方案"),
      h("div", { class: "col-head new cmp-row-r" }, "调整后方案"),
      ...cmp.flatMap((r) => [
        h("div", { class: "cmp-cell" + (r.changed ? " changed" : "") }, r.old),
        h("div", { class: "cmp-cell cmp-row-r" + (r.changed ? " changed" : "") }, r.neu),
      ]),
    ]));
    box.appendChild(h("div", { class: "small muted mt-8" }, "▲ 差异项已标黄高亮"));
    return box;
  }
  function treatmentList(task) {
    // 用 comparison 的新方案列作为治疗调整明细
    return (task.comparison || []).map((c) => c.item + "：" + c.neu);
  }
  function taskDetailModalExport(id) { taskDetailModal(id); }
  App.pages.taskDetail = taskDetailModalExport;
  App.pages.caseDetail = caseDetailModal;

  function checkboxRow(label, done, readonly, onChange, time) {
    const cb = h("input", { type: "checkbox", disabled: readonly, checked: done });
    cb.addEventListener("change", () => onChange(cb.checked));
    return h("div", { class: "flex items-center gap-8", style: { padding: "4px 0" } }, [
      cb, h("span", {}, label), (done && time) ? h("span", { class: "muted small" }, "✓ " + dt.fmtMDTime(time)) : null,
    ]);
  }

  function dueCell(t) {
    const st = dm.taskDeadlineState(t);
    const txt = dt.fmtDate(dm.dueOf(t));
    if (st === "overdue") return h("span", { class: "text-danger" }, txt + " 超时");
    if (st === "near") return h("span", { class: "text-warn" }, txt + " 临近");
    return h("span", {}, txt);
  }

  /* ---------- 通用工具 ---------- */
  function pageHead(title, sub) {
    return h("div", { class: "page-head" }, h("div", {}, [
      h("h1", { class: "page-title" }, title),
      sub ? h("div", { class: "page-subtitle" }, sub) : null,
    ]));
  }
  function kv(k, v) { return h("div", { class: "kv" }, [h("span", { class: "k" }, k + "："), h("span", { class: "v" }, v)]); }
  function th(t) { return h("th", {}, t); }
  function td(t) { return h("td", {}, t); }
  function miniStat(label, val, cls) {
    return h("div", { style: { textAlign: "center" } }, [
      h("div", { style: { fontSize: "26px", fontWeight: "700" } }, val),
      ui.tag(label, cls),
    ]);
  }
  function infoBox(title, text) { return h("div", { class: "info-block" }, [h("div", { class: "ib-title" }, title), h("div", { class: "readonly-box" }, text)]); }
  function listBox2(title, items) { return h("div", { class: "info-block" }, [h("div", { class: "ib-title" }, title), h("ul", { style: { margin: "0", paddingLeft: "18px" } }, (items || []).map((x) => h("li", {}, x)))]); }
  function selField(label, map, val, onChange) {
    const sel = h("select", {}, [h("option", { value: "" }, "全部"), ...Object.keys(map).map((k) => h("option", { value: k }, map[k]))]);
    sel.value = val || ""; sel.addEventListener("change", () => onChange(sel.value));
    return h("div", { class: "field" }, [h("label", {}, label), sel]);
  }
  function textField(label, ph, val, onChange) {
    const inp = h("input", { placeholder: ph, value: val || "" });
    inp.addEventListener("input", () => onChange(inp.value));
    return h("div", { class: "field" }, [h("label", {}, label), inp]);
  }
  function dateRange(state, label) {
    const f = h("input", { type: "date", value: state.from || "" });
    const t = h("input", { type: "date", value: state.to || "" });
    // 校验：起始日期不能晚于结束日期（FD 各筛选区校验规则）
    f.addEventListener("change", () => {
      if (t.value && f.value && f.value > t.value) { ui.toast("起始日期不能晚于结束日期", "error"); f.value = state.from || ""; return; }
      state.from = f.value; t.min = f.value || "";
    });
    t.addEventListener("change", () => {
      if (f.value && t.value && t.value < f.value) { ui.toast("结束日期不能早于起始日期", "error"); t.value = state.to || ""; return; }
      state.to = t.value; f.max = t.value || "";
    });
    if (state.from) t.min = state.from;
    if (state.to) f.max = state.to;
    return h("div", { class: "field" }, [h("label", {}, label || "生成时间"), h("div", { class: "range" }, [f, "~", t])]);
  }
  function labelMap(enumObj) { const m = {}; Object.keys(enumObj).forEach((k) => m[k] = enumObj[k].label); return m; }
  function inRange(d, from, to) {
    if (!d) return true;
    const x = new Date(d);
    if (from && x < new Date(from + "T00:00:00")) return false;
    if (to && x > new Date(to + "T23:59:59")) return false;
    return true;
  }
  function closeAll() { document.querySelectorAll(".modal-mask").forEach((m) => m.remove()); }

  App.pages.workbench = workbench;
  App.pageUtils = { pageHead, kv, selField, textField, dateRange, labelMap, inRange, dueCell, opLogTable, compareView, infoBox, listBox2, closeAll, taskMiniTable, miniStat };
})(window.App);
