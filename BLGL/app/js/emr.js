/* ============================================================
   病历详情 / 编辑器 —— 树形模块导航 + 结构化内容编辑
   被「时限监控 / 整改处理 / 整改追踪 / 归档管理」复用
   本系统内容均"同步自EMR系统"，本系统只负责检查医生书写是否合规/超时，
   因此病案首页 / 医嘱明细 / 体温单 / 护理记录均按只读结构化视图展示，
   仅"文书类"内容（入院记录/病程记录/手术记录/出院记录）支持编辑。
   ============================================================ */
const EMR = (() => {
  const F = window.FHIR, B = window.Biz, U = window.UI;
  const esc = U.esc;

  // 文书类型 → 模块大类
  const CAT = {
    '入院记录': '入院记录', '首次病程记录': '病程记录', '日常病程记录': '病程记录',
    '术前讨论记录': '手术记录', '手术记录': '手术记录', '出院记录': '出院记录',
  };
  const REQUIRED_FIELDS = ['主诉', '现病史', '既往史', '讨论意见', '出院小结', '出院医嘱'];
  const archiveLabel = { none: '未提交', archiving: '归档中', archived: '已归档', intercepted: '已拦截' };

  function build(encId, opts = {}) {
    const enc = F.byId('Encounter', encId);
    const docs = B.docsOf(encId).filter(d => d.type !== '医嘱'); // 医嘱改为结构化长期/临时医嘱展示
    const medDoc = B.docsOf(encId).find(d => d.type === '医嘱');
    const tasks = (opts.tasks || B.tasksOf(encId)).filter(t => t.status === '待整改');
    const readonly = !!opts.readonly;

    // 草稿（仅保存时提交）—— 含医嘱文书草稿，用于其时限合规状态的编辑/完成判定
    const draft = {};
    docs.forEach(d => draft[d.id] = JSON.parse(JSON.stringify(d.content)));
    if (medDoc) draft[medDoc.id] = JSON.parse(JSON.stringify(medDoc.content));

    // 任务定位 → docId
    const taskDocId = (t) => {
      const dt = (t.location || '').split('>')[0].trim();
      const d = docs.find(x => x.type === dt) || (medDoc && medDoc.type === dt ? medDoc : null);
      return d ? d.id : null;
    };
    const docHasIssue = (docId) => tasks.some(t => taskDocId(t) === docId);

    // 构建树节点：[{cat, leaves:[{id,label,docId?,kind}]}]
    const cats = [];
    const ensure = (name) => { let c = cats.find(x => x.cat === name); if (!c) { c = { cat: name, leaves: [] }; cats.push(c); } return c; };
    ensure('住院病案首页').leaves.push({ id: 'home', label: '病案首页', kind: 'home' });
    docs.forEach(d => {
      const c = ensure(CAT[d.type] || d.type);
      let label = d.type;
      if (CAT[d.type] === '病程记录') label = `${F.fmt(d.createdAt, false).slice(5)} ${d.type.replace('记录', '')}`;
      c.leaves.push({ id: d.id, label, docId: d.id, kind: 'doc', type: d.type });
    });
    // 医嘱：长期医嘱 / 临时医嘱 两个子节点（含具体开立时间、开立人、用法用量）
    const ordCat = ensure('医嘱');
    ordCat.leaves.push({ id: 'orders-long', label: '长期医嘱', kind: 'orders', ordersKind: '长期', docId: medDoc ? medDoc.id : null });
    ordCat.leaves.push({ id: 'orders-temp', label: '临时医嘱', kind: 'orders', ordersKind: '临时', docId: medDoc ? medDoc.id : null });
    // 护理文书（同步自EMR系统，只读结构化展示）
    ensure('护理文书').leaves.push({ id: 'nurse-temp', label: '体温单', kind: 'temp' }, { id: 'nurse-rec', label: '护理记录', kind: 'nurse' });

    // 默认选中：指定 focusDoc 优先，其次有问题的文书，否则入院记录
    let current = null;
    if (opts.focusDoc && (docs.some(d => d.id === opts.focusDoc) || (medDoc && medDoc.id === opts.focusDoc))) {
      current = (medDoc && medDoc.id === opts.focusDoc) ? 'orders-long' : opts.focusDoc;
    }
    if (!current && tasks.length) current = taskDocId(tasks[0]);
    if (!current) { const adm = docs.find(d => d.type === '入院记录'); current = adm ? adm.id : (docs[0] && docs[0].id) || 'home'; }

    const wrap = U.h(`<div class="emr"><div class="emr-nav"></div><div class="emr-body"></div></div>`);
    const navEl = wrap.querySelector('.emr-nav'), bodyEl = wrap.querySelector('.emr-body');

    function renderNav() {
      navEl.innerHTML = '';
      cats.forEach(c => {
        navEl.appendChild(U.h(`<div class="emr-node parent">▼ ${esc(c.cat)}</div>`));
        c.leaves.forEach(lf => {
          const issue = lf.docId && docHasIssue(lf.docId) && lf.kind !== 'orders';
          const on = lf.id === current;
          const n = U.h(`<div class="emr-node child ${on ? 'on' : ''}" data-id="${lf.id}">
            <span>${esc(lf.label)}</span>${issue ? '<span class="flag">🔴</span>' : on ? '<span class="flag">◀</span>' : ''}</div>`);
          n.onclick = () => { current = lf.id; renderNav(); renderBody(); };
          navEl.appendChild(n);
        });
        if (!readonly && c.cat === '病程记录') {
          const add = U.h(`<div class="emr-add">+ 新增病程记录</div>`);
          add.onclick = () => addProgressNote();
          navEl.appendChild(add);
        }
      });
    }

    function fieldBlock(docId, key, val) {
      const isReq = REQUIRED_FIELDS.includes(key);
      // 该字段相关整改要求
      const rel = tasks.filter(t => { const m = (t.location || '').split('>').map(s => s.trim()); return m[0] === F.byId('Composition', docId).type && m[1] === key; });
      const locTag = rel.length ? `<span class="loc-tag">← 整改要求定位处</span>` : '';
      const flag = rel.length ? '🔴 ' : '';
      const ta = readonly
        ? `<div style="white-space:pre-wrap;padding:8px 11px;border:1px solid var(--c-line);border-radius:8px;background:#fafbfc;min-height:40px">${esc(val) || '<span class="muted">（空）</span>'}</div>`
        : `<textarea data-doc="${docId}" data-key="${esc(key)}" placeholder="请输入${esc(key)}…">${esc(val)}</textarea>`;
      return `<div class="emr-sec"><h4>${flag}【${esc(key)}】${isReq ? '<span class="loc-tag">必填</span>' : ''}${locTag}</h4>${ta}</div>`;
    }

    // ---- 病案首页（结构化，参照国家标准纸质住院病案首页分组）----
    function renderHome() {
      const kv = (label, val) => `<div><label>${esc(label)}</label><div style="padding:4px 0">${esc(val == null || val === '' ? '—' : val)}</div></div>`;
      const grp = (title, inner) => `<div class="pmr-group"><div class="pmr-h">${esc(title)}</div><div class="pmr-b">${inner}</div></div>`;
      const dxRows = (enc.diagnoses || []).map((d, i) => `<tr><td>${d.seq}</td><td>${esc(d.name)}</td><td>${esc(d.code)}</td><td>${esc(d.admitCondition)}</td><td>${esc(d.outcome || '—')}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">暂无诊断记录</td></tr>';
      const surgRows = (enc.surgeries || []).map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.date)}</td><td>${esc(s.surgeon)}</td><td>${esc(s.anesthesia)}</td><td>${esc(s.anesthetist)}</td><td>${esc(s.level)}</td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">本次住院无手术操作</td></tr>';
      const stayDays = enc.archivedAt ? Math.max(1, Math.round((new Date(enc.archivedAt) - new Date(enc.admitAt)) / 86400e3)) : Math.max(1, Math.round((F.NOW() - new Date(enc.admitAt)) / 86400e3));
      const html = `<div class="pmr-scroll">
        ${grp('机构信息', `<div class="pmr-grid">
          ${kv('医院名称', '示范医院')}${kv('科室', F.orgName(enc.org))}${kv('病区', enc.ward)}${kv('床号', enc.bed)}
          ${kv('住院/门诊号', enc.mrn)}${kv('就诊类型', enc.type)}${kv('病案号', enc.blNo || '（未归档）')}${kv('归档状态', archiveLabel[enc.archiveStatus])}
        </div>`)}
        ${grp('患者身份信息', `<div class="pmr-grid">
          ${kv('姓名', enc.patientName)}${kv('性别', enc.sex)}${kv('出生日期', enc.birthDate)}${kv('年龄', enc.age)}
          ${kv('民族', enc.nation)}${kv('婚姻状况', enc.marital)}${kv('职业', enc.occupation)}${kv('身份证号', enc.idNumber)}
        </div>`)}
        ${grp('地址及联系人信息', `<div class="pmr-grid">
          ${kv('户籍地址', enc.regAddr)}${kv('现住址', enc.curAddr)}${kv('联系人', enc.contactName)}
          ${kv('与患者关系', enc.contactRelation)}${kv('联系电话', enc.contactPhone)}
        </div>`)}
        ${grp('出入院信息', `<div class="pmr-grid">
          ${kv('入院时间', F.fmt(enc.admitAt))}${kv('入院科室', F.orgName(enc.org))}${kv('入院病情', enc.admissionCondition)}
          ${kv('出院时间', enc.archivedAt ? F.fmt(enc.archivedAt) : '（尚未出院）')}${kv('出院科室', F.orgName(enc.org))}${kv('实际住院天数', stayDays + ' 天')}
          ${kv('责任医生', F.userName(enc.doctor))}${kv('主治医师', enc.signatures ? enc.signatures.attending : '—')}${kv('科主任', enc.signatures ? enc.signatures.chief : '—')}
        </div>`)}
        ${grp('主要 / 其他诊断', `<table class="pmr-table"><thead><tr><th>序号</th><th>诊断名称</th><th>疾病编码（ICD-10）</th><th>入院病情</th><th>诊疗结果</th></tr></thead><tbody>${dxRows}</tbody></table>`)}
        ${grp('损伤、中毒的外部原因', `<div class="pmr-grid c2">${kv('外部原因', enc.damagePoison || '无')}</div>`)}
        ${grp('病理诊断', `<div class="pmr-grid c2">${kv('病理诊断', enc.pathology || '未做病理检查')}${kv('病理号', enc.pathology ? 'B' + (enc.mrn || '').slice(-6) : '—')}</div>`)}
        ${grp('药物过敏 / 血型', `<div class="pmr-grid">${kv('药物过敏', enc.allergyHistory)}${kv('血型', enc.bloodType)}${kv('Rh', enc.rh)}</div>`)}
        ${grp('手术操作', `<table class="pmr-table"><thead><tr><th>手术名称</th><th>手术日期</th><th>术者</th><th>麻醉方式</th><th>麻醉医师</th><th>切口愈合等级</th></tr></thead><tbody>${surgRows}</tbody></table>`)}
        ${grp('各级医师签名', `<div class="pmr-grid c3">${kv('住院医师签名', enc.signatures ? enc.signatures.resident : '—')}${kv('主治医师签名', enc.signatures ? enc.signatures.attending : '—')}${kv('主任（副主任）医师签名', enc.signatures ? enc.signatures.chief : '—')}</div>`)}
        ${grp('病案质控', `<div class="pmr-grid c3">${kv('质控等级', enc.qc ? enc.qc.grade : '—')}${kv('质控评分', enc.qc ? enc.qc.score : '—')}${kv('质控人员', enc.qc ? enc.qc.scorer : '—')}</div>`)}
      </div>`;
      bodyEl.innerHTML = html;
    }

    // ---- 医嘱：长期 / 临时（结构化表 + 文书内容编辑，用于时限合规判定）----
    function renderOrders(kind) {
      const isLong = kind === '长期';
      const list = (enc.orders || []).filter(o => o.kind === kind);
      const rows = list.map(o => `<tr><td>${esc(F.fmt(o.orderedAt))}</td><td>${esc(o.drug)}</td><td>${esc(o.usage)}</td><td>${esc(o.dose)}</td><td>${esc(o.freq)}</td><td>${esc(o.orderedBy)}</td><td>${esc(o.status)}</td></tr>`).join('')
        || '<tr><td colspan="7" class="muted">暂无医嘱记录</td></tr>';
      let extra = '';
      if (medDoc) {
        const key = isLong ? '长期医嘱' : '临时医嘱';
        const c = B.docCompliance(medDoc);
        extra = `<div class="emr-sec"><h4>【${esc(key)}文书内容】</h4>` +
          (readonly
            ? `<div style="white-space:pre-wrap;padding:8px 11px;border:1px solid var(--c-line);border-radius:8px;background:#fafbfc;min-height:40px">${esc(draft[medDoc.id][key]) || '<span class="muted">（空）</span>'}</div>`
            : `<textarea data-doc="${medDoc.id}" data-key="${esc(key)}" placeholder="请输入${esc(key)}…">${esc(draft[medDoc.id][key] || '')}</textarea>`) +
          `</div><div class="emr-status"><span>合规状态：${U.complianceBadge(c)}</span></div>`;
      }
      bodyEl.innerHTML = `<div class="emr-sec"><h4>${esc(kind)}医嘱</h4>
        <table class="pmr-table"><thead><tr><th>开立时间</th><th>药品/项目</th><th>用法</th><th>单次剂量</th><th>频次</th><th>开立医生</th><th>状态</th></tr></thead>
        <tbody>${rows}</tbody></table></div>${extra}`;
      if (!readonly) bodyEl.querySelectorAll('textarea[data-doc]').forEach(ta => { ta.oninput = () => { draft[ta.dataset.doc][ta.dataset.key] = ta.value; }; });
    }

    // ---- 体温单（完整图表：双刻度网格 + 体温/脉搏曲线 + 呼吸行 + 出入量表）----
    function renderTempSheet() {
      const vit = enc.vitals || [];
      if (!vit.length) { bodyEl.innerHTML = `<div class="emr-sec"><h4>体温单</h4><div class="muted" style="padding:18px 0">暂无体温单数据</div></div>`; return; }
      const days = [...new Set(vit.map(v => v.day))];
      const n = vit.length;
      const padL = 46, padR = 16, padT = 30, padB = 16, colW = 30;
      const iw = n * colW, w = padL + iw + padR, hgt = 250, ih = hgt - padT - padB;
      const xs = i => padL + i * colW + colW / 2;
      const tMin = 35, tMax = 41, pMin = 40, pMax = 160;
      const yT = t => padT + (1 - (t - tMin) / (tMax - tMin)) * ih;
      const yP = p => padT + (1 - (p - pMin) / (pMax - pMin)) * ih;
      let grid = '';
      for (let t = tMin; t <= tMax; t++) grid += `<line x1="${padL}" y1="${yT(t)}" x2="${padL + iw}" y2="${yT(t)}" stroke="#eef1f5"/><text x="${padL - 6}" y="${yT(t) + 3}" text-anchor="end" font-size="9" fill="#e2483d">${t}℃</text>`;
      let daySep = '';
      days.forEach((d, di) => { if (di > 0) { const x = padL + di * 6 * colW; daySep += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + ih}" stroke="#e2483d" stroke-width="1.2"/>`; } });
      const tPts = vit.map((v, i) => `${xs(i)},${yT(v.t)}`).join(' ');
      const pPts = vit.map((v, i) => `${xs(i)},${yP(v.p)}`).join(' ');
      const tDots = vit.map((v, i) => `<circle cx="${xs(i)}" cy="${yT(v.t)}" r="3" fill="#e2483d"><title>第${v.day}日 ${v.hour}时 体温${v.t}℃</title></circle>`).join('');
      const pMarks = vit.map((v, i) => `<text x="${xs(i)}" y="${yP(v.p) + 3}" text-anchor="middle" font-size="11" fill="#1d6fd6"><title>脉搏${v.p}次/分</title>×</text>`).join('');
      const hourLabels = vit.map((v, i) => `<text x="${xs(i)}" y="${hgt - 3}" text-anchor="middle" font-size="8" fill="#90a">${v.hour}</text>`).join('');
      const dayLabels = days.map((d, di) => `<text x="${padL + di * 6 * colW + 3 * colW}" y="12" text-anchor="middle" font-size="10" fill="#5b6675">第${d}日</text>`).join('');
      const markIn = `<text x="${xs(0)}" y="${padT - 4}" text-anchor="middle" font-size="10" fill="#19a974">入院↓</text>`;
      const outIdx = n - 1;
      const markOut = enc.archiveStatus === 'archived' ? `<text x="${xs(outIdx)}" y="${padT - 4}" text-anchor="middle" font-size="10" fill="#5b6675">出院↓</text>` : '';
      const markSurg = (enc.surgeries && enc.surgeries.length) ? `<text x="${xs(Math.min(8, n - 1))}" y="${padT - 4}" text-anchor="middle" font-size="10" fill="#f59e0b">手术↓</text>` : '';
      const svg = `<svg width="${w}" height="${hgt}" style="display:block">${grid}${daySep}${dayLabels}
        <polyline points="${tPts}" fill="none" stroke="#e2483d" stroke-width="1.6"/>${tDots}
        <polyline points="${pPts}" fill="none" stroke="#1d6fd6" stroke-width="1.2" stroke-dasharray="3,2"/>${pMarks}
        ${markIn}${markOut}${markSurg}${hourLabels}</svg>`;
      const respRow = `<div style="display:flex;min-width:${w}px;font-size:10px;color:var(--c-text-2);border-top:1px solid var(--c-line);padding-top:3px">
        <div style="width:${padL}px;flex-shrink:0;font-weight:600">呼吸</div>
        ${vit.map(v => `<div style="width:${colW}px;flex-shrink:0;text-align:center">${v.r}</div>`).join('')}</div>`;
      // 出入量等每日汇总表（与上方日期列宽严格对齐：每日占 6 个时间点列宽）
      const fc = enc.fluidChart || [];
      const dayW = colW * 6;
      const fcRow = (label, cells) => `<div style="display:flex;min-width:${w}px;font-size:11px;border-top:1px solid var(--c-line)">
        <div style="width:${padL}px;flex-shrink:0;font-weight:600;padding:3px 0">${esc(label)}</div>
        ${fc.map((r, i) => `<div style="width:${dayW}px;flex-shrink:0;text-align:center;padding:3px 0">${esc(cells(r) ?? '—')}</div>`).join('')}</div>`;
      const table = [
        fcRow('特殊治疗', r => r.sputum > 0 ? '雾化吸入' : '—'),
        fcRow('大便次数', r => r.stool + ' 次'),
        fcRow('尿量(ml)', r => r.urine),
        fcRow('痰量(ml)', r => r.sputum || '—'),
        fcRow('引流量(ml)', r => r.drain || '—'),
        fcRow('呕吐量(ml)', r => r.vomit || '—'),
        fcRow('出入总量(ml)', r => `${r.intake - r.output >= 0 ? '+' : ''}${r.intake - r.output}`),
        fcRow('入量(ml)', r => r.intake),
        fcRow('血压(mmHg)', r => r.bp),
        fcRow('体重(kg)', r => r.weight),
        fcRow('手术后天数', r => r.postOpDay),
      ].join('');
      const weekNo = Math.max(1, Math.ceil((new Date(enc.admitAt).getDate()) / 7));
      bodyEl.innerHTML = `<div class="emr-sec"><h4>体温单</h4>
        <div class="wrap-note" style="margin-bottom:6px">${esc(enc.patientName)} · ${esc(enc.sex)} · ${esc(enc.age)}岁 · ${esc(enc.mrn)} · ${esc(F.orgName(enc.org))}/${esc(enc.bed || '—')}
          <span style="margin-left:14px"><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#e2483d;vertical-align:-1px"></i> 体温 &nbsp;
          <span style="color:#1d6fd6">×</span> 脉搏</span></div>
        <div class="temp-chart-wrap"><div style="width:${w}px">${svg}${respRow}${table}</div></div>
        <div class="wrap-note" style="text-align:right;margin-top:6px">第 ${weekNo} 周</div>
      </div>`;
    }

    // ---- 护理记录（结构化只读列表，同步自EMR系统）----
    function renderNursing() {
      const list = enc.nursing || [];
      bodyEl.innerHTML = `<div class="emr-sec"><h4>护理记录</h4>
        <div class="wrap-note" style="margin-bottom:8px">${esc(enc.patientName)} · 护理级别：Ⅱ级护理 · 责任护士：护士站（内容同步自EMR系统，本系统仅监控医生书写文书时限）</div>
        <table class="pmr-table"><thead><tr><th style="width:150px">时间</th><th style="width:110px">护理级别</th><th>护理记录内容</th><th style="width:90px">记录人</th></tr></thead>
        <tbody>${list.length ? list.map(n => `<tr><td>${esc(F.fmt(n.at))}</td><td>${esc(n.level)}</td><td>${esc(n.note)}</td><td>${esc(n.nurse)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">暂无护理记录</td></tr>'}</tbody></table>
      </div>`;
    }

    function renderBody() {
      bodyEl.innerHTML = '';
      if (current === 'home') { renderHome(); return; }
      if (current === 'orders-long') { renderOrders('长期'); return; }
      if (current === 'orders-temp') { renderOrders('临时'); return; }
      if (current === 'nurse-temp') { renderTempSheet(); return; }
      if (current === 'nurse-rec') { renderNursing(); return; }
      const doc = F.byId('Composition', current);
      if (!doc) { bodyEl.innerHTML = '<div class="muted">请选择左侧模块</div>'; return; }
      const c = B.docCompliance(doc);
      // 质控问题定位卡
      const relTasks = tasks.filter(t => taskDocId(t) === doc.id);
      let fixCard = '';
      if (relTasks.length) {
        fixCard = `<div class="fix-card"><div class="ttl">🔴 本模块整改要求（${relTasks.length}项）</div>` +
          relTasks.map((t, i) => `<div>整改要求${'①②③④⑤'[i] || (i + 1)}：${esc(t.requirement)}</div>`).join('') + `</div>`;
      }
      const head = `<div class="emr-grid">
        <div><b>姓名：</b>${esc(enc.patientName)}</div><div><b>性别：</b>${esc(enc.sex)}</div><div><b>年龄：</b>${esc(enc.age)}</div>
        <div><b>出生日期：</b>${esc(enc.birthDate)}</div><div><b>科室：</b>${esc(F.orgName(enc.org))}</div><div><b>病区：</b>${esc(enc.ward)}</div>
        <div><b>床号：</b>${esc(enc.bed || '—')}</div><div><b>住院/门诊号：</b>${esc(enc.mrn)}</div><div><b>民族：</b>${esc(enc.nation)}</div>
        <div><b>婚姻：</b>${esc(enc.marital)}</div><div><b>联系电话：</b>${esc(enc.contactPhone)}</div><div><b>户籍地：</b>${esc(enc.regAddr)}</div>
        <div><b>现住地：</b>${esc(enc.curAddr)}</div><div><b>记录日期：</b>${F.fmt(doc.createdAt, false)}</div><div><b>书写状态：</b>${doc.completedAt ? '已完成' : '书写中'}</div>
      </div>`;
      const fields = Object.entries(draft[doc.id]).map(([k, v]) => fieldBlock(doc.id, k, v)).join('');
      bodyEl.innerHTML = `<div class="emr-sec"><h4>${esc(doc.type)}</h4></div>${fixCard}${head}${fields}
        <div class="emr-status"><span>合规状态：${U.complianceBadge(c)}</span>
        <span>归档状态：${U.archiveBadge(enc.archiveStatus)}</span></div>`;
      // 绑定输入到草稿
      bodyEl.querySelectorAll('textarea[data-doc]').forEach(ta => {
        ta.oninput = () => { draft[ta.dataset.doc][ta.dataset.key] = ta.value; };
      });
    }

    function addProgressNote() {
      const id = F.uid('doc');
      const nd = { resourceType: 'Composition', id, encounter: encId, type: '日常病程记录', status: 'preliminary',
        createdAt: F.NOW(), deadlineAt: new Date(F.NOW().getTime() + 24 * 3600e3), completedAt: null,
        content: { 记录: '' }, required: false };
      F.col('Composition').push(nd); docs.push(nd); draft[id] = { 记录: '' };
      ensure('病程记录').leaves.push({ id, label: `${F.fmt(nd.createdAt, false).slice(5)} 日常`, docId: id, kind: 'doc', type: '日常病程记录' });
      current = id; renderNav(); renderBody();
      U.toast('已新增一条日常病程记录');
    }

    // 提交草稿到真实文档，标记完成，触发自动复核
    function commitDraft() {
      docs.concat(medDoc ? [medDoc] : []).forEach(d => {
        d.content = JSON.parse(JSON.stringify(draft[d.id]));
        // 若必填项均已填，标记完成
        const reqEmpty = Object.entries(d.content).some(([k, v]) => REQUIRED_FIELDS.includes(k) && !String(v || '').trim());
        if (!reqEmpty && !d.completedAt && d.status === 'preliminary') { d.completedAt = F.NOW(); d.status = 'final'; }
      });
      const fixed = B.autoReview(enc);
      F.save();
      return fixed;
    }

    renderNav(); renderBody();
    return { el: wrap, commitDraft, getDraft: () => draft, refresh: () => { renderNav(); renderBody(); } };
  }

  return { build };
})();
window.EMR = EMR;
