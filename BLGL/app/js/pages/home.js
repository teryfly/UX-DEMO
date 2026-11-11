/* ============== L1 病历管理制度闭环管理首页 ============== */
App.registerPage('home', (user, params, ctx) => {
  const F = window.FHIR, U = window.UI, B = window.Biz;
  const esc = U.esc, role = user.role;
  const stats = B.homeStats(user);
  const showTodos = role !== 'qc' && role !== 'admin'; // 医疗质量管理部门 / 管理员角色不展示待办事项模块
  const todos = showTodos ? B.homeTodos(user) : [];
  const notices = F.col('Communication').filter(c => c.to === user.id).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt)).slice(0, 3);
  const groups = U.GROUPS.filter(g => g.pages.some(p => U.canAccess(role, p)));

  // 趋势区（部分角色）
  const showTrend = role === 'clinician' || role === 'deptHead' || role === 'qc';
  const trendLabel = role === 'clinician' ? '近7日文书合规率趋势' : role === 'deptHead' ? '近7日科室书写及时率趋势' : '近7日全院书写及时率趋势';
  const series = B.trendSeries(role, user.org);

  const el = U.h(`<div class="page">
    <div class="page-head">
      <h1 class="page-title">${esc(F.ROLES[role].icon)} ${esc(F.ROLES[role].name)}工作台</h1>
      <div class="desc">欢迎，${esc(user.name)} · ${esc(F.orgName(user.org))} · 最后更新 ${F.fmt(F.NOW())}</div>
    </div>
    <div class="stat-grid">
      ${stats.map((s, i) => `<div class="stat ${s.cls || ''}" data-i="${i}">
        <div class="ic">${s.ic || ''}</div>
        <div class="lab">${esc(s.lab)}</div>
        <div class="val">${esc(s.val)}</div>
        <div class="trend ${s.up ? 'up' : s.trend && s.trend.includes('-') ? 'down' : ''}">${esc(s.trend || '')}</div>
      </div>`).join('')}
    </div>
    <div class="cols c-70-30">
      <div>
        ${showTodos ? `<div class="card"><div class="card-h"><h3>待办事项</h3><div class="right muted" style="font-size:12px">按紧急程度排序</div></div>
          <div class="card-b" style="padding-top:6px">
            ${todos.length ? `<ul class="todo">${todos.map((t, i) => `<li data-todo="${i}"><div class="ic">${t.ic}</div>
              <div style="flex:1"><div class="tt">${esc(t.tt)}</div><div class="sub">${esc(t.sub)}</div></div><span class="muted">›</span></li>`).join('')}</ul>`
              : `<div class="empty-box"><div class="em">🎉</div>暂无待办事项，请继续保持</div>`}
          </div>
        </div>` : ''}
        <div class="card"><div class="card-h"><h3>最新通知</h3></div>
          <div class="card-b" style="padding-top:6px">
            ${notices.length ? `<ul class="notice">${notices.map(n => `<li><div>📢</div><div style="flex:1"><div class="tt">${esc(n.category)} · ${F.mdhm(n.sentAt)}</div><div class="sub">${esc(n.text)}</div></div></li>`).join('')}</ul>`
              : `<div class="empty-box"><div class="em">📭</div>暂无通知</div>`}
          </div>
        </div>
        ${showTrend ? `<div class="card"><div class="card-h"><h3>数据趋势速览</h3><div class="right muted" style="font-size:12px">${esc(trendLabel)}</div></div>
          <div class="card-b">${U.lineChart(series, { label: `当前 ${series[series.length - 1].y}% · 较上周 ▲3%` })}</div></div>` : ''}
      </div>
      <div>
        <div class="card"><div class="card-h"><h3>角色快捷入口</h3></div>
          <div class="card-b" style="padding-top:8px">
            ${groups.map(g => { const ps = g.pages.filter(p => U.canAccess(role, p)); return `<div class="quick-card-block">
              <div class="qi">${g.icon}</div><div><div class="qt">${esc(g.name)}</div><div class="qs">${ps.map((p, i) => `${i > 0 ? '<span class="quick-sep">/</span>' : ''}<span class="quick-link" data-go="${p}">${esc(U.PAGES[p].title)}</span>`).join('')}</div></div></div>`; }).join('')}
          </div>
        </div>
      </div>
    </div>
  </div>`);

  el.querySelectorAll('[data-i]').forEach(c => c.onclick = () => { const g = stats[+c.dataset.i].go; g && ctx.go(g.page, g.params || {}); });
  el.querySelectorAll('[data-todo]').forEach(c => c.onclick = () => { const g = todos[+c.dataset.todo].go; g && ctx.go(g.page, g.params || {}); });
  // 角色快捷入口：点击二级菜单名称直接跳转到对应页面
  el.querySelectorAll('.quick-link').forEach(c => c.onclick = () => ctx.go(c.dataset.go));
  return el;
});
