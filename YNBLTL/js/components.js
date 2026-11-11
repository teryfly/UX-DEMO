/* ============================================================
   components.js — 可复用 UI 组件
   ============================================================ */
(function (App) {
  "use strict";
  const { h, clear } = App.dom;

  /* ---------- Toast ---------- */
  function toast(msg, type) {
    const layer = document.getElementById("toastLayer");
    const t = h("div", { class: "toast " + (type || "info") }, [iconFor(type), msg]);
    layer.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = ".3s"; setTimeout(() => t.remove(), 300); }, 2600);
  }
  function iconFor(type) {
    return h("span", {}, type === "success" ? "✅" : type === "error" ? "⚠️" : "ℹ️");
  }

  /* ---------- Modal ---------- */
  // open({title, sub, body(node), footer(node), width}) -> {close, setBody}
  function modal(opts) {
    const layer = document.getElementById("modalLayer");
    const bodyWrap = h("div", { class: "modal-body" });
    if (opts.body) App.dom.appendChildren(bodyWrap, opts.body);
    const foot = opts.footer ? h("div", { class: "modal-foot" }, opts.footer) : null;
    const closeBtn = h("button", { class: "modal-close", title: "关闭", onClick: () => close() }, "×");
    const head = h("div", { class: "modal-head" }, [
      closeBtn,
      h("div", { class: "modal-title" }, opts.title || ""),
      opts.sub ? h("div", { class: "modal-sub" }, opts.sub) : null,
    ]);
    const box = h("div", { class: "modal " + (opts.width || "") }, [head, bodyWrap, foot]);
    const mask = h("div", { class: "modal-mask", onClick: (e) => { if (e.target === mask && opts.maskClose !== false) close(); } }, [box]);
    layer.appendChild(mask);
    function close() { mask.remove(); if (opts.onClose) opts.onClose(); }
    return {
      close,
      el: box,
      setBody(node) { clear(bodyWrap); App.dom.appendChildren(bodyWrap, node); },
      setFooter(nodes) { if (foot) { clear(foot); App.dom.appendChildren(foot, nodes); } },
      bodyEl: bodyWrap,
    };
  }

  /* ---------- 确认框 ---------- */
  function confirmBox(opts) {
    return new Promise((resolve) => {
      const m = modal({
        title: opts.title || "确认",
        width: "narrow",
        body: h("div", {}, opts.message || ""),
        footer: [
          h("button", { class: "btn", onClick: () => { m.close(); resolve(false); } }, opts.cancelText || "取消"),
          h("button", { class: "btn " + (opts.danger ? "danger" : "primary"), onClick: () => { m.close(); resolve(true); } }, opts.okText || "确定"),
        ],
      });
    });
  }

  /* ---------- 分段 Tab（弹框内 ●标识 风格） ---------- */
  // segTabs(items[{key,label}], onChange) -> {el, set(key)}
  function segTabs(items, onChange, active) {
    let cur = active || items[0].key;
    const el = h("div", { class: "seg-tabs" });
    function render() {
      clear(el);
      items.forEach((it) => {
        if (it.hidden) return;
        el.appendChild(h("button", {
          class: "seg" + (it.key === cur ? " active" : ""),
          onClick: () => { cur = it.key; render(); onChange(cur); },
        }, [it.key === cur ? h("span", { class: "dot" }, "●") : null, it.label]));
      });
    }
    render();
    return { el, set(k) { cur = k; render(); onChange(cur); }, get: () => cur, rerender: render, items };
  }

  /* ---------- 顶部 Tab（下划线风格，用于二级选项卡） ---------- */
  function tabs(items, onChange, active) {
    let cur = active || items[0].key;
    const el = h("div", { class: "tabs" });
    function render() {
      clear(el);
      items.forEach((it) => el.appendChild(h("button", {
        class: "tab" + (it.key === cur ? " active" : ""),
        onClick: () => { cur = it.key; render(); onChange(cur); },
      }, it.label)));
    }
    render();
    return { el, set(k) { cur = k; render(); onChange(cur); }, get: () => cur };
  }

  /* ---------- 表格 ---------- */
  // table({columns:[{title,render(row),cls}], rows, rowClass(row), empty})
  function table(opts) {
    const thead = h("thead", {}, h("tr", {}, opts.columns.map((c) => h("th", { class: c.thCls }, c.title))));
    const tbody = h("tbody");
    if (!opts.rows.length) {
      tbody.appendChild(h("tr", {}, h("td", { colspan: opts.columns.length },
        emptyState(opts.empty || "暂无数据"))));
    } else {
      opts.rows.forEach((row) => {
        const tr = h("tr", { class: opts.rowClass ? opts.rowClass(row) : "" },
          opts.columns.map((c) => {
            const td = h("td", { class: c.tdCls });
            const val = c.render(row);
            App.dom.appendChildren(td, val);
            return td;
          }));
        if (opts.onRowClick) tr.addEventListener("click", () => opts.onRowClick(row));
        tbody.appendChild(tr);
      });
    }
    return h("div", { class: "table-wrap" }, h("table", { class: "data" }, [thead, tbody]));
  }

  /* ---------- 分页 ---------- */
  function pager(opts) {
    const total = opts.total, pageSize = opts.pageSize || 20, page = opts.page || 1;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const btns = [];
    btns.push(h("button", { disabled: page <= 1, onClick: () => opts.onPage(page - 1) }, "‹"));
    for (let i = 1; i <= pages; i++) {
      btns.push(h("button", { class: i === page ? "active" : "", onClick: () => opts.onPage(i) }, String(i)));
    }
    btns.push(h("button", { disabled: page >= pages, onClick: () => opts.onPage(page + 1) }, "›"));
    return h("div", { class: "pager" }, [
      h("span", {}, "共 " + total + " 条"),
      h("span", {}, "每页 " + pageSize + " 条"),
      h("div", { class: "pages" }, btns),
    ]);
  }

  /* ---------- 空状态 ---------- */
  function emptyState(text, emoji) {
    return h("div", { class: "empty" }, [h("span", { class: "emoji" }, emoji || "📭"), text]);
  }

  /* ---------- 统计卡片 ---------- */
  function statCard(opts) {
    const cls = "stat-card" + (opts.alert ? " alert-on" : "") + (opts.ok ? " ok-state" : "");
    return h("div", { class: cls }, [
      h("div", { class: "stat-label" }, [opts.icon ? h("span", {}, opts.icon) : null, opts.label]),
      h("div", { class: "stat-value" }, String(opts.value)),
      opts.desc ? h("div", { class: "stat-desc" }, opts.desc) : null,
      opts.trend ? h("div", { class: "stat-trend " + (opts.trendDir === "up" ? "trend-up" : opts.trendDir === "down" ? "trend-down" : "") }, opts.trend) : null,
    ]);
  }

  /* ---------- 标签 ---------- */
  function tag(text, cls) { return h("span", { class: "tag " + (cls || "gray") }, text); }
  function caseTypeTag(t) {
    const map = { diagnostic: "blue", treatment: "purple", rare: "teal" };
    return tag(App.caseTypeLabel(t), map[t] || "gray");
  }
  function statusTag(map, key) {
    const v = map[key]; return v ? tag(v.label, v.tag) : tag(key, "gray");
  }
  function urgencyView(u) {
    const v = App.urgencyView(u);
    return h("span", { class: "urgency " + v.cls }, [v.dot + " " + v.label]);
  }

  /* ---------- 执行步骤 ---------- */
  function steps(nodes) {
    return h("ul", { class: "steps" }, nodes.map((n) =>
      h("li", { class: n.done ? "done" : "todo" }, [
        h("span", { class: "step-dot" }),
        h("span", { class: "step-label" }, (n.done ? "已完成：" : "待完成：") + n.label),
        n.time ? h("span", { class: "step-time" }, App.date.fmtMDTime(n.time)) : null,
      ])));
  }

  /* ---------- 进度条 ---------- */
  function progress(value, cls) {
    return h("div", { class: "progress " + (cls || "") }, h("i", { style: { width: Math.max(0, Math.min(100, value)) + "%" } }));
  }

  /* ---------- 简易柱状图 ---------- */
  function barChart(opts) {
    const max = Math.max(1, ...opts.data.flatMap((d) => d.values));
    return h("div", {}, [
      h("div", { class: "bars" }, opts.data.map((d) =>
        h("div", { class: "bar-col" }, [
          h("div", { style: { display: "flex", alignItems: "flex-end", gap: "3px", height: "100%", width: "100%", justifyContent: "center" } },
            d.values.map((v, i) => h("div", { class: "bar b" + (i + 1), style: { height: (v / max * 100) + "%" }, title: v }))),
          h("div", { class: "bar-label" }, d.label),
        ]))),
      opts.legend ? h("div", { class: "legend" }, opts.legend.map((l, i) =>
        h("span", {}, [h("i", { style: { background: ["var(--c-primary)", "var(--c-teal)", "var(--c-warn)"][i] } }), l]))) : null,
    ]);
  }

  /* ---------- 甜甜圈（单值占比） ---------- */
  function donut(percent, color, label) {
    const c = color || "var(--c-primary)";
    return h("div", { class: "donut-wrap" }, [
      h("div", { class: "donut", style: { background: "conic-gradient(" + c + " 0% " + percent + "%, #eef1f6 " + percent + "% 100%)" } },
        h("div", { class: "donut-center" }, percent + "%")),
      label ? h("div", {}, label) : null,
    ]);
  }

  App.ui = {
    toast, modal, confirmBox, segTabs, tabs, table, pager, emptyState,
    statCard, tag, caseTypeTag, statusTag, urgencyView, steps, progress, barChart, donut,
  };
})(window.App);
