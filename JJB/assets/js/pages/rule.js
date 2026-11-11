/* WF-L3-1-1 排班规则设置 */
(function () {
  let selRule = null, kw = '';

  function rules() {
    return FHIR.search('Basic', b => b.code.coding[0].code === 'scheduling-rule', { code: 'scheduling-rule' })
      .filter(r => !kw || r._name.includes(kw))
      .sort((a, b) => (a._status === 'active' ? 0 : 1) - (b._status === 'active' ? 0 : 1));
  }
  function orgName(id) { const o = id ? FHIR.read('Organization', id, { silent: true }) : null; return o ? o.name : '—'; }

  window.PAGES['#/rule'] = function (view) {
    const list = rules();
    if (!selRule || !list.find(r => r.id === selRule)) selRule = list[0] && list[0].id;
    const audits = FHIR.search('AuditEvent', a => a._action.includes('排班规则'), null, { silent: true })
      .sort((a, b) => new Date(b.recorded) - new Date(a.recorded));

    view.innerHTML = `
      <div class="page-head"><div><h2>排班规则设置</h2>
        <div class="desc">配置排班周期、轮次规则及值班资质要求，规则保存后即时生效，排班时系统自动校验。</div></div></div>

      <div class="hint">💡 排班规则定义“按周/双周/月”的排班周期、每日班次（白班/夜班等）的起止时间，以及各班次的最低职称与执业范围要求。排班提交时系统据此自动校验冲突与资质。</div>

      <div class="row" style="align-items:flex-start">
        <div style="flex:1.4;min-width:340px">
          <div class="card">
            <div class="toolbar">
              <button class="btn primary" id="add">+ 新建规则</button>
              <input class="input" id="kw" style="width:200px" placeholder="按规则名称搜索" value="${U.esc(kw)}">
              <span class="spacer"></span><span class="muted-text">共 ${list.length} 条</span>
            </div>
            <table class="tbl">
              <thead><tr><th>规则名称</th><th>适用科室</th><th>适用周期</th><th>班次轮次</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>${list.map(rowOf).join('') || `<tr><td colspan="6"><div class="empty-state">暂无排班规则</div></td></tr>`}</tbody>
            </table>
          </div>
        </div>
        <div style="flex:1;min-width:280px">
          <div class="card">
            <div class="card-title">规则变更记录 <span class="sub">可追溯</span></div>
            <div style="max-height:480px;overflow-y:auto">
              ${audits.length ? audits.map(a => `<div style="padding:8px 0;border-bottom:1px solid #f0f0f0">
                <div><b>${a._action}</b></div>
                <div class="muted-text" style="font-size:12px">${U.fmtTime(a.recorded)} · ${a.agent[0].who.display} · ${a._detail}</div>
              </div>`).join('') : '<div class="muted-text">暂无变更记录</div>'}
            </div>
          </div>
        </div>
      </div>`;

    U.$('#kw', view).addEventListener('input', e => { kw = e.target.value; const v = e.target; Router.render(); setTimeout(() => { const n = U.$('#kw'); if (n) { n.focus(); n.value = kw; } }); });
    U.$('#add', view).addEventListener('click', () => editRule(null));
    U.delegate(view, 'click', '[data-edit]', (e, t) => editRule(t.dataset.edit));
    U.delegate(view, 'click', '[data-toggle]', (e, t) => toggleRule(t.dataset.toggle));
    U.delegate(view, 'click', '[data-sel]', (e, t) => { selRule = t.dataset.sel; });

    function rowOf(r) {
      const off = r._status !== 'active';
      const shifts = (r._shifts || []).map(s => `${s.name} ${s.start}-${s.end}`).join('；');
      return `<tr class="${off ? 'muted' : ''}">
        <td><b>${U.esc(r._name)}</b></td>
        <td>${orgName(r._org)}</td>
        <td>${r._cycle}（起 ${r._start}）</td>
        <td style="max-width:240px">${U.esc(shifts)}</td>
        <td>${off ? U.tag('失效', 'default') : U.tag('生效', 'green')}</td>
        <td><button class="btn-link" data-edit="${r.id}">编辑</button>
          <button class="btn-link ${off ? '' : 'danger'}" data-toggle="${r.id}">${off ? '启用' : '停用'}</button></td>
      </tr>`;
    }
  };

  function toggleRule(id) {
    const r = FHIR.read('Basic', id, { silent: true });
    const next = r._status === 'active' ? 'inactive' : 'active';
    U.confirm({ title: next === 'inactive' ? '停用规则' : '启用规则', danger: next === 'inactive',
      content: `确认${next === 'inactive' ? '停用' : '启用'}规则「${r._name}」？${next === 'inactive' ? '停用后排班将不再校验该规则。' : ''}` })
      .then(ok => { if (!ok) return; r._status = next; FHIR.update(r); logAudit(`${next === 'inactive' ? '停用' : '启用'}排班规则`, r._name); U.toast('已' + (next === 'inactive' ? '停用' : '启用'), 'success'); Router.render(); });
  }

  function editRule(id) {
    const editing = id ? FHIR.read('Basic', id, { silent: true }) : null;
    const orgs = FHIR.search('Organization', o => o.active, null, { silent: true });
    const r = editing || { _name: '', _cycle: '按周', _start: '2026-06-22', _status: 'active', _org: (orgs[0] || {}).id, _shifts: [{ name: '白班', start: '08:00', end: '20:00', minTitle: '住院医师', scope: '内科' }] };
    const titles = ['不限', '住院医师', '主治医师', '副主任医师', '主任医师'];
    const scopes = ['不限', '内科', '外科', '急诊', '神经内科'];
    const body = U.el('div');
    const render = () => {
      body.innerHTML = `
        <div class="form-row">
          <div class="form-item"><label><span class="req">*</span>规则名称</label>
            <input class="input" id="rname" value="${U.esc(r._name)}"><div class="field-err" id="e_name"></div></div>
          <div class="form-item"><label><span class="req">*</span>适用科室</label>
            <select class="select" id="rorg">${orgs.map(o => `<option value="${o.id}" ${o.id === r._org ? 'selected' : ''}>${o.name}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div class="form-item"><label>排班周期</label>
            <select class="select" id="rcycle">${['按周', '双周', '按月'].map(c => `<option ${c === r._cycle ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="form-item"><label>起始日期</label><input class="input" type="date" id="rstart" value="${r._start}"></div>
        </div>
        <div class="card-title" style="font-size:14px">轮次规则配置 <button class="btn sm" id="addShift">+ 添加班次</button></div>
        <table class="tbl"><thead><tr><th>班次名称</th><th>开始</th><th>结束</th><th>最低职称</th><th>执业范围</th><th></th></tr></thead>
          <tbody id="shiftBody">${r._shifts.map((s, i) => shiftRow(s, i)).join('')}</tbody></table>
        <div class="hint" style="margin-top:12px">填写说明：班次名称建议业务化命名（白班/夜班/全天班）；夜班通常要求更高职称，最低职称/执业范围选择“不限”表示不作限制。至少配置 1 个班次。</div>`;
      U.$('#addShift', body).addEventListener('click', () => { r._shifts.push({ name: '', start: '20:00', end: '08:00', minTitle: '主治医师', scope: '内科' }); sync(); render(); });
    };
    // 删除班次的事件委托只绑定一次（绑在 body 这个不会被重建的容器上）。
    // 若把它放进 render() 内部，则每次 render() 都会在 body 上再叠加一份监听器，
    // 点击“删除”会同时触发多份处理逻辑，表现为“删除不生效”/需要点很多次。
    // 先 sync() 把当前仍与 r._shifts 一一对应的输入框内容写回，再 splice——
    // 若顺序颠倒，splice 之后 DOM（重渲染前）的 data-i 与数组下标已经错位，
    // sync() 会按旧下标写入已被删除/后移的位置，导致 undefined 报错、删除失效。
    U.delegate(body, 'click', '[data-del]', (e, t) => { sync(); r._shifts.splice(+t.dataset.del, 1); if (!r._shifts.length) r._shifts.push({ name: '', start: '08:00', end: '20:00', minTitle: '住院医师', scope: '内科' }); render(); });
    function shiftRow(s, i) {
      return `<tr>
        <td><input class="input" data-f="name" data-i="${i}" value="${U.esc(s.name)}" style="width:90px"></td>
        <td><input class="input" type="time" data-f="start" data-i="${i}" value="${s.start}" style="width:100px"></td>
        <td><input class="input" type="time" data-f="end" data-i="${i}" value="${s.end}" style="width:100px"></td>
        <td><select class="select" data-f="minTitle" data-i="${i}" style="width:110px">${titles.map(t => `<option ${t === s.minTitle ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><select class="select" data-f="scope" data-i="${i}" style="width:100px">${scopes.map(t => `<option ${t === s.scope ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><button class="btn-link danger" data-del="${i}">删除</button></td></tr>`;
    }
    function sync() {
      U.$$('#shiftBody [data-f]', body).forEach(n => { r._shifts[+n.dataset.i][n.dataset.f] = n.value; });
      r._name = (U.$('#rname', body) || {}).value ?? r._name;
      r._org = (U.$('#rorg', body) || {}).value ?? r._org;
      r._cycle = (U.$('#rcycle', body) || {}).value ?? r._cycle;
      r._start = (U.$('#rstart', body) || {}).value ?? r._start;
    }
    render();
    const foot = U.el('div');
    const cancel = U.el('button', { class: 'btn' }, '取消'); const save = U.el('button', { class: 'btn primary' }, '保存规则');
    foot.appendChild(cancel); foot.appendChild(save);
    const m = U.modal({ title: editing ? '排班规则编辑' : '新建排班规则', width: 'wide', body, footer: foot });
    cancel.addEventListener('click', m.close);
    save.addEventListener('click', () => {
      sync();
      if (!r._name.trim()) { U.$('#e_name', body).textContent = '规则名称必填'; U.$('#rname', body).classList.add('err'); return; }
      if (!r._shifts.length || r._shifts.some(s => !s.name.trim())) { U.toast('请至少配置 1 个完整班次', 'error'); return; }
      if (editing) { FHIR.update(Object.assign(editing, r)); logAudit('修改排班规则', r._name); }
      else { r.resourceType = 'Basic'; r.code = { coding: [{ code: 'scheduling-rule' }] }; r.author = FHIR.refStr('Practitioner', 'doc-wjg'); r.created = '2026-06-20'; FHIR.create(r); logAudit('新增排班规则', r._name); }
      m.close(); U.toast('规则保存成功，即时生效', 'success'); Router.render();
    });
  }

  function logAudit(action, name) {
    FHIR.create({ resourceType: 'AuditEvent', type: { text: '配置变更' }, action: 'U', recorded: new Date('2026-06-20T08:00:00').toISOString(),
      agent: [{ who: { display: AUTH.currentUser().name }, requestor: true }], _action: action, _detail: name });
  }
})();
