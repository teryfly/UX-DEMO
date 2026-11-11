/* ============================================================
 * fhir.js — 浏览器内置 Mock FHIR Server
 *  · 以 FHIR R4 资源（resourceType/id/meta…）为存储单元
 *  · 提供 REST 风格 CRUD + search
 *  · localStorage 持久化，演示重置可用 FHIR.reset()
 *  · 每次操作写入「FHIR 控制台」并通过订阅通知页面刷新
 * 全局：window.FHIR
 * ============================================================ */
(function () {
  const STORAGE_KEY = 'ux_jjb_fhir_store_v1';
  const BASE = '/fhir';

  const FHIR = {
    db: {},            // { ResourceType: { id: resource } }
    _subs: [],
    _console: [],
    _ver: {},          // resourceType/id -> versionId
  };

  /* ---------- 控制台日志 ---------- */
  function logReq(method, url, note) {
    const entry = { method, url, note, t: U.fmtClock(new Date()) };
    FHIR._console.unshift(entry);
    if (FHIR._console.length > 200) FHIR._console.pop();
    renderConsole();
  }
  function renderConsole() {
    const body = U.$('#fc-body'), count = U.$('#fc-count');
    if (!body) return;
    count.textContent = FHIR._console.length;
    body.innerHTML = FHIR._console.slice(0, 60).map(e =>
      `<div class="fc-line"><span class="m ${e.method}">${e.method}</span>` +
      `<span class="url">${U.esc(e.url)}${e.note ? ' · ' + U.esc(e.note) : ''}</span>` +
      `<span class="t">${e.t}</span></div>`).join('');
  }
  FHIR.renderConsole = renderConsole;

  /* ---------- 持久化 ---------- */
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ db: FHIR.db, ver: FHIR._ver })); }
    catch (e) { /* 演示环境忽略配额错误 */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { const o = JSON.parse(raw); FHIR.db = o.db || {}; FHIR._ver = o.ver || {}; return true; }
    } catch (e) { }
    return false;
  }

  /* ---------- 订阅（页面刷新） ---------- */
  FHIR.subscribe = (fn) => { FHIR._subs.push(fn); return () => { FHIR._subs = FHIR._subs.filter(f => f !== fn); }; };
  function notify(type) { FHIR._subs.forEach(fn => { try { fn(type); } catch (e) { console.error(e); } }); }

  /* ---------- 内部工具 ---------- */
  function stamp(res) {
    const key = `${res.resourceType}/${res.id}`;
    const v = (FHIR._ver[key] || 0) + 1;
    FHIR._ver[key] = v;
    res.meta = Object.assign({}, res.meta, { versionId: String(v), lastUpdated: new Date().toISOString() });
    return res;
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  /* ---------- CRUD ---------- */
  // create: POST /[type]
  FHIR.create = (resource, opt = {}) => {
    const type = resource.resourceType;
    if (!type) throw new Error('resourceType 必填');
    if (!resource.id) resource.id = U.uid(type.toLowerCase());
    if (!FHIR.db[type]) FHIR.db[type] = {};
    stamp(resource);
    FHIR.db[type][resource.id] = clone(resource);
    if (!opt.silent) { logReq('POST', `${BASE}/${type}`, resource.id); persist(); notify(type); }
    return clone(resource);
  };

  // read: GET /[type]/[id]
  FHIR.read = (type, id, opt = {}) => {
    if (!opt.silent) logReq('GET', `${BASE}/${type}/${id}`);
    const r = FHIR.db[type] && FHIR.db[type][id];
    return r ? clone(r) : null;
  };

  // update: PUT /[type]/[id]
  FHIR.update = (resource, opt = {}) => {
    const type = resource.resourceType;
    if (!FHIR.db[type] || !FHIR.db[type][resource.id]) return FHIR.create(resource, opt);
    stamp(resource);
    FHIR.db[type][resource.id] = clone(resource);
    if (!opt.silent) { logReq('PUT', `${BASE}/${type}/${resource.id}`, 'v' + resource.meta.versionId); persist(); notify(type); }
    return clone(resource);
  };

  // patch 局部更新
  FHIR.patch = (type, id, changes, opt = {}) => {
    const cur = FHIR.db[type] && FHIR.db[type][id];
    if (!cur) return null;
    const next = Object.assign(clone(cur), changes);
    return FHIR.update(next, opt);
  };

  // delete: DELETE /[type]/[id]
  FHIR.remove = (type, id, opt = {}) => {
    if (FHIR.db[type]) delete FHIR.db[type][id];
    if (!opt.silent) { logReq('DELETE', `${BASE}/${type}/${id}`); persist(); notify(type); }
    return true;
  };

  // search: GET /[type]?a=b&...  —— predicate 为函数过滤；params 仅用于日志展示
  FHIR.search = (type, predicate, params, opt = {}) => {
    const all = Object.values(FHIR.db[type] || {});
    const out = predicate ? all.filter(predicate) : all;
    if (!opt.silent) {
      const q = params ? '?' + Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&') : '';
      logReq('GET', `${BASE}/${type}${q}`, `${out.length} 条`);
    }
    return clone(out);
  };

  // 值班排班 Slot 的资源 id 规则：科室 + 日期 + 班次唯一确定一个班次席位
  // （早期版本仅用日期+班次，跨科室会互相覆盖——同一天同名班次在不同科室是两条独立记录）
  FHIR.slotId = (orgId, date, shift) => `slot-${orgId}-${date}-${shift}`;

  // 引用助手
  FHIR.ref = (resource) => ({ reference: `${resource.resourceType}/${resource.id}`, display: FHIR.displayOf(resource) });
  FHIR.refStr = (type, id) => ({ reference: `${type}/${id}` });
  FHIR.resolve = (reference, opt = { silent: true }) => {
    if (!reference) return null;
    const ref = typeof reference === 'string' ? reference : reference.reference;
    if (!ref) return null;
    const [type, id] = ref.split('/');
    return FHIR.read(type, id, opt);
  };
  FHIR.displayOf = (res) => {
    if (!res) return '';
    if (res.resourceType === 'Practitioner' || res.resourceType === 'Patient') {
      const n = res.name && res.name[0];
      return n ? (n.text || ((n.family || '') + (n.given ? n.given.join('') : ''))) : res.id;
    }
    if (res.resourceType === 'Organization') return res.name;
    return res.id;
  };

  /* ---------- 计数/统计辅助 ---------- */
  FHIR.count = (type, predicate) => FHIR.search(type, predicate, null, { silent: true }).length;
  FHIR.all = (type) => FHIR.search(type, null, null, { silent: true });

  /* ---------- 初始化 / 重置 ---------- */
  FHIR.reset = (silent) => {
    FHIR.db = {}; FHIR._ver = {};
    if (window.SEED) window.SEED.build(FHIR);
    persist();
    if (!silent) { U.toast('演示数据已重置为初始基础数据', 'success'); notify('*'); }
  };

  FHIR.init = () => {
    const had = load();
    if (!had || !FHIR.db.Practitioner) {
      if (window.SEED) window.SEED.build(FHIR);
      persist();
      logReq('POST', `${BASE}/Bundle`, '初始化 FHIR 基础数据');
    } else {
      logReq('GET', `${BASE}/metadata`, '已从缓存加载 FHIR 数据');
    }
  };

  window.FHIR = FHIR;
})();
