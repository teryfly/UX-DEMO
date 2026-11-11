/* ============================================================
   业务逻辑层 —— 时限合规、质控校验、归档流转、统计、通知
   ============================================================ */
const Biz = (() => {
  const F = window.FHIR;
  const NOW = () => F.NOW();
  const WARN_HOURS = 1.5; // 即将超时窗口（与通知配置 leadHours 联动展示）

  // ---------- 文书合规状态 ----------
  // 语义（按 UX-BA 设计文档澄清）：
  //  “正常”  = 文书尚未书写、也未超过时限（倒计时中）
  //  “即将超时” = 文书尚未书写，临近时限
  //  “已超时” = 文书尚未书写，且已超过时限（仍是待处理的活跃问题）
  //  “合规”  = 文书已书写完成，系统自动校验通过——不论完成时是否超过原时限；
  //            若完成时已超过时限，仍标记为“合规”，但通过 overMs 附带标注“但超时Xh”
  // 返回 {code:'ok|soon|over', label, remainMs?, overMs?, done?}
  function docCompliance(doc) {
    if (!doc.deadlineAt) return { code: 'ok', label: doc.completedAt ? '合规' : '正常', remainMs: null, done: !!doc.completedAt };
    const now = NOW().getTime(), dl = doc.deadlineAt.getTime();
    if (doc.completedAt) {
      const late = doc.completedAt.getTime() - dl;
      return { code: 'ok', label: '合规', done: true, overMs: late > 0 ? late : null };
    }
    const remain = dl - now;
    if (remain <= 0) return { code: 'over', label: '已超时', overMs: -remain };
    if (remain <= WARN_HOURS * 3600e3) return { code: 'soon', label: '即将超时', remainMs: remain };
    return { code: 'ok', label: '正常', remainMs: remain };
  }
  function fmtDur(ms) {
    if (ms == null) return '—';
    const m = Math.floor(Math.abs(ms) / 60000);
    const h = Math.floor(m / 60), mm = m % 60;
    return h > 0 ? `${h}h${mm}m` : `${mm}m`;
  }

  // ---------- 取数据（带角色数据范围）----------
  const docsOf = encId => F.col('Composition').filter(d => d.encounter === encId);
  const tasksOf = encId => F.col('Task').filter(t => t.encounter === encId);

  // 患者（Encounter）的时限合规概要
  function encSummary(enc) {
    const docs = docsOf(enc.id);
    let over = 0, soon = 0, ok = 0;
    docs.forEach(d => { const c = docCompliance(d); if (c.code === 'over') over++; else if (c.code === 'soon') soon++; else ok++; });
    return { docs, over, soon, ok, total: docs.length };
  }

  // ---------- 角色可见 Encounter ----------
  function visibleEncounters(user, { scope = 'auto', org = 'all', includeArchived = true } = {}) {
    let list = F.col('Encounter').slice();
    if (user.role === 'clinician') list = list.filter(e => e.doctor === user.id);
    else if (user.role === 'deptHead') list = list.filter(e => e.org === user.org);
    if (org && org !== 'all') list = list.filter(e => e.org === org);
    if (!includeArchived) list = list.filter(e => e.archiveStatus !== 'archived');
    return list;
  }

  // ---------- 角色可见整改任务 ----------
  function visibleTasks(user, { org = 'all' } = {}) {
    let list = F.col('Task').slice();
    if (user.role === 'clinician') list = list.filter(t => t.doctor === user.id);
    else if (user.role === 'deptHead') list = list.filter(t => t.org === user.org);
    if (org && org !== 'all') list = list.filter(t => t.org === org);
    return list;
  }
  const isOverdueTask = t => t.status === '待整改' && new Date(t.dueAt).getTime() < NOW().getTime();

  // ============================================================
  //  质控引擎：对一份病历执行规则校验，返回发现的问题
  // ============================================================
  function runQC(enc, { node = 'all' } = {}) {
    const rules = F.col('PlanDefinition').filter(r => r.status);
    const docs = docsOf(enc.id);
    const found = [];
    docs.forEach(doc => {
      const rule = rules.find(r => r.node.startsWith(doc.type));
      if (!rule) return;
      if (node !== 'all' && !rule.node.startsWith(node)) return;
      // 必填项校验
      if (rule.cond.includes('必填')) {
        Object.entries(doc.content).forEach(([k, v]) => {
          const requiredFields = ['主诉', '现病史', '既往史', '讨论意见', '出院小结', '出院医嘱'];
          if (requiredFields.includes(k) && (!v || !String(v).trim())) {
            found.push({ doc, type: '内容缺失', location: `${doc.type} > ${k}`, field: k,
              desc: `${k}内容为空`, requirement: `请补充${k}内容` });
          }
        });
      }
      // 及时性校验（完成时已超过时限，视为超时问题；docCompliance 的 overMs 专门标注这种"迟交"情形）
      if (rule.cond.includes('小时') || rule.cond.includes('及时')) {
        const c = docCompliance(doc);
        if (c.overMs != null) {
          found.push({ doc, type: '时限超时', location: doc.type, field: null,
            desc: `${doc.type}书写超时`, requirement: '注意书写时限，按时完成各类文书' });
        }
      }
    });
    return found;
  }

  // ============================================================
  //  保存病历后：自动复核整改任务
  //  对该患者所有「待整改」任务，依据当前病历内容判断是否达标
  // ============================================================
  function autoReview(enc) {
    const tasks = tasksOf(enc.id).filter(t => t.status === '待整改');
    const docs = docsOf(enc.id);
    let fixed = 0;
    tasks.forEach(t => {
      // 解析问题定位，找到对应文书字段是否已填写
      const m = (t.location || '').split('>').map(s => s.trim());
      const docType = m[0], field = m[1];
      const doc = docs.find(d => d.type === docType);
      let pass = false;
      if (doc && field && doc.content[field] != null) pass = !!String(doc.content[field]).trim();
      else if (t.problemType === '签字缺失') {
        // 出院记录签字缺失：检查出院诊断/签字字段（demo：内容长度>10 视为已补全）
        pass = doc ? Object.values(doc.content).every(v => String(v || '').trim().length > 3) : false;
      } else pass = true;
      if (pass) {
        t.status = '已完成'; t.fixedAt = NOW().toISOString(); t.reviewPass = true;
        t.reviewNote = '系统自动复核通过，问题已整改';
        t.timeline = (t.timeline || []).concat([
          { at: NOW().toISOString(), tt: '提交整改', by: F.userName(t.doctor) },
          { at: NOW().toISOString(), tt: '自动复核通过', by: '系统' },
        ]);
        fixed++;
      }
    });
    F.save();
    return fixed;
  }

  // ============================================================
  //  提交归档：执行终末质控 → 通过则归档 / 否则拦截并生成整改任务
  //  返回 { ok, blNo?, issues? }
  // ============================================================
  let blCounter = 2088;
  function submitArchive(enc) {
    // 前置：若仍有待整改（环节质控）任务，禁止提交
    const pending = tasksOf(enc.id).filter(t => t.status === '待整改');
    if (pending.length) return { ok: false, blocked: true, reason: '存在未完成的整改任务，无法提交归档' };
    // 必填文书需完成
    const docs = docsOf(enc.id);
    const incomplete = docs.filter(d => d.required && !d.completedAt);
    if (incomplete.length) return { ok: false, blocked: true, reason: `仍有未完成文书：${incomplete.map(d => d.type).join('、')}` };

    enc.submittedAt = NOW();

    // 归档流转记录（Provenance）：同一患者的多次提交累加追加事件，不新建/覆盖，
    // 确保"拦截→整改→重新提交"的完整链路被完整保留（而非只留最后一次的"直通"记录）
    let prov = F.col('Provenance').find(p => p.encounter === enc.id);
    if (!prov) {
      prov = { resourceType: 'Provenance', id: F.uid('prv'), encounter: enc.id, blNo: null,
        events: [{ at: F.fmt(enc.admitAt), tt: '入院', by: '系统' }] };
      F.col('Provenance').push(prov);
    }
    const lastEvt = prov.events[prov.events.length - 1];
    if (lastEvt && lastEvt.tt === '终末质控拦截') {
      prov.events.push({ at: NOW().toISOString(), tt: '医生修改病历', by: F.userName(enc.doctor) });
    }
    prov.events.push({ at: NOW().toISOString(), tt: '提交归档申请', by: F.userName(enc.doctor) });
    prov.events.push({ at: NOW().toISOString(), tt: '进入终末质控', by: '系统' });

    // 执行终末质控
    const issues = runQC(enc);
    if (issues.length) {
      enc.archiveStatus = 'intercepted';
      prov.events.push({ at: NOW().toISOString(), tt: '终末质控拦截', by: '系统', note: issues[0].desc });
      // 生成终末质控整改任务
      issues.forEach(f => {
        const tid = `ZG-0${++blCounter}`;
        F.col('Task').push({
          resourceType: 'Task', id: tid, encounter: enc.id, patientName: enc.patientName,
          doctor: enc.doctor, org: enc.org, issue: null, source: '终末质控',
          problemType: f.type, requirement: f.requirement, location: f.location, status: '待整改',
          createdAt: NOW().toISOString(), dueAt: new Date(NOW().getTime() + 3 * 86400e3).toISOString(),
          fixedAt: null, reviewPass: null, reviewNote: '',
          timeline: [{ at: NOW().toISOString(), tt: '提交归档申请', by: F.userName(enc.doctor) },
                     { at: NOW().toISOString(), tt: '进入终末质控', by: '系统' },
                     { at: NOW().toISOString(), tt: '终末质控拦截', by: '系统', note: f.desc }] });
      });
      // 拦截通知
      F.col('Communication').push({ resourceType: 'Communication', id: F.uid('com'), category: '归档拦截',
        to: enc.doctor, subject: enc.patientName, sentAt: NOW().toISOString(), read: false,
        text: `【归档拦截通知】${enc.patientName}的病历因${issues[0].desc}被系统拦截，请及时处理整改。` });
      F.save();
      return { ok: false, intercepted: true, issues };
    }
    // 通过 → 归档
    const blNo = `BL-${++blCounter}`;
    enc.archiveStatus = 'archived'; enc.blNo = blNo; enc.archivedAt = NOW();
    prov.blNo = blNo;
    prov.events.push({ at: NOW().toISOString(), tt: '终末质控通过', by: '系统' });
    prov.events.push({ at: NOW().toISOString(), tt: '归档完成（已同步至病历归档系统）', by: '系统' });
    F.save();
    return { ok: true, blNo };
  }

  // ============================================================
  //  统计
  // ============================================================
  // 全部「已完成书写」文书的及时率
  function timelinessStats(filter = {}) {
    const encs = F.col('Encounter').filter(e => filter.org && filter.org !== 'all' ? e.org === filter.org : true);
    const rows = [];
    let total = 0, onTime = 0, over = 0;
    encs.forEach(e => {
      docsOf(e.id).forEach(d => {
        if (!d.deadlineAt) return;
        if (filter.docType && filter.docType !== 'all' && d.type !== filter.docType) return;
        const completed = !!d.completedAt;
        const c = docCompliance(d);
        // 统计口径独立于展示文案："已超时"标签只用于尚未完成的文书；
        // 而统计"超时/及时"看的是实际是否踩点完成，已完成但迟交的文书仍计入超时统计
        const isOver = completed ? c.overMs != null : c.code === 'over';
        total++; if (completed && !isOver) onTime++; if (isOver) over++;
        rows.push({ org: e.org, doctor: e.doctor, type: d.type, onTime: completed && !isOver, over: isOver });
      });
    });
    return { total, onTime, over, rate: total ? Math.round(onTime / total * 1000) / 10 : 0, rows };
  }

  // 按科室聚合
  function deptStats() {
    const out = [];
    F.col('Organization').filter(o => o.type === '临床科室').forEach(org => {
      const ts = timelinessStats({ org: org.id });
      const tasks = F.col('Task').filter(t => t.org === org.id);
      const done = tasks.filter(t => t.status === '已完成').length;
      const overdue = tasks.filter(t => isOverdueTask(t)).length;
      const issues = tasks.length;
      out.push({ org: org.id, name: org.name, rate: ts.rate, issues, total: ts.total,
        fixRate: tasks.length ? Math.round(done / tasks.length * 100) : 100, overdue });
    });
    out.sort((a, b) => b.rate - a.rate);
    out.forEach((d, i) => d.rank = i + 1);
    return out;
  }

  // 质控异常类型分布（按科室）
  function issueDistribution(org = 'all') {
    const map = {};
    F.col('Task').filter(t => org === 'all' || t.org === org).forEach(t => {
      map[t.problemType] = (map[t.problemType] || 0) + 1;
    });
    const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
    const colors = { '内容缺失': '#1d6fd6', '格式不规范': '#0ea5a4', '内容不完整': '#f59e0b', '时限超时': '#e2483d', '签字缺失': '#8b5cf6' };
    return Object.entries(map).map(([k, v]) => ({ type: k, count: v, pct: Math.round(v / total * 100), color: colors[k] || '#94a3b8' }))
      .sort((a, b) => b.count - a.count);
  }

  // 趋势（近7日/近月，演示用确定性数据）
  function trendSeries(role, org) {
    const base = role === 'qc' ? [88, 90, 89, 91, 90, 92, 93] : org === 'org-xn' ? [80, 84, 86, 85, 88, 87, 89] : [82, 85, 84, 87, 86, 88, 90];
    const days = ['6/14', '6/15', '6/16', '6/17', '6/18', '6/19', '6/20'];
    return base.map((v, i) => ({ x: days[i], y: v }));
  }
  function monthSeries(org) {
    const map = { 'org-xn': [78, 80, 83, 85, 86, 87], 'org-gk': [85, 88, 90, 91, 92, 92], all: [82, 84, 85, 86, 87, 88] };
    const arr = map[org] || map.all;
    return arr.map((y, i) => ({ x: `${i + 1}月`, y }));
  }
  // 时间范围切换查询：按所选范围返回不同粒度/跨度的趋势数据点（演示用确定性数据）
  function rangeSeries(org, range) {
    const full = monthSeries(org);
    const last = full[full.length - 1].y, prev = full[full.length - 2].y;
    if (range === '上月') return [0, 1, 2, 3].map(i => ({ x: `第${i + 1}周`, y: Math.max(60, prev - 3 + i) }));
    if (range === '近3月') return full.slice(-3);
    if (range === '近6月') return full;
    if (range === '自定义') return full.slice(-3);
    // 默认：本月，按周展开
    return [0, 1, 2, 3].map(i => ({ x: `第${i + 1}周`, y: Math.max(60, last - 4 + i) }));
  }

  // ---------- 首页角色统计 ----------
  function homeStats(user) {
    const role = user.role;
    if (role === 'clinician') {
      const encs = visibleEncounters(user);
      let overWarn = 0;
      encs.forEach(e => { const s = encSummary(e); overWarn += s.over + s.soon; });
      const myTasks = visibleTasks(user).filter(t => t.status === '待整改');
      const intercepted = encs.filter(e => e.archiveStatus === 'intercepted').length;
      const ts = timelinessStats({ org: user.org });
      return [
        { lab: '超时预警数', val: overWarn, trend: '较昨日 +2', cls: overWarn > 0 ? 'danger' : '', ic: '⏰', go: { page: 'time-monitor' } },
        { lab: '待整改任务数', val: myTasks.length, trend: '较昨日 -1', cls: myTasks.length > 0 ? 'warn' : '', ic: '📋', go: { page: 'rectify' } },
        { lab: '归档拦截病历数', val: intercepted, trend: '较昨日 0', cls: intercepted > 0 ? 'warn' : '', ic: '🚫', go: { page: 'rectify' } },
        { lab: '文书书写合规率', val: ts.rate + '%', trend: '较上周 +3%', cls: '', ic: '✅', up: true, go: { page: 'time-monitor' } },
      ];
    }
    if (role === 'deptHead') {
      const tasks = visibleTasks(user);
      const overdue = tasks.filter(isOverdueTask).length;
      const ts = timelinessStats({ org: user.org });
      const issues = tasks.length;
      return [
        { lab: '科室超时未整改数', val: overdue, trend: '较昨日 -1', cls: overdue > 0 ? 'danger' : '', ic: '⏰', go: { page: 'rectify-track' } },
        { lab: '科室书写及时率', val: ts.rate + '%', trend: '较上周 +2%', up: true, ic: '📈', go: { page: 'quality' } },
        { lab: '科室质控异常数', val: issues, trend: '较上周 -2', ic: '⚠️', go: { page: 'rectify-track' } },
      ];
    }
    if (role === 'archivist') {
      const encs = F.col('Encounter');
      const qcing = encs.filter(e => e.archiveStatus === 'archiving').length;
      const intercepted = encs.filter(e => e.archiveStatus === 'intercepted').length;
      const today = encs.filter(e => e.archiveStatus === 'archived' && e.archivedAt && F.fmt(e.archivedAt, false) === F.fmt(NOW(), false)).length;
      return [
        { lab: '待质控病历数', val: qcing, trend: '较昨日 +1', cls: qcing > 0 ? 'warn' : '', ic: '🔍', go: { page: 'archive' } },
        { lab: '归档拦截病历数', val: intercepted, trend: '较昨日 0', cls: intercepted > 0 ? 'warn' : '', ic: '🚫', go: { page: 'archive' } },
        { lab: '今日已归档数', val: today, trend: '较昨日 +3', up: true, ic: '🗄️', go: { page: 'archive' } },
      ];
    }
    if (role === 'qc') {
      const ts = timelinessStats({});
      const tasks = F.col('Task');
      const done = tasks.filter(t => t.status === '已完成').length;
      return [
        { lab: '全院书写及时率', val: ts.rate + '%', trend: '较上周 +1%', up: true, ic: '📈', go: { page: 'timeliness' } },
        { lab: '全院整改完成率', val: Math.round(done / tasks.length * 100) + '%', trend: '较上周 +4%', up: true, ic: '✅', go: { page: 'rectify-track' } },
        { lab: '全院质控异常数', val: tasks.length, trend: '较上周 -3', ic: '⚠️', go: { page: 'quality' } },
      ];
    }
    // admin
    const online = F.col('Practitioner').filter(u => u.active).length;
    const changes = F.col('AuditEvent').filter(a => a.area === '权限' || a.area === '模板').length;
    return [
      { lab: '在线用户数', val: online, trend: '当前在线', ic: '👥', go: { page: 'perm' } },
      { lab: '最近配置变更数', val: changes, trend: '近7日', ic: '🛠️', go: { page: 'perm' } },
    ];
  }

  // ---------- 首页待办 ----------
  // 每条待办的 go 均携带定位参数，点击后直接跳转并定位到对应事项的操作/查看界面
  // （而非仅跳转到二级菜单的列表页）。医疗质量管理部门/管理员角色不展示待办事项模块。
  function homeTodos(user) {
    const role = user.role, list = [];
    if (role === 'clinician') {
      visibleEncounters(user).forEach(e => {
        const s = encSummary(e);
        s.docs.forEach(d => {
          const c = docCompliance(d);
          if (c.code === 'over') list.push({ ic: '⚠️', tt: `[超时预警] ${d.type}-${e.patientName}`, sub: `已超时 ${fmtDur(c.overMs)}`, pri: 0,
            go: { page: 'time-monitor', params: { encId: e.id, mode: 'edit', focusDoc: d.id } } });
          else if (c.code === 'soon') list.push({ ic: '🟠', tt: `[即将超时] ${d.type}-${e.patientName}`, sub: `剩余 ${fmtDur(c.remainMs)}`, pri: 1,
            go: { page: 'time-monitor', params: { encId: e.id, mode: 'edit', focusDoc: d.id } } });
        });
      });
      visibleTasks(user).filter(t => t.status === '待整改').forEach(t =>
        list.push({ ic: '📋', tt: `[待整改] ${t.location.split('>')[0]}-${t.patientName}`, sub: `截止 ${F.mdhm(t.dueAt)} · ${t.source}`, pri: 2,
          go: { page: 'rectify', params: { encId: t.encounter, mode: 'edit' } } }));
      visibleEncounters(user).filter(e => e.archiveStatus === 'intercepted').forEach(e =>
        list.push({ ic: '🚫', tt: `[归档拦截] ${e.patientName}`, sub: '终末质控不通过，需整改', pri: 3,
          go: { page: 'rectify', params: { encId: e.id, mode: 'edit' } } }));
    } else if (role === 'deptHead') {
      visibleTasks(user).filter(isOverdueTask).forEach(t =>
        list.push({ ic: '⏰', tt: `[超时未整改] ${t.patientName}-${t.problemType}`, sub: `责任人 ${F.userName(t.doctor)} · 截止 ${F.mdhm(t.dueAt)}`, pri: 0,
          go: { page: 'rectify-track', params: { encId: t.encounter } } }));
    } else if (role === 'archivist') {
      F.col('Encounter').filter(e => e.archiveStatus === 'archiving').forEach(e =>
        list.push({ ic: '🔍', tt: `[待查看质控结果] ${e.patientName}`, sub: `${F.orgName(e.org)} · 终末质控中`, pri: 0,
          go: { page: 'archive', params: { encId: e.id } } }));
      F.col('Encounter').filter(e => e.archiveStatus === 'intercepted').forEach(e =>
        list.push({ ic: '🚫', tt: `[归档拦截] ${e.patientName}`, sub: '系统已自动生成整改任务', pri: 1,
          go: { page: 'archive', params: { encId: e.id } } }));
    }
    // 注：医疗质量管理部门 / 管理员角色不展示待办事项模块，此处不再生成对应待办数据
    list.sort((a, b) => a.pri - b.pri);
    return list.slice(0, 5);
  }

  return {
    docCompliance, fmtDur, encSummary, docsOf, tasksOf,
    visibleEncounters, visibleTasks, isOverdueTask,
    runQC, autoReview, submitArchive,
    timelinessStats, deptStats, issueDistribution, trendSeries, monthSeries, rangeSeries,
    homeStats, homeTodos, WARN_HOURS,
  };
})();
window.Biz = Biz;
