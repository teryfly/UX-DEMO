/* ============================================================
 * auth.js — 角色身份、权限、导航结构（按文档 IA-3.3）
 * 全局：window.AUTH
 * ============================================================ */
(function () {
  const AUTH = {};

  AUTH.ROLES = ['值班医生', '接班医生', '科室负责人', '医院管理部门', '管理员'];

  // 角色 → 登录身份（对应 seed 中 Practitioner 的 appRole）
  AUTH.IDENTITY = {
    '值班医生': 'doc-zw',     // 张伟
    '接班医生': 'doc-ln',     // 李娜
    '科室负责人': 'doc-wjg',  // 王建国
    '医院管理部门': 'doc-zhm', // 赵敏
    '管理员': 'doc-admin',    // 系统管理员
  };

  // 导航结构（L2 模块 + L3 页面），含可见角色（IA-3.3）
  AUTH.NAV = [
    {
      id: 'L2-1', title: '值班排班管理', icon: '📅', route: '#/rule',
      roles: ['科室负责人'],
      children: [
        { route: '#/rule', title: '排班规则设置', code: 'L3-1-1' },
        { route: '#/template', title: '排班模板设置', code: 'L3-1-2' },
        { route: '#/roster', title: '值班排班', code: 'L3-1-3' },
      ],
    },
    {
      id: 'L2-2', title: '交接班管理', icon: '📋', route: '#/handover-list',
      roles: ['值班医生', '接班医生'],   // 顶部导航可见性，严格遵循 IA-3.3
      children: [
        { route: '#/handover-list', title: '交接班清单', code: 'L3-2-1', roles: ['值班医生', '接班医生'] },
        // 交接班记录：主导航对值班/接班医生可见；科室负责人/医院管理部门经“值班执行监控”跨页查看（页面级权限差异）
        { route: '#/handover-record', title: '交接班记录', code: 'L3-2-2', roles: ['值班医生', '接班医生'], extraRoles: ['科室负责人', '医院管理部门'] },
      ],
    },
    {
      id: 'L2-3', title: '值班质量监控', icon: '📊', route: '#/monitor',
      roles: ['科室负责人', '医院管理部门'],
      children: [
        { route: '#/monitor', title: '值班执行监控', code: 'L3-3-1', roles: ['科室负责人', '医院管理部门'] },
        { route: '#/report', title: '值班质量报告', code: 'L3-3-2', roles: ['科室负责人', '医院管理部门'] },
      ],
    },
    {
      id: 'L2-4', title: '系统管理', icon: '⚙️', route: '#/sysconfig',
      roles: ['管理员'],
      children: [
        { route: '#/sysconfig', title: '系统配置管理', code: 'L3-4-1' },
        { route: '#/userperm', title: '用户权限管理', code: 'L3-4-2' },
      ],
    },
  ];

  let _role = localStorage.getItem('ux_jjb_role') || '值班医生';
  AUTH.currentRole = () => _role;
  AUTH.setRole = (r) => { _role = r; localStorage.setItem('ux_jjb_role', r); };

  AUTH.currentUser = () => {
    const id = AUTH.IDENTITY[_role];
    const p = FHIR.read('Practitioner', id, { silent: true });
    const role = FHIR.search('PractitionerRole', x => x.practitioner.reference === 'Practitioner/' + id, null, { silent: true })[0];
    const org = role ? FHIR.resolve(role.organization) : null;
    return {
      id, name: p ? p.name[0].text : _role, appRole: _role,
      title: p && p.qualification && p.qualification[0] ? p.qualification[0].code.text : '—',
      org: org ? org.name : '', orgId: org ? org.id : '',
      practitioner: p,
    };
  };

  // 当前登录身份对应的账号资源（Practitioner._account），用于读取启用/禁用状态与
  // 管理员在「用户权限管理」中为该账号手动调整过的功能权限（US-1.6 AC2「权限变更实时生效」）
  AUTH.currentAccount = () => FHIR.read('Practitioner', AUTH.IDENTITY[_role], { silent: true });
  AUTH.isDisabled = () => { const p = AUTH.currentAccount(); return !!(p && p._account && p._account.status !== 'active'); };
  // 该账号若保存过自定义权限勾选，则以其为准（覆盖角色默认值）；否则回退到角色默认可见性
  AUTH.currentPerms = () => { const p = AUTH.currentAccount(); return (p && p._account && p._account.perms) || null; };

  function childVisible(mod, c) {
    const roleOk = c.roles ? (c.roles.includes(_role) || (c.extraRoles && c.extraRoles.includes(_role)))
      : mod.roles.includes(_role);
    const perms = AUTH.currentPerms();
    if (perms && Object.prototype.hasOwnProperty.call(perms, c.code)) return !!perms[c.code];
    return roleOk;
  }

  // 当前角色可见的 L2 模块（模块下至少有一个可见子页面才展示该模块入口）
  AUTH.visibleModules = () => AUTH.NAV.filter(m => AUTH.visibleChildren(m).length > 0);

  // 当前角色可见的某模块下子页面（含跨页访问 extraRoles；再叠加该账号的功能权限勾选结果）
  AUTH.visibleChildren = (mod) => mod.children.filter(c => childVisible(mod, c));

  // 路由 → 所属模块
  AUTH.moduleOfRoute = (route) => AUTH.NAV.find(m => m.children.some(c => c.route === route));
  AUTH.childOfRoute = (route) => {
    for (const m of AUTH.NAV) { const c = m.children.find(c => c.route === route); if (c) return c; }
    return null;
  };

  // 权限校验（child 级权限——含角色默认值与账号自定义勾选——优先；extraRoles 提供跨页访问）
  AUTH.canAccess = (route) => {
    if (AUTH.isDisabled()) return false;
    if (route === '#/home' || route === '' || route === '#/') return true;
    const mod = AUTH.moduleOfRoute(route);
    if (!mod) return false;
    const child = mod.children.find(c => c.route === route);
    if (!child) return false;
    return childVisible(mod, child);
  };

  // 该角色的默认落地页
  AUTH.landingRoute = () => {
    const mods = AUTH.visibleModules();
    if (!mods.length) return '#/home';
    const kids = AUTH.visibleChildren(mods[0]);
    return kids.length ? kids[0].route : '#/home';
  };

  window.AUTH = AUTH;
})();
