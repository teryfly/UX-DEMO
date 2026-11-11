/* WF-L3-2-1 交接班清单（值班医生填写+交班签名 / 接班医生核查+接班签名） */
(function () {
  const TODAY = '2026-06-20', SHIFT = '白班', ORG = 'org-card';
  let selectedPat = null;
  const SRC_COLOR = { '医嘱': 'blue', '会诊': 'purple', '危急值': 'red' };

  function activeRule() { return FHIR.search('Basic', b => b.code.coding[0].code === 'scheduling-rule' && b._status === 'active' && b._org === ORG, null, { silent: true })[0]; }
  function shiftSeq() { const r = activeRule(); return r ? (r._shifts || []).map(s => s.name) : [SHIFT, '夜班']; }
  // 交接的“交出方”= 当前班次开始前的上一班次人员；“接收方”= 当前班次（正在交接进入的班次）人员——
  // 均取自「值班排班」的真实 Slot 数据，而不是写死某两位医生，与排班表严格同步。
  function prevShiftInfo(date, shiftName) {
    const seq = shiftSeq();
    const idx = seq.indexOf(shiftName);
    if (idx > 0) return { date, shift: seq[idx - 1] };
    return { date: U.fmtDate(U.addDays(new Date(date), -1)), shift: seq[seq.length - 1] };
  }

  // 找/建当前交接草稿（Composition status=preliminary）
  function currentDraft() {
    const id = `comp-cur-${TODAY}-${SHIFT}`;
    let c = FHIR.read('Composition', id, { silent: true });
    if (!c) {
      const prev = prevShiftInfo(TODAY, SHIFT);
      const giverSlot = FHIR.read('Slot', FHIR.slotId(ORG, prev.date, prev.shift), { silent: true });
      const receiverSlot = FHIR.read('Slot', FHIR.slotId(ORG, TODAY, SHIFT), { silent: true });
      c = FHIR.create({
        resourceType: 'Composition', id, status: 'preliminary',
        type: { text: '值班交接班记录' }, date: `${TODAY}T08:00:00`,
        title: `${TODAY} ${SHIFT} 交接班记录`,
        _date: TODAY, _shift: SHIFT, _org: ORG,
        _givers: (giverSlot && giverSlot._practitioners) || [], _receivers: (receiverSlot && receiverSlot._practitioners) || [],
        _supplement: '', _status: '待交接',
        _giverSigs: {}, _receiverSigs: {},
        author: [], attester: [],
      }, { silent: true });
    } else {
      // 兼容历史/早期版本遗留的草稿记录（字段可能不完整，如缺少 _givers/_receivers），
      // 兜底补全，避免页面读取 undefined.length 而渲染异常。
      c._givers = c._givers || [];
      c._receivers = c._receivers || [];
      c._giverSigs = c._giverSigs || {};
      c._receiverSigs = c._receiverSigs || {};
      c._supplement = c._supplement || '';
    }
    return c;
  }

  function allSigned(ids, sigMap) { ids = ids || []; sigMap = sigMap || {}; return ids.length > 0 && ids.every(id => sigMap[id]); }
  function draftState(draft) {
    if (allSigned(draft._givers, draft._giverSigs) && allSigned(draft._receivers, draft._receiverSigs)) return '交接完成';
    if (allSigned(draft._givers, draft._giverSigs)) return '交班已签名 · 待接班';
    return '待交接';
  }

  function syncStatus() {
    // 各来源系统最后同步时间（演示）；超过 30 分钟阈值标记异常
    const now = new Date('2026-06-20T08:00:00');
    return [
      { name: 'HIS', t: '07:55' }, { name: '医嘱', t: '07:58' },
      { name: '会诊', t: '07:25' }, { name: '危急值', t: '07:45' },
    ].map(s => {
      const dt = new Date(`2026-06-20T${s.t}:00`);
      const min = Math.round((now - dt) / 60000);
      return Object.assign(s, { min, bad: min > 30 });
    });
  }

  window.PAGES['#/handover-list'] = function (view) {
    const role = AUTH.currentRole();
    const user = AUTH.currentUser();
    const draft = currentDraft();
    draft._status = draftState(draft);
    const givers = draft._givers.map(id => FHIR.read('Practitioner', id, { silent: true })).filter(Boolean);
    const receivers = draft._receivers.map(id => FHIR.read('Practitioner', id, { silent: true })).filter(Boolean);
    const ss = syncStatus();
    const badSync = ss.some(s => s.bad);
    // 与「值班执行监控」共用同一条到岗超时异常记录、同一套“是否已到岗”判定（接班签名是否完成），
    // 避免同一事实在两个页面显示不一致（US-1.4 AC2）：一旦接班方完成签名，此处横幅随之消失，
    // 与监控页面此时会把该医生判定为“已到岗”保持同步。
    const attendExc = !allSigned(draft._receivers, draft._receiverSigs) && FHIR.search('Communication', c => c.category[0].text === '到岗超时' && c._handleStatus === '未处理'
      && (c._receivers || []).some(id => draft._receivers.includes(id)), null, { silent: true })[0];

    // 在院患者（HIS）+ 标记 + 待办（聚合）
    const encs = FHIR.search('Encounter', e => e.status === 'in-progress', { status: 'in-progress' });
    const patients = encs.map(e => {
      const p = FHIR.resolve(e.subject);
      const cond = FHIR.search('Condition', c => c.subject.reference === e.subject.reference, null, { silent: true })[0];
      const flags = FHIR.search('Flag', f => f.subject.reference === e.subject.reference && f.status === 'active', null, { silent: true });
      const todos = FHIR.search('Task', t => t.for.reference === e.subject.reference && t.status === 'in-progress', null, { silent: true });
      return { enc: e, pat: p, cond, flags, todos, sev: e._severity, bed: e._bed };
    });
    const sevRank = { '危重': 0, '较重': 1, '一般': 2 };
    patients.sort((a, b) => sevRank[a.sev] - sevRank[b.sev]);
    if (!selectedPat || !patients.find(x => x.pat.id === selectedPat)) selectedPat = patients[0] && patients[0].pat.id;

    const stateTag = {
      '待交接': U.tag('待交接', 'orange'),
      '交班已签名 · 待接班': U.tag('交班已签名 · 待接班', 'blue'),
      '交接完成': U.tag('交接完成', 'green'),
    }[draft._status];

    view.innerHTML = `
      <div class="page-head">
        <div><h2>交接班清单</h2>
          <div class="desc">系统自动汇总在院患者、重点标记与未完成待办（医嘱/会诊/危急值），双方核对后完成 CA 电子签名。</div>
        </div>
      </div>

      <!-- C 当前交接班次信息栏 -->
      <div class="card">
        <div class="flex-between">
          <div style="display:flex;gap:26px;flex-wrap:wrap;align-items:center">
            <div><span class="muted-text">交接班次</span><br><b>${TODAY} · ${SHIFT}</b></div>
            <div><span class="muted-text">交出方（${givers.length}人）</span><br>${givers.map(g => `<b>${g.name[0].text}</b> ${U.tag(qual(g), 'blue')}`).join(' ') || '<span class="muted-text">暂无排班</span>'}</div>
            <div><span class="muted-text">接收方（${receivers.length}人）</span><br>${receivers.map(r => `<b>${r.name[0].text}</b> ${U.tag(qual(r), 'blue')}`).join(' ') || '<span class="muted-text">暂无排班</span>'}</div>
            <div><span class="muted-text">交接状态</span><br>${stateTag} ${attendExc ? U.tag('⚠ 到岗超时 ' + attendExc._duration, 'red') : ''}</div>
          </div>
          <div class="sync-status">
            <span>数据同步：</span>
            ${ss.map(s => `<span class="${s.bad ? 'bad' : 'ok'}">${s.bad ? '⚠' : '●'} ${s.name} ${s.t}</span>`).join('')}
          </div>
        </div>
        ${badSync ? `<div class="hint warn" style="margin-top:10px;margin-bottom:0">⚠ 部分来源系统同步已超过 30 分钟，数据可能不完整，建议核实后再交接。</div>` : ''}
        ${!givers.length || !receivers.length ? `<div class="hint warn" style="margin-top:10px;margin-bottom:0">⚠ 当前班次交出方/接收方尚未在「值班排班」中完整排班，请先联系科室负责人补齐排班。</div>` : ''}
      </div>

      <div class="row" style="align-items:flex-start">
        <!-- D 患者列表 -->
        <div style="flex:0 0 340px;max-width:340px">
          <div class="card" style="padding:12px">
            <div class="toolbar" style="margin-bottom:10px">
              <span class="pill ${filt === '全部' ? 'active' : ''}" data-filt="全部">全部 ${patients.length}</span>
              <span class="pill ${filt === '重点' ? 'active' : ''}" data-filt="重点">重点 ${patients.filter(p => p.flags.length).length}</span>
              <span class="pill ${filt === '一般' ? 'active' : ''}" data-filt="一般">一般</span>
            </div>
            <div class="muted-text" style="font-size:12px;margin-bottom:8px">按风险等级降序排列 · 共 ${patients.length} 人</div>
            <div id="patList">${patients.filter(filterFn).map(patCard).join('') || emptyPats()}</div>
          </div>
        </div>

        <!-- E 患者详情 -->
        <div style="flex:1;min-width:320px">
          <div class="card" id="patDetail">${patientDetail(patients.find(p => p.pat.id === selectedPat))}</div>

          <!-- E2 待办事项汇总（未完成）——全部在院患者的汇总清单，与左侧“选中的某一患者”无关，
               不是“逐个患者交接”的设计，避免误解为每位患者都要单独交接一次 -->
          <div class="card">${todoSummary(allTodos(patients))}</div>

          <!-- F 交接补充信息 -->
          <div class="card">
            <div class="card-title">交接补充信息 <span class="sub">交班医生填写 · 选填 · 双方可见</span></div>
            <textarea class="input" id="supplement" rows="3" placeholder="填写本次交接的补充说明与注意事项…"
              ${role === '值班医生' && draft._status !== '交接完成' ? '' : 'disabled'}>${U.esc(draft._supplement)}</textarea>
            ${role === '值班医生' && draft._status !== '交接完成'
        ? `<div style="margin-top:8px"><button class="btn sm" id="saveSup">保存补充信息</button></div>`
        : `<div class="muted-text" style="font-size:12px;margin-top:6px">${role === '值班医生' ? '' : '仅交班医生可编辑（接班医生可见）'}</div>`}
          </div>

          <!-- 接班确认说明（UJ-2.2 阶段3，接班医生填写） -->
          <div class="card">
            <div class="card-title">接班确认说明 <span class="sub">接班医生填写 · 对存疑/需关注条目补充确认</span></div>
            <textarea class="input" id="recvNote" rows="3" placeholder="接班医生对存疑或需特别关注的条目补充确认说明…"
              ${role === '接班医生' && draft._status !== '交接完成' ? '' : 'disabled'}>${U.esc(draft._receiverNote || '')}</textarea>
            ${role === '接班医生' && draft._status !== '交接完成'
        ? `<div style="margin-top:8px"><button class="btn sm" id="saveNote">保存确认说明</button></div>`
        : `<div class="muted-text" style="font-size:12px;margin-top:6px">${role === '接班医生' ? '' : '仅接班医生可编辑（双方可见）'}</div>`}
          </div>

          <!-- G 签名区 -->
          <div class="card">
            <div class="card-title">交接班电子签名（CA） <span class="sub">交出方全部签名后，接收方方可签名；全部签完才算交接完成</span></div>
            <div class="grid-2">
              ${sigSide('giver', '交班医生', givers, draft._giverSigs, role === '值班医生' && draft._status !== '交接完成')}
              ${sigSide('receiver', '接班医生', receivers, draft._receiverSigs, role === '接班医生' && allSigned(draft._givers, draft._giverSigs) && draft._status !== '交接完成')}
            </div>
            ${draft._status === '交接完成'
        ? `<div class="hint" style="margin-top:12px;margin-bottom:0">✅ 双方（交出方 ${givers.length} 人 / 接收方 ${receivers.length} 人）签名全部完成，交接记录已归档至「交接班记录」，不可篡改。</div>`
        : ''}
          </div>
        </div>
      </div>`;

    // ---- 交互 ----
    // “患者基本信息”卡片仅用于浏览某位患者的详情，与待办事项汇总、交接补充信息/
    // 签名等交接动作互不关联，切换所看的患者不代表要“对该患者单独交接一次”。
    U.delegate(U.$('#patList', view) || view, 'click', '[data-pat]', (e, t) => {
      selectedPat = t.dataset.pat;
      U.$('#patDetail').innerHTML = patientDetail(patients.find(p => p.pat.id === selectedPat));
      U.$$('#patList [data-pat]').forEach(n => n.classList.toggle('selected', n.dataset.pat === selectedPat));
    });
    U.delegate(view, 'click', '[data-filt]', (e, t) => { filt = t.dataset.filt; Router.render(); });
    // data-jump 在“患者详情”与“待办事项汇总”两处都会出现，绑在 view 上一次即可覆盖全部，
    // 无需每次切换患者都重新绑定（重复绑定会导致同一次点击触发多次提示）。
    U.delegate(view, 'click', '[data-jump]', (e, t) => {
      U.toast(`正在跳转至「${t.dataset.jump}」系统查看原始记录…（演示）`, 'info');
    });

    const saveSup = U.$('#saveSup', view);
    if (saveSup) saveSup.addEventListener('click', () => {
      draft._supplement = U.$('#supplement').value;
      FHIR.update(draft);
      U.toast('补充信息已保存', 'success');
    });
    const saveNote = U.$('#saveNote', view);
    if (saveNote) saveNote.addEventListener('click', () => {
      draft._receiverNote = U.$('#recvNote').value;
      FHIR.update(draft);
      U.toast('接班确认说明已保存', 'success');
    });

    U.delegate(view, 'click', '[data-sign]', (e, t) => doSign(t.dataset.sign, t.dataset.doc, draft));
  };

  let filt = '全部';
  function filterFn(p) {
    if (filt === '重点') return p.flags.length;
    if (filt === '一般') return !p.flags.length;
    return true;
  }
  function qual(p) { return p.qualification && p.qualification[0] ? p.qualification[0].code.text : '医师'; }

  function patCard(p) {
    const sevColor = { '危重': 'red', '较重': 'orange', '一般': 'green' }[p.sev];
    const hot = p.flags.length;
    return `<div class="card flat" data-pat="${p.pat.id}" style="padding:11px;margin-bottom:9px;cursor:pointer;
      ${hot ? 'border-left:3px solid var(--error)' : ''} ${p.pat.id === selectedPat ? 'background:#e6f0ff' : ''}">
      <div class="flex-between" style="margin-bottom:4px">
        <b>${p.bed} · ${p.pat.name[0].text}</b>
        <span class="tag ${sevColor}">${p.sev}</span>
      </div>
      <div class="muted-text" style="font-size:12px">${p.cond ? p.cond.code.text : ''}</div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
        ${p.flags.map(f => U.tag('★' + f.code.text, 'red')).join('')}
        ${p.todos.length ? U.tag('待办 ' + p.todos.length, 'orange') : U.tag('待办 0', 'default')}
      </div>
    </div>`;
  }
  function emptyPats() { return `<div class="empty-state"><span class="ic">🛏️</span>暂无在院患者，数据同步中…</div>`; }

  // 仅展示所选患者的基本信息（人口学信息、诊断、重点标记），与下方的
  // “待办事项汇总（未完成）”彻底分为两个独立模块——后者是全部在院患者的汇总，
  // 不随这里切换的患者而变化。
  function patientDetail(p) {
    if (!p) return emptyPats();
    const pat = p.pat;
    const age = 2026 - parseInt(pat.birthDate);
    return `
      <div class="card-title">患者基本信息 <span class="sub">${p.bed} · ${pat.name[0].text}</span>
        <span class="tag ${({ '危重': 'red', '较重': 'orange', '一般': 'green' })[p.sev]}">${p.sev}</span></div>
      <div class="grid-4" style="gap:10px;margin-bottom:14px">
        ${info('性别', pat.gender === 'male' ? '男' : '女')}
        ${info('年龄', age + ' 岁')}
        ${info('入院日期', p.enc.period.start.slice(0, 10))}
        ${info('病情等级', p.sev)}
      </div>
      <div style="margin-bottom:10px"><span class="muted-text">诊断：</span><b>${p.cond ? p.cond.code.text : '—'}</b></div>
      ${p.flags.length ? `<div><span class="muted-text" style="font-size:12px;margin-right:6px">重点标记：</span>${p.flags.map(f => U.tag('★ ' + f.code.text, 'red')).join(' ')}
        <span class="muted-text" style="font-size:12px">（依据 EMR/HIS 诊疗数据自动标记）</span></div>` : ''}`;
  }
  function info(k, v) { return `<div><div class="muted-text" style="font-size:12px">${k}</div><b>${v}</b></div>`; }

  // 所有在院患者的未完成待办事项汇总为一张清单（而非某一位患者的待办），
  // 按紧急程度排序，每一行都带上患者姓名/床号，能明确归属到具体患者。
  function allTodos(patients) {
    const priRank = { '紧急': 0, '高': 1, '普通': 2, '低': 3 };
    const rows = [];
    patients.forEach(p => p.todos.forEach(t => rows.push({ t, p })));
    rows.sort((a, b) => (priRank[a.t._priority] ?? 9) - (priRank[b.t._priority] ?? 9));
    return rows;
  }
  function todoSummary(rows) {
    return `<div class="card-title">待办事项汇总（未完成） <span class="sub">全部在院患者 · 共 ${rows.length} 项</span></div>
      ${rows.length ? `<table class="tbl"><thead><tr><th>床号</th><th>患者姓名</th><th>类型</th><th>内容摘要</th><th>紧急程度</th><th>来源系统</th><th>操作</th></tr></thead>
        <tbody>${rows.map(({ t, p }) => `<tr>
          <td>${p.bed}</td>
          <td>${p.pat.name[0].text}</td>
          <td>${U.tag(t._source, SRC_COLOR[t._source] || 'default')}</td>
          <td>${U.esc(t.description)}</td>
          <td>${U.priorityTag(t._priority)}</td>
          <td>${t._source}系统</td>
          <td><button class="btn-link" data-jump="${t._source}详情">跳转 →</button></td>
        </tr>`).join('')}</tbody></table>`
        : `<div class="empty-state" style="padding:20px"><span class="ic">✅</span>当前在院患者暂无未完成待办事项</div>`}`;
  }

  // 交出方/接收方各自可能有多位医生——每位单独展示签名状态与签名按钮，
  // 全部签完才视为该侧完成（US-1.2 AC3「多人交接」）
  function sigSide(which, label, docs, sigMap, canSignSide) {
    if (!docs.length) return `<div class="card flat"><div class="flex-between"><b>${label}签名</b>${U.tag('暂无排班', 'default')}</div></div>`;
    return `<div class="card flat">
      <div class="flex-between"><b>${label}签名</b>${U.tag(allSigned(docs.map(d => d.id), sigMap) ? '全部已签名' : `已签 ${docs.filter(d => sigMap[d.id]).length}/${docs.length}`, allSigned(docs.map(d => d.id), sigMap) ? 'green' : 'default')}</div>
      ${docs.map(doc => {
      const sig = sigMap[doc.id];
      if (sig) return `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
          <div class="flex-between">${doc.name[0].text} · ${qual(doc)}${U.tag('已签名', 'green')}</div>
          <div class="muted-text" style="font-size:12px;margin-top:4px">签名时间：${U.fmtTime(sig.time)} · CA凭证：${sig.serial}</div>
        </div>`;
      const canSign = canSignSide;
      return `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
          <div class="flex-between">${doc.name[0].text} · ${qual(doc)}${U.tag('待签名', 'default')}</div>
          <div style="margin-top:8px"><button class="btn primary sm" data-sign="${which}" data-doc="${doc.id}" ${canSign ? '' : 'disabled'}>🖊 CA 电子签名</button>
          ${!canSign ? `<span class="muted-text" style="font-size:12px;margin-left:8px">${which === 'receiver' ? '需交出方全部签名后，且以接班医生身份操作' : '请以交班医生身份操作'}</span>` : ''}</div>
        </div>`;
    }).join('')}
    </div>`;
  }

  function doSign(which, docId, draft) {
    const doc = FHIR.read('Practitioner', docId, { silent: true });
    // 模拟 CA 签名通道：加载态 → 成功
    const foot = U.el('div');
    const m = U.modal({
      title: 'CA 电子签名', width: '',
      body: `<div style="text-align:center;padding:18px">
        <div style="font-size:40px">🔐</div>
        <p>正在连接 CA 签名平台，验证 <b>${doc.name[0].text}</b> 身份…</p>
        <div class="muted-text" id="caMsg">预加载签名通道中，请稍候</div>
      </div>`,
      footer: foot, maskClose: false,
    });
    FHIR.read('Provenance', 'ca-channel', { silent: false }); // 控制台留痕：连接CA
    setTimeout(() => {
      const serial = 'CA-' + docId.toUpperCase() + '-' + Math.floor(Math.random() * 9000 + 1000);
      const time = new Date('2026-06-20T08:0' + (which === 'giver' ? '5' : '9') + ':00').toISOString();
      const sig = { serial, time, provider: 'CA签名平台', verified: true };
      if (which === 'giver') { draft._giverSigs[docId] = sig; draft.attester = draft.attester || []; draft.attester.push({ mode: 'professional', time, party: FHIR.refStr('Practitioner', docId), _ca: sig }); }
      else { draft._receiverSigs[docId] = sig; draft.attester.push({ mode: 'legal', time, party: FHIR.refStr('Practitioner', docId), _ca: sig }); }
      draft._status = draftState(draft);

      const completed = draft._status === '交接完成';
      if (completed) finalize(draft);
      else FHIR.update(draft);

      m.body.innerHTML = `<div style="text-align:center;padding:18px"><div style="font-size:40px">✅</div>
        <p><b>${doc.name[0].text}</b> 签名成功</p><div class="muted-text">CA凭证：${serial}</div></div>`;
      setTimeout(() => {
        m.close();
        if (completed) U.toast('✅ 交接成功，已在「交接班记录」中生成一条新记录', 'success', 3600);
        else U.toast('电子签名成功', 'success');
        Router.render();
      }, 700);
    }, 900);
  }

  function finalize(draft) {
    draft.status = 'final';
    draft._status = '交接完成';
    // 完成时间取“最后一位签名者”的时间（交出方、接收方中最晚的一次签名）
    const allTimes = [...Object.values(draft._giverSigs), ...Object.values(draft._receiverSigs)].map(s => s.time);
    draft._finishTime = allTimes.sort().pop();
    // 超时判定：完成时长 > 阈值(30min)。本次演示按时完成 → 正常
    const startT = new Date(`${draft._date}T08:00:00`);
    const mins = Math.round((new Date(draft._finishTime) - startT) / 60000);
    draft._status2 = mins > 30 ? '超时' : '正常';
    // 患者清单/待办事项按“交接当时”留存快照，不随后续患者出院/待办办结而改变（US-1.2 AC3、IA-2.5 P2）
    const encs = FHIR.search('Encounter', e => e.status === 'in-progress', null, { silent: true });
    draft._patientSnapshot = encs.map(e => {
      const p = FHIR.resolve(e.subject);
      const cond = FHIR.search('Condition', c => c.subject.reference === e.subject.reference, null, { silent: true })[0];
      const flags = FHIR.search('Flag', f => f.subject.reference === e.subject.reference && f.status === 'active', null, { silent: true });
      return { bed: e._bed, name: p ? p.name[0].text : '', dx: cond ? cond.code.text : '', severity: e._severity, flags: flags.map(f => f.code.text) };
    });
    const todos = FHIR.search('Task', t => t.status === 'in-progress', null, { silent: true });
    draft._todoSnapshot = todos.map(t => {
      const p = FHIR.resolve(t.for);
      const enc = encs.find(e => e.subject.reference === t.for.reference);
      return { bed: enc ? enc._bed : '', name: p ? p.name[0].text : '', source: t._source, desc: t.description, priority: t._priority };
    });
    draft._patientCount = draft._patientSnapshot.length;
    draft._todoCount = draft._todoSnapshot.length;
    FHIR.update(draft);
    // Provenance 签名留痕
    FHIR.create({
      resourceType: 'Provenance', id: 'prov-' + draft.id,
      target: [FHIR.refStr('Composition', draft.id)],
      recorded: draft._finishTime, activity: { text: '交接班双方CA电子签名' },
      agent: [
        ...draft._givers.map(id => ({ who: FHIR.refStr('Practitioner', id), type: { text: '交班医生' } })),
        ...draft._receivers.map(id => ({ who: FHIR.refStr('Practitioner', id), type: { text: '接班医生' } })),
      ],
      signature: [
        ...draft._givers.map(id => ({ type: [{ display: '交班签名' }], when: draft._giverSigs[id].time, who: FHIR.refStr('Practitioner', id) })),
        ...draft._receivers.map(id => ({ type: [{ display: '接班签名' }], when: draft._receiverSigs[id].time, who: FHIR.refStr('Practitioner', id) })),
      ],
    });
    if (mins > 30) {
      FHIR.create({
        resourceType: 'Communication', id: 'comm-' + draft.id, status: 'completed',
        category: [{ text: '交接超时' }], priority: 'urgent', sent: draft._finishTime,
        recipient: [FHIR.refStr('Practitioner', 'doc-wjg')], _givers: draft._givers, _receivers: draft._receivers,
        payload: [{ contentString: '交接超时' }], _org: draft._org, _duration: (mins - 30) + '分钟', _handleStatus: '未处理', _handleNote: '',
      });
    }
  }
})();
