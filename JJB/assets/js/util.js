/* ============================================================
 * util.js — DOM 助手、提示、弹框、格式化、标签
 * 全局命名空间挂在 window.U
 * ============================================================ */
window.PAGES = window.PAGES || {};   // 页面注册表（页面脚本在 router.js 之前加载，需提前声明）
(function () {
  const U = {};

  /* ---------- DOM ---------- */
  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  U.el = (tag, attrs = {}, html) => {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'dataset') Object.assign(e.dataset, attrs[k]);
      else if (k.startsWith('on') && typeof attrs[k] === 'function')
        e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    if (html != null) e.innerHTML = html;
    return e;
  };
  U.esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /* 事件委托：在容器上为匹配 selector 的元素绑定事件 */
  U.delegate = (root, evt, selector, fn) => {
    root.addEventListener(evt, (e) => {
      const t = e.target.closest(selector);
      if (t && root.contains(t)) fn(e, t);
    });
  };

  /* ---------- ID / 随机 ---------- */
  let _seq = 1000;
  U.uid = (prefix = 'id') => `${prefix}-${(_seq++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  U.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* ---------- 时间 ---------- */
  U.pad = (n) => String(n).padStart(2, '0');
  U.fmtDate = (d) => {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${U.pad(x.getMonth() + 1)}-${U.pad(x.getDate())}`;
  };
  U.fmtTime = (d) => {
    const x = d instanceof Date ? d : new Date(d);
    return `${U.fmtDate(x)} ${U.pad(x.getHours())}:${U.pad(x.getMinutes())}`;
  };
  U.fmtClock = (d) => {
    const x = d instanceof Date ? d : new Date(d);
    return `${U.pad(x.getHours())}:${U.pad(x.getMinutes())}`;
  };
  U.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  U.weekdayCN = (d) => '日一二三四五六'[new Date(d).getDay()];
  // “演示当前时间”：固定为文档语境的 2026-06-20 08:00，避免每次刷新漂移
  U.now = () => new Date('2026-06-20T08:00:00');

  /* ---------- 提示 Toast ---------- */
  U.toast = (msg, type = 'success', ms = 2600) => {
    const root = U.$('#toast-root');
    const ic = { success: '✅', error: '❌', warn: '⚠️', info: 'ℹ️' }[type] || '';
    const t = U.el('div', { class: `toast ${type}` }, `<span>${ic}</span><span>${U.esc(msg)}</span>`);
    root.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; }, ms - 300);
    setTimeout(() => t.remove(), ms);
  };

  /* ---------- 弹框 Modal ----------
   * U.modal({title, body(htmlString|Node), footer(Node|html), width, drawer, onClose})
   * 返回 { close }
   */
  U.modal = (opt) => {
    const root = U.$('#modal-root');
    const mask = U.el('div', { class: `modal-mask ${opt.drawer ? 'drawer-mask' : ''}` });
    const box = U.el('div', { class: `modal ${opt.width === 'wide' ? 'wide' : ''} ${opt.drawer ? 'drawer' : ''}` });
    const head = U.el('div', { class: 'modal-head' },
      `<span>${U.esc(opt.title || '')}</span><span class="x">✕</span>`);
    const body = U.el('div', { class: 'modal-body' });
    if (typeof opt.body === 'string') body.innerHTML = opt.body;
    else if (opt.body) body.appendChild(opt.body);
    box.appendChild(head); box.appendChild(body);
    if (opt.footer) {
      const foot = U.el('div', { class: 'modal-foot' });
      if (typeof opt.footer === 'string') foot.innerHTML = opt.footer;
      else foot.appendChild(opt.footer);
      box.appendChild(foot);
    }
    mask.appendChild(box); root.appendChild(mask);
    const close = () => { mask.remove(); opt.onClose && opt.onClose(); };
    head.querySelector('.x').addEventListener('click', close);
    mask.addEventListener('click', (e) => { if (e.target === mask && opt.maskClose !== false) close(); });
    return { close, body, box, mask };
  };

  /* 二次确认 */
  U.confirm = (opt) => new Promise((resolve) => {
    const foot = U.el('div');
    const cancel = U.el('button', { class: 'btn' }, '取消');
    const ok = U.el('button', { class: `btn ${opt.danger ? 'danger' : 'primary'}` }, opt.okText || '确认');
    foot.appendChild(cancel); foot.appendChild(ok);
    const m = U.modal({
      title: opt.title || '确认操作', width: opt.width,
      body: `<div style="padding:6px 2px;font-size:14px">${opt.content || ''}</div>`,
      footer: foot, onClose: () => resolve(false),
    });
    cancel.addEventListener('click', () => { m.close(); });
    ok.addEventListener('click', () => { m.mask.remove(); resolve(true); });
  });

  /* ---------- 基础多选（Element 风格：用 Tag 展示已选项） ----------
   * U.msBox(options, selectedIds) -> html：只读展示（供表格/单元格中直接渲染选中结果）
   * U.pickMulti({title, options:[{id,label,sub}], selected:[]}) -> Promise<string[]|null>
   *   点击后弹出选择列表，顶部实时以 Tag 展示已选项，确认后返回新的已选 id 数组（取消返回 null）
   */
  U.msBox = (options, selectedIds, opt = {}) => {
    const ids = selectedIds || [];
    if (!ids.length) return `<div class="ms-box empty">${opt.placeholder || '点击选择'}</div>`;
    const label = (id) => { const o = options.find(x => x.id === id); return o ? o.label : id; };
    return `<div class="ms-box">${ids.map(id => `<span class="ms-tag">${U.esc(label(id))}</span>`).join('')}</div>`;
  };
  U.pickMulti = (opt) => new Promise((resolve) => {
    let sel = (opt.selected || []).slice();
    const body = U.el('div');
    function renderTags() {
      const box = U.$('.ms-box', body);
      box.className = 'ms-box' + (sel.length ? '' : ' empty');
      box.innerHTML = sel.length ? sel.map(id => {
        const o = opt.options.find(x => x.id === id);
        return `<span class="ms-tag">${U.esc(o ? o.label : id)}<span class="x" data-untag="${id}">✕</span></span>`;
      }).join('') : (opt.placeholder || '未选择，请在下方勾选');
    }
    body.innerHTML = `<div class="ms-box"></div>
      <div class="ms-picker-list">${opt.options.map(o => `<label><input type="checkbox" data-opt="${o.id}" ${sel.includes(o.id) ? 'checked' : ''}> ${U.esc(o.label)}${o.sub ? ` <span class="muted-text" style="font-size:12px">${U.esc(o.sub)}</span>` : ''}</label>`).join('')}</div>`;
    renderTags();
    U.delegate(body, 'change', '[data-opt]', (e, t) => {
      const id = t.dataset.opt;
      if (t.checked) { if (!sel.includes(id)) sel.push(id); } else { sel = sel.filter(x => x !== id); }
      renderTags();
    });
    U.delegate(body, 'click', '[data-untag]', (e, t) => {
      sel = sel.filter(x => x !== t.dataset.untag);
      U.$$('[data-opt]', body).forEach(n => { if (n.dataset.opt === t.dataset.untag) n.checked = false; });
      renderTags();
    });
    const foot = U.el('div');
    const cancel = U.el('button', { class: 'btn' }, '取消');
    const ok = U.el('button', { class: 'btn primary' }, '确定');
    foot.appendChild(cancel); foot.appendChild(ok);
    let resolved = false;
    const m = U.modal({ title: opt.title || '选择人员', body, footer: foot, onClose: () => { if (!resolved) { resolved = true; resolve(null); } } });
    cancel.addEventListener('click', () => m.close());
    ok.addEventListener('click', () => { resolved = true; m.mask.remove(); resolve(sel); });
  });

  /* ---------- 标签助手 ---------- */
  U.tag = (text, color = 'default') => `<span class="tag ${color}">${U.esc(text)}</span>`;
  U.severityTag = (s) => {
    const map = { '危重': 'red', '较重': 'orange', '一般': 'green' };
    return U.tag(s, map[s] || 'default');
  };
  U.priorityTag = (p) => {
    const map = { '紧急': 'red', '高': 'orange', '普通': 'blue', '低': 'default' };
    return U.tag(p, map[p] || 'default');
  };
  U.roleColor = (role) => {
    const map = {
      '值班医生': 'blue', '接班医生': 'blue',
      '科室负责人': 'purple', '医院管理部门': 'purple', '管理员': 'cyan',
    };
    return map[role] || 'default';
  };

  /* ---------- 简易折线图（SVG，无依赖） ---------- */
  U.lineChart = (data, opt = {}) => {
    const w = opt.w || 320, h = opt.h || 120, pad = 26;
    const vals = data.map(d => d.v);
    const max = opt.max != null ? opt.max : Math.max(...vals) * 1.1;
    const min = opt.min != null ? opt.min : Math.min(...vals, 0);
    const range = max - min || 1;
    const stepX = (w - pad * 2) / Math.max(1, data.length - 1);
    const pts = data.map((d, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((d.v - min) / range) * (h - pad * 2);
      return [x, y];
    });
    const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const area = path + ` L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pad},${h - pad} Z`;
    const color = opt.color || '#1677FF';
    let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px">`;
    svg += `<line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#e8e8e8"/>`;
    svg += `<path d="${area}" fill="${color}1a"/>`;
    svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>`;
    pts.forEach((p, i) => { svg += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" fill="${color}"/>`; });
    data.forEach((d, i) => {
      svg += `<text x="${(pad + i * stepX).toFixed(1)}" y="${h - 8}" font-size="9" fill="#8c8c8c" text-anchor="middle">${U.esc(d.k)}</text>`;
    });
    svg += `</svg>`;
    return svg;
  };

  /* ---------- 横向条形对比图 ---------- */
  U.hbar = (rows, opt = {}) => {
    const max = opt.max || Math.max(...rows.map(r => r.v), 1);
    return `<div style="display:flex;flex-direction:column;gap:9px">` + rows.map(r => {
      const pct = Math.min(100, (r.v / max) * 100);
      const warn = opt.warn && opt.warn(r.v);
      return `<div style="display:flex;align-items:center;gap:8px">
        <span style="width:64px;font-size:12px;color:#595959">${U.esc(r.k)}</span>
        <div class="bar-wrap" style="flex:1"><div class="bar" style="width:${pct}%;background:${warn ? 'var(--warning)' : 'var(--primary)'}"></div></div>
        <span style="width:60px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums">${r.label || r.v}${warn ? ' ⚠' : ''}</span>
      </div>`;
    }).join('') + `</div>`;
  };

  window.U = U;
})();
