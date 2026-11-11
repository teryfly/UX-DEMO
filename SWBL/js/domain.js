/* =====================================================================
 * domain.js —— 业务领域常量、信息架构（21 页站点地图）与演示身份
 * 死亡病例讨论制度闭环管理系统 v2.0
 * ---------------------------------------------------------------------
 * 导航角色（IA-3.3）：临床医师 / 科主任 / 医务部管理员，仅控制菜单可见性；
 * 场景身份（IA-3.3 场景身份操作权限表）：主管医师 / 上级医师 / 科主任 /
 * 科室医师 / 医务部 / 任务责任人，控制页面内按钮与操作。
 * ===================================================================== */
(function (global) {
  'use strict';

  /* ───── 导航角色 ───── */
  var NAV_ROLES = [
    { code: 'clinician', name: '临床医师', icon: '🩺' },
    { code: 'director', name: '科主任', icon: '👨‍⚕️' },
    { code: 'quality', name: '医务部管理员', icon: '🏥' }
  ];

  /* ───── 场景身份（页面内操作权限判定用） ───── */
  var SCENES = [
    { code: 'attending', name: '主管医师' },
    { code: 'senior', name: '上级医师' },
    { code: 'director', name: '科主任' },
    { code: 'doctor', name: '科室全体医师' },
    { code: 'quality', name: '医务部管理员' },
    { code: 'owner', name: '任务责任人' }
  ];

  /* ───── 演示身份（顶部「🎭 演示角色切换」） ───── */
  var DEMO_USERS = [
    { id: 'u-attending', name: '李海峰', title: '主治医师', dept: '心血管内科', scene: 'attending', navRole: 'clinician', practitioner: 'Practitioner-0011', role: 'PractitionerRole-0011', icon: '📝', desc: '填写上报单 / 书写讨论记录 / CA 必签' },
    { id: 'u-senior', name: '王建国', title: '主任医师', dept: '心血管内科', scene: 'senior', navRole: 'clinician', practitioner: 'Practitioner-0012', role: 'PractitionerRole-0012', icon: '✅', desc: '上报单一级审核 / 讨论记录 CA 必签' },
    { id: 'u-director', name: '张德明', title: '主任医师', dept: '心血管内科', scene: 'director', navRole: 'director', practitioner: 'Practitioner-0013', role: 'PractitionerRole-0013', icon: '👑', desc: '组织讨论 / 二级审核 / 效果评估 / 标记优秀措施' },
    { id: 'u-doctor', name: '赵敏', title: '住院医师', dept: '心血管内科', scene: 'doctor', navRole: 'clinician', practitioner: 'Practitioner-0014', role: 'PractitionerRole-0014', icon: '🩺', desc: '确认参会 / 参与讨论 / 执行改进措施' },
    { id: 'u-quality', name: '刘文华', title: '医务部管理员', dept: '医务部', scene: 'quality', navRole: 'quality', practitioner: 'Practitioner-0151', role: 'PractitionerRole-0151', icon: '📊', desc: '三级终审 / 人工判定 / 统计分析 / 系统管理' },
    { id: 'u-director2', name: '钱立群', title: '主任医师', dept: '呼吸内科', scene: 'director', navRole: 'director', practitioner: 'Practitioner-0023', role: 'PractitionerRole-0023', icon: '🏥', desc: '他科室科主任（对比数据权限：仅本科室可见）' }
  ];

  /* ───── 信息架构：一级模块 + 页面（严格对应 IA-1.1 站点地图） ───── */
  var ALL = ['clinician', 'director', 'quality'];
  var MODULES = [
    { code: 'L2-1', name: '讨论管理', icon: '💬', route: 'discuss-list', roles: ALL, pages: [
      { code: 'L2-1', name: '讨论任务列表', route: 'discuss-list', roles: ALL },
      { code: 'L3-1-2', name: '讨论任务详情', route: 'discuss-detail', roles: ALL, hidden: true },
      { code: 'L3-1-3', name: '讨论记录书写与签名', route: 'discuss-record', roles: ALL, hidden: true }
    ] },
    { code: 'L2-2', name: '上报管理', icon: '📄', route: 'report-list', roles: ALL, pages: [
      { code: 'L2-2', name: '上报任务列表', route: 'report-list', roles: ALL },
      { code: 'L3-2-2', name: '上报单填写与审核', route: 'report-form', roles: ALL, hidden: true }
    ] },
    { code: 'L2-3', name: '改进跟踪', icon: '🔄', route: 'improve-list', roles: ALL, pages: [
      { code: 'L2-3', name: '改进任务列表', route: 'improve-list', roles: ALL },
      { code: 'L3-3-2', name: '改进任务详情', route: 'improve-detail', roles: ALL, hidden: true }
    ] },
    { code: 'L2-4', name: '统计分析', icon: '📈', route: 'stat-overview', roles: ['quality'], sideMenu: true, pages: [
      { code: 'L3-4-1', name: '统计概览', route: 'stat-overview', roles: ['quality'] },
      { code: 'L3-4-2', name: '科室死亡病例分析', route: 'stat-dept', roles: ['quality'] },
      { code: 'L3-4-3', name: '死因与诊断分析', route: 'stat-cause', roles: ['quality'] },
      { code: 'L3-4-4', name: '死亡病例趋势分析', route: 'stat-trend', roles: ['quality'] },
      { code: 'L3-4-5', name: '改进跟踪统计', route: 'stat-improve', roles: ['quality'] },
      { code: 'L3-4-6', name: '时效分析', route: 'stat-timeliness', roles: ['quality'] },
      { code: 'L3-4-7', name: '报表管理', route: 'stat-report', roles: ['quality'] }
    ] },
    { code: 'L2-5', name: '系统管理', icon: '⚙️', route: 'sys-template', roles: ['quality'], sideMenu: true, pages: [
      { code: 'L3-5-1', name: '模板管理', route: 'sys-template', roles: ['quality'] },
      { code: 'L3-5-2', name: '时限规则配置', route: 'sys-timeout', roles: ['quality'] },
      { code: 'L3-5-3', name: '基础数据管理', route: 'sys-basedata', roles: ['quality'] },
      { code: 'L3-5-4', name: '角色权限管理', route: 'sys-role', roles: ['quality'] },
      { code: 'L3-5-5', name: '通知设置', route: 'sys-notify', roles: ['quality'] },
      { code: 'L3-5-6', name: '审批流程配置', route: 'sys-approval', roles: ['quality'] }
    ] }
  ];

  /* ───── 枚举：死亡类型 / 优先级 / 状态 / 预警 ───── */
  var DEATH_TYPES = [
    { code: 'expected', name: '预期死亡', color: '#FAAD14', cls: 'yellow', icon: '🟡' },
    { code: 'unexpected', name: '非预期死亡', color: '#FF4D4F', cls: 'red', icon: '🔴' },
    { code: 'special', name: '特殊死亡', color: '#1890FF', cls: 'blue', icon: '🔵' },
    { code: 'pending', name: '待人工判定', color: '#8C8C8C', cls: 'gray', icon: '⬜' }
  ];

  var PRIORITIES = [
    { code: 'high', name: '高', cls: 'red', icon: '⚡' },
    { code: 'medium', name: '中', cls: 'orange', icon: '' },
    { code: 'normal', name: '普通', cls: 'gray', icon: '' }
  ];

  var DISCUSS_STATUS = [
    { code: 'to-organize', name: '待组织', cls: 'gray' },
    { code: 'in-progress', name: '进行中', cls: 'blue' },
    { code: 'to-sign', name: '待签名', cls: 'orange' },
    { code: 'archived', name: '已完成', cls: 'green' }
  ];

  var REPORT_STATUS = [
    { code: 'to-fill', name: '待填写', cls: 'gray' },
    { code: 'level-1', name: '待一级审核', cls: 'blue' },
    { code: 'level-2', name: '待二级审核', cls: 'blue' },
    { code: 'level-3', name: '待三级审核', cls: 'blue' },
    { code: 'returned', name: '已退回', cls: 'orange' },
    { code: 'done', name: '已完成', cls: 'green' }
  ];

  var IMPROVE_STATUS = [
    { code: 'not-started', name: '未开始', cls: 'gray' },
    { code: 'in-progress', name: '进行中', cls: 'blue' },
    { code: 'to-evaluate', name: '待评估', cls: 'orange' },
    { code: 'done', name: '已完成', cls: 'green' },
    { code: 'cancelled', name: '已取消', cls: 'gray' }
  ];

  // 三色（含正常绿）预警：统一按剩余时间占比，阈值来自「时限规则配置」
  var WARNING = [
    { code: 'normal', name: '正常', cls: 'green', color: '#52C41A' },
    { code: 'yellow', name: '黄色预警', cls: 'yellow', color: '#FAAD14' },
    { code: 'orange', name: '橙色预警', cls: 'orange', color: '#FA8C16' },
    { code: 'red', name: '已超时', cls: 'red', color: '#FF4D4F' }
  ];

  var ATTEND_STATUS = [
    { code: 'accepted', name: '已确认', cls: 'green' },
    { code: 'needs-action', name: '待确认', cls: 'gray' },
    { code: 'declared-leave', name: '已请假', cls: 'blue' },
    { code: 'absent', name: '缺席', cls: 'red' }
  ];

  var RECORD_STATUS = [
    { code: 'none', name: '未填写', cls: 'gray' },
    { code: 'draft', name: '草稿', cls: 'gray' },
    { code: 'to-sign', name: '待签名', cls: 'orange' },
    { code: 'archived', name: '已归档', cls: 'green' }
  ];

  var DOC_TYPES = [
    { code: 'admission', name: '入院记录' },
    { code: 'progress', name: '病程记录' },
    { code: 'surgery', name: '手术记录' },
    { code: 'rescue', name: '抢救记录' },
    { code: 'death', name: '死亡记录' },
    { code: 'exam', name: '检查检验结果' }
  ];

  var AVOIDABLE = [
    { code: 'avoidable', name: '可避免' },
    { code: 'partly', name: '部分可避免' },
    { code: 'unavoidable', name: '不可避免' }
  ];

  var CONCORDANCE = [
    { code: 'match', name: '符合' },
    { code: 'partly', name: '部分符合' },
    { code: 'unmatch', name: '不符合' }
  ];

  var SEVERITY = [
    { code: 'mild', name: '轻度' },
    { code: 'moderate', name: '中度' },
    { code: 'severe', name: '重度' },
    { code: 'critical', name: '极重度' }
  ];

  var NOTIFY_CHANNELS = [
    { code: 'app', name: 'APP 推送' },
    { code: 'site', name: '站内消息' },
    { code: 'sms', name: '短信' },
    { code: 'wechat', name: '微信' }
  ];

  var DATA_SCOPES = [
    { code: 'dept', name: '本科室' },
    { code: 'hospital', name: '全院' },
    { code: 'self', name: '仅本人数据' }
  ];

  /* ───── 工具函数 ───── */
  function byCode(list, code) {
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
    return null;
  }
  function label(list, code, fallback) {
    var x = byCode(list, code);
    return x ? x.name : (fallback === undefined ? (code || '—') : fallback);
  }
  function cls(list, code, fallback) {
    var x = byCode(list, code);
    return x ? x.cls : (fallback || 'gray');
  }

  /* 「系统管理 › 角色权限管理」保存的页面可见性覆盖（Basic-role-permissions.ext.pages）
   * 未配置时回退到模块定义中的默认角色，保证导航可见性与权限配置联动。 */
  function pageRoleOverride() {
    var b = global.FHIR && global.FHIR.view ? global.FHIR.view('Basic', 'Basic-role-permissions') : null;
    return (b && b.ext && b.ext.pages) || null;
  }
  function effectiveRoles(page) {
    var map = pageRoleOverride();
    if (map && map[page.route]) return map[page.route];
    return page.roles;
  }

  function findPage(route) {
    for (var i = 0; i < MODULES.length; i++) {
      for (var j = 0; j < MODULES[i].pages.length; j++) {
        if (MODULES[i].pages[j].route === route) return { module: MODULES[i], page: MODULES[i].pages[j] };
      }
    }
    return null;
  }

  var Domain = {
    NAV_ROLES: NAV_ROLES, SCENES: SCENES, DEMO_USERS: DEMO_USERS, MODULES: MODULES,
    DEATH_TYPES: DEATH_TYPES, PRIORITIES: PRIORITIES, DISCUSS_STATUS: DISCUSS_STATUS,
    REPORT_STATUS: REPORT_STATUS, IMPROVE_STATUS: IMPROVE_STATUS, WARNING: WARNING,
    ATTEND_STATUS: ATTEND_STATUS, RECORD_STATUS: RECORD_STATUS, DOC_TYPES: DOC_TYPES,
    AVOIDABLE: AVOIDABLE, CONCORDANCE: CONCORDANCE, SEVERITY: SEVERITY,
    NOTIFY_CHANNELS: NOTIFY_CHANNELS, DATA_SCOPES: DATA_SCOPES,

    deathTypeName: function (c) { return label(DEATH_TYPES, c, '—'); },
    deathTypeCls: function (c) { return cls(DEATH_TYPES, c); },
    deathTypeColor: function (c) { var t = byCode(DEATH_TYPES, c); return t ? t.color : '#8C8C8C'; },
    priorityName: function (c) { return label(PRIORITIES, c, '—'); },
    priorityCls: function (c) { return cls(PRIORITIES, c); },
    discussStatusName: function (c) { return label(DISCUSS_STATUS, c, '—'); },
    discussStatusCls: function (c) { return cls(DISCUSS_STATUS, c); },
    reportStatusName: function (c) { return label(REPORT_STATUS, c, '—'); },
    reportStatusCls: function (c) { return cls(REPORT_STATUS, c); },
    improveStatusName: function (c) { return label(IMPROVE_STATUS, c, '—'); },
    improveStatusCls: function (c) { return cls(IMPROVE_STATUS, c); },
    warningName: function (c) { return label(WARNING, c, '—'); },
    warningCls: function (c) { return cls(WARNING, c); },
    attendStatusName: function (c) { return label(ATTEND_STATUS, c, '—'); },
    attendStatusCls: function (c) { return cls(ATTEND_STATUS, c); },
    recordStatusName: function (c) { return label(RECORD_STATUS, c, '—'); },
    docTypeName: function (c) { return label(DOC_TYPES, c, c); },
    avoidableName: function (c) { return label(AVOIDABLE, c, '—'); },
    concordanceName: function (c) { return label(CONCORDANCE, c, '—'); },
    severityName: function (c) { return label(SEVERITY, c, '—'); },
    sceneName: function (c) { return label(SCENES, c, c); },
    navRoleName: function (c) { return label(NAV_ROLES, c, c); },
    dataScopeName: function (c) { return label(DATA_SCOPES, c, c); },
    byCode: byCode,

    user: function (id) { if (!id) return null; for (var i = 0; i < DEMO_USERS.length; i++) if (DEMO_USERS[i].id === id) return DEMO_USERS[i]; return null; },
    // 某科室对应的「科主任演示账号」：心血管内科=u-director，呼吸内科=u-director2，其余科室无演示账号
    deptDirectorUser: function (deptIdx) { return deptIdx === 2 ? 'u-director2' : 'u-director'; },
    userOf: function (scene, deptIdx) {
      for (var i = 0; i < DEMO_USERS.length; i++) {
        var u = DEMO_USERS[i];
        if (u.scene !== scene) continue;
        if (scene === 'director' && deptIdx) { if ((u.dept === '心血管内科' && deptIdx === 1) || (u.dept === '呼吸内科' && deptIdx === 2)) return u; }
        else return u;
      }
      return null;
    },
    navRole: function (id) { var u = this.user(id); return u ? u.navRole : 'clinician'; },
    scene: function (id) { var u = this.user(id); return u ? u.scene : 'doctor'; },
    isScene: function (id, scene) {
      var u = this.user(id);
      if (!u) return false;
      return String(scene).split('|').indexOf(u.scene) >= 0;
    },

    // 角色可见模块（模块下至少一个可见页面）
    visibleModules: function (navRole) {
      return MODULES.filter(function (m) {
        return m.pages.some(function (p) { return !p.hidden && effectiveRoles(p).indexOf(navRole) >= 0; });
      });
    },
    pageByRoute: findPage,
    moduleOf: function (route) { var pr = findPage(route); return pr ? pr.module : null; },
    pageName: function (route) { var pr = findPage(route); return pr ? pr.page.name : route; },
    pageRoles: function (route) { var pr = findPage(route); return pr ? effectiveRoles(pr.page) : []; },
    canAccess: function (navRole, route) {
      if (route === 'home') return true;
      var pr = findPage(route);
      return pr ? effectiveRoles(pr.page).indexOf(navRole) >= 0 : false;
    },
    // 面包屑（IA-3.1：L1 与 L2 列表页不显示面包屑）
    crumbs: function (route, ctx) {
      var pr = findPage(route);
      if (!pr || (!pr.page.sideMenu && pr.page.code === pr.module.code)) return [];
      var out = [];
      if (route === 'discuss-detail') out = [{ name: '讨论管理', route: 'discuss-list' }, { name: '讨论任务详情' }];
      else if (route === 'discuss-record') out = [{ name: '讨论管理', route: 'discuss-list' }, { name: '讨论任务详情', route: 'discuss-detail' }, { name: '讨论记录书写与签名' }];
      else if (route === 'report-form') out = [{ name: '上报管理', route: 'report-list' }, { name: '上报单填写与审核' }];
      else if (route === 'improve-detail') out = [{ name: '改进跟踪', route: 'improve-list' }, { name: '改进任务详情' }];
      else if (pr) out = [{ name: pr.module.name, route: pr.module.route }, { name: pr.page.name }];
      return out;
    },
    // 侧栏二级菜单（统计分析 / 系统管理）
    sideMenu: function (route) {
      var m = Domain.moduleOf(route);
      if (!m || !m.sideMenu) return null;
      return { module: m, pages: m.pages.filter(function (p) { return !p.hidden; }) };
    }
  };

  global.Domain = Domain;
})(typeof window !== 'undefined' ? window : globalThis);
