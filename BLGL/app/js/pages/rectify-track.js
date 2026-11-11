/* ============== L3-2-1 整改任务追踪（科室负责人 / 质量管理部门） ============== */
App.registerPage('rectify-track', (user, params, ctx) => {
  const F = window.FHIR, U = window.UI, B = window.Biz, E = window.EMR;
  const esc = U.esc;
  const isQC = user.role === 'qc';
  const orgs = F.col('Organization').filter(o => o.type === '临床科室');
  const st = { org: isQC ? 'all' : user.org, kw: '', resp: '', no: '', status: params.status || 'all', source: 'all', from: '', to: '', expand: {} };

  function groups() {
    let tasks = B.visibleTasks(user, { org: st.org });
    if (st.kw) tasks = tasks.filter(t => t.patientName.includes(st.kw));
    if (st.resp) tasks = tasks.filter(t => F.userName(t.doctor).includes(st.resp));
    if (st.no) tasks = tasks.filter(t => t.id.includes(st.no));
    if (st.source !== 'all') tasks = tasks.filter(t => t.source === st.source);
    if (st.from) tasks = tasks.filter(t => new Date(t.dueAt) >= new Date(st.from));
    if (st.to) tasks = tasks.filter(t => new Date(t.dueAt) <= new Date(st.to + 'T23:59:59'));
    const byEnc = {};
    tasks.forEach(t => { (byEnc[t.encounter] = byEnc[t.encounter] || []).push(t); });
    let arr = Object.entries(byEnc).map(([encId, ts]) => {
      const enc = F.byId('Encounter', encId);
      const pending = ts.filter(t => t.status === '待整改');
      const overdue = ts.some(B.isOverdueTask);
      const status = pending.length ? (overdue ? '超时未整改' : '待整改') : '已完成';
      return { enc, ts, pending: pending.length, overdue, status, source: ts[0].source,
        due: pending.length ? pending.map(t => t.dueAt).sort().slice(-1)[0] : null };
    });
    if (st.status !== 'all') arr = arr.filter(g => st.status === '超时未整改' ? g.overdue : g.status === st.status);
    arr.sort((a, b) => (b.overdue - a.overdue) || ((b.status === '待整改') - (a.status === '待整改')));
    return arr;
  }

  const el = U.h(`<div class="page"></div>`);
  function render() {
    const all = B.visibleTasks(user, { org: st.org });
    const total = all.length, done = all.filter(t => t.status === '已完成').length, overdue = all.filter(B.isOverdueTask).length;
    const rate = total ? Math.round(done / total * 100) : 0;
    const gs = groups();
    el.innerHTML = `
      ${App.crumb('rectify-track')}
      <div class="page-head"><h1 class="page-title">整改任务追踪</h1><div class="desc">${isQC ? '全院' : '本科室'}整改任务执行进度与复核结果，对超时未整改任务可一键催办</div></div>
      <div class="stat-grid">
        <div class="stat"><div class="ic">📋</div><div class="lab">任务总数</div><div class="val">${total}</div></div>
        <div class="stat"><div class="ic">✅</div><div class="lab">已完成数</div><div class="val">${done}</div></div>
        <div class="stat ${overdue > 0 ? 'danger' : ''}"><div class="ic">⏰</div><div class="lab">超时未整改数</div><div class="val">${overdue}</div></div>
        <div class="stat ${rate < 90 ? 'warn' : ''}"><div class="ic">📊</div><div class="lab">完成率</div><div class="val">${rate}%</div></div>
      </div>
      <div class="filters">
        <div class="fld"><label>科室</label><select id="forg" ${isQC ? '' : 'disabled'}>
          <option value="all">全部科室</option>${orgs.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></div>
        <div class="fld"><label>患者</label><input id="fkw" value="${esc(st.kw)}" placeholder="姓名/住院号"></div>
        <div class="fld"><label>责任人</label><input id="fresp" value="${esc(st.resp)}" placeholder="医生姓名"></div>
        <div class="fld"><label>任务编号</label><input id="fno" value="${esc(st.no)}"></div>
        <div class="fld"><label>状态</label><select id="fst"><option value="all">全部</option><option value="待整改">待整改</option><option value="已完成">已完成</option><option value="超时未整改">超时未整改</option></select></div>
        <div class="fld"><label>来源</label><select id="fsrc"><option value="all">全部</option><option value="环节质控">环节质控</option><option value="终末质控">终末质控拦截</option></select></div>
        <div class="fld"><label>截止日期</label><div class="flex" style="gap:6px"><input type="date" id="ffrom" value="${esc(st.from)}" style="min-width:140px"><span class="muted">~</span><input type="date" id="fto" value="${esc(st.to)}" style="min-width:140px"></div></div>
      </div>
      <div class="card"><div class="card-h"><h3>整改任务列表</h3><div class="right muted" style="font-size:12px">超时未整改置顶高亮</div></div>
        <div class="card-b" style="padding:0"><table>
          <thead><tr><th>患者</th><th>住院/门诊号</th><th>科室/床位</th><th>整改概要</th><th>来源</th><th>责任人</th><th>状态</th><th>截止日期</th><th>操作</th></tr></thead>
          <tbody id="tb"></tbody></table></div></div>`;
    el.querySelector('#forg').value = st.org; el.querySelector('#fst').value = st.status; el.querySelector('#fsrc').value = st.source;
    el.querySelector('#forg').onchange = e => { st.org = e.target.value; render(); };
    el.querySelector('#fkw').oninput = e => { const v = e.target.value; U.keepFocus(el, () => { st.kw = v; render(); }); };
    el.querySelector('#fresp').oninput = e => { const v = e.target.value; U.keepFocus(el, () => { st.resp = v; render(); }); };
    el.querySelector('#fno').oninput = e => { const v = e.target.value; U.keepFocus(el, () => { st.no = v; render(); }); };
    el.querySelector('#fst').onchange = e => { st.status = e.target.value; render(); };
    el.querySelector('#fsrc').onchange = e => { st.source = e.target.value; render(); };
    el.querySelector('#ffrom').onchange = e => { st.from = e.target.value; render(); };
    el.querySelector('#fto').onchange = e => { st.to = e.target.value; render(); };

    const tb = el.querySelector('#tb');
    if (!gs.length) { tb.innerHTML = `<tr><td colspan="9"><div class="empty-box"><div class="em">📋</div>暂无整改任务</div></td></tr>`; return; }
    gs.forEach(g => {
      const open = st.expand[g.enc.id];
      const stPill = g.status === '超时未整改' ? `<span class="pill red">超时未整改</span>` : g.status === '待整改' ? `<span class="pill orange">待整改</span>` : `<span class="pill green">已完成</span>`;
      const summary = g.pending ? `🔴${g.pending}待整改` : `🟢${g.ts.length}项已完成`;
      const urge = g.overdue ? `<button class="linkbtn urge ${g.ts.some(t => t._urged) ? 'dis' : ''}" data-act="urge">${g.ts.some(t => t._urged) ? '今日已催办' : '催办通知'}</button>` : '';
      const tr = U.h(`<tr class="grp ${g.overdue ? 'row-hl' : ''}"><td><span class="expander">${open ? '▼' : '▶'}</span> ${esc(g.enc.patientName)}</td>
        <td>${esc(g.enc.mrn)}</td><td>${esc(F.orgName(g.enc.org))}/${esc(g.enc.bed || '—')}</td>
        <td>${summary}</td><td><span class="tag-soft">${esc(g.source)}</span></td><td>${esc(F.userName(g.enc.doctor))}</td>
        <td>${stPill}</td><td>${g.due ? F.mdhm(g.due) : '—'}</td>
        <td><div class="flex" style="gap:2px"><button class="linkbtn" data-act="detail">详情</button>${urge}</div></td></tr>`);
      tr.onclick = (ev) => { if (ev.target.tagName === 'BUTTON') return; st.expand[g.enc.id] = !open; render(); };
      tr.querySelectorAll('[data-act]').forEach(b => b.onclick = (ev) => { ev.stopPropagation();
        if (b.dataset.act === 'detail') openDetail(g);
        else doUrge(g); });
      tb.appendChild(tr);
      if (open) g.ts.forEach(t => tb.appendChild(U.h(`<tr class="child"><td>${esc(t.id)}</td><td>—</td><td>—</td>
        <td>${esc(t.requirement.slice(0, 26))}</td><td></td><td></td>
        <td>${t.status === '待整改' ? (B.isOverdueTask(t) ? '<span style="color:var(--c-red)">已超时</span>' : '待整改') : '已完成'}</td><td>${t.status === '待整改' ? F.mdhm(t.dueAt) : '—'}</td><td></td></tr>`)));
    });
  }

  function doUrge(g) {
    g.ts.filter(B.isOverdueTask).forEach(t => {
      t._urged = true;
      F.col('Communication').push({ resourceType: 'Communication', id: F.uid('com'), category: '催办', to: t.doctor,
        subject: g.enc.patientName, sentAt: F.NOW().toISOString(), read: false,
        text: `【整改催办提醒】${g.enc.patientName}的病历整改任务已超时，请尽快完成整改。任务编号：${t.id}` });
    });
    F.save();
    U.toast(`已向 ${F.userName(g.enc.doctor)} 发送催办通知（站内消息+短信）`, 'ok', 3000);
    render();
  }

  function openDetail(g) {
    const enc = g.enc;
    const body = U.h(`<div>
      <div class="tabs"><div class="tab on" data-t="1">整改任务详情</div><div class="tab" data-t="2">患者病历</div></div>
      <div class="tab-body"></div></div>`);
    const tbody = body.querySelector('.tab-body');
    function tab1() {
      tbody.innerHTML = `
        <div class="kv" style="margin-bottom:12px"><b>患者</b><span>${esc(enc.patientName)}（${esc(F.orgName(enc.org))}/${esc(enc.bed || '—')}）</span>
          <b>责任人</b><span>${esc(F.userName(enc.doctor))}</span><b>来源</b><span>${esc(g.source)}</span>
          <b>状态</b><span>${g.status === '已完成' ? '🟢已完成' : '🔴待整改'}</span></div>
        <div class="sec-title">整改任务列表</div>
        <table><thead><tr><th>任务编号</th><th>问题类型</th><th>整改要求摘要</th><th>状态</th><th>截止时间</th></tr></thead><tbody>
        ${g.ts.map(t => `<tr class="taskrow" data-id="${t.id}" style="cursor:pointer"><td>${esc(t.id)}</td><td>${esc(t.problemType)}</td>
          <td>${esc(t.requirement.slice(0, 24))}</td><td>${t.status === '待整改' ? (B.isOverdueTask(t) ? '<span style="color:var(--c-red)">待整改/已超时</span>' : '待整改') : '已完成'}</td><td>${F.mdhm(t.dueAt)}</td></tr>
          <tr class="exp" data-for="${t.id}" style="display:none"><td colspan="5"><div style="background:#fafbfc;border-radius:8px;padding:10px 12px;font-size:12.5px">
            <div><b>问题类型：</b>${esc(t.problemType)}</div><div><b>问题位置：</b>${esc(t.location)}</div>
            <div><b>整改要求：</b>${esc(t.requirement)}</div></div></td></tr>`).join('')}
        </tbody></table>
        <div class="sec-title">整改记录时间线</div>
        <div class="timeline">${(g.ts[0].timeline || []).map(e => `<div class="tl-item ${e.muted ? 'muted' : ''}"><div class="tt">${esc(e.tt)} <span class="mt">${F.mdhm(e.at)}</span></div>${e.note ? `<div class="by">${esc(e.note)}</div>` : ''}<div class="by">${esc(e.by || '')}</div></div>`).join('')}</div>`;
      tbody.querySelectorAll('.taskrow').forEach(r => r.onclick = () => { const x = tbody.querySelector(`.exp[data-for="${r.dataset.id}"]`); x.style.display = x.style.display === 'none' ? '' : 'none'; });
    }
    function tab2() {
      tbody.innerHTML = `<div class="banner warn">⚠️ 此患者有 ${g.pending} 项待整改任务，问题位置已用 🔴 标注（只读）</div>`;
      tbody.appendChild(E.build(enc.id, { readonly: true }).el);
    }
    tab1();
    body.querySelectorAll('.tab').forEach(t => t.onclick = () => {
      body.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
      t.dataset.t === '1' ? tab1() : tab2();
    });
    const m = U.fullpage({ title: `整改任务 — ${enc.patientName}`, subtitle: `${F.orgName(enc.org)} / ${enc.bed || '—'}`, body,
      footer: `<button class="btn pri close">关闭</button>` });
    m.el.querySelector('.close').onclick = m.close;
  }

  render();
  // 首页待办事项点击进入：直接定位打开该患者的整改任务详情
  if (params.encId) {
    const g = groups().find(x => x.enc.id === params.encId);
    if (g) openDetail(g);
  }
  return el;
});
