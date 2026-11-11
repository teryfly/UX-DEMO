/* ============== L3-3-2 质控规则配置（质量管理部门） ============== */
App.registerPage('qc-config', (user, params, ctx) => {
  const F = window.FHIR, U = window.UI, B = window.Biz;
  const esc = U.esc;
  const st = { tab: 'rules', node: 'all', status: 'all', showVer: false };
  const NODES = ['入院记录完成时', '首次病程完成时', '术前讨论完成时', '手术记录完成时', '出院记录完成时', '提交归档时'];
  const orgs = F.col('Organization').filter(o => o.type === '临床科室'); // 与统计监督模块中出现的科室保持一致
  const CONDITION_NAMES = ['必填项校验', '时限校验', '签字校验'];
  const scopeSet = (scope) => (!scope || scope === '全院') ? 'ALL' : new Set(String(scope).split(/[、,，]/).map(s => s.trim()).filter(Boolean));

  const el = U.h(`<div class="page"></div>`);
  function render() {
    el.innerHTML = `
      ${App.crumb('qc-config')}
      <div class="page-head"><h1 class="page-title">质控规则配置</h1><div class="desc">配置病历书写关键节点的质控检查规则与各类通知模板，保存后实时生效</div></div>
      <div class="tabs"><div class="tab ${st.tab === 'rules' ? 'on' : ''}" data-t="rules">质控规则</div><div class="tab ${st.tab === 'notify' ? 'on' : ''}" data-t="notify">通知设置</div></div>
      <div id="tabbody"></div>`;
    el.querySelectorAll('.tab').forEach(t => t.onclick = () => { st.tab = t.dataset.t; render(); });
    st.tab === 'rules' ? renderRules() : renderNotify();
  }

  function renderRules() {
    let rules = F.col('PlanDefinition').slice();
    if (st.node !== 'all') rules = rules.filter(r => r.node === st.node);
    if (st.status !== 'all') rules = rules.filter(r => st.status === 'on' ? r.status : !r.status);
    const vers = F.col('qcVersions').sort((a, b) => new Date(b.at) - new Date(a.at));
    const showVers = st.showVer ? vers : vers.slice(0, 3);
    el.querySelector('#tabbody').innerHTML = `
      <div class="flex" style="margin-bottom:14px"><button class="btn pri" id="add">+ 新增规则</button><button class="btn" id="imp">批量导入</button></div>
      <div class="filters">
        <div class="fld"><label>检查节点</label><select id="fn"><option value="all">全部</option>${NODES.map(n => `<option>${esc(n)}</option>`).join('')}</select></div>
        <div class="fld"><label>状态</label><select id="fs"><option value="all">全部</option><option value="on">启用</option><option value="off">停用</option></select></div>
      </div>
      <div class="card"><div class="card-h"><h3>质控规则列表</h3><span class="p">P1</span></div>
        <div class="card-b" style="padding:0"><table><thead><tr><th>序号</th><th>规则名称</th><th>检查节点</th><th>规则条件</th><th>生效范围</th><th>状态</th><th>版本号</th><th>操作</th></tr></thead>
        <tbody id="rtb"></tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>规则版本追溯</h3><span class="p">P3</span></div>
        <div class="card-b" style="padding:0"><table><thead><tr><th>修改时间</th><th>版本号</th><th>操作人</th><th>操作类型</th><th>变更内容</th><th>操作</th></tr></thead>
        <tbody>${showVers.map(v => `<tr><td>${F.mdhm(v.at)}</td><td>${esc(v.version)}</td><td>${esc(v.by)}</td><td><span class="tag-soft">${esc(v.op)}</span></td><td>${esc(v.content)}</td>
          <td><button class="linkbtn" data-rb="${v.id}">回滚</button></td></tr>`).join('')}</tbody></table>
        <div style="padding:10px 16px"><button class="linkbtn" id="toggleVer">${st.showVer ? '收起 ▲' : '展开全部版本记录 ▾'}</button></div></div></div>`;
    const tbody = el.querySelector('#tabbody');
    tbody.querySelector('#fn').value = st.node; tbody.querySelector('#fs').value = st.status;
    tbody.querySelector('#fn').onchange = e => { st.node = e.target.value; render(); };
    tbody.querySelector('#fs').onchange = e => { st.status = e.target.value; render(); };
    tbody.querySelector('#add').onclick = () => openForm(null);
    tbody.querySelector('#imp').onclick = () => U.toast('批量导入规则（演示）', 'info');
    tbody.querySelector('#toggleVer').onclick = () => { st.showVer = !st.showVer; render(); };
    tbody.querySelectorAll('[data-rb]').forEach(b => b.onclick = async () => {
      const v = vers.find(x => x.id === b.dataset.rb);
      if (await U.confirm(`确定将规则回滚至 ${v.version}？还原后将生成一条新的版本记录。`, { title: '版本回滚', okText: '回滚' })) {
        F.col('qcVersions').push({ id: F.uid('ver'), version: 'v' + (Math.random() * 0 + (parseFloat((v.version || 'v1.0').slice(1)) + 0.1).toFixed(1)), ruleId: v.ruleId, by: user.name, op: '回滚', content: `回滚至${v.version}（内容与${v.version}一致）`, at: F.NOW().toISOString() });
        F.save(); U.toast(`已回滚至 ${v.version} 并生成新版本`, 'ok'); render();
      }
    });
    const rtb = el.querySelector('#rtb');
    rules.forEach((r, i) => {
      // 已停用的规则不再实际生效，"模拟校验"按钮相应取消（禁用）
      const tr = U.h(`<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.node)}</td><td>${esc(r.cond)}</td><td>${esc(r.scope)}</td>
        <td>${r.status ? '<span class="pill green"><span class="dot green"></span>启用</span>' : '<span class="pill gray"><span class="dot gray"></span>停用</span>'}</td><td>${esc(r.version)}</td>
        <td><div class="flex" style="gap:2px"><button class="linkbtn" data-act="edit">编辑</button><button class="linkbtn" data-act="del">删除</button><button class="linkbtn ${r.status ? '' : 'dis'}" data-act="sim" ${r.status ? '' : 'disabled title="规则已停用，无法模拟校验"'}>模拟校验</button></div></td></tr>`);
      tr.querySelector('[data-act="edit"]').onclick = () => openForm(r);
      if (r.status) tr.querySelector('[data-act="sim"]').onclick = () => openSim(r);
      tr.querySelector('[data-act="del"]').onclick = async () => {
        if (await U.confirm(`确定删除规则「${r.name}」？`, { title: '删除质控规则', danger: true, okText: '删除' })) {
          F.col('PlanDefinition').splice(F.col('PlanDefinition').indexOf(r), 1); F.save(); U.toast('已删除', 'ok'); render();
        }
      };
      rtb.appendChild(tr);
    });
  }

  function scopeMultiHtml(rule) {
    const picked = rule ? scopeSet(rule.scope) : 'ALL';
    const isAll = picked === 'ALL';
    return `<div class="scope-multi" id="rScopeBox">
      <label><input type="checkbox" id="rScAll" ${isAll ? 'checked' : ''}> 全院</label>
      ${orgs.map(o => `<label><input type="checkbox" class="rScOrg" value="${esc(o.name)}" ${(!isAll && picked.has(o.name)) ? 'checked' : ''} ${isAll ? 'disabled' : ''}> ${esc(o.name)}</label>`).join('')}
    </div>`;
  }
  function bindScopeMulti(body) {
    const all = body.querySelector('#rScAll'), orgBoxes = body.querySelectorAll('.rScOrg');
    all.onchange = () => { orgBoxes.forEach(b => { b.disabled = all.checked; if (all.checked) b.checked = false; }); };
    orgBoxes.forEach(b => b.onchange = () => { if (b.checked) all.checked = false; });
  }
  function readScope(body) {
    if (body.querySelector('#rScAll').checked) return '全院';
    return Array.from(body.querySelectorAll('.rScOrg:checked')).map(b => b.value).join('、');
  }

  // 规则条件：支持一次性配置多条（条件名称 + 条件说明），新增/删除
  function conditionsHtml(conditions) {
    return conditions.map((c, i) => `<div class="cond-row" data-i="${i}">
      <select class="cname">${CONDITION_NAMES.map(n => `<option ${c.name === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <input class="cdesc" value="${esc(c.desc)}" placeholder="条件说明，如：主诉不得为空">
      <button type="button" class="linkbtn cdel" ${conditions.length <= 1 ? 'disabled' : ''}>删除</button>
    </div>`).join('');
  }
  function bindConditions(body, conditions, condBox) {
    condBox.innerHTML = conditionsHtml(conditions);
    condBox.querySelectorAll('.cname').forEach((s, i) => s.onchange = () => { conditions[i].name = s.value; });
    condBox.querySelectorAll('.cdesc').forEach((s, i) => s.oninput = () => { conditions[i].desc = s.value; });
    condBox.querySelectorAll('.cdel').forEach((b, i) => b.onclick = () => { conditions.splice(i, 1); bindConditions(body, conditions, condBox); });
  }

  function openForm(rule) {
    const conditions = rule && rule.conditions && rule.conditions.length ? JSON.parse(JSON.stringify(rule.conditions)) : [{ name: '必填项校验', desc: rule ? rule.desc : '' }];
    const body = U.h(`<div>
      <div class="fld" style="margin-bottom:14px"><label>规则名称 *</label><input id="rn" value="${rule ? esc(rule.name) : ''}" placeholder="如：入院记录必填项校验"></div>
      <div class="fld" style="margin-bottom:14px"><label>检查节点 *</label><select id="rnode">${NODES.map(n => `<option ${rule && rule.node === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      <div class="sec-title">规则条件 *（支持一次性配置多条）</div>
      <div style="border:1px solid var(--c-line);border-radius:9px;padding:12px;margin-bottom:14px">
        <div id="condBox"></div>
        <button type="button" class="linkbtn" id="condAdd">+ 新增条件</button>
        <div class="checkline" style="margin-top:10px;border-top:1px solid var(--c-line);padding-top:10px">满足条件：<label><input type="radio" name="logic" checked> 任一</label><label><input type="radio" name="logic"> 全部</label></div>
      </div>
      <div class="fld" style="margin-bottom:14px"><label>生效范围 *（科室可多选）</label>${scopeMultiHtml(rule)}</div>
      <div class="checkline"><span>状态：</span><div class="switch ${(!rule || rule.status) ? 'on' : ''}" id="sw"></div><span id="swl">${(!rule || rule.status) ? '启用' : '停用'}</span></div>
    </div>`);
    bindScopeMulti(body);
    const condBox = body.querySelector('#condBox');
    bindConditions(body, conditions, condBox);
    body.querySelector('#condAdd').onclick = () => { conditions.push({ name: '必填项校验', desc: '' }); bindConditions(body, conditions, condBox); };
    let status = !rule || rule.status;
    const simBtn = () => body.querySelector('.sim');
    const syncSim = () => { const b = simBtn(); if (b) b.disabled = !status; };
    body.querySelector('#sw').onclick = (e) => { status = !status; e.target.classList.toggle('on', status); body.querySelector('#swl').textContent = status ? '启用' : '停用'; syncSim(); };
    const m = U.modal({ title: rule ? '编辑质控规则' : '新增质控规则', width: 'w560', body,
      footer: `<button class="btn cancel">取消</button><button class="btn sim" ${status ? '' : 'disabled'}>模拟校验</button><button class="btn pri save">保存</button>` });
    m.el.querySelector('.cancel').onclick = m.close;
    m.el.querySelector('.sim').onclick = () => { if (!status) return; openSim(rule || { name: body.querySelector('#rn').value || '新规则', cond: conditions.map(c => c.name).join('+') }); };
    m.el.querySelector('.save').onclick = () => {
      const name = body.querySelector('#rn').value.trim(), node = body.querySelector('#rnode').value;
      const scope = readScope(body);
      if (!name) { U.toast('请填写规则名称', 'warn'); return; }
      if (!scope) { U.toast('请至少选择一个生效范围（全院或具体科室）', 'warn'); return; }
      const cond = conditions.map(c => c.name).join('+') || '必填项校验';
      const desc = conditions.map(c => c.desc).filter(Boolean).join('；');
      if (rule) { Object.assign(rule, { name, node, cond, desc, conditions, scope, status, modifiedAt: F.NOW().toISOString(), version: 'v' + (parseFloat(rule.version.slice(1)) + 0.1).toFixed(1) });
        F.col('qcVersions').push({ id: F.uid('ver'), version: rule.version, ruleId: rule.id, by: user.name, op: '修改', content: `修改规则「${name}」`, at: F.NOW().toISOString() });
      } else { const r = { resourceType: 'PlanDefinition', id: F.uid('qr'), name, node, cond, desc, conditions, status, version: 'v1.0', scope, modifiedAt: F.NOW().toISOString(), by: user.name };
        F.col('PlanDefinition').push(r); F.col('qcVersions').push({ id: F.uid('ver'), version: 'v1.0', ruleId: r.id, by: user.name, op: '新增', content: `新增规则「${name}」`, at: F.NOW().toISOString() });
      }
      F.save(); m.close(); U.toast('已保存，质控规则实时生效', 'ok'); render();
    };
  }

  function openSim(rule) {
    // 按住院号/门诊号精确搜索：同一患者可能多次就诊，若按姓名搜索、同类文书会产生多份记录，
    // 无法精确定位到某一次就诊，故此处改为按住院号/门诊号搜索
    const body = U.h(`<div>
      <div class="banner info">当前规则：${esc(rule.name)}</div>
      <div class="flex" style="margin-bottom:12px"><input id="sp" placeholder="住院号/门诊号" style="height:34px;border:1px solid var(--c-line);border-radius:8px;padding:0 10px">
        <button class="btn pri" id="srun">搜索并模拟</button></div>
      <div id="sres"></div></div>`);
    const m = U.modal({ title: '规则模拟校验', width: 'w560', body, footer: `<button class="btn pri close">关闭</button>` });
    m.el.querySelector('.close').onclick = m.close;
    body.querySelector('#srun').onclick = () => {
      const kw = body.querySelector('#sp').value.trim() || 'ZY2026061901';
      const enc = F.col('Encounter').find(e => e.mrn === kw) || F.col('Encounter').find(e => (e.mrn || '').includes(kw));
      if (!enc) { body.querySelector('#sres').innerHTML = `<div class="empty-box">未找到住院号/门诊号为「${esc(kw)}」的患者</div>`; return; }
      const issues = B.runQC(enc);
      const pass = issues.length === 0;
      body.querySelector('#sres').innerHTML = `<div class="sec-title">模拟结果（只读，不产生实际任务/通知）</div>
        <div style="border:1px solid var(--c-line);border-radius:9px;padding:12px;font-size:13px">
          <div><b>患者${esc(enc.patientName)}（${esc(enc.mrn)}）</b></div>
          ${issues.length ? issues.map(i => `<div style="margin-top:6px">规则条件：${esc(i.location)} → <span style="color:var(--c-red)">${esc(i.desc)}</span></div>`).join('') : '<div style="margin-top:6px;color:var(--c-green)">所有必填项与时限校验通过</div>'}
          <hr style="border:none;border-top:1px dashed var(--c-line);margin:10px 0">
          <div>校验结果：<b style="color:${pass ? 'var(--c-green)' : 'var(--c-red)'}">${pass ? '通过 ✓' : '不通过 ✓'}</b></div>
          <div>触发动作：${pass ? '无' : '下发整改任务'}</div>
        </div>`;
    };
  }

  // ---------- Tab2 通知设置 ----------
  function renderNotify() {
    const cfg = F.db().notifyCfg;
    const chk = (v) => v ? '☑' : '☐';
    el.querySelector('#tabbody').innerHTML = `
      ${notifyCard('超时预警通知', '向临床医生推送病历书写超时预警', 'overdueWarn', `
        <div class="checkline">预警时机：超时前 <input type="number" id="lead" value="${cfg.overdueWarn.leadHours}" style="width:60px;height:30px;border:1px solid var(--c-line);border-radius:6px;text-align:center"> 小时推送</div>
        <div class="checkline">通知方式：<label>${chk(cfg.overdueWarn.channels.sys)} 系统消息</label> <label>${chk(cfg.overdueWarn.channels.sms)} 短信</label> <label>${chk(cfg.overdueWarn.channels.mail)} 邮件</label></div>
        <div class="checkline">${chk(cfg.overdueWarn.repeatDaily)} 每日提醒（直至超时或完成）</div>`, cfg.overdueWarn.tpl, '{患者姓名} {文书类型} {剩余时间} {截止时间}')}
      ${notifyCard('催办通知', '整改任务超时未完成时，自动向责任医生发送催办通知', 'urge', `
        <div class="checkline">触发条件：整改截止后 <input type="number" value="${cfg.urge.afterDays}" style="width:50px;height:30px;border:1px solid var(--c-line);border-radius:6px;text-align:center"> 天自动发送</div>
        <div class="checkline">通知方式：<label>${chk(cfg.urge.channels.sys)} 系统消息</label> <label>${chk(cfg.urge.channels.sms)} 短信</label> <label>${chk(cfg.urge.channels.mail)} 邮件</label></div>
        <div class="checkline">重复频率：每 <input type="number" value="${cfg.urge.repeatDays}" style="width:50px;height:30px;border:1px solid var(--c-line);border-radius:6px;text-align:center"> 天重复，${chk(cfg.urge.ccDeptHead)} 抄送科室负责人</div>`, cfg.urge.tpl, '{患者姓名} {任务编号} {超时天数} {整改要求}')}
      ${notifyCard('终末质控拦截通知', '终末质控发现严重问题时，自动拦截归档并通知责任医生', 'intercept', `
        <div class="checkline">通知方式：<label>${chk(cfg.intercept.channels.sys)} 系统消息</label> <label>${chk(cfg.intercept.channels.sms)} 短信</label> <label>${chk(cfg.intercept.channels.mail)} 邮件</label></div>
        <div class="checkline">通知对象：<label>${chk(cfg.intercept.toDoctor)} 责任医生</label> <label>${chk(cfg.intercept.toDeptHead)} 科室负责人</label></div>`, cfg.intercept.tpl, '{患者姓名} {拦截原因} {文书类型} {质控结果}')}
      <div style="text-align:right;margin-top:6px"><button class="btn pri" id="saveNotify">保存通知设置</button></div>`;
    el.querySelectorAll('.notify-switch').forEach(sw => sw.onclick = () => { sw.classList.toggle('on'); });
    el.querySelector('#saveNotify').onclick = () => { F.save(); U.toast('通知设置已保存，配置实时生效', 'ok'); };
  }
  function notifyCard(title, sub, key, fields, tpl, vars) {
    const cfg = F.db().notifyCfg[key];
    return `<div class="card"><div class="card-h"><div><h3>${esc(title)}</h3><div class="muted" style="font-size:12px">${esc(sub)}</div></div>
      <div class="right"><div class="switch notify-switch ${cfg.on ? 'on' : ''}"></div></div></div>
      <div class="card-b">${fields}
        <div class="sec-title">通知内容模板</div>
        <textarea style="width:100%;border:1px solid var(--c-line);border-radius:8px;padding:9px;font-family:inherit;font-size:13px;min-height:56px">${esc(tpl)}</textarea>
        <div class="wrap-note">支持变量：${esc(vars)}（发送时自动替换为实际值）</div></div></div>`;
  }

  render();
  return el;
});
