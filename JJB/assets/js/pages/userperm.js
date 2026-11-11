/* WF-L3-4-2 用户权限管理（用户增删改 + 角色权限树 + 审计） */
(function () {
  let kw = '';

  // 角色说明（IA L3-4-2 P3：职责与权限范围说明，辅助正确分配）
  const ROLE_DESC = {
    '值班医生': '当班值班人员，负责填写交接信息并完成交接签名。权限范围：交接班管理。',
    '接班医生': '下一班次值班人员，负责接收交接内容并确认签收。权限范围：交接班管理。',
    '科室负责人': '科室管理层，负责排班安排与交接班监督。权限范围：值班排班管理、值班质量监控。',
    '医院管理部门': '院级管理层，负责查看值班质量评价与统计分析。权限范围：值班质量监控（全院）。',
    '管理员': '系统运维，负责基础数据与系统配置维护。权限范围：系统管理。',
  };

  function users() {
    return FHIR.search('Practitioner', p => p._account && p._account.username, { _profile: 'app-user' })
      .map(p => {
        const r = FHIR.search('PractitionerRole', x => x.practitioner.reference === 'Practitioner/' + p.id, null, { silent: true })[0];
        const org = r ? FHIR.resolve(r.organization) : null;
        return { p, org: org ? org.name : '不限', role: (p._account.appRole || (r && r.code[0] ? r.code[0].text : '值班医生')) };
      }).filter(u => !kw || u.p.name[0].text.includes(kw) || u.p._account.username.includes(kw));
  }

  // 角色默认权限（依据 IA-3.3）
  function defaultPerms(role) {
    const set = {};
    AUTH.NAV.forEach(m => m.children.forEach(c => {
      const ok = m.roles.includes(role) && (!c.roles || c.roles.includes(role));
      set[c.code] = ok;
    }));
    return set;
  }

  window.PAGES['#/userperm'] = function (view) {
    const list = users();
    const audits = FHIR.search('AuditEvent', a => /权限|用户|账号/.test(a._action || a.type.text), null, { silent: true })
      .sort((a, b) => new Date(b.recorded) - new Date(a.recorded)).slice(0, 8);

    view.innerHTML = `
      <div class="page-head"><div><h2>用户权限管理</h2>
        <div class="desc">管理系统用户账号、角色与功能权限，权限配置通过弹框完成，保存后实时生效，所有修改自动记入变更记录。</div></div></div>

      <div class="row" style="align-items:flex-start">
        <div style="flex:1.5;min-width:360px">
          <div class="card">
            <div class="toolbar"><button class="btn primary" id="add">+ 新增用户</button>
              <input class="input" id="kw" style="width:200px" placeholder="按账号/姓名搜索" value="${U.esc(kw)}">
              <span class="spacer"></span><span class="muted-text">共 ${list.length} 个用户</span></div>
            <table class="tbl"><thead><tr><th>账号</th><th>姓名</th><th>科室</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>${list.map(rowOf).join('')}</tbody></table>
          </div>
        </div>
        <div style="flex:1;min-width:280px">
          <div class="card"><div class="card-title">权限变更记录 <span class="sub">全量审计</span></div>
            ${audits.length ? audits.map(a => `<div style="padding:8px 0;border-bottom:1px solid #f0f0f0">
              <div><b>${a._action || a.type.text}</b></div>
              <div class="muted-text" style="font-size:12px">${U.fmtTime(a.recorded)} · ${a.agent[0].who.display} · ${a._detail || ''}</div></div>`).join('')
        : '<div class="muted-text">暂无权限变更记录</div>'}
          </div>
        </div>
      </div>`;

    U.$('#kw', view).addEventListener('input', e => { kw = e.target.value; Router.render(); setTimeout(() => { const n = U.$('#kw'); if (n) { n.focus(); n.value = kw; } }); });
    U.$('#add', view).addEventListener('click', () => editUser(null));
    U.delegate(view, 'click', '[data-eu]', (e, t) => editUser(t.dataset.eu));
    U.delegate(view, 'click', '[data-tu]', (e, t) => toggleUser(t.dataset.tu));

    function rowOf(u) {
      const off = u.p._account.status !== 'active';
      return `<tr class="${off ? 'muted' : ''}"><td>${u.p._account.username}</td><td><b>${u.p.name[0].text}</b></td>
        <td>${u.org}</td><td>${U.tag(u.role, U.roleColor(u.role))}</td>
        <td>${off ? U.tag('禁用', 'default') : U.tag('启用', 'green')}</td>
        <td><button class="btn-link" data-eu="${u.p.id}">编辑</button>
          <button class="btn-link ${off ? '' : 'danger'}" data-tu="${u.p.id}">${off ? '启用' : '禁用'}</button></td></tr>`;
    }
  };

  function toggleUser(id) {
    const p = FHIR.read('Practitioner', id, { silent: true });
    const next = p._account.status === 'active' ? 'disabled' : 'active';
    U.confirm({ title: next === 'disabled' ? '禁用用户' : '启用用户', danger: next === 'disabled', content: `确认${next === 'disabled' ? '禁用' : '启用'}用户「${p.name[0].text}」？${next === 'disabled' ? '禁用后该用户立即无法登录。' : ''}` })
      .then(ok => { if (!ok) return; p._account.status = next; FHIR.update(p); logAudit((next === 'disabled' ? '禁用' : '启用') + '用户', p.name[0].text); U.toast('已' + (next === 'disabled' ? '禁用' : '启用'), 'success'); Router.render(); });
  }

  function editUser(id) {
    const editing = id ? FHIR.read('Practitioner', id, { silent: true }) : null;
    const role0 = editing ? (editing._account.appRole || '值班医生') : '值班医生';
    const orgs = FHIR.search('Organization', () => true, null, { silent: true });
    const roleObj = editing ? FHIR.search('PractitionerRole', x => x.practitioner.reference === 'Practitioner/' + id, null, { silent: true })[0] : null;
    const state = {
      username: editing ? editing._account.username : '',
      name: editing ? editing.name[0].text : '',
      org: (roleObj && roleObj.organization) ? roleObj.organization.reference.split('/')[1] : '',
      role: role0,
      // 若已保存过自定义权限勾选，重新打开时应恢复该勾选状态，而不是每次都重置为角色默认值
      perms: (editing && editing._account.perms) ? editing._account.perms : defaultPerms(role0),
    };
    const body = U.el('div');
    function render() {
      body.innerHTML = `
        <div class="form-row">
          <div class="form-item"><label><span class="req">*</span>账号</label><input class="input" id="un" value="${U.esc(state.username)}" ${editing ? 'disabled' : ''}></div>
          <div class="form-item"><label><span class="req">*</span>姓名</label><input class="input" id="nm" value="${U.esc(state.name)}"></div>
        </div>
        <div class="form-row">
          <div class="form-item"><label>所属科室</label><select class="select" id="og">
            <option value="" ${!state.org ? 'selected' : ''}>不限</option>
            ${orgs.map(o => `<option value="${o.id}" ${o.id === state.org ? 'selected' : ''}>${o.name}</option>`).join('')}
          </select></div>
          <div class="form-item"><label>角色</label><select class="select" id="rl">${AUTH.ROLES.map(r => `<option ${r === state.role ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
        </div>
        <div class="hint" style="margin-bottom:12px">👤 <b>${state.role}</b>：${ROLE_DESC[state.role] || ''}</div>
        <div class="card-title" style="font-size:14px">功能权限（切换角色自动加载默认值，可手动微调）</div>
        <div class="card flat" style="margin:0">${permTree()}</div>`;
      U.$('#rl', body).addEventListener('change', e => { sync(); state.role = e.target.value; state.perms = defaultPerms(state.role); render(); });
    }
    function permTree() {
      return AUTH.NAV.map(m => {
        const kids = m.children;
        const checkedAll = kids.every(c => state.perms[c.code]);
        const some = kids.some(c => state.perms[c.code]);
        return `<div style="margin-bottom:8px">
          <label style="font-weight:600"><input type="checkbox" data-mod="${m.id}" ${checkedAll ? 'checked' : ''} ${!checkedAll && some ? 'data-indet="1"' : ''}> ${m.icon} ${m.title}</label>
          <div style="padding-left:24px">${kids.map(c => `<label style="display:inline-block;margin:3px 14px 3px 0;font-weight:400"><input type="checkbox" data-perm="${c.code}" ${state.perms[c.code] ? 'checked' : ''}> ${c.title}</label>`).join('')}</div>
        </div>`;
      }).join('');
    }
    function sync() {
      state.username = (U.$('#un', body) || {}).value ?? state.username;
      state.name = (U.$('#nm', body) || {}).value ?? state.name;
      state.org = (U.$('#og', body) || {}).value ?? state.org;
      U.$$('[data-perm]', body).forEach(n => state.perms[n.dataset.perm] = n.checked);
    }
    render();
    // 模块级全选联动
    U.delegate(body, 'change', '[data-mod]', (e, t) => {
      sync(); const m = AUTH.NAV.find(x => x.id === t.dataset.mod);
      m.children.forEach(c => state.perms[c.code] = t.checked); render();
    });
    const foot = U.el('div'); const c = U.el('button', { class: 'btn' }, '取消'); const ok = U.el('button', { class: 'btn primary' }, '保存');
    foot.appendChild(c); foot.appendChild(ok);
    const m = U.modal({ title: editing ? '编辑用户' : '新增用户', width: 'wide', body, footer: foot });
    c.addEventListener('click', m.close);
    ok.addEventListener('click', () => {
      sync();
      if (!state.username.trim() || !state.name.trim()) { U.toast('账号与姓名必填', 'error'); return; }
      if (editing) {
        editing.name = [{ text: state.name, family: state.name[0], given: [state.name.slice(1)] }];
        editing._account.appRole = state.role;
        editing._account.perms = state.perms;   // 持久化手动勾选结果，避免下次打开时丢失
        FHIR.update(editing);
        if (roleObj) {
          roleObj.code = [{ text: state.role }];
          if (state.org) roleObj.organization = FHIR.refStr('Organization', state.org); else delete roleObj.organization;
          FHIR.update(roleObj);
        }
        logAudit('编辑用户权限', `${state.name} · 角色=${state.role}`);
      } else {
        const pid = U.uid('practitioner');
        FHIR.create({ resourceType: 'Practitioner', id: pid, active: true, identifier: [{ value: pid.toUpperCase() }], name: [{ text: state.name, family: state.name[0], given: [state.name.slice(1)] }], qualification: [], _account: { username: state.username, status: 'active', appRole: state.role, perms: state.perms } });
        const newRole = { resourceType: 'PractitionerRole', practitioner: FHIR.refStr('Practitioner', pid), code: [{ text: state.role }], specialty: [], _qualification: '' };
        if (state.org) newRole.organization = FHIR.refStr('Organization', state.org);
        FHIR.create(newRole);
        logAudit('新增用户', `${state.name} · 角色=${state.role}`);
      }
      m.close(); U.toast('用户保存成功，权限实时生效', 'success'); Router.render();
    });
  }

  function logAudit(action, detail) {
    FHIR.create({ resourceType: 'AuditEvent', type: { text: '权限变更' }, action: 'U', recorded: new Date('2026-06-20T08:00:00').toISOString(), agent: [{ who: { display: AUTH.currentUser().name }, requestor: true }], _action: action, _detail: detail });
  }
})();
