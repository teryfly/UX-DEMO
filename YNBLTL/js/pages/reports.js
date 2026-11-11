/* ============================================================
   reports.js — L2-3/L3-3-1 质量监控报表 · 讨论统计与溯源
   ============================================================ */
(function (App) {
  "use strict";
  const { h, clear } = App.dom;
  const ui = App.ui, dm = App.domain, dt = App.date;
  const PU = App.pageUtils;

  App.pages._crumb = App.pages._crumb || {};
  App.pages._crumb.reports = function () { return [["质量监控报表", "#/reports"], ["讨论统计与溯源", null]]; };

  function reports() {
    const state = { dept: "", caseType: "", from: "", to: "", template: "month", tab: "stat" };
    const root = h("div", {});
    root.appendChild(PU.pageHead("📊 讨论统计与溯源", "多维度统计报表与单例病例全流程溯源"));

    // C 核心指标概览（切换Tab时保持显示）
    const kpiBox = h("div", { class: "section" });
    function renderKpi() {
      clear(kpiBox);
      const k = dm.kpis(filterObj());
      kpiBox.appendChild(h("div", { class: "grid grid-3" }, [
        kpiCard("讨论完成率", k.discRate + "%", k.discRate, "green", "较上月 +5%"),
        kpiCard("任务落实率", k.taskRate + "%", k.taskRate, "orange", "较上月 +3%"),
        avgCard("平均讨论周期", k.avgCycle + "天", "较上月 -0.5天"),
      ]));
      kpiBox.appendChild(h("div", { class: "small muted mt-8" }, "数据更新时间：" + dt.fmtDateTime(dt.now())));
    }
    root.appendChild(kpiBox);

    // D 数据筛选面板
    const filterBox = h("div", { class: "filter-bar" });
    function buildFilter() {
      clear(filterBox);
      const tplBtns = [["month", "本月"], ["quarter", "本季度"], ["custom", "自定义"]].map(([k, l]) =>
        h("button", { class: "btn sm" + (state.template === k ? " primary" : ""), onClick: () => { state.template = k; applyTemplate(k); buildFilter(); renderAll(); } }, l));
      const dSel = h("select", {}, [h("option", { value: "" }, "全部"), ...App.util.uniq(dm.cases().map((c) => c.dept)).map((d) => h("option", { value: d }, d))]);
      dSel.value = state.dept; dSel.addEventListener("change", () => state.dept = dSel.value);
      const tSel = h("select", {}, [h("option", { value: "" }, "全部"), ...Object.keys(App.enums.caseType).map((k) => h("option", { value: k }, App.enums.caseType[k]))]);
      tSel.value = state.caseType; tSel.addEventListener("change", () => state.caseType = tSel.value);
      const fromI = h("input", { type: "date", value: state.from }), toI = h("input", { type: "date", value: state.to });
      fromI.addEventListener("change", () => state.from = fromI.value);
      toI.addEventListener("change", () => state.to = toI.value);
      filterBox.appendChild(h("div", {}, [
        h("div", { class: "flex items-center gap-8 mb-12" }, [h("span", { class: "small muted" }, "快捷筛选："), ...tplBtns]),
        h("div", { class: "filter-row" }, [
          h("div", { class: "field" }, [h("label", {}, "科室"), dSel]),
          h("div", { class: "field" }, [h("label", {}, "病例类型"), tSel]),
          h("div", { class: "field" }, [h("label", {}, "时间范围"), h("div", { class: "range" }, [fromI, "~", toI])]),
          h("div", { class: "filter-actions" }, [
            h("button", { class: "btn primary", onClick: renderAll }, "查询"),
            h("button", { class: "btn", onClick: () => { state.dept = ""; state.caseType = ""; state.from = ""; state.to = ""; buildFilter(); renderAll(); } }, "重置"),
          ]),
        ]),
      ]));
    }
    function applyTemplate(k) {
      if (k === "month") { state.from = "2026-06-01"; state.to = "2026-06-30"; }
      else if (k === "quarter") { state.from = "2026-04-01"; state.to = "2026-06-30"; }
    }
    root.appendChild(filterBox);

    // E 内容Tab
    const tabEl = ui.tabs([{ key: "stat", label: "统计报表" }, { key: "trace", label: "病例溯源" }], (k) => { state.tab = k; renderContent(); }, "stat");
    root.appendChild(tabEl.el);
    const content = h("div", {});
    root.appendChild(content);

    function filterObj() { return { dept: state.dept, caseType: state.caseType, from: state.from, to: state.to }; }
    function renderAll() { renderKpi(); renderContent(); }
    function renderContent() {
      clear(content);
      if (state.tab === "stat") renderStat(content, filterObj());
      else renderTrace(content, filterObj());
    }

    applyTemplate("month");
    buildFilter(); renderKpi(); renderContent();
    return root;
  }

  /* ---------- 统计报表 ---------- */
  function renderStat(content, filter) {
    // F1 病例数量趋势
    content.appendChild(h("div", { class: "card card-pad section" }, [
      h("div", { class: "section-title" }, [h("span", { class: "bar" }), "病例数量趋势"]),
      ui.barChart({ data: dm.monthlyTrend(filter), legend: ["识别病例数", "已完成讨论数", "已落实任务数"] }),
    ]));

    // F2 完成率 & 落实率
    const k = dm.kpis(filter);
    content.appendChild(h("div", { class: "grid grid-2 section" }, [
      h("div", { class: "card card-pad" }, [h("div", { class: "section-title" }, [h("span", { class: "bar" }), "讨论完成率"]), ui.donut(k.discRate, "var(--c-success)", h("div", {}, [h("div", {}, "已完成 " + k.discRate + "%"), h("div", { class: "muted" }, "未完成 " + (100 - k.discRate) + "%")]))]),
      h("div", { class: "card card-pad" }, [h("div", { class: "section-title" }, [h("span", { class: "bar" }), "任务落实率"]), ui.donut(k.taskRate, "var(--c-warn)", h("div", {}, [h("div", {}, "已落实 " + k.taskRate + "%"), h("div", { class: "muted" }, "未落实 " + (100 - k.taskRate) + "%")]))]),
    ]));

    // F3 科室排名对比
    content.appendChild(h("div", { class: "card card-pad section" }, [
      h("div", { class: "section-title" }, [h("span", { class: "bar" }), "科室排名对比"]),
      ui.table({
        columns: [
          { title: "科室", render: (r) => r.dept },
          { title: "讨论完成率", render: (r) => r.discRate + "%" },
          { title: "排名", render: (r) => "No." + r.rank },
          { title: "任务落实率", render: (r) => r.taskRate + "%" },
          { title: "病例数", render: (r) => r.count },
        ], rows: dm.deptRanking(filter), empty: "暂无数据",
      }),
    ]));

    // F4 导出
    content.appendChild(h("div", { class: "btn-row section" }, [
      h("button", { class: "btn", onClick: () => ui.toast("已导出 Excel（演示）", "success") }, "📊 导出Excel"),
      h("button", { class: "btn", onClick: () => ui.toast("已导出 PDF（演示）", "success") }, "📄 导出PDF"),
    ]));
  }

  /* ---------- 病例溯源 ---------- */
  function renderTrace(content, filter) {
    const state = { kw: "" };
    const searchBox = h("div", { class: "filter-bar" });
    const inp = h("input", { class: "input-full", placeholder: "输入医生姓名 / 患者姓名 / 病例编号...", style: { maxWidth: "320px" } });
    searchBox.appendChild(h("div", { class: "filter-row" }, [
      h("div", { class: "field" }, [h("label", {}, "按责任人 / 病例搜索"), inp]),
      h("div", { class: "filter-actions" }, [h("button", { class: "btn primary", onClick: () => { state.kw = inp.value.trim(); renderResult(); } }, "搜索"), h("button", { class: "btn", onClick: () => { state.kw = ""; inp.value = ""; renderResult(); } }, "重置")]),
    ]));
    content.appendChild(searchBox);
    const result = h("div", {});
    content.appendChild(result);

    function renderResult() {
      clear(result);
      // 上方"数据筛选面板"（科室/病例类型/时间范围）与本页搜索框共同生效
      const csIds = new Set(dm.filterCases ? dm.filterCases(filter).map((c) => c.id) : dm.cases().map((c) => c.id));
      let tasks = App.fhir.all("Task").filter((t) => csIds.has(dm.refId(t.focus.reference)));
      if (state.kw) tasks = tasks.filter((t) => t.owner.display.indexOf(state.kw) >= 0 || t.for.display.indexOf(state.kw) >= 0 || (dm.caseById(dm.refId(t.focus.reference)).caseCode || "").indexOf(state.kw) >= 0);
      if (!tasks.length) { result.appendChild(ui.emptyState("未找到匹配的病例记录，请调整搜索条件", "🔍")); return; }
      result.appendChild(ui.table({
        columns: [
          { title: "任务名称", render: (t) => t.code.text },
          { title: "关联病例", render: (t) => t.for.display + "-" + dm.caseById(dm.refId(t.focus.reference)).diagnosis },
          { title: "病例类型", render: (t) => ui.caseTypeTag(dm.caseById(dm.refId(t.focus.reference)).caseType) },
          { title: "责任人", render: (t) => t.owner.display },
          { title: "执行状态", render: (t) => ui.statusTag(App.enums.taskStatus, dm.taskStatus(t)) },
          { title: "截止时间", render: (t) => PU.dueCell(t) },
          { title: "操作", render: (t) => h("button", { class: "btn-link", onClick: () => traceModal(dm.refId(t.focus.reference), t.id) }, "查看") },
        ], rows: tasks, empty: "暂无任务",
      }));
    }
    renderResult();
  }

  function traceModal(caseId, focusTaskId) {
    const c = dm.caseById(caseId);
    const sub = ["病例编号：" + (c.caseCode || "-"), h("span", {}, ["病例类型：", ui.caseTypeTag(c.caseType)]), h("span", {}, ["紧急程度：", ui.urgencyView(c.urgency)])];
    const body = h("div", {});
    const tlBox = h("div", {});
    const taskBox = h("div", {});
    body.appendChild(h("div", { class: "ib-title" }, "🕒 全流程时间轴"));
    body.appendChild(tlBox);
    body.appendChild(h("div", { class: "ib-title mt-16" }, "🩺 该病例相关任务"));
    body.appendChild(taskBox);

    function renderTimeline(taskId) {
      clear(tlBox);
      tlBox.appendChild(buildTimeline(c, taskId));
      clear(taskBox);
      taskBox.appendChild(relatedTasks(c, taskId, renderTimeline));
    }
    renderTimeline(focusTaskId);
    ui.modal({ title: "病例全流程溯源 · " + c.subject.display + "-" + c.diagnosis, sub, body, width: "wide" });
  }

  function buildTimeline(c, taskId) {
    const flag = dm.flagOf(c);
    const a = dm.apptOf(c);
    const nodes = [];
    nodes.push({ time: flag.period.start, title: "系统自动识别疑难病例", desc: "触发规则：" + App.auth.ext(flag, "trigger-rule"), state: "done" });
    nodes.push({ time: flag.period.start, title: "推送讨论任务通知", desc: "通知对象：科室主任（" + (c.director.display) + "）", state: "done" });
    if (a.start) {
      nodes.push({ time: a.start, title: "创建讨论会议", desc: "发起人：" + (a.creator ? a.creator.display : "-") + "　参会专家：" + (a.participant || []).length + "人", state: "done" });
      if (["ongoing", "completed"].indexOf(a.status) >= 0) {
        const attendees = (a.participant || []).filter((p) => p.status === "accepted").map((p) => p.actor.display);
        nodes.push({
          time: a.start, title: "讨论会议进行",
          desc: "实际参会（" + attendees.length + "/" + (a.participant || []).length + "人）：" + (attendees.length ? attendees.join("、") : "-"),
          state: "done",
        });
      }
    }
    const task = taskId ? App.fhir.read("Task", taskId) : null;
    if (task) {
      nodes.push({ time: task.authoredOn, title: "生成诊疗调整任务", desc: "任务：" + task.code.text + " → " + task.owner.display, state: "done" });
      (task.nodes || []).forEach((n) => { if (n.done && n.label !== "接收任务") nodes.push({ time: n.time, title: "任务进展：" + n.label, desc: task.code.text, state: "done" }); });
      const st = dm.taskStatus(task);
      if (st === "overdue") nodes.push({ time: dm.dueOf(task), title: "已超时：" + task.code.text, desc: "责任人 " + task.owner.display + " 未按时执行", state: "overdue" });
      else if (st !== "completed") nodes.push({ time: dm.dueOf(task), title: "待完成：" + task.code.text, desc: "截止 " + dt.fmtDate(dm.dueOf(task)), state: "todo" });
      else nodes.push({ time: task.nodes[task.nodes.length - 1].time, title: "任务办结：" + task.code.text, desc: "全流程闭环完成", state: "done" });
    }
    nodes.sort((x, y) => new Date(x.time) - new Date(y.time));
    return h("ul", { class: "trace-timeline" }, nodes.map((n) => h("li", { class: n.state }, [
      h("div", { class: "tl-node" }),
      h("div", { class: "tl-time" }, dt.fmtDateTime(n.time)),
      h("div", { class: "tl-title" }, n.title),
      h("div", { class: "tl-desc" }, n.desc),
    ])));
  }

  function relatedTasks(c, focusId, onPick) {
    const tasks = dm.tasksOf(c);
    if (!tasks.length) return h("div", { class: "muted" }, "该病例暂无诊疗调整任务");
    return h("div", {}, [
      ui.table({
        columns: [
          { title: "任务名称", render: (t) => t.code.text },
          { title: "责任人", render: (t) => t.owner.display },
          { title: "执行状态", render: (t) => ui.statusTag(App.enums.taskStatus, dm.taskStatus(t)) },
          { title: "截止时间", render: (t) => PU.dueCell(t) },
          { title: "操作", render: (t) => t.id === focusId ? h("span", { class: "tag blue" }, "当前溯源项 ◀") : h("button", { class: "btn-link", onClick: () => onPick(t.id) }, "查看") },
        ], rows: tasks, empty: "暂无任务",
      }),
      h("div", { class: "small muted mt-8" }, "点击[查看]切换至该任务的时间轴视角"),
    ]);
  }

  function kpiCard(label, val, pct, cls, trend) {
    return h("div", { class: "stat-card" }, [
      h("div", { class: "stat-label" }, label),
      h("div", { class: "stat-value" }, val),
      ui.progress(pct, cls),
      h("div", { class: "stat-trend trend-up mt-8" }, trend),
    ]);
  }
  function avgCard(label, val, trend) {
    return h("div", { class: "stat-card" }, [
      h("div", { class: "stat-label" }, label),
      h("div", { class: "stat-value" }, val),
      h("div", { class: "stat-trend trend-down" }, trend),
    ]);
  }

  App.pages.reports = reports;
})(window.App);
