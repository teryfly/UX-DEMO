/* =====================================================================
 * limits.js —— 时限与自动分类引擎（全局单一真源）
 * ---------------------------------------------------------------------
 * 讨论时限 / 上报时限 / 三色预警阈值 / 改进任务提醒 / 审核超时时限全部来自
 * 「系统管理 → 时限规则配置」(Basic-timeout-config)，任何页面与服务都不得
 * 硬编码天数与阈值（IX-1.6：时限来源全局由 WF-L3-5-2 控制）。
 *
 * Task.dueDate 仅作为缓存：读取时比对 deadlineSig（配置版本 + 死亡类型），
 * 不一致即按当前规则重算 —— 因此修改时限规则保存的瞬间，全部倒计时、
 * 三色预警、达标率、超时清单同步翻面。
 *
 * 死亡类型自动分类（US-1.1 AC2/AC6）与优先级派生同样数据驱动，规则表来自
 * 「系统管理 → 基础数据管理」(Basic-death-classify-rules)。
 * ===================================================================== */
(function (global) {
  'use strict';

  var DAY = 86400000, HOUR = 3600000, MIN = 60000;
  var CONFIG_ID = 'Basic-timeout-config';
  var RULES_ID = 'Basic-death-classify-rules';
  var DEFAULTS = {
    discussionDays: { expected: 7, unexpected: 3, special: 1, pending: 7 },
    reportDays: { expected: 7, unexpected: 2, special: 1 },
    warnYellowPct: 50,
    warnOrangePct: 20,
    improveRemindDays: 3,
    improveEscalate: true,
    reviewHours: { 1: 48, 2: 48, 3: 24 },
    priorityByType: { special: 'high', unexpected: 'high', pending: 'medium', expected: 'normal' }
  };

  var cache = { sig: null, cfg: null };

  function parse(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  function iso(ms) { return new Date(ms).toISOString(); }
  function fmt(ms, pattern) {
    var d = new Date(ms);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return pattern
      .replace('YYYY', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('DD', p(d.getDate()))
      .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes()));
  }
  function dt(ms) { return ms == null ? '——' : fmt(ms, 'YYYY-MM-DD HH:mm'); }
  function donly(ms) { return ms == null ? '——' : fmt(ms, 'YYYY-MM-DD'); }
  function mdhm(ms) { return ms == null ? '——' : fmt(ms, 'MM-DD HH:mm'); }

  /* 合并默认值，保证配置缺项时行为可预期 */
  function merge(base, over) {
    var out = {};
    Object.keys(base).forEach(function (k) {
      var b = base[k], o = over ? over[k] : undefined;
      out[k] = (b && typeof b === 'object' && !Array.isArray(b))
        ? Object.assign({}, b, (o && typeof o === 'object' && !Array.isArray(o)) ? o : {})
        : (o === undefined ? b : o);
    });
    return Object.assign({}, out, over || {});
  }

  function config() {
    var res = global.FHIR.view('Basic', CONFIG_ID);
    var sig = res && res.meta ? (res.meta.versionId + ':' + res.meta.lastUpdated) : 'default';
    if (cache.sig !== sig) {
      var user = res && res.ext ? res.ext.config : null;
      cache.cfg = merge(DEFAULTS, user || {});
      cache.sig = sig;
    }
    return cache.cfg;
  }
  function invalidate() { cache.sig = null; }

  function discussionDays(deathType) {
    var c = config();
    return c.discussionDays[deathType] != null ? c.discussionDays[deathType] : c.discussionDays.pending;
  }
  function reportDays(deathType) {
    var c = config();
    var k = (deathType === 'pending') ? 'expected' : deathType;
    return c.reportDays[k] != null ? c.reportDays[k] : c.reportDays.expected;
  }

  var Limit = {
    DAY: DAY, HOUR: HOUR, MIN: MIN,
    parse: parse, iso: iso, dt: dt, donly: donly, mdhm: mdhm,
    DEFAULTS: DEFAULTS,
    config: config, invalidate: invalidate,
    setConfig: function (cfg) {
      var cur = global.FHIR.view('Basic', CONFIG_ID);
      global.FHIR.update({
        resourceType: 'Basic', id: CONFIG_ID,
        code: (cur && cur.code) || { coding: [{ system: 'https://fhir.swbl-demo.example/CodeSystem/obs-code', code: 'dx-concordance', display: '时限规则配置' }], text: '时限规则配置' },
        ext: { configKind: 'timeout-config', config: cfg }
      });
      invalidate();
    },

    /* 时限锚点：死亡时间（US-1.1 AC3/AC4；裁决：上报时限同样锚死亡时间） */
    anchorOf: function (c) { return (c && (c.deathTimeMs != null ? c.deathTimeMs : (c.deathMs != null ? c.deathMs : parse(c.deathTime)))) || null; },

    deadlineOf: function (kind, c) {
      var anchor = Limit.anchorOf(c);
      if (anchor == null || !c.deathType) return null;
      var days = kind === 'report' ? reportDays(c.deathType) : discussionDays(c.deathType);
      return anchor + days * DAY;
    },
    totalMsOf: function (kind, c) {
      var days = kind === 'report' ? reportDays(c.deathType) : discussionDays(c.deathType);
      return days * DAY;
    },
    daysOf: function (kind, deathType) {
      return kind === 'report' ? reportDays(deathType) : discussionDays(deathType);
    },

    /* 倒计时：remainingMs 为负即超时 */
    countdownOf: function (kind, c, at) {
      var deadline = Limit.deadlineOf(kind, c);
      if (deadline == null) return { deadline: null, level: 'normal', text: '——', overdue: false, ratio: 1, remainingMs: 0, totalMs: 0 };
      var now = at == null ? Date.now() : at;
      var total = Limit.totalMsOf(kind, c);
      var remaining = deadline - now;
      var ratio = total > 0 ? remaining / total : 0;
      return {
        deadline: deadline, remainingMs: remaining, totalMs: total, ratio: ratio,
        overdue: remaining <= 0, level: Limit.warningLevelOf(ratio, remaining <= 0),
        text: Limit.textOf(remaining), days: total / DAY
      };
    },
    /* 三色预警按剩余时间占比（阈值取配置）；绝对值只用于文字格式 */
    warningLevelOf: function (ratio, overdue) {
      var c = config();
      if (overdue || ratio <= 0) return 'red';
      if (ratio * 100 < c.warnOrangePct) return 'orange';
      if (ratio * 100 < c.warnYellowPct) return 'yellow';
      return 'normal';
    },
    textOf: function (remainingMs) {
      if (remainingMs <= 0) return '已超时';
      var d = Math.floor(remainingMs / DAY);
      var h = Math.floor((remainingMs % DAY) / HOUR);
      var m = Math.floor((remainingMs % HOUR) / MIN);
      if (d > 0) return '剩余 ' + d + 'd ' + h + 'h';
      if (h > 0) return '剩余 ' + h + 'h ' + m + 'm';
      return '剩余 ' + m + 'm';
    },
    shortTextOf: function (remainingMs) {
      if (remainingMs <= 0) return '已超时';
      var d = Math.floor(remainingMs / DAY), h = Math.floor((remainingMs % DAY) / HOUR), m = Math.floor((remainingMs % HOUR) / MIN);
      if (d > 0) return d + 'd ' + h + 'h';
      if (h > 0) return h + 'h ' + m + 'm';
      return m + 'm';
    },

    /* 改进任务时限状态：正常 / 临近截止 / 超时 */
    improveStateOf: function (dueMs, at) {
      if (dueMs == null) return { state: 'normal', text: '——', overdueDays: 0 };
      var now = at == null ? Date.now() : at;
      var c = config();
      if (now > dueMs) {
        return { state: 'overdue', text: '超时 ' + Math.ceil((now - dueMs) / DAY) + ' 天', overdueDays: Math.ceil((now - dueMs) / DAY) };
      }
      if (dueMs - now <= c.improveRemindDays * DAY) {
        return { state: 'soon', text: '剩余 ' + Math.ceil((dueMs - now) / DAY) + ' 天', overdueDays: 0 };
      }
      return { state: 'normal', text: '剩余 ' + Math.ceil((dueMs - now) / DAY) + ' 天', overdueDays: 0 };
    },

    /* 审核节点超时时限（小时），来自时限规则配置 */
    reviewHoursOf: function (level) {
      var c = config();
      return (c.reviewHours && c.reviewHours[level]) || c.reviewHours[3] || 48;
    },
    reviewDeadlineOf: function (assignedAtMs, level) {
      if (assignedAtMs == null) return null;
      return assignedAtMs + Limit.reviewHoursOf(level) * HOUR;
    },

    overdueDays: function (deadlineMs, actualMs) {
      if (deadlineMs == null) return 0;
      var end = actualMs == null ? Date.now() : actualMs;
      return end > deadlineMs ? Math.ceil((end - deadlineMs) / DAY) : 0;
    },
    /* 达标判定（时效分析唯一入口）：实际完成时间 ≤ 应完成时间 */
    achieved: function (kind, c, actualMs) {
      var deadline = Limit.deadlineOf(kind, c);
      if (deadline == null) return null;
      if (actualMs == null) return Date.now() <= deadline ? null : false; // 未完成：进行中或已超时
      return actualMs <= deadline;
    },

    /* dueDate 缓存签名与自愈 */
    sigOf: function (kind, c) {
      return configSig() + ':' + kind + ':' + c.deathType;
    },
    dueDateOf: function (kind, c) {
      var dl = Limit.deadlineOf(kind, c);
      return dl == null ? null : iso(dl);
    }
  };

  function configSig() {
    var res = global.FHIR.view('Basic', CONFIG_ID);
    return res && res.meta ? res.meta.versionId : 'default';
  }
  Limit.configSig = configSig;

  /* ───── 死亡类型自动分类（规则数据驱动） ─────
   * rule = { id, name, deathType, enabled, priority, match: { field, op, value } }
   * op: contains（文本包含任一关键词，value 为数组）/ gte / lte / eq / bool / exists
   * 可匹配字段见 factsOf()。 */
  function rules() {
    var res = global.FHIR.view('Basic', RULES_ID);
    var list = res && res.ext && res.ext.rules ? res.ext.rules : [];
    return list.filter(function (r) { return r.enabled !== false; })
      .slice().sort(function (a, b) { return (a.priority || 99) - (b.priority || 99); });
  }

  function matchOne(rule, f) {
    var m = rule.match || {};
    var v = f[m.field];
    if (m.op === 'contains') {
      if (v == null) return false;
      var text = String(v);
      var keys = Array.isArray(m.value) ? m.value : [m.value];
      for (var i = 0; i < keys.length; i++) if (text.indexOf(keys[i]) >= 0) return true;
      return false;
    }
    if (m.op === 'lte') return v != null && v <= m.value;
    if (m.op === 'gte') return v != null && v >= m.value;
    if (m.op === 'eq') return v === m.value;
    if (m.op === 'bool') return !!v === !!m.value;
    if (m.op === 'exists') return v != null && v !== '';
    return false;
  }

  var Classify = {
    rules: rules,
    deathTypeOf: function (facts) {
      var list = rules();
      for (var i = 0; i < list.length; i++) {
        if (matchOne(list[i], facts)) return { deathType: list[i].deathType, rule: list[i] };
      }
      return { deathType: 'pending', rule: null };
    },
    priorityOf: function (deathType, facts) {
      var c = config();
      var p = c.priorityByType[deathType] || 'normal';
      if (deathType === 'expected' && facts && (facts.unexpectedFlag || facts.rescueFailed)) p = 'medium';
      return p;
    },
    reasonOf: function (result) {
      return result.rule ? ('命中规则：' + result.rule.name) : '未命中任何自动分类规则，转人工判定';
    },
    matchOne: matchOne
  };

  global.Limit = Limit;
  global.Classify = Classify;
})(typeof window !== 'undefined' ? window : globalThis);
