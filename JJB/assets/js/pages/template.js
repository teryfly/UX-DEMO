/* WF-L3-1-2 排班模板设置 */
(function () {
  const WK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  let expanded = null, kw = '';

  // 按“适用周期”生成排班方案表格的列（不再固定 7 列/一周）
  function periodCols(cyc) {
    if (cyc === '双周') return Array.from({ length: 14 }, (_, i) => `第${Math.floor(i / 7) + 1}周·${WK[i % 7]}`);
    if (cyc === '按月') return Array.from({ length: 30 }, (_, i) => `${i + 1}日`);
    return WK; // 按周
  }
  // 排班方案单元格：既兼容旧数据（单个人员 id 字符串），也支持新的多选（id 数组）
  function cellIds(v) { return Array.isArray(v) ? v : (v ? [v] : []); }
  // 班次名称 → 起止时间（取自模板关联的排班规则），用于在排班方案表头/预览中标注时间段
  function shiftTime(rule, name) {
    const sh = rule && (rule._shifts || []).find(x => x.name === name);
    return sh ? `${sh.start}-${sh.end}` : '';
  }

  function templates() {
    return FHIR.search('Basic', b => b.code.coding[0].code === 'scheduling-template', { code: 'scheduling-template' })
      .filter(t => !kw || t._name.includes(kw));
  }
  function orgDocs(orgId) {
    return FHIR.search('PractitionerRole', r => r.organization && r.organization.reference === 'Organization/' + orgId, null, { silent: true })
      .map(r => FHIR.resolve(r.practitioner)).filter(p => p && (p._account || {}).appRole !== '管理员' && (p._account || {}).appRole !== '医院管理部门');
  }
  function docName(id) { const p = FHIR.read('Practitioner', id, { silent: true }); return p ? p.name[0].text : ''; }
  function ruleName(id) { const r = FHIR.read('Basic', id, { silent: true }); return r ? r._name : '—'; }
  function orgName(id) { const o = id ? FHIR.read('Organization', id, { silent: true }) : null; return o ? o.name : '—'; }

  window.PAGES['#/template'] = function (view) {
    const list = templates();
    view.innerHTML = `
      <div class="page-head"><div><h2>排班模板设置</h2>
        <div class="desc">创建可复用的排班方案模板（如一周白夜轮转），排班时直接套用，减少重复配置。</div></div></div>

      <div class="card">
        <div class="toolbar">
          <button class="btn primary" id="add">+ 新建模板</button>
          <input class="input" id="kw" style="width:200px" placeholder="按模板名称搜索" value="${U.esc(kw)}">
          <span class="spacer"></span><span class="muted-text">共 ${list.length} 个模板</span>
        </div>
        <table class="tbl">
          <thead><tr><th>模板名称</th><th>适用科室</th><th>适用周期</th><th>关联规则</th><th>最近使用</th><th>操作</th></tr></thead>
          <tbody>${list.map(rowOf).join('') || `<tr><td colspan="6"><div class="empty-state">暂无模板</div></td></tr>`}</tbody>
        </table>
      </div>`;

    U.$('#kw', view).addEventListener('input', e => { kw = e.target.value; Router.render(); setTimeout(() => { const n = U.$('#kw'); if (n) { n.focus(); n.value = kw; } }); });
    U.$('#add', view).addEventListener('click', () => editTpl(null));
    U.delegate(view, 'click', '[data-row]', (e, t) => { if (e.target.closest('button')) return; expanded = expanded === t.dataset.row ? null : t.dataset.row; Router.render(); });
    U.delegate(view, 'click', '[data-edit]', (e, t) => editTpl(t.dataset.edit));
    U.delegate(view, 'click', '[data-copy]', (e, t) => copyTpl(t.dataset.copy));
    U.delegate(view, 'click', '[data-del]', (e, t) => delTpl(t.dataset.del));

    function rowOf(t) {
      const open = expanded === t.id;
      let html = `<tr class="clickable" data-row="${t.id}">
        <td><b>${U.esc(t._name)}</b> ${open ? '▾' : '▸'}</td>
        <td>${orgName(t._org)}</td>
        <td>${t._cycle}</td><td>${ruleName(t._rule)}</td>
        <td>${t._lastUsed || '—'}</td>
        <td><button class="btn-link" data-edit="${t.id}">编辑</button>
          <button class="btn-link" data-copy="${t.id}">复制</button>
          <button class="btn-link danger" data-del="${t.id}">删除</button></td></tr>`;
      if (open) html += `<tr><td colspan="6" style="background:#fafcff">${preview(t)}</td></tr>`;
      return html;
    }
  };

  function preview(t) {
    const shifts = Object.keys(t._plan || {});
    const rule = FHIR.read('Basic', t._rule, { silent: true });
    const cols = periodCols(t._cycle);
    return `<div style="padding:6px 2px">
      <div class="muted-text" style="margin-bottom:8px">模板预览 · ${t._desc || ''}</div>
      <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>班次</th>${cols.map(w => `<th>${w}</th>`).join('')}</tr></thead>
      <tbody>${shifts.map(s => `<tr><td><b>${s}</b>${shiftTime(rule, s) ? `<br><span class="muted-text" style="font-size:11px">${shiftTime(rule, s)}</span>` : ''}</td>${(t._plan[s] || []).map(v => { const ids = cellIds(v); return `<td>${ids.length ? ids.map(docName).join('、') : '<span class="tag default">待安排</span>'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="muted-text" style="font-size:12px;margin-top:8px">关联规则：${rule ? rule._name : '—'}${rule ? '（' + (rule._shifts || []).map(x => x.name + ' ' + x.start + '-' + x.end).join('；') + '）' : ''}</div>
    </div>`;
  }

  function copyTpl(id) {
    const t = FHIR.read('Basic', id, { silent: true });
    const n = JSON.parse(JSON.stringify(t)); delete n.id; n._name = t._name + '（副本）'; n._lastUsed = null;
    FHIR.create(n); U.toast('模板已复制', 'success'); Router.render();
  }
  function delTpl(id) {
    const t = FHIR.read('Basic', id, { silent: true });
    U.confirm({ title: '删除模板', danger: true, content: `确认删除排班模板「${t._name}」？删除后不可恢复。` })
      .then(ok => { if (!ok) return; FHIR.remove('Basic', id); U.toast('模板已删除', 'success'); Router.render(); });
  }

  function editTpl(id) {
    const editing = id ? FHIR.read('Basic', id, { silent: true }) : null;
    const rules = FHIR.search('Basic', b => b.code.coding[0].code === 'scheduling-rule' && b._status === 'active', null, { silent: true });
    const t = editing ? JSON.parse(JSON.stringify(editing))
      : { _name: '', _cycle: '按周', _rule: rules[0] && rules[0].id, _org: rules[0] && rules[0]._org, _desc: '', _plan: {} };
    const body = U.el('div');
    function currentRule() { return FHIR.read('Basic', t._rule, { silent: true }); }
    function shiftsOfRule() { const r = currentRule(); return r ? (r._shifts || []).map(s => s.name) : []; }
    // 按当前“适用周期”重建排班方案：列数随 按周/双周/按月 变化（7/14/30 列），
    // 已填写的位置尽量保留，多出的新列留空“待安排”。
    function ensurePlan() {
      const sh = shiftsOfRule();
      const cols = periodCols(t._cycle);
      const np = {};
      sh.forEach(s => {
        const old = t._plan[s] || [];
        np[s] = Array.from({ length: cols.length }, (_, i) => cellIds(old[i]));
      });
      t._plan = np;
    }
    function render() {
      ensurePlan();
      const rule = currentRule();
      const sh = shiftsOfRule();
      const cols = periodCols(t._cycle);
      const docs = orgDocs(t._org);
      body.innerHTML = `
        <div class="form-row">
          <div class="form-item"><label><span class="req">*</span>模板名称</label><input class="input" id="tname" value="${U.esc(t._name)}"></div>
          <div class="form-item"><label>适用周期</label><select class="select" id="tcycle">${['按周', '双周', '按月'].map(c => `<option ${c === t._cycle ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        </div>
        <div class="form-item"><label><span class="req">*</span>关联排班规则</label>
          <select class="select" id="trule">${rules.map(r => `<option value="${r.id}" ${r.id === t._rule ? 'selected' : ''}>${r._name}（${orgName(r._org)}）</option>`).join('')}</select>
          <div class="muted-text" style="font-size:12px;margin-top:4px">模板适用科室与关联规则保持一致：${orgName(t._org)}</div></div>
        <div class="form-item"><label>模板说明</label><input class="input" id="tdesc" value="${U.esc(t._desc)}" placeholder="如：工作日白夜轮转，周末双值班"></div>
        <div class="card-title" style="font-size:14px">排班方案（按规则轮次自动生成班次行，单元格可留空“待安排”，点击单元格可多选候补人员）</div>
        <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>班次</th>${cols.map(w => `<th>${w}</th>`).join('')}</tr></thead>
          <tbody>${sh.map(s => `<tr><td><b>${s}</b>${shiftTime(rule, s) ? `<br><span class="muted-text" style="font-size:11px">${shiftTime(rule, s)}</span>` : ''}</td>${t._plan[s].map((ids, i) => `<td style="min-width:120px" data-cell="${s}|${i}">
            ${U.msBox(docs.map(p => ({ id: p.id, label: p.name[0].text })), ids, { placeholder: '+ 排班' })}
          </td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      U.$('#trule', body).addEventListener('change', e => { syncTop(); t._rule = e.target.value; const r = currentRule(); t._org = r && r._org; render(); });
      U.$('#tcycle', body).addEventListener('change', e => { syncTop(); t._cycle = e.target.value; render(); });
    }
    function syncTop() { t._name = U.$('#tname', body).value; t._cycle = U.$('#tcycle', body).value; t._desc = U.$('#tdesc', body).value; }
    render();
    // 单元格多选人员的点击委托只绑定一次（绑在 body 这个不会被重建的容器上）——
    // 若放进 render() 内部，则每次 render() 重渲染都会在 body 上再叠加一份监听器，
    // 点一次单元格会触发多份处理逻辑（连续弹出多层选择框），与 rule.js 中“删除班次”踩过的坑相同。
    U.delegate(body, 'click', '[data-cell]', async (e, tEl) => {
      const cellBox = tEl.closest('[data-cell]');
      const [s, iStr] = cellBox.dataset.cell.split('|');
      const i = +iStr;
      const cols = periodCols(t._cycle);
      const docs = orgDocs(t._org);
      const options = docs.map(p => ({ id: p.id, label: p.name[0].text }));
      const picked = await U.pickMulti({ title: `排班 · ${s} · ${cols[i]}`, options, selected: t._plan[s][i], placeholder: '本位置人员在模板中不固定，套用时再分配' });
      if (picked === null) return;
      t._plan[s][i] = picked;
      render();
    });
    const foot = U.el('div'); const cancel = U.el('button', { class: 'btn' }, '取消'); const save = U.el('button', { class: 'btn primary' }, '保存模板');
    foot.appendChild(cancel); foot.appendChild(save);
    const m = U.modal({ title: editing ? '排班模板编辑' : '新建排班模板', width: 'wide', body, footer: foot });
    cancel.addEventListener('click', m.close);
    save.addEventListener('click', () => {
      syncTop();
      if (!t._name.trim()) { U.toast('模板名称必填', 'error'); return; }
      if (!t._rule) { U.toast('必须选择关联规则', 'error'); return; }
      if (editing) FHIR.update(Object.assign(editing, t));
      else { t.resourceType = 'Basic'; t.code = { coding: [{ code: 'scheduling-template' }] }; t.created = '2026-06-20'; FHIR.create(t); }
      m.close(); U.toast('模板保存成功', 'success'); Router.render();
    });
  }
})();
