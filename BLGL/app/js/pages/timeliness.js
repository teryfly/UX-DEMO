/* ============== L3-2-4 书写及时率统计（质量管理部门 / 科室负责人） ============== */
App.registerPage('timeliness', (user, params, ctx) => {
  const F = window.FHIR, U = window.UI, B = window.Biz;
  const esc = U.esc;
  const isQC = user.role === 'qc';
  const orgs = F.col('Organization').filter(o => o.type === '临床科室');
  const st = { org: isQC ? 'all' : user.org, doctor: '', docType: 'all', gran: '按月', chart: 'line' };

  // 统计粒度切换查询：不同粒度返回不同跨度/密度的趋势数据点
  function granTrend(gran, org) {
    const months = B.monthSeries(org === 'all' ? 'all' : org);
    const last = months[months.length - 1].y;
    if (gran === '按日') return Array.from({ length: 14 }, (_, i) => ({ x: `06-${7 + i}`, y: Math.max(60, Math.min(99, last - 6 + Math.round(Math.sin(i) * 4) + i * 0.4)) }));
    if (gran === '按周') return Array.from({ length: 8 }, (_, i) => ({ x: `第${i + 1}周`, y: Math.max(60, Math.min(99, last - 7 + i)) }));
    if (gran === '按季') return ['Q1', 'Q2', 'Q3', 'Q4'].map((q, i) => ({ x: q, y: Math.max(60, Math.min(99, last - 6 + i * 2)) }));
    return months; // 按月
  }

  // 明细数据表（科室→医师→文书类型 + 小计 + 科室合计）
  function tableRows() {
    let encs = F.col('Encounter').filter(e => st.org === 'all' || e.org === st.org);
    // 聚合 org->doctor->type
    const agg = {};
    encs.forEach(e => B.docsOf(e.id).forEach(d => {
      if (!d.deadlineAt) return;
      if (st.docType !== 'all' && d.type !== st.docType) return;
      if (st.doctor && !F.userName(e.doctor).includes(st.doctor)) return;
      const key = `${e.org}||${e.doctor}||${d.type}`;
      const a = agg[key] = agg[key] || { org: e.org, doctor: e.doctor, type: d.type, total: 0, onTime: 0, over: 0 };
      // 统计口径独立于展示文案："已超时"标签只用于尚未完成的文书；
      // 已完成但迟交的文书（合规但超时）在统计里仍计入超时，与 Biz.timelinessStats 保持一致
      const c = B.docCompliance(d); const over = d.completedAt ? c.overMs != null : c.code === 'over';
      a.total++; if (d.completedAt && !over) a.onTime++; if (over) a.over++;
    }));
    // 组织成层级行
    const out = [];
    const byOrg = {};
    Object.values(agg).forEach(a => (byOrg[a.org] = byOrg[a.org] || []).push(a));
    Object.entries(byOrg).forEach(([org, items]) => {
      const byDoc = {};
      items.forEach(a => (byDoc[a.doctor] = byDoc[a.doctor] || []).push(a));
      let oT = 0, oO = 0, oV = 0;
      Object.entries(byDoc).forEach(([doc, arr]) => {
        let t = 0, on = 0, ov = 0;
        arr.forEach(a => { out.push({ kind: 'row', org, doctor: doc, type: a.type, total: a.total, onTime: a.onTime, over: a.over }); t += a.total; on += a.onTime; ov += a.over; });
        out.push({ kind: 'sub', org, doctor: doc, type: '小计', total: t, onTime: on, over: ov });
        oT += t; oO += ov; oV += on;
      });
      out.push({ kind: 'dept', org, doctor: '—', type: '科室合计', total: oT, onTime: oV, over: oO });
    });
    return out;
  }

  const el = U.h(`<div class="page"></div>`);
  function render() {
    const ts = B.timelinessStats({ org: st.org, docType: st.docType });
    const trend = granTrend(st.gran, st.org);
    const depts = B.deptStats().map(d => ({ name: d.name, onTime: d.rate, over: 100 - d.rate }));
    const rows = tableRows();

    el.innerHTML = `
      ${App.crumb('timeliness')}
      <div class="page-head"><h1 class="page-title">书写及时率统计</h1><div class="desc">按科室、医师、文书类型多维度分析书写及时率，支持趋势对比与报表导出</div></div>
      <div class="filters">
        <div class="fld"><label>科室</label><select id="forg" ${isQC ? '' : 'disabled'}>${isQC ? '<option value="all">全部</option>' : ''}${orgs.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></div>
        <div class="fld"><label>医师</label><input id="fdoc" value="${esc(st.doctor)}" placeholder="模糊搜索"></div>
        <div class="fld"><label>文书类型</label><select id="ftype"><option value="all">全部</option>${F.DOC_TYPES.map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
        <div class="fld"><label>统计粒度</label><select id="fgran"><option>按日</option><option>按周</option><option>按月</option><option>按季</option></select></div>
        <div class="fld"><label>&nbsp;</label><div class="btn-row"><button class="btn pri" id="bq">查询</button><button class="btn" id="br">重置</button><button class="btn" id="be">导出报表</button></div></div>
      </div>
      <div class="stat-grid">
        <div class="stat"><div class="ic">📄</div><div class="lab">文书总数</div><div class="val">${ts.total}</div></div>
        <div class="stat"><div class="ic">✅</div><div class="lab">及时完成数</div><div class="val">${ts.onTime}</div></div>
        <div class="stat ${ts.over > 0 ? 'warn' : ''}"><div class="ic">⏰</div><div class="lab">超时数</div><div class="val">${ts.over}</div></div>
        <div class="stat ${ts.rate < 80 ? 'warn' : ''}"><div class="ic">📊</div><div class="lab">及时率</div><div class="val">${ts.rate}%</div></div>
      </div>
      <div class="wrap-note" style="text-align:right;margin-top:-10px;margin-bottom:14px">考核同步：<span class="pill green">✅ 已同步 06-20 08:00</span> 至绩效考核系统</div>
      <div class="cols ${isQC ? 'c-1-1' : ''}">
        <div class="card"><div class="card-h"><h3>书写及时率趋势</h3>
          <div class="right"><button class="btn sm ${st.chart === 'line' ? 'pri' : ''}" data-chart="line">折线图</button><button class="btn sm ${st.chart === 'bar' ? 'pri' : ''}" data-chart="bar">柱状图</button></div></div>
          <div class="card-b">${st.chart === 'bar' ? U.barChart(trend.map(p => ({ name: p.x, onTime: p.y, over: 0 }))) : U.lineChart(trend, { min: 60 })}
          ${isQC && st.org === 'all' ? '<div class="legend"><span><i style="background:#1d6fd6"></i>全院平均</span></div>' : ''}</div></div>
        ${isQC ? `<div class="card"><div class="card-h"><h3>各科室及时率对比</h3></div><div class="card-b">${U.barChart(depts)}
          <div class="legend"><span><i style="background:#1d6fd6"></i>及时完成</span><span><i style="background:#e2483d99"></i>超时</span></div></div></div>` : ''}
      </div>
      <div class="card"><div class="card-h"><h3>书写及时率数据表</h3><div class="right muted" style="font-size:12px">科室 → 医师 → 文书类型</div></div>
        <div class="card-b" style="padding:0"><table><thead><tr><th>科室</th><th>医师</th><th>文书类型</th><th>文书总数</th><th>及时完成</th><th>超时数</th><th>及时率</th><th>环比</th></tr></thead>
        <tbody>${rows.length ? rows.map(r => {
          const rate = r.total ? Math.round(r.onTime / r.total * 1000) / 10 : 0;
          const cls = r.kind === 'sub' ? 'sub' : r.kind === 'dept' ? 'dept-total' : '';
          const env = ['▲+5%', '▼-2%', '▲+3%', '▼-1%', '▲+1%'][Math.abs((r.type || '').length) % 5];
          const down = env.includes('▼');
          return `<tr class="${cls}"><td>${esc(F.orgName(r.org))}</td><td>${esc(r.doctor === '—' ? '—' : F.userName(r.doctor))}</td><td>${esc(r.type)}</td>
            <td>${r.total}</td><td>${r.onTime}</td><td>${r.over}</td>
            <td style="${rate < 80 ? 'color:var(--c-red);font-weight:600' : ''}">${rate}%</td>
            <td style="${down ? 'color:var(--c-red)' : 'color:var(--c-green)'}">${env}</td></tr>`;
        }).join('') : '<tr><td colspan="8"><div class="empty-box"><div class="em">📊</div>暂无统计记录</div></td></tr>'}</tbody></table></div></div>`;
    el.querySelector('#forg').value = st.org; el.querySelector('#ftype').value = st.docType; el.querySelector('#fgran').value = st.gran;
    el.querySelector('#fgran').onchange = e => { st.gran = e.target.value; render(); };
    el.querySelector('#bq').onclick = () => { st.org = el.querySelector('#forg').value; st.doctor = el.querySelector('#fdoc').value; st.docType = el.querySelector('#ftype').value; st.gran = el.querySelector('#fgran').value; render(); };
    el.querySelector('#br').onclick = () => { st.org = isQC ? 'all' : user.org; st.doctor = ''; st.docType = 'all'; st.gran = '按月'; render(); };
    el.querySelector('#be').onclick = () => U.toast('报表已导出（演示）：含汇总Sheet与明细Sheet，携带当前筛选条件', 'ok', 3200);
    el.querySelectorAll('[data-chart]').forEach(b => b.onclick = () => { st.chart = b.dataset.chart; render(); });
  }
  render();
  return el;
});
