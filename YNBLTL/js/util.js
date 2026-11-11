/* ============================================================
   util.js — 全局命名空间 + 通用工具函数
   ============================================================ */
window.App = window.App || {};

(function (App) {
  "use strict";

  /* ---------- DOM 助手 ---------- */
  // h(tag, attrs, children) 轻量创建元素
  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "html") el.innerHTML = v;
        else if (k === "text") el.textContent = v;
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "dataset") Object.assign(el.dataset, v);
        else el.setAttribute(k, v);
      }
    }
    if (children != null) appendChildren(el, children);
    return el;
  }
  function appendChildren(el, children) {
    if (Array.isArray(children)) children.forEach((c) => appendChildren(el, c));
    else if (children instanceof Node) el.appendChild(children);
    else if (children != null) el.appendChild(document.createTextNode(String(children)));
  }
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- 日期/时间 ---------- */
  // 演示系统“当前时间”固定为文档语境 2026-06-21（可改）
  const NOW = new Date("2026-06-21T09:00:00");
  function now() { return new Date(NOW.getTime()); }
  // 真实墙钟时间：用于「用户实际操作时刻」的留痕（版本历史/操作日志/接口检测时间等），
  // 与上面固定的演示叙事时间 now() 区分开，避免"保存时间与操作日志时间不一致"。
  function realNow() { return new Date(); }
  function isoRealNow() { return realNow().toISOString(); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtDate(d) {
    if (!d) return "";
    const dt = typeof d === "string" ? new Date(d) : d;
    if (isNaN(dt)) return d;
    return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
  }
  function fmtMD(d) {
    if (!d) return "";
    const dt = typeof d === "string" ? new Date(d) : d;
    if (isNaN(dt)) return d;
    return pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
  }
  function fmtDateTime(d) {
    if (!d) return "";
    const dt = typeof d === "string" ? new Date(d) : d;
    if (isNaN(dt)) return d;
    return fmtDate(dt) + " " + pad(dt.getHours()) + ":" + pad(dt.getMinutes());
  }
  function fmtMDTime(d) {
    if (!d) return "";
    const dt = typeof d === "string" ? new Date(d) : d;
    if (isNaN(dt)) return d;
    return fmtMD(dt) + " " + pad(dt.getHours()) + ":" + pad(dt.getMinutes());
  }
  function isoNow() { return now().toISOString(); }
  function daysBetween(a, b) {
    const ms = (typeof b === "string" ? new Date(b) : b) - (typeof a === "string" ? new Date(a) : a);
    return Math.round(ms / 86400000);
  }
  function addDays(d, n) {
    const dt = typeof d === "string" ? new Date(d) : new Date(d.getTime());
    dt.setDate(dt.getDate() + n);
    return dt;
  }
  function addHours(d, n) {
    const dt = typeof d === "string" ? new Date(d) : new Date(d.getTime());
    dt.setHours(dt.getHours() + n);
    return dt;
  }
  // 截止状态：overdue / near(<=24h) / normal
  function deadlineState(due, done) {
    if (done) return "normal";
    if (!due) return "normal";
    const d = new Date(due);
    const diffH = (d - now()) / 3600000;
    if (diffH < 0) return "overdue";
    if (diffH <= 24) return "near";
    return "normal";
  }

  /* ---------- 杂项 ---------- */
  function uid(prefix) {
    App._seq = (App._seq || 0) + 1;
    return (prefix || "id") + "-" + Date.now().toString(36) + "-" + App._seq;
  }
  function groupBy(arr, fn) {
    const m = {};
    arr.forEach((x) => { const k = fn(x); (m[k] = m[k] || []).push(x); });
    return m;
  }
  function sum(arr, fn) { return arr.reduce((a, x) => a + (fn ? fn(x) : x), 0); }
  function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
  function uniq(arr) { return Array.from(new Set(arr)); }

  App.dom = { h, $, $$, clear, escapeHtml, appendChildren };
  App.date = { NOW, now, realNow, fmtDate, fmtMD, fmtDateTime, fmtMDTime, isoNow, isoRealNow, daysBetween, addDays, addHours, deadlineState, pad };
  App.util = { uid, groupBy, sum, pct, uniq };

  /* ---------- 业务枚举与样式映射 ---------- */
  App.enums = {
    caseType: { "diagnostic": "诊断疑难", "treatment": "治疗疑难", "rare": "罕见病" },
    urgency: { high: { label: "高", cls: "high", dot: "🔴" }, mid: { label: "中", cls: "mid", dot: "🟠" }, low: { label: "低", cls: "low", dot: "🟢" } },
    // 讨论会议状态
    meetingStatus: {
      pending: { label: "待安排", tag: "gray" },
      scheduled: { label: "已安排", tag: "blue" },
      ongoing: { label: "进行中", tag: "orange" },
      completed: { label: "已完成", tag: "green" },
    },
    // 病例讨论任务状态
    discussionStatus: {
      pending: { label: "待讨论", tag: "gray" },
      ongoing: { label: "讨论中", tag: "orange" },
      completed: { label: "已完成", tag: "green" },
    },
    // 诊疗调整任务执行状态（FHIR Task.status 映射）
    taskStatus: {
      requested: { label: "待执行", tag: "gray" },
      "in-progress": { label: "执行中", tag: "blue" },
      completed: { label: "已完成", tag: "green" },
      overdue: { label: "已超时", tag: "red" },
    },
    // 参会确认状态（FHIR Appointment.participant.status）
    partStatus: {
      accepted: { label: "已确认", tag: "green" },
      tentative: { label: "待确认", tag: "orange" },
      declined: { label: "已拒绝", tag: "red" },
    },
    scheduleStatus: {
      free: { label: "空闲", dot: "🟢", selectable: true },
      conflict: { label: "会议冲突", dot: "🟡", selectable: true },
      off: { label: "休息", dot: "🔴", selectable: false },
    },
    // 通知规则 · 通知对象（勾选式）
    notifyTargets: { director: "科室主任", attending: "责任医生", expert: "参会专家", qa: "质量管理部门" },
  };

  // 专家/医生排班状态（用于会议邀请场景，集中维护，避免各页面各写一份不一致的数据）
  App.enums.scheduleMap = {
    "prac-ww": "free", "prac-zm": "free", "prac-cq": "free", "prac-ly": "conflict",
    "prac-sl": "off", "prac-wq": "free", "prac-zhm": "free", "prac-ljg": "free", "prac-zcz": "free",
  };
  App.scheduleStatusOf = (id) => App.enums.scheduleMap[id] || "free";

  // helpers to render enum tags
  App.caseTypeLabel = (t) => App.enums.caseType[t] || t;
  App.urgencyView = (u) => App.enums.urgency[u] || App.enums.urgency.low;

})(window.App);
