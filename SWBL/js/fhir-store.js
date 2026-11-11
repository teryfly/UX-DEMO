/* =====================================================================
 * fhir-store.js —— 轻量级 FHIR 内存资源库（模拟 FHIR REST 服务）
 * ---------------------------------------------------------------------
 * 提供类 FHIR RESTful 的 CRUD 接口（create / read / update / patch /
 * delete / search / bundle），所有业务数据保存在浏览器内存（缓存）中，
 * 遵循 FHIR R4 资源模型（Patient / Encounter / Practitioner /
 * PractitionerRole / Organization / Condition / Procedure / Observation /
 * DocumentReference / Task / Appointment / Questionnaire /
 * QuestionnaireResponse / Composition / PlanDefinition / Measure /
 * MeasureReport / Communication / Provenance / Basic / CodeSystem /
 * ValueSet / StructureDefinition 等）。
 *
 * 每次读写都会记入请求日志（log），供「⚡ FHIR 控制台」实时展示，
 * 证明前端走的确实是标准 FHIR 接口而非私有数据结构。
 *
 * 本库不依赖任何框架，挂载到 window.FHIR。
 * ===================================================================== */
(function (global) {
  'use strict';

  function nowISO() { return new Date().toISOString(); }

  function deepClone(obj) {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj));
  }

  var db = {};        // resourceType -> { id -> resource }
  var counters = {};  // resourceType -> number
  var listeners = []; // 变更订阅者（用于 UI 响应式刷新）
  var viewCache = {}; // FHIR.view 只读缓存，任何写操作整体失效
  var requestLog = [];// FHIR 请求日志（演示可见性）
  var LOG_MAX = 400;

  function log(method, url, note) {
    requestLog.push({ method: method, url: url, at: nowISO(), note: note || '' });
    if (requestLog.length > LOG_MAX) requestLog.shift();
  }

  function ensure(type) {
    if (!db[type]) db[type] = {};
    return db[type];
  }

  // 写入前：将友好的 ext 投影编码为标准 FHIR extension/modifierExtension，
  // 并从资源上移除非标准的 ext 字段，使内部存储为纯 FHIR 资源。
  function toCanonical(resource) {
    var r = deepClone(resource);
    var ext = r.ext; delete r.ext;
    delete r.extension; delete r.modifierExtension;
    if (global.FHIRExt && ext) {
      var enc = global.FHIRExt.encode(r.resourceType, ext);
      if (enc.extension.length) r.extension = enc.extension;
      if (enc.modifierExtension.length) r.modifierExtension = enc.modifierExtension;
    }
    return r;
  }

  // 读取时：在纯 FHIR 资源上解码出友好的 ext 投影，便于上层使用。
  function materialize(canonical) {
    if (!canonical) return canonical;
    var r = deepClone(canonical);
    if (global.FHIRExt) r.ext = global.FHIRExt.decode(r.resourceType, r);
    return r;
  }

  function nextId(type) {
    counters[type] = (counters[type] || 0) + 1;
    return type + '-' + String(counters[type]).padStart(4, '0');
  }

  function emit(evt) {
    viewCache = {};
    listeners.forEach(function (fn) {
      try { fn(evt); } catch (e) { console.error('FHIR listener error', e); }
    });
  }

  var FHIR = {
    /* 订阅资源变更，返回取消订阅函数 */
    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },

    /* 请求日志（FHIR 控制台） */
    requests: function () { return requestLog.slice().reverse(); },
    clearRequests: function () { requestLog = []; },

    /* 直接植入资源（带 id），用于种子数据初始化，不触发事件 */
    seed: function (resource) {
      var type = resource.resourceType;
      ensure(type);
      if (!resource.id) resource.id = nextId(type);
      var m = /-(\d+)$/.exec(resource.id);
      if (m) counters[type] = Math.max(counters[type] || 0, parseInt(m[1], 10));
      var canonical = toCanonical(resource);
      canonical.meta = resource.meta || {};
      canonical.meta.versionId = canonical.meta.versionId || '1';
      canonical.meta.lastUpdated = canonical.meta.lastUpdated || nowISO();
      db[type][canonical.id] = canonical;
      viewCache = {};
      log('POST', '/fhir/' + type, 'seed');
      return materialize(canonical);
    },

    /* FHIR: create —— POST [base]/{type} */
    create: function (resource) {
      var type = resource.resourceType;
      if (!type) throw new Error('resourceType 缺失');
      ensure(type);
      if (!resource.id) resource.id = nextId(type);
      var canonical = toCanonical(resource);
      canonical.meta = { versionId: '1', lastUpdated: nowISO() };
      db[type][canonical.id] = canonical;
      log('POST', '/fhir/' + type, canonical.id);
      emit({ action: 'create', resourceType: type, id: canonical.id, resource: deepClone(canonical) });
      return materialize(canonical);
    },

    /* FHIR: read —— GET [base]/{type}/{id}（返回带 ext 投影的资源） */
    read: function (type, id) {
      log('GET', '/fhir/' + type + '/' + id);
      return db[type] && db[type][id] ? materialize(db[type][id]) : undefined;
    },

    /* 存在性判断（不记日志，供内部高频调用） */
    exists: function (type, id) { return !!(db[type] && db[type][id]); },

    /* 内部视图：解码 ext、按写操作失效的只读缓存，不记日志。
     * 供配置/规则等高频读取路径使用（Limit.config、Classify.rules 等）。
     * 注意：返回对象为共享缓存，调用方不得修改。 */
    view: function (type, id) {
      var key = type + '/' + id;
      if (viewCache[key]) return viewCache[key];
      var c = db[type] && db[type][id];
      if (!c) return undefined;
      var m = materialize(c);
      viewCache[key] = m;
      return m;
    },
    decode: function (canonical) { return materialize(canonical); },

    /* 读取纯 FHIR 资源（不含 ext 投影）—— 供 FHIR 资源查看器展示规范化形态 */
    canonical: function (type, id) {
      log('GET', '/fhir/' + type + '/' + id, '?_format=canonical');
      return db[type] && db[type][id] ? deepClone(db[type][id]) : undefined;
    },
    canonicalAll: function (type) {
      return db[type] ? Object.keys(db[type]).map(function (k) { return deepClone(db[type][k]); }) : [];
    },
    types: function () { return Object.keys(db).sort(); },
    stats: function () {
      var out = {};
      Object.keys(db).forEach(function (t) { out[t] = Object.keys(db[t]).length; });
      return out;
    },

    /* FHIR: update —— PUT [base]/{type}/{id} */
    update: function (resource) {
      var type = resource.resourceType, id = resource.id;
      if (!type || !id) throw new Error('update 需要 resourceType 与 id');
      ensure(type);
      var prev = db[type][id];
      var ver = prev && prev.meta ? String(parseInt(prev.meta.versionId || '1', 10) + 1) : '1';
      var canonical = toCanonical(resource);
      canonical.meta = { versionId: ver, lastUpdated: nowISO() };
      db[type][id] = canonical;
      log('PUT', '/fhir/' + type + '/' + id, 'v' + ver);
      emit({ action: 'update', resourceType: type, id: id, resource: deepClone(canonical) });
      return materialize(canonical);
    },

    /* FHIR: patch —— 局部更新（合并字段） */
    patch: function (type, id, partial) {
      var cur = this.read(type, id);
      if (!cur) throw new Error('资源不存在: ' + type + '/' + id);
      Object.assign(cur, partial);
      return this.update(cur);
    },

    /* FHIR: delete —— DELETE [base]/{type}/{id} */
    remove: function (type, id) {
      if (db[type] && db[type][id]) {
        var res = db[type][id];
        delete db[type][id];
        log('DELETE', '/fhir/' + type + '/' + id);
        emit({ action: 'delete', resourceType: type, id: id, resource: deepClone(res) });
        return true;
      }
      log('DELETE', '/fhir/' + type + '/' + id, '404');
      return false;
    },

    /* FHIR: search —— GET [base]/{type}?...
     * predicate 为可选过滤函数 (resource) => boolean，返回资源数组（已克隆+解码） */
    search: function (type, predicate) {
      log('GET', '/fhir/' + type + '/_search');
      var coll = db[type] ? Object.keys(db[type]).map(function (k) { return materialize(db[type][k]); }) : [];
      if (predicate) coll = coll.filter(predicate);
      return coll;
    },

    /* 高性能扫描：不克隆、不解码，直接以规范化资源做聚合。
     * 供统计分析类接口在数千资源量级下使用（predicate 收到的是 canonical 资源）。 */
    scan: function (type, mapper) {
      var coll = db[type] ? Object.keys(db[type]).map(function (k) { return db[type][k]; }) : [];
      return mapper ? coll.map(mapper) : coll;
    },

    /* 单条 canonical 快速读取（不克隆），聚合场景使用 */
    raw: function (type, id) { return db[type] && db[type][id]; },

    /* 返回某类型资源数量 */
    count: function (type, predicate) {
      return this.search(type, predicate).length;
    },

    /* 以 Bundle 形式返回（贴近 FHIR searchset 语义） */
    bundle: function (type, predicate) {
      var entries = this.search(type, predicate);
      return {
        resourceType: 'Bundle',
        type: 'searchset',
        total: entries.length,
        entry: entries.map(function (r) {
          return { fullUrl: type + '/' + r.id, resource: r };
        })
      };
    },

    /* 事务：Batch Bundle（演示「归档」这类一次写多资源的场景） */
    transaction: function (entries) {
      var out = [];
      (entries || []).forEach(function (e) {
        out.push(e.resource ? FHIR.create(e.resource) : null);
      });
      log('POST', '/fhir', 'transaction (' + out.length + ' resources)');
      return {
        resourceType: 'Bundle', type: 'batch-response', total: out.length,
        entry: out.filter(Boolean).map(function (r) {
          return { resource: r, outcome: { resourceType: 'OperationOutcome', issue: [{ severity: 'success', code: 'created' }] } };
        })
      };
    },

    /* 调试用：导出/清空全部数据 */
    dump: function () { return deepClone(db); },
    reset: function () { db = {}; counters = {}; requestLog = []; viewCache = {}; }
  };

  global.FHIR = FHIR;
})(typeof window !== 'undefined' ? window : globalThis);
