/* ============================================================
   UI 工具库 —— DOM 助手、Toast、Modal、图表、权限/导航配置
   ============================================================ */
const UI = (() => {
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- Toast ----
  function toast(msg, type = 'ok', ms = 2400) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const ic = { ok: '✅', err: '⛔', warn: '⚠️', info: 'ℹ️' }[type] || '';
    const el = h(`<div class="toast ${type}">${ic} <span>${esc(msg)}</span></div>`);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
  }

  // ---- Modal ----
  let modalStack = [];
  function modal({ title, body, footer, width = '', onClose } = {}) {
    const mask = h(`<div class="modal-mask"><div class="modal ${width}">
      <div class="modal-h"><h3>${esc(title)}</h3><div class="x">✕</div></div>
      <div class="modal-b"></div>
      ${footer ? '<div class="modal-f"></div>' : ''}
    </div></div>`);
    const bodyEl = mask.querySelector('.modal-b');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    if (footer) { const f = mask.querySelector('.modal-f'); if (typeof footer === 'string') f.innerHTML = footer; else f.appendChild(footer); }
    const close = () => { mask.remove(); modalStack = modalStack.filter(m => m !== mask); onClose && onClose(); };
    mask.querySelector('.x').onclick = close;
    mask.addEventListener('mousedown', e => { if (e.target === mask) close(); });
    document.body.appendChild(mask);
    modalStack.push(mask);
    return { el: mask, body: bodyEl, close };
  }
  function confirm(msg, { title = '确认操作', okText = '确定', danger = false } = {}) {
    return new Promise(res => {
      const m = modal({ title, width: 'w560',
        body: `<div style="padding:6px 2px;font-size:14px;line-height:1.7">${esc(msg)}</div>`,
        footer: `<button class="btn cancel">取消</button><button class="btn ${danger ? 'danger' : 'pri'} ok">${esc(okText)}</button>` });
      m.el.querySelector('.cancel').onclick = () => { m.close(); res(false); };
      m.el.querySelector('.ok').onclick = () => { m.close(); res(true); };
    });
  }

  // ---- 全屏详情页（替代弹窗：病历详情 / 整改任务详情 / 归档详情） ----
  function fullpage({ title, subtitle, body, footer, onClose } = {}) {
    const wrap = h(`<div class="fullpage">
      <div class="fullpage-h"><button class="back-btn">← 返回</button>
        <div class="fp-title"><h2>${esc(title)}</h2>${subtitle ? `<div class="fp-sub">${esc(subtitle)}</div>` : ''}</div></div>
      <div class="fullpage-b"></div>
      ${footer ? '<div class="fullpage-f"></div>' : ''}
    </div>`);
    const bodyEl = wrap.querySelector('.fullpage-b');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    if (footer) { const f = wrap.querySelector('.fullpage-f'); if (typeof footer === 'string') f.innerHTML = footer; else f.appendChild(footer); }
    const close = () => { wrap.remove(); onClose && onClose(); };
    wrap.querySelector('.back-btn').onclick = close;
    document.body.appendChild(wrap);
    return { el: wrap, body: bodyEl, close };
  }

  // ---- 保留焦点/光标位置的局部重渲染（修复中文输入法/连续输入被打断问题） ----
  // 当筛选输入框的 oninput 需要触发整块重渲染时，用此包裹 renderFn，
  // 重渲染后自动把焦点、光标位置还原到同名输入框上，避免每次重渲染都丢焦点。
  function keepFocus(container, renderFn) {
    const active = document.activeElement;
    let id = null, selStart = null, selEnd = null;
    if (active && container.contains(active) && active.id) {
      id = active.id;
      if ('selectionStart' in active) { selStart = active.selectionStart; selEnd = active.selectionEnd; }
    }
    renderFn();
    if (id) {
      const el = Array.from(container.querySelectorAll('input,select,textarea')).find(x => x.id === id);
      if (el) {
        el.focus();
        if (selStart != null && 'setSelectionRange' in el) { try { el.setSelectionRange(selStart, selEnd); } catch (e) {} }
      }
    }
  }

  // ---- 图表（SVG）----
  function lineChart(series, { w = 520, hgt = 200, color = '#1d6fd6', min = 60, max = 100, label = '' } = {}) {
    if (!series.length) return '<div class="empty-box">暂无数据</div>';
    const pad = { l: 36, r: 12, t: 14, b: 26 };
    const iw = w - pad.l - pad.r, ih = hgt - pad.t - pad.b;
    const xs = i => pad.l + (series.length === 1 ? iw / 2 : i / (series.length - 1) * iw);
    const ys = v => pad.t + (1 - (v - min) / (max - min)) * ih;
    const pts = series.map((d, i) => `${xs(i)},${ys(d.y)}`).join(' ');
    const area = `${pad.l},${pad.t + ih} ${pts} ${xs(series.length - 1)},${pad.t + ih}`;
    const grid = [60, 70, 80, 90, 100].filter(g => g >= min && g <= max).map(g =>
      `<line x1="${pad.l}" y1="${ys(g)}" x2="${w - pad.r}" y2="${ys(g)}" stroke="#eef1f5"/>
       <text x="${pad.l - 6}" y="${ys(g) + 3}" text-anchor="end" font-size="10" fill="#90a">${g}%</text>`).join('');
    const dots = series.map((d, i) => `<circle cx="${xs(i)}" cy="${ys(d.y)}" r="3.5" fill="#fff" stroke="${color}" stroke-width="2"><title>${d.x}: ${d.y}%</title></circle>`).join('');
    const xl = series.map((d, i) => `<text x="${xs(i)}" y="${hgt - 8}" text-anchor="middle" font-size="10" fill="#90a">${d.x}</text>`).join('');
    return `<svg viewBox="0 0 ${w} ${hgt}" style="width:100%;height:auto">
      ${grid}
      <polyline points="${area}" fill="${color}22" stroke="none"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>
      ${dots}${xl}
    </svg>${label ? `<div class="muted" style="text-align:center;font-size:12px;margin-top:4px">${label}</div>` : ''}`;
  }
  function barChart(items, { w = 520, hgt = 200, max = 100 } = {}) {
    if (!items.length) return '<div class="empty-box">暂无数据</div>';
    const pad = { l: 36, r: 12, t: 14, b: 30 };
    const iw = w - pad.l - pad.r, ih = hgt - pad.t - pad.b;
    const bw = iw / items.length * 0.55, gap = iw / items.length;
    const ys = v => pad.t + (1 - v / max) * ih;
    const grid = [0, 25, 50, 75, 100].map(g => `<line x1="${pad.l}" y1="${ys(g)}" x2="${w - pad.r}" y2="${ys(g)}" stroke="#eef1f5"/><text x="${pad.l - 6}" y="${ys(g) + 3}" text-anchor="end" font-size="10" fill="#90a">${g}</text>`).join('');
    const bars = items.map((it, i) => {
      const x = pad.l + i * gap + (gap - bw) / 2;
      const onH = (1 - it.onTime / max) * ih, totalH = ih;
      const onY = pad.t + onH;
      const overSeg = (it.over / max) * ih;
      return `<rect x="${x}" y="${onY}" width="${bw}" height="${pad.t + ih - onY}" fill="#1d6fd6" rx="2"><title>${it.name} 及时率 ${it.onTime}%</title></rect>
        <rect x="${x}" y="${pad.t + ih - overSeg}" width="${bw}" height="${overSeg}" fill="#e2483d99" rx="2"/>
        <text x="${x + bw / 2}" y="${hgt - 8}" text-anchor="middle" font-size="10" fill="#5b6675">${it.name}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${hgt}" style="width:100%;height:auto">${grid}${bars}</svg>`;
  }
  function donut(items, { size = 150 } = {}) {
    const total = items.reduce((a, b) => a + b.count, 0) || 1;
    let acc = 0; const r = size / 2, ir = r * 0.6;
    const segs = items.map(it => {
      const a0 = acc / total * 2 * Math.PI, a1 = (acc + it.count) / total * 2 * Math.PI; acc += it.count;
      const x0 = r + r * Math.sin(a0), y0 = r - r * Math.cos(a0), x1 = r + r * Math.sin(a1), y1 = r - r * Math.cos(a1);
      const xi1 = r + ir * Math.sin(a1), yi1 = r - ir * Math.cos(a1), xi0 = r + ir * Math.sin(a0), yi0 = r - ir * Math.cos(a0);
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      return `<path d="M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${xi1},${yi1} A${ir},${ir} 0 ${large} 0 ${xi0},${yi0} Z" fill="${it.color}"><title>${it.type} ${it.count} (${it.pct}%)</title></path>`;
    }).join('');
    return `<svg viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px">${segs}<text x="${r}" y="${r - 2}" text-anchor="middle" font-size="20" font-weight="700" fill="#1f2733">${total}</text><text x="${r}" y="${r + 15}" text-anchor="middle" font-size="10" fill="#90a">异常总数</text></svg>`;
  }

  // ---- 通用：分页 ----
  function paginate(arr, page, size) {
    const pages = Math.max(1, Math.ceil(arr.length / size));
    const p = Math.min(page, pages);
    return { slice: arr.slice((p - 1) * size, p * size), pages, page: p };
  }
  function pager(page, pages, onGo, unit = '条') {
    if (pages <= 1) return `<div class="pager"><span class="muted">共 ${pages === 0 ? 0 : ''}${unit ? '' : ''}</span></div>`;
    let btns = '';
    for (let i = 1; i <= pages; i++) btns += `<div class="pg ${i === page ? 'on' : ''}" data-pg="${i}">${i}</div>`;
    const el = h(`<div class="pager"><div class="pg" data-pg="${Math.max(1, page - 1)}">上一页</div>${btns}<div class="pg" data-pg="${Math.min(pages, page + 1)}">下一页</div></div>`);
    el.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => onGo(+b.dataset.pg));
    return el;
  }

  // ---- 合规/状态徽标 ----
  const complianceBadge = (c) => {
    const map = { ok: ['green', '🟢'], soon: ['orange', '🟠'], over: ['red', '🔴'] };
    const [cls] = map[c.code] || ['gray', ''];
    const note = c.overMs != null ? `<span class="muted" style="font-size:11px">（但超时${window.Biz.fmtDur(c.overMs)}）</span>` : '';
    return `<span class="pill ${cls}"><span class="dot ${cls}"></span>${c.label}</span>${note}`;
  };
  const archiveBadge = (st) => {
    const map = { none: ['gray', '未提交'], archiving: ['blue', '归档中'], archived: ['green', '已归档'], intercepted: ['red', '已拦截'] };
    const [cls, lab] = map[st] || ['gray', st];
    return `<span class="pill ${cls}"><span class="dot ${cls}"></span>${lab}</span>`;
  };

  function footer() {
    return `<div class="footer">© 2026 病历管理制度闭环管理系统 · 演示版<a href="javascript:void 0">帮助</a><a href="javascript:void 0">隐私政策</a></div>`;
  }

  // ============================================================
  //  导航 / 权限配置（依据 IA-3.3 角色权限与导航可见性）
  // ============================================================
  const PAGES = {
    'home':          { title: '病历管理制度闭环管理首页', code: 'L1', group: null },
    'time-monitor':  { title: '病历书写时限监控', code: 'L3-1-1', group: '书写管理' },
    'rectify':       { title: '整改任务处理',     code: 'L3-1-2', group: '书写管理' },
    'rectify-track': { title: '整改任务追踪',     code: 'L3-2-1', group: '统计监督' },
    'archive':       { title: '病历归档管理',     code: 'L3-2-2', group: '统计监督' },
    'quality':       { title: '病历质量概览',     code: 'L3-2-3', group: '统计监督' },
    'timeliness':    { title: '书写及时率统计',   code: 'L3-2-4', group: '统计监督' },
    'time-config':   { title: '书写时限配置',     code: 'L3-3-1', group: '配置管理' },
    'qc-config':     { title: '质控规则配置',     code: 'L3-3-2', group: '配置管理' },
    'perm':          { title: '用户权限管理',     code: 'L3-3-3', group: '配置管理' },
  };
  // 角色可访问页面（IA-3.3）
  const ROLE_PAGES = {
    clinician: ['time-monitor', 'rectify'],
    deptHead:  ['rectify-track', 'quality', 'timeliness'],
    archivist: ['archive'],
    qc:        ['rectify-track', 'quality', 'timeliness', 'time-config', 'qc-config'],
    admin:     ['perm'],
  };
  const GROUPS = [
    { name: '书写管理', icon: '📝', pages: ['time-monitor', 'rectify'] },
    { name: '统计监督', icon: '📊', pages: ['rectify-track', 'archive', 'quality', 'timeliness'] },
    { name: '配置管理', icon: '⚙️', pages: ['time-config', 'qc-config', 'perm'] },
  ];
  const canAccess = (role, page) => page === 'home' || (ROLE_PAGES[role] || []).includes(page);

  return { h, esc, toast, modal, confirm, fullpage, keepFocus, lineChart, barChart, donut, paginate, pager,
    complianceBadge, archiveBadge, footer, PAGES, ROLE_PAGES, GROUPS, canAccess };
})();
window.UI = UI;
