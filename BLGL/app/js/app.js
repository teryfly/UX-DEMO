/* ============================================================
   应用外壳 —— 登录、角色切换、顶部导航、路由
   ============================================================ */
const App = (() => {
  const F = window.FHIR, U = window.UI, B = window.Biz;
  const esc = U.esc;
  const Pages = {};                  // 页面渲染器注册表（各 pages/*.js 注入）
  const State = { user: null, page: 'home', params: {} };

  const LOGIN_USERS = {
    clinician: 'u-zhang', deptHead: 'u-li', archivist: 'u-zhao', qc: 'u-qian', admin: 'u-admin',
  };

  function registerPage(key, fn) { Pages[key] = fn; }

  // ---------------- 登录 ----------------
  function renderLogin() {
    const root = document.getElementById('root');
    let pick = 'clinician';
    const roleOpts = Object.values(F.ROLES).map(r =>
      `<div class="role-opt ${r.key === pick ? 'on' : ''}" data-r="${r.key}">
        <div class="ava">${r.icon}</div>
        <div><div class="rn">${esc(r.name)}</div><div class="ru">${esc(F.userName(LOGIN_USERS[r.key]))} · 演示账号</div></div>
      </div>`).join('');
    root.innerHTML = `<div class="login-wrap"><div class="login-card">
      <div class="login-hero">
        <div>
          <h1>病历管理制度<br/>闭环管理系统</h1>
          <p>书写时限监控 · 质控整改闭环 · 终末质控归档 · 质量统计分析</p>
          <div class="feat">
            <div>🩺 临床医生：文书时限监控 · 整改 · 提交归档</div>
            <div>👔 科室负责人：整改追踪 · 质量概览 · 及时率</div>
            <div>🗄️ 病案室：终末质控 · 归档管理</div>
            <div>📊 质量管理部门：时限/质控配置 · 全院统计</div>
            <div>⚙️ 系统管理员：用户权限管理</div>
          </div>
        </div>
        <p style="opacity:.7">基于 FHIR 标准模拟数据 · 前端演示原型</p>
      </div>
      <div class="login-form">
        <h2>选择演示角色登录</h2>
        <div class="sub">演示环境无需密码，选择角色即可体验对应业务流程</div>
        <div class="role-pick">${roleOpts}</div>
        <button class="btn pri" id="loginBtn" style="width:100%;height:42px;font-size:15px">进入系统</button>
        <div class="wrap-note" style="text-align:center">登录后可随时通过右上角用户菜单切换角色</div>
      </div>
    </div></div>`;
    root.querySelectorAll('.role-opt').forEach(o => o.onclick = () => {
      pick = o.dataset.r; root.querySelectorAll('.role-opt').forEach(x => x.classList.toggle('on', x === o));
    });
    document.getElementById('loginBtn').onclick = () => login(pick);
  }

  function login(roleKey) {
    State.user = F.user(LOGIN_USERS[roleKey]);
    State.page = 'home'; State.params = {};
    renderShell();
  }
  function switchRole(roleKey) {
    State.user = F.user(LOGIN_USERS[roleKey]);
    const home = (U.ROLE_PAGES[roleKey] || [])[0] || 'home';
    State.page = 'home'; State.params = {};
    renderShell();
    U.toast(`已切换为「${F.ROLES[roleKey].name}」`, 'info');
  }

  // ---------------- 顶部导航 ----------------
  function renderTopbar() {
    const u = State.user, role = u.role;
    const groups = U.GROUPS.filter(g => g.pages.some(p => U.canAccess(role, p)));
    const navHtml = `
      <div class="navitem ${State.page === 'home' ? 'on' : ''}" data-go="home">🏠 首页</div>
      ${groups.map(g => {
        const pages = g.pages.filter(p => U.canAccess(role, p));
        const active = pages.includes(State.page);
        return `<div class="navitem grp ${active ? 'on' : ''}" data-grp="${esc(g.name)}">
          ${g.icon} ${esc(g.name)} <span class="caret">▼</span>
          <div class="dropdown">${pages.map(p => `<div class="di ${State.page === p ? 'on' : ''}" data-go="${p}">${esc(U.PAGES[p].title)}</div>`).join('')}</div>
        </div>`;
      }).join('')}`;
    const unread = F.col('Communication').filter(c => c.to === u.id && !c.read).length;
    const bar = U.h(`<div class="topbar">
      <div class="brand"><div class="logo">病</div>病历管理制度闭环管理系统</div>
      <div class="mainnav">${navHtml}</div>
      <div class="topbar-right">
        <button class="icon-btn" id="msgBtn">🔔${unread ? `<span class="badge-dot">${unread}</span>` : ''}</button>
        <div class="user-chip" id="userChip">
          <div class="ava">${esc(u.name.slice(0, 1))}</div>
          <div><div class="un">${esc(u.name)}</div><div class="ur">${esc(F.ROLES[role].name)}</div></div>
          <span class="caret">▼</span>
        </div>
      </div>
    </div>`);
    // 导航事件
    bar.querySelectorAll('[data-go]').forEach(n => n.onclick = (e) => { e.stopPropagation(); go(n.dataset.go); });
    bar.querySelectorAll('.navitem.grp').forEach(g => g.onclick = (e) => {
      e.stopPropagation(); const open = g.classList.contains('open');
      bar.querySelectorAll('.navitem.grp').forEach(x => x.classList.remove('open'));
      if (!open) g.classList.add('open');
    });
    bar.querySelector('#msgBtn').onclick = (e) => { e.stopPropagation(); openMessages(); };
    bar.querySelector('#userChip').onclick = (e) => { e.stopPropagation(); openUserMenu(e.currentTarget); };
    return bar;
  }

  function openUserMenu(anchor) {
    document.querySelectorAll('.usermenu').forEach(m => m.remove());
    const u = State.user;
    const menu = U.h(`<div class="usermenu dropdown" style="display:block;position:fixed;right:18px;top:54px;min-width:230px">
      <div style="padding:10px 12px;border-bottom:1px solid var(--c-line);margin-bottom:4px">
        <div style="font-weight:600">${esc(u.name)}</div><div class="muted" style="font-size:12px">${esc(F.ROLES[u.role].name)} · ${esc(F.orgName(u.org))}</div></div>
      <div class="muted" style="font-size:11px;padding:4px 12px">切换演示角色</div>
      ${Object.values(F.ROLES).map(r => `<div class="di ${r.key === u.role ? 'on' : ''}" data-role="${r.key}">${r.icon} ${esc(r.name)}</div>`).join('')}
      <div style="border-top:1px solid var(--c-line);margin-top:4px;padding-top:4px">
        <div class="di" data-act="reset">♻️ 重置演示数据</div>
        <div class="di" data-act="logout">🚪 退出登录</div>
      </div>
    </div>`);
    document.body.appendChild(menu);
    menu.querySelectorAll('[data-role]').forEach(b => b.onclick = () => { menu.remove(); switchRole(b.dataset.role); });
    menu.querySelector('[data-act="reset"]').onclick = async () => {
      menu.remove();
      if (await U.confirm('确定重置所有演示数据为初始状态？已编辑的内容将丢失。', { title: '重置演示数据', danger: true, okText: '重置' })) {
        F.reset(); U.toast('演示数据已重置', 'ok'); renderShell();
      }
    };
    menu.querySelector('[data-act="logout"]').onclick = () => { menu.remove(); State.user = null; renderLogin(); };
    setTimeout(() => document.addEventListener('mousedown', function clo(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', clo); }
    }), 0);
  }

  function openMessages() {
    const u = State.user;
    const msgs = F.col('Communication').filter(c => c.to === u.id).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    const body = U.h(`<div>${msgs.length ? msgs.map(m => `<div style="display:flex;gap:10px;padding:11px 4px;border-bottom:1px solid var(--c-line)">
      <div>${{ '超时预警': '⏰', '整改通知': '📋', '归档拦截': '🚫', '催办': '📣' }[m.category] || '📢'}</div>
      <div style="flex:1"><div style="font-weight:600">${esc(m.category)} · ${esc(m.subject)} ${m.read ? '' : '<span class="badge-dot" style="position:static;display:inline-flex">未读</span>'}</div>
      <div class="muted" style="font-size:12px;margin:2px 0">${F.fmt(m.sentAt)}</div>
      <div style="font-size:13px">${esc(m.text)}</div></div></div>`).join('') : '<div class="empty-box"><div class="em">📭</div>暂无消息</div>'}</div>`);
    const m = U.modal({ title: `消息中心（${msgs.filter(x => !x.read).length} 条未读）`, body,
      footer: `<button class="btn read">全部标记已读</button><button class="btn pri close">关闭</button>` });
    m.el.querySelector('.close').onclick = m.close;
    m.el.querySelector('.read').onclick = () => { msgs.forEach(x => x.read = true); F.save(); m.close(); renderShell(); };
  }

  // ---------------- 路由 ----------------
  function go(page, params = {}) {
    if (!U.canAccess(State.user.role, page)) { U.toast('无权访问该页面', 'warn'); return; }
    State.page = page; State.params = params;
    renderShell(); try { window.scrollTo(0, 0); } catch (e) {}
  }

  function renderShell() {
    const root = document.getElementById('root');
    root.innerHTML = '';
    root.appendChild(renderTopbar());
    const main = U.h('<div class="page-host"></div>');
    root.appendChild(main);
    document.addEventListener('mousedown', closeDropdowns);
    const fn = Pages[State.page] || Pages['home'];
    const view = fn(State.user, State.params, { go, refresh: renderShell });
    main.appendChild(view);
    main.appendChild(U.h(U.footer()));
  }
  function closeDropdowns(e) {
    if (!e.target.closest('.navitem.grp')) document.querySelectorAll('.navitem.grp.open').forEach(x => x.classList.remove('open'));
  }

  // 面包屑助手（可点击跳转）
  function crumb(page) {
    const p = U.PAGES[page]; if (!p || !p.group) return '';
    const g = U.GROUPS.find(x => x.name === p.group);
    const firstPage = g && State.user && g.pages.find(pg => U.canAccess(State.user.role, pg));
    const groupHtml = firstPage
      ? `<span class="crumb-link" data-crumb-go="${firstPage}">${esc(p.group)}</span>`
      : `<span>${esc(p.group)}</span>`;
    return `<div class="crumb"><b class="crumb-link" data-crumb-go="home">首页</b><span>›</span>${groupHtml}<span>›</span><b>${esc(p.title)}</b></div>`;
  }
  // 面包屑事件委托（各页面用 innerHTML 插入面包屑 HTML，统一在此处绑定点击）
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-crumb-go]');
    if (t) go(t.dataset.crumbGo);
  });

  function init() { renderLogin(); }

  return { registerPage, go, init, crumb, state: () => State };
})();
window.App = App;
