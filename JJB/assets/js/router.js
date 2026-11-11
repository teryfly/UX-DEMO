/* ============================================================
 * router.js — 布局外壳（顶栏/侧栏/面包屑）+ Hash 路由
 * 页面注册表：window.PAGES['#/route'] = function(viewEl){...}
 * 全局：window.Router
 * ============================================================ */
window.PAGES = window.PAGES || {};
(function () {
  const Router = {};

  Router.current = () => location.hash || '#/home';

  Router.go = (route) => {
    if (location.hash === route) Router.render();
    else location.hash = route;
  };

  /* ---------- 顶部导航 ---------- */
  function renderTopbar() {
    const role = AUTH.currentRole();
    const user = AUTH.currentUser();
    const cur = Router.current();
    const curMod = AUTH.moduleOfRoute(cur);
    const mods = AUTH.visibleModules();
    const unread = FHIR.search('Communication', c => c._handleStatus === '未处理', null, { silent: true }).length;

    const navHtml = mods.map(m =>
      `<a href="${m.route}" class="${curMod && curMod.id === m.id ? 'active' : ''}">${m.title}</a>`
    ).join('');

    U.$('#topbar').innerHTML = `
      <div class="logo"><span class="mark">值</span><span>值班交接班制度闭环管理</span></div>
      <nav>
        <a href="#/home" class="${cur === '#/home' ? 'active' : ''}">首页</a>
        ${navHtml}
      </nav>
      <div class="right">
        <span class="bell" title="异常通知" onclick="Router.go('#/monitor')">🔔${unread ? `<span class="badge">${unread}</span>` : ''}</span>
        <div class="role-switch" title="演示：切换登录角色">
          <span>身份</span>
          <select id="roleSel">
            ${AUTH.ROLES.map(r => `<option ${r === role ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </div>
        <div class="avatar">${user.name[0]}</div>
        <span style="font-size:13px">${user.name} <span style="opacity:.7">·${role}</span></span>
      </div>`;

    U.$('#roleSel').addEventListener('change', (e) => {
      AUTH.setRole(e.target.value);
      Router.go(AUTH.landingRoute());
      Router.render();
    });
  }

  /* ---------- 侧栏（当前模块的 L3 子页） ---------- */
  function renderSidebar() {
    const cur = Router.current();
    const mod = AUTH.moduleOfRoute(cur);
    const side = U.$('#sidebar');
    if (!mod || cur === '#/home') { side.className = 'sidebar empty'; side.innerHTML = ''; return; }
    side.className = 'sidebar';
    const kids = AUTH.visibleChildren(mod);
    side.innerHTML = `<div class="grp">${mod.icon} ${mod.title}</div>` +
      kids.map(c => `<a href="${c.route}" class="${c.route === cur ? 'active' : ''}">${c.title}</a>`).join('');
  }

  /* ---------- 面包屑 ---------- */
  function renderCrumb() {
    const cur = Router.current();
    const bc = U.$('#breadcrumb');
    if (cur === '#/home') { bc.innerHTML = ''; return; }
    const mod = AUTH.moduleOfRoute(cur);
    const child = AUTH.childOfRoute(cur);
    if (!mod || !child) { bc.innerHTML = ''; return; }
    bc.innerHTML = `<a href="#/home">首页</a> &gt; ${mod.title} &gt; <b>${child.title}</b>`;
  }

  /* ---------- 主渲染 ---------- */
  // 每次渲染前将 #view 替换为全新节点（不携带任何旧事件监听器）。
  // 原实现只清空 innerHTML、复用同一个 DOM 节点，而各页面又在其上通过
  // U.delegate/addEventListener 绑定事件；同一节点反复绑定会导致监听器
  // 层层叠加——点击一次操作实际触发了 N 次处理函数（并可能弹出/关闭 N 层弹框），
  // 表现为“需要点很多次”“弹框像叠了很多层”。用全新节点从根上避免叠加。
  function freshView() {
    const old = U.$('#view');
    const fresh = old.cloneNode(false);
    old.replaceWith(fresh);
    return fresh;
  }

  Router.render = () => {
    let cur = Router.current();
    // 默认/越权处理
    if (cur === '#/' || cur === '#') cur = '#/home';
    renderTopbar();
    if (AUTH.isDisabled()) {
      renderSidebar(); renderCrumb();
      const u = AUTH.currentUser();
      freshView().innerHTML = `<div class="acct-locked"><div class="ic">🚫</div>
        <h3>账号「${u.name}」已被禁用</h3>
        <p>该账号已被管理员禁用，无法登录使用系统。请切换为其他演示身份，或联系管理员在「用户权限管理」中重新启用。</p></div>`;
      return;
    }
    if (cur !== '#/home' && !AUTH.canAccess(cur)) {
      renderSidebar(); renderCrumb();
      freshView().innerHTML = `<div class="noaccess"><div class="ic">🔒</div>
        <h3>当前角色「${AUTH.currentRole()}」无权访问该页面</h3>
        <p>请在右上角切换为有权限的演示身份，或返回首页。</p>
        <button class="btn primary" onclick="Router.go('#/home')">返回首页</button></div>`;
      return;
    }
    renderSidebar(); renderCrumb();
    const view = freshView();
    const page = window.PAGES[cur] || window.PAGES['#/home'];
    try { page(view); }
    catch (e) { console.error(e); view.innerHTML = `<div class="empty-state">页面渲染异常：${U.esc(e.message)}</div>`; }
    window.scrollTo(0, 0);
  };

  window.addEventListener('hashchange', Router.render);
  window.Router = Router;
})();
