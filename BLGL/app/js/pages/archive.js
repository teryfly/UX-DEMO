/* ============== L3-2-2 病历归档管理（病案室，纯查看） ============== */
App.registerPage('archive', (user, params, ctx) => {
  const F = window.FHIR, U = window.UI, B = window.Biz, E = window.EMR;
  const esc = U.esc;
  const orgs = F.col('Organization').filter(o => o.type === '临床科室');
  const st = { org: 'all', kw: '', mrn: '', doc: '', status: 'all', from: '', to: '', page: 1 };

  function rows() {
    let encs = F.col('Encounter').filter(e => ['archiving', 'intercepted', 'archived'].includes(e.archiveStatus));
    if (st.org !== 'all') encs = encs.filter(e => e.org === st.org);
    if (st.status !== 'all') encs = encs.filter(e => e.archiveStatus === st.status);
    if (st.kw) encs = encs.filter(e => e.patientName.includes(st.kw));
    if (st.mrn) encs = encs.filter(e => (e.mrn || '').includes(st.mrn));
    if (st.doc) encs = encs.filter(e => F.userName(e.doctor).includes(st.doc));
    if (st.from) encs = encs.filter(e => e.archivedAt && new Date(e.archivedAt) >= new Date(st.from));
    if (st.to) encs = encs.filter(e => e.archivedAt && new Date(e.archivedAt) <= new Date(st.to + 'T23:59:59'));
    encs.sort((a, b) => new Date(b.archivedAt || b.submittedAt || 0) - new Date(a.archivedAt || a.submittedAt || 0));
    return encs;
  }

  const el = U.h(`<div class="page"></div>`);
  function render() {
    const archived = F.col('Encounter').filter(e => e.archiveStatus === 'archived');
    const monthN = archived.filter(e => e.archivedAt && new Date(e.archivedAt).getMonth() === F.NOW().getMonth() && new Date(e.archivedAt).getFullYear() === F.NOW().getFullYear()).length;
    const data = rows();
    const pg = U.paginate(data, st.page, 12);
    el.innerHTML = `
      ${App.crumb('archive')}
      <div class="page-head"><h1 class="page-title">病历归档管理</h1><div class="desc">系统自动执行终末质控，病案室查看质控结果与归档状态、检索已归档病历档案</div></div>
      <div class="stat-grid">
        <div class="stat"><div class="ic">🗄️</div><div class="lab">累计归档</div><div class="val">${200 + archived.length}</div></div>
        <div class="stat"><div class="ic">📅</div><div class="lab">本月归档</div><div class="val">${monthN}</div></div>
        <div class="stat"><div class="ic">🔍</div><div class="lab">终末质控中</div><div class="val">${F.col('Encounter').filter(e => e.archiveStatus === 'archiving').length}</div></div>
        <div class="stat ${F.col('Encounter').filter(e => e.archiveStatus === 'intercepted').length ? 'warn' : ''}"><div class="ic">🚫</div><div class="lab">已拦截</div><div class="val">${F.col('Encounter').filter(e => e.archiveStatus === 'intercepted').length}</div></div>
      </div>
      <div class="filters">
        <div class="fld"><label>科室</label><select id="forg"><option value="all">全部</option>${orgs.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></div>
        <div class="fld"><label>归档状态</label><select id="fst"><option value="all">全部</option><option value="archiving">终末质控中</option><option value="intercepted">已拦截</option><option value="archived">已归档</option></select></div>
        <div class="fld"><label>患者姓名</label><input id="fkw" value="${esc(st.kw)}"></div>
        <div class="fld"><label>住院号/门诊号</label><input id="fmrn" value="${esc(st.mrn)}"></div>
        <div class="fld"><label>责任医生</label><input id="fdoc" value="${esc(st.doc)}"></div>
        <div class="fld"><label>归档时间</label><div class="flex" style="gap:6px">
          <span class="clr-wrap"><input type="date" id="ffrom" value="${esc(st.from)}" style="min-width:140px">${st.from ? '<span class="clr-x" data-clr="from">✕</span>' : ''}</span>
          <span class="muted">~</span>
          <span class="clr-wrap"><input type="date" id="fto" value="${esc(st.to)}" style="min-width:140px">${st.to ? '<span class="clr-x" data-clr="to">✕</span>' : ''}</span></div></div>
      </div>
      <div class="card"><div class="card-h"><h3>归档病历列表</h3></div>
        <div class="card-b" style="padding:0"><table>
          <thead><tr><th>病历编号</th><th>住院号/门诊号</th><th>患者姓名</th><th>科室</th><th>责任医生</th><th>当前状态</th><th>时间</th><th>操作</th></tr></thead>
          <tbody id="tb"></tbody></table><div id="pager"></div></div></div>`;
    el.querySelector('#forg').value = st.org; el.querySelector('#fst').value = st.status;
    el.querySelector('#forg').onchange = e => { st.org = e.target.value; st.page = 1; render(); };
    el.querySelector('#fst').onchange = e => { st.status = e.target.value; st.page = 1; render(); };
    el.querySelector('#fkw').oninput = e => { const v = e.target.value; U.keepFocus(el, () => { st.kw = v; st.page = 1; render(); }); };
    el.querySelector('#fmrn').oninput = e => { const v = e.target.value; U.keepFocus(el, () => { st.mrn = v; st.page = 1; render(); }); };
    el.querySelector('#fdoc').oninput = e => { const v = e.target.value; U.keepFocus(el, () => { st.doc = v; st.page = 1; render(); }); };
    el.querySelector('#ffrom').onchange = e => { st.from = e.target.value; st.page = 1; render(); };
    el.querySelector('#fto').onchange = e => { st.to = e.target.value; st.page = 1; render(); };
    el.querySelectorAll('[data-clr]').forEach(x => x.onclick = () => { st[x.dataset.clr] = ''; st.page = 1; render(); });

    const tb = el.querySelector('#tb');
    if (!pg.slice.length) { tb.innerHTML = `<tr><td colspan="8"><div class="empty-box"><div class="em">🗄️</div>暂无归档记录</div></td></tr>`; }
    pg.slice.forEach(e => {
      const tr = U.h(`<tr><td>${esc(e.blNo || '—')}</td><td>${esc(e.mrn)}</td><td>${esc(e.patientName)}</td>
        <td>${esc(F.orgName(e.org))}</td><td>${esc(F.userName(e.doctor))}</td><td>${U.archiveBadge(e.archiveStatus)}</td>
        <td>${F.mdhm(e.archivedAt || e.submittedAt || e.admitAt)}</td><td><button class="linkbtn" data-act="detail">详情</button></td></tr>`);
      tr.querySelector('[data-act]').onclick = () => openDetail(e);
      tb.appendChild(tr);
    });
    const pgEl = U.pager(pg.page, pg.pages, p => { st.page = p; render(); });
    if (typeof pgEl === 'object') el.querySelector('#pager').replaceChildren(pgEl);
  }

  function openDetail(enc) {
    const prov = F.col('Provenance').find(p => p.encounter === enc.id);
    const body = U.h(`<div><div class="tabs"><div class="tab on" data-t="1">患者病历</div><div class="tab" data-t="2">归档流转</div></div><div class="tab-body"></div></div>`);
    const tbody = body.querySelector('.tab-body');
    function tab1() { tbody.innerHTML = ''; tbody.appendChild(E.build(enc.id, { readonly: true }).el); }
    function tab2() {
      // 归档流转记录始终由 Biz.submitArchive 累加维护（含拦截→整改→重新提交的完整链路），
      // 种子数据也已为所有归档中/已拦截/已归档病历补齐 Provenance，此处直接读取即可
      const events = prov ? prov.events : [{ at: F.fmt(enc.admitAt), tt: '入院', by: '系统' }];
      tbody.innerHTML = `<div class="kv" style="margin-bottom:14px"><b>病历编号</b><span>${esc(enc.blNo || '—')}</span><b>住院/门诊号</b><span>${esc(enc.mrn)}</span>
        <b>患者</b><span>${esc(enc.patientName)}（${esc(F.orgName(enc.org))}/${esc(enc.bed || '—')}）</span><b>责任医生</b><span>${esc(F.userName(enc.doctor))}</span>
        <b>归档时间</b><span>${enc.archivedAt ? F.fmt(enc.archivedAt) : '—'}</span></div>
        <div class="sec-title">归档流转记录</div>
        <div class="timeline">${events.map(e => `<div class="tl-item"><div class="tt">${esc(e.tt)} <span class="mt">${esc(F.mdhm(e.at))}</span></div>${e.note ? `<div class="by">${esc(e.note)}</div>` : ''}<div class="by">${esc(e.by || '')}</div></div>`).join('')}</div>`;
    }
    tab1();
    body.querySelectorAll('.tab').forEach(t => t.onclick = () => { body.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t)); t.dataset.t === '1' ? tab1() : tab2(); });
    const m = U.fullpage({ title: `归档详情 — ${enc.patientName}`, subtitle: `${F.orgName(enc.org)} / ${enc.bed || '—'} · ${enc.mrn}`, body, footer: `<button class="btn pri close">关闭</button>` });
    m.el.querySelector('.close').onclick = m.close;
  }

  render();
  // 首页待办事项点击进入：直接定位打开该病历的归档详情
  if (params.encId) {
    const enc = F.byId('Encounter', params.encId);
    if (enc) openDetail(enc);
  }
  return el;
});
