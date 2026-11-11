/* ============== L3-2-3 病历质量概览（科室负责人 / 质量管理部门） ============== */
App.registerPage('quality', (user, params, ctx) => {
  const F = window.FHIR, U = window.UI, B = window.Biz;
  const esc = U.esc;
  const isQC = user.role === 'qc';
  const orgs = F.col('Organization').filter(o => o.type === '临床科室');
  const st = { org: isQC ? 'all' : user.org, range: '本月', customFrom: '', customTo: '' };

  const el = U.h(`<div class="page"></div>`);
  function render() {
    const ts = B.timelinessStats({ org: st.org });
    let tasks = F.col('Task').filter(t => st.org === 'all' || t.org === st.org);
    if (st.range === '自定义' && (st.customFrom || st.customTo)) {
      tasks = tasks.filter(t => (!st.customFrom || new Date(t.createdAt) >= new Date(st.customFrom)) && (!st.customTo || new Date(t.createdAt) <= new Date(st.customTo + 'T23:59:59')));
    }
    const done = tasks.filter(t => t.status === '已完成').length;
    const overdue = tasks.filter(B.isOverdueTask).length;
    const fixRate = tasks.length ? Math.round(done / tasks.length * 100) : 100;
    const dist = B.issueDistribution(st.org);
    const trend = B.rangeSeries(st.org === 'all' ? 'all' : st.org, st.range);
    const depts = B.deptStats();
    const rangeLabel = st.range === '自定义' && (st.customFrom || st.customTo)
      ? `${st.customFrom || '…'} ~ ${st.customTo || '…'}` : st.range;

    el.innerHTML = `
      ${App.crumb('quality')}
      <div class="page-head"><h1 class="page-title">病历质量概览</h1><div class="desc">${isQC ? '全院病历质量概况，定位问题科室' : '本科室病历质量态势，发现异常'}</div></div>
      <div class="filters">
        <div class="fld"><label>科室</label><select id="forg" ${isQC ? '' : 'disabled'}>
          ${isQC ? '<option value="all">全院</option>' : ''}${orgs.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></div>
        <div class="fld"><label>时间范围</label><select id="frange"><option>本月</option><option>上月</option><option>近3月</option><option>近6月</option><option value="自定义">自定义</option></select></div>
        ${st.range === '自定义' ? `<div class="fld"><label>自定义日期</label><div class="flex" style="gap:6px">
          <input type="date" id="fcfrom" value="${esc(st.customFrom)}" style="min-width:140px"><span class="muted">~</span>
          <input type="date" id="fcto" value="${esc(st.customTo)}" style="min-width:140px"></div></div>` : ''}
      </div>
      <div class="stat-grid">
        <div class="stat ${ts.rate < 80 ? 'warn' : ''}"><div class="ic">📈</div><div class="lab">书写及时率</div><div class="val">${ts.rate}%</div><div class="trend up">▲ 较上期 +3%</div></div>
        <div class="stat"><div class="ic">⚠️</div><div class="lab">质控异常数</div><div class="val">${tasks.length}</div><div class="trend down">▼ 较上期 -2</div></div>
        <div class="stat"><div class="ic">✅</div><div class="lab">整改完成率</div><div class="val">${fixRate}%</div><div class="trend up">▲ 较上期 +5%</div></div>
        <div class="stat ${overdue > 0 ? 'danger' : ''}"><div class="ic">⏰</div><div class="lab">整改超时数</div><div class="val">${overdue}</div><div class="trend down">▼ 较上期 -1</div></div>
      </div>
      <div class="cols c-1-1">
        <div class="card"><div class="card-h"><h3>书写及时率趋势</h3><div class="right muted" style="font-size:12px">${esc(rangeLabel)}</div></div>
          <div class="card-b">${U.lineChart(trend, { min: 60, label: `${isQC && st.org === 'all' ? '全院平均' : F.orgName(st.org)}及时率 ${trend[trend.length - 1].y}%` })}</div></div>
        <div class="card"><div class="card-h"><h3>质控异常分布</h3></div>
          <div class="card-b"><div class="flex" style="gap:22px;align-items:center">
            <div>${U.donut(dist)}</div>
            <div class="dist" style="flex:1">${dist.map(d => `<div class="it"><span class="sw" style="background:${d.color}"></span><span class="nm">${esc(d.type)}</span><span class="ct">${d.count} · ${d.pct}%</span></div>`).join('') || '<div class="muted">暂无数据</div>'}</div>
          </div></div></div>
      </div>
      ${isQC ? `<div class="card"><div class="card-h"><h3>科室对比排行</h3><div class="right muted" style="font-size:12px">按书写及时率降序</div></div>
        <div class="card-b" style="padding:0"><table><thead><tr><th>排名</th><th>科室</th><th>书写及时率</th><th>质控异常数</th><th>整改完成率</th><th>超时未整改</th></tr></thead>
        <tbody>${depts.map(d => `<tr>
          <td>${d.rank}</td><td>${esc(d.name)}</td>
          <td style="${d.rate < 80 ? 'color:var(--c-red);font-weight:600' : ''}">${d.rate}%</td>
          <td>${d.issues}</td>
          <td style="${d.fixRate < 75 ? 'color:var(--c-red);font-weight:600' : ''}">${d.fixRate}%</td>
          <td style="${d.overdue > 3 ? 'color:var(--c-red);font-weight:600' : ''}">${d.overdue}</td></tr>`).join('')}</tbody></table>
        <div class="wrap-note" style="padding:0 16px 14px">⚠️ 红色标注：书写及时率&lt;80% 或 整改完成率&lt;75% 或 超时未整改&gt;3 的科室</div></div></div>` : ''}
      <div class="wrap-note">💡 点击异常分布可下钻至「整改任务追踪」查看对应类型的整改任务</div>`;
    el.querySelector('#forg').value = st.org;
    el.querySelector('#forg').onchange = e => { st.org = e.target.value; render(); };
    el.querySelector('#frange').value = st.range;
    el.querySelector('#frange').onchange = e => { st.range = e.target.value; render(); };
    const cf = el.querySelector('#fcfrom'), ct = el.querySelector('#fcto');
    if (cf) cf.onchange = e => { st.customFrom = e.target.value; render(); };
    if (ct) ct.onchange = e => { st.customTo = e.target.value; render(); };
    // 异常分布下钻
    el.querySelectorAll('.dist .it').forEach((it, i) => it.onclick = () => ctx.go('rectify-track'));
  }
  render();
  return el;
});
