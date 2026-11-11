/* ============================================================
   tracking.js — L3-2-2 任务跟踪列表（以病例/会议为维度）
   ============================================================ */
(function (App) {
  "use strict";
  const { h, clear } = App.dom;
  const ui = App.ui, dm = App.domain, dt = App.date, F = App.fhir;
  const PU = App.pageUtils;

  function tracking() {
    if (App.auth.isExpertReadonly()) {
      return h("div", { class: "noaccess" }, [h("span", { class: "emoji" }, "🔒"), h("h2", {}, "无权访问"), h("p", {}, "会诊专家不可访问任务跟踪列表。")]);
    }
    const state = { caseType: "", owner: "", kw: "", from: "", to: "", abn: "", page: 1 };
    const root = h("div", {});
    root.appendChild(PU.pageHead("📈 任务跟踪列表", "查看诊疗调整任务执行状态与进度，接收异常预警，查询全流程执行日志"));

    // 异常预警条
    root.appendChild(alertStrip());

    root.appendChild(h("div", { class: "btn-row", style: { marginBottom: "12px" } },
      h("button", { class: "btn primary", onClick: () => taskEditModal(null, () => renderList()) }, "＋ 新建跟踪任务")));

    // 筛选
    const filter = h("div", { class: "filter-bar" });
    function buildFilter() {
      clear(filter);
      filter.appendChild(h("div", { class: "filter-row" }, [
        PU.selField("病例类型", App.enums.caseType, state.caseType, (v) => state.caseType = v),
        PU.selField("责任人", ownerMap(), state.owner, (v) => state.owner = v),
        PU.selField("异常类型", { overdue: "超时", near: "临近截止" }, state.abn, (v) => state.abn = v),
        PU.textField("搜索", "请输入患者姓名/关键字", state.kw, (v) => state.kw = v),
        PU.dateRange(state, "时间范围"),
        h("div", { class: "filter-actions" }, [
          h("button", { class: "btn primary", onClick: () => { state.page = 1; renderList(); } }, "查询"),
          h("button", { class: "btn", onClick: () => { Object.assign(state, { caseType: "", owner: "", kw: "", from: "", to: "", abn: "", page: 1 }); buildFilter(); renderList(); } }, "重置"),
        ]),
      ]));
    }
    root.appendChild(filter);

    const listBox = h("div", {});
    root.appendChild(listBox);

    function renderList() {
      clear(listBox);
      // 以病例为维度，仅含已产生任务的病例
      let rows = dm.cases().map((c) => ({ c, a: dm.apptOf(c), tasks: dm.tasksOf(c) })).filter((x) => x.tasks.length);
      rows = rows.filter((x) => {
        if (state.caseType && x.c.caseType !== state.caseType) return false;
        if (state.owner && !x.tasks.some((t) => dm.refId(t.owner.reference) === state.owner)) return false;
        if (state.abn === "overdue" && !x.tasks.some((t) => dm.taskStatus(t) === "overdue")) return false;
        if (state.abn === "near" && !x.tasks.some((t) => dm.taskDeadlineState(t) === "near")) return false;
        if (state.kw && x.c.subject.display.indexOf(state.kw) < 0 && x.c.diagnosis.indexOf(state.kw) < 0) return false;
        if (!PU.inRange(x.a.start, state.from, state.to)) return false;
        return true;
      });
      const total = rows.length, ps = 20;
      const pageRows = rows.slice((state.page - 1) * ps, state.page * ps);
      listBox.appendChild(ui.table({
        columns: [
          { title: "关联病例", render: (x) => h("span", { class: "cell-strong" }, x.c.subject.display + "-" + x.c.diagnosis) },
          { title: "病例类型", render: (x) => ui.caseTypeTag(x.c.caseType) },
          { title: "会议时间", render: (x) => x.a.start ? dt.fmtMDTime(x.a.start) : "-" },
          { title: "任务数", render: (x) => x.tasks.length },
          { title: "异常", render: (x) => abnCell(x.tasks) },
          { title: "操作", render: (x) => h("button", { class: "btn-link", onClick: () => trackDetailModal(x.c.id, renderList) }, "详情") },
        ],
        rows: pageRows,
        rowClass: (x) => x.tasks.some((t) => dm.taskStatus(t) === "overdue") ? "row-danger" : "",
        empty: "暂无诊疗调整任务",
      }));
      if (total > ps) listBox.appendChild(ui.pager({ total, pageSize: ps, page: state.page, onPage: (p) => { state.page = p; renderList(); } }));
      else listBox.appendChild(h("div", { class: "pager" }, h("span", {}, "共 " + total + " 条")));
    }
    buildFilter(); renderList();
    return root;
  }

  function alertStrip() {
    const tasks = App.fhir.all("Task");
    const overdue = tasks.filter((t) => dm.taskStatus(t) === "overdue").length;
    const near = tasks.filter((t) => dm.taskDeadlineState(t) === "near" && dm.taskStatus(t) !== "completed").length;
    const inProg = tasks.filter((t) => ["in-progress", "overdue"].indexOf(dm.taskStatus(t)) >= 0).length;
    const parts = [];
    if (overdue) parts.push(h("span", { class: "ai" }, [h("b", { class: "text-danger" }, "🔴 " + overdue), " 项超时未执行"]));
    if (near) parts.push(h("span", { class: "ai" }, [h("b", { class: "text-warn" }, "🟠 " + near), " 项临近截止（≤24h）"]));
    parts.push(h("span", { class: "ai" }, ["共 ", h("b", {}, inProg), " 项任务进行中"]));
    return h("div", { class: "alert-strip" + (overdue ? " has-danger" : "") }, parts);
  }

  function abnCell(tasks) {
    const overdue = tasks.filter((t) => dm.taskStatus(t) === "overdue").length;
    const near = tasks.filter((t) => dm.taskDeadlineState(t) === "near" && dm.taskStatus(t) !== "completed").length;
    if (!overdue && !near) return h("span", { class: "muted" }, "-");
    const frag = h("span", {});
    if (overdue) frag.appendChild(h("span", { class: "text-danger" }, "🔴" + overdue + " "));
    if (near) frag.appendChild(h("span", { class: "text-warn" }, "🟠" + near));
    return frag;
  }

  /* ---------- 任务跟踪详情弹框 ---------- */
  function trackDetailModal(caseId, refreshList) {
    const c = dm.caseById(caseId);
    const a = dm.apptOf(c);
    const sub = [
      a.start ? "讨论会议：" + dt.fmtDateTime(a.start) : "讨论会议：待安排",
      h("span", {}, ["病例类型：", ui.caseTypeTag(c.caseType)]),
      h("span", {}, ["紧急程度：", ui.urgencyView(c.urgency)]),
    ];
    const body = h("div", {});
    let expandedId = null;

    function renderTable() {
      clear(body);
      const tasks = dm.tasksOf(c);
      body.appendChild(h("div", { class: "ib-title" }, "🩺 诊疗调整任务列表"));
      const tb = h("tbody");
      tasks.forEach((t) => {
        const st = dm.taskStatus(t);
        const dl = dm.taskDeadlineState(t);
        tb.appendChild(h("tr", { class: st === "overdue" ? "row-danger" : "" }, [
          h("td", {}, t.code.text),
          h("td", {}, t.owner.display),
          h("td", {}, ui.statusTag(App.enums.taskStatus, st)),
          h("td", { class: dl === "overdue" ? "text-danger" : dl === "near" ? "text-warn" : "" }, dt.fmtDate(dm.dueOf(t))),
          h("td", {}, st === "overdue" ? h("span", { class: "text-danger" }, "🔴超时") : dl === "near" ? h("span", { class: "text-warn" }, "🟠临近") : h("span", { class: "muted" }, "-")),
          h("td", { class: "col-actions" }, [
            h("button", { class: "btn-link", onClick: () => taskEditModal(t.id, () => { renderTable(); if (refreshList) refreshList(); }) }, "编辑"),
            h("button", { class: "btn-link", onClick: () => { expandedId = expandedId === t.id ? null : t.id; renderTable(); } }, expandedId === t.id ? "收起 ▲" : "查看"),
          ]),
        ]));
        if (expandedId === t.id) {
          tb.appendChild(h("tr", {}, h("td", { colspan: 6, style: { background: "#fafcff" } }, taskExpand(t))));
        }
      });
      body.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "data" }, [
        h("thead", {}, h("tr", {}, ["任务名称", "责任人", "执行状态", "截止时间", "异常", "操作"].map((x) => h("th", {}, x)))),
        tb,
      ])));
    }
    renderTable();
    ui.modal({ title: "任务跟踪详情 · " + c.subject.display + "-" + c.diagnosis, sub, body, width: "wide" });
  }

  function taskExpand(t) {
    const box = h("div", { style: { padding: "8px 4px" } });
    box.appendChild(h("div", { class: "kv-grid", style: { marginBottom: "10px" } }, [
      kv("责任人", t.owner.display), kv("截止时间", dt.fmtDate(dm.dueOf(t))),
      h("div", { class: "kv" }, [h("span", { class: "k" }, "执行状态："), ui.statusTag(App.enums.taskStatus, dm.taskStatus(t))]),
    ]));
    box.appendChild(block("诊疗调整建议", h("div", { class: "readonly-box" }, t.adjustment || "-")));
    box.appendChild(block("执行节点", ui.steps(t.nodes)));
    // 执行医嘱
    box.appendChild(block("执行医嘱", h("div", {}, (t.orderConfirm || []).map((o) =>
      h("div", { style: { padding: "2px 0" } }, [o.done ? "☑ " : "□ ", o.text, o.done && o.time ? h("span", { class: "muted small" }, "  ✓ " + dt.fmtMDTime(o.time)) : null])))));
    // 完成检查
    box.appendChild(block("完成检查", h("div", {}, (t.checks || []).map((c) =>
      h("div", { style: { padding: "2px 0" } }, [c.done ? "☑ " : "□ ", c.name + "已完成  结果：" + (c.result || "待录入")])))));
    // 执行说明
    const notes = t.execNotes || [];
    box.appendChild(block("执行说明", notes.length ? h("div", {}, notes.map((n) => h("div", {}, n.text + " — " + n.by + " " + dt.fmtMDTime(n.time)))) : h("div", { class: "muted" }, "暂无")));
    box.appendChild(h("div", { class: "mt-8" }, h("button", { class: "btn sm", onClick: () => logModal(t) }, "查看完整日志")));
    return box;
  }

  /* ---------- 新建/编辑诊疗调整任务（跟踪任务闭环补充入口） ---------- */
  function taskEditModal(taskId, refresh) {
    const isCreate = !taskId;
    const t = isCreate ? null : F.read("Task", taskId);
    // 新建：可选范围为已产生讨论结论（非"待安排"）的病例
    const eligibleCases = dm.cases().filter((cc) => cc.status !== "pending");
    const state = { caseId: isCreate ? (eligibleCases[0] && eligibleCases[0].id) : dm.refId(t.focus.reference) };
    const body = h("div", {});
    function renderBody() {
      clear(body);
      if (!state.caseId) { body.appendChild(ui.emptyState("暂无可关联的病例（需已产生讨论结论）")); return; }
      const c = dm.caseById(state.caseId);
      let caseField;
      if (isCreate) {
        const sel = h("select", { class: "input-full" }, eligibleCases.map((cc) => h("option", { value: cc.id }, cc.subject.display + "-" + cc.diagnosis)));
        sel.value = state.caseId;
        sel.addEventListener("change", () => { state.caseId = sel.value; renderBody(); });
        caseField = frow("关联病例", sel, true);
      } else {
        caseField = frow("关联病例", h("input", { class: "input-full", value: c.subject.display + "-" + c.diagnosis, disabled: true }), true);
      }
      const nameInp = h("input", { class: "input-full", value: isCreate ? "" : t.code.text, placeholder: "如：调整抗凝方案" });
      const staff = F.all("Practitioner").filter((p) => ["attending", "expert", "director"].indexOf(App.auth.ext(p, "role")) >= 0);
      const ownerSel = h("select", {}, staff.map((p) => h("option", { value: p.id }, p.name[0].text + "（" + App.auth.ext(p, "dept") + "）")));
      ownerSel.value = isCreate ? dm.refId(c.attending.reference) : dm.refId(t.owner.reference);
      const dueInp = h("input", { type: "date", value: isCreate ? dt.fmtDate(dt.addDays(dt.now(), 3)) : dt.fmtDate(dm.dueOf(t)) });
      const adjArea = h("textarea", { class: "input-full", placeholder: "诊疗调整建议..." }, isCreate ? "" : (t.adjustment || ""));
      body.appendChild(h("div", { class: "info-block" }, [
        h("div", { class: "ib-title" }, "基本信息"),
        caseField, frow("任务名称", nameInp, true), frow("责任人", ownerSel, true), frow("截止时间", dueInp, true), frow("诊疗调整建议", adjArea),
      ]));
      body._collect = () => ({ name: nameInp.value.trim(), ownerId: ownerSel.value, due: dueInp.value, adjustment: adjArea.value });
    }
    renderBody();
    const m = ui.modal({
      title: isCreate ? "新建跟踪任务" : "编辑跟踪任务", body,
      footer: [
        h("button", { class: "btn", onClick: () => m.close() }, "取消"),
        h("button", { class: "btn primary", onClick: () => {
          if (!state.caseId) { ui.toast("暂无可关联的病例", "error"); return; }
          const data = body._collect();
          if (!data.name) { ui.toast("请填写任务名称", "error"); return; }
          if (!data.due) { ui.toast("请选择截止时间", "error"); return; }
          ui.confirmBox({ title: isCreate ? "新建任务" : "保存修改", message: "确认" + (isCreate ? "新建" : "保存") + "该跟踪任务？" }).then((ok) => {
            if (!ok) return;
            if (isCreate) dm.createTask(state.caseId, data); else dm.updateTaskDetail(taskId, data);
            ui.toast(isCreate ? "已新建跟踪任务" : "已保存修改", "success");
            App.app.refreshMsgBadge();
            m.close(); if (refresh) refresh();
          });
        } }, "保存"),
      ],
    });
  }
  function frow(label, ctrl, req) { return h("div", { style: { marginBottom: "12px" } }, [h("label", { class: req ? "req" : "", style: { display: "block", marginBottom: "4px", fontSize: "13px", color: "var(--c-text-sub)" } }, label), ctrl]); }

  function logModal(t) {
    const state = { from: "", to: "" };
    const body = h("div", {});
    const listBox = h("div", {});
    function render() {
      clear(listBox);
      let logs = App.fhir.opsFor("Task/" + t.id, (l) => PU.inRange(l.recorded, state.from, state.to));
      listBox.appendChild(ui.table({
        columns: [
          { title: "操作人", render: (l) => l.who },
          { title: "操作时间", render: (l) => dt.fmtDateTime(l.recorded) },
          { title: "操作内容", render: (l) => l.what },
        ], rows: logs, empty: "暂无日志",
      }));
      listBox.appendChild(h("div", { class: "pager" }, h("span", {}, "共 " + logs.length + " 条")));
    }
    const fromI = h("input", { type: "date" }), toI = h("input", { type: "date" });
    fromI.addEventListener("change", () => state.from = fromI.value);
    toI.addEventListener("change", () => state.to = toI.value);
    body.appendChild(h("div", { class: "filter-bar" }, h("div", { class: "filter-row" }, [
      h("div", { class: "field" }, [h("label", {}, "时间范围"), h("div", { class: "range" }, [fromI, "~", toI])]),
      h("div", { class: "filter-actions" }, [h("button", { class: "btn primary", onClick: render }, "查询"), h("button", { class: "btn", onClick: () => { state.from = ""; state.to = ""; fromI.value = ""; toI.value = ""; render(); } }, "重置")]),
    ])));
    body.appendChild(listBox);
    render();
    ui.modal({ title: "执行日志 · " + t.code.text, body });
  }

  function block(title, node) { return h("div", { class: "info-block", style: { marginBottom: "10px" } }, [h("div", { class: "ib-title" }, title), node]); }
  function kv(k, v) { return h("div", { class: "kv" }, [h("span", { class: "k" }, k + "："), h("span", { class: "v" }, v)]); }
  function ownerMap() { const m = {}; App.fhir.all("Task").forEach((t) => m[dm.refId(t.owner.reference)] = t.owner.display); return m; }

  App.pages.tracking = tracking;
})(window.App);
