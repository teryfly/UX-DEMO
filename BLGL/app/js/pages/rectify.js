/* ============== L3-1-2 整改任务处理（临床医生） ============== */
App.registerPage('rectify', (user, params, ctx) => {
  const F = window.FHIR, U = window.UI, B = window.Biz, S = window.Shared;
  const esc = U.esc;
  const st = { kw: params.kw || '', no: '', status: 'all', source: 'all', expand: {} };
  if (params.encId) { const e = F.byId('Encounter', params.encId); if (e) st.kw = e.patientName; }

  // 按患者分组任务
  function groups() {
    let tasks = B.visibleTasks(user);
    const byEnc = {};
    tasks.forEach(t => { (byEnc[t.encounter] = byEnc[t.encounter] || []).push(t); });
    let arr = Object.entries(byEnc).map(([encId, ts]) => {
      const enc = F.byId('Encounter', encId);
      const pending = ts.filter(t => t.status === '待整改');
      const status = pending.length ? '待整改' : '已完成';
      const source = ts[0].source;
      const due = pending.length ? pending.map(t => t.dueAt).sort().slice(-1)[0] : null;
      return { enc, ts, pending: pending.length, status, source, due };
    });
    if (st.kw) arr = arr.filter(g => g.enc.patientName.includes(st.kw) || (g.enc.mrn || '').includes(st.kw));
    if (st.no) arr = arr.filter(g => g.ts.some(t => t.id.includes(st.no)));
    if (st.status !== 'all') arr = arr.filter(g => g.status === st.status);
    if (st.source !== 'all') arr = arr.filter(g => g.source === st.source);
    arr.sort((a, b) => (b.status === '待整改') - (a.status === '待整改') || (new Date(a.due || 0) - new Date(b.due || 0)));
    return arr;
  }

  const el = U.h(`<div class="page"></div>`);
  function render() {
    const all = B.visibleTasks(user);
    const pending = all.filter(t => t.status === '待整改').length;
    const done = all.filter(t => t.status === '已完成').length;
    const gs = groups();
    el.innerHTML = `
      ${App.crumb('rectify')}
      <div class="page-head"><h1 class="page-title">整改任务处理</h1><div class="desc">查看质控异常下发的整改任务，编辑病历完成整改，系统自动复核（来源：环节质控 / 终末质控拦截）</div></div>
      <div class="stat-grid">
        <div class="stat ${pending > 0 ? 'warn' : ''}" data-f="待整改"><div class="ic">📋</div><div class="lab">待整改</div><div class="val">${pending}</div></div>
        <div class="stat" data-f="已完成"><div class="ic">✅</div><div class="lab">已完成</div><div class="val">${done}</div></div>
      </div>
      <div class="filters">
        <div class="fld"><label>患者姓名</label><input id="fkw" value="${esc(st.kw)}" placeholder="模糊搜索"></div>
        <div class="fld"><label>任务编号</label><input id="fno" value="${esc(st.no)}" placeholder="精确搜索"></div>
        <div class="fld"><label>状态</label><select id="fst"><option value="all">全部</option><option value="待整改">待整改</option><option value="已完成">已完成</option></select></div>
        <div class="fld"><label>来源</label><select id="fsrc"><option value="all">全部</option><option value="环节质控">环节质控</option><option value="终末质控">终末质控拦截</option></select></div>
      </div>
      <div class="card"><div class="card-h"><h3>整改任务列表</h3><div class="right muted" style="font-size:12px">患者分组 · 两级结构</div></div>
        <div class="card-b" style="padding:0"><table>
          <thead><tr><th>患者 / 任务编号</th><th>住院/门诊号</th><th>科室/床号</th><th>整改概要</th><th>来源</th><th>状态</th><th>截止日期</th><th>操作</th></tr></thead>
          <tbody id="tb"></tbody></table></div></div>`;
    el.querySelector('#fst').value = st.status; el.querySelector('#fsrc').value = st.source;
    el.querySelector('#fkw').oninput = e => { const v = e.target.value; U.keepFocus(el, () => { st.kw = v; render(); }); };
    el.querySelector('#fno').oninput = e => { const v = e.target.value; U.keepFocus(el, () => { st.no = v; render(); }); };
    el.querySelector('#fst').onchange = e => { st.status = e.target.value; render(); };
    el.querySelector('#fsrc').onchange = e => { st.source = e.target.value; render(); };
    el.querySelectorAll('[data-f]').forEach(c => c.onclick = () => { st.status = c.dataset.f; render(); });

    const tb = el.querySelector('#tb');
    if (!gs.length) { tb.innerHTML = `<tr><td colspan="8"><div class="empty-box"><div class="em">🎉</div>暂无整改任务</div></td></tr>`; return; }
    gs.forEach(g => {
      const open = st.expand[g.enc.id];
      const stPill = g.status === '待整改' ? `<span class="pill orange">🔴待整改</span>` : `<span class="pill green">🟢已完成</span>`;
      const summary = g.pending ? `🔴${g.pending}项待整改` : `🟢${g.ts.length}项已完成`;
      const op = g.status === '待整改' ? `<button class="linkbtn" data-act="fix">查看病历整改</button>` : `<button class="linkbtn" data-act="view">查看病历</button>`;
      const tr = U.h(`<tr class="grp"><td><span class="expander">${open ? '▼' : '▶'}</span> ${esc(g.enc.patientName)}</td>
        <td>${esc(g.enc.mrn)}</td><td>${esc(F.orgName(g.enc.org))}/${esc(g.enc.bed || '—')}</td>
        <td>${summary}</td><td><span class="tag-soft">${esc(g.source)}</span></td><td>${stPill}</td>
        <td>${g.due ? F.mdhm(g.due) : '—'}</td><td>${op}</td></tr>`);
      tr.onclick = (ev) => { if (ev.target.tagName === 'BUTTON') return; st.expand[g.enc.id] = !open; render(); };
      tr.querySelectorAll('[data-act]').forEach(b => b.onclick = (ev) => { ev.stopPropagation();
        if (b.dataset.act === 'fix') S.emrModal(g.enc.id, { mode: 'edit', onDone: render });
        else S.emrModal(g.enc.id, { mode: 'view', onDone: render }); });
      tb.appendChild(tr);
      if (open) g.ts.forEach(t => tb.appendChild(U.h(`<tr class="child"><td>${esc(t.id)}</td><td>—</td><td>—</td>
        <td>${esc(t.location)} · ${esc(t.requirement.slice(0, 22))}…</td><td></td>
        <td>${t.status === '待整改' ? (B.isOverdueTask(t) ? '<span style="color:var(--c-red)">已超时</span>' : '待整改') : '已完成'}</td><td>${t.status === '待整改' ? F.mdhm(t.dueAt) : '—'}</td><td></td></tr>`)));
    });
  }
  render();
  // 首页待办事项点击进入：直接定位打开该患者病历的整改编辑界面
  if (params.encId) {
    const enc = F.byId('Encounter', params.encId);
    if (enc) S.emrModal(enc.id, { mode: params.mode || 'edit', onDone: render });
  }
  return el;
});
