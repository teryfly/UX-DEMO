/* ============== L3-3-1 书写时限配置（质量管理部门） ============== */
App.registerPage('time-config', (user, params, ctx) => {
  const F = window.FHIR, U = window.UI;
  const esc = U.esc;
  const orgs = F.col('Organization').filter(o => o.type === '临床科室'); // 与统计监督模块中出现的科室保持一致
  const st = { type: 'all', status: 'all', showAll: false };

  // 生效范围解析：'全院' 或 '心内科、骨科' 形式的多科室字符串
  const scopeSet = (scope) => (!scope || scope === '全院') ? 'ALL' : new Set(String(scope).split(/[、,，]/).map(s => s.trim()).filter(Boolean));
  const scopesOverlap = (a, b) => { if (a === 'ALL' || b === 'ALL') return true; for (const x of a) if (b.has(x)) return true; return false; };

  const el = U.h(`<div class="page"></div>`);
  function render() {
    let rules = F.col('ActivityDefinition').slice();
    if (st.type !== 'all') rules = rules.filter(r => r.docType === st.type);
    if (st.status !== 'all') rules = rules.filter(r => st.status === 'on' ? r.active : !r.active);
    const audits = F.col('AuditEvent').filter(a => a.area === '时限配置').sort((a, b) => new Date(b.at) - new Date(a.at));
    const showAudits = st.showAll ? audits : audits.slice(0, 4);

    el.innerHTML = `
      ${App.crumb('time-config')}
      <div class="page-head"><h1 class="page-title">书写时限配置</h1><div class="desc">配置各类病历文书的书写时限规则，保存后实时生效于时限监控逻辑</div></div>
      <div class="flex" style="margin-bottom:14px"><button class="btn pri" id="add">+ 新增规则</button><button class="btn" id="imp">批量导入</button></div>
      <div class="filters">
        <div class="fld"><label>文书类型</label><select id="ft"><option value="all">全部</option>${F.DOC_TYPES.map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
        <div class="fld"><label>生效状态</label><select id="fs"><option value="all">全部</option><option value="on">已生效</option><option value="off">已停用</option></select></div>
      </div>
      <div class="card"><div class="card-h"><h3>时限规则列表</h3></div>
        <div class="card-b" style="padding:0"><table>
          <thead><tr><th>序号</th><th>文书类型</th><th>时限要求</th><th>起算点</th><th>生效范围</th><th>生效状态</th><th>最近修改时间</th><th>操作</th></tr></thead>
          <tbody id="tb"></tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>配置变更记录</h3></div>
        <div class="card-b" style="padding:0"><table><thead><tr><th>操作时间</th><th>操作人</th><th>操作类型</th><th>变更内容</th></tr></thead>
        <tbody>${showAudits.map(a => `<tr><td>${F.mdhm(a.at)}</td><td>${esc(a.by)}</td><td><span class="tag-soft">${esc(a.op)}</span></td><td>${esc(a.content)}</td></tr>`).join('')}</tbody></table>
        <div style="padding:10px 16px"><button class="linkbtn" id="toggleAudit">${st.showAll ? '收起 ▲' : '展开全部变更记录 ▾'}</button></div></div></div>`;
    el.querySelector('#ft').value = st.type; el.querySelector('#fs').value = st.status;
    el.querySelector('#ft').onchange = e => { st.type = e.target.value; render(); };
    el.querySelector('#fs').onchange = e => { st.status = e.target.value; render(); };
    el.querySelector('#toggleAudit').onclick = () => { st.showAll = !st.showAll; render(); };
    el.querySelector('#add').onclick = () => openForm(null);
    el.querySelector('#imp').onclick = () => U.toast('批量导入（演示）：请按模板上传，系统将校验文书类型是否已存在配置', 'info', 3200);

    const tb = el.querySelector('#tb');
    rules.forEach((r, i) => {
      const tr = U.h(`<tr><td>${i + 1}</td><td>${esc(r.docType)}</td><td>${r.hours}小时</td><td>${esc(r.anchor)}</td><td>${esc(r.scope)}</td>
        <td>${r.active ? '<span class="pill green"><span class="dot green"></span>已生效</span>' : '<span class="pill gray"><span class="dot gray"></span>已停用</span>'}</td>
        <td>${F.mdhm(r.modifiedAt)}</td><td><button class="linkbtn" data-act="edit">编辑</button><button class="linkbtn" data-act="del">删除</button></td></tr>`);
      tr.querySelector('[data-act="edit"]').onclick = () => openForm(r);
      tr.querySelector('[data-act="del"]').onclick = async () => {
        if (await U.confirm(`确定删除「${r.docType}」时限规则？删除后该文书类型的时限监控将暂停。`, { title: '删除时限规则', danger: true, okText: '删除' })) {
          const idx = F.col('ActivityDefinition').indexOf(r); F.col('ActivityDefinition').splice(idx, 1);
          F.col('AuditEvent').push({ resourceType: 'AuditEvent', id: F.uid('aud'), area: '时限配置', at: F.NOW().toISOString(), by: user.name, op: '删除', content: `删除「${r.docType}」时限规则` });
          F.save(); U.toast('已删除', 'ok'); render();
        }
      };
      tb.appendChild(tr);
    });
  }

  function scopeMultiHtml(rule) {
    const picked = rule ? scopeSet(rule.scope) : 'ALL';
    const isAll = picked === 'ALL';
    return `<div class="scope-multi" id="scopeBox">
      <label><input type="checkbox" id="scAll" ${isAll ? 'checked' : ''}> 全院</label>
      ${orgs.map(o => `<label><input type="checkbox" class="scOrg" value="${esc(o.name)}" ${(!isAll && picked.has(o.name)) ? 'checked' : ''} ${isAll ? 'disabled' : ''}> ${esc(o.name)}</label>`).join('')}
    </div>`;
  }
  function bindScopeMulti(body) {
    const all = body.querySelector('#scAll'), orgBoxes = body.querySelectorAll('.scOrg');
    all.onchange = () => { orgBoxes.forEach(b => { b.disabled = all.checked; if (all.checked) b.checked = false; }); };
    orgBoxes.forEach(b => b.onchange = () => { if (b.checked) all.checked = false; });
  }
  function readScope(body) {
    const all = body.querySelector('#scAll');
    if (all.checked) return '全院';
    const picked = Array.from(body.querySelectorAll('.scOrg:checked')).map(b => b.value);
    return picked.join('、');
  }

  function openForm(rule) {
    const editing = !!rule;
    const body = U.h(`<div>
      <div class="fld" style="margin-bottom:14px"><label>文书类型 *</label>
        <select id="ft">${F.DOC_TYPES.map(t => `<option ${rule && rule.docType === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <div class="wrap-note">文书类型读取自EMR系统的文书目录</div></div>
      <div class="fld" style="margin-bottom:14px"><label>时限要求 *（小时）</label><input id="fh" type="number" value="${rule ? rule.hours : 24}"></div>
      <div class="fld" style="margin-bottom:14px"><label>时限起算点</label><select id="fa">
        ${['创建时间', '入院时间', '手术前', '手术完成', '出院前'].map(a => `<option ${rule && rule.anchor === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
        <div class="wrap-note">如：术后24小时 → 起算点选"手术完成"</div></div>
      <div class="fld" style="margin-bottom:14px"><label>生效范围 *（科室可多选）</label>${scopeMultiHtml(rule)}</div>
      <div class="checkline"><span>状态：</span><div class="switch ${(!rule || rule.active) ? 'on' : ''}" id="sw"></div><span id="swl">${(!rule || rule.active) ? '启用' : '停用'}</span></div>
    </div>`);
    bindScopeMulti(body);
    let active = !rule || rule.active;
    body.querySelector('#sw').onclick = (e) => { active = !active; e.target.classList.toggle('on', active); body.querySelector('#swl').textContent = active ? '启用' : '停用'; };
    const m = U.modal({ title: editing ? '编辑时限规则' : '新增时限规则', width: 'w560', body,
      footer: `<button class="btn cancel">取消</button><button class="btn pri save">保存</button>` });
    m.el.querySelector('.cancel').onclick = m.close;
    m.el.querySelector('.save').onclick = async () => {
      const docType = body.querySelector('#ft').value, hours = +body.querySelector('#fh').value, anchor = body.querySelector('#fa').value;
      const scope = readScope(body);
      if (!scope) { U.toast('请至少选择一个生效范围（全院或具体科室）', 'warn'); return; }
      // 同一文书类型 + 生效范围存在重叠的规则时，提示会覆盖原设置
      const newSet = scopeSet(scope);
      const conflict = F.col('ActivityDefinition').find(r => r !== rule && r.docType === docType && scopesOverlap(scopeSet(r.scope), newSet));
      if (conflict && !(await U.confirm(`该文书类型与生效范围存在重叠的规则「${conflict.docType} · ${conflict.scope}」，本次保存后新设置将覆盖原规则对相应科室的时限要求，是否继续？`, { title: '生效范围重叠', okText: '继续保存' }))) return;
      if (rule) { Object.assign(rule, { docType, hours, anchor, scope, active, modifiedAt: F.NOW().toISOString() });
        F.col('AuditEvent').push({ resourceType: 'AuditEvent', id: F.uid('aud'), area: '时限配置', at: F.NOW().toISOString(), by: user.name, op: '修改', content: `修改「${docType}」时限：${hours}小时，生效范围：${scope}` });
      } else { F.col('ActivityDefinition').push({ resourceType: 'ActivityDefinition', id: F.uid('tr'), docType, hours, anchor, scope, active, modifiedAt: F.NOW().toISOString(), by: user.name });
        F.col('AuditEvent').push({ resourceType: 'AuditEvent', id: F.uid('aud'), area: '时限配置', at: F.NOW().toISOString(), by: user.name, op: '新增', content: `新增「${docType}」时限：${hours}小时，生效范围：${scope}` });
      }
      F.save(); m.close(); U.toast('已保存，配置实时生效于时限监控', 'ok'); render();
    };
  }
  render();
  // 首页待办事项点击进入：直接定位打开该条待复核的时限规则编辑表单
  if (params.ruleId) {
    const rule = F.col('ActivityDefinition').find(r => r.id === params.ruleId);
    if (rule) openForm(rule);
  }
  return el;
});
