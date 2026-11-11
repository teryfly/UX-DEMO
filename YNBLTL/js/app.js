/* ============================================================
   app.js — 应用引导：导航渲染、角色切换、通知、初始化
   ============================================================ */
(function (App) {
  "use strict";
  const { h, clear, $, $$ } = App.dom;
  const nav = () => App.router.navigate;

  // 各 L2 模块的二级导航（次级选项卡/侧边栏）
  const SUBNAV = {
    workbench: [
      { label: "病例讨论列表", href: "#/workbench?tab=cases", tab: "cases" },
      { label: "任务执行列表", href: "#/workbench?tab=tasks", tab: "tasks" },
    ],
    discussion: [
      { label: "讨论会议列表", href: "#/discussion?tab=meetings", tab: "meetings" },
      { label: "任务跟踪列表", href: "#/discussion?tab=tracking", tab: "tracking", hideForExpert: true },
    ],
    reports: [
      { label: "讨论统计与溯源", href: "#/reports", tab: "trace" },
    ],
    admin: [
      { label: "业务规则配置", href: "#/admin?tab=rules", tab: "rules" },
      { label: "权限配置", href: "#/admin?tab=perm", tab: "perm" },
      { label: "接口维护", href: "#/admin?tab=interface", tab: "interface" },
    ],
  };

  /* ---------- 顶部主导航 ---------- */
  function refreshNav(activeRoute) {
    const navEl = $("#mainnav");
    clear(navEl);
    const roleKey = App.auth.currentRoleKey();
    const modules = App.auth.modulesFor(roleKey);
    const def = App.router.ROUTES[activeRoute];
    const activeModule = def ? def.module : null;

    modules.forEach((mod) => {
      const subs = (SUBNAV[mod.key] || []).filter((s) => !(s.hideForExpert && roleKey === "expert"));
      const item = h("button", { class: "nav-item" + (mod.key === activeModule ? " active" : "") }, [
        h("span", {}, mod.icon + " " + mod.label),
        subs.length ? h("span", { class: "caret" }, "▾") : null,
      ]);
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        if (subs.length) {
          const open = item.classList.contains("open");
          $$(".nav-item.open").forEach((x) => x.classList.remove("open"));
          if (!open) item.classList.add("open"); else nav()("#/" + mod.route);
        } else nav()("#/" + mod.route);
      });
      if (subs.length) {
        const dd = h("div", { class: "nav-dropdown" }, subs.map((s) => {
          const cur = location.hash.indexOf(s.href.replace("#", "")) >= 0 || (location.hash.indexOf(mod.route) >= 0 && location.hash.indexOf(s.tab) >= 0);
          return h("div", { class: "sub-item" + (cur ? " active" : ""), onClick: (e) => { e.stopPropagation(); item.classList.remove("open"); nav()(s.href); } },
            [h("span", { class: "dot" }, cur ? "●" : ""), s.label]);
        }));
        item.appendChild(dd);
      }
      navEl.appendChild(item);
    });

    // 更新用户信息条
    const u = App.auth.current();
    $("#userName").textContent = u.name;
    $("#userRole").textContent = u.roleLabel + (u.dept ? " · " + u.dept : "");
    $("#userAvatar").textContent = u.icon;
    refreshMsgBadge();
  }

  /* ---------- 角色切换器 ---------- */
  function buildRoleSwitcher() {
    const sel = $("#roleSelect");
    clear(sel);
    App.auth.roleList().forEach((r) => {
      sel.appendChild(h("option", { value: r.key }, r.icon + " " + r.label));
    });
    sel.value = App.auth.currentRoleKey();
    sel.addEventListener("change", () => {
      App.auth.setRole(sel.value);
      const mods = App.auth.modulesFor(sel.value);
      const target = mods.length ? mods[0].route : "home";
      App.ui.toast("已切换为「" + App.auth.currentRole().label + "」演示视角", "info");
      App.router.navigate("#/" + target);
    });
  }

  /* ---------- 通知 ---------- */
  function refreshMsgBadge() {
    const n = App.domain.unreadCount();
    const badge = $("#msgBadge");
    badge.textContent = n;
    badge.dataset.zero = n === 0 ? "true" : "false";
  }
  function openNotifications() {
    const layer = $("#drawerLayer");
    clear(layer);
    const notifs = App.domain.myNotifications();
    const mask = h("div", { class: "drawer-mask", onClick: () => clear(layer) });
    const body = h("div", { class: "drawer-body" });
    if (!notifs.length) body.appendChild(App.ui.emptyState("暂无通知消息", "🔔"));
    notifs.forEach((nf) => {
      body.appendChild(h("div", { class: "notif-item" + (nf.read ? "" : " unread"), onClick: () => { App.domain.markRead(nf.id); refreshMsgBadge(); openNotifications(); } }, [
        h("div", { class: "ni-title" }, (nf.priority === "urgent" ? "⚠ " : "") + (nf.topic ? nf.topic.text : "通知")),
        h("div", { class: "ni-body" }, nf.payload && nf.payload[0] ? nf.payload[0].contentString : ""),
        h("div", { class: "ni-time" }, (nf.sender ? nf.sender.display + " · " : "") + App.date.fmtMDTime(nf.sent)),
      ]));
    });
    const drawer = h("div", { class: "drawer" }, [
      h("div", { class: "drawer-head" }, [
        h("span", {}, "🔔 消息通知"),
        h("div", { class: "flex gap-8" }, [
          h("button", { class: "btn-link", onClick: () => { App.domain.markAllRead(); refreshMsgBadge(); openNotifications(); } }, "全部已读"),
          h("button", { class: "modal-close", onClick: () => clear(layer) }, "×"),
        ]),
      ]),
      body,
    ]);
    layer.appendChild(mask);
    layer.appendChild(drawer);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    // 首次访问：生成演示种子数据
    App.seed.ensure();

    buildRoleSwitcher();

    $("#msgBtn").addEventListener("click", openNotifications);
    $("#userChip").addEventListener("click", () => App.ui.toast("当前登录：" + App.auth.current().name + "（" + App.auth.current().roleLabel + "）", "info"));
    document.addEventListener("click", () => $$(".nav-item.open").forEach((x) => x.classList.remove("open")));

    $("#resetLink").addEventListener("click", async (e) => {
      e.preventDefault();
      const ok = await App.ui.confirmBox({ title: "重置演示数据", message: "将清空本地缓存并重新生成全部演示数据，确定继续？", okText: "重置", danger: true });
      if (ok) { App.fhir.reset(); App.seed.seedAll(); App.ui.toast("演示数据已重置", "success"); App.router.render(); }
    });
    $("#helpLink").addEventListener("click", (e) => { e.preventDefault(); showHelp(); });
    $("#privacyLink").addEventListener("click", (e) => { e.preventDefault(); App.ui.toast("演示原型：所有数据均在浏览器本地模拟，不上传任何服务器。", "info"); });

    App.auth.onChange(() => { refreshNav(App.router.parseHash().route); });

    // 首屏：直接进入当前角色可访问的第一个模块（不再经过通用首页）
    App.router.render();
  }

  function showHelp() {
    App.ui.modal({
      title: "演示说明 · 如何走通完整业务流程",
      width: "",
      body: h("div", {}, [
        h("p", {}, "本系统为「疑难病例讨论制度闭环管理」演示原型，数据基于 FHIR 标准在浏览器本地模拟，支持增删改查。"),
        h("p", {}, [h("b", {}, "核心操作："), "通过右上角「演示角色」切换登录身份，体验五类角色的完整闭环流程："]),
        h("ol", { style: { paddingLeft: "20px", lineHeight: "1.9" } }, [
          h("li", {}, "🩺 主管医生：个人工作台 → 查看名下疑难病例 → 执行诊疗调整任务"),
          h("li", {}, "🧑‍⚕️ 科室主任：接收通知 → 新建讨论会议、邀请专家 → 跟踪任务执行"),
          h("li", {}, "👨‍⚕️ 会诊专家：进入研讨 → 录入讨论意见 → CA 电子签名归档"),
          h("li", {}, "📊 医疗质量管理部门：查看统计报表 → 病例全流程溯源"),
          h("li", {}, "⚙️ 系统管理员：业务规则配置 / 权限配置 / 接口维护"),
        ]),
        h("p", { class: "muted small" }, "提示：全体专家签名完成后，系统会自动生成诊疗调整任务并推送待办，形成跨角色闭环。底部可「重置演示数据」。"),
      ]),
      footer: [h("button", { class: "btn primary", onClick: () => $$(".modal-mask").forEach((m) => m.remove()) }, "我知道了")],
    });
  }

  App.app = { init, refreshNav, refreshMsgBadge, openNotifications };
  document.addEventListener("DOMContentLoaded", init);
})(window.App);
