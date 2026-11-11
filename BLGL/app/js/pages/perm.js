/* ============== L3-3-3 用户权限管理（系统管理员） ============== */
App.registerPage('perm', (user, params, ctx) => {
  const F = window.FHIR, U = window.UI;
  const esc = U.esc;
  const st = { tab: 'users', kw: '', role: 'all', status: 'all', logType: 'all' };
  const MODULES = [
    { mod: '书写管理', pages: ['病历书写时限监控', '整改任务处理'] },
    { mod: '统计监督', pages: ['整改任务追踪', '病历归档管理', '病历质量概览', '书写及时率统计'] },
    { mod: '配置管理', pages: ['书写时限配置', '质控规则配置', '用户权限管理'] },
  ];
  const ROLE_TEMPLATE = {
    clinician: ['病历书写时限监控', '整改任务处理'],
    deptHead: ['整改任务追踪', '病历质量概览', '书写及时率统计'],
    archivist: ['病历归档管理'],
    qc: ['整改任务追踪', '病历质量概览', '书写及时率统计', '书写时限配置', '质控规则配置'],
    admin: ['用户权限管理'],
  };
  const SCOPE = { clinician: '仅本人', deptHead: '本科室', archivist: '全院', qc: '全院', admin: '全院' };
  const roleName = k => F.ROLES[k].name;

  const el = U.h(`<div class="page"></div>`);
  function render() {
    el.innerHTML = `
      ${App.crumb('perm')}
      <div class="page-head"><h1 class="page-title">用户权限管理</h1><div class="desc">管理各角色的功能访问权限与数据可见范围，配置变更可追溯审计</div></div>
      <div class="tabs">
        <div class="tab ${st.tab === 'users' ? 'on' : ''}" data-t="users">用户权限</div>
        <div class="tab ${st.tab === 'tpl' ? 'on' : ''}" data-t="tpl">角色模板</div>
        <div class="tab ${st.tab === 'log' ? 'on' : ''}" data-t="log">变更日志</div></div>
      <div id="tb"></div>`;
    el.querySelectorAll('.tab').forEach(t => t.onclick = () => { st.tab = t.dataset.t; render(); });
    ({ users: renderUsers, tpl: renderTpl, log: renderLog }[st.tab])();
  }

  function renderUsers() {
    let users = F.col('Practitioner').slice();
    if (st.kw) users = users.filter(u => u.name.includes(st.kw));
    if (st.role !== 'all') users = users.filter(u => u.role === st.role);
    if (st.status !== 'all') users = users.filter(u => st.status === 'on' ? u.active : !u.active);
    el.querySelector('#tb').innerHTML = `
      <div class="filters">
        <div class="fld"><label>用户姓名</label><input id="fkw" value="${esc(st.kw)}"></div>
        <div class="fld"><label>角色</label><select id="frole"><option value="all">全部</option>${Object.values(F.ROLES).map(r => `<option value="${r.key}">${esc(r.name)}</option>`).join('')}</select></div>
        <div class="fld"><label>状态</label><select id="fst"><option value="all">全部</option><option value="on">启用</option><option value="off">停用</option></select></div>
      </div>
      <div class="card"><div class="card-h"><h3>用户列表</h3><span class="p">P1</span></div>
        <div class="card-b" style="padding:0"><table><thead><tr><th>序号</th><th>用户姓名</th><th>角色</th><th>所属科室</th><th>状态</th><th>最近登录时间</th><th>操作</th></tr></thead>
        <tbody id="utb"></tbody></table></div></div>`;
    const tb = el.querySelector('#tb');
    tb.querySelector('#frole').value = st.role; tb.querySelector('#fst').value = st.status;
    tb.querySelector('#fkw').oninput = e => { st.kw = e.target.value; render(); };
    tb.querySelector('#frole').onchange = e => { st.role = e.target.value; render(); };
    tb.querySelector('#fst').onchange = e => { st.status = e.target.value; render(); };
    const utb = el.querySelector('#utb');
    users.forEach((u, i) => {
      const tr = U.h(`<tr><td>${i + 1}</td><td>${esc(u.name)}</td><td>${esc(roleName(u.role))}</td><td>${esc(F.orgName(u.org))}</td>
        <td>${u.active ? '<span class="pill green"><span class="dot green"></span>启用</span>' : '<span class="pill gray"><span class="dot gray"></span>停用</span>'}</td>
        <td>${F.mdhm(u.lastLogin)}</td><td><button class="linkbtn" data-id="${u.id}">配置权限</button></td></tr>`);
      tr.querySelector('[data-id]').onclick = () => openPermDlg(u);
      utb.appendChild(tr);
    });
  }

  function permMatrix(role, { editable = false } = {}) {
    const allowed = ROLE_TEMPLATE[role] || [];
    const rows = MODULES.map(m => `
      <tr><td rowspan="${m.pages.length}" style="vertical-align:top;font-weight:600">${esc(m.mod)}</td>
        <td>${esc(m.pages[0])}</td><td>${cell(m.pages[0])}</td></tr>
      ${m.pages.slice(1).map(p => `<tr><td>${esc(p)}</td><td>${cell(p)}</td></tr>`).join('')}`).join('');
    function cell(page) {
      const on = allowed.includes(page);
      return `<label class="checkline" style="padding:0"><input type="checkbox" ${on ? 'checked' : ''} ${editable ? '' : 'disabled'} data-page="${esc(page)}"> ${on ? '可访问' : '不可访问'}</label>`;
    }
    return `<div class="sec-title">功能访问权限</div>
      <table class="matrix"><thead><tr><th>模块</th><th>页面</th><th>访问权限</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="sec-title">数据可见范围</div>
      <table class="matrix"><tbody>${allowed.map(p => `<tr><td>${esc(p)}</td><td>
        ${['仅本人', '本科室', '全院'].map(s => `<label style="margin-right:14px"><input type="radio" name="scope-${esc(p)}" ${s === SCOPE[role] ? 'checked' : ''} ${editable ? '' : 'disabled'}> ${s}</label>`).join('')}</td></tr>`).join('') || '<tr><td class="muted">无可访问页面</td></tr>'}</tbody></table>`;
  }

  function openPermDlg(u) {
    let role = u.role, active = u.active;
    const body = U.h(`<div>
      <div class="flex" style="gap:18px;margin-bottom:14px"><div><b>用户姓名：</b>${esc(u.name)}</div>
        <div class="flex"><b>角色：</b><select id="prole">${Object.values(F.ROLES).map(r => `<option value="${r.key}" ${r.key === role ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
        <div class="flex"><b>状态：</b><div class="switch ${active ? 'on' : ''}" id="psw"></div><span id="pswl">${active ? '启用' : '停用'}</span></div></div>
      <div id="matrix">${permMatrix(role, { editable: true })}</div>
      <div class="wrap-note">角色切换时可一键填充默认权限 <button class="linkbtn" id="applyTpl">应用角色模板权限</button></div>
    </div>`);
    body.querySelector('#psw').onclick = () => { active = !active; body.querySelector('#psw').classList.toggle('on', active); body.querySelector('#pswl').textContent = active ? '启用' : '停用'; };
    body.querySelector('#prole').onchange = e => { role = e.target.value; };
    body.querySelector('#applyTpl').onclick = () => { body.querySelector('#matrix').innerHTML = permMatrix(role, { editable: true }); U.toast(`已应用「${roleName(role)}」默认权限模板`, 'info'); };
    const m = U.modal({ title: `配置权限 — ${u.name}`, width: 'w760', body, footer: `<button class="btn cancel">取消</button><button class="btn pri save">保存</button>` });
    m.el.querySelector('.cancel').onclick = m.close;
    m.el.querySelector('.save').onclick = () => {
      const changed = role !== u.role || active !== u.active;
      const oldRole = u.role; u.role = role; u.active = active;
      if (changed) F.col('AuditEvent').push({ resourceType: 'AuditEvent', id: F.uid('aud'), area: '权限', at: F.NOW().toISOString(), by: user.name, op: '权限修改',
        content: role !== oldRole ? `修改${u.name}角色：${roleName(oldRole)}→${roleName(role)}` : `${active ? '启用' : '停用'}${u.name}账号` });
      F.save(); m.close(); U.toast('权限配置已保存，实时生效', 'ok'); render();
    };
  }

  function renderTpl() {
    el.querySelector('#tb').innerHTML = `
      <div class="card"><div class="card-h"><h3>角色模板管理</h3><span class="p">P2</span></div>
        <div class="card-b" style="padding:0"><table><thead><tr><th>序号</th><th>角色名称</th><th>权限概要</th><th>数据范围</th><th>操作</th></tr></thead>
        <tbody>${Object.values(F.ROLES).map((r, i) => {
          const pages = ROLE_TEMPLATE[r.key];
          return `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(pages.length ? `可访问 ${pages.length} 个页面` : '—')}：${esc(pages.join('、'))}</td>
            <td><span class="tag-soft">${esc(SCOPE[r.key])}</span></td>
            <td><button class="linkbtn" data-v="${r.key}">查看</button><button class="linkbtn" data-e="${r.key}">编辑</button></td></tr>`;
        }).join('')}</tbody></table></div></div>`;
    el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => openTplDlg(b.dataset.v, false));
    el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => openTplDlg(b.dataset.e, true));
  }
  function openTplDlg(role, editable) {
    const body = U.h(`<div><div style="margin-bottom:10px"><b>角色名称：</b>${esc(roleName(role))}</div>${permMatrix(role, { editable })}</div>`);
    const footer = editable ? `<button class="btn cancel">取消</button><button class="btn pri save">保存</button>` : `<button class="btn pri close">关闭</button>`;
    const m = U.modal({ title: `角色模板 — ${roleName(role)}`, width: 'w760', body, footer });
    if (editable) {
      m.el.querySelector('.cancel').onclick = m.close;
      m.el.querySelector('.save').onclick = async () => {
        if (await U.confirm(`修改「${roleName(role)}」模板将影响所有使用该角色的用户，确定保存？`, { title: '保存角色模板', okText: '保存' })) {
          F.col('AuditEvent').push({ resourceType: 'AuditEvent', id: F.uid('aud'), area: '模板', at: F.NOW().toISOString(), by: user.name, op: '模板修改', content: `修改${roleName(role)}模板权限` });
          F.save(); m.close(); U.toast('角色模板已保存', 'ok'); render();
        }
      };
    } else m.el.querySelector('.close').onclick = m.close;
  }

  function renderLog() {
    let logs = F.col('AuditEvent').filter(a => ['权限', '模板'].includes(a.area)).sort((a, b) => new Date(b.at) - new Date(a.at));
    if (st.logType !== 'all') logs = logs.filter(a => a.op === st.logType);
    el.querySelector('#tb').innerHTML = `
      <div class="filters">
        <div class="fld"><label>操作类型</label><select id="flt"><option value="all">全部</option><option>权限修改</option><option>模板修改</option></select></div>
      </div>
      <div class="card"><div class="card-h"><h3>变更日志</h3><span class="p">P3</span></div>
        <div class="card-b" style="padding:0"><table><thead><tr><th>操作时间</th><th>操作人</th><th>操作类型</th><th>变更内容</th></tr></thead>
        <tbody>${logs.map(a => `<tr><td>${F.mdhm(a.at)}</td><td>${esc(a.by)}</td><td><span class="tag-soft">${esc(a.op)}</span></td><td>${esc(a.content)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty-box">暂无日志</div></td></tr>'}</tbody></table></div></div>`;
    el.querySelector('#flt').value = st.logType;
    el.querySelector('#flt').onchange = e => { st.logType = e.target.value; render(); };
  }

  render();
  return el;
});
