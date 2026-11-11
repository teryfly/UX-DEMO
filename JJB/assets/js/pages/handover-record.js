/* WF-L3-2-2 交接班记录（历史记录查询，只读不可篡改） */
(function () {
  let fStatus = '全部', fStart = '', fEnd = '', fDept = '全部', fPerson = '全部';
  const SRC_COLOR = { '医嘱': 'blue', '会诊': 'purple', '危急值': 'red' };

  function docName(id) { const p = FHIR.read('Practitioner', id, { silent: true }); return p ? p.name[0].text : id; }
  function docQual(id) { const p = FHIR.read('Practitioner', id, { silent: true }); return p && p.qualification && p.qualification[0] ? p.qualification[0].code.text : '医师'; }
  function names(ids) { return (ids || []).map(docName).join('、') || '—'; }
  function orgName(id) { const o = id ? FHIR.read('Organization', id, { silent: true }) : null; return o ? o.name : '心血管内科'; }

  window.PAGES['#/handover-record'] = function (view) {
    const role = AUTH.currentRole();
    const user = AUTH.currentUser();

    let recs = FHIR.search('Composition', c => c.status === 'final' && c.type.text === '值班交接班记录',
      { status: 'final' });
    // 权限：医生仅看本人参与；负责人看本科室；管理部门看全院
    if (role === '值班医生' || role === '接班医生') {
      recs = recs.filter(c => (c._givers || []).includes(user.id) || (c._receivers || []).includes(user.id));
    }
    // 状态字段统一
    recs.forEach(c => { c.__st = c._status2 || c._status || '正常'; });
    recs.sort((a, b) => new Date(b._finishTime || b.date) - new Date(a._finishTime || a.date));

    const orgs = FHIR.search('Organization', o => o.active, null, { silent: true });
    const peopleIds = [...new Set(recs.flatMap(c => [...(c._givers || []), ...(c._receivers || [])]))];

    const list = recs.filter(c => {
      if (fStatus !== '全部' && c.__st !== fStatus) return false;
      if (fStart && c._date < fStart) return false;
      if (fEnd && c._date > fEnd) return false;
      if (fDept !== '全部' && orgName(c._org) !== fDept) return false;
      if (fPerson !== '全部' && !(c._givers || []).includes(fPerson) && !(c._receivers || []).includes(fPerson)) return false;
      return true;
    });

    view.innerHTML = `
      <div class="page-head">
        <div><h2>交接班记录</h2>
          <div class="desc">展示历史交接记录，支持按交接时间、科室、人员、状态筛选；记录保存后不可篡改。${role === '值班医生' || role === '接班医生' ? '（当前仅展示本人参与的记录）' : ''}</div>
        </div>
      </div>

      <div class="card">
        <div class="toolbar" style="flex-wrap:wrap">
          <label class="muted-text" style="font-size:12px">交接时间</label>
          <input class="input" type="date" id="fStart" style="width:150px" value="${fStart}">
          <span class="muted-text">~</span>
          <input class="input" type="date" id="fEnd" style="width:150px" value="${fEnd}">
          <select class="select" id="fDept" style="width:130px">
            <option ${fDept === '全部' ? 'selected' : ''}>全部</option>
            ${orgs.map(o => `<option ${fDept === o.name ? 'selected' : ''}>${o.name}</option>`).join('')}
          </select>
          <select class="select" id="fPerson" style="width:120px">
            <option value="全部">全部人员</option>
            ${peopleIds.map(id => `<option value="${id}" ${fPerson === id ? 'selected' : ''}>${docName(id)}</option>`).join('')}
          </select>
          <select class="select" id="st" style="width:110px">
            ${['全部', '正常', '超时'].map(s => `<option ${s === fStatus ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <button class="btn primary" id="query">查询</button>
          <button class="btn" id="reset">重置</button>
          <span class="spacer"></span>
          <span class="muted-text">共 ${list.length} 条</span>
        </div>
        ${list.length ? `
        <table class="tbl">
          <thead><tr><th>交接时间</th><th>班次</th><th>交出方</th><th>接收方</th><th>科室</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>${list.map(rowOf).join('')}</tbody>
        </table>` : `<div class="empty-state"><span class="ic">📭</span>${fStatus !== '全部' || fStart || fEnd || fDept !== '全部' || fPerson !== '全部' ? '未找到符合条件的交接记录' : '暂无交接记录'}</div>`}
      </div>`;

    const doQuery = () => {
      fStatus = U.$('#st', view).value;
      fStart = U.$('#fStart', view).value;
      fEnd = U.$('#fEnd', view).value;
      fDept = U.$('#fDept', view).value;
      fPerson = U.$('#fPerson', view).value;
      Router.render();
    };
    U.$('#query', view).addEventListener('click', doQuery);
    U.$('#reset', view).addEventListener('click', () => { fStatus = '全部'; fStart = ''; fEnd = ''; fDept = '全部'; fPerson = '全部'; Router.render(); });
    U.delegate(view, 'click', '[data-detail]', (e, t) => openDetail(recs.find(c => c.id === t.dataset.detail)));
  };

  function rowOf(c) {
    const timeout = c.__st === '超时';
    return `<tr class="${timeout ? 'warn-row' : ''}">
      <td>${U.fmtTime(c._finishTime || c.date)}</td>
      <td>${c._shift}</td>
      <td>${names(c._givers)}</td>
      <td>${names(c._receivers)}</td>
      <td>${orgName(c._org)}</td>
      <td>${timeout ? U.tag('⏱ 超时', 'orange') : U.tag('✅ 正常', 'green')}</td>
      <td><button class="btn-link" data-detail="${c.id}">查看详情</button></td>
    </tr>`;
  }

  function openDetail(c) {
    if (!c) return;
    const prov = FHIR.read('Provenance', 'prov-' + c.id, { silent: true });
    const timeout = (c._status2 || c._status) === '超时';
    // 患者清单 / 待办事项均按交接当时留存的快照（_patientSnapshot/_todoSnapshot）展示，
    // 不因记录已归档、患者后续出院或待办后续办结而丢失——交接记录详情应始终还原交接当时的真实内容。
    const pats = c._patientSnapshot || [];
    const todos = c._todoSnapshot || [];
    const body = U.el('div');
    body.innerHTML = `
      <div class="card flat">
        <div class="card-title" style="font-size:14px">交接基本信息 ${timeout ? U.tag('⏱ 超时', 'orange') : U.tag('✅ 正常', 'green')}</div>
        <div class="grid-2" style="gap:8px">
          <div><span class="muted-text">班次：</span>${c._date} · ${c._shift}</div>
          <div><span class="muted-text">完成时间：</span>${U.fmtTime(c._finishTime || c.date)}</div>
          <div><span class="muted-text">交出方：</span>${(c._givers || []).map(id => `${docName(id)}·${docQual(id)}`).join('、') || '—'}</div>
          <div><span class="muted-text">接收方：</span>${(c._receivers || []).map(id => `${docName(id)}·${docQual(id)}`).join('、') || '—'}</div>
          <div><span class="muted-text">科室：</span>${orgName(c._org)}</div>
        </div>
      </div>
      <div class="card flat">
        <div class="card-title" style="font-size:14px">交接补充信息（交班医生）</div>
        <div>${c._supplement ? U.esc(c._supplement) : '<span class="muted-text">—</span>'}</div>
        <div class="sep"></div>
        <div class="card-title" style="font-size:14px">接班确认说明（接班医生）</div>
        <div>${c._receiverNote ? U.esc(c._receiverNote) : '<span class="muted-text">—</span>'}</div>
      </div>
      <div class="card flat">
        <div class="card-title" style="font-size:14px">患者清单（${pats.length}） <span class="sub">交接当时留存</span></div>
        ${pats.length ? `<table class="tbl"><thead><tr><th>床号</th><th>姓名</th><th>诊断</th><th>等级</th><th>重点标记</th></tr></thead>
        <tbody>${pats.map(x => `<tr>
          <td>${x.bed}</td><td>${x.name}</td><td>${x.dx || '—'}</td>
          <td>${U.severityTag(x.severity)}</td>
          <td>${(x.flags || []).map(f => U.tag(f, 'red')).join(' ') || '—'}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty-state" style="padding:16px"><span class="ic">🛏️</span>交接当时无在院患者记录</div>`}
      </div>
      <div class="card flat">
        <div class="card-title" style="font-size:14px">待办事项汇总清单（未完成） <span class="sub">交接当时留存 · 共 ${todos.length} 项</span></div>
        ${todos.length ? `<table class="tbl"><thead><tr><th>床号</th><th>患者姓名</th><th>类型</th><th>内容摘要</th><th>紧急程度</th><th>来源系统</th></tr></thead>
            <tbody>${todos.map(t => `<tr>
              <td>${t.bed}</td><td>${t.name}</td>
              <td>${U.tag(t.source, SRC_COLOR[t.source] || 'default')}</td>
              <td>${U.esc(t.desc)}</td><td>${U.priorityTag(t.priority)}</td><td>${t.source}系统</td>
            </tr>`).join('')}</tbody></table>` : `<div class="empty-state" style="padding:16px"><span class="ic">✅</span>交接当时暂无未完成待办事项</div>`}
      </div>
      <div class="card flat">
        <div class="card-title" style="font-size:14px">签名信息 ${U.tag('🔒 不可篡改', 'default')}</div>
        ${(c.attester || []).map(a => {
      const who = FHIR.resolve(a.party);
      return `<div style="margin-bottom:6px">${a.mode === 'legal' ? '接班' : '交班'}签名：<b>${who ? who.name[0].text : ''}</b>
            · ${U.fmtTime(a.time)} · CA凭证 ${a._ca ? a._ca.serial : '—'}</div>`;
    }).join('')}
        ${prov ? `<div class="muted-text" style="font-size:12px;margin-top:6px">Provenance/${prov.id} · 记录于 ${U.fmtTime(prov.recorded)}</div>` : ''}
      </div>`;
    U.modal({ title: `交接班记录详情 · ${c._date} ${c._shift}`, drawer: true, body });
  }
})();
