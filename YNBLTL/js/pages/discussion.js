/* ============================================================
   discussion.js — L2-2 讨论组织及跟踪管理 / L3-2-1 讨论会议列表
   ============================================================ */
(function (App) {
  "use strict";
  const { h, clear } = App.dom;
  const ui = App.ui, dm = App.domain, dt = App.date, views = App.views, F = App.fhir;
  const PU = App.pageUtils;
  const nav = (x) => App.router.navigate(x);

  App.pages._crumb = App.pages._crumb || {};
  App.pages._crumb.discussion = function (p) {
    if (p.tab === "tracking") return [["讨论组织及跟踪管理", "#/discussion"], ["任务跟踪列表", null]];
    if (p.tab === "meetings") return [["讨论组织及跟踪管理", "#/discussion"], ["讨论会议列表", null]];
    return null;
  };

  function discussion(params) {
    if (params.tab === "meetings") return meetingsPage();
    if (params.tab === "tracking") return App.pages.tracking();
    return overviewPage();
  }

  /* ---------- L2-2 概览 ---------- */
  function overviewPage() {
    const appts = dm.cases().map(dm.apptOf).filter(Boolean);
    const cnt = (st) => appts.filter((a) => a.status === st).length;
    const tasks = App.fhir.all("Task");
    const inProg = tasks.filter((t) => dm.taskStatus(t) === "in-progress").length;
    const abnormal = tasks.filter((t) => ["overdue"].indexOf(dm.taskStatus(t)) >= 0).length;
    const near = tasks.filter((t) => dm.taskDeadlineState(t) === "near").length;
    const isExpert = App.auth.isExpertReadonly();
    const wrap = h("div", {});
    wrap.appendChild(PU.pageHead("📅 讨论组织及跟踪管理", "管理讨论会议与跟踪诊疗任务执行，汇总待办与异常预警"));

    // 会诊专家不负责安排会议，"讨论会议概览"不展示"待安排"数据（会议安排是科室主任的职责）
    const meetingStats = [];
    if (!isExpert) meetingStats.push(PU.miniStat("待安排", cnt("pending"), "gray"));
    meetingStats.push(PU.miniStat("已安排", cnt("scheduled"), "blue"), PU.miniStat("进行中", cnt("ongoing"), "orange"), PU.miniStat("已完成", cnt("completed"), "green"));

    wrap.appendChild(h("div", { class: "grid grid-2 section" }, [
      h("div", { class: "card card-pad" }, [
        h("div", { class: "section-title" }, [h("span", { class: "bar" }), "讨论会议概览"]),
        h("div", { class: "flex gap-16", style: { marginTop: "6px" } }, meetingStats),
        h("div", { class: "mt-12" }, h("a", { href: "#/discussion?tab=meetings" }, "进入讨论会议列表 →")),
      ]),
      h("div", { class: "card card-pad" }, [
        h("div", { class: "section-title" }, [h("span", { class: "bar" }), "任务跟踪概览"]),
        h("div", { class: "flex gap-16", style: { marginTop: "6px" } }, [
          PU.miniStat("进行中", inProg, "blue"),
          PU.miniStat("临近截止", near, "orange"),
          PU.miniStat("异常/超时", abnormal, "red"),
        ]),
        App.auth.currentRoleKey() === "expert" ? null : h("div", { class: "mt-12" }, h("a", { href: "#/discussion?tab=tracking" }, "进入任务跟踪列表 →")),
      ]),
    ]));

    // 近期会议安排
    const upcoming = appts.filter((a) => a.start && new Date(a.start) >= dt.now() && a.status === "scheduled").sort((a, b) => new Date(a.start) - new Date(b.start));
    wrap.appendChild(h("div", { class: "card card-pad section" }, [
      h("div", { class: "section-title" }, [h("span", { class: "bar" }), "近期会议安排"]),
      upcoming.length ? h("ul", { class: "timeline-simple" }, upcoming.map((a) => {
        const c = dm.caseById(dm.refId(a.discussion.reference));
        const confirmed = (a.participant || []).filter((p) => p.status === "accepted").length;
        return h("li", {}, [h("div", {}, c.subject.display + "-" + c.diagnosis), h("div", { class: "t-time" }, dt.fmtDateTime(a.start) + " · 已确认 " + confirmed + " 人")]);
      })) : h("div", { class: "muted" }, "近期暂无已安排会议"),
    ]));

    // 异常任务预警
    const overdueTasks = tasks.filter((t) => dm.taskStatus(t) === "overdue");
    wrap.appendChild(h("div", { class: "card card-pad section" }, [
      h("div", { class: "section-title" }, [h("span", { class: "bar" }), "异常任务预警"]),
      overdueTasks.length ? h("ul", { class: "timeline-simple" }, overdueTasks.map((t) => h("li", {}, [
        h("div", { class: "text-danger" }, "⚠ " + t.code.text + "（" + t.for.display + " · 责任人 " + t.owner.display + "）超时未执行"),
        h("div", { class: "t-time" }, "截止：" + dt.fmtDate(dm.dueOf(t))),
      ]))) : h("div", { class: "muted" }, "暂无异常任务"),
    ]));

    return wrap;
  }

  /* ---------- L3-2-1 讨论会议列表 ---------- */
  function meetingsPage() {
    const isExpert = App.auth.isExpertReadonly();
    const state = { status: "", caseType: "", dept: "", kw: "", from: "", to: "", quickSoon: false, page: 1 };
    const root = h("div", {});
    root.appendChild(PU.pageHead("📅 讨论会议列表", "展示所有疑难病例讨论会议记录，支持查看会议状态与发起讨论"));

    // 待处理提醒条：三张卡片本身即为条件筛选入口
    const remindBox = h("div", {});
    root.appendChild(remindBox);

    // 筛选 + 新建
    const filter = h("div", { class: "filter-bar" });
    function buildFilter() {
      clear(filter);
      filter.appendChild(h("div", { class: "filter-row" }, [
        PU.selField("会议状态", labelMap(App.enums.meetingStatus), state.status, (v) => state.status = v),
        PU.selField("病例类型", App.enums.caseType, state.caseType, (v) => state.caseType = v),
        PU.selField("发起科室", deptMap(), state.dept, (v) => state.dept = v),
        PU.textField("搜索", "请输入患者姓名/关键字", state.kw, (v) => state.kw = v),
        PU.dateRange(state, "会议时间"),
        h("div", { class: "filter-actions" }, [
          h("button", { class: "btn primary", onClick: () => { state.page = 1; renderList(); } }, "查询"),
          h("button", { class: "btn", onClick: () => { Object.assign(state, { status: "", caseType: "", dept: "", kw: "", from: "", to: "", quickSoon: false, page: 1 }); buildFilter(); renderList(); } }, "重置"),
        ]),
      ]));
    }
    root.appendChild(filter);
    if (!isExpert) root.appendChild(h("div", { class: "btn-row", style: { marginBottom: "12px" } }, h("button", { class: "btn primary", onClick: () => nav("#/meeting-create") }, "＋ 新建讨论")));

    const listBox = h("div", {});
    root.appendChild(listBox);

    function isSoon(a) {
      if (!a.start || ["scheduled", "ongoing"].indexOf(a.status) < 0) return false;
      const diff = (new Date(a.start) - dt.now()) / 60000;
      return diff <= 30 && diff >= -60;
    }
    // 会议时间筛选：仅当填写了起止时间才生效；未安排会议（无会议时间）在指定范围
    // 查询时应被排除，而不是像通用 inRange 那样对空值一律放行。
    function inMeetingRange(a) {
      if (!state.from && !state.to) return true;
      if (!a.start) return false;
      return PU.inRange(a.start, state.from, state.to);
    }

    function renderRemind() {
      clear(remindBox);
      const appts = dm.cases().map(dm.apptOf).filter(Boolean);
      const u = App.auth.current();
      const toSchedule = appts.filter((a) => a.status === "pending");
      const toConfirm = appts.filter((a) => (a.participant || []).some((p) => dm.refId(p.actor.reference) === u.id && p.status === "tentative"));
      const soon = appts.filter(isSoon);
      const cards = [];
      if (!isExpert && toSchedule.length) cards.push(remindCard("待安排会议", toSchedule.length, "需安排会议时间的讨论 · 点击按此条件查询", () => {
        Object.assign(state, { status: "pending", quickSoon: false, page: 1 }); buildFilter(); renderList();
      }));
      if (toConfirm.length) cards.push(remindCard("待确认参会", toConfirm.length, "待您确认参会的讨论会议", () => App.app.openNotifications()));
      if (soon.length) cards.push(remindCard("即将开始", soon.length, "30分钟内即将开始的讨论会议 · 点击按此条件查询", () => {
        Object.assign(state, { status: "", quickSoon: true, page: 1 }); buildFilter(); renderList();
      }));
      if (cards.length) remindBox.appendChild(h("div", { class: "grid grid-3 section" }, cards));
    }

    function renderList() {
      clear(listBox);
      let rows = dm.cases().map((c) => ({ c, a: dm.apptOf(c) })).filter((x) => x.a);
      if (isExpert) rows = rows.filter((x) => x.a.status !== "pending"); // 专家仅见已安排/进行中/已完成
      rows = rows.filter((x) =>
        (!state.status || x.a.status === state.status) &&
        (!state.caseType || x.c.caseType === state.caseType) &&
        (!state.dept || x.c.dept === state.dept) &&
        (!state.kw || x.c.subject.display.indexOf(state.kw) >= 0 || x.c.diagnosis.indexOf(state.kw) >= 0 || (x.a.description || "").indexOf(state.kw) >= 0) &&
        (!state.quickSoon || isSoon(x.a)) &&
        inMeetingRange(x.a));
      rows.sort((a, b) => new Date(b.a.start || 0) - new Date(a.a.start || 0));
      const total = rows.length, ps = 20;
      const pageRows = rows.slice((state.page - 1) * ps, state.page * ps);
      listBox.appendChild(ui.table({
        columns: [
          { title: "病例名称", render: (x) => h("span", { class: "cell-strong" }, x.c.subject.display + "-" + (x.a.description || x.c.diagnosis)) },
          { title: "发起科室", render: (x) => x.c.dept },
          { title: "病例类型", render: (x) => ui.caseTypeTag(x.c.caseType) },
          { title: "会议时间", render: (x) => x.a.status === "pending" ? "-" : (x.a.start ? dt.fmtMDTime(x.a.start) : "-") },
          { title: "状态", render: (x) => ui.statusTag(App.enums.meetingStatus, x.a.status) },
          { title: "发起人", render: (x) => x.a.creator ? x.a.creator.display : "-" },
          { title: "参会", render: (x) => partRatio(x.a) },
          { title: "操作", render: (x) => meetingActions(x.c, x.a, renderList) },
        ],
        rows: pageRows, rowClass: (x) => x.c.urgency === "high" ? "urgent-high" : "",
        empty: "暂无讨论会议记录",
      }));
      if (total > ps) listBox.appendChild(ui.pager({ total, pageSize: ps, page: state.page, onPage: (p) => { state.page = p; renderList(); } }));
      else listBox.appendChild(h("div", { class: "pager" }, h("span", {}, "共 " + total + " 条")));
    }
    buildFilter(); renderRemind(); renderList();
    return root;
  }

  // "待安排会议""即将开始"两张卡片即条件筛选入口——点击后直接按对应条件查询讨论会议列表，
  // 因此不再提供单独的"查看详情"按钮，整张卡片可点击。
  function remindCard(title, num, desc, onClick) {
    return h("div", { class: "remind-card", style: { cursor: "pointer" }, onClick }, [
      h("div", { class: "rc-num" }, num),
      h("div", { class: "rc-label" }, title),
      h("div", { class: "rc-desc" }, desc),
    ]);
  }

  function meetingActions(c, a, refresh) {
    const isExpert = App.auth.isExpertReadonly();
    const frag = h("span", { class: "col-actions" });
    if (a.status === "pending") {
      if (!isExpert) frag.appendChild(h("button", { class: "btn-link", onClick: () => nav("#/meeting-create?case=" + c.id) }, "安排讨论"));
      else frag.appendChild(h("span", { class: "muted small" }, "—"));
    } else if (a.status === "ongoing") {
      frag.appendChild(h("button", { class: "btn-link", onClick: () => nav("#/research?case=" + c.id) }, "进入研讨"));
      frag.appendChild(h("button", { class: "btn-link", onClick: () => meetingDetailModal(c.id, refresh) }, "详情"));
    } else {
      frag.appendChild(h("button", { class: "btn-link", onClick: () => meetingDetailModal(c.id, refresh) }, "详情"));
    }
    return frag;
  }

  function partRatio(a) {
    const total = (a.participant || []).length;
    const confirmed = (a.participant || []).filter((p) => p.status === "accepted").length;
    return total ? (confirmed + "/" + total) : "-";
  }

  /* ---------- 会议详情弹框 ---------- */
  function meetingDetailModal(caseId, refresh) {
    const sub0 = () => {
      const c0 = dm.caseById(caseId), a0 = dm.apptOf(c0);
      return [
        "住院号 " + dm.mrn(dm.patientOf(c0)),
        "会议状态：" + App.enums.meetingStatus[a0.status].label,
        a0.start ? "会议时间：" + dt.fmtDateTime(a0.start) : "会议时间：待安排",
      ];
    };
    const body = h("div", {});
    const seg = ui.segTabs([
      { key: "info", label: "患者基本信息" },
      { key: "meeting", label: "会议信息" },
      { key: "tasks", label: "任务跟踪" },
    ], render);
    body.appendChild(seg.el);
    const content = h("div", {}); body.appendChild(content);
    const m = ui.modal({ title: "讨论会议详情", sub: sub0(), body });

    function render(k) {
      clear(content);
      // 每次渲染都重新读取最新数据，保证签名/参会状态等实时变化后弹框能立刻反映
      const c = dm.caseById(caseId);
      const a = dm.apptOf(c);
      if (k === "info") {
        content.appendChild(views.patientSummary(c));
        content.appendChild(h("div", { class: "info-block" }, [h("div", { class: "ib-title" }, "📚 病历资料"), views.materialTabs(c)]));
        content.appendChild(views.criteriaCard(c));
        content.appendChild(views.sourceInfo(c));
      } else if (k === "meeting") {
        renderMeetingInfo(content, c, a, m, () => render("meeting"), refresh);
      } else {
        renderTaskTrack(content, c);
      }
    }
    render("info");
  }

  function renderMeetingInfo(content, c, a, modal, refreshTab, refreshList) {
    const isExpert = App.auth.isExpertReadonly();
    // 会议基础信息
    content.appendChild(h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "📋 会议基础信息"),
      h("div", { class: "kv-grid" }, [
        kv("讨论主题", a.description),
        h("div", { class: "kv" }, [h("span", { class: "k" }, "病例类型："), ui.caseTypeTag(c.caseType)]),
        h("div", { class: "kv" }, [h("span", { class: "k" }, "紧急程度："), ui.urgencyView(c.urgency)]),
        kv("会议时间", a.start ? dt.fmtDateTime(a.start) : "待安排"),
        kv("会议地点", a.location || "-"),
        kv("预计时长", (a.minutesDuration || 60) + "分钟"),
        kv("发起人", a.creator ? a.creator.display : "-"),
      ]),
    ]));

    // 参会人员（含确认参会/拒绝参会、提醒确认、重新邀请）
    content.appendChild(views.participantTable(c, a, () => { if (refreshTab) refreshTab(); if (refreshList) refreshList(); }));
    if (!isExpert && a.status !== "completed") {
      content.appendChild(h("div", { class: "mt-8 mb-8" }, h("button", { class: "btn sm", onClick: () => inviteModal(c, a, () => { if (refreshTab) refreshTab(); if (refreshList) refreshList(); }) }, "＋ 追加邀请")));
    }

    // 病例研讨记录：以会议（Appointment）状态判断是否已开始，而不是讨论任务状态
    // （会议提前召开时两者可能不同步）
    content.appendChild(h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "📝 病例研讨记录"),
      (a.status !== "pending" && dm.compOf(c)) ? h("div", {}, [views.recordViewer(c), signInline(c)]) : h("div", { class: "muted" }, "暂无研讨记录"),
    ]));

    // 操作按钮区
    const ops = h("div", { class: "btn-row" });
    if (a.status === "pending" && !isExpert) ops.appendChild(h("button", { class: "btn primary", onClick: () => { modal.close(); nav("#/meeting-create?case=" + c.id); } }, "安排讨论"));
    if (a.status === "scheduled") {
      ops.appendChild(h("button", { class: "btn primary", onClick: () => { modal.close(); nav("#/research?case=" + c.id); } }, "进入研讨"));
      if (!isExpert) ops.appendChild(h("button", { class: "btn", onClick: () => { modal.close(); nav("#/meeting-create?case=" + c.id); } }, "编辑会议"));
    }
    if (a.status === "ongoing") ops.appendChild(h("button", { class: "btn primary", onClick: () => { modal.close(); nav("#/research?case=" + c.id); } }, "进入研讨"));
    if (ops.children.length) content.appendChild(ops);
  }

  // 追加邀请：不跳转页面，弹框内展示"参会人员邀请"模块，默认勾选原有人员（可修改）
  function inviteModal(c, a, onDone) {
    const selected = new Set((a.participant || []).map((p) => dm.refId(p.actor.reference)));
    const state = { dept: "", title: "", kw: "" };
    const box = h("div", {});
    let selCountEl = null;
    function renderBox() {
      clear(box);
      // 邀请范围：主管医生/会诊专家/科室主任均可被邀请（此前遗漏主管医生，导致本人患者的
      // 责任医生反而不在受邀名单里）
      const pool = F.all("Practitioner").filter((p) => ["expert", "director", "attending"].indexOf(App.auth.ext(p, "role")) >= 0);
      const dSel = h("select", {}, [h("option", { value: "" }, "全部"), ...App.util.uniq(pool.map((e) => App.auth.ext(e, "dept"))).map((d) => h("option", { value: d }, d))]);
      const tSel = h("select", {}, [h("option", { value: "" }, "全部"), ...App.util.uniq(pool.map((e) => e.qualification[0].code.text)).map((t) => h("option", { value: t }, t))]);
      const kwInp = h("input", { placeholder: "输入姓名搜索...", value: state.kw });
      dSel.value = state.dept; tSel.value = state.title;
      dSel.addEventListener("change", () => { state.dept = dSel.value; renderBox(); });
      tSel.addEventListener("change", () => { state.title = tSel.value; renderBox(); });
      kwInp.addEventListener("input", () => { state.kw = kwInp.value; renderBox(); });
      box.appendChild(h("div", { class: "filter-row", style: { marginBottom: "10px" } }, [
        h("div", { class: "field" }, [h("label", {}, "科室"), dSel]),
        h("div", { class: "field" }, [h("label", {}, "职称"), tSel]),
        h("div", { class: "field" }, [h("label", {}, "姓名"), kwInp]),
      ]));
      const filtered = pool.filter((e) =>
        (!state.dept || App.auth.ext(e, "dept") === state.dept) &&
        (!state.title || e.qualification[0].code.text === state.title) &&
        (!state.kw || e.name[0].text.indexOf(state.kw) >= 0));
      const tbody = h("tbody");
      filtered.forEach((e) => {
        const sc = App.enums.scheduleStatus[App.scheduleStatusOf(e.id)];
        const disabled = !sc.selectable;
        const cb = h("input", { type: "checkbox", disabled, checked: selected.has(e.id) });
        cb.addEventListener("change", () => { if (cb.checked) selected.add(e.id); else selected.delete(e.id); selCountEl.textContent = "已选 " + selected.size + " 人"; });
        tbody.appendChild(h("tr", { style: disabled ? { opacity: ".5" } : (App.scheduleStatusOf(e.id) === "conflict" ? { background: "#fffbe9" } : {}) }, [
          h("td", {}, cb), h("td", {}, e.name[0].text), h("td", {}, App.auth.ext(e, "dept")), h("td", {}, e.qualification[0].code.text),
          h("td", {}, sc.dot + " " + sc.label + (disabled ? "（不可邀请）" : "")),
        ]));
      });
      box.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "data" }, [
        h("thead", {}, h("tr", {}, [h("th", {}, ""), h("th", {}, "姓名"), h("th", {}, "科室"), h("th", {}, "职称"), h("th", {}, "排班状态")])),
        tbody,
      ])));
      selCountEl = h("span", { class: "muted" }, "已选 " + selected.size + " 人");
      box.appendChild(h("div", { class: "flex between items-center mt-8" }, [selCountEl, h("span", { class: "small muted" }, "已默认勾选原有参会人员，可修改")]));
    }
    renderBox();
    const m = ui.modal({
      title: "参会人员邀请 · " + c.subject.display, body: box,
      footer: [
        h("button", { class: "btn", onClick: () => m.close() }, "取消"),
        h("button", { class: "btn primary", onClick: () => {
          if (!selected.size) { ui.toast("请至少选择1位参会人员", "error"); return; }
          dm.updateParticipants(c.id, Array.from(selected));
          ui.toast("参会人员邀请已更新", "success");
          App.app.refreshMsgBadge();
          m.close();
          if (onDone) onDone();
        } }, "确定"),
      ],
    });
  }

  function signInline(c) {
    const comp = dm.compOf(c);
    if (!comp) return h("div", {});
    const a = dm.apptOf(c);
    const accepted = (a.participant || []).filter((p) => p.status === "accepted");
    const signed = comp.attester || [];
    return h("div", { class: "mt-8" }, [
      h("div", { style: { fontWeight: "600", marginBottom: "4px" } }, "电子签名状态："),
      h("div", {}, accepted.map((p) => {
        const att = signed.find((s) => dm.refId(s.party.reference) === dm.refId(p.actor.reference));
        return h("span", { class: "sign-line" }, att ? ["✅ ", p.actor.display + " " + dt.fmtMDTime(att.time)] : ["⏳ ", p.actor.display + " 待签名"]);
      })),
    ]);
  }

  function renderTaskTrack(content, c) {
    const tasks = dm.tasksOf(c);
    if (!tasks.length) { content.appendChild(h("div", { class: "info-block muted" }, "暂无诊疗调整任务（待安排/已安排状态时显示）")); return; }
    const progBox = h("div", {});
    content.appendChild(h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "🩺 诊疗调整任务列表"),
      ui.table({
        columns: [
          { title: "任务名称", render: (t) => t.code.text },
          { title: "执行状态", render: (t) => ui.statusTag(App.enums.taskStatus, dm.taskStatus(t)) },
          { title: "责任人", render: (t) => t.owner.display },
          { title: "截止时间", render: (t) => PU.dueCell(t) },
          { title: "操作", render: (t) => h("button", { class: "btn-link", onClick: () => { clear(progBox); progBox.appendChild(taskProgress(t)); } }, "查看") },
        ], rows: tasks, empty: "暂无任务",
      }),
    ]));
    content.appendChild(progBox);
  }

  function taskProgress(t) {
    return h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "📈 任务执行进度 · " + t.code.text),
      ui.steps(t.nodes),
    ]);
  }

  function kv(k, v) { return h("div", { class: "kv" }, [h("span", { class: "k" }, k + "："), h("span", { class: "v" }, v)]); }
  function labelMap(e) { const m = {}; Object.keys(e).forEach((k) => m[k] = e[k].label); return m; }
  function deptMap() { const m = {}; App.util.uniq(dm.cases().map((c) => c.dept)).forEach((d) => m[d] = d); return m; }

  App.pages.discussion = discussion;
  App.pages.meetingDetail = meetingDetailModal;
})(window.App);
