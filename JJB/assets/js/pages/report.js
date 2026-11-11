/* WF-L3-3-2 值班质量报告（核心指标 + 趋势 + 科室对比） */
(function () {
  let scope = '全院', period = '本周', customStart = '2026-05-25', customEnd = '2026-06-20';

  // ---- 按科室、按日的统计数据引擎（确定性生成，而非写死一份不随筛选变化的固定数字） ----
  // DAY0~TODAY 共 30 天，覆盖“近30天”，本周/本月/本季/自定义均从这份按日数据切片聚合，
  // 保证：① 切换科室时数值必然变化（按科室系数缩放）；② 自定义起止日期真实生效。
  const DAY0 = '2026-05-22', TODAY = '2026-06-20', N_DAYS = 30;
  const FACTOR = { '全院': 1, '心血管内科': 1, '普外科': 0.95, '神经内科': 0.9, '急诊科': 0.86 };
  const EXC_BASE = { '全院': 18, '心血管内科': 2, '普外科': 3, '神经内科': 6, '急诊科': 7 };

  function dayIdx(dateStr) { return Math.round((new Date(dateStr) - new Date(DAY0)) / 86400000); }
  function dateAt(idx) { return U.fmtDate(U.addDays(new Date(DAY0), idx)); }
  function clampIdx(i) { return Math.max(0, Math.min(N_DAYS - 1, i)); }

  function rawDaily(metric) {
    const cfg = {
      attend: { base: 92, amp: 6, phase: 0.7 }, ontime: { base: 88, amp: 6, phase: 1.6 },
      conflict: { base: 2.6, amp: 1.8, phase: 2.3 },
    }[metric];
    return Array.from({ length: N_DAYS }, (_, i) => {
      const wobble = ((i * 37) % 7 - 3) * 0.5;
      const v = cfg.base + cfg.amp * Math.sin(i / 2.6 + cfg.phase) + wobble;
      return metric === 'conflict' ? Math.max(0, Math.round(v * 10) / 10) : Math.max(0, Math.round(v));
    });
  }
  function dailyFor(dept, metric) {
    const f = FACTOR[dept] || 1;
    return rawDaily(metric).map(v => {
      if (metric === 'attend' || metric === 'ontime') return Math.min(100, Math.round(v * f));
      return Math.round(v * (2 - f) * 10) / 10; // conflict：科室越好（f 越大）数值越低
    });
  }
  // 交接超时率（%）由到岗/交接及时率联动推导，避免另起一份不相关的独立数字
  function timeoutDailyFor(dept) { return dailyFor(dept, 'ontime').map(v => Math.max(0, Math.round((100 - v) * 0.55))); }
  // 用“累计取整差分”而非逐日四舍五入：小基数科室（如 2 件/周）逐日取整会永远舍到 0，
  // 累计法能保证长期均值精确等于 base（件/周），且不会出现异常事件数永远显示 0 的问题。
  function exceptionDailyFor(dept) {
    const base = EXC_BASE[dept] || 3;
    const rate = base / 7;
    const out = [];
    let prevFloor = 0;
    for (let i = 1; i <= N_DAYS; i++) {
      const floorNow = Math.floor(rate * i);
      out.push(floorNow - prevFloor);
      prevFloor = floorNow;
    }
    return out;
  }
  function series(dept, metric) { return metric === 'timeout' ? timeoutDailyFor(dept) : metric === 'exception' ? exceptionDailyFor(dept) : dailyFor(dept, metric); }

  function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
  function sum(arr) { return arr.reduce((a, b) => a + b, 0); }

  // 当前筛选条件（科室 + 本周/本月/本季/自定义）对应的起止日期下标区间
  function rangeIdx() {
    if (period === '本周') return [clampIdx(N_DAYS - 7), N_DAYS - 1];
    if (period === '本月') return [clampIdx(N_DAYS - 28), N_DAYS - 1];
    if (period === '本季') return [0, N_DAYS - 1];
    // 自定义：按用户输入的起止日期换算下标，超出可用的近30天范围会被裁剪
    const s = clampIdx(dayIdx(customStart)), e = clampIdx(dayIdx(customEnd));
    return s <= e ? [s, e] : [e, s];
  }
  function prevRangeIdx(cur) {
    const len = cur[1] - cur[0] + 1;
    return [clampIdx(cur[0] - len), clampIdx(cur[0] - 1)];
  }
  function labelsFor(range) {
    const wk = ['一', '二', '三', '四', '五', '六', '日'];
    const [s, e] = range;
    const n = e - s + 1;
    if (period === '本周' && n === 7) return wk;
    if (period === '本月') {
      // 按 4 段（每段约 7 天）聚合展示，标签用“第N周”
      return ['第1周', '第2周', '第3周', '第4周'];
    }
    if (period === '本季') return ['前10天', '中10天', '近10天'];
    // 自定义：日期过多时按 MM-DD 抽样展示，避免横轴过密
    const step = Math.max(1, Math.ceil(n / 12));
    const out = [];
    for (let i = s; i <= e; i += step) out.push(dateAt(i).slice(5));
    if (out[out.length - 1] !== dateAt(e).slice(5)) out.push(dateAt(e).slice(5));
    return out;
  }
  function bucketed(dept, metric, range) {
    const raw = series(dept, metric);
    const [s, e] = range;
    const slice = raw.slice(s, e + 1);
    if (period === '本周') return slice;
    if (period === '本月') { // 4 段均值
      const chunks = chunkInto(slice, 4);
      return chunks.map(avg).map(v => Math.round(v * 10) / 10);
    }
    if (period === '本季') {
      const chunks = chunkInto(slice, 3);
      return chunks.map(avg).map(v => Math.round(v * 10) / 10);
    }
    // 自定义：按抽样步长聚合，与 labelsFor 的抽样点数对齐
    const step = Math.max(1, Math.ceil(slice.length / 12));
    const out = [];
    for (let i = 0; i < slice.length; i += step) out.push(Math.round(avg(slice.slice(i, i + step)) * 10) / 10);
    return out;
  }
  function chunkInto(arr, n) {
    const size = Math.ceil(arr.length / n) || 1;
    const out = [];
    for (let i = 0; i < n; i++) out.push(arr.slice(i * size, (i + 1) * size).length ? arr.slice(i * size, (i + 1) * size) : [arr[arr.length - 1] || 0]);
    return out;
  }

  window.PAGES['#/report'] = function (view) {
    const role = AUTH.currentRole();
    const isMgmt = role === '医院管理部门';
    if (!isMgmt && !['心血管内科', '普外科', '神经内科', '急诊科'].includes(scope)) scope = '心血管内科';
    if (!isMgmt) scope = '心血管内科';

    const orgs = FHIR.search('Organization', o => o.active, null, { silent: true });
    const range = rangeIdx();
    const prevRange = prevRangeIdx(range);

    function kpiVal(metric) { return avg(series(scope, metric).slice(range[0], range[1] + 1)); }
    function kpiPrev(metric) { return avg(series(scope, metric).slice(prevRange[0], prevRange[1] + 1)); }
    const attendNow = Math.round(kpiVal('attend')), attendPrev = Math.round(kpiPrev('attend'));
    const ontimeNow = Math.round(kpiVal('ontime')), ontimePrev = Math.round(kpiPrev('ontime'));
    const conflictNow = Math.round(kpiVal('conflict') * 10) / 10, conflictPrev = Math.round(kpiPrev('conflict') * 10) / 10;
    const excNow = Math.round(sum(series(scope, 'exception').slice(range[0], range[1] + 1)));
    const excPrev = Math.round(sum(series(scope, 'exception').slice(prevRange[0], prevRange[1] + 1)));

    view.innerHTML = `
      <div class="page-head"><div><h2>值班质量报告</h2>
        <div class="desc">查看值班质量评价报告与统计分析，对全院值班制度执行情况进行数据化、精细化管理。${isMgmt ? '' : '（科室负责人仅可见本科室数据）'}</div></div></div>

      <div class="card">
        <div class="toolbar">
          <label>科室</label>
          <select class="select" id="scope" style="width:150px" ${isMgmt ? '' : 'disabled'}>
            ${isMgmt ? `<option ${scope === '全院' ? 'selected' : ''}>全院</option>` : ''}
            ${orgs.map(o => `<option ${scope === o.name ? 'selected' : ''}>${o.name}</option>`).join('')}
          </select>
          <label>时间</label>
          <span>${['本周', '本月', '本季', '自定义'].map(p => `<span class="pill ${p === period ? 'active' : ''}" data-period="${p}">${p}</span>`).join(' ')}</span>
          ${period === '自定义' ? `
          <input class="input" type="date" id="cs" min="${DAY0}" max="${TODAY}" value="${customStart}" style="width:150px">
          <span class="muted-text">~</span>
          <input class="input" type="date" id="ce" min="${DAY0}" max="${TODAY}" value="${customEnd}" style="width:150px">
          <button class="btn sm" id="applyCustom">应用</button>` : ''}
          <span class="spacer"></span>
          <button class="btn" id="export">⬇ 导出报告</button>
        </div>
        ${period === '自定义' ? `<div class="muted-text" style="font-size:12px;margin-top:8px">已应用自定义统计区间：${dateAt(range[0])} ~ ${dateAt(range[1])}（可选范围为近30天：${DAY0} ~ ${TODAY}，超出部分已自动裁剪）</div>` : ''}
      </div>

      <div class="grid-4">
        ${kpi('到岗率', attendNow + '%', delta(attendNow, attendPrev, '%', true))}
        ${kpi('交接及时率', ontimeNow + '%', delta(ontimeNow, ontimePrev, '%', true))}
        ${kpi('排班冲突率', conflictNow + '%', delta(conflictNow, conflictPrev, '%', false))}
        ${kpi('异常事件数', excNow + ' 件', delta(excNow, excPrev, ' 件', false))}
      </div>

      <div class="card">
        <div class="card-title">趋势分析 <span class="sub">粒度随上方“本周/本月/本季/自定义”联动，${scope}</span></div>
        <div class="grid-2">
          ${trend('到岗率趋势', 'attend', '#52C41A', '%')}
          ${trend('交接及时率趋势', 'ontime', '#1677FF', '%')}
          ${trend('排班冲突率趋势', 'conflict', '#FAAD14', '%')}
          ${trend('交接超时率趋势', 'timeout', '#FF4D4F', '%')}
        </div>
      </div>

      ${isMgmt && scope === '全院' ? `<div class="card">
        <div class="card-title">科室对比分析 <span class="sub">⚠ 标记薄弱科室（到岗率<90% 或 异常>5件）</span></div>
        <div class="grid-3">
          <div><div style="margin-bottom:8px"><b>到岗率对比</b></div>
            ${U.hbar(deptCompare('attend').map(r => ({ ...r, label: r.v + '%' })), { max: 100, warn: v => v < 90 })}</div>
          <div><div style="margin-bottom:8px"><b>交接及时率对比</b></div>
            ${U.hbar(deptCompare('ontime').map(r => ({ ...r, label: r.v + '%' })), { max: 100, warn: v => v < 90 })}</div>
          <div><div style="margin-bottom:8px"><b>异常事件数对比</b></div>
            ${U.hbar(deptCompare('exception').map(r => ({ ...r, label: r.v + '件' })), { max: 8, warn: v => v > 5 })}</div>
        </div>
      </div>` : ''}`;

    function deptCompare(metric) {
      return ['心血管内科', '普外科', '神经内科', '急诊科'].map(k => ({
        k, v: metric === 'exception' ? Math.round(sum(series(k, metric).slice(range[0], range[1] + 1))) : Math.round(avg(series(k, metric).slice(range[0], range[1] + 1))),
      }));
    }

    if (isMgmt) U.$('#scope', view).addEventListener('change', e => { scope = e.target.value; Router.render(); });
    U.delegate(view, 'click', '[data-period]', (e, t) => { period = t.dataset.period; Router.render(); });
    const applyCustom = U.$('#applyCustom', view);
    if (applyCustom) applyCustom.addEventListener('click', () => {
      customStart = U.$('#cs', view).value; customEnd = U.$('#ce', view).value;
      U.toast(`已应用自定义统计区间 ${customStart} ~ ${customEnd}`, 'success'); Router.render();
    });
    U.$('#export', view).addEventListener('click', () => U.toast(`正在导出「${scope} · ${period === '自定义' ? customStart + '~' + customEnd : period}」值班质量评价报告（PDF）…（演示）`, 'info', 3000));
  };

  function kpi(label, val, deltaHtml) {
    return `<div class="kpi"><div class="label">${label}</div><div class="value">${val}</div>${deltaHtml}</div>`;
  }
  // higherIsBetter：到岗率/交接及时率数值越高越好（绿色）；排班冲突率/异常事件数越低越好（数值下降才是绿色）
  function delta(now, prev, unit, higherIsBetter) {
    const d = Math.round((now - prev) * 10) / 10;
    if (d === 0) return `<div class="delta">— 与上期持平</div>`;
    const improved = higherIsBetter ? d > 0 : d < 0;
    return `<div class="delta ${improved ? 'up' : 'down'}">${d > 0 ? '↑' : '↓'} 较上期 ${Math.abs(d)}${unit}</div>`;
  }
  function trend(title, key, color, unit) {
    const range = rangeIdx();
    const labels = labelsFor(range);
    const data = bucketed(scope, key, range);
    const pts = labels.map((k, i) => ({ k, v: data[i] ?? data[data.length - 1] ?? 0 }));
    const max = key === 'attend' || key === 'ontime' ? 100 : null;
    return `<div><div style="margin-bottom:6px"><b>${title}</b> <span class="muted-text" style="font-size:12px">单位：${unit}</span></div>
      ${U.lineChart(pts, { color, max, min: 0, w: 420 })}</div>`;
  }
})();
