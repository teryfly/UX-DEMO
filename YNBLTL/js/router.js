/* ============================================================
   router.js — 哈希路由 + 面包屑 + 角色访问控制
   ============================================================ */
(function (App) {
  "use strict";
  const { h, clear, $ } = App.dom;

  App.pages = App.pages || {};

  // 路由表：route -> { module(L2 key), render, crumb(params)->[], title }
  // 说明：不再设置跨角色的通用「首页」（L1）——各角色登录后直接进入本角色可访问的
  // 第一个 L2 模块首屏（个人工作台/讨论组织及跟踪管理/质量监控报表/系统配置管理），
  // 避免多一层无实际信息量的"进入页"。
  const ROUTES = {
    workbench: { module: "workbench", render: (p) => App.pages.workbench(p) },
    discussion: { module: "discussion", render: (p) => App.pages.discussion(p) },
    "meeting-create": { module: "discussion", render: (p) => App.pages.meetingCreate(p),
      crumb: () => [["讨论组织及跟踪管理", "#/discussion"], ["讨论会议列表", "#/discussion?tab=meetings"], ["讨论会议创建页", null]] },
    research: { module: "discussion", render: (p) => App.pages.research(p),
      crumb: () => [["讨论组织及跟踪管理", "#/discussion"], ["讨论会议列表", "#/discussion?tab=meetings"], ["病例研讨记录页", null]] },
    reports: { module: "reports", render: (p) => App.pages.reports(p) },
    admin: { module: "admin", render: (p) => App.pages.admin(p) },
  };

  function parseHash() {
    let hash = location.hash.replace(/^#\/?/, "");
    const [path, query] = hash.split("?");
    const params = {};
    if (query) query.split("&").forEach((kv) => { const [k, v] = kv.split("="); params[k] = decodeURIComponent(v || ""); });
    return { route: path, params };
  }

  function navigate(hash) { location.hash = hash; }

  // 当前角色可访问的第一个模块路由（用于空 hash / 未知路由 / 无权限时的落地页）
  function defaultRoute() {
    const mods = App.auth.modulesFor(App.auth.currentRoleKey());
    return mods.length ? mods[0].route : "workbench";
  }

  function setBreadcrumb(items) {
    const bar = $("#breadcrumbBar"), bc = $("#breadcrumb");
    clear(bc);
    if (!items || !items.length) { bar.style.display = "none"; return; }
    bar.style.display = "block";
    items.forEach((it, i) => {
      const [label, href] = it;
      if (i > 0) bc.appendChild(h("span", { class: "sep" }, ">"));
      if (href && i < items.length - 1) bc.appendChild(h("a", { href }, label));
      else bc.appendChild(h("span", { class: "current" }, label));
    });
  }

  function render() {
    const { route, params } = parseHash();
    if (!route || !ROUTES[route]) { navigate("#/" + defaultRoute()); return; }
    const def = ROUTES[route];
    const root = $("#pageRoot");
    clear(root);

    // 账号停用校验：管理员在权限配置中停用某账号后，该角色应完全无法使用系统
    const u = App.auth.current();
    if (!App.auth.isEnabled(u.id)) {
      setBreadcrumb(null);
      root.appendChild(accountDisabled());
      App.app.refreshNav(route);
      return;
    }

    // 访问控制：L2 模块按角色可见性校验
    // 特例：病例研讨记录页——只要当前用户确实是该场会议的受邀参会人员（例如主管医生
    // 受邀参与自己患者的讨论），即便其角色导航中不含"讨论组织及跟踪管理"模块，
    // 也应允许进入并签名，而不是一律提示无权限。
    const researchException = route === "research" && params.case && App.domain.isMeetingParticipant(params.case);
    if (def.module && !App.auth.canAccess(def.module) && !researchException) {
      setBreadcrumb(null);
      root.appendChild(noAccess(def.module));
      App.app.refreshNav(route);
      return;
    }

    // 面包屑
    if (def.crumb) setBreadcrumb(def.crumb(params));
    else if (App.pages._crumb && App.pages._crumb[route]) setBreadcrumb(App.pages._crumb[route](params));
    else setBreadcrumb(null);

    try {
      const view = def.render(params);
      if (view) App.dom.appendChildren(root, view);
    } catch (e) {
      console.error(e);
      root.appendChild(h("div", { class: "empty" }, [h("span", { class: "emoji" }, "💥"), "页面渲染出错：" + e.message]));
    }
    App.app.refreshNav(route);
    window.scrollTo(0, 0);
  }

  function noAccess(moduleKey) {
    const mod = App.auth.MODULE[moduleKey];
    const role = App.auth.currentRole();
    return h("div", { class: "noaccess" }, [
      h("span", { class: "emoji" }, "🔒"),
      h("h2", {}, "当前角色无权访问该模块"),
      h("p", {}, "「" + (mod ? mod.label : moduleKey) + "」对「" + role.label + "」不可见。"),
      h("p", { class: "muted" }, "请在右上角切换到有权限的演示角色，或联系系统管理员在「权限配置」中开通。"),
    ]);
  }

  function accountDisabled() {
    return h("div", { class: "noaccess" }, [
      h("span", { class: "emoji" }, "🚫"),
      h("h2", {}, "账号已停用"),
      h("p", {}, "当前演示账号已被系统管理员停用，无法访问系统。"),
      h("p", { class: "muted" }, "请切换到「系统管理员」角色，在「权限配置」中重新启用该账号；或右上角切换其他演示角色。"),
    ]);
  }

  App.router = { render, navigate, parseHash, setBreadcrumb, ROUTES, defaultRoute };
  window.addEventListener("hashchange", render);
})(window.App);
