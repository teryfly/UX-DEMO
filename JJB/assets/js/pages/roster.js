/* WF-L3-1-3 值班排班（排班表格 + 冲突检查 + 生成值班表 + 提醒） */
(function () {
  const WK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const TITLE_RANK = { '住院医师': 1, '主治医师': 2, '副主任医师': 3, '主任医师': 4 };
  const TODAY = '2026-06-20';   // 演示“当前时间”所在日期
  let conflicts = null;
  // 排班周期与查询锚点（可切换 按周/双周/按月，并可前后翻页/直接选择日期，
  // 从而查看历史已排班记录——不再固定死一周）。
  let cycle = null;
  let anchor = '2026-06-15';
  // 当前查看的科室（值班排班以科室为边界，套用模板/提交排班只影响该科室的班次数据）
  let deptId = 'org-card';

  function isPastDate(d) { return d < TODAY; }

  function dates() {
    if (cycle === '按月') {
      const start = new Date(monthAnchor(anchor));   // 始终对齐到当月 1 日，避免起点落在月中导致跨月错位
      const n = daysInMonth(start.getFullYear(), start.getMonth() + 1);
      return Array.from({ length: n }, (_, i) => U.fmtDate(U.addDays(start, i)));
    }
    const n = cycle === '双周' ? 14 : 7;
    return Array.from({ length: n }, (_, i) => U.fmtDate(U.addDays(new Date(anchor), i)));
  }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function monthAnchor(dateStr) { const d = new Date(dateStr); return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-01`; }
  function colLabel(dateStr) {
    const wd = WK[(new Date(dateStr).getDay() + 6) % 7];
    if (cycle === '按月') return `${new Date(dateStr).getDate()}日<br><span class="muted-text" style="font-weight:400">${wd}</span>`;
    return `${wd}<br><span class="muted-text" style="font-weight:400">${dateStr.slice(5)}</span>`;
  }
  function stepPeriod(dir) {
    if (cycle === '按月') {
      const d = new Date(anchor); d.setMonth(d.getMonth() + dir);
      anchor = monthAnchor(U.fmtDate(d));
    } else {
      const n = cycle === '双周' ? 14 : 7;
      anchor = U.fmtDate(U.addDays(new Date(anchor), dir * n));
    }
  }

  // 已锁定（提交生效）的日期集合——按“日期”本身折算全部历史提交/撤回事件得到，
  // 与当前查看的周期粒度（按周/双周/按月）无关：这样按月提交生效后，切到按周/双周
  // 查看同一批日期时锁定状态依然一致，不会出现“换个粒度看又能改”的问题。
  function lockedDates(orgId) {
    const evs = FHIR.search('AuditEvent', a => (a._action === '生成值班表并发送提醒' || a._action === '撤回排班') && a._org === orgId, null, { silent: true });
    const set = new Set();
    evs.forEach(a => { (a._dates || []).forEach(d => { if (a._action === '生成值班表并发送提醒') set.add(d); else set.delete(d); }); });
    return set;
  }
  // 某日期是否可编辑：既未过去，也未被锁定
  function editable(date, locked) { return !isPastDate(date) && !locked.has(date); }

  function activeRule(orgId) { return FHIR.search('Basic', b => b.code.coding[0].code === 'scheduling-rule' && b._status === 'active' && b._org === orgId, null, { silent: true })[0]; }
  function slots(orgId) { return FHIR.search('Slot', s => s._org === orgId, null, { silent: true }); }
  function slotAt(orgId, date, shift) { return FHIR.read('Slot', FHIR.slotId(orgId, date, shift), { silent: true }); }
  function orgDocs(orgId) {
    return FHIR.search('PractitionerRole', r => r.organization && r.organization.reference === 'Organization/' + orgId, null, { silent: true })
      .map(r => ({ p: FHIR.resolve(r.practitioner), role: r }))
      .filter(x => x.p && x.role._qualification && TITLE_RANK[x.role._qualification]);
  }
  function docTitle(id) { const r = FHIR.search('PractitionerRole', x => x.practitioner.reference === 'Practitioner/' + id, null, { silent: true })[0]; return r ? r._qualification : ''; }
  function docSpecialty(id) { const r = FHIR.search('PractitionerRole', x => x.practitioner.reference === 'Practitioner/' + id, null, { silent: true })[0]; return r && r.specialty[0] ? r.specialty[0].text : ''; }
  function docName(id) { const p = FHIR.read('Practitioner', id, { silent: true }); return p ? p.name[0].text : ''; }
  function weekCount(orgId, docId) { return slots(orgId).filter(s => (s._practitioners || []).includes(docId)).length; }
  function orgName(id) { const o = FHIR.read('Organization', id, { silent: true }); return o ? o.name : id; }

  window.PAGES['#/roster'] = function (view) {
    const orgs = FHIR.search('Organization', o => o.active, null, { silent: true });
    if (!orgs.find(o => o.id === deptId)) deptId = orgs[0] && orgs[0].id;
    const rule = activeRule(deptId);
    if (!cycle) cycle = rule ? rule._cycle : '按周';
    const shifts = rule ? (rule._shifts || []) : [];
    const ds = dates();
    const locked = lockedDates(deptId);
    const allLocked = ds.length > 0 && ds.every(d => isPastDate(d) || locked.has(d));
    const anyEditable = ds.some(d => editable(d, locked));
    const anyLocked = ds.some(d => locked.has(d) && !isPastDate(d));
    const allPast = ds.length > 0 && ds.every(isPastDate);

    view.innerHTML = `
      <div class="page-head"><div><h2>值班排班</h2>
        <div class="desc">以表格安排值班人员、套用模板，系统自动检查冲突并生成值班表，排班生效后自动发送值班提醒。</div></div></div>

      <div class="row" style="align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div class="card">
            <div class="toolbar">
              <select class="select" id="deptSel" style="width:150px">${orgs.map(o => `<option value="${o.id}" ${o.id === deptId ? 'selected' : ''}>${o.name}</option>`).join('')}</select>
              <select class="select" id="cycleSel" style="width:100px">${['按周', '双周', '按月'].map(c => `<option ${c === cycle ? 'selected' : ''}>${c}</option>`).join('')}</select>
              <button class="btn" id="prevP" title="上一周期">‹</button>
              <input class="input" type="date" id="jumpDate" value="${anchor}" style="width:150px">
              <button class="btn" id="nextP" title="下一周期">›</button>
              <button class="btn sm" id="todayP">回到本周</button>
              <span class="muted-text">${ds[0]} ~ ${ds[ds.length - 1]}</span>
              ${allPast ? U.tag('📖 历史周期 · 仅供查看', 'default') : allLocked ? U.tag('✅ 已提交生效', 'green') : anyLocked ? U.tag('部分日期已生效', 'orange') : U.tag('未提交', 'default')}
              <span class="spacer"></span>
              <button class="btn" id="applyTpl" ${shifts.length && anyEditable ? '' : 'disabled'}>套用模板</button>
              <button class="btn" id="history">历史排班</button>
              ${shifts.length && anyEditable ? `<button class="btn primary" id="submit">提交排班</button>` : ''}
              ${shifts.length && anyLocked ? `<button class="btn danger" id="unlock">🔓 撤回排班</button>` : ''}
            </div>
            ${allPast ? `<div class="hint" style="margin:0 0 10px">📖 该周期日期均已过去，仅供查看历史排班，不可排班 / 提交 / 撤回。</div>`
        : allLocked ? `<div class="hint" style="margin:0 0 10px">✅ 该周期排班已提交生效，值班表已锁定不可直接修改；如需调整请先点击“撤回排班”。</div>`
          : anyLocked ? `<div class="hint warn" style="margin:0 0 10px">⚠ 当前周期内部分日期（已过去或已提交生效）不可编辑，仅未来未锁定日期可排班/提交。</div>` : ''}
            <div style="overflow-x:auto">
            ${shifts.length ? `<table class="tbl" style="text-align:center">
              <thead><tr><th>班次</th>${ds.map(d => `<th>${colLabel(d)}</th>`).join('')}</tr></thead>
              <tbody>${shifts.map(sh => `<tr>
                <td><b>${sh.name}</b><br><span class="muted-text" style="font-size:11px">${sh.start}-${sh.end}<br>${sh.minTitle === '不限' ? '职称不限' : '需' + sh.minTitle + '+'}</span></td>
                ${ds.map(d => cell(d, sh, locked)).join('')}</tr>`).join('')}</tbody>
            </table>` : `<div class="empty-state">该科室暂未配置生效的排班规则，请先前往「排班规则设置」新建并启用适用于本科室的规则</div>`}
            </div>
            <div class="muted-text" style="font-size:12px;margin-top:8px">提示：点击单元格安排人员（可多选，同一班次支持多人协同值班），下拉仅显示满足该班次资质要求（最低职称/执业范围，选择“不限”表示不限制）的医生，并展示其本周期已排班次数。已过去的日期/ 已提交生效的日期不可编辑。</div>
          </div>
          <div id="conflictBox">${conflicts ? renderConflicts() : ''}</div>
        </div>

        <div style="flex:0 0 280px;max-width:280px">
          <div class="card">
            <div class="card-title">可排班人员 <span class="sub">${orgName(deptId)}</span></div>
            <table class="tbl"><thead><tr><th>姓名</th><th>职称</th><th>范围</th><th class="num">本周期</th></tr></thead>
              <tbody>${orgDocs(deptId).sort((a, b) => weekCount(deptId, b.p.id) - weekCount(deptId, a.p.id)).map(x => `<tr>
                <td><b>${x.p.name[0].text}</b></td><td>${x.role._qualification}</td>
                <td>${x.role.specialty[0] ? x.role.specialty[0].text : '—'}</td>
                <td class="num">${weekCount(deptId, x.p.id)}</td></tr>`).join('') || `<tr><td colspan="4"><div class="empty-state">该科室暂无可排班人员</div></td></tr>`}</tbody></table>
            <div class="muted-text" style="font-size:12px;margin-top:8px">“本周期”为该医生在当前排班周期内已排班次数，辅助负责人合理分配。</div>
          </div>
        </div>
      </div>`;

    U.delegate(view, 'click', '[data-cell]', (e, t) => openCellPicker(t.dataset.cell));
    const submitBtn = U.$('#submit', view); if (submitBtn) submitBtn.addEventListener('click', () => submit(locked));
    const unlockBtn = U.$('#unlock', view); if (unlockBtn) unlockBtn.addEventListener('click', () => unlock(ds, locked));
    const applyTplBtn = U.$('#applyTpl', view); if (applyTplBtn) applyTplBtn.addEventListener('click', () => { if (shifts.length && anyEditable) applyTemplate(locked); });
    U.$('#history', view).addEventListener('click', showHistory);
    U.$('#deptSel', view).addEventListener('change', e => { deptId = e.target.value; cycle = null; conflicts = null; Router.render(); });
    U.$('#cycleSel', view).addEventListener('change', e => { cycle = e.target.value; if (cycle === '按月') anchor = monthAnchor(anchor); conflicts = null; Router.render(); });
    U.$('#prevP', view).addEventListener('click', () => { stepPeriod(-1); conflicts = null; Router.render(); });
    U.$('#nextP', view).addEventListener('click', () => { stepPeriod(1); conflicts = null; Router.render(); });
    U.$('#todayP', view).addEventListener('click', () => { anchor = cycle === '按月' ? monthAnchor('2026-06-15') : '2026-06-15'; conflicts = null; Router.render(); });
    U.$('#jumpDate', view).addEventListener('change', e => { if (!e.target.value) return; anchor = cycle === '按月' ? monthAnchor(e.target.value) : e.target.value; conflicts = null; Router.render(); });

    function cell(date, sh, locked) {
      const s = slotAt(deptId, date, sh.name);
      const ids = (s && s._practitioners) || [];
      const bad = conflicts && conflicts.cells[`${date}|${sh.name}`];
      const editableCell = editable(date, locked);
      if (!ids.length) return editableCell ? `<td data-cell="${date}|${sh.name}" style="cursor:pointer;color:var(--text-3)">点击安排</td>` : `<td style="color:var(--text-3)">—</td>`;
      return `<td ${editableCell ? `data-cell="${date}|${sh.name}"` : ''} class="${bad ? 'error-row' : ''}" style="${editableCell ? 'cursor:pointer' : ''}">
        ${ids.map(id => `<div><b>${docName(id)}</b> <span class="muted-text" style="font-size:11px">${docTitle(id)}</span></div>`).join('')}${bad ? '⚠' : ''}</td>`;
    }
  };

  async function openCellPicker(key) {
    const [date, shift] = key.split('|');
    const locked = lockedDates(deptId);
    if (!editable(date, locked)) { U.toast(isPastDate(date) ? '该日期已过去，不可排班' : '该日期已提交生效，请先撤回排班', 'error'); return; }
    const rule = activeRule(deptId);
    const sh = (rule._shifts || []).find(x => x.name === shift) || {};
    const reqRank = TITLE_RANK[sh.minTitle] || 0;
    const noScope = !sh.scope || sh.scope === '不限';
    const docs = orgDocs(deptId).filter(x => (TITLE_RANK[x.role._qualification] || 0) >= reqRank
      && (noScope || (x.role.specialty[0] && x.role.specialty[0].text === sh.scope)));
    const s = slotAt(deptId, date, shift);
    const cur = (s && s._practitioners) || [];
    const options = docs.map(x => ({ id: x.p.id, label: x.p.name[0].text, sub: `${x.role._qualification} · ${x.role.specialty[0] ? x.role.specialty[0].text : '不限'} · 本周期已排${weekCount(deptId, x.p.id)}次` }));
    const picked = await U.pickMulti({
      title: `安排值班人员 · ${date}（${WK[(new Date(date).getDay() + 6) % 7]}） · ${shift} ${sh.start}-${sh.end}`,
      options, selected: cur, placeholder: '未安排人员，请在下方勾选（可多选）',
    });
    if (picked === null) return;
    let slot = s;
    if (!slot) slot = { resourceType: 'Slot', id: FHIR.slotId(deptId, date, shift), status: 'busy', serviceType: [{ text: shift }], start: `${date}T${sh.start}:00`, end: `${date}T${sh.end}:00`, schedule: FHIR.refStr('Schedule', 'sch-' + deptId), _org: deptId, _date: date, _shift: shift };
    slot._practitioners = picked;
    slot.status = picked.length ? 'busy' : 'free';
    FHIR.update(slot);
    conflicts = null;
    Router.render();
  }

  function checkConflicts(targetDates) {
    const rule = activeRule(deptId) || { _shifts: [] };
    const res = { items: [], cells: {} };
    const dsSet = new Set(targetDates);
    // 1) 资质不匹配（仅校验本次将要提交的日期）
    slots(deptId).forEach(s => {
      if (!(s._practitioners || []).length || !dsSet.has(s._date)) return;
      const sh = (rule._shifts || []).find(x => x.name === s._shift);
      if (!sh) return;
      s._practitioners.forEach(docId => {
        const rank = TITLE_RANK[docTitle(docId)] || 0;
        if (rank < (TITLE_RANK[sh.minTitle] || 0)) {
          res.items.push({ type: '资质不匹配', who: docName(docId), when: `${s._date} ${s._shift}`, detail: `职称 ${docTitle(docId)} 低于该班次要求 ${sh.minTitle}`, fix: `替换为${sh.minTitle}及以上职称医生` });
          res.cells[`${s._date}|${s._shift}`] = true;
        }
        if (sh.scope && sh.scope !== '不限' && docSpecialty(docId) !== sh.scope) {
          res.items.push({ type: '执业范围不符', who: docName(docId), when: `${s._date} ${s._shift}`, detail: `执业范围 ${docSpecialty(docId) || '未知'} 不符合 ${sh.scope}`, fix: `更换为${sh.scope}执业范围医生` });
          res.cells[`${s._date}|${s._shift}`] = true;
        }
      });
    });
    // 2) 同一医生同日多班次
    targetDates.forEach(d => {
      const byDoc = {};
      slots(deptId).filter(s => s._date === d).forEach(s => (s._practitioners || []).forEach(docId => { (byDoc[docId] = byDoc[docId] || []).push(s._shift); }));
      Object.entries(byDoc).forEach(([doc, shs]) => {
        if (shs.length > 1) {
          res.items.push({ type: '排班冲突', who: docName(doc), when: d, detail: `同一天被安排多个班次（${shs.join('、')}）`, fix: `调整其中一个班次或更换值班人员` });
          shs.forEach(sh => res.cells[`${d}|${sh}`] = true);
        }
      });
    });
    return res;
  }

  function submit(locked) {
    const ds = dates();
    const targetDates = ds.filter(d => editable(d, locked));
    if (!targetDates.length) { U.toast('当前周期内没有可提交的日期（均已过去或已生效）', 'error'); return; }
    conflicts = checkConflicts(targetDates);
    if (conflicts.items.length) {
      Router.render();
      U.toast(`存在 ${conflicts.items.length} 处排班冲突，已拒绝提交`, 'error');
      return;
    }
    conflicts = null;
    // 生成值班表（仅锁定本次实际提交的日期）并发送提醒
    const assigned = slots(deptId).filter(s => (s._practitioners || []).length && targetDates.includes(s._date));
    const recipients = [...new Set(assigned.flatMap(s => s._practitioners))];
    FHIR.create({
      resourceType: 'AuditEvent', type: { text: '排班提交' }, action: 'C', recorded: new Date('2026-06-20T08:00:00').toISOString(),
      agent: [{ who: { display: AUTH.currentUser().name }, requestor: true }], _action: '生成值班表并发送提醒',
      _detail: `${targetDates[0]}~${targetDates[targetDates.length - 1]} 共 ${assigned.length} 个班次`,
      _cycle: cycle, _dates: targetDates, _org: deptId,
    });
    Router.render();
    U.toast(`✅ 排班冲突检查通过，已生成值班表，并向 ${recipients.length} 名值班医生发送值班提醒`, 'success', 3600);
  }

  function unlock(ds, locked) {
    const targetDates = ds.filter(d => locked.has(d) && !isPastDate(d));
    if (!targetDates.length) { U.toast('当前周期内没有可撤回的日期（未生效或已过去）', 'error'); return; }
    U.confirm({ title: '撤回排班', danger: true, content: `撤回后 ${targetDates[0]}~${targetDates[targetDates.length - 1]} 内尚未过去的日期将变为可编辑状态（已过去的日期即使在同一周期内也不会被撤回，已发送的值班提醒不会撤回）。确认撤回？` })
      .then(ok => {
        if (!ok) return;
        FHIR.create({
          resourceType: 'AuditEvent', type: { text: '排班提交' }, action: 'U', recorded: new Date('2026-06-20T08:00:00').toISOString(),
          agent: [{ who: { display: AUTH.currentUser().name }, requestor: true }], _action: '撤回排班',
          _detail: `撤回 ${targetDates[0]}~${targetDates[targetDates.length - 1]} 值班表`, _cycle: cycle, _dates: targetDates, _org: deptId,
        });
        U.toast('已撤回，可重新编辑排班', 'success'); Router.render();
      });
  }

  function renderConflicts() {
    return `<div class="card" style="border:1px solid #ffccc7">
      <div class="card-title" style="color:var(--error)">⚠ 排班冲突检查结果（${conflicts.items.length}）<span class="sub">解决冲突后需重新提交</span></div>
      <table class="tbl"><thead><tr><th>冲突类型</th><th>冲突人员</th><th>时间段</th><th>冲突详情</th><th>解决建议</th></tr></thead>
      <tbody>${conflicts.items.map(c => `<tr class="error-row"><td>${U.tag(c.type, 'red')}</td><td>${c.who}</td><td>${c.when}</td><td>${c.detail}</td><td style="color:var(--primary)">💡 ${c.fix}</td></tr>`).join('')}</tbody></table>
    </div>`;
  }

  function applyTemplate(locked) {
    const ds = dates();
    const tpls = FHIR.search('Basic', b => b.code.coding[0].code === 'scheduling-template', null, { silent: true })
      .filter(t => (t._cycle || '按周') === cycle && (t._org || 'org-card') === deptId);
    if (!tpls.length) { U.toast(`暂无与当前科室 / 周期（${cycle}）匹配的排班模板，请先在“排班模板设置”中创建`, 'error'); return; }
    const body = U.el('div');
    let sel = tpls[0] && tpls[0].id;
    function planCell(v) {
      const ids = Array.isArray(v) ? v : (v ? [v] : []);
      return ids.length ? ids.map(docName).join('、') : '<span class="tag default">待安排</span>';
    }
    function render() {
      const t = FHIR.read('Basic', sel, { silent: true });
      body.innerHTML = `<div class="form-item"><label>选择模板（仅显示与当前科室 / 周期匹配）</label>
        <select class="select" id="tsel">${tpls.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${x._name}（${x._cycle}）</option>`).join('')}</select></div>
        <div class="hint warn">套用模板将覆盖当前查看周期内“可编辑日期”（未过去、未提交生效）已安排的排班数据；已过去或已提交生效的日期不受影响。模板中“待安排”的位置保持为空；若模板某位置配置了多名候补人员，将自动采用第一候补，其余可在排班表中手动调整。</div>
        <div class="card-title" style="font-size:14px">预览</div>
        <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>班次</th>${ds.map(d => `<th>${colLabel(d)}</th>`).join('')}</tr></thead>
        <tbody>${Object.keys(t._plan || {}).map(s => `<tr><td><b>${s}</b></td>${ds.map((d, i) => `<td>${planCell((t._plan[s] || [])[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      U.$('#tsel', body).addEventListener('change', e => { sel = e.target.value; render(); });
    }
    render();
    const foot = U.el('div'); const cancel = U.el('button', { class: 'btn' }, '取消'); const ok = U.el('button', { class: 'btn primary' }, '确认套用');
    foot.appendChild(cancel); foot.appendChild(ok);
    const m = U.modal({ title: '套用排班模板', width: 'wide', body, footer: foot });
    cancel.addEventListener('click', m.close);
    ok.addEventListener('click', () => {
      const t = FHIR.read('Basic', sel, { silent: true });
      let skipped = 0;
      Object.keys(t._plan || {}).forEach(shift => {
        (t._plan[shift] || []).forEach((val, i) => {
          const date = ds[i]; if (!date) return;
          if (!editable(date, locked)) { skipped++; return; }
          const ids = Array.isArray(val) ? val : (val ? [val] : []);
          const doc = ids[0] || '';
          const rule = activeRule(deptId); const sh = (rule._shifts || []).find(x => x.name === shift) || { start: '08:00', end: '20:00' };
          let slot = slotAt(deptId, date, shift) || { resourceType: 'Slot', id: FHIR.slotId(deptId, date, shift), serviceType: [{ text: shift }], start: `${date}T${sh.start}:00`, end: `${date}T${sh.end}:00`, schedule: FHIR.refStr('Schedule', 'sch-' + deptId), _org: deptId, _date: date, _shift: shift };
          slot._practitioners = doc ? [doc] : []; slot.status = doc ? 'busy' : 'free';
          FHIR.update(slot, { silent: true });
        });
      });
      t._lastUsed = '2026-06-20'; FHIR.update(t, { silent: true });
      FHIR.create({
        resourceType: 'AuditEvent', type: { text: '排班' }, action: 'C', recorded: new Date('2026-06-20T08:00:00').toISOString(),
        agent: [{ who: { display: AUTH.currentUser().name }, requestor: true }], _action: '套用排班模板',
        _detail: `${t._name} → ${orgName(deptId)} ${ds[0]}~${ds[ds.length - 1]}`, _org: deptId,
      }, { silent: true });
      conflicts = null;
      m.close();
      U.toast(`已套用模板，排班表已填充${skipped ? `（${skipped} 个已锁定/已过去的班次未被覆盖）` : ''}`, 'success');
      Router.render();
    });
  }

  function showHistory() {
    // “历史排班”展示的是已提交生效的排班记录（谁、何时、为哪些日期提交），
    // 而不是通用操作日志；点击“查看”可直接跳转主表格查看对应日期所在周期。
    const hist = FHIR.search('AuditEvent', a => a._action === '生成值班表并发送提醒' && a._org === deptId, null, { silent: true })
      .sort((a, b) => new Date(b.recorded) - new Date(a.recorded));
    const body = U.el('div');
    body.innerHTML = hist.length ? `<table class="tbl"><thead><tr><th>科室名称</th><th>周期</th><th>覆盖日期</th><th>操作人</th><th>操作时间</th><th>操作</th></tr></thead>
      <tbody>${hist.map(a => `<tr><td>${orgName(deptId)}</td><td>${a._cycle || '按周'}</td><td>${(a._dates || [])[0] || '—'} ~ ${(a._dates || [])[(a._dates || []).length - 1] || '—'}（${(a._dates || []).length}天）</td>
        <td>${a.agent[0].who.display}</td><td>${U.fmtTime(a.recorded)}</td>
        <td><button class="btn-link" data-hview="${a.id}">查看</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty-state">暂无历史排班记录</div>';
    const m = U.modal({ title: '历史排班记录', width: 'wide', body });
    U.delegate(body, 'click', '[data-hview]', (e, t) => {
      const a = FHIR.read('AuditEvent', t.dataset.hview, { silent: true });
      if (!a || !(a._dates || []).length) return;
      cycle = a._cycle || '按周'; anchor = cycle === '按月' ? monthAnchor(a._dates[0]) : a._dates[0]; conflicts = null;
      m.close(); Router.render();
    });
  }
})();
