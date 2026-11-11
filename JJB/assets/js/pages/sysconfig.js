/* WF-L3-4-1 系统配置管理（交接班模板 / 人员与科室数据FHIR同步 / 系统参数） */
(function () {
  let tab = 'template', dataKw = '';

  window.PAGES['#/sysconfig'] = function (view) {
    view.innerHTML = `
      <div class="page-head"><div><h2>系统配置管理</h2>
        <div class="desc">维护交接清单模版设置、人员与科室数据（FHIR 同步）、系统参数等基础配置，配置变更即时生效且可追溯。</div></div></div>
      <div class="card" style="padding:0 18px">
        <div style="display:flex;gap:4px;border-bottom:1px solid var(--border)">
          ${tabBtn('template', '交接清单模版设置')}
          ${tabBtn('data', '人员与科室数据')}
          ${tabBtn('param', '系统参数')}
        </div>
      </div>
      <div id="tabBody"></div>`;
    U.delegate(view, 'click', '[data-tab]', (e, t) => { tab = t.dataset.tab; Router.render(); });
    const tb = U.$('#tabBody', view);
    if (tab === 'template') renderTemplate(tb);
    else if (tab === 'data') renderData(tb);
    else renderParam(tb);
  };
  function tabBtn(id, label) {
    const on = tab === id;
    return `<div data-tab="${id}" style="padding:12px 16px;cursor:pointer;font-weight:${on ? 600 : 400};
      color:${on ? 'var(--primary)' : 'var(--text-2)'};border-bottom:2px solid ${on ? 'var(--primary)' : 'transparent'};margin-bottom:-1px">${label}</div>`;
  }
  function logAudit(cat, action, detail) {
    FHIR.create({ resourceType: 'AuditEvent', type: { text: cat }, action: 'U', recorded: new Date('2026-06-20T08:00:00').toISOString(), agent: [{ who: { display: AUTH.currentUser().name }, requestor: true }], _action: action, _detail: detail });
  }
  function auditList(filterFn, title) {
    const a = FHIR.search('AuditEvent', filterFn, null, { silent: true }).sort((x, y) => new Date(y.recorded) - new Date(x.recorded)).slice(0, 8);
    return `<div class="card"><div class="card-title">变更记录 <span class="sub">${title}</span></div>
      ${a.length ? `<table class="tbl"><thead><tr><th>时间</th><th>操作</th><th>操作人</th><th>说明</th></tr></thead>
        <tbody>${a.map(x => `<tr><td>${U.fmtTime(x.recorded)}</td><td>${x._action}</td><td>${x.agent[0].who.display}</td><td>${x._detail}</td></tr>`).join('')}</tbody></table>`
        : '<div class="muted-text">暂无变更记录</div>'}</div>`;
  }

  /* ---------- 选项卡1：交接清单模版设置 ---------- */
  function renderTemplate(tb) {
    const list = FHIR.search('Basic', b => b.code.coding[0].code === 'handover-template', null, { silent: true });
    tb.innerHTML = `
      <div class="card">
        <div class="toolbar"><button class="btn primary" id="addT">+ 新建模版</button><input class="input" style="width:200px" placeholder="搜索模版名称"><span class="spacer"></span><span class="muted-text">共 ${list.length} 个</span></div>
        ${list.length ? `<table class="tbl"><thead><tr><th>模版名称</th><th>包含板块</th><th>适用科室</th><th>创建时间</th><th>创建人</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>${list.map(t => `<tr class="${t._status === 'active' ? '' : 'muted'}">
            <td><b>${t._name}</b></td><td>${(t._sections || []).join(' / ')}</td>
            <td>${(t._orgs && t._orgs.length) ? t._orgs.join('、') : '<span class="muted-text">—</span>'}</td>
            <td>${t.created || '—'}</td>
            <td>${t._createdBy || '—'}</td>
            <td>${t._status === 'active' ? U.tag('生效', 'green') : U.tag('失效', 'default')}</td>
            <td><button class="btn-link" data-et="${t.id}">编辑</button>
              <button class="btn-link" data-tt="${t.id}">${t._status === 'active' ? '停用' : '启用'}</button>
              <button class="btn-link danger" data-dt="${t.id}">删除</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty-state">暂无交接清单模版，可点击新建模版创建</div>'}
      </div>
      ${auditList(a => /模版|模板/.test(a._action), '仅模版相关')}`;
    U.$('#addT', tb).addEventListener('click', () => editTemplate(null));
    U.delegate(tb, 'click', '[data-et]', (e, t) => editTemplate(t.dataset.et));
    U.delegate(tb, 'click', '[data-tt]', (e, t) => { const r = FHIR.read('Basic', t.dataset.tt, { silent: true }); r._status = r._status === 'active' ? 'inactive' : 'active'; FHIR.update(r); logAudit('配置变更', (r._status === 'active' ? '启用' : '停用') + '交接清单模版', r._name); Router.render(); });
    U.delegate(tb, 'click', '[data-dt]', (e, t) => { const r = FHIR.read('Basic', t.dataset.dt, { silent: true }); U.confirm({ title: '删除模版', danger: true, content: `确认删除交接清单模版「${r._name}」？` }).then(ok => { if (!ok) return; FHIR.remove('Basic', t.dataset.dt); logAudit('配置变更', '删除交接清单模版', r._name); U.toast('已删除', 'success'); Router.render(); }); });
  }
  // 一个科室当前只能绑定一套“在用（生效）”的交接清单模版：查找该科室名是否已被其他生效模版占用
  function orgBoundElsewhere(orgName, excludeId) {
    return FHIR.search('Basic', b => b.code.coding[0].code === 'handover-template' && b._status === 'active' && b.id !== excludeId && (b._orgs || []).includes(orgName), null, { silent: true })[0];
  }
  function editTemplate(id) {
    const editing = id ? FHIR.read('Basic', id, { silent: true }) : null;
    const all = ['在院患者清单', '重点患者标记', '待办事项汇总', '交接补充信息', '接班确认说明', '双方电子签名'];
    const orgs = FHIR.search('Organization', o => o.active, null, { silent: true });
    const t = editing || { _name: '', _status: 'active', _sections: ['在院患者清单', '待办事项汇总', '双方电子签名'], _orgs: [] };
    const body = U.el('div');
    body.innerHTML = `<div class="form-item"><label><span class="req">*</span>模版名称</label><input class="input" id="tn" value="${U.esc(t._name)}"></div>
      <div class="form-item"><label><span class="req">*</span>适用科室 <span class="sub">可多选，一个科室同时只能有一套在用模版</span></label>
        ${orgs.map(o => `<label style="display:inline-block;margin:4px 14px 4px 0;font-weight:400"><input type="checkbox" class="org-cb" value="${o.name}" ${(t._orgs || []).includes(o.name) ? 'checked' : ''}> ${o.name}</label>`).join('')}
        <div class="field-err" id="e_orgs"></div></div>
      <div class="form-item"><label>包含板块</label>${all.map(s => `<label style="display:block;font-weight:400;margin:4px 0"><input type="checkbox" class="sec-cb" value="${s}" ${t._sections.includes(s) ? 'checked' : ''}> ${s}</label>`).join('')}</div>
      <div class="form-item"><label>状态</label><select class="select" id="ts"><option value="active" ${t._status === 'active' ? 'selected' : ''}>生效</option><option value="inactive" ${t._status !== 'active' ? 'selected' : ''}>失效</option></select></div>`;
    const foot = U.el('div'); const c = U.el('button', { class: 'btn' }, '取消'); const ok = U.el('button', { class: 'btn primary' }, '保存');
    foot.appendChild(c); foot.appendChild(ok);
    const m = U.modal({ title: editing ? '编辑交接清单模版' : '新建交接清单模版', body, footer: foot });
    c.addEventListener('click', m.close);
    // 勾选某科室时，若该科室已绑定在用的另一套模版，提示会覆盖对方的适用科室配置；取消则撤销这次勾选
    U.delegate(body, 'change', '.org-cb', (e, t2) => {
      if (!t2.checked) return;
      const other = orgBoundElsewhere(t2.value, editing ? editing.id : null);
      if (!other) return;
      const cb = t2;
      cb.checked = false; // 先复位，等待用户确认后再勾上，避免确认过程中出现“已勾选但未决定”的中间态
      U.confirm({ title: '科室已绑定其他在用模版', content: `该科室已绑定在用的交接清单模板「${U.esc(other._name)}」，若继续勾选，会覆盖原有模板的适用科室配置，是否确认勾选？` })
        .then(ok2 => { if (ok2) cb.checked = true; });
    });
    ok.addEventListener('click', () => {
      const name = U.$('#tn', body).value.trim(); if (!name) { U.toast('模版名称必填', 'error'); return; }
      const orgsSel = U.$$('.org-cb', body).filter(x => x.checked).map(x => x.value);
      if (!orgsSel.length) { U.$('#e_orgs', body).textContent = '请至少选择一个适用科室'; return; }
      const secs = U.$$('.sec-cb', body).filter(x => x.checked).map(x => x.value);
      const status = U.$('#ts', body).value;
      let newId;
      if (editing) { Object.assign(editing, { _name: name, _sections: secs, _orgs: orgsSel, _status: status }); FHIR.update(editing); newId = editing.id; logAudit('配置变更', '编辑交接清单模版', name); }
      else { const created = FHIR.create({ resourceType: 'Basic', code: { coding: [{ code: 'handover-template' }] }, _name: name, _sections: secs, _orgs: orgsSel, _status: status, created: '2026-06-20', _createdBy: AUTH.currentUser().name }); newId = created.id; logAudit('配置变更', '新建交接清单模版', name); }
      // 一个科室只保留一套在用模版：本次勾选的科室，从其他仍生效的模版中移除
      if (status === 'active') {
        orgsSel.forEach(orgName => {
          const other = orgBoundElsewhere(orgName, newId);
          if (other) { other._orgs = (other._orgs || []).filter(x => x !== orgName); FHIR.update(other, { silent: true }); }
        });
      }
      m.close(); U.toast('模版保存成功，交接清单将立即使用最新模版', 'success'); Router.render();
    });
  }

  /* ---------- 选项卡2：人员与科室数据（FHIR 同步） ---------- */
  function renderData(tb) {
    const roles = FHIR.search('PractitionerRole', () => true, null, { silent: true });
    const people = roles.map(r => ({ p: FHIR.resolve(r.practitioner), r })).filter(x => x.p);
    const orgs = FHIR.search('Organization', () => true, null, { silent: true });
    const kwf = (s) => !dataKw || s.includes(dataKw);
    const fpeople = people.filter(x => kwf(x.p.name[0].text) || kwf(x.r._qualification || '') || kwf((x.r.specialty[0] || {}).text || ''));
    const forgs = orgs.filter(o => kwf(o.name) || kwf((o.identifier[0] || {}).value || ''));

    tb.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <button class="btn primary" id="sync">🔄 同步 FHIR 数据</button>
          <button class="btn" id="addP">手动新增</button>
          <button class="btn" id="imp">批量导入</button>
          <button class="btn" id="exp">导出数据</button>
          <input class="input" id="dkw" style="width:200px" placeholder="按名称/编码/职称搜索" value="${U.esc(dataKw)}">
          <span class="spacer"></span><span class="muted-text">人员 ${people.length} · 科室 ${orgs.length}</span>
        </div>
        <table class="tbl"><thead><tr><th>类型</th><th>名称</th><th>编码</th><th>职称</th><th>执业范围</th><th>所属/状态</th><th>操作</th></tr></thead>
          <tbody>
            ${forgs.map(o => `<tr><td>${U.tag('科室', 'cyan')}</td><td><b>${o.name}</b></td><td>${(o.identifier[0] || {}).value || ''}</td><td>—</td><td>—</td><td>${o.active ? U.tag('启用', 'green') : U.tag('停用', 'default')}</td><td><span class="muted-text">FHIR 同步</span></td></tr>`).join('')}
            ${fpeople.map(x => personRow(x)).join('')}
          </tbody></table>
        <div class="muted-text" style="font-size:12px;margin-top:8px">数据与 FHIR 中台同步时自动拉取 qualification（资质）信息，确保排班资质校验准确。</div>
      </div>
      ${auditList(a => /同步|人员|科室|数据/.test(a._action), '数据同步 / 维护')}`;

    U.$('#sync', tb).addEventListener('click', doSync);
    U.$('#dkw', tb).addEventListener('input', e => { dataKw = e.target.value; Router.render(); setTimeout(() => { const n = U.$('#dkw'); if (n) { n.focus(); n.value = dataKw; } }); });
    U.$('#addP', tb).addEventListener('click', () => editPerson(null));
    U.$('#imp', tb).addEventListener('click', () => U.toast('批量导入：请选择 Excel 文件…（演示）', 'info'));
    U.$('#exp', tb).addEventListener('click', () => U.toast('正在导出人员/科室数据（Excel）…（演示）', 'info'));
    U.delegate(tb, 'click', '[data-ep]', (e, t) => editPerson(t.dataset.ep));

    function personRow(x) {
      const off = !x.p.active;
      return `<tr class="${off ? 'muted' : ''}"><td>${U.tag('人员', 'blue')}</td><td><b>${x.p.name[0].text}</b></td>
        <td>${(x.p.identifier[0] || {}).value || ''}</td><td>${x.r._qualification || '—'}</td>
        <td>${(x.r.specialty[0] || {}).text || '—'}</td>
        <td>${FHIR.displayOf(FHIR.resolve(x.r.organization))} ${off ? U.tag('停用', 'default') : ''}</td>
        <td><button class="btn-link" data-ep="${x.p.id}">编辑</button></td></tr>`;
    }
  }
  function doSync() {
    const foot = U.el('div');
    const m = U.modal({ title: '同步 FHIR 数据', maskClose: false, body: `<div style="text-align:center;padding:20px"><div style="font-size:38px">🔄</div><p>正在连接 FHIR 中台，拉取最新人员 / 科室数据…</p></div>`, footer: foot });
    FHIR.search('Practitioner', null, { _sync: 'true' }, { silent: false });
    FHIR.search('Organization', null, { _sync: 'true' }, { silent: false });
    setTimeout(() => {
      const n = FHIR.count('Practitioner') + FHIR.count('Organization');
      logAudit('数据同步', '同步 FHIR 人员/科室数据', `更新 ${n} 条记录`);
      m.body.innerHTML = `<div style="text-align:center;padding:20px"><div style="font-size:38px">✅</div><p>数据同步成功，更新 ${n} 条记录</p></div>`;
      setTimeout(() => { m.close(); U.toast(`数据同步成功，更新 ${n} 条记录`, 'success'); Router.render(); }, 700);
    }, 1100);
  }
  function editPerson(id) {
    const editing = id ? FHIR.read('Practitioner', id, { silent: true }) : null;
    const role = editing ? FHIR.search('PractitionerRole', x => x.practitioner.reference === 'Practitioner/' + id, null, { silent: true })[0] : null;
    const orgs = FHIR.search('Organization', () => true, null, { silent: true });
    const titles = ['住院医师', '主治医师', '副主任医师', '主任医师'];
    const scopes = ['内科', '外科', '急诊', '神经内科'];
    const name = editing ? editing.name[0].text : '';
    const q = role ? role._qualification : '住院医师';
    const sp = role && role.specialty[0] ? role.specialty[0].text : '内科';
    const org = role ? role.organization.reference.split('/')[1] : orgs[0].id;
    const body = U.el('div');
    body.innerHTML = `<div class="form-row">
        <div class="form-item"><label><span class="req">*</span>姓名</label><input class="input" id="pn" value="${U.esc(name)}"></div>
        <div class="form-item"><label>所属科室</label><select class="select" id="po">${orgs.map(o => `<option value="${o.id}" ${o.id === org ? 'selected' : ''}>${o.name}</option>`).join('')}</select></div>
      </div>
      <div class="form-row">
        <div class="form-item"><label>职称</label><select class="select" id="pq">${titles.map(x => `<option ${x === q ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="form-item"><label>执业范围</label><select class="select" id="ps">${scopes.map(x => `<option ${x === sp ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      </div>
      <label style="font-weight:400"><input type="checkbox" id="back" checked> 保存后反向同步至 FHIR 中台</label>`;
    const foot = U.el('div'); const c = U.el('button', { class: 'btn' }, '取消'); const ok = U.el('button', { class: 'btn primary' }, '保存');
    foot.appendChild(c); foot.appendChild(ok);
    const m = U.modal({ title: editing ? '编辑人员' : '手动新增人员', body, footer: foot });
    c.addEventListener('click', m.close);
    ok.addEventListener('click', () => {
      const nm = U.$('#pn', body).value.trim(); if (!nm) { U.toast('姓名必填', 'error'); return; }
      const nq = U.$('#pq', body).value, ns = U.$('#ps', body).value, no = U.$('#po', body).value;
      const back = U.$('#back', body).checked;
      if (editing) {
        editing.name = [{ text: nm, family: nm[0], given: [nm.slice(1)] }]; editing.qualification = [{ code: { text: nq } }]; FHIR.update(editing);
        role._qualification = nq; role.specialty = [{ text: ns }]; role.organization = FHIR.refStr('Organization', no); FHIR.update(role);
      } else {
        const pid = U.uid('practitioner');
        FHIR.create({ resourceType: 'Practitioner', id: pid, active: true, identifier: [{ value: pid.toUpperCase() }], name: [{ text: nm, family: nm[0], given: [nm.slice(1)] }], qualification: [{ code: { text: nq } }], _account: { username: '', status: 'active', appRole: '' } });
        FHIR.create({ resourceType: 'PractitionerRole', practitioner: FHIR.refStr('Practitioner', pid), organization: FHIR.refStr('Organization', no), code: [{ text: '值班医生' }], specialty: [{ text: ns }], _qualification: nq });
      }
      logAudit('数据维护', editing ? '编辑人员' : '新增人员', nm + (back ? '（已反向同步FHIR）' : ''));
      m.close(); U.toast('保存成功' + (back ? '，已反向同步至 FHIR' : ''), 'success'); Router.render();
    });
  }

  /* ---------- 选项卡3：系统参数 ---------- */
  function renderParam(tb) {
    const sp = FHIR.read('Basic', 'sysparam', { silent: true });
    const groups = {};
    sp._params.forEach(p => { (groups[p.group] = groups[p.group] || []).push(p); });
    tb.innerHTML = `
      <div class="card">
        <div class="toolbar"><button class="btn primary" id="saveP">保存参数</button><button class="btn" id="resetP">重置默认</button><input class="input" style="width:200px" placeholder="搜索参数"><span class="spacer"></span></div>
        ${Object.entries(groups).map(([g, ps]) => `<div class="card-title" style="font-size:14px">${g}</div>
          <table class="tbl" style="margin-bottom:14px"><thead><tr><th style="width:200px">参数名称</th><th style="width:180px">参数值</th><th>说明</th></tr></thead>
          <tbody>${ps.map(p => `<tr><td>${p.name}</td>
            <td>${p.type === 'enum'
        ? `<select class="select" data-key="${p.key}" style="width:120px">${p.options.map(o => `<option ${o === p.value ? 'selected' : ''}>${o}</option>`).join('')}</select>`
        : `<input class="input" type="number" data-key="${p.key}" value="${p.value}" style="width:120px"> <span class="muted-text">${p.unit}</span>`}</td>
            <td class="muted-text">${p.desc}</td></tr>`).join('')}</tbody></table>`).join('')}
        <div class="muted-text" style="font-size:12px">编辑后点击「保存参数」批量生效；数值类参数需为正整数。</div>
      </div>
      ${auditList(a => /参数/.test(a._action), '系统参数修改')}`;
    U.$('#saveP', tb).addEventListener('click', () => {
      const sp2 = FHIR.read('Basic', 'sysparam', { silent: true });
      let bad = false;
      U.$$('[data-key]', tb).forEach(n => {
        const p = sp2._params.find(x => x.key === n.dataset.key);
        if (p.type === 'number') { const v = parseInt(n.value); if (isNaN(v) || v <= 0) { bad = true; n.classList.add('err'); return; } p.value = v; }
        else p.value = n.value;
      });
      if (bad) { U.toast('存在非法参数值（须为正整数）', 'error'); return; }
      FHIR.update(sp2); logAudit('配置变更', '修改系统参数', '批量保存系统参数'); U.toast('系统参数已保存并生效', 'success');
    });
    U.$('#resetP', tb).addEventListener('click', () => U.confirm({ title: '重置默认', danger: true, content: '确认将所有系统参数恢复为出厂默认值？' }).then(ok => { if (ok) U.toast('已重置为默认参数（演示）', 'success'); }));
  }
})();
