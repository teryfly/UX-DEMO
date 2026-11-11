/* ============================================================
   fhir.js — 基于 FHIR R4 的本地数据层（localStorage 模拟服务端）
   ------------------------------------------------------------
   将每类 FHIR 资源按 resourceType 存为集合，提供 CRUD + search。
   所有写操作自动落 Provenance（操作日志），满足“全流程可追溯”。
   ============================================================ */
(function (App) {
  "use strict";
  const KEY = "hdc_fhir_store_v1";       // FHIR 资源库
  const CFG = "hdc_app_config_v1";       // 业务规则/接口等应用配置（非 FHIR）

  // FHIR 资源容器：{ Patient: {id: resource}, Task: {...}, ... }
  let db = null;
  let cfg = null;

  function load() {
    if (db) return db;
    try { db = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { db = null; }
    return db;
  }
  function persist() { localStorage.setItem(KEY, JSON.stringify(db)); }
  function loadCfg() {
    if (cfg) return cfg;
    try { cfg = JSON.parse(localStorage.getItem(CFG)) || null; } catch (e) { cfg = null; }
    return cfg;
  }
  function persistCfg() { localStorage.setItem(CFG, JSON.stringify(cfg)); }

  function ensure(type) { if (!db[type]) db[type] = {}; return db[type]; }

  /* ---------- 基础 CRUD ---------- */
  // create：写入资源（含 meta.lastUpdated），返回资源
  function create(resource, opts) {
    load();
    const type = resource.resourceType;
    if (!type) throw new Error("resource 缺少 resourceType");
    if (!resource.id) resource.id = App.util.uid(type.toLowerCase());
    resource.meta = resource.meta || {};
    resource.meta.lastUpdated = App.date.isoNow();
    ensure(type)[resource.id] = resource;
    persist();
    if (!opts || opts.audit !== false) provenance("create", type, resource.id, opts && opts.note);
    return resource;
  }
  function read(type, id) { load(); return (db[type] && db[type][id]) || null; }
  // update：整体替换或合并补丁
  function update(type, id, patch, opts) {
    load();
    const cur = read(type, id);
    if (!cur) return null;
    const next = typeof patch === "function" ? patch(cur) : Object.assign({}, cur, patch);
    next.resourceType = type;
    next.id = id;
    next.meta = next.meta || {};
    next.meta.lastUpdated = App.date.isoNow();
    db[type][id] = next;
    persist();
    if (!opts || opts.audit !== false) provenance("update", type, id, opts && opts.note);
    return next;
  }
  function remove(type, id, opts) {
    load();
    if (db[type] && db[type][id]) {
      delete db[type][id];
      persist();
      if (!opts || opts.audit !== false) provenance("delete", type, id, opts && opts.note);
      return true;
    }
    return false;
  }
  // search：返回数组，可传 predicate 过滤
  function search(type, predicate) {
    load();
    const coll = db[type] ? Object.values(db[type]) : [];
    return predicate ? coll.filter(predicate) : coll.slice();
  }
  function all(type) { return search(type); }

  /* ---------- Provenance（FHIR 操作溯源 / 操作日志） ---------- */
  function provenance(action, targetType, targetId, note) {
    load();
    const user = App.auth && App.auth.current ? App.auth.current() : null;
    const rec = {
      resourceType: "Provenance",
      id: App.util.uid("prov"),
      recorded: App.date.isoNow(),
      activity: { coding: [{ code: action }] },
      target: [{ reference: targetType + "/" + targetId }],
      agent: [{ who: user ? { reference: "Practitioner/" + user.id, display: user.name } : { display: "系统" } }],
      note: note ? [{ text: note }] : undefined,
    };
    ensure("Provenance")[rec.id] = rec;
    persist();
    return rec;
  }
  // 业务操作日志（更贴近“操作人/操作时间/操作内容”展示）
  function logOp(opts) {
    load();
    const user = App.auth && App.auth.current ? App.auth.current() : null;
    const rec = {
      resourceType: "AuditEvent",
      id: App.util.uid("audit"),
      recorded: App.date.isoNow(),
      action: opts.action || "C",
      type: opts.opType || "操作",
      who: opts.who || (user ? user.name : "系统"),
      what: opts.what || "",                 // 操作内容
      about: opts.about || null,             // 关联资源引用，例如 Task/xxx
      tags: opts.tags || [],
    };
    ensure("AuditEvent")[rec.id] = rec;
    persist();
    return rec;
  }
  function opsFor(reference, extraPred) {
    return search("AuditEvent", (a) => a.about === reference && (!extraPred || extraPred(a)))
      .sort((a, b) => new Date(a.recorded) - new Date(b.recorded));
  }

  /* ---------- 应用配置（业务规则 / 接口 / 通知 等） ---------- */
  const config = {
    get(key) { loadCfg(); return cfg ? cfg[key] : undefined; },
    set(key, val) { loadCfg(); cfg[key] = val; persistCfg(); return val; },
    all() { return loadCfg(); },
    _init(obj) { cfg = obj; persistCfg(); },
  };

  /* ---------- 初始化 / 重置 ---------- */
  function isSeeded() { return !!localStorage.getItem(KEY); }
  function initEmpty() { db = {}; cfg = {}; persist(); persistCfg(); }
  function reset() {
    localStorage.removeItem(KEY);
    localStorage.removeItem(CFG);
    db = null; cfg = null;
  }
  function _setDb(obj) { db = obj; persist(); }
  // 合并写入：按资源类型逐个合并集合，而不是整体替换。
  // seed.js 在生成基础数据时会先用 F.create/F.logOp 写入 Provenance/AuditEvent（操作溯源），
  // 随后再批量写入其余业务资源；若用 _setDb 整体替换，会把已生成的操作日志覆盖清空，
  // 导致"查看完整日志"等界面查不到任何记录。这里改为合并，保留两边已写入的数据。
  function _mergeDb(obj) {
    load();
    Object.keys(obj).forEach((type) => { db[type] = Object.assign({}, db[type] || {}, obj[type]); });
    persist();
  }

  App.fhir = {
    create, read, update, remove, search, all,
    provenance, logOp, opsFor,
    config, isSeeded, initEmpty, reset, _setDb, _mergeDb,
    _raw() { return load(); },
  };
})(window.App);
