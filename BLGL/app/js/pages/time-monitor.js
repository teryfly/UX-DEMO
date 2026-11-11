/* ============== L3-1-1 病历书写时限监控（临床医生） ============== */
App.registerPage('time-monitor', (user, params, ctx) => {
  const F = window.FHIR, U = window.UI, B = window.Biz, S = window.Shared;
  const esc = U.esc;
  const st = { comp: 'all', arch: 'all', kw: '', page: 1, expand: {} };

  function data() {
    let encs = B.visibleEncounters(user);
    if (st.arch !== 'all') encs = encs.filter(e => e.archiveStatus === st.arch);
    if (st.kw) encs = encs.filter(e => e.patientName.includes(st.kw) || (e.mrn || '').includes(st.kw));
    // 排序：有超时/即将超时置顶
    encs = encs.map(e => ({ e, s: B.encSummary(e) }));
    encs.sort((a, b) => (b.s.over * 2 + b.s.soon) - (a.s.over * 2 + a.s.soon));
    return encs;
  }

  function summaryStats() {
    let total = 0, ok = 0, over = 0;
    B.visibleEncounters(user).forEach(e => { const s = B.encSummary(e); total += s.total; ok += s.ok; over += s.over; });
    return { total, ok, over, rate: total ? Math.round(ok / total * 100) : 0 };
  }

  const el = U.h(`<div class="page"></div>`);
  function render() {
    const ss = summaryStats();
    let rows = data();
    if (st.comp !== 'all') {
      if (st.comp === 'ok') rows = rows.filter(r => !r.s.docs.length || r.s.docs.every(d => B.docCompliance(d).code === 'ok'));
      else rows = rows.filter(r => r.s.docs.some(d => B.docCompliance(d).code === st.comp));
    }
    const pg = U.paginate(rows, st.page, 8);

    el.innerHTML = `
      ${App.crumb('time-monitor')}
      <div class="page-head"><h1 class="page-title">病历书写时限监控</h1><div class="desc">查看本人病历文书的书写时限合规状态，编辑病历、提交归档</div></div>
      <div class="stat-grid">
        <div class="stat"><div class="ic">📄</div><div class="lab">文书总数</div><div class="val">${ss.total}</div></div>
        <div class="stat"><div class="ic">✅</div><div class="lab">合规数</div><div class="val">${ss.ok}</div></div>
        <div class="stat ${ss.over > 0 ? 'danger' : ''}"><div class="ic">⏰</div><div class="lab">超时数</div><div class="val">${ss.over}</div></div>
        <div class="stat ${ss.rate < 90 ? 'warn' : ''}"><div class="ic">📊</div><div class="lab">合规率</div><div class="val">${ss.rate}%</div></div>
      </div>
      <div class="filters">
        <div class="fld"><label>时限合规状态</label><select id="fComp">
          <option value="all">全部</option><option value="ok">正常/合规</option><option value="over">已超时</option><option value="soon">即将超时</option></select></div>
        <div class="fld"><label>归档状态</label><select id="fArch">
          <option value="all">全部</option><option value="none">未提交</option><option value="archiving">归档中</option><option value="archived">已归档</option><option value="intercepted">已拦截</option></select></div>
        <div class="fld"><label>患者</label><input id="fKw" placeholder="搜索姓名/住院号…" value="${esc(st.kw)}"></div>
      </div>
      <div class="card"><div class="card-h"><h3>病历文书时限列表</h3><div class="right muted" style="font-size:12px">患者分组 · 两级结构</div></div>
        <div class="card-b" style="padding:0">
          <table><thead><tr><th>患者</th><th>住院/门诊号</th><th>科室/床号</th><th>时限合规概要</th><th>归档状态</th><th>操作</th></tr></thead>
          <tbody id="tb"></tbody></table>
          <div id="pager"></div>
        </div>
      </div>
      <div id="p2zone"></div>`;
    el.querySelector('#fComp').value = st.comp; el.querySelector('#fArch').value = st.arch;
    el.querySelector('#fComp').onchange = e => { st.comp = e.target.value; st.page = 1; render(); };
    el.querySelector('#fArch').onchange = e => { st.arch = e.target.value; st.page = 1; render(); };
    el.querySelector('#fKw').oninput = e => { const v = e.target.value; U.keepFocus(el, () => { st.kw = v; st.page = 1; render(); }); };

    const tb = el.querySelector('#tb');
    if (!pg.slice.length) { tb.innerHTML = `<tr><td colspan="6"><div class="empty-box"><div class="em">🔍</div>未找到匹配的病历</div></td></tr>`; }
    pg.slice.forEach(({ e, s }) => {
      let normal = 0, compliant = 0;
      s.docs.forEach(d => { const c = B.docCompliance(d); if (c.code === 'ok') { if (d.completedAt) compliant++; else normal++; } });
      const sum = `${s.over ? `🔴${s.over}超时 ` : ''}${s.soon ? `🟠${s.soon}即将超时 ` : ''}${normal ? `🟢${normal}正常 ` : ''}${compliant ? `✅${compliant}合规` : ''}`.trim() || '🟢全部正常/合规';
      const open = st.expand[e.id];
      // 操作按钮规则
      const pendingT = B.tasksOf(e.id).filter(t => t.status === '待整改').length;
      const incomplete = s.docs.filter(d => d.required && !d.completedAt).length;
      const canArch = pendingT === 0 && incomplete === 0;
      const archTip = pendingT ? '存在未完成整改任务' : incomplete ? `仍有 ${incomplete} 项必填文书未完成` : '可提交归档';
      let ops = '';
      if (e.archiveStatus === 'none') ops = `<button class="linkbtn" data-act="view">详情</button><button class="linkbtn" data-act="edit">编辑</button><button class="linkbtn ${canArch ? '' : 'dis'}" data-act="arch" title="${esc(archTip)}">归档</button>`;
      else if (e.archiveStatus === 'archiving') ops = `<button class="linkbtn" data-act="view">详情</button>`;
      else if (e.archiveStatus === 'intercepted') ops = `<button class="linkbtn" data-act="view">详情</button><button class="linkbtn" data-act="fix">整改</button>`;
      else ops = `<button class="linkbtn" data-act="view">详情</button>`;
      const tr = U.h(`<tr class="grp"><td><span class="expander">${open ? '▼' : '▶'}</span> ${esc(e.patientName)}</td>
        <td>${esc(e.mrn)}</td><td>${esc(F.orgName(e.org))}/${esc(e.bed || '—')}</td>
        <td>${sum}</td><td>${U.archiveBadge(e.archiveStatus)}</td><td><div class="flex" style="gap:2px">${ops}</div></td></tr>`);
      tr.onclick = (ev) => { if (ev.target.tagName === 'BUTTON') return; st.expand[e.id] = !open; render(); };
      tr.querySelectorAll('[data-act]').forEach(b => b.onclick = (ev) => { ev.stopPropagation(); onAct(b.dataset.act, e); });
      tb.appendChild(tr);
      // 第二级结构：住院/门诊号、科室/床号、归档状态列均无信息；时限合规概要列展示
      // "要求时限 ▏ 剩余时限 ▏ 当前状态" 三段式摘要
      if (open) s.docs.slice().sort((a, b) => ({ over: 0, soon: 1, ok: 2 }[B.docCompliance(a).code] - { over: 0, soon: 1, ok: 2 }[B.docCompliance(b).code])).forEach(d => {
        const c = B.docCompliance(d);
        const rule = F.col('ActivityDefinition').find(r => r.docType === d.type && r.active);
        const reqTxt = rule ? `${rule.hours}h（要求时限）` : '—（要求时限）';
        let remainTxt;
        if (d.completedAt) remainTxt = c.overMs != null ? `超时${B.fmtDur(c.overMs)}（剩余时限）` : `按时完成（剩余时限）`;
        else remainTxt = c.code === 'over' ? `超时${B.fmtDur(c.overMs)}（剩余时限）` : `${B.fmtDur(c.remainMs)}（剩余时限）`;
        const summaryTxt = `${reqTxt} ▏ ${remainTxt} ▏ ${c.label}（当前状态）`;
        tb.appendChild(U.h(`<tr class="child"><td>${{ ok: '🟢', soon: '🟠', over: '🔴' }[c.code]} ${esc(d.type)}</td>
          <td></td><td></td><td>${summaryTxt}</td><td></td><td></td></tr>`));
      });
    });
    const pgEl = U.pager(pg.page, pg.pages, p => { st.page = p; render(); });
    if (typeof pgEl === 'object') el.querySelector('#pager').replaceChildren(pgEl); else el.querySelector('#pager').innerHTML = pgEl;

    // ---- 预警详情 / 归档拦截详情 ----
    const warns = F.col('Communication').filter(c => c.to === user.id && c.category === '超时预警').sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    const blocked = B.visibleEncounters(user).filter(e => e.archiveStatus === 'intercepted');
    el.querySelector('#p2zone').innerHTML = `
      <div class="cols c-1-1">
        <div class="card mb0"><div class="card-h"><h3>预警详情</h3></div>
          <div class="card-b" style="padding:6px 8px">${warns.length ? warns.map(w => `<div style="display:flex;gap:9px;padding:9px 6px;border-bottom:1px solid var(--c-line)"><div>⏰</div><div style="flex:1"><div style="font-weight:600">${esc(w.subject)} · ${esc(w.text.replace(/【.*?】/, '').slice(0, 28))}</div><div class="muted" style="font-size:12px">预警时间 ${F.mdhm(w.sentAt)}</div></div></div>`).join('') : '<div class="empty-box" style="padding:24px 0"><div class="em">✅</div>暂无超时预警</div>'}</div></div>
        <div class="card mb0"><div class="card-h"><h3>归档拦截详情</h3></div>
          <div class="card-b" style="padding:6px 8px">${blocked.length ? blocked.map(e => { const t = B.tasksOf(e.id).find(x => x.source === '终末质控'); return `<div style="display:flex;gap:9px;padding:9px 6px;border-bottom:1px solid var(--c-line);cursor:pointer" data-fix="${e.id}"><div>🚫</div><div style="flex:1"><div style="font-weight:600">${esc(e.patientName)} · ${esc((t && t.location) || '终末质控不通过')}</div><div class="muted" style="font-size:12px">${esc((t && t.requirement) || '请整改后重新提交')} · 点击去整改 ›</div></div></div>`; }).join('') : '<div class="empty-box" style="padding:24px 0"><div class="em">📥</div>暂无归档拦截</div>'}</div></div>
      </div>`;
    el.querySelectorAll('[data-fix]').forEach(d => d.onclick = () => ctx.go('rectify', { encId: d.dataset.fix }));
  }

  function onAct(act, enc, focusDoc) {
    if (act === 'view') S.emrModal(enc.id, { mode: 'view', focusDoc, onDone: render });
    else if (act === 'edit') S.emrModal(enc.id, { mode: 'edit', focusDoc, onDone: render });
    else if (act === 'arch') {
      const pending = B.tasksOf(enc.id).filter(t => t.status === '待整改');
      if (pending.length) { U.toast('该患者存在未完成整改任务，无法提交归档，请先整改', 'warn', 3000); return; }
      const incomplete = B.encSummary(enc).docs.filter(d => d.required && !d.completedAt);
      if (incomplete.length) { U.toast(`仍有未完成必填文书：${incomplete.map(d => d.type).join('、')}，请先完成书写`, 'warn', 3200); return; }
      S.doSubmitArchive(enc, render);
    } else if (act === 'fix') ctx.go('rectify', { encId: enc.id });
  }

  render();
  // 首页待办事项点击进入：直接定位到该文书的详情/编辑界面
  if (params.encId) {
    const enc = F.byId('Encounter', params.encId);
    if (enc) onAct(params.mode === 'edit' ? 'edit' : 'view', enc, params.focusDoc);
  }
  return el;
});
