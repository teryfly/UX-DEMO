/* ============================================================
   admin.js — L2-4 系统配置管理（业务规则 / 权限 / 接口维护）
   ============================================================ */
(function (App) {
  "use strict";
  const { h, clear } = App.dom;
  const ui = App.ui, dt = App.date, F = App.fhir;
  const PU = App.pageUtils;
  const nav = (x) => App.router.navigate(x);
  const MODULES = ["个人工作台", "讨论组织及跟踪管理", "质量监控报表", "系统配置管理"];
  const ROLE_LABELS = { attending: "主管医生", director: "科室主任", expert: "会诊专家", qa: "医疗质量管理部门", admin: "系统管理员" };

  App.pages._crumb = App.pages._crumb || {};
  App.pages._crumb.admin = function (p) {
    const map = { rules: "业务规则配置", perm: "权限配置", interface: "接口维护" };
    if (!p.tab) return null; // L2-4 概览页不显示面包屑
    return [["系统配置管理", "#/admin"], [map[p.tab] || "业务规则配置", null]];
  };

  function admin(params) {
    const tab = params.tab;
    const root = h("div", {});
    root.appendChild(PU.pageHead("⚙️ 系统配置管理", "维护业务规则、权限与第三方接口"));
    if (!tab) { root.appendChild(overviewPage()); return root; }
    const layout = h("div", { style: { display: "grid", gridTemplateColumns: "180px 1fr", gap: "18px" } });
    // 侧边栏
    const items = [["rules", "📐 业务规则配置"], ["perm", "🔑 权限配置"], ["interface", "🔌 接口维护"]];
    const side = h("div", { class: "card", style: { padding: "8px" } }, h("div", { class: "vtabs" }, items.map(([k, l]) =>
      h("button", { class: "vtab" + (k === tab ? " active" : ""), onClick: () => nav("#/admin?tab=" + k) }, l))));
    const content = h("div", {});
    if (tab === "rules") content.appendChild(rulesPage());
    else if (tab === "perm") content.appendChild(permPage());
    else content.appendChild(interfacePage());
    layout.appendChild(side); layout.appendChild(content);
    root.appendChild(layout);
    return root;
  }

  /* ---------- L2-4 系统配置管理 概览（模块入口 + 系统运行状态 + 配置变更日志） ---------- */
  function overviewPage() {
    const wrap = h("div", {});
    const ifs = F.config.get("interfaces") || [];
    const normal = ifs.filter((i) => i.status === "normal").length;
    const error = ifs.filter((i) => i.status === "error").length;
    const changes = F.config.get("configChanges") || [];

    // 配置模块入口（3卡片）
    const cards = [
      ["📐", "业务规则配置", "配置疑难病例识别逻辑、分类规则与通知规则", "rules"],
      ["🔑", "权限配置", "管理系统用户角色与操作权限，支持批量调整", "perm"],
      ["🔌", "接口维护", "维护 HIS / EMR / AI中台 / 文献库 / CA 接口状态", "interface"],
    ];
    wrap.appendChild(h("div", { class: "section" }, [
      h("div", { class: "section-title" }, [h("span", { class: "bar" }), "配置模块入口"]),
      h("div", { class: "grid grid-3" }, cards.map(([icon, title, sub, t]) =>
        h("div", { class: "module-card", onClick: () => nav("#/admin?tab=" + t) }, [
          h("div", { class: "mc-icon" }, icon), h("div", { class: "mc-title" }, title), h("div", { class: "mc-sub" }, sub),
        ]))),
    ]));

    // 系统运行状态
    wrap.appendChild(h("div", { class: "card card-pad section" }, [
      h("div", { class: "section-title" }, [h("span", { class: "bar" }), "系统运行状态"]),
      h("div", { class: "kv-grid" }, [
        h("div", { class: "kv" }, [h("span", { class: "k" }, "接口连通："), h("span", { class: "v" }, [ui.tag("正常 " + normal, "green"), " ", error ? ui.tag("异常 " + error, "red") : ui.tag("异常 0", "gray")])]),
        h("div", { class: "kv" }, [h("span", { class: "k" }, "最近配置变更："), h("span", { class: "v" }, changes[0] ? (changes[0].what + "（" + changes[0].by + " · " + dt.fmtDate(changes[0].time) + "）") : "暂无变更记录")]),
      ]),
    ]));

    // 配置变更日志（最近10条）
    wrap.appendChild(h("div", { class: "card card-pad section" }, [
      h("div", { class: "section-title" }, [h("span", { class: "bar" }), "配置变更日志（最近10条）"]),
      ui.table({
        columns: [
          { title: "操作人", render: (l) => l.by },
          { title: "所属模块", render: (l) => ui.tag(l.module, "blue") },
          { title: "变更内容", render: (l) => l.what },
          { title: "变更时间", render: (l) => dt.fmtDateTime(l.time) },
        ], rows: changes.slice(0, 10), empty: "暂无变更记录",
      }),
    ]));
    return wrap;
  }

  /* ============================================================
     L3-4-1 业务规则配置
     ============================================================ */
  function rulesPage() {
    const root = h("div", {});
    const tabEl = ui.tabs([
      { key: "identify", label: "病例识别规则" },
      { key: "classify", label: "病例分类规则" },
      { key: "notify", label: "通知规则" },
    ], render, "identify");
    root.appendChild(tabEl.el);
    const content = h("div", {});
    root.appendChild(content);
    function render(k) { clear(content); content.appendChild(ruleTab(k)); }
    render("identify");
    return root;
  }

  function ruleTab(key) {
    const rules = F.config.get("rules");
    const rule = rules[key];
    const box = h("div", {});
    // D1 表单
    const formCard = h("div", { class: "card card-pad section" });
    formCard.appendChild(h("div", { class: "section-title" }, [h("span", { class: "bar" }), "规则配置表单"]));
    const inputs = {};
    if (key === "identify") {
      // 病例识别规则是系统判断"哪些患者属于疑难病例"的必要条件，不提供启用/停用开关——
      // 停用后系统将无法识别疑难病例。
      inputs.stayDays = numInput(rule.stayDays);
      inputs.adjustTimes = numInput(rule.adjustTimes);
      inputs.score = numInput(rule.score);
      const kwBox = h("div", { class: "flex gap-8", style: { flexWrap: "wrap" } });
      let kws = rule.keywords.slice();
      function renderKw() { clear(kwBox); kws.forEach((w, i) => kwBox.appendChild(h("span", { class: "tag blue" }, [w, h("span", { style: { cursor: "pointer", marginLeft: "4px" }, onClick: () => { kws.splice(i, 1); renderKw(); } }, "×")]))); }
      renderKw();
      const kwInput = h("input", { placeholder: "输入关键词" });
      formCard.appendChild(formRow("住院时长阈值", h("div", { class: "flex items-center gap-8" }, [inputs.stayDays, "天"])));
      formCard.appendChild(formRow("诊断关键词", h("div", {}, [h("div", { class: "flex gap-8 mb-8" }, [kwInput, h("button", { class: "btn sm", onClick: () => { if (kwInput.value.trim()) { kws.push(kwInput.value.trim()); kwInput.value = ""; renderKw(); } } }, "+添加")]), kwBox])));
      formCard.appendChild(formRow("治疗方案调整次数阈值", h("div", { class: "flex items-center gap-8" }, [inputs.adjustTimes, "次"])));
      formCard.appendChild(formRow("临床评分阈值", h("div", { class: "flex items-center gap-8" }, [inputs.score, "分"])));
      inputs._kws = () => kws;
    } else if (key === "classify") {
      inputs.diagnostic = txtInput(rule.diagnostic);
      inputs.treatment = txtInput(rule.treatment);
      inputs.rare = txtInput(rule.rare);
      formCard.appendChild(formRow("诊断疑难判定条件", inputs.diagnostic));
      formCard.appendChild(formRow("治疗疑难判定条件", inputs.treatment));
      formCard.appendChild(formRow("罕见病判定条件", inputs.rare));
      formCard.appendChild(formRow("类型优先级", h("div", {}, "1. 诊断疑难　2. 治疗疑难　3. 罕见病")));
    } else {
      const trig = rule.triggers, ch = rule.channels;
      inputs.t1 = cb(trig.onIdentify), inputs.t2 = cb(trig.onDiscuss), inputs.t3 = cb(trig.onDue);
      inputs.c1 = cb(ch.inApp), inputs.c3 = cb(ch.sms);
      // 通知对象改为勾选角色，而不是自由输入文本
      const targetCbs = {};
      const targetBox = h("div", { class: "flex gap-16", style: { flexWrap: "wrap" } }, Object.keys(App.enums.notifyTargets).map((k) => {
        const c = cb((rule.target || []).indexOf(k) >= 0);
        targetCbs[k] = c;
        return lbl(c, App.enums.notifyTargets[k]);
      }));
      inputs.target = targetCbs;
      inputs.freq = h("select", {}, [["instant", "即时"], ["daily", "每日汇总"], ["custom", "自定义"]].map(([v, l]) => h("option", { value: v }, l)));
      inputs.freq.value = rule.frequency;
      const customTimeInp = h("input", { type: "time", value: rule.customTime || "09:00" });
      const customTimeWrap = h("div", { class: "flex items-center gap-8", style: { marginTop: "8px", display: rule.frequency === "custom" ? "flex" : "none" } }, ["自定义推送时间：", customTimeInp]);
      inputs.freq.addEventListener("change", () => { customTimeWrap.style.display = inputs.freq.value === "custom" ? "flex" : "none"; });
      inputs.customTime = customTimeInp;
      formCard.appendChild(formRow("通知触发条件", h("div", { class: "flex gap-16" }, [lbl(inputs.t1, "病例识别时"), lbl(inputs.t2, "讨论发起时"), lbl(inputs.t3, "任务到期时")])));
      formCard.appendChild(formRow("通知渠道", h("div", { class: "flex gap-16" }, [lbl(inputs.c1, "站内消息"), lbl(inputs.c3, "短信")])));
      formCard.appendChild(formRow("通知对象", targetBox));
      formCard.appendChild(formRow("通知频率", h("div", {}, [inputs.freq, customTimeWrap])));
    }
    formCard.appendChild(h("div", { class: "flex items-center gap-16 mt-12" }, [
      h("span", { class: "small muted" }, "最近修改：" + dt.fmtDateTime(rule.lastModified)),
    ]));
    formCard.appendChild(h("div", { class: "btn-row mt-12" }, [
      h("button", { class: "btn", onClick: () => render() }, "重置"),
      h("button", { class: "btn primary", onClick: confirmSave }, "保存"),
    ]));
    box.appendChild(formCard);

    // D2 操作日志
    box.appendChild(collapsible("操作日志", () => ui.table({
      columns: [
        { title: "操作人", render: (l) => l.by },
        { title: "操作时间", render: (l) => l.time },
        { title: "变更内容", render: (l) => l.what },
        { title: "操作类型", render: (l) => ui.tag(l.type, "blue") },
      ], rows: rule.logs, empty: "暂无日志",
    })));

    function confirmSave() {
      ui.confirmBox({ title: "保存配置", message: "确认保存并即时生效？", okText: "确认保存" }).then((ok) => { if (ok) save(); });
    }
    function save() {
      const rs = F.config.get("rules");
      const r = rs[key];
      if (key === "identify") { r.stayDays = +inputs.stayDays.value; r.adjustTimes = +inputs.adjustTimes.value; r.score = +inputs.score.value; r.keywords = inputs._kws(); }
      else if (key === "classify") { r.diagnostic = inputs.diagnostic.value; r.treatment = inputs.treatment.value; r.rare = inputs.rare.value; }
      else {
        r.triggers = { onIdentify: inputs.t1.checked, onDiscuss: inputs.t2.checked, onDue: inputs.t3.checked };
        r.channels = { inApp: inputs.c1.checked, sms: inputs.c3.checked };
        r.target = Object.keys(inputs.target).filter((k) => inputs.target[k].checked);
        r.frequency = inputs.freq.value;
        r.customTime = inputs.freq.value === "custom" ? inputs.customTime.value : r.customTime;
      }
      // 记录真实操作时刻（而非演示叙事时间），避免"保存时间"与"操作日志时间"不一致
      r.lastModified = dt.isoRealNow();
      r.logs.unshift({ by: App.auth.current().name, time: dt.fmtDateTime(dt.realNow()), what: "更新规则配置", type: "修改" });
      addConfigChange("业务规则配置", "更新" + tabLabel(key));
      F.config.set("rules", rs);
      ui.toast("规则已保存并即时生效", "success");
      render();
    }
    function render() { const parent = box.parentNode; if (parent) { clear(parent); parent.appendChild(ruleTab(key)); } }
    return box;
  }
  function tabLabel(k) { return { identify: "病例识别规则", classify: "病例分类规则", notify: "通知规则" }[k]; }

  /* ============================================================
     L3-4-2 权限配置
     ============================================================ */
  function permPage() {
    const state = { kw: "", page: 1, selected: new Set() };
    const root = h("div", {});
    // 操作区
    const searchInp = h("input", { placeholder: "搜索用户名/角色", style: { width: "240px" } });
    searchInp.addEventListener("input", () => { state.kw = searchInp.value; state.page = 1; renderList(); });
    const batchBtn = h("button", { class: "btn", disabled: true, title: "请先选择用户", onClick: () => batchModal(Array.from(state.selected), renderList) }, "批量调整权限");
    root.appendChild(h("div", { class: "filter-bar" }, h("div", { class: "flex between items-center" }, [
      h("div", { class: "flex items-center gap-8" }, ["🔍", searchInp]),
      h("div", { class: "flex gap-8" }, [batchBtn, h("button", { class: "btn primary", onClick: () => addModal(renderList) }, "新增权限配置")]),
    ])));

    const listBox = h("div", {});
    root.appendChild(listBox);
    root.appendChild(h("div", { class: "mt-12" }, h("a", { href: "#", onClick: (e) => { e.preventDefault(); permLogModal(); } }, "查看权限变更日志 →")));

    function updateBatchBtn() { batchBtn.disabled = state.selected.size === 0; }
    function renderList() {
      clear(listBox);
      const perms = (F.config.get("permissions") || []).filter((p) => !state.kw || p.user.indexOf(state.kw) >= 0 || p.role.indexOf(state.kw) >= 0);
      const total = perms.length, ps = 20;
      const pageRows = perms.slice((state.page - 1) * ps, state.page * ps);
      const tb = h("tbody");
      if (!pageRows.length) tb.appendChild(h("tr", {}, h("td", { colspan: 6 }, ui.emptyState("暂无用户权限配置"))));
      pageRows.forEach((p) => {
        const cbx = h("input", { type: "checkbox", checked: state.selected.has(p.id) });
        cbx.addEventListener("change", () => { if (cbx.checked) state.selected.add(p.id); else state.selected.delete(p.id); updateBatchBtn(); });
        tb.appendChild(h("tr", { style: p.enabled ? {} : { background: "#f5f6f8" } }, [
          h("td", {}, cbx),
          h("td", { class: "cell-strong" }, p.user),
          h("td", {}, p.role),
          h("td", {}, p.modules.join("、")),
          h("td", {}, ui.tag(p.enabled ? "启用" : "禁用", p.enabled ? "green" : "gray")),
          h("td", { class: "col-actions" }, [
            h("button", { class: "btn-link", onClick: () => editModal(p.id, renderList) }, "编辑"),
            h("button", { class: "btn-link", onClick: () => {
              ui.confirmBox({ title: "删除权限配置", message: "确认删除用户「" + p.user + "」的权限配置？此操作不可撤销。", okText: "删除", danger: true }).then((ok) => {
                if (!ok) return;
                const list = F.config.get("permissions").filter((x) => x.id !== p.id);
                F.config.set("permissions", list);
                addPermLog(p.user, "删除权限配置");
                addConfigChange("权限配置", "删除用户 " + p.user + " 权限");
                state.selected.delete(p.id);
                ui.toast("已删除该用户权限配置", "success"); renderList();
                App.app.refreshNav(App.router.parseHash().route);
              });
            } }, "删除"),
          ]),
        ]));
      });
      listBox.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "data" }, [
        h("thead", {}, h("tr", {}, [h("th", {}, ""), ...["用户名", "角色", "可访问模块", "权限状态", "操作"].map((x) => h("th", {}, x))])),
        tb,
      ])));
      if (total > ps) listBox.appendChild(ui.pager({ total, pageSize: ps, page: state.page, onPage: (pg) => { state.page = pg; renderList(); } }));
      else listBox.appendChild(h("div", { class: "pager" }, h("span", {}, "共 " + total + " 条")));
      updateBatchBtn();
    }
    renderList();
    return root;
  }

  function editModal(permId, refresh) {
    const perms = F.config.get("permissions");
    const p = JSON.parse(JSON.stringify(perms.find((x) => x.id === permId)));
    const body = h("div", {});
    const enabled = { val: p.enabled };
    body.appendChild(h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "基本信息"),
      h("div", { class: "kv-grid" }, [kv("用户名", p.user), kv("当前角色", p.role)]),
      h("div", { class: "flex items-center gap-16 mt-8" }, ["权限状态：", radioPair("perm-en", p.enabled, (v) => enabled.val = v)]),
    ]));
    const matrixBox = h("div", {});
    function renderMatrix() { clear(matrixBox); matrixBox.appendChild(permMatrix(p.matrix)); }
    renderMatrix();
    body.appendChild(h("div", { class: "info-block" }, [h("div", { class: "ib-title" }, "模块访问权限配置"), matrixBox, h("div", { class: "small muted mt-8" }, "注：取消「可访问」勾选后，该模块在用户导航中隐藏")]));
    // 角色快捷切换
    const roleSel = h("select", {}, Object.keys(ROLE_LABELS).map((k) => h("option", { value: k }, ROLE_LABELS[k])));
    roleSel.value = p.roleKey;
    body.appendChild(h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "角色快捷切换"),
      h("div", { class: "flex items-center gap-8" }, ["切换角色：", roleSel, h("button", { class: "btn sm", onClick: () => { applyRolePreset(p, roleSel.value); renderMatrix(); ui.toast("已按角色预设填充权限", "info"); } }, "应用角色权限")]),
      h("div", { class: "small muted mt-8" }, "选择后将按角色预设自动填充上方权限配置"),
    ]));
    const m = ui.modal({
      title: "权限配置 · " + p.user, body,
      footer: [
        h("button", { class: "btn", onClick: () => m.close() }, "取消"),
        h("button", { class: "btn primary", onClick: () => {
          if (!Object.keys(p.matrix).some((mod) => p.matrix[mod][3])) { ui.toast("请至少选择一个可访问模块", "error"); return; }
          ui.confirmBox({ title: "保存权限变更", message: "确认保存权限变更？变更将即时生效。", okText: "确认保存" }).then((ok) => {
            if (!ok) return;
            const orig = perms.find((x) => x.id === permId);
            const changes = [];
            if (orig.roleKey !== roleSel.value) changes.push("角色变更：" + ROLE_LABELS[orig.roleKey] + "→" + ROLE_LABELS[roleSel.value]);
            if (orig.enabled !== enabled.val) changes.push("权限状态：" + (orig.enabled ? "启用" : "禁用") + "→" + (enabled.val ? "启用" : "禁用"));
            orig.matrix = p.matrix; orig.enabled = enabled.val; orig.roleKey = roleSel.value; orig.role = ROLE_LABELS[roleSel.value];
            orig.modules = Object.keys(p.matrix).filter((mod) => p.matrix[mod][3]);
            F.config.set("permissions", perms);
            if (changes.length) addPermLog(orig.user, changes.join("；"));
            addConfigChange("权限配置", "编辑 " + orig.user + " 权限");
            ui.toast("权限已保存并即时生效", "success"); m.close(); refresh();
            App.app.refreshNav(App.router.parseHash().route); // 模块访问权限即时生效，刷新导航反映变化
          });
        } }, "保存"),
      ],
    });
  }

  function batchModal(ids, refresh) {
    const perms = F.config.get("permissions");
    const users = ids.map((id) => perms.find((x) => x.id === id)).filter(Boolean);
    const body = h("div", {});
    const remaining = users.slice();
    const userLine = h("div", { class: "info-block" });
    function renderUsers() { clear(userLine); userLine.appendChild(h("div", { class: "ib-title" }, "已选用户")); userLine.appendChild(h("div", {}, "已选 " + remaining.length + " 人：" + remaining.map((u) => u.user).join("、"))); }
    renderUsers();
    body.appendChild(userLine);
    const roleSel = h("select", {}, [h("option", { value: "" }, "选择角色"), ...Object.keys(ROLE_LABELS).map((k) => h("option", { value: k }, ROLE_LABELS[k]))]);
    const mode = { val: "override" };
    const matrix = emptyMatrixTriple();
    const matrixBox = h("div", {});
    function renderMatrix() { clear(matrixBox); matrixBox.appendChild(permMatrixTriple(matrix)); }
    renderMatrix();
    body.appendChild(h("div", { class: "info-block" }, [
      h("div", { class: "ib-title" }, "批量变更配置"),
      h("div", { class: "flex items-center gap-8 mb-8" }, ["目标角色：", roleSel]),
      h("div", { class: "mb-8" }, [
        radioLine("batch-mode", "按角色预设权限覆盖（替换为选中角色的标准权限）", true, () => mode.val = "override"),
        radioLine("batch-mode", "仅调整指定模块权限", false, () => mode.val = "module"),
      ]),
      matrixBox,
      h("div", { class: "small muted mt-8" }, "注：「-」表示不变更该权限项，勾选/取消表示统一调整"),
    ]));
    const m = ui.modal({
      title: "批量权限调整", body,
      footer: [
        h("button", { class: "btn", onClick: () => m.close() }, "取消"),
        h("button", { class: "btn primary", onClick: () => {
          ui.confirmBox({ title: "批量调整确认", message: "确定对 " + remaining.length + " 名用户执行权限调整？" }).then((ok) => {
            if (!ok) return;
            remaining.forEach((u) => {
              const orig = perms.find((x) => x.id === u.id);
              if (mode.val === "override" && roleSel.value) { applyRolePreset(orig, roleSel.value); orig.roleKey = roleSel.value; orig.role = ROLE_LABELS[roleSel.value]; }
              else { MODULES.forEach((mod, mi) => { matrix[mod].forEach((tri, ci) => { if (tri !== null) orig.matrix[mod][ci] = tri; }); }); }
              orig.modules = Object.keys(orig.matrix).filter((mod) => orig.matrix[mod][3]);
              addPermLog(orig.user, mode.val === "override" ? "批量调整角色：" + ROLE_LABELS[roleSel.value] : "批量调整模块权限");
            });
            F.config.set("permissions", perms);
            addConfigChange("权限配置", "批量调整 " + remaining.length + " 名用户权限");
            ui.toast("已对 " + remaining.length + " 名用户完成权限调整", "success"); m.close(); refresh();
            App.app.refreshNav(App.router.parseHash().route);
          });
        } }, "确认调整"),
      ],
    });
  }

  function addModal(refresh) {
    const body = h("div", {});
    // 用户名改为从医院科室及医生人员名录中选择，而不是手工输入——
    // 只列出尚未配置权限的人员，并同步其科室/职称/系统角色信息。
    const existingIds = new Set((F.config.get("permissions") || []).map((p) => p.userId));
    const avail = F.all("Practitioner").filter((p) => !existingIds.has(p.id));
    const userSel = h("select", { class: "input-full" }, [
      h("option", { value: "" }, avail.length ? "请选择用户" : "暂无可新增用户（均已配置权限）"),
      ...avail.map((p) => h("option", { value: p.id }, p.name[0].text + "（" + App.auth.ext(p, "dept") + " · " + p.qualification[0].code.text + "）")),
    ]);
    const roleSel = h("select", {}, [h("option", { value: "" }, "选择角色"), ...Object.keys(ROLE_LABELS).map((k) => h("option", { value: k }, ROLE_LABELS[k]))]);
    const matrix = { "个人工作台": [false, false, false, false], "讨论组织及跟踪管理": [false, false, false, false], "质量监控报表": [false, false, false, false], "系统配置管理": [false, false, false, false] };
    const matrixBox = h("div", {});
    function renderMatrix() { clear(matrixBox); matrixBox.appendChild(permMatrix(matrix)); }
    renderMatrix();
    userSel.addEventListener("change", () => {
      const p = F.read("Practitioner", userSel.value);
      const role = p && App.auth.ext(p, "role");
      if (role && ROLE_LABELS[role]) { roleSel.value = role; applyRolePresetMatrix(matrix, role); renderMatrix(); }
    });
    body.appendChild(h("div", { class: "info-block" }, [h("div", { class: "ib-title" }, "用户信息"), formRow("用户名", userSel), formRow("角色", h("div", { class: "flex items-center gap-8" }, [roleSel, h("button", { class: "btn sm", onClick: () => { if (roleSel.value) { applyRolePresetMatrix(matrix, roleSel.value); renderMatrix(); } } }, "应用角色权限")]))]));
    body.appendChild(h("div", { class: "info-block" }, [h("div", { class: "ib-title" }, "权限配置"), matrixBox, h("div", { class: "small muted mt-8" }, "选择用户名后将自动带入其科室与系统角色，也可「应用角色权限」重新填充")]));
    const m = ui.modal({
      title: "新增权限配置", body,
      footer: [
        h("button", { class: "btn", onClick: () => m.close() }, "取消"),
        h("button", { class: "btn primary", onClick: () => {
          if (!userSel.value || !roleSel.value) { ui.toast("请选择用户名并选择角色", "error"); return; }
          const p = F.read("Practitioner", userSel.value);
          const perms = F.config.get("permissions");
          perms.unshift({ id: App.util.uid("perm"), userId: p.id, user: p.name[0].text, role: ROLE_LABELS[roleSel.value], roleKey: roleSel.value, modules: Object.keys(matrix).filter((mod) => matrix[mod][3]), matrix, enabled: true });
          F.config.set("permissions", perms);
          addPermLog(p.name[0].text, "新增权限配置");
          addConfigChange("权限配置", "新增用户 " + p.name[0].text);
          ui.toast("已新增权限配置", "success"); m.close(); refresh();
        } }, "保存"),
      ],
    });
  }

  function permLogModal() {
    const logs = F.config.get("permLogs") || [];
    const state = { by: "", from: "", to: "" };
    const body = h("div", {});
    const listBox = h("div", {});
    const bySel = h("select", {}, [h("option", { value: "" }, "全部"), ...App.util.uniq(logs.map((l) => l.by)).map((b) => h("option", { value: b }, b))]);
    const fromI = h("input", { type: "date" }), toI = h("input", { type: "date" });
    bySel.addEventListener("change", () => state.by = bySel.value);
    fromI.addEventListener("change", () => state.from = fromI.value);
    toI.addEventListener("change", () => state.to = toI.value);
    function render() {
      clear(listBox);
      const rows = logs.filter((l) => (!state.by || l.by === state.by) && PU.inRange(l.time, state.from, state.to));
      listBox.appendChild(ui.table({
        columns: [
          { title: "操作人", render: (l) => l.by },
          { title: "被调整用户", render: (l) => l.target },
          { title: "变更内容", render: (l) => l.change },
          { title: "变更时间", render: (l) => dt.fmtDateTime(l.time) },
        ], rows, empty: "暂无变更记录",
      }));
      listBox.appendChild(h("div", { class: "pager" }, h("span", {}, "共 " + rows.length + " 条")));
    }
    body.appendChild(h("div", { class: "filter-bar" }, h("div", { class: "filter-row" }, [
      h("div", { class: "field" }, [h("label", {}, "操作人"), bySel]),
      h("div", { class: "field" }, [h("label", {}, "变更时间"), h("div", { class: "range" }, [fromI, "~", toI])]),
      h("div", { class: "filter-actions" }, [h("button", { class: "btn primary", onClick: render }, "查询"), h("button", { class: "btn", onClick: () => { state.by = ""; state.from = ""; state.to = ""; bySel.value = ""; fromI.value = ""; toI.value = ""; render(); } }, "重置")]),
    ])));
    body.appendChild(listBox);
    render();
    ui.modal({ title: "权限变更日志", body });
  }

  // 权限矩阵（四列：查看/编辑/删除/可访问）
  function permMatrix(matrix) {
    const tb = h("tbody");
    MODULES.forEach((mod) => {
      const arr = matrix[mod] || [false, false, false, false];
      tb.appendChild(h("tr", {}, [h("td", {}, mod), ...arr.map((v, i) => {
        const c = h("input", { type: "checkbox", checked: v });
        c.addEventListener("change", () => { matrix[mod][i] = c.checked; if (i === 3 && !c.checked) { matrix[mod] = [false, false, false, false]; } });
        return h("td", {}, c);
      })]));
    });
    return h("table", { class: "perm-matrix" }, [h("thead", {}, h("tr", {}, ["模块名称", "查看", "编辑", "删除", "可访问"].map((x) => h("th", {}, x)))), tb]);
  }
  // 三态矩阵（批量：null=不变更）
  function permMatrixTriple(matrix) {
    const tb = h("tbody");
    MODULES.forEach((mod) => {
      tb.appendChild(h("tr", {}, [h("td", {}, mod), ...[0, 1, 2, 3].map((i) => {
        const sel = h("select", {}, [h("option", { value: "-" }, "-"), h("option", { value: "1" }, "✓"), h("option", { value: "0" }, "✗")]);
        sel.addEventListener("change", () => { matrix[mod][i] = sel.value === "-" ? null : sel.value === "1"; });
        return h("td", {}, sel);
      })]));
    });
    return h("table", { class: "perm-matrix" }, [h("thead", {}, h("tr", {}, ["模块名称", "查看", "编辑", "删除", "可访问"].map((x) => h("th", {}, x)))), tb]);
  }
  function emptyMatrixTriple() { const m = {}; MODULES.forEach((mod) => m[mod] = [null, null, null, null]); return m; }

  function applyRolePreset(perm, roleKey) { applyRolePresetMatrix(perm.matrix, roleKey); }
  function applyRolePresetMatrix(matrix, roleKey) {
    const preset = {
      attending: { "个人工作台": [1, 1, 0, 1] },
      director: { "讨论组织及跟踪管理": [1, 1, 1, 1], "质量监控报表": [1, 0, 0, 1] },
      expert: { "讨论组织及跟踪管理": [1, 1, 0, 1] },
      qa: { "质量监控报表": [1, 0, 0, 1] },
      admin: { "系统配置管理": [1, 1, 1, 1] },
    }[roleKey] || {};
    MODULES.forEach((mod) => { matrix[mod] = (preset[mod] || [0, 0, 0, 0]).map((x) => !!x); });
  }

  function addPermLog(target, change) {
    const logs = F.config.get("permLogs") || [];
    logs.unshift({ by: App.auth.current().name, target, change, time: dt.isoRealNow() });
    F.config.set("permLogs", logs);
  }

  /* ============================================================
     L3-4-3 接口维护
     ============================================================ */
  function interfacePage() {
    const root = h("div", {});
    const box = h("div", {});
    root.appendChild(box);
    function render() {
      clear(box);
      const ifs = F.config.get("interfaces");
      const normal = ifs.filter((i) => i.status === "normal").length;
      const error = ifs.filter((i) => i.status === "error").length;
      const unconfigured = ifs.filter((i) => i.status === "unconfigured").length;
      // C 概览
      box.appendChild(h("div", { class: "section" }, [
        h("div", { class: "grid grid-3" }, [
          ui.statCard({ label: "正常接口", value: normal, desc: "正常运行中", ok: true }),
          ui.statCard({ label: "异常接口", value: error, desc: "连接异常", alert: error > 0 }),
          ui.statCard({ label: "未配置接口", value: unconfigured, desc: "尚未配置" }),
        ]),
        h("div", { class: "flex between items-center mt-8" }, [
          h("span", { class: "small muted" }, "最近检测时间：" + dt.fmtDateTime(latestCheck(ifs))),
          h("button", { class: "btn", onClick: () => {
            ui.toast("正在检测所有接口...", "info");
            setTimeout(() => {
              ifs.forEach((i) => { i.lastCheck = dt.isoRealNow(); if (i.status === "normal") i.responseMs = 80 + Math.floor((i.name.length * 37) % 180); });
              F.config.set("interfaces", ifs);
              ui.toast("接口连通性检测完成（" + ifs.filter((i) => i.status === "normal").length + " 正常 / " + ifs.filter((i) => i.status === "error").length + " 异常）", error > 0 ? "error" : "success");
              render();
            }, 600);
          } }, "全部检测"),
        ]),
      ]));
      // D 列表
      box.appendChild(ui.table({
        columns: [
          { title: "接口名称", render: (i) => h("span", { class: "cell-strong" }, i.name) },
          { title: "对接系统", render: (i) => i.system },
          { title: "连通状态", render: (i) => statusDot(i.status) },
          { title: "响应时间", render: (i) => i.responseMs == null ? h("span", { class: "text-danger" }, "超时") : i.responseMs + "ms" },
          { title: "最近检测时间", render: (i) => dt.fmtMDTime(i.lastCheck) },
          { title: "操作", render: (i) => h("button", { class: "btn-link", onClick: () => interfaceModal(i.id, render) }, "详情") },
        ], rows: ifs, rowClass: (i) => i.status === "error" ? "row-danger" : "", empty: "暂无接口",
      }));
    }
    render();
    return root;
  }

  function interfaceModal(ifId, refresh) {
    const ifs = F.config.get("interfaces");
    const it = ifs.find((x) => x.id === ifId);
    const isError = it.status === "error";
    const sub = [h("span", {}, ["连通状态：", statusDot(it.status)])];
    const body = h("div", {});
    const tabsArr = [{ key: "config", label: "接口配置" }];
    if (isError) tabsArr.push({ key: "trouble", label: "异常排查" });
    tabsArr.push({ key: "log", label: "同步日志" });
    // 打开详情弹框时直接默认选中并显示"接口配置"——即便接口异常也先展示配置信息，
    // 而不是默认跳到"异常排查"（此前 segTabs 建好后从未调用过 render，内容区一直空白，
    // 需要用户手动点一次 Tab 才会出现内容）。
    const seg = ui.segTabs(tabsArr, render, "config");
    body.appendChild(seg.el);
    const content = h("div", {}); body.appendChild(content);
    const m = ui.modal({ title: "接口详情 · " + it.name, sub, body, width: "wide" });

    function render(k) {
      clear(content);
      if (k === "config") renderConfig();
      else if (k === "trouble") renderTrouble();
      else renderLog();
    }
    render("config");
    function renderConfig() {
      content.appendChild(h("div", { class: "info-block" }, [
        h("div", { class: "ib-title" }, "基本信息"),
        h("div", { class: "kv-grid" }, [
          kv("接口名称", it.name), kv("对接系统", it.system), kv("接口地址", it.url),
          kv("认证方式", it.auth), kv("数据同步频率", it.freq),
          h("div", { class: "kv" }, [h("span", { class: "k" }, "连通状态："), statusDot(it.status)]),
          kv("最近检测时间", dt.fmtDateTime(it.lastCheck)),
        ]),
      ]));
      content.appendChild(h("div", { class: "info-block" }, [
        h("div", { class: "ib-title" }, "连通性检测"),
        h("div", { class: "readonly-box" }, [
          h("div", {}, "上次检测结果："),
          h("div", {}, "　连通状态：" + (it.status === "normal" ? "正常" : "异常") + "　响应时间：" + (it.responseMs == null ? "超时（>30000ms）" : it.responseMs + "ms")),
          h("div", {}, "　数据传输状态：" + (it.status === "normal" ? "正常" : "中断")),
        ]),
        h("div", { class: "btn-row mt-8" }, h("button", { class: "btn primary", onClick: () => {
          ui.toast("正在检测...", "info");
          setTimeout(() => {
            it.lastCheck = dt.isoRealNow();
            if (it.status !== "error") it.responseMs = 80 + Math.floor((it.name.length * 37) % 180);
            F.config.set("interfaces", ifs);
            ui.toast(it.status === "error" ? "检测失败：连接超时（>30000ms），请前往「异常排查」" : "检测通过，响应时间 " + it.responseMs + "ms", it.status === "error" ? "error" : "success");
          }, 600);
        } }, "立即检测")),
      ]));
      // 配置编辑区
      const urlInp = h("input", { class: "input-full", value: it.url });
      const authSel = h("select", {}, ["OAuth2.0", "Token认证", "API Key"].map((a) => h("option", { value: a }, a)));
      authSel.value = it.auth;
      const freqSel = h("select", {}, ["实时", "每1小时", "每6小时", "每12小时", "每日"].map((f) => h("option", { value: f }, f)));
      freqSel.value = it.freq;
      // Token密钥：默认隐藏，[显示/隐藏]切换
      const tokenInp = h("input", { type: "password", class: "input-full", value: it.token || "", style: { flex: "1" } });
      const tokenToggle = h("button", { class: "btn sm", type: "button", onClick: () => { tokenInp.type = tokenInp.type === "password" ? "text" : "password"; tokenToggle.textContent = tokenInp.type === "password" ? "显示" : "隐藏"; } }, "显示");
      content.appendChild(h("div", { class: "info-block" }, [
        h("div", { class: "ib-title" }, "配置编辑区"),
        formRow("接口地址", urlInp),
        formRow("认证方式", authSel),
        it.token ? formRow("Token密钥", h("div", { class: "flex items-center gap-8" }, [tokenInp, tokenToggle])) : null,
        formRow("数据同步频率", freqSel),
        h("div", { class: "btn-row mt-8" }, [
          h("button", { class: "btn", onClick: () => m.close() }, "取消"),
          h("button", { class: "btn primary", onClick: () => {
            if (authSel.value === "Token认证" && it.token != null && !tokenInp.value.trim()) { ui.toast("请输入Token密钥", "error"); return; }
            it.url = urlInp.value; it.auth = authSel.value; it.freq = freqSel.value; if (it.token != null) it.token = tokenInp.value;
            // 验证连通性：演示中文献库更新Token后即恢复正常
            if (it.status === "error" && it.token) { it.status = "normal"; it.responseMs = 110; it.lastCheck = dt.isoRealNow(); delete it.anomaly; }
            F.config.set("interfaces", ifs);
            addConfigChange("接口维护", "更新 " + it.name + " 配置");
            ui.toast(it.status === "normal" ? "配置已保存并通过连通性验证，接口已恢复正常" : "配置已保存并通过连通性验证", "success"); m.close(); refresh();
          } }, "保存并验证连通性"),
        ]),
      ]));
    }
    function renderTrouble() {
      const an = it.anomaly || {};
      content.appendChild(h("div", { class: "info-block" }, [
        h("div", { class: "ib-title" }, "当前异常信息"),
        h("div", { class: "kv-grid" }, [kv("异常类型", an.type), kv("异常开始时间", dt.fmtDateTime(an.start)), kv("持续时长", "约" + an.durationMin + "分钟"), kv("影响范围", an.scope)]),
      ]));
      content.appendChild(h("div", { class: "info-block" }, [
        h("div", { class: "ib-title" }, "故障排查步骤"),
        h("div", { class: "readonly-box" }, [
          stepLine("Step 1 ▸ 检查接口地址是否可访问", "尝试在浏览器访问接口地址，确认服务是否可达"),
          stepLine("Step 2 ▸ 检查认证Token是否过期", "登录文献库管理后台确认Token有效性；如已过期，在接口配置中更新Token后重新验证"),
          stepLine("Step 3 ▸ 检查网络连通性", "确认服务器与文献库之间的网络路由是否正常；联系网络管理员排查防火墙/代理策略"),
          stepLine("Step 4 ▸ 联系文献库技术支持", "技术支持电话：010-XXXX-XXXX；如以上步骤均未解决，联系对方技术支持排查服务端故障"),
        ]),
      ]));
      content.appendChild(h("div", { class: "info-block" }, [
        h("div", { class: "ib-title" }, "常见问题"),
        h("div", { class: "readonly-box" }, [
          h("div", {}, h("b", {}, "Q：接口频繁超时如何处理？")), h("div", {}, "A：建议调低数据同步频率，并联系对方确认服务负载情况。"),
          h("div", { class: "mt-8" }, h("b", {}, "Q：Token过期后如何快速恢复？")), h("div", {}, "A：在接口配置中更新Token，点击[保存并验证连通性]即可即时恢复。"),
        ]),
      ]));
    }
    function renderLog() {
      const state = { status: "", from: "", to: "" };
      const listBox = h("div", {});
      const stSel = h("select", {}, [["", "全部"], ["success", "成功"], ["fail", "失败"], ["partial", "部分成功"]].map(([v, l]) => h("option", { value: v }, l)));
      const fromI = h("input", { type: "date" }), toI = h("input", { type: "date" });
      stSel.addEventListener("change", () => state.status = stSel.value);
      fromI.addEventListener("change", () => state.from = fromI.value);
      toI.addEventListener("change", () => state.to = toI.value);
      function renderRows() {
        clear(listBox);
        const rows = (it.syncLogs || []).filter((l) => (!state.status || l.status === state.status) && PU.inRange(l.time, state.from, state.to));
        listBox.appendChild(ui.table({
          columns: [
            { title: "同步时间", render: (l) => dt.fmtMDTime(l.time) },
            { title: "数据量", render: (l) => l.count + "条" },
            { title: "同步状态", render: (l) => syncTag(l.status) },
            { title: "耗时", render: (l) => l.cost },
            { title: "备注", render: (l) => l.note },
          ], rows, empty: "暂无同步记录",
        }));
        listBox.appendChild(h("div", { class: "pager" }, h("span", {}, "共 " + rows.length + " 条")));
      }
      content.appendChild(h("div", { class: "filter-bar" }, h("div", { class: "filter-row" }, [
        h("div", { class: "field" }, [h("label", {}, "同步状态"), stSel]),
        h("div", { class: "field" }, [h("label", {}, "时间范围"), h("div", { class: "range" }, [fromI, "~", toI])]),
        h("div", { class: "filter-actions" }, [h("button", { class: "btn primary", onClick: renderRows }, "查询"), h("button", { class: "btn", onClick: () => { state.status = ""; state.from = ""; state.to = ""; stSel.value = ""; fromI.value = ""; toI.value = ""; renderRows(); } }, "重置")]),
      ])));
      content.appendChild(listBox);
      renderRows();
    }
  }

  /* ---------- 工具 ---------- */
  function statusDot(s) {
    const map = { normal: ["🟢 正常", "green"], error: ["🔴 异常", "red"], unconfigured: ["⚪ 未配置", "gray"] };
    const v = map[s] || map.unconfigured;
    return ui.tag(v[0], v[1]);
  }
  function syncTag(s) { const map = { success: ["🟢 成功", "green"], fail: ["🔴 失败", "red"], partial: ["🟡 部分成功", "orange"] }; const v = map[s] || ["-", "gray"]; return ui.tag(v[0], v[1]); }
  function latestCheck(ifs) { return ifs.map((i) => i.lastCheck).sort().reverse()[0]; }
  function addConfigChange(module, what) {
    const list = F.config.get("configChanges") || [];
    list.unshift({ by: App.auth.current().name, what, time: dt.isoRealNow(), module });
    F.config.set("configChanges", list);
  }

  function formRow(label, control) { return h("div", { style: { marginBottom: "12px" } }, [h("label", { style: { display: "block", marginBottom: "4px", fontSize: "13px", color: "var(--c-text-sub)" } }, label), control]); }
  function collapsible(title, builder) {
    let open = false; const inner = h("div", {});
    const head = h("div", { class: "flex between items-center", style: { cursor: "pointer" } }, [h("div", { class: "ib-title", style: { margin: 0 } }, title), h("span", { class: "btn-link" }, "展开/收起")]);
    head.addEventListener("click", () => { open = !open; clear(inner); if (open) inner.appendChild(builder()); });
    return h("div", { class: "card card-pad section" }, [head, inner]);
  }
  function numInput(v) { return h("input", { type: "number", value: v, style: { width: "90px" } }); }
  function txtInput(v) { return h("input", { class: "input-full", value: v || "" }); }
  function cb(checked) { return h("input", { type: "checkbox", checked: !!checked }); }
  function lbl(input, text) { return h("label", { class: "flex items-center gap-8" }, [input, text]); }
  function kv(k, v) { return h("div", { class: "kv" }, [h("span", { class: "k" }, k + "："), h("span", { class: "v" }, v)]); }
  function radioPair(name, val, onChange) {
    const a = h("input", { type: "radio", name, checked: val }), b = h("input", { type: "radio", name, checked: !val });
    a.addEventListener("change", () => onChange(true)); b.addEventListener("change", () => onChange(false));
    return h("span", { class: "flex items-center gap-16" }, [h("label", { class: "flex items-center gap-8" }, [a, "启用"]), h("label", { class: "flex items-center gap-8" }, [b, "禁用"])]);
  }
  function radioLine(name, text, checked, onChange) { const r = h("input", { type: "radio", name, checked }); r.addEventListener("change", onChange); return h("label", { class: "flex items-center gap-8", style: { padding: "3px 0" } }, [r, text]); }
  function stepLine(title, desc) { return h("div", { style: { marginBottom: "8px" } }, [h("div", { style: { fontWeight: "600" } }, title), h("div", { class: "muted small" }, "→ " + desc)]); }

  App.pages.admin = admin;
})(window.App);
