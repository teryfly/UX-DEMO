/* ============================================================
   auth.js — 角色、当前登录用户、权限与导航可见性
   ------------------------------------------------------------
   演示核心：通过顶部“演示角色”切换器切换登录身份，
   不同角色看到不同导航/页面/数据，从而走通完整跨角色流程。
   ============================================================ */
(function (App) {
  "use strict";
  const STORE_KEY = "hdc_current_role";

  // 五种角色 + 对应的默认演示账号（Practitioner.id）
  const ROLES = {
    attending: { key: "attending", label: "主管医生", userId: "prac-zmh", icon: "🩺",
      desc: "负责在管患者诊疗，跟进疑难病例讨论任务、执行最终诊疗调整方案" },
    director: { key: "director", label: "科室主任", userId: "prac-ljg", icon: "🧑‍⚕️",
      desc: "接收讨论通知，在线发起讨论、安排会议、邀请人员并统筹组织病例讨论，跟踪诊疗任务进度" },
    expert: { key: "expert", label: "会诊专家", userId: "prac-ww", icon: "👨‍⚕️",
      desc: "查阅病历、参与研讨、填写意见、电子签名" },
    qa: { key: "qa", label: "医疗质量管理部门", userId: "prac-lj", icon: "📊",
      desc: "查看统计报表、监督全流程执行与制度落实" },
    admin: { key: "admin", label: "系统管理员", userId: "prac-zq", icon: "⚙️",
      desc: "维护系统规则、接口、权限与后台数据" },
  };

  // 角色 → 可访问 L2 模块（IA-3.3 角色权限与导航可见性）
  // expertPartial：会诊专家在“讨论组织及跟踪管理”下仅可访问讨论会议列表与研讨记录页
  const MODULE = {
    workbench: { key: "workbench", label: "个人工作台", route: "workbench", icon: "📋" },
    discussion: { key: "discussion", label: "讨论组织及跟踪管理", route: "discussion", icon: "📅" },
    reports: { key: "reports", label: "质量监控报表", route: "reports", icon: "📊" },
    admin: { key: "admin", label: "系统配置管理", route: "admin", icon: "⚙️" },
  };
  const ROLE_MODULES = {
    attending: ["workbench"],
    director: ["discussion", "reports"],
    expert: ["discussion"],            // 仅讨论模块（部分）
    qa: ["reports"],
    admin: ["admin"],
  };

  let currentRoleKey = localStorage.getItem(STORE_KEY) || "attending";
  const listeners = [];

  function currentRole() { return ROLES[currentRoleKey]; }
  function current() {
    const r = currentRole();
    const p = App.fhir.read("Practitioner", r.userId);
    const dept = p ? (ext(p, "dept") || "") : "";
    const title = p && p.qualification && p.qualification[0] ? p.qualification[0].code.text : "";
    return { id: r.userId, name: p ? p.name[0].text : r.label, roleKey: r.key, roleLabel: r.label, dept, title, icon: r.icon };
  }
  function ext(res, url) {
    if (!res.extension) return null;
    const e = res.extension.find((x) => x.url === url);
    return e ? (e.valueString || e.valueInteger) : null;
  }

  function setRole(key) {
    if (!ROLES[key]) return;
    currentRoleKey = key;
    localStorage.setItem(STORE_KEY, key);
    listeners.forEach((fn) => fn(key));
  }
  function onChange(fn) { listeners.push(fn); }

  // 当前演示角色对应的账号在「权限配置」里的记录（用户名/模块访问矩阵/启用状态）
  function permEntry(roleKey) {
    const r = ROLES[roleKey || currentRoleKey];
    if (!r || !App.fhir) return null;
    const perms = App.fhir.config.get("permissions") || [];
    return perms.find((p) => p.userId === r.userId) || null;
  }
  // 导航可见模块：以「权限配置」里该账号的模块访问矩阵为准（"可访问"列），
  // 而不是写死的角色表——这样权限配置页里勾掉某个模块后，导航才会真正跟着变化。
  function modulesFor(roleKey) {
    roleKey = roleKey || currentRoleKey;
    const entry = permEntry(roleKey);
    if (entry && entry.matrix) {
      return Object.keys(MODULE)
        .map((k) => MODULE[k])
        .filter((m) => entry.matrix[m.label] && entry.matrix[m.label][3]);
    }
    return (ROLE_MODULES[roleKey] || []).map((m) => MODULE[m]);
  }
  function canAccess(moduleKey, roleKey) {
    return modulesFor(roleKey).some((m) => m.key === moduleKey);
  }
  // 账号是否被系统管理员停用（权限配置列表「启用/停用」）
  function isEnabled(userId) {
    if (!App.fhir) return true;
    const perms = App.fhir.config.get("permissions") || [];
    const entry = perms.find((p) => p.userId === userId);
    return entry ? !!entry.enabled : true;
  }
  // 会诊专家是否仅有“部分”讨论模块权限（不可创建/编辑会议，仅查看与研讨）
  function isExpertReadonly(roleKey) {
    return (roleKey || currentRoleKey) === "expert";
  }
  function roleList() { return Object.values(ROLES); }

  App.auth = {
    ROLES, MODULE, current, currentRole, setRole, onChange,
    modulesFor, canAccess, isExpertReadonly, isEnabled, roleList,
    currentRoleKey: () => currentRoleKey,
    ext,
  };
})(window.App);
