/* WF-L1 值班交接班制度闭环管理（首页/概览，按角色呈现） */
(function () {
  // 值班医生/接班医生首页“本科室值班表”查询用的周期锚点（保留在模块作用域，
  // 使得切换到其它页面再返回时仍记得上次查询的周次）
  let homeAnchor = '2026-06-15';

  window.PAGES['#/home'] = function (view) {
  const role = AUTH.currentRole();
  const user = AUTH.currentUser();

  // 待处理事项
  const today = '2026-06-20';
  const finalDates = FHIR.search('Composition', c => c.status === 'final', null, { silent: true })
    .map(c => c._date + '|' + c._shift);
  const todaySlots = FHIR.search('Slot', s => s._date === today, null, { silent: true });
  const pendingHandover = todaySlots.filter(s => !finalDates.includes(s._date + '|' + s._shift)).length;
  const timeoutWarn = FHIR.search('Communication',
    c => c._handleStatus === '未处理' && /超时/.test((c.category[0] || {}).text || ''), null, { silent: true }).length;

  // 模块入口（按角色可见）
  const mods = AUTH.visibleModules();
  const quickLinks = [];
  mods.forEach(m => AUTH.visibleChildren(m).forEach(c => quickLinks.push(c)));

  // 质量趋势（演示数据）
  const wk = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const attend = [82, 90, 94, 96, 92, 98, 96];
  const onTime = [80, 88, 91, 94, 89, 93, 89];
  const exc = [3, 2, 1, 2, 0, 1, 2];

  const showKPI = ['科室负责人', '医院管理部门'].includes(role);
  const isDoctor = ['值班医生', '接班医生'].includes(role);
  // “待交接任务”仅与值班/接班医生本人相关；科室负责人/医院管理部门看的是全局
  // 执行监控与质量指标，不应出现这块面向个人的待办卡片。
  const showPendingHandover = isDoctor && pendingHandover;

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h2>欢迎，${user.name} <span class="tag ${U.roleColor(role)} lg">${role}</span></h2>
        <div class="desc">${user.org || ''} · 值班交接班制度闭环管理系统 · 演示当前时间 2026-06-20 08:00（白班）</div>
      </div>
      <div class="btn-group">
        <button class="btn" onclick="App.resetDemo()">↻ 重置演示数据</button>
      </div>
    </div>

    <div class="row" style="align-items:flex-start">
      <div style="flex:1.1;min-width:300px">
        ${(showPendingHandover || timeoutWarn) ? `
        <div class="card">
          <div class="card-title">待处理事项提醒</div>
          <div class="${showPendingHandover && timeoutWarn ? 'grid-2' : 'grid-1'}">
            ${showPendingHandover ? `
            <div class="kpi" style="cursor:pointer" onclick="Router.go('#/handover-list')">
              <div class="label">待交接任务</div>
              <div class="value" style="color:var(--primary)">${pendingHandover} <span style="font-size:14px;color:var(--text-3)">项</span></div>
            </div>` : ''}
            ${timeoutWarn ? `
            <div class="kpi warn" style="cursor:pointer" onclick="Router.go('#/monitor')">
              <div class="label">交接超时预警</div>
              <div class="value">${timeoutWarn} <span style="font-size:14px;color:var(--text-3)">项</span></div>
            </div>` : ''}
          </div>
        </div>` : ''}

        <div class="card">
          <div class="card-title">功能模块入口 <span class="sub">按当前角色权限展示</span></div>
          <div class="btn-group">
            ${quickLinks.map(c => `<button class="btn lg" onclick="Router.go('${c.route}')">${c.title}</button>`).join('')}
            ${quickLinks.length ? '' : '<span class="muted-text">当前角色暂无可进入的业务模块。</span>'}
          </div>
        </div>

        ${isDoctor ? doctorPanel() : ''}
        ${isDoctor ? deptRosterPanel() : ''}
      </div>

      <div style="flex:1;min-width:300px">
        ${showKPI ? `
        <div class="card">
          <div class="card-title">值班质量指标速览 <span class="sub">近 7 日趋势</span></div>
          <div style="margin-bottom:8px"><b>到岗率</b> <span class="tag green">当前 96%</span></div>
          ${U.lineChart(wk.map((k, i) => ({ k, v: attend[i] })), { color: '#52C41A', max: 100, min: 70, w: 380 })}
          <div class="sep"></div>
          <div style="margin-bottom:8px"><b>交接及时率</b> <span class="tag blue">当前 89%</span></div>
          ${U.lineChart(wk.map((k, i) => ({ k, v: onTime[i] })), { color: '#1677FF', max: 100, min: 70, w: 380 })}
          <div class="sep"></div>
          <div style="margin-bottom:8px"><b>异常事件</b> <span class="tag orange">当前 2 件</span></div>
          ${U.lineChart(wk.map((k, i) => ({ k, v: exc[i] })), { color: '#FAAD14', max: 5, min: 0, w: 380 })}
        </div>` : role === '管理员' ? adminPanel() : ''}
      </div>
    </div>`;

  if (isDoctor) {
    const prevBtn = U.$('#homePrevW', view); if (prevBtn) prevBtn.addEventListener('click', () => { homeAnchor = U.fmtDate(U.addDays(new Date(homeAnchor), -7)); Router.render(); });
    const nextBtn = U.$('#homeNextW', view); if (nextBtn) nextBtn.addEventListener('click', () => { homeAnchor = U.fmtDate(U.addDays(new Date(homeAnchor), 7)); Router.render(); });
    const thisBtn = U.$('#homeThisW', view); if (thisBtn) thisBtn.addEventListener('click', () => { homeAnchor = '2026-06-15'; Router.render(); });
  }

  // 管理员首页速览：与「系统管理」实际配置数据同步（US-1.6 AC1/AC2「配置变更即时生效」），
  // 而非固定展示，也不再是与角色无关的“业务流程导览”文案。
  function adminPanel() {
    const activeRules = FHIR.count('Basic', b => b.code.coding[0].code === 'scheduling-rule' && b._status === 'active');
    const now = new Date('2026-06-20T08:00:00');
    const since = U.fmtDate(U.addDays(now, -30));
    const tplUses = FHIR.count('AuditEvent', a => a._action === '套用排班模板' && a.recorded >= since);
    const activeChecklists = FHIR.count('Basic', b => b.code.coding[0].code === 'handover-template' && b._status === 'active');
    const sp = FHIR.read('Basic', 'sysparam', { silent: true });
    const paramCount = sp ? sp._params.length : 0;
    const authUsers = FHIR.count('Practitioner', p => p._account && p._account.username && p._account.status === 'active');
    return `<div class="card">
      <div class="card-title">系统配置概览 <span class="sub">来自系统管理当前配置</span></div>
      <div class="grid-2" style="gap:14px">
        <div class="kpi" style="cursor:pointer" onclick="Router.go('#/rule')"><div class="label">排班规则</div><div class="value" style="font-size:22px">已启用 ${activeRules} 套</div></div>
        <div class="kpi" style="cursor:pointer" onclick="Router.go('#/template')"><div class="label">排班模板</div><div class="value" style="font-size:22px">近30天 使用 ${tplUses} 次</div></div>
        <div class="kpi" style="cursor:pointer" onclick="Router.go('#/sysconfig')"><div class="label">交接班清单配置</div><div class="value" style="font-size:22px">已启用 ${activeChecklists} 套</div></div>
        <div class="kpi" style="cursor:pointer" onclick="Router.go('#/sysconfig')"><div class="label">系统参数配置</div><div class="value" style="font-size:22px">${paramCount} 项</div></div>
        <div class="kpi" style="cursor:pointer" onclick="Router.go('#/userperm')"><div class="label">已授权用户</div><div class="value" style="font-size:22px">${authUsers} 人</div></div>
      </div>
    </div>`;
  }

  function doctorPanel() {
    const pats = FHIR.search('Encounter', e => e.status === 'in-progress', null, { silent: true });
    const flags = FHIR.count('Flag', f => f.status === 'active');
    const todos = FHIR.count('Task', t => t.status === 'in-progress');
    return `<div class="card">
      <div class="card-title">本班在院概览 <span class="sub">数据来源：HIS / EMR</span></div>
      <div class="grid-3">
        <div class="kpi"><div class="label">在院患者</div><div class="value">${pats.length}</div></div>
        <div class="kpi warn"><div class="label">重点患者标记</div><div class="value">${flags}</div></div>
        <div class="kpi error"><div class="label">未完成待办</div><div class="value">${todos}</div></div>
      </div>
    </div>`;
  }

  // 本科室（或按周查询历史）已安排好的值班表——值班/接班医生仅有交接班管理权限，
  // 不能进入“值班排班管理”模块，因此在首页直接展示只读值班表供查询。
  function deptRosterPanel() {
    const orgId = user.orgId || 'org-card';
    const org = FHIR.read('Organization', orgId, { silent: true });
    const rule = FHIR.search('Basic', b => b.code.coding[0].code === 'scheduling-rule' && b._status === 'active' && b._org === orgId, null, { silent: true })[0];
    const shifts = rule ? (rule._shifts || []) : [];
    const wkFull = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const ds = Array.from({ length: 7 }, (_, i) => U.fmtDate(U.addDays(new Date(homeAnchor), i)));
    const slotAt = (date, shift) => FHIR.read('Slot', FHIR.slotId(orgId, date, shift), { silent: true });
    const docName = (id) => { const p = FHIR.read('Practitioner', id, { silent: true }); return p ? p.name[0].text : ''; };
    return `<div class="card">
      <div class="card-title">${org ? org.name : ''}值班表 <span class="sub">查看已安排好的值班排班</span></div>
      <div class="toolbar" style="margin-bottom:10px">
        <button class="btn sm" id="homePrevW">‹ 上一周</button>
        <span class="muted-text">${ds[0]} ~ ${ds[6]}</span>
        <button class="btn sm" id="homeNextW">下一周 ›</button>
        <span class="spacer"></span>
        <button class="btn sm" id="homeThisW">回到本周</button>
      </div>
      ${shifts.length ? `<table class="tbl" style="text-align:center">
        <thead><tr><th>班次</th>${ds.map((dt, i) => `<th>${wkFull[i]}<br><span class="muted-text" style="font-weight:400">${dt.slice(5)}</span></th>`).join('')}</tr></thead>
        <tbody>${shifts.map(sh => `<tr>
          <td><b>${sh.name}</b><br><span class="muted-text" style="font-size:11px">${sh.start}-${sh.end}</span></td>
          ${ds.map(dt => {
      const s = slotAt(dt, sh.name);
      const ids = (s && s._practitioners) || [];
      const mine = ids.includes(user.id);
      return `<td style="${mine ? 'background:#e6f0ff' : ''}">${ids.length ? ids.map(id => `<b>${docName(id)}</b>${id === user.id ? ' <span class="tag blue">我</span>' : ''}`).join('<br>') : '<span class="muted-text">—</span>'}</td>`;
    }).join('')}
        </tr>`).join('')}</tbody></table>` : '<div class="empty-state">该科室暂未配置生效的排班规则</div>'}
    </div>`;
  }
  };
})();
