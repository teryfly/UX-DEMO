/* WF-L3-3-1 值班执行监控（到岗状态 + 异常通知处理） */
(function () {
  const TODAY = '2026-06-20';
  let shiftTab = null;
  let dept = 'org-card';   // 医院管理部门可切换为 'ALL'（全院）或具体科室 id

  function docName(id) { const p = FHIR.read('Practitioner', id, { silent: true }); return p ? p.name[0].text : id; }
  function docTitle(id) { const r = FHIR.search('PractitionerRole', x => x.practitioner.reference === 'Practitioner/' + id, null, { silent: true })[0]; return r ? r._qualification : '—'; }
  function names(ids) { return (ids || []).map(docName).join('、') || '—'; }
  function orgName(id) { const o = FHIR.read('Organization', id, { silent: true }); return o ? o.name : id; }
  function activeRule(orgId) { return FHIR.search('Basic', b => b.code.coding[0].code === 'scheduling-rule' && b._status === 'active' && b._org === orgId, null, { silent: true })[0]; }
  function inWindow(t, start, end) { return start <= end ? (t >= start && t <= end) : (t >= start || t <= end); }
  // 当前时刻（演示固定 08:00）落在该科室规则的哪个班次内——用于判定“当日在岗”与“下一班次”
  function currentShiftName(rule) {
    const hit = (rule._shifts || []).find(s => inWindow('08:00', s.start, s.end));
    return hit ? hit.name : ((rule._shifts || [])[0] || {}).name;
  }

  function shiftNamesFor(orgId) {
    if (orgId === 'ALL') {
      const set = new Set();
      FHIR.search('Basic', b => b.code.coding[0].code === 'scheduling-rule' && b._status === 'active', null, { silent: true })
        .forEach(r => (r._shifts || []).forEach(s => set.add(s.name)));
      return [...set];
    }
    const rule = activeRule(orgId);
    return rule ? (rule._shifts || []).map(s => s.name) : [];
  }

  // 到岗状态来源于真实排班 Slot + 当前交接草稿的签名数据，而非写死的姓名/状态：
  // 当前班次的人员 = 值班排班表当日该班次的真实安排；到岗与否取「接班签名」是否已完成，
  // 若尚未签名则核对是否已产生对应的「到岗超时」异常通知——与「交接班清单」「异常通知」同源。
  function attendanceForOrg(orgId, shiftName) {
    const rule = activeRule(orgId);
    if (!rule) return [];
    const slot = FHIR.read('Slot', FHIR.slotId(orgId, TODAY, shiftName), { silent: true });
    const ids = (slot && slot._practitioners) || [];
    if (!ids.length) return [];
    const isCurrent = shiftName === currentShiftName(rule);
    const draft = isCurrent ? FHIR.read('Composition', `comp-cur-${TODAY}-${shiftName}`, { silent: true }) : null;
    return ids.map(id => {
      let status = '未到岗', time = '—';
      if (isCurrent) {
        const sig = draft && draft._receiverSigs && draft._receiverSigs[id];
        if (sig) { status = '已到岗'; time = U.fmtClock(sig.time); }
        else {
          const exc = FHIR.search('Communication', c => c.category[0].text === '到岗超时' && (c._receivers || []).includes(id) && c._org === orgId, null, { silent: true })[0];
          status = exc ? '超时未到岗' : '已到岗';
        }
      }
      return { doc: id, name: docName(id), title: docTitle(id), status, time, shift: shiftName, dept: orgName(orgId) };
    });
  }
  function attendance(shiftName) {
    if (dept === 'ALL') {
      return FHIR.search('Organization', o => o.active, null, { silent: true }).flatMap(o => attendanceForOrg(o.id, shiftName));
    }
    return attendanceForOrg(dept, shiftName);
  }

  window.PAGES['#/monitor'] = function (view) {
    const role = AUTH.currentRole();
    const isMgmt = role === '医院管理部门';
    const orgs = FHIR.search('Organization', o => o.active, null, { silent: true });
    if (!isMgmt) dept = AUTH.currentUser().orgId || (orgs[0] && orgs[0].id);   // 科室负责人仅本科室
    if (dept !== 'ALL' && !orgs.find(o => o.id === dept)) dept = orgs[0] && orgs[0].id;
    const shiftNames = shiftNamesFor(dept);
    if (!shiftTab || !shiftNames.includes(shiftTab)) shiftTab = shiftNames[0];
    const att = shiftTab ? attendance(shiftTab) : [];
    const stat = { '已到岗': 0, '未到岗': 0, '超时未到岗': 0 };
    att.forEach(a => stat[a.status]++);
    const showDept = dept === 'ALL';
    const comms = FHIR.search('Communication', c => dept === 'ALL' || c._org === dept, null, { silent: true })
      .sort((a, b) => new Date(b.sent) - new Date(a.sent));

    view.innerHTML = `
      <div class="page-head"><div><h2>值班执行监控</h2>
        <div class="desc">实时监控值班医生到岗状态与交接执行情况，交接/到岗超时自动推送异常通知，可在线处理。${isMgmt ? '（医院管理部门：可按科室/全院查看）' : '（科室负责人：本科室）'}</div></div>
        <div class="btn-group"><button class="btn" onclick="Router.go('#/handover-record')">查看交接班记录 →</button></div>
      </div>

      <div class="row" style="align-items:flex-start">
        <div style="flex:1.3;min-width:340px">
          <div class="card">
            <div class="card-title">值班到岗监控
              <span style="display:flex;gap:8px;align-items:center">
                ${isMgmt ? `<select class="select" id="deptSel" style="width:130px">
                  <option value="ALL" ${dept === 'ALL' ? 'selected' : ''}>全院</option>
                  ${orgs.map(o => `<option value="${o.id}" ${dept === o.id ? 'selected' : ''}>${o.name}</option>`).join('')}
                </select>` : `<span class="tag cyan">${orgName(dept)}</span>`}
                ${shiftNames.map(s => `<span class="pill ${s === shiftTab ? 'active' : ''}" data-shift="${s}">${s}</span>`).join(' ')}
              </span>
            </div>
            <div class="muted-text" style="font-size:12px;margin-bottom:10px">班次页签根据该科室排班规则中配置的班次动态生成（有几个班次就显示几个），人员与到岗状态同步自值班排班与交接签名的最新数据。</div>
            <div class="grid-3" style="margin-bottom:12px">
              <div class="kpi"><div class="label">✅ 已到岗</div><div class="value" style="color:var(--success)">${stat['已到岗']}</div></div>
              <div class="kpi warn"><div class="label">⏳ 未到岗</div><div class="value">${stat['未到岗']}</div></div>
              <div class="kpi error"><div class="label">⚠ 超时未到岗</div><div class="value">${stat['超时未到岗']}</div></div>
            </div>
            ${shiftNames.length ? `<table class="tbl"><thead><tr><th>姓名</th><th>职称</th>${showDept ? '<th>科室</th>' : ''}<th>班次</th><th>到岗状态</th><th>到岗时间</th></tr></thead>
              <tbody>${att.length ? att.map(a => rowAtt(a, showDept)).join('') : `<tr><td colspan="6"><div class="empty-state">当前班次暂无值班安排</div></td></tr>`}</tbody></table>`
        : `<div class="empty-state">${showDept ? '全院' : orgName(dept)}暂未配置生效的排班规则，无法生成到岗监控</div>`}
            <div class="muted-text" style="font-size:12px;margin-top:8px">到岗状态来源于系统交接记录，自动刷新，无需手动刷新页面。</div>
          </div>

          <div class="card">
            <div class="card-title">交接超时预警 / 异常通知记录</div>
            ${comms.length ? `<table class="tbl"><thead><tr><th>通知时间</th><th>类型</th><th>交出方</th><th>接收方</th><th>时长</th><th>处理状态</th><th>操作</th></tr></thead>
              <tbody>${comms.map(rowComm).join('')}</tbody></table>`
        : `<div class="empty-state"><span class="ic">✅</span>暂无异常通知</div>`}
          </div>
        </div>

        <div style="flex:1;min-width:280px">
          <div class="card">
            <div class="card-title">科室值班执行汇总 <span class="sub">本周</span></div>
            <div class="grid-3" style="margin-bottom:14px">
              <div class="kpi"><div class="label">到岗率</div><div class="value" style="font-size:24px">96%</div></div>
              <div class="kpi"><div class="label">交接完成率</div><div class="value" style="font-size:24px">94%</div></div>
              <div class="kpi"><div class="label">异常事件</div><div class="value" style="font-size:24px">2</div></div>
            </div>
            <div style="margin-bottom:6px"><b>到岗率趋势（近7日）</b></div>
            ${U.lineChart(['一', '二', '三', '四', '五', '六', '日'].map((k, i) => ({ k, v: [82, 90, 94, 96, 92, 98, 96][i] })), { color: '#52C41A', max: 100, min: 70, w: 340 })}
            <div class="sep"></div>
            <div style="margin-bottom:6px"><b>交接完成率趋势（近7日）</b></div>
            ${U.lineChart(['一', '二', '三', '四', '五', '六', '日'].map((k, i) => ({ k, v: [85, 90, 92, 95, 88, 94, 94][i] })), { color: '#1677FF', max: 100, min: 70, w: 340 })}
          </div>
        </div>
      </div>`;

    U.delegate(view, 'click', '[data-shift]', (e, t) => { shiftTab = t.dataset.shift; Router.render(); });
    U.delegate(view, 'click', '[data-handle]', (e, t) => handleException(t.dataset.handle));
    U.delegate(view, 'click', '[data-viewc]', (e, t) => viewException(t.dataset.viewc));
    const ds = U.$('#deptSel', view); if (ds) ds.addEventListener('change', e => { dept = e.target.value; shiftTab = null; Router.render(); });

    function rowAtt(a, showDept) {
      const map = { '已到岗': ['green', '✅ 已到岗', ''], '未到岗': ['orange', '⏳ 未到岗', 'warn-row'], '超时未到岗': ['red', '⚠ 超时未到岗', 'error-row'] };
      const [color, label, cls] = map[a.status];
      return `<tr class="${cls}"><td><b>${a.name}</b></td><td>${a.title}</td>${showDept ? `<td>${a.dept}</td>` : ''}<td>${a.shift}</td><td>${U.tag(label, color)}</td><td>${a.time}</td></tr>`;
    }
    function rowComm(c) {
      const done = c._handleStatus === '已处理';
      return `<tr class="${done ? '' : 'warn-row'}">
        <td>${U.fmtTime(c.sent)}</td><td>${U.tag(c.category[0].text, c.category[0].text.includes('超时') ? 'orange' : 'red')}</td>
        <td>${names(c._givers)}</td><td>${names(c._receivers)}</td><td>${c._duration}</td>
        <td>${done ? U.tag('🟢 已处理', 'green') : U.tag('🔴 未处理', 'red')}</td>
        <td>${done ? `<button class="btn-link" data-viewc="${c.id}">查看</button>` : `<button class="btn-link" data-handle="${c.id}">处理</button>`}</td></tr>`;
    }
  };

  function handleException(id) {
    const c = FHIR.read('Communication', id, { silent: true });
    const body = U.el('div');
    body.innerHTML = `
      <div class="card flat">
        <div class="grid-2" style="gap:8px">
          <div><span class="muted-text">异常类型：</span>${c.category[0].text}</div>
          <div><span class="muted-text">所属科室：</span>${orgName(c._org)}</div>
          <div><span class="muted-text">交出方：</span>${names(c._givers)}</div>
          <div><span class="muted-text">接收方：</span>${names(c._receivers)}</div>
          <div><span class="muted-text">超时时长：</span>${c._duration}</div>
          <div><span class="muted-text">通知时间：</span>${U.fmtTime(c.sent)}</div>
        </div>
      </div>
      <div class="form-item"><label><span class="req">*</span>处理说明</label>
        <textarea class="input" id="note" rows="3" placeholder="填写处理过程与结果…"></textarea></div>`;
    const foot = U.el('div'); const cancel = U.el('button', { class: 'btn' }, '取消'); const ok = U.el('button', { class: 'btn primary' }, '确认处理');
    foot.appendChild(cancel); foot.appendChild(ok);
    const m = U.modal({ title: '异常处理', body, footer: foot });
    cancel.addEventListener('click', m.close);
    ok.addEventListener('click', () => {
      const note = U.$('#note', body).value.trim();
      if (!note) { U.toast('请填写处理说明', 'error'); return; }
      c._handleStatus = '已处理'; c._handleNote = note; FHIR.update(c);
      m.close(); U.toast('异常已处理', 'success'); Router.render();
    });
  }
  function viewException(id) {
    const c = FHIR.read('Communication', id, { silent: true });
    U.modal({ title: '异常处理详情', body: `<div class="card flat" style="margin:0">
      <div><b>${c.category[0].text}</b> · 交出方 ${names(c._givers)} · 接收方 ${names(c._receivers)} · ${c._duration}</div>
      <div class="muted-text" style="margin:8px 0">通知时间：${U.fmtTime(c.sent)}</div>
      <div class="sep"></div><div><span class="muted-text">处理说明：</span>${U.esc(c._handleNote || '—')}</div></div>` });
  }
})();
