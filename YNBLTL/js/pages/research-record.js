/* ============================================================
   research-record.js — L4-2-1-2 病例研讨记录页
   ============================================================ */
(function (App) {
  "use strict";
  const { h, clear } = App.dom;
  const ui = App.ui, dm = App.domain, dt = App.date, views = App.views;
  const nav = (x) => App.router.navigate(x);

  function research(params) {
    const caseId = params.case;
    const root = h("div", {});

    function build() {
      clear(root);
      const c = dm.caseById(caseId);
      if (!c) { root.appendChild(h("div", { class: "empty" }, "未找到对应病例")); return; }
      const a = dm.apptOf(c);
      const u = App.auth.current();

      // 会议尚未安排（待安排）时不能进入研讨——系统应以"研讨记录是否填写、电子签名是否
      // 全部完成"来判断会议是否结束，但前提是会议本身已经安排，而不是脱离会议安排随意进入。
      if (a.status === "pending") {
        root.appendChild(h("div", { class: "empty" }, [
          h("span", { class: "emoji" }, "📭"),
          "该讨论会议尚未安排，暂无法进入研讨记录页。",
          h("div", { class: "mt-16" }, h("button", { class: "btn primary", onClick: () => backToList() }, "返回")),
        ]));
        return;
      }

      const comp = dm.compOf(c);
      const isParticipant = (a.participant || []).some((p) => dm.refId(p.actor.reference) === u.id);
      // 只有实际受邀且已确认参会的人员才能填写/签名——科室主任等会议组织者若本人并未
      // 参会，则只能查看，不能编辑或签名（只有参会人员才需要电子签名）。
      const canEdit = (a.participant || []).some((p) => dm.refId(p.actor.reference) === u.id && p.status === "accepted");
      const mySigned = comp && (comp.attester || []).some((s) => dm.refId(s.party.reference) === u.id);
      const locked = comp && comp.locked;
      const readonly = locked || mySigned || !canEdit;

      // C 会议信息摘要
      const p = dm.patientOf(c);
      root.appendChild(h("div", { class: "info-block" }, [
        h("div", { class: "ib-title" }, "🗂️ 会议信息摘要"),
        h("div", { class: "kv-grid" }, [
          kv("讨论主题", a.description),
          kv("患者", c.subject.display + "  " + dm.genderText(p.gender) + "  " + dm.ageOf(p) + "岁  " + c.dept + "  住院号" + dm.mrn(p)),
          h("div", { class: "kv" }, [h("span", { class: "k" }, "病例类型："), ui.caseTypeTag(c.caseType)]),
          kv("会议时间", a.start ? dt.fmtDateTime(a.start) : "待安排"),
          kv("状态", App.enums.meetingStatus[a.status].label),
        ]),
      ]));

      if (!isParticipant) root.appendChild(h("div", { class: "locked-note mb-12" }, "ℹ️ 您不是本次会议的受邀参会人员，仅可查看研讨记录，不能填写或签名。"));
      else if (locked) root.appendChild(h("div", { class: "locked-note mb-12" }, "🔒 研讨记录已归档锁定，内容不可修改（只读模式）"));
      else if (mySigned) root.appendChild(h("div", { class: "locked-note mb-12" }, "✅ 您已完成签名，当前为只读模式"));

      // 参考资料 / 讨论意见录入——分别独立成块，不共用同一个板块
      const sec = (comp && comp.section) || [];
      const getSec = (title) => { const s = sec.find((x) => x.title === title); return s ? s.text : ""; };
      const fields = {
        analysis: textArea("输入病情分析内容...", getSec("病情分析"), readonly),
        diagnosis: textArea("输入诊断意见...", getSec("诊断意见"), readonly),
        treatment: textArea("输入治疗建议...", getSec("治疗建议"), readonly),
        followup: textArea("输入后续随访计划...", getSec("后续随访计划"), readonly),
      };
      root.appendChild(h("div", { class: "grid grid-2 section", style: { gridTemplateColumns: "1fr 1.6fr" } }, [
        h("div", { class: "card card-pad" }, [
          h("div", { class: "section-title" }, [h("span", { class: "bar" }), "参考资料"]),
          views.materialTabs(c, true),
        ]),
        h("div", { class: "card card-pad" }, [
          h("div", { class: "section-title" }, [h("span", { class: "bar" }), "讨论意见录入（标准模板）"]),
          formField("病情分析", fields.analysis),
          formField("诊断意见", fields.diagnosis),
          formField("治疗建议", fields.treatment),
          formField("后续随访计划", fields.followup),
        ]),
      ]));

      // F 电子签名确认
      if (!readonly) {
        root.appendChild(h("div", { class: "info-block" }, [
          h("div", { class: "ib-title" }, "✍️ 电子签名确认"),
          h("div", {}, "讨论意见已填写完毕后可进行签名确认"),
          h("div", { class: "mt-8" }, h("button", { class: "btn primary", onClick: doSign }, "🔐 CA电子签名")),
          h("div", { class: "small muted mt-8" }, "提示：签名后讨论内容将归档锁定，不可修改"),
        ]));
      }

      // G 签名状态追踪
      root.appendChild(views.signStatus(c));

      // H 操作按钮区
      const ops = h("div", { class: "btn-row", style: { marginTop: "16px" } }, [
        h("button", { class: "btn", onClick: () => backToList() }, "返回列表"),
      ]);
      if (!readonly) {
        ops.appendChild(h("button", { class: "btn", onClick: () => { save(false); ui.toast("已暂存", "success"); build(); } }, "暂存"));
        ops.appendChild(h("button", { class: "btn primary", onClick: doSign }, "提交并签名"));
      }
      root.appendChild(ops);

      function collect() { return { analysis: fields.analysis.value, diagnosis: fields.diagnosis.value, treatment: fields.treatment.value, followup: fields.followup.value }; }
      function save(sign) { return dm.saveResearch(c.id, collect(), sign); }
      function doSign() {
        const data = collect();
        if (!data.analysis.trim() || !data.diagnosis.trim() || !data.treatment.trim() || !data.followup.trim()) {
          ui.toast("请完整填写讨论意见四个字段后再签名", "error"); return;
        }
        ui.confirmBox({ title: "CA 电子签名", message: "将调用 CA 签名系统完成身份核验并签名，签名后内容归档锁定。确定提交？", okText: "确认签名" }).then((ok) => {
          if (!ok) return;
          const before = dm.caseById(c.id).status;
          save(true);
          const after = dm.caseById(c.id);
          App.app.refreshMsgBadge();
          if (after.status === "completed" && before !== "completed") {
            ui.toast("全体专家签名完成，研讨记录已归档，系统已自动生成诊疗调整任务", "success");
          } else {
            ui.toast("CA 电子签名成功，已记录签名人与时间", "success");
          }
          // 签名后停留在本页，原地刷新显示签名完成状态（记录签名人和时间），不跳转页面
          build();
        });
      }
    }

    // 返回列表：优先回到"讨论组织及跟踪管理"，若当前角色不可访问该模块
    // （例如主管医生受邀参与本人患者的讨论），则回到个人工作台的病例讨论列表
    function backToList() {
      if (App.auth.canAccess("discussion")) nav("#/discussion?tab=meetings");
      else nav("#/workbench?tab=cases");
    }

    build();
    return root;
  }

  function textArea(ph, val, readonly) {
    const ta = h("textarea", { class: "input-full", placeholder: ph, disabled: readonly }, val || "");
    return ta;
  }
  function formField(label, ctrl) {
    return h("div", { style: { marginBottom: "12px" } }, [h("label", { style: { display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "600" } }, label), ctrl]);
  }
  function kv(k, v) { return h("div", { class: "kv" }, [h("span", { class: "k" }, k + "："), h("span", { class: "v" }, v)]); }

  App.pages.research = research;
})(window.App);
