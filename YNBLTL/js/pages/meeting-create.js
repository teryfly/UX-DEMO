/* ============================================================
   meeting-create.js — L4-2-1-1 讨论会议创建页
   ============================================================ */
(function (App) {
  "use strict";
  const { h, clear } = App.dom;
  const ui = App.ui, dm = App.domain, dt = App.date, views = App.views, F = App.fhir;
  const PU = App.pageUtils;
  const nav = (x) => App.router.navigate(x);

  function meetingCreate(params) {
    let caseId = params.case;
    const pendingCases = dm.cases().filter((c) => dm.apptOf(c).status === "pending" || dm.apptOf(c).status === "scheduled");
    if (!caseId && pendingCases.length) caseId = null; // 新建：需选择患者

    const root = h("div", {});
    // 编辑模式：从“安排讨论/编辑会议”进入（已有会议安排）；新建模式：从“新建讨论”进入
    const editMode = caseId && dm.caseById(caseId) && dm.apptOf(dm.caseById(caseId)).status !== "pending";
    const arrangeMode = caseId && dm.caseById(caseId) && dm.apptOf(dm.caseById(caseId)).status === "pending";
    root.appendChild(h("h1", { class: "page-title", style: { marginBottom: "16px" } }, editMode ? "编辑讨论会议" : arrangeMode ? "安排讨论会议" : "新建讨论会议"));

    const formArea = h("div", {});
    root.appendChild(formArea);

    // 表单状态
    const sel = { caseId: caseId };

    function rebuild() {
      clear(formArea);
      const c = sel.caseId ? dm.caseById(sel.caseId) : null;
      const a = c ? dm.apptOf(c) : null;

      const f = {
        topic: c ? (a.description || c.diagnosis + "疑难病例讨论") : "",
        urgency: c ? c.urgency : "mid",
        purpose: c && a.purpose ? a.purpose : "",
        date: a && a.start ? dt.fmtDate(a.start) : "",
        time: a && a.start ? dt.pad(new Date(a.start).getHours()) + ":" + dt.pad(new Date(a.start).getMinutes()) : "14:00",
        location: a ? a.location : "",
        duration: a ? (a.minutesDuration || 60) : 60,
        autoNotify: true, remind1h: true, remind24h: true,
        invited: a && a.participant ? a.participant.map((p) => dm.refId(p.actor.reference)) : [],
      };

      // D 讨论基础信息
      const topicInput = h("input", { class: "input-full", value: f.topic });
      const purposeInput = h("input", { class: "input-full", value: f.purpose, placeholder: "明确诊断方向，制定后续治疗方案" });
      const urgencySel = h("select", {}, Object.keys(App.enums.urgency).map((k) => h("option", { value: k }, App.enums.urgency[k].dot + " " + App.enums.urgency[k].label)));
      urgencySel.value = f.urgency;

      // 患者选择（新建模式）
      let patientField;
      if (!c) {
        const psel = h("select", { class: "input-full" }, [h("option", { value: "" }, "请选择关联患者（疑难病例）"), ...pendingCases.map((pc) => h("option", { value: pc.id }, pc.subject.display + " · " + pc.diagnosis + "（" + App.caseTypeLabel(pc.caseType) + "）"))]);
        psel.addEventListener("change", () => { if (psel.value) { sel.caseId = psel.value; rebuild(); } });
        patientField = field("关联患者", psel, true);
      } else {
        const p = dm.patientOf(c);
        patientField = field("关联患者", h("input", { class: "input-full", value: c.subject.display + "  住院号" + dm.mrn(p) + "  " + c.dept, disabled: true }), true, "自动带入");
      }

      formArea.appendChild(card("讨论基础信息", [
        field("讨论主题", topicInput, true),
        patientField,
        field("病例类型", h("input", { class: "input-full", value: c ? App.caseTypeLabel(c.caseType) : "—", disabled: true }), true, "自动带入"),
        field("紧急程度", urgencySel),
        field("讨论目的", purposeInput),
      ]));

      // E 会议安排配置
      const dateInput = h("input", { type: "date", value: f.date });
      const timeInput = h("input", { type: "time", value: f.time });
      const locInput = h("input", { class: "input-full", value: f.location, placeholder: "会议室A 或 线上链接 https://..." });
      const durSel = h("select", {}, [30, 45, 60, 90, 120].map((d) => h("option", { value: d }, d + "分钟")));
      durSel.value = f.duration;
      formArea.appendChild(card("会议安排配置", [
        field("会议时间", h("div", { class: "flex gap-8" }, [dateInput, timeInput]), true),
        field("会议地点", locInput),
        field("预计时长", durSel),
      ]));

      // F 参会人员邀请
      const expertState = { dept: "", title: "", kw: "", selected: new Set(f.invited) };
      const inviteCard = h("div", { class: "card card-pad section" });
      function renderInvite() {
        clear(inviteCard);
        inviteCard.appendChild(h("div", { class: "section-title" }, [h("span", { class: "bar" }), "参会人员邀请"]));
        // 邀请范围：主管医生/会诊专家/科室主任均可被邀请（此前仅含专家与主任，
        // 遗漏了病例本身的责任医生——例如主管医生张明华就不在受邀名单里）
        const experts = F.all("Practitioner").filter((p) => ["expert", "director", "attending"].indexOf(App.auth.ext(p, "role")) >= 0);
        // 筛选
        const dSel = h("select", {}, [h("option", { value: "" }, "全部"), ...App.util.uniq(experts.map((e) => App.auth.ext(e, "dept"))).map((d) => h("option", { value: d }, d))]);
        const tSel = h("select", {}, [h("option", { value: "" }, "全部"), ...App.util.uniq(experts.map((e) => e.qualification[0].code.text)).map((t) => h("option", { value: t }, t))]);
        const kwInp = h("input", { placeholder: "输入姓名搜索...", value: expertState.kw });
        dSel.value = expertState.dept; tSel.value = expertState.title;
        dSel.addEventListener("change", () => { expertState.dept = dSel.value; renderInvite(); });
        tSel.addEventListener("change", () => { expertState.title = tSel.value; renderInvite(); });
        kwInp.addEventListener("input", () => { expertState.kw = kwInp.value; renderInvite(); });
        inviteCard.appendChild(h("div", { class: "filter-row", style: { marginBottom: "10px" } }, [
          field2("科室", dSel), field2("职称", tSel), field2("姓名", kwInp),
        ]));
        const filtered = experts.filter((e) =>
          (!expertState.dept || App.auth.ext(e, "dept") === expertState.dept) &&
          (!expertState.title || e.qualification[0].code.text === expertState.title) &&
          (!expertState.kw || e.name[0].text.indexOf(expertState.kw) >= 0));
        const tbody = h("tbody");
        filtered.forEach((e) => {
          const sc = App.enums.scheduleStatus[App.scheduleStatusOf(e.id)];
          const disabled = !sc.selectable;
          const cb = h("input", { type: "checkbox", disabled, checked: expertState.selected.has(e.id) });
          cb.addEventListener("change", () => { if (cb.checked) expertState.selected.add(e.id); else expertState.selected.delete(e.id); selCount.textContent = "已选 " + expertState.selected.size + " 人"; });
          tbody.appendChild(h("tr", { style: disabled ? { opacity: ".5" } : (App.scheduleStatusOf(e.id) === "conflict" ? { background: "#fffbe9" } : {}) }, [
            h("td", {}, cb),
            h("td", {}, e.name[0].text),
            h("td", {}, App.auth.ext(e, "dept")),
            h("td", {}, e.qualification[0].code.text),
            h("td", {}, sc.dot + " " + sc.label + (disabled ? "（不可邀请）" : "")),
          ]));
        });
        inviteCard.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "data" }, [
          h("thead", {}, h("tr", {}, [h("th", {}, ""), h("th", {}, "姓名"), h("th", {}, "科室"), h("th", {}, "职称"), h("th", {}, "排班状态")])),
          tbody,
        ])));
        const selCount = h("span", { class: "muted" }, "已选 " + expertState.selected.size + " 人");
        inviteCard.appendChild(h("div", { class: "flex between items-center mt-8" }, [selCount, h("span", { class: "small muted" }, "🔴休息状态不可邀请，🟡会议冲突可邀请但需注意")]));
      }
      renderInvite();
      formArea.appendChild(inviteCard);

      // G 患者病历资料
      if (c) formArea.appendChild(card("患者病历资料（只读参考）", [views.materialTabs(c)]));

      // H 讨论任务来源
      if (c) {
        const flag = dm.flagOf(c);
        let rows = []; try { rows = JSON.parse(App.auth.ext(flag, "criteria")); } catch (e) {}
        const metStr = rows.filter((r) => r.met).map((r) => r.name + r.value + "(✓)").join(" · ");
        formArea.appendChild(card("讨论任务来源", [
          h("div", { class: "readonly-box" }, [
            h("div", {}, "任务来源：系统自动识别　识别时间：" + dt.fmtDateTime(flag.period.start)),
            h("div", {}, "触发规则：" + App.auth.ext(flag, "trigger-rule")),
            h("div", {}, "识别依据：" + metStr),
          ]),
        ]));
      }

      // 说明：不再在此单独设置"通知发送设置"——通知是否发送、发送渠道与频率统一由
      // 「系统配置管理 › 业务规则配置 › 通知规则」控制，避免两处配置相互冲突。

      // J 操作按钮区
      formArea.appendChild(h("div", { class: "btn-row", style: { marginTop: "20px" } }, [
        h("button", { class: "btn", onClick: () => nav("#/discussion?tab=meetings") }, "取消"),
        h("button", { class: "btn", onClick: () => submit(true) }, "保存草稿"),
        h("button", { class: "btn primary", onClick: () => submit(false) }, "提交并发送通知"),
      ]));

      function submit(draft) {
        if (!sel.caseId) { ui.toast("请先选择关联患者", "error"); return; }
        if (!topicInput.value.trim()) { ui.toast("请填写讨论主题", "error"); return; }
        if (!draft && (!dateInput.value || !timeInput.value)) { ui.toast("请设置会议时间", "error"); return; }
        if (!draft && expertState.selected.size === 0) { ui.toast("请至少邀请1位参会专家", "error"); return; }
        const start = dateInput.value ? new Date(dateInput.value + "T" + (timeInput.value || "14:00") + ":00").toISOString() : null;
        const cNow = dm.caseById(sel.caseId);
        const existing = dm.apptOf(cNow).participant || [];
        const participants = Array.from(expertState.selected).map((id) => {
          const ex = existing.find((p) => dm.refId(p.actor.reference) === id);
          const p = F.read("Practitioner", id);
          return {
            actor: { reference: "Practitioner/" + id, display: p.name[0].text },
            status: ex ? ex.status : "tentative",
            dept: App.auth.ext(p, "dept"), title: p.qualification[0].code.text,
            signedAt: ex ? ex.signedAt : null,
          };
        });
        // 通知是否发送由「系统配置管理 › 通知规则」的"讨论发起时"触发条件统一决定
        const notifyRule = (F.config.get("rules") || {}).notify || {};
        dm.scheduleMeeting(sel.caseId, {
          draft, topic: topicInput.value.trim(), urgency: urgencySel.value, purpose: purposeInput.value,
          start, duration: parseInt(durSel.value), location: locInput.value, participants,
          autoNotify: !!notifyRule.triggers && notifyRule.triggers.onDiscuss !== false,
          reminders: ["会前1小时", "会前24小时"],
        });
        ui.toast(draft ? "已保存为草稿（待安排）" : "会议已创建，通知已发送给受邀专家", "success");
        App.app.refreshMsgBadge();
        nav("#/discussion?tab=meetings");
      }
    }
    rebuild();
    return root;
  }

  function card(title, children) {
    return h("div", { class: "card card-pad section" }, [h("div", { class: "section-title" }, [h("span", { class: "bar" }), title]), ...children]);
  }
  function field(label, control, req, hint) {
    return h("div", { style: { marginBottom: "12px" } }, [
      h("label", { class: req ? "req" : "", style: { display: "block", marginBottom: "4px", fontSize: "13px", color: "var(--c-text-sub)" } }, label),
      h("div", { class: "flex items-center gap-8" }, [control, hint ? h("span", { class: "tag blue" }, hint) : null]),
    ]);
  }
  function field2(label, control) { return h("div", { class: "field" }, [h("label", {}, label), control]); }

  App.pages.meetingCreate = meetingCreate;
})(window.App);
