/* =====================================================================
 * services.js —— 业务服务层（页面对 FHIR 的唯一入口）
 * ---------------------------------------------------------------------
 * 1) 病例索引 Svc.cases()：把 Encounter/Patient/Condition/Task/Appointment/
 *    QuestionnaireResponse/Composition/DocumentReference 关联成一行可渲染、
 *    可筛选、可统计的「病例视图」，并按写操作自动失效重建。
 * 2) 数据权限：所有列表统一经 Svc.inScope() 收口（临床医师/科主任=本科室，
 *    医务部=全院；改进任务额外限定「仅本人负责」）。
 * 3) 业务动作：安排会议、参会确认、催办、书写/提交/签名/归档、上报填写与
 *    三级审核、人工判定、改进执行与效果评估等，全部以 FHIR 资源读写实现，
 *    并写入 Communication(通知) 与 Provenance(留痕)。
 * ===================================================================== */
(function (global) {
  'use strict';

  var F = global.FHIR, D = global.Domain, Limit = global.Limit, Flow = global.Flow, V = global.Vocab, CF = global.CaseFactory;
  var DAY = 86400000, HOUR = 3600000, MIN = 60000;

  function R_(type, id, display) { return { reference: type + '/' + id, display: display }; }
  function rid(ref) { return ref && ref.reference ? ref.reference.split('/')[1] : null; }
  function num(v) { return v == null || v === '' ? null : +v; }
  function now() { return Limit.dt(Date.now()); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  /* 已关闭任务的时限呈现：不再走时，按完成时刻给出按时/超时结论（与时效统计同口径） */
  function closedCd(cd, doneAt) {
    if (!cd || !cd.deadline || !doneAt) return cd;
    var late = doneAt > cd.deadline;
    return Object.assign({}, cd, {
      closed: true, doneAt: doneAt, overdue: false, remainingMs: 0,
      ratio: cd.totalMs ? Math.max(0, (cd.deadline - doneAt) / cd.totalMs) : 1,
      level: late ? 'orange' : 'normal',
      text: late ? '超时完成' : '按时完成'
    });
  }

  /* ═════════ 病例索引 ═════════ */
  var idx = null, idxVer = -1, ver = 0;
  F.subscribe(function () { ver++; idx = null; });

  function buildIndex() {
    var byEnc = {};
    function slot(id) { return byEnc[id] || (byEnc[id] = { improveTasks: [], docs: [] }); }
    // 先建立 Patient → Encounter 映射，供 QR / Composition 关联使用
    var encOfPatient = {};
    F.scan('Encounter').forEach(function (raw) {
      if (raw.subject && raw.subject.reference) encOfPatient[raw.subject.reference.split('/')[1]] = raw.id;
    });

    F.scan('Task').forEach(function (raw) {
      var t = F.decode(raw);
      var encId = rid(t.encounter);
      if (!encId) return;
      var s = slot(encId);
      var kind = t.ext.taskKind || (t.code && t.code.coding[0] ? t.code.coding[0].code : '');
      if (kind === 'discussion') s.discussTask = t;
      else if (kind === 'report') s.reportTask = t;
      else if (kind === 'improvement') s.improveTasks.push(t);
    });
    F.scan('Appointment').forEach(function (raw) {
      var a = F.decode(raw);
      var enc = (a.subject || []).filter(function (x) { return /^Encounter\//.test(x.reference); })[0];
      if (enc) slot(rid(enc)).appt = a;
    });
    F.scan('QuestionnaireResponse').forEach(function (raw) {
      var q = F.decode(raw);
      var pid = rid(q.subject);
      var encId = (q.basedOn || []).length ? findEncOfTask(rid(q.basedOn[0].reference)) : null;
      if (!encId && pid) encId = encOfPatient[pid];
      if (!encId) return;
      var s = slot(encId);
      if (/discussion-record/.test(q.questionnaire || '')) s.qrRecord = q;
      else if (/death-case-report/.test(q.questionnaire || '')) s.reportQr = q;
    });
    F.scan('Composition').forEach(function (raw) {
      var c = F.decode(raw);
      var pid = rid(c.subject);
      var encId = pid ? encOfPatient[pid] : null;
      if (encId) slot(encId).comp = c;
    });
    F.scan('DocumentReference').forEach(function (raw) {
      var d = F.decode(raw);
      var encs = (d.context && d.context.encounter) || [];
      var encId = encs.length ? rid(encs[0]) : (rid(d.subject) ? encOfPatient[rid(d.subject)] : null);
      if (encId) slot(encId).docs.push(d);
    });
    F.scan('Observation').forEach(function (raw) {
      var o = F.decode(raw);
      var encId = rid(o.encounter);
      if (!encId) return;
      var s = slot(encId);
      var code = o.code.coding[0].code;
      if (code === 'dx-concordance') s.concordance = o.valueCodeableConcept && o.valueCodeableConcept.coding[0] ? o.valueCodeableConcept.coding[0].code : null;
      if (code === 'severity-score') s.severityScore = o.valueQuantity ? o.valueQuantity.value : null;
    });
    F.scan('Condition').forEach(function (raw) {
      var c = F.decode(raw);
      var encId = rid(c.encounter);
      if (!encId) return;
      var s = slot(encId);
      var cat = c.ext.catCode;
      var code = c.code.coding[0] ? c.code.coding[0].code : '';
      var text = c.code.text || '';
      if (cat === 'admission' && !s.admitDx) { s.admitDx = text; s.admitIcd = code; }
      if (cat === 'death-main') { s.deathDx = text; s.deathIcd = code; s.severity = c.severity && c.severity.coding[0] ? c.severity.coding[0].code : null; }
      if (cat === 'death-secondary' && !s.secondaryDx) s.secondaryDx = text;
    });
    F.scan('Procedure').forEach(function (raw) {
      var p = F.decode(raw);
      var encId = rid(p.encounter);
      if (!encId) return;
      var s = slot(encId);
      s.hasSurgery = true;
      s.surgeryName = p.code ? p.code.text : '手术';
      if (p.performedDateTime) s.surgeryMs = Limit.parse(p.performedDateTime);
    });
    // 主装配
    var list = [];
    F.scan('Encounter').forEach(function (raw) {
      var e = F.decode(raw);
      var s = byEnc[e.id] || { improveTasks: [], docs: [] };
      var p = F.view('Patient', rid(e.subject)) || { name: [{ text: '—' }], identifier: [] };
      var deathMs = Limit.parse(e.period && e.period.end);
      var admitMs = Limit.parse(e.period && e.period.start);
      var discuss = s.discussTask, report = s.reportTask;
      var c = {
        encId: e.id, patientId: p.id, name: p.name[0].text, mrn: e.ext.caseNo || (p.identifier[0] ? p.identifier[0].value : ''),
        gender: p.gender === 'male' ? '男' : '女', age: p.ext.ageYears,
        deptId: rid(e.serviceProvider), deptIdx: parseInt((rid(e.serviceProvider) || 'Organization-0000').split('-')[1], 10),
        deptName: e.serviceProvider ? e.serviceProvider.display : '',
        admitMs: admitMs, deathMs: deathMs, deathTimeMs: deathMs, losDays: Math.max(1, Math.round((deathMs - admitMs) / DAY)),
        deathType: e.ext.deathType, deathPlace: e.ext.deathPlace, autoClassified: e.ext.autoClassified, classifyRuleId: e.ext.classifyRuleId,
        attendingId: rid((e.participant[0] || {}).individual), attending: e.ext.attendingName,
        priority: discuss ? discuss.priority : 'normal',
        discussTask: discuss, reportTask: report, appt: s.appt, qrRecord: s.qrRecord, reportQr: s.reportQr, comp: s.comp,
        docs: s.docs, improveTasks: s.improveTasks,
        admitDx: s.admitDx, deathDx: s.deathDx, secondaryDx: s.secondaryDx, deathIcd: s.deathIcd, admitIcd: s.admitIcd,
        severity: s.severity, severityScore: s.severityScore, concordance: s.concordance,
        hasSurgery: !!s.hasSurgery, surgeryName: s.surgeryName,
        daysSinceSurgery: s.surgeryMs && deathMs ? Math.round((deathMs - s.surgeryMs) / DAY) : null,
        avoidable: avoidableOf(s),
        terminal: p.ext.signedWaiver
      };
      c.priority = c.priority || 'normal';
      c.discussStatus = Flow.discussStatusOf({
        task: discuss, appt: c.appt, qr: c.qrRecord, comp: c.comp,
        requiredSigners: requiredSigners(c)
      });
      c.discussCountdown = Limit.countdownOf('discussion', c);
      c.reportStatus = c.reportTask ? (c.reportTask.ext && c.reportTask.ext.approvalFlow
        ? (c.reportTask.businessStatus && c.reportTask.businessStatus.coding[0] ? c.reportTask.businessStatus.coding[0].code : Flow.reportStatusOf(c.reportQr, c.reportTask.ext.approvalFlow))
        : 'to-fill') : 'to-fill';
      c.reportCountdown = Limit.countdownOf('report', c);
      c.discussActualMs = discuss && discuss.executionPeriod && discuss.executionPeriod.end ? Limit.parse(discuss.executionPeriod.end) : null;
      c.reportActualMs = report && report.completedDate ? Limit.parse(report.completedDate) : null;
      c.meetingMs = c.appt && c.appt.start ? Limit.parse(c.appt.start) : null;
      c.archivedAtMs = c.comp && c.comp.ext.archivedAt ? Limit.parse(c.comp.ext.archivedAt) : null;
      /* 任务关闭后倒计时停止走时，改为呈现「按时/超时完成」结果（与时效统计同口径） */
      if (c.discussStatus === 'archived') c.discussCountdown = closedCd(c.discussCountdown, c.discussActualMs || c.archivedAtMs);
      if (c.reportStatus === 'done') c.reportCountdown = closedCd(c.reportCountdown, c.reportActualMs);
      list.push(c);
    });
    // 修正依赖 QR/Composition 的关联（第二遍：basedOn → Task → encounter）
    list.forEach(function (c) {
      if (!c.comp && c.qrRecord && c.qrRecord.basedOn && c.qrRecord.basedOn[0]) {
        var comp = F.scan('Composition').filter(function (raw) {
          var cm = F.decode(raw);
          return cm.subject && rid(cm.subject) === c.patientId && cm.status === 'final';
        })[0];
        if (comp) c.comp = F.decode(comp);
      }
      if (!c.reportQr && c.reportTask && c.reportTask.focus) {
        var q = F.view('QuestionnaireResponse', rid(c.reportTask.focus));
        if (q) c.reportQr = q;
      }
      var flow = c.reportTask && c.reportTask.ext ? c.reportTask.ext.approvalFlow : null;
      if (flow) {
        c.reportFlow = flow;
        c.reportStatus = c.reportTask.businessStatus && c.reportTask.businessStatus.coding[0]
          ? c.reportTask.businessStatus.coding[0].code : Flow.reportStatusOf(c.reportQr, flow);
      } else c.reportFlow = [];
      c.returnReason = c.reportTask && c.reportTask.ext ? c.reportTask.ext.returnReason : null;
    });
    list.sort(function (a, b) { return b.deathMs - a.deathMs; });
    return { list: list, byId: (function () { var m = {}; list.forEach(function (c) { m[c.encId] = c; }); return m; })() };
  }
  function findEncOfTask(taskId) {
    if (!taskId) return null;
    var t = F.view('Task', taskId);
    return t ? rid(t.encounter) : null;
  }
  function avoidableOf(s) {
    if (s.reportQr) {
      var v = flatAnswers(s.reportQr)['r5.avoidable'];
      if (v) return v === 'avoidable' || v === '可避免' ? 'avoidable' : (v === 'partly' ? 'partly' : 'unavoidable');
    }
    if (s.qrRecord) {
      var w = flatAnswers(s.qrRecord)['m4.avoidable'];
      if (w) return w;
    }
    return null;
  }
  function index() {
    if (idxVer !== ver || !idx) { idx = buildIndex(); idxVer = ver; }
    return idx;
  }

  /* ═════════ 基础查询 ═════════ */
  function cases(filter) {
    var list = index().list;
    return filter ? list.filter(filter) : list.slice();
  }
  function caseOf(encId) { return index().byId[encId] || null; }

  /* 数据权限（IA-3.3 数据权限规则 + 角色权限管理页可配置） */
  function scopeOf(user) {
    var perms = F.view('Basic', 'Basic-role-permissions');
    var nav = user.navRole;
    if (perms && perms.ext && perms.ext.scopes && perms.ext.scopes[nav]) return perms.ext.scopes[nav];
    return nav === 'quality' ? 'hospital' : 'dept';
  }
  function inScope(user, c) {
    var scope = scopeOf(user);
    if (scope === 'hospital') return true;
    if (scope === 'self') return c.attending === user.name;
    return c.deptName === user.dept;
  }
  function inScopeTask(user, t) {
    var scope = scopeOf(user);
    if (scope === 'hospital') return true;
    var owner = t.owner ? t.owner.display : '';
    if (user.name === owner) return true;
    if (scope === 'self') return false;
    var enc = t.encounter ? caseOf(rid(t.encounter)) : null;
    return enc ? enc.deptName === user.dept : true;
  }

  /* ═════════ 讨论管理（L2-1） ═════════ */
  function discussList(user, q) {
    q = q || {};
    var list = cases(function (c) { return c.discussTask && inScope(user, c); });
    if (q.status && q.status !== 'all') list = list.filter(function (c) { return c.discussStatus === q.status; });
    if (q.deathType && q.deathType !== 'all') list = list.filter(function (c) { return c.deathType === q.deathType; });
    if (q.priority && q.priority !== 'all') list = list.filter(function (c) { return c.priority === q.priority; });
    if (q.dept && q.dept !== 'all') list = list.filter(function (c) { return c.deptName === q.dept; });
    if (q.from) list = list.filter(function (c) { return c.deathMs >= Date.parse(q.from); });
    if (q.to) list = list.filter(function (c) { return c.deathMs <= Date.parse(q.to) + DAY - 1; });
    if (q.keyword) {
      var k = String(q.keyword).toLowerCase();
      list = list.filter(function (c) { return (c.name || '').toLowerCase().indexOf(k) >= 0 || (c.mrn || '').toLowerCase().indexOf(k) >= 0; });
    }
    return sortList(list, q.sort || 'death-desc');
  }
  function sortList(list, key) {
    var by = {
      'death-desc': function (a, b) { return b.deathMs - a.deathMs; },
      'death-asc': function (a, b) { return a.deathMs - b.deathMs; },
      'countdown': function (a, b) { return (a.discussCountdown.remainingMs - b.discussCountdown.remainingMs); },
      'report-countdown': function (a, b) { return (a.reportCountdown.remainingMs - b.reportCountdown.remainingMs); },
      'priority': function (a, b) { return rank(a.priority) - rank(b.priority); },
      'status': function (a, b) { return String(a.discussStatus).localeCompare(String(b.discussStatus)); },
      'submit-desc': function (a, b) { return (b.reportSubmitMs || 0) - (a.reportSubmitMs || 0); },
      'due-asc': function (a, b) { return (Limit.parse(a.dueMs) || 0) - (Limit.parse(b.dueMs) || 0); }
    }[key] || function (a, b) { return b.deathMs - a.deathMs; };
    var rankP = function (x) { return { '⚡高': 0, high: 0, medium: 1, '中': 1, normal: 2, '普通': 2 }[x.priority] == null ? 3 : { high: 0, medium: 1, normal: 2 }[x.priority]; };
    // IX-1.6：高优先级 + 已超时任务始终排在最前
    return list.slice().sort(function (a, b) {
      var pa = (a.priority === 'high' ? 0 : 1) + (a.discussCountdown && a.discussCountdown.overdue ? 0 : 1);
      var pb = (b.priority === 'high' ? 0 : 1) + (b.discussCountdown && b.discussCountdown.overdue ? 0 : 1);
      if (pa !== pb) return pa - pb;
      return by(a, b);
    });
    function rank(p) { return { high: 0, medium: 1, normal: 2 }[p] == null ? 3 : { high: 0, medium: 1, normal: 2 }[p]; }
  }
  function discussStatusCounts(user) {
    var list = cases(function (c) { return c.discussTask && inScope(user, c); });
    var out = { all: list.length };
    D.DISCUSS_STATUS.forEach(function (s) { out[s.code] = 0; });
    list.forEach(function (c) { out[c.discussStatus] = (out[c.discussStatus] || 0) + 1; });
    return out;
  }

  /* 讨论任务详情（L3-1-2） */
  function discussDetail(encId) {
    var c = caseOf(encId);
    if (!c) return null;
    var appt = c.appt;
    var meta = appt && appt.ext ? appt.ext.partyMeta : null;
    var parties = [];
    if (appt) {
      var pm = (appt.ext.partyMeta || []);
      parties = pm.map(function (m) {
        var native = (appt.participant || []).filter(function (x) { return rid(x.actor) === m.pid; })[0] || {};
        return {
          pid: m.pid, name: m.name, role: m.role, dept: m.dept,
          status: Flow.attendStatusOf({ status: native.status }, appt, Date.now()),
          rawStatus: native.status, required: x_required(native), leaveReason: m.leaveReason || ''
        };
      });
    }
    var signers = signaturePanel(c);
    var docs = (c.docs || []).map(function (d) {
      return {
        id: d.id, type: d.ext.docType, name: d.ext.docTitle || V.cc('doc-type', d.ext.docType).text,
        source: d.ext.sourceType === 'manual' ? '手动上传（' + (d.ext.uploadedBy || '') + '）' : (d.custodian ? d.custodian.display : 'EMR'),
        date: Limit.dt(Limit.parse(d.date)), error: !!d.ext.fetchError, period: d.ext.periodText,
        content: docText(d)
      };
    });
    return {
      c: c, appt: appt, meeting: appt ? appt.ext.meeting : null, parties: parties,
      partySummary: summarizeParties(parties),
      steps: Flow.stepBar({
        task: c.discussTask, appt: appt, qr: c.qrRecord, comp: c.comp,
        requiredSigners: signers.required.filter(function (r) { return r.required; }).map(function (r) { return r.pid; })
      }),
      signers: signers, docs: docs,
      chartState: Flow.chartStateOf(docs.map(function (d) { return { docType: d.type, fetchError: d.error, sourceType: d.source }; })),
      recordStatus: Flow.recordStatusOf(c.qrRecord, c.comp),
      progress: moduleProgress(c.qrRecord, 'record')
    };
  }
  function x_required(native) { return native.required === 'required'; }
  function summarizeParties(parties) {
    var out = { accepted: 0, needs: 0, leave: 0, absent: 0, total: parties.length };
    parties.forEach(function (p) {
      if (p.status === 'accepted') out.accepted++;
      else if (p.status === 'declared-leave') out.leave++;
      else if (p.status === 'absent') out.absent++;
      else out.needs++;
    });
    return out;
  }
  function requiredSigners(c) {
    if (!c.appt) return [];
    var roles = ['director', 'attending', 'senior'];
    return (c.appt.ext.partyMeta || []).filter(function (m) { return roles.indexOf(sceneOfPid(m.pid)) >= 0; });
  }
  function sceneOfPid(pid) {
    var pr = F.view('PractitionerRole', pid.replace('Practitioner-', 'PractitionerRole-'));
    return pr && pr.ext.scenes ? pr.ext.scenes[0] : 'doctor';
  }
  function signaturePanel(c) {
    var comp = c.comp;
    var attesters = {};
    ((comp && comp.attester) || []).forEach(function (a) {
      attesters[rid(a.party)] = { time: Limit.dt(Limit.parse(a.time)), mode: a.mode };
    });
    var req = [], opt = [];
    var seen = {};
    (c.appt ? (c.appt.ext.partyMeta || []) : []).forEach(function (m) {
      var scene = sceneOfPid(m.pid);
      var signed = attesters[m.pid];
      var row = {
        pid: m.pid, name: m.name, role: m.role || D.sceneName(scene), scene: scene,
        signed: !!signed, time: signed ? signed.time : null,
        mode: signed ? signed.mode : null,
        onLeave: m.status === 'declared-leave'
      };
      // 必签人员（US-1.4 AC3）：科主任（主持人）+ 主管医师 + 上级医师，各一位；
      // 其余参会人员为可选签名；已请假人员不纳入签名范围（US-1.4 备注）。
      var need = null;
      if (row.onLeave) need = null;
      else if (scene === 'director' && !seen.director) need = 'director';
      else if ((m.pid === c.attendingId || scene === 'attending') && !seen.attending) need = 'attending';
      else if (scene === 'senior' && !seen.senior) need = 'senior';
      if (need) { seen[need] = 1; req.push(row); } else opt.push(row);
    });
    if (!req.length && c.qrRecord) {
      req = [
        { name: (c.qrRecord.ext.draftMeta || {}).scribe || c.attending, role: '主管医师' },
        { name: (c.qrRecord.ext.draftMeta || {}).moderator || '科主任', role: '科主任 / 主持人' },
        { name: '上级医师', role: '上级医师' }
      ].map(function (r, i) {
        var a = ((comp && comp.attester) || [])[i];
        return { name: a && a.party ? a.party.display : r.name, role: r.role, signed: !!a, time: a ? Limit.dt(Limit.parse(a.time)) : null, pid: a ? rid(a.party) : null };
      });
    }
    return {
      required: req, optional: opt,
      signedRequired: req.filter(function (r) { return r.signed; }).length,
      totalRequired: req.length,
      signedOptional: opt.filter(function (r) { return r.signed; }).length,
      totalOptional: opt.filter(function (r) { return !r.onLeave; }).length
    };
  }
  function docText(d) {
    var att = (d.content && d.content[0]) ? d.content[0].attachment : null;
    if (!att || !att.data) return '';
    try {
      var g = (typeof window !== 'undefined' ? window : global);
      var s = g.atob ? g.atob(att.data) : Buffer.from(att.data, 'base64').toString('binary');
      return decodeURIComponent(escape(s));
    } catch (e) { return ''; }
  }

  /* 模板驱动的表单渲染与校验 */
  function template(kind) {
    var list = F.scan('Questionnaire').filter(function (raw) {
      var e = F.decode(raw);
      return e.status === 'active' && e.ext.templateKind === kind;
    });
    if (!list.length) return null;
    return F.decode(list[0]);
  }
  function flatAnswers(qr) {
    var out = {};
    if (!qr) return out;
    function walk(items) {
      (items || []).forEach(function (it) {
        if (!it.item || !it.item.length) { out[it.linkId] = val(it); return; }
        var rows = it.item.every(function (x) { return x.item && !x.linkId; });
        if (rows) {
          out[it.linkId] = it.item.map(function (row) {
            var m = {};
            (row.item || []).forEach(function (l) { m[l.linkId] = val(l); });
            return m;
          });
        } else walk(it.item);
      });
    }
    function isLeaf(it) { return !!(it.valueString != null || it.valueCoding || it.valueReference || it.valueBoolean != null || it.valueInteger != null); }
    function repeatingRows(list) { return list.length > 0 && list.every(function (x) { return !x.linkId && x.item; }); }
    function val(leaf) {
      if (leaf.valueString != null) return leaf.valueString;
      if (leaf.valueCoding) return leaf.valueCoding.display || leaf.valueCoding.code;
      if (leaf.valueReference) return leaf.valueReference.display;
      if (leaf.valueBoolean != null) return leaf.valueBoolean;
      if (leaf.value != null && typeof leaf.value === 'object') {
        if (leaf.value.valueString != null) return leaf.value.valueString;
        if (leaf.value.valueCoding) return leaf.value.valueCoding.display || leaf.value.valueCoding.code;
        if (leaf.value.valueReference) return leaf.value.valueReference.display;
      }
      return '';
    }
    walk(qr.item);
    return out;
  }
  /* 返回 {ok, missing:[{moduleId,module,label,id}], filled:n, total:n} */
  function validateAnswers(kind, answers) {
    var q = template(kind);
    if (!q) return { ok: true, missing: [], filled: 0, total: 0 };
    var missing = [], filled = 0, total = 0, groups = [];
    (q.item || []).forEach(function (m) {
      var moduleFilled = 0, moduleTotal = 0;
      (m.item || []).forEach(function (fd) {
        var required = fd.required;
        if (fd.linkId === 'm5.deficiencyNote' && answers['m5.deficiency'] !== '是') required = false;
        if (fd.type === 'group') {
          var rows = answers[fd.linkId] || [];
          total++; moduleTotal++;
          var rowsOk = rows.length > 0 && rows.every(function (r) {
            return (fd.item || []).filter(function (c) { return c.required; }).every(function (c) { return nonEmpty(r[c.linkId]); });
          });
          if (rowsOk) moduleFilled++; else missing.push({ moduleId: m.linkId, module: m.text, label: fd.text, id: fd.linkId });
          return;
        }
        if (!required) {
          if (nonEmpty(answers[fd.linkId])) { filled++; total++; moduleFilled++; moduleTotal++; }
          return;
        }
        total++; moduleTotal++;
        var v = answers[fd.linkId];
        var min = minLen(fd);
        if (!nonEmpty(v) || (min && String(v).length < min)) missing.push({ moduleId: m.linkId, module: m.text, label: fd.text, id: fd.linkId, min: min, value: v });
        else { filled++; moduleFilled++; }
      });
      groups.push({ id: m.linkId, title: m.text, filled: moduleFilled, total: moduleTotal, done: moduleFilled === moduleTotal });
    });
    return { ok: !missing.length, missing: missing, filled: filled, total: total, groups: groups };
  }
  function minLen(fd) {
    var e = (fd.extension || []).filter(function (x) { return /minLength$/.test(x.url); })[0];
    return e ? e.valueInteger : null;
  }
  function nonEmpty(v) { return v !== undefined && v !== null && String(v).trim() !== ''; }
  function moduleProgress(qr, kind) {
    var q = template(kind);
    if (!q) return { filled: 0, total: 0, pct: 0, groups: [] };
    var ans = flatAnswers(qr);
    var r = validateAnswers(kind, ans);
    return { filled: r.filled, total: r.total, pct: r.total ? Math.round(r.filled / r.total * 100) : 0, groups: r.groups, missing: r.missing };
  }

  /* 讨论记录书写页所需：把答案按模块整理成可编辑结构 */
  function recordView(encId, user) {
    var d = discussDetail(encId);
    if (!d) return null;
    var c = d.c;
    var qr = c.qrRecord;
    var answers = flatAnswers(qr);
    var meta = (qr && qr.ext.draftMeta) || {};
    return {
      d: d, c: c, qr: qr, answers: answers, meta: meta,
      status: d.recordStatus, lock: Flow.lockLevelOf(d.recordStatus),
      progress: moduleProgress(qr, 'record'),
      template: template('record')
    };
  }
  function saveRecord(encId, answers, user, mode) {
    var c = caseOf(encId);
    var items = answersToItems('record', answers);
    var body = {
      resourceType: 'QuestionnaireResponse',
      questionnaire: 'https://fhir.swbl-demo.example/Questionnaire/death-case-discussion-record',
      status: mode === 'submit' ? 'submitted' : 'draft',
      subject: R_('Patient', c.patientId, c.name),
      author: R_('Practitioner', pidOfUser(user), user.name),
      source: R_('Practitioner', pidOfUser(user), user.name),
      basedOn: [{ reference: 'Task/' + c.discussTask.id }],
      authored: new Date().toISOString(),
      item: items,
      ext: {
        draftMeta: {
          savedAt: now(), autoSavedAt: now(),
          submittedAt: mode === 'submit' ? now() : null,
          discussDate: (c.appt && c.appt.ext.meeting ? fmtOf(Limit.parse(c.appt.start)) : fmtOf(c.deathMs)),
          location: c.appt ? c.appt.ext.meeting.location : '示教室',
          moderator: c.appt ? nameOfScene(c, 'director') : '科主任',
          scribe: user.name
        },
        respondentName: user.name
      }
    };
    var qr = c.qrRecord ? F.update(Object.assign({}, c.qrRecord, body, { id: c.qrRecord.id })) : F.create(body);
    if (mode === 'submit') {
      prov('submit-record', c, user, '提交讨论记录，进入签名流程');
      notifyScene('task-created', c, { 任务名称: '讨论记录 CA 电子签名' }, ['director', 'senior', 'attending', 'doctor']);
    } else {
      notifyScene(null, c, {}, [], '草稿已保存');
    }
    return qr;
  }
  function fmtOf(ms) { return ms == null ? '' : Limit.donly(ms); }
  function nameOfScene(c, scene) {
    var pm = c.appt && c.appt.ext ? (c.appt.ext.partyMeta || []) : [];
    for (var i = 0; i < pm.length; i++) if (sceneOfPid(pm[i].pid) === scene) return pm[i].name;
    return scene === 'director' ? '科主任' : user_();
    function user_() { return c.attending; }
  }
  function answersToItems(kind, answers) {
    var q = template(kind), items = [];
    (q.item || []).forEach(function (m) {
      var children = [];
      (m.item || []).forEach(function (fd) {
        if (fd.type === 'group') {
          var rows = answers[fd.linkId] || [];
          children.push({
            linkId: fd.linkId, text: fd.text, type: 'group', repeats: true,
            item: rows.map(function (row) {
              return { item: (fd.item || []).map(function (c) { return Object.assign({ linkId: c.linkId, text: c.text }, valueOfField(c.type, row[c.linkId])); }) };
            })
          });
          return;
        }
        children.push(Object.assign({ linkId: fd.linkId, text: fd.text }, valueOfField(fd.type, answers[fd.linkId])));
      });
      items.push({ linkId: m.linkId, text: m.text, type: 'group', item: children });
    });
    return items;
  }
  function valueOfField(type, v) {
    if (v == null) v = '';
    if (type === 'choice') {
      var list = V.Vocab;
      return { valueCoding: { code: String(v), display: String(v) }, text: String(v) };
    }
    if (type === 'reference') return { valueReference: { display: String(v) } };
    if (type === 'boolean') return { valueBoolean: v === true || v === '是' };
    return { valueString: String(v) };
  }

  /* CA 签名与归档 */
  function signRecord(encId, user) {
    var c = caseOf(encId);
    if (!c.qrRecord || c.qrRecord.status === 'draft') return { ok: false, msg: '讨论记录尚未提交，无法签名' };
    var pid = pidOfUser(user);
    var comp = c.comp;
    var base = comp || {
      resourceType: 'Composition', status: 'preliminary',
      type: { coding: [{ system: 'http://loinc.org', code: '34117-4', display: '死亡病例讨论记录' }], text: '死亡病例讨论记录' },
      subject: R_('Patient', c.patientId, c.name), date: new Date().toISOString(),
      author: [R_('Practitioner', pid, user.name)],
      title: c.name + ' 死亡病例讨论记录',
      custodian: R_('Organization', c.deptId, c.deptName),
      attester: [],
      section: [],
      ext: { archiveMeta: { archivedAt: null, emrSync: 'pending', eventPublished: false }, recordNo: 'DIS' + new Date().getFullYear() + String(c.seq || 1) }
    };
    if ((base.attester || []).some(function (a) { return rid(a.party) === pid; })) return { ok: false, msg: '您已完成签名' };
    var scene = user.scene;
    var mode = scene === 'director' ? 'official' : (scene === 'doctor' ? 'personal' : 'legal');
    base.attester = (base.attester || []).concat([{ mode: mode, time: new Date().toISOString(), party: R_('Practitioner', pid, user.name) }]);
    if (!base.id) { comp = F.create(base); } else { comp = F.update(base); }
    var panel = signaturePanel(Object.assign({}, c, { comp: comp }));
    prov('sign', c, user, '完成 CA 数字签名（' + D.sceneName(scene) + '）');
    return {
      ok: true, comp: comp, panel: panel,
      allSigned: panel.signedRequired >= panel.totalRequired && panel.totalRequired > 0
    };
  }
  function archiveRecord(encId, user) {
    var c = caseOf(encId);
    var panel = signaturePanel(c);
    if (panel.totalRequired && panel.signedRequired < panel.totalRequired) {
      return { ok: false, msg: '必签人员尚未全部完成签名（' + panel.signedRequired + '/' + panel.totalRequired + '）' };
    }
    var comp = c.comp;
    var archivedAt = new Date().toISOString();
    comp = F.update(Object.assign({}, comp, {
      status: 'final',
      ext: { archiveMeta: { archivedAt: archivedAt, emrSync: 'success', eventPublished: true }, archivedAt: archivedAt, recordNo: comp.ext.recordNo }
    }));
    // 讨论任务收口
    var t = c.discussTask;
    F.update(Object.assign({}, t, {
      status: 'completed',
      businessStatus: { coding: [{ system: V.SYS + 'business-status', code: 'archived', display: '已完成' }], text: '已完成' },
      executionPeriod: { start: new Date(c.deathMs).toISOString(), end: archivedAt },
      focus: R_('Composition', comp.id, '讨论记录'),
      lastModified: archivedAt
    }));
    // 归档文档
    F.create({
      resourceType: 'DocumentReference', status: 'current', docStatus: 'final',
      type: { coding: [{ system: V.SYS + 'doc-type', code: 'death', display: '死亡记录' }], text: '死亡病例讨论记录（归档）' },
      subject: R_('Patient', c.patientId, c.name), date: archivedAt,
      author: [R_('Practitioner', pidOfUser(user), user.name)],
      description: '死亡病例讨论记录归档至 EMR：' + (comp.ext.recordNo || comp.id),
      context: { encounter: [R_('Encounter', c.encId)] },
      content: [{ attachment: { contentType: 'text/plain;charset=utf-8', data: '', title: comp.ext.recordNo } }],
      ext: { docType: 'archive', docTitle: '死亡病例讨论记录', sourceType: 'emr', periodText: Limit.donly(Date.now()) }
    });
    // 模块⑧ → 改进任务
    var rows = (flatAnswers(c.qrRecord)['m8.measures'] || []);
    var created = [];
    rows.forEach(function (row, i) {
      var ownerName = row['m8.owner'] || c.attending;
      var p = findPerson(ownerName, c.deptIdx);
      var due = Limit.parse(row['m8.due']) || (Date.now() + 30 * DAY);
      var nt = {
        resourceType: 'Task',
        identifier: [{ system: 'urn:swbl:task-no', value: 'IM' + new Date().getFullYear() + String(Date.now()).slice(-5) + i }],
        status: 'requested',
        businessStatus: { coding: [{ system: V.SYS + 'business-status', code: 'not-started', display: '未开始' }], text: '未开始' },
        intent: 'plan', priority: t.priority,
        code: { coding: [{ system: V.SYS + 'task-kind', code: 'improvement', display: '改进措施跟踪任务' }], text: '改进措施执行跟踪' },
        description: row['m8.content'],
        for: R_('Patient', c.patientId, c.name), encounter: R_('Encounter', c.encId),
        owner: R_('Practitioner', p.pid, p.name),
        requestedPerformer: { reference: 'PractitionerRole/' + p.role, display: p.name },
        partOf: [{ reference: 'Task/' + t.id }],
        basedOn: [{ reference: 'Composition/' + comp.id, display: '来源讨论记录' }],
        authoredOn: archivedAt, lastModified: archivedAt, dueDate: new Date(due).toISOString(),
        definition: { reference: 'QuestionnaireResponse/' + c.qrRecord.id, display: '讨论记录模块⑧' },
        note: [{ authorReference: { display: '系统' }, time: archivedAt, text: '由讨论记录模块⑧自动提取，待科主任确认任务内容与责任人' }],
        ext: {
          taskKind: 'improvement', measureText: row['m8.content'], expectedEffect: row['m8.expected'],
          pdca: { round: 1, root: null, createdBy: '系统自动提取（讨论记录模块⑧）', confirmedBy: user.name },
          sourceRecordId: comp.id
        }
      };
      created.push(F.create(nt).id);
    });
    prov('archive', c, user, '讨论记录归档至 EMR，发布「死亡病例讨论完成」事件，自动提取 ' + created.length + ' 条改进措施生成跟踪任务');
    notifyScene('eval-result', c, { 措施摘要: '讨论记录已归档', 评估结论: '已归档' }, ['director', 'attending', 'doctor', 'quality']);
    if (created.length) {
      notifyScene('improve-remind', c, { 措施摘要: (rows[0]['m8.content'] || '').slice(0, 18), 完成时限: Limit.donly(Limit.parse(rows[0]['m8.due']) || Date.now()), 剩余天数: '' }, ['attending', 'doctor', 'senior']);
    }
    return { ok: true, comp: comp, created: created };
  }
  function findPerson(name, deptIdx) {
    var list = CF.STAFF[deptIdx] || {};
    var all = [].concat(list.attending || [], list.senior || [], list.director || [], list.doctor || []);
    for (var i = 0; i < all.length; i++) if (all[i].name === name) return all[i];
    return all[0] || { pid: 'Practitioner-0011', name: name, role: 'PractitionerRole-0011' };
  }
  function pidOfUser(user) { return user.practitioner; }

  /* ═════════ 会议 / 参会 / 病历 ═════════ */
  function arrangeMeeting(encId, form, user) {
    var c = caseOf(encId);
    var startMs = Date.parse(form.date + 'T' + (form.time || '15:00'));
    var parties = [];
    var g = CF.STAFF[c.deptIdx] || {};
    parties.push({ pid: (g.director[0] || {}).pid, name: (g.director[0] || {}).name || user.name, role: '科主任', status: 'accepted', leaveReason: '' });
    parties.push({ pid: c.attendingId, name: c.attending, role: '主管医师', status: 'needs-action', leaveReason: '' });
    (g.senior || []).slice(0, 1).forEach(function (p) { parties.push({ pid: p.pid, name: p.name, role: '上级医师', status: 'needs-action', leaveReason: '' }); });
    (g.attending || []).slice(1, 3).forEach(function (p) { parties.push({ pid: p.pid, name: p.name, role: '科室医师', status: 'needs-action', leaveReason: '' }); });
    (g.doctor || []).slice(0, 1).forEach(function (p) { parties.push({ pid: p.pid, name: p.name, role: '科室医师', status: 'needs-action', leaveReason: '' }); });
    var body = {
      resourceType: 'Appointment', status: 'booked', intent: 'book',
      priority: c.priority === 'high' ? 1 : 3,
      description: form.title,
      subject: [R_('Patient', c.patientId, c.name), R_('Encounter', c.encId)],
      start: new Date(startMs).toISOString(), end: new Date(startMs + 90 * MIN).toISOString(),
      participant: parties.map(function (x) {
        return { actor: R_('Practitioner', x.pid, x.name), required: x.role === '科主任' || x.role === '主管医师' ? 'required' : 'optional', status: x.status };
      }),
      authorship: R_('Practitioner', pidOfUser(user), user.name),
      instruction: '请参会人员提前调阅病历资料，主管医师准备病例汇报。',
      ext: {
        meeting: { title: form.title, location: form.location, preparedBy: c.attending, dept: c.deptName, savedAt: new Date().toISOString(), notifiedAt: new Date().toISOString() },
        partyMeta: parties, notifyChannels: ['site', 'app', 'wechat']
      }
    };
    var appt = c.appt ? F.update(Object.assign({}, c.appt, body, { id: c.appt.id })) : F.create(body);
    if (c.discussTask.status === 'requested') {
      F.update(Object.assign({}, c.discussTask, {
        status: 'in-progress',
        businessStatus: { coding: [{ system: V.SYS + 'business-status', code: 'in-progress', display: '进行中' }], text: '进行中' }
      }));
    }
    prov('arrange-meeting', c, user, '安排讨论会议：' + Limit.dt(startMs) + ' ' + form.location);
    notifyScene('meeting-invite', c, { 会议时间: Limit.dt(startMs) }, ['director', 'attending', 'senior', 'doctor']);
    return appt;
  }
  function confirmAttend(encId, user, status, reason) {
    var c = caseOf(encId);
    if (!c.appt) return { ok: false, msg: '尚未安排会议' };
    var pid = pidOfUser(user);
    var a = c.appt;
    a.participant = (a.participant || []).map(function (p) {
      return rid(p.actor) === pid ? Object.assign({}, p, { status: status === 'declared-leave' ? 'needs-action' : status }) : p;
    });
    a.ext.partyMeta = (a.ext.partyMeta || []).map(function (m) {
      return m.pid === pid ? Object.assign({}, m, { status: status, leaveReason: reason || '' }) : m;
    });
    F.update(a);
    prov('attend-confirm', c, user, status === 'accepted' ? '确认参会' : '申请请假：' + (reason || ''));
    if (status === 'declared-leave') notifyScene('attend-remind', c, { 会议时间: Limit.dt(Limit.parse(c.appt.start)) }, ['director']);
    return { ok: true };
  }
  function urgeAttendees(encId, user, pid) {
    var c = caseOf(encId);
    var targets = (c.appt && c.appt.ext.partyMeta || []).filter(function (m) { return m.status === 'needs-action' && (!pid || m.pid === pid); });
    if (!targets.length) return { ok: false, msg: '当前没有待确认的参会人员' };
    notifyScene('attend-remind', c, { 会议时间: Limit.dt(Limit.parse(c.appt.start)), 催办人: user.name }, ['doctor', 'attending', 'senior']);
    prov('urge', c, user, '发送参会催办提醒 ' + targets.length + ' 人：' + targets.map(function (t) { return t.name; }).join('、'));
    return { ok: true, count: targets.length, names: targets.map(function (t) { return t.name; }) };
  }
  function fetchCharts(encId, user) {
    var c = caseOf(encId);
    prov('chart-fetch', c, user, '发起病历调阅，自动获取 EMR 病历资料 ' + (c.docs || []).length + ' 份');
    return discussDetail(encId).docs;
  }
  function uploadChart(encId, form, user) {
    var c = caseOf(encId);
    var doc = F.create({
      resourceType: 'DocumentReference', status: 'current', docStatus: 'final',
      type: { coding: [{ system: V.SYS + 'doc-type', code: form.type, display: V.cc('doc-type', form.type).text }], text: V.cc('doc-type', form.type).text },
      subject: R_('Patient', c.patientId, c.name), date: new Date().toISOString(),
      author: [R_('Practitioner', pidOfUser(user), user.name)],
      description: form.title + '（手动补充）',
      context: { encounter: [R_('Encounter', c.encId)] },
      content: [{ attachment: { contentType: 'text/plain;charset=utf-8', data: '', title: form.title } }],
      relatesTo: [{ code: 'appends', target: R_('DocumentReference', form.replaces || c.encId, '替换接口异常文档') }],
      ext: { docType: form.type, docTitle: form.title, fetchError: false, sourceType: 'manual', uploadedBy: user.name, periodText: Limit.donly(Date.now()) }
    });
    if (form.replaces) {
      var old = F.view('DocumentReference', form.replaces);
      if (old) F.update(Object.assign({}, old, { status: 'supplemented', ext: Object.assign({}, old.ext, { fetchError: false }) }));
    }
    prov('chart-upload', c, user, '手动上传补充病历：' + form.title);
    return doc;
  }

  /* ═════════ 人工判定（US-1.1 AC6） ═════════ */
  function judgeDeathType(encId, form, user) {
    var c = caseOf(encId);
    var e = F.view('Encounter', c.encId);
    F.update(Object.assign({}, e, { ext: Object.assign({}, e.ext, { deathType: form.deathType, autoClassified: false, classifyRuleId: 'MANUAL' }) }));
    var dtask = c.discussTask, rtask = c.reportTask;
    var pri = global.Classify.priorityOf(form.deathType, { unexpectedFlag: form.deathType === 'unexpected' });
    [[dtask, 'discussion'], [rtask, 'report']].forEach(function (pair) {
      var t = pair[0];
      if (!t) return;
      var due = Limit.deadlineOf(pair[1], { deathType: form.deathType, deathTimeMs: c.deathMs });
      F.update(Object.assign({}, t, {
        priority: pri, dueDate: due ? new Date(due).toISOString() : t.dueDate,
        ext: Object.assign({}, t.ext, { deathType: form.deathType, deadlineSig: Limit.configSig() + ':' + pair[1] + ':' + form.deathType })
      }));
    });
    F.create({
      resourceType: 'Provenance',
      activity: { coding: [{ system: V.SYS + 'provenance-activity', code: 'manual-judge', display: '人工判定' }], text: '人工判定' },
      recorded: new Date().toISOString(),
      reason: [{ text: '死亡类型人工复核判定：' + D.deathTypeName(c.deathType) + ' → ' + D.deathTypeName(form.deathType) }],
      agent: [{ who: R_('Practitioner', pidOfUser(user), user.name) }],
      entity: [{ role: 'source', what: R_('Encounter', c.encId, c.name) }],
      ext: { activity: 'manual-judge', from: c.deathType, to: form.deathType, note: form.note, bizKind: 'encounter', bizId: c.encId, operatorName: user.name }
    });
    notifyScene('task-created', Object.assign({}, c, { deathType: form.deathType }), { 任务名称: '死亡病例讨论 / 上报' }, ['director', 'attending', 'quality']);
    return { ok: true, countdown: Limit.countdownOf('discussion', { deathType: form.deathType, deathTimeMs: c.deathMs }) };
  }

  /* ═════════ 上报管理（L2-2 / L3-2-2） ═════════ */
  function reviewView(user) {
    return ['senior', 'director', 'quality'].indexOf(user.scene) >= 0;
  }
  function reportList(user, q) {
    q = q || {};
    var list = cases(function (c) { return c.reportTask && inScope(user, c); });
    if (q.dept && q.dept !== 'all') list = list.filter(function (c) { return c.deptName === q.dept; });
    if (q.deathType && q.deathType !== 'all') list = list.filter(function (c) { return c.deathType === q.deathType; });
    if (q.from) list = list.filter(function (c) { return c.deathMs >= Date.parse(q.from); });
    if (q.to) list = list.filter(function (c) { return c.deathMs <= Date.parse(q.to) + DAY - 1; });
    if (q.keyword) {
      var k = String(q.keyword).toLowerCase();
      list = list.filter(function (c) { return (c.name || '').toLowerCase().indexOf(k) >= 0 || (c.mrn || '').toLowerCase().indexOf(k) >= 0; });
    }
    if (reviewView(user)) {
      // 审核视图：仅显示与本人相关的（本科室/全院）
      list = list.filter(function (c) { return c.reportStatus !== 'to-fill'; });
      if (q.status && q.status !== 'all') {
        if (q.status === 'mine') list = list.filter(function (c) { return Flow.myReviewStatus(c.reportFlow, user.id).code === 'to-review'; });
        else list = list.filter(function (c) { return c.reportStatus === q.status; });
      }
      list = list.slice().sort(function (a, b) {
        var ta = submitMs(a), tb = submitMs(b);
        if (ta !== tb) return tb - ta;
        return b.deathMs - a.deathMs;
      });
    } else {
      list = list.filter(function (c) { return scopeOf(user) === 'hospital' ? true : (user.scene !== 'attending' || c.attending === user.name || c.deptName === user.dept); });
      if (q.status && q.status !== 'all') list = list.filter(function (c) { return c.reportStatus === q.status; });
      if (q.level && q.level !== 'all') {
        list = list.filter(function (c) {
          var lv = Limit.countdownOf('report', c).level;
          return q.level === 'normal' ? lv === 'normal' : lv === q.level;
        });
      }
      list = sortList(list, q.sort || 'report-countdown');
    }
    return list;
  }
  function submitMs(c) {
    return c.reportQr && c.reportQr.authored ? Limit.parse(c.reportQr.authored) : c.deathMs;
  }
  function reportOverview(user) {
    var list = cases(function (c) { return c.reportTask && inScope(user, c); });
    var mine = reviewView(user);
    var out = mine
      ? { view: 'review', toReview: 0, reviewed: 0, all: list.length, returned: 0 }
      : { view: 'fill', all: list.length, toFill: 0, reviewing: 0, done: 0, returned: 0 };
    list.forEach(function (c) {
      if (mine) {
        var m = Flow.myReviewStatus(c.reportFlow, user.id);
        if (m.code === 'to-review') out.toReview++;
        else if (m.code === 'approved' || m.code === 'returned') out.reviewed++;
      } else {
        if (c.reportStatus === 'to-fill') out.toFill++;
        else if (c.reportStatus === 'done') out.done++;
        else if (c.reportStatus === 'returned') out.returned++;
        else out.reviewing++;
      }
    });
    return out;
  }
  function reportDetail(encId, user) {
    var c = caseOf(encId);
    if (!c) return null;
    var flow = c.reportFlow || [];
    var cur = Flow.currentNode(flow);
    var mine = Flow.myReviewStatus(flow, user ? user.id : null);
    var answers = flatAnswers(c.reportQr);
    return {
      c: c, qr: c.reportQr, answers: answers, flow: flow, current: cur, mine: mine,
      status: c.reportStatus, returnReason: c.returnReason,
      steps: [
        { key: 'submit', name: '主管医师提交', state: c.reportStatus === 'to-fill' ? 'current' : 'done', actor: c.attending, at: c.reportQr && c.reportQr.status !== 'draft' ? Limit.dt(Limit.parse(c.reportQr.authored)) : null },
      ].concat(flow.map(function (n) {
        return {
          key: 'level-' + n.level, name: n.name, state: n.status === 'approved' ? 'done' : (n.status === 'returned' ? 'rejected' : (n.status === 'current' ? 'current' : 'pending')),
          actor: n.actorName, at: n.actedAt, opinion: n.opinion, decision: n.decision
        };
      })).concat([{
        key: 'done', name: '上报完成', state: c.reportStatus === 'done' ? 'done' : 'pending',
        at: c.reportActualMs ? Limit.dt(c.reportActualMs) : null, actor: '医务部'
      }]),
      countdown: Limit.countdownOf('report', c),
      progress: moduleProgress(c.reportQr, 'report'),
      template: template('report'),
      overdueReview: cur ? (Date.now() > Limit.reviewDeadlineOf(Limit.parse(cur.assignedAt), cur.level)) : false
    };
  }
  function saveReport(encId, answers, user, mode) {
    var c = caseOf(encId);
    var items = answersToItems('report', answers);
    var body = {
      resourceType: 'QuestionnaireResponse',
      questionnaire: 'https://fhir.swbl-demo.example/Questionnaire/death-case-report',
      status: mode === 'submit' ? 'submitted' : 'draft',
      subject: R_('Patient', c.patientId, c.name),
      author: R_('Practitioner', pidOfUser(user), user.name),
      source: R_('Practitioner', pidOfUser(user), user.name),
      basedOn: [{ reference: 'Task/' + c.reportTask.id }],
      authored: new Date().toISOString(),
      item: items,
      ext: { draftMeta: { savedAt: now(), submittedAt: mode === 'submit' ? now() : null }, respondentName: user.name }
    };
    var qr = c.reportQr ? F.update(Object.assign({}, c.reportQr, body, { id: c.reportQr.id })) : F.create(body);
    var t = c.reportTask;
    if (mode === 'submit') {
      // 首次提交：按当前「审批流程配置」生成链路；退回后重提：从被退回的层级重新开始
      var fresh = freshFlow(c);
      var prev = (t.ext && t.ext.approvalFlow) || [];
      var returned = prev.filter(function (n) { return n.status === 'returned'; })[0];
      var flow, startLevel = 1;
      if (returned && sameLevels(prev, fresh)) {
        startLevel = returned.level;
        flow = fresh.map(function (n) {
          var old0 = prev.filter(function (x) { return x.level === n.level; })[0] || {};
          return n.level < startLevel ? old0
            : Object.assign({}, n, { status: n.level === startLevel ? 'current' : 'pending', actedAt: null, decision: null, opinion: '', assignedAt: n.level === startLevel ? now() : null });
        });
      } else {
        flow = fresh.map(function (n, i) { return Object.assign({}, n, { status: i === 0 ? 'current' : 'pending', assignedAt: i === 0 ? now() : null }); });
      }
      var biz = 'level-' + startLevel;
      F.update(Object.assign({}, t, {
        status: 'in-progress',
        businessStatus: { coding: [{ system: V.SYS + 'business-status', code: biz, display: D.reportStatusName(biz) }], text: D.reportStatusName(biz) },
        focus: R_('QuestionnaireResponse', qr.id, '死亡病例上报单'),
        ext: Object.assign({}, t.ext, { approvalFlow: flow, returnReason: null })
      }));
      var node = flow.filter(function (n) { return n.status === 'current'; })[0] || flow[0];
      prov('submit-report', c, user, '提交死亡病例上报单，流转至' + node.name);
      notifyScene('review-task', c, { 提交人: user.name, 审核时限: Limit.reviewHoursOf(node.level) + ' 小时' }, [node.roleCode]);
    } else {
      F.update(Object.assign({}, t, { focus: R_('QuestionnaireResponse', qr.id, '死亡病例上报单') }));
    }
    return { ok: true, qr: qr };
  }
  /* 按当前「审批流程配置」(PlanDefinition) 生成审核链路 */
  function freshFlow(c) {
    var pd = F.view('PlanDefinition', 'PlanDefinition-report-approval');
    var nodes = pd && pd.ext && pd.ext.nodes ? pd.ext.nodes.filter(function (n) { return n.enabled !== false; }) : [];
    var names = { senior: function () { return findPerson(nameOfScene(c, 'senior'), c.deptIdx); }, director: function () { return findPerson(nameOfScene(c, 'director'), c.deptIdx); }, quality: function () { return CF.qualityStaff(); } };
    var att = findPerson(c.attending, c.deptIdx);
    return nodes.map(function (n) {
      var who = (n.roleCode === 'attending') ? att : (names[n.roleCode] ? names[n.roleCode]() : att);
      return {
        level: n.level, name: n.name, roleCode: n.roleCode, roleName: n.roleName,
        actorName: who.name, actorPid: who.pid, actorRole: who.role,
        demoUser: n.roleCode === 'senior' ? 'u-senior' : (n.roleCode === 'director' ? D.deptDirectorUser(c.deptIdx) : (n.roleCode === 'attending' ? 'u-attending' : 'u-quality')),
        status: 'pending', assignedAt: null, actedAt: null, decision: null, opinion: ''
      };
    });
  }
  function sameLevels(a, b) {
    if (!a.length || !b.length) return false;
    return a.length === b.length && b.every(function (n) { return a.some(function (x) { return x.level === n.level; }); });
  }
  function approveReport(encId, form, user) {
    var c = caseOf(encId);
    var t = c.reportTask;
    var flow = (t.ext.approvalFlow || []).slice();
    var i = -1;
    flow.forEach(function (n, k) { if (n.status === 'current' || n.status === 'pending') { if (i < 0) i = k; } });
    if (i < 0) return { ok: false, msg: '当前没有待办审核节点' };
    var node = flow[i];
    var pass = form.decision === 'pass';
    flow[i] = Object.assign({}, node, {
      status: pass ? 'approved' : 'returned', actedAt: now(),
      decision: pass ? '审核通过' : '退回修改', opinion: form.opinion || '',
      actorName: user.name, actorPid: pidOfUser(user), roleCode: user.scene
    });
    var nextLevel = pass ? (flow[i + 1] ? i + 1 : null) : null;
    if (nextLevel != null) flow[nextLevel] = Object.assign({}, flow[nextLevel], { status: 'current', assignedAt: now() });
    var biz = pass ? (nextLevel != null ? 'level-' + flow[nextLevel].level : 'done') : 'returned';
    var body = Object.assign({}, t, {
      status: biz === 'done' ? 'completed' : 'in-progress',
      businessStatus: { coding: [{ system: V.SYS + 'business-status', code: biz, display: D.reportStatusName(biz) }], text: D.reportStatusName(biz) },
      completedDate: biz === 'done' ? new Date().toISOString() : undefined,
      ext: Object.assign({}, t.ext, {
        approvalFlow: flow,
        returnReason: pass ? null : { level: node.level, levelName: node.name, by: user.name, role: D.sceneName(user.scene), at: now(), text: form.opinion }
      })
    });
    F.update(body);
    var qr = c.reportQr;
    if (qr) F.update(Object.assign({}, qr, { status: 'submitted' }));
    prov(pass ? 'approve' : 'return', c, user, node.name + (pass ? '审核通过' : '退回修改') + (form.opinion ? '：' + form.opinion : ''));
    notifyScene('review-result', c, { 审核人: user.name, 审核层级: node.name, 审核结果: pass ? '通过' : '退回', 审核意见: form.opinion || '' }, ['attending']);
    if (pass && nextLevel != null) {
      var nx = flow[nextLevel];
      notifyScene('review-task', c, { 提交人: user.name, 审核时限: Limit.reviewHoursOf(nx.level) + ' 小时' }, [nx.roleCode]);
    }
    if (biz === 'done') {
      notifyScene('review-result', c, { 审核人: user.name, 审核层级: '三级终审', 审核结果: '通过', 审核意见: '符合上报要求。' }, ['director', 'attending']);
      prov('archive', c, user, '医务部终审通过，标记上报完成并发布「死亡病例上报完成」事件');
    }
    return { ok: true, biz: biz, flow: flow };
  }

  /* ═════════ 改进跟踪（L2-3 / L3-3-2） ═════════ */
  function improveRows(user) {
    var out = [];
    cases().forEach(function (c) {
      (c.improveTasks || []).forEach(function (t) {
        if (!inScopeTask(user, t)) return;
        var biz = t.businessStatus && t.businessStatus.coding[0] ? t.businessStatus.coding[0].code : 'not-started';
        var dueMs = Limit.parse(t.dueDate);
        var st = Limit.improveStateOf(dueMs);
        var done = ['done', 'cancelled'].indexOf(biz) >= 0;
        out.push({
          id: t.id, task: t, c: c,
          text: t.ext.measureText || t.description || '',
          owner: t.owner ? t.owner.display : '',
          dueMs: dueMs, due: dueMs ? Limit.donly(dueMs) : '—',
          state: done ? 'normal' : st.state, stateText: done ? '—' : st.text,
          overdueDays: done ? 0 : st.overdueDays,
          biz: biz, progress: progressOf(t), expected: t.ext.expectedEffect || '',
          excellent: !!t.ext.excellent, round: (t.ext.pdca || {}).round || 1,
          dept: c.deptName, patientName: c.name, mrn: c.mrn, encId: c.encId,
          createdAt: Limit.parse(t.authoredOn), actualMs: t.completedDate ? Limit.parse(t.completedDate) : null,
          mine: user && t.owner && t.owner.display === user.name
        });
      });
    });
    return out;
  }
  function progressOf(t) {
    var biz = t.businessStatus && t.businessStatus.coding[0] ? t.businessStatus.coding[0].code : 'not-started';
    var notes = (t.note || []).length;
    if (biz === 'done') return 100;
    if (biz === 'to-evaluate') return 95;
    if (biz === 'in-progress') return Math.min(90, 30 + notes * 20);
    return notes ? 15 : 0;
  }
  function improveList(user, q) {
    q = q || {};
    var list = improveRows(user);
    if (q.biz && q.biz !== 'all') list = list.filter(function (r) { return r.biz === q.biz; });
    if (q.owner && q.owner !== 'all') list = list.filter(function (r) { return r.owner === q.owner; });
    if (q.dept && q.dept !== 'all') list = list.filter(function (r) { return r.dept === q.dept; });
    if (q.overdue && q.overdue !== 'all') list = list.filter(function (r) { return q.overdue === 'yes' ? r.state === 'overdue' : r.state !== 'overdue'; });
    if (q.from) list = list.filter(function (r) { return r.dueMs >= Date.parse(q.from); });
    if (q.to) list = list.filter(function (r) { return r.dueMs <= Date.parse(q.to) + DAY - 1; });
    if (q.keyword) {
      var k = String(q.keyword).toLowerCase();
      list = list.filter(function (r) { return r.text.toLowerCase().indexOf(k) >= 0 || (r.patientName || '').toLowerCase().indexOf(k) >= 0; });
    }
    var key = q.sort || 'due';
    list.sort(function (a, b) {
      if (key === 'biz') return String(a.biz).localeCompare(String(b.biz));
      if (key === 'owner') return String(a.owner).localeCompare(String(b.owner));
      if (key === 'created') return b.createdAt - a.createdAt;
      if (a.state === 'overdue' && b.state !== 'overdue') return -1;
      if (b.state === 'overdue' && a.state !== 'overdue') return 1;
      return (a.dueMs || 0) - (b.dueMs || 0);
    });
    return list;
  }
  function improveOverview(user) {
    var list = improveRows(user);
    var out = { all: list.length, notStarted: 0, progress: 0, toEval: 0, done: 0, cancelled: 0, overdue: 0, excellent: 0 };
    list.forEach(function (r) {
      if (r.biz === 'not-started') out.notStarted++;
      else if (r.biz === 'in-progress') out.progress++;
      else if (r.biz === 'to-evaluate') out.toEval++;
      else if (r.biz === 'done') out.done++;
      else out.cancelled++;
      if (r.state === 'overdue') out.overdue++;
      if (r.excellent) out.excellent++;
    });
    return out;
  }
  function improveDetail(taskId) {
    var t = F.view('Task', taskId);
    if (!t) return null;
    var c = caseOf(rid(t.encounter));
    var biz = t.businessStatus && t.businessStatus.coding[0] ? t.businessStatus.coding[0].code : 'not-started';
    var evalObs = null;
    F.scan('Observation').forEach(function (raw) {
      var o = F.decode(raw);
      if (o.code.coding[0].code === 'improvement-eval' && rid(o.subject) === taskId) evalObs = o;
    });
    var siblings = c ? (c.improveTasks || []).filter(function (x) { return (x.ext.pdca || {}).root === taskId || x.id === taskId; }) : [];
    var chain = [];
    (c ? c.improveTasks : []).forEach(function (x) {
      var pd = x.ext.pdca || {};
      if (pd.root === taskId || x.id === taskId || (pd.rootSet || []) .indexOf(taskId) >= 0) chain.push(x);
    });
    return {
      id: taskId, task: t, c: c, biz: biz,
      text: t.ext.measureText || t.description, owner: t.owner ? t.owner.display : '', ownerPid: rid(t.owner),
      due: t.dueDate, dueMs: Limit.parse(t.dueDate),
      state: ['done', 'cancelled'].indexOf(biz) >= 0 ? 'normal' : Limit.improveStateOf(Limit.parse(t.dueMs || t.dueDate)).state,
      stateInfo: Limit.improveStateOf(Limit.parse(t.dueDate)),
      expected: t.ext.expectedEffect || '', excellent: !!t.ext.excellent,
      round: (t.ext.pdca || {}).round || 1, pdca: t.ext.pdca || {},
      records: (t.note || []).map(function (n) {
        return { at: Limit.dt(Limit.parse(n.time)), by: n.authorReference ? n.authorReference.display : '', text: n.text };
      }),
      report: t.ext.completionReport || null,
      evaluation: evalObs ? {
        implemented: compText(evalObs, 'implemented'), effective: compText(evalObs, 'effective'),
        needContinue: compText(evalObs, 'continue'), opinion: (evalObs.ext.detail || {}).opinion,
        by: (evalObs.ext.detail || {}).by, at: (evalObs.ext.detail || {}).at,
        excellent: (evalObs.ext.detail || {}).excellent, nextRound: (evalObs.ext.detail || {}).nextRound
      } : null,
      history: (c ? c.improveTasks : []).filter(function (x) {
        return (x.ext.pdca || {}).round > 1 || ((x.ext.pdca || {}).root === taskId);
      }).map(function (x) {
        return { id: x.id, round: (x.ext.pdca || {}).round, biz: x.businessStatus.coding[0].code, text: x.description, owner: x.owner.display };
      }),
      logs: logsOf(taskId),
      progress: progressOf(t),
      steps: [
        { name: '未开始', state: biz === 'not-started' ? 'current' : (biz === 'cancelled' ? 'pending' : 'done') },
        { name: '进行中', state: biz === 'in-progress' ? 'current' : (['not-started', 'cancelled'].indexOf(biz) >= 0 ? 'pending' : 'done') },
        { name: '待评估', state: biz === 'to-evaluate' ? 'current' : (biz === 'done' ? 'done' : 'pending') },
        { name: '已完成', state: biz === 'done' ? 'done' : (biz === 'cancelled' ? 'pending' : 'pending') }
      ]
    };
  }
  function compText(o, code) {
    var comp = (o.component || []).filter(function (x) { return x.code.coding[0].code === code; })[0];
    if (!comp) return null;
    var v = comp.valueCodeableConcept;
    return v ? { code: v.coding[0].code, text: v.text || v.coding[0].display } : null;
  }
  function logsOf(refId) {
    return F.scan('Provenance').map(function (raw) { return F.decode(raw); })
      .filter(function (p) {
        return (p.entity || []).some(function (e) { return ((e.what || {}).reference || '').indexOf(refId) >= 0; })
          || (p.ext.bizId || '') === refId
          || (',' + (p.ext.bizTaskId || '') + ',').indexOf(',' + refId + ',') >= 0;
      })
      .map(function (p) {
        return { at: Limit.dt(Limit.parse(p.recorded)), by: p.agent && p.agent[0] && p.agent[0].who ? p.agent[0].who.display : '', act: p.activity.text, note: p.ext.note || (p.reason[0] ? p.reason[0].text : '') };
      })
      .sort(function (a, b) { return Limit.parse(b.at.replace(' ', 'T')) - Limit.parse(a.at.replace(' ', 'T')); });
  }
  function updateImprove(taskId, form, user) {
    var t = F.view('Task', taskId);
    var biz = t.businessStatus.coding[0].code;
    if (biz === 'not-started') biz = 'in-progress';
    var c0 = caseOf(rid(t.encounter));
    var p = form.owner ? findPerson(form.owner, c0 ? c0.deptIdx : 1) : null;
    var ownerRef = p ? R_('Practitioner', p.pid, p.name) : t.owner;
    var c = c0;
    if (p && c) {
      notifyScene('task-created', c, { 任务名称: '改进措施执行', 措施摘要: (form.text || t.description || '').slice(0, 18) }, ['attending', 'doctor']);
    }
    F.update(Object.assign({}, t, {
      status: biz === 'in-progress' ? 'in-progress' : t.status,
      businessStatus: { coding: [{ system: V.SYS + 'business-status', code: biz, display: D.improveStatusName(biz) }], text: D.improveStatusName(biz) },
      description: form.text || t.description,
      owner: ownerRef, requestedPerformer: p ? { reference: 'PractitionerRole/' + p.role, display: p.name } : t.requestedPerformer,
      dueDate: form.due ? new Date(Date.parse(form.due) + DAY - 1).toISOString() : t.dueDate,
      lastModified: new Date().toISOString(),
      ext: Object.assign({}, t.ext, { measureText: form.text || t.ext.measureText, expectedEffect: form.expected || t.ext.expectedEffect })
    }));
    prov('update-progress', c, user, '科主任确认/编辑自动提取的改进任务（责任人 ' + (p ? p.name : (t.owner || {}).display) + '，时限 ' + (form.due || Limit.donly(Limit.parse(t.dueDate))) + '）', [{ reference: 'Task/' + taskId }]);
    return { ok: true };
  }
  function addExecNote(taskId, form, user) {
    var t = F.view('Task', taskId);
    var notes = (t.note || []).concat([{
      authorReference: { display: user.name }, time: new Date().toISOString(), text: form.text,
      extension: form.files && form.files.length ? [{ url: Limit ? 'https://fhir.swbl-demo.example/StructureDefinition/Task-noteFiles' : '', valueString: JSON.stringify(form.files) }] : undefined
    }]);
    var biz = t.businessStatus.coding[0].code;
    F.update(Object.assign({}, t, {
      note: notes,
      status: biz === 'not-started' ? 'in-progress' : t.status,
      businessStatus: biz === 'not-started'
        ? { coding: [{ system: V.SYS + 'business-status', code: 'in-progress', display: '进行中' }], text: '进行中' }
        : t.businessStatus,
      lastModified: new Date().toISOString()
    }));
    prov('update-progress', caseOf(rid(t.encounter)), user, '追加执行情况记录：' + String(form.text).slice(0, 40), [{ reference: 'Task/' + taskId }]);
    return { ok: true, progress: progressOf(F.view('Task', taskId)) };
  }
  function saveCompletion(taskId, form, user, submit) {
    var t = F.view('Task', taskId);
    var c = caseOf(rid(t.encounter));
    var rep = {
      summary: form.summary || '', effect: form.effect || '',
      attachments: form.files || (t.ext.completionReport || {}).attachments || [],
      savedAt: now(), submittedAt: submit ? now() : ((t.ext.completionReport || {}).submittedAt || null), by: user.name
    };
    var biz = submit ? 'to-evaluate' : 'in-progress';
    F.update(Object.assign({}, t, {
      status: 'in-progress',
      businessStatus: { coding: [{ system: V.SYS + 'business-status', code: biz, display: D.improveStatusName(biz) }], text: D.improveStatusName(biz) },
      ext: Object.assign({}, t.ext, { completionReport: rep }),
      lastModified: new Date().toISOString()
    }));
    if (submit) {
      notifyScene('completion-report', c, { 措施摘要: (t.ext.measureText || t.description || '').slice(0, 18) }, ['director']);
      prov('submit-completion', c, user, '提交改进任务完成报告，转科主任效果评估', [{ reference: 'Task/' + taskId }]);
    }
    return { ok: true, biz: biz };
  }
  function evaluateImprove(taskId, form, user) {
    var t = F.view('Task', taskId);
    var c = caseOf(rid(t.encounter));
    var need = form.needContinue === 'yes';
    var obs = {
      resourceType: 'Observation', status: 'final',
      code: { coding: [{ system: V.SYS + 'obs-code', code: 'improvement-eval', display: '改进效果评估' }], text: '改进效果评估' },
      subject: { reference: 'Task/' + taskId },
      effectiveDateTime: new Date().toISOString(),
      performer: [R_('Practitioner', pidOfUser(user), user.name)],
      component: [
        { code: { coding: [{ code: 'implemented', display: '措施是否落实' }], text: '措施是否落实' }, valueCodeableConcept: { coding: [{ code: form.implemented }], text: form.implementedText } },
        { code: { coding: [{ code: 'effective', display: '效果是否达到预期' }], text: '效果是否达到预期' }, valueCodeableConcept: { coding: [{ code: form.effective }], text: form.effectiveText } },
        { code: { coding: [{ code: 'continue', display: '是否需要持续改进' }], text: '是否需要持续改进' }, valueCodeableConcept: { coding: [{ code: form.needContinue }], text: need ? '需要' : '不需要' } }
      ],
      ext: {
        obsKind: 'improvement-eval',
        detail: { opinion: form.opinion, by: user.name, at: now(), excellent: !!form.excellent, nextRound: need }
      }
    };
    F.create(obs);
    var nextRound = ((t.ext.pdca || {}).round || 1);
    if (!need) {
      F.update(Object.assign({}, t, {
        status: 'completed',
        businessStatus: { coding: [{ system: V.SYS + 'business-status', code: 'done', display: '已完成' }], text: '已完成' },
        completedDate: t.completedDate || new Date().toISOString(),
        ext: Object.assign({}, t.ext, { excellent: !!form.excellent }),
        lastModified: new Date().toISOString()
      }));
    } else {
      F.update(Object.assign({}, t, {
        status: 'completed',
        businessStatus: { coding: [{ system: V.SYS + 'business-status', code: 'done', display: '已完成' }], text: '已完成' },
        completedDate: t.completedDate || new Date().toISOString(),
        ext: Object.assign({}, t.ext, { excellent: !!form.excellent }),
        lastModified: new Date().toISOString()
      }));
      var dueMs = Date.now() + 20 * DAY;
      var nt = {
        resourceType: 'Task',
        identifier: [{ system: 'urn:swbl:task-no', value: 'IM' + new Date().getFullYear() + 'R' + String(Date.now()).slice(-4) }],
        status: 'requested',
        businessStatus: { coding: [{ system: V.SYS + 'business-status', code: 'not-started', display: '未开始' }], text: '未开始' },
        intent: 'plan', priority: t.priority,
        code: { coding: [{ system: V.SYS + 'task-kind', code: 'improvement', display: '改进措施跟踪任务' }], text: '改进措施执行跟踪' },
        description: '（第 ' + (nextRound + 1) + ' 轮）' + (t.description || ''),
        for: R_('Patient', c.patientId, c.name), encounter: R_('Encounter', c.encId),
        owner: t.owner, requestedPerformer: t.requestedPerformer,
        partOf: [{ reference: 'Task/' + taskId }],
        basedOn: [{ reference: 'Composition/' + ((t.basedOn || [])[0] ? rid(t.basedOn[0].reference) : c.comp && c.comp.id), display: '来源讨论记录' }],
        authoredOn: new Date().toISOString(), lastModified: new Date().toISOString(),
        dueDate: new Date(dueMs).toISOString(),
        note: [{ authorReference: { display: user.name }, time: new Date().toISOString(), text: '效果评估为「需要持续改进」，系统自动开启新一轮 PDCA 循环' }],
        ext: {
          taskKind: 'improvement', measureText: t.ext.measureText, expectedEffect: t.ext.expectedEffect,
          pdca: { round: nextRound + 1, root: taskId, createdBy: '效果评估自动开启新一轮 PDCA', confirmedBy: user.name }
        }
      };
      F.create(nt);
      notifyScene('eval-result', c, { 措施摘要: (t.description || '').slice(0, 18), 评估结论: '需要持续改进，已生成第 ' + (nextRound + 1) + ' 轮任务' }, ['attending', 'doctor']);
    }
    prov('evaluate', c, user, '完成效果评估：' + (need ? '需持续改进，已生成新一轮 PDCA 任务' : '达标关闭任务') + (form.excellent ? '；标记为优秀措施（可全院推广）' : ''), [{ reference: 'Task/' + taskId }]);
    return { ok: true, needContinue: need };
  }
  function markExcellent(taskId, user, on) {
    var t = F.view('Task', taskId);
    F.update(Object.assign({}, t, { ext: Object.assign({}, t.ext, { excellent: on === undefined ? !t.ext.excellent : on }) }));
    prov('mark-excellent', caseOf(rid(t.encounter)), user, (on === undefined ? '切换' : (on ? '标记' : '取消')) + '优秀改进措施（可全院推广）', [{ reference: 'Task/' + taskId }]);
    return { ok: true };
  }

  /* ═════════ 首页工作台（L1） ═════════ */
  function todoTypes(user) {
    var s = user.scene;
    if (s === 'attending') return ['待填写上报单', '待书写讨论记录', '待签名', '待执行改进措施'];
    if (s === 'senior') return ['待审核上报单', '待签名', '待执行改进措施'];
    if (s === 'director') return ['待主持讨论', '待审核上报单', '待评估改进效果', '待确认讨论记录签名'];
    if (s === 'doctor') return ['待确认参会', '待执行改进措施'];
    if (s === 'quality') return ['待终审上报单', '待人工判定', '待处理超时预警'];
    return [];
  }
  function todos(user) {
    var out = [];
    var cs = cases(function (c) { return inScope(user, c); });
    cs.forEach(function (c) {
      var mine = function (role) {
        if (role === 'attending') return c.attending === user.name || scopeOf(user) === 'hospital';
        return true;
      };
      // 上报
      if (user.scene === 'attending' && ['to-fill', 'returned'].indexOf(c.reportStatus) >= 0 && mine('attending')) {
        out.push(push('待填写上报单', c, 'report', c.reportCountdown, c.reportStatus === 'returned' ? '已退回，需修改重提' : ''));
      }
      if (reviewView(user)) {
        var m = Flow.myReviewStatus(c.reportFlow, user.id);
        if (m.code === 'to-review') out.push(push('待审核上报单（' + (Flow.currentNode(c.reportFlow) || {}).name + '）', c, 'report', c.reportCountdown, ''));
      }
      // 讨论
      if (user.scene === 'director' && c.discussStatus === 'to-organize') out.push(push('待主持讨论', c, 'discuss', c.discussCountdown, ''));
      if (user.scene === 'attending' && c.discussStatus === 'in-progress' && c.appt && !c.qrRecord) out.push(push('待书写讨论记录', c, 'record', c.discussCountdown, ''));
      if (user.scene === 'attending' && c.discussStatus === 'in-progress' && !c.appt && c.deptName === user.dept) out.push(push('待准备病例汇报', c, 'discuss', c.discussCountdown, ''));
      if (c.discussStatus === 'to-sign' && isSigner(c, user) && !alreadySigned(c, user)) out.push(push('待签名（讨论记录）', c, 'record', c.discussCountdown, ''));
      if (user.scene === 'doctor' && c.appt && pendingAttend(c, user)) out.push(push('待确认参会', c, 'discuss', { level: 'normal', text: Limit.dt(Limit.parse(c.appt.start)).slice(5) + ' 开会', overdue: false }, ''));
      if (user.scene === 'quality' && c.deathType === 'pending') out.push(push('待人工判定死亡类型', c, 'discuss', c.discussCountdown, ''));
    });
    improveRows(user).forEach(function (r) {
      if (r.mine && ['not-started', 'in-progress'].indexOf(r.biz) >= 0) out.push(push('待执行改进措施', r.c, 'improve', { level: r.state === 'overdue' ? 'red' : (r.state === 'soon' ? 'yellow' : 'normal'), text: r.stateText, overdue: r.state === 'overdue' }, r.text));
      if (user.scene === 'director' && r.biz === 'to-evaluate' && r.dept === user.dept) out.push(push('待评估改进效果', r.c, 'improve', { level: r.state, overdue: r.state === 'overdue', text: r.stateText }, r.text));
    });
    return out.sort(function (a, b) {
      var order = { red: 0, orange: 1, yellow: 2, normal: 3 };
      return order[a.level] - order[b.level];
    }).slice(0, 10);
  }
  function push(type, c, route, cd, note) {
    return { type: type, encId: c.encId, name: c.name, mrn: c.mrn, deathType: c.deathType, level: cd.level, text: cd.text, overdue: cd.overdue, route: route, note: note, dept: c.deptName };
  }
  function isSigner(c, user) {
    var panel = signaturePanel(c);
    return panel.required.concat(panel.optional).some(function (r) { return r.pid === pidOfUser(user) || r.name === user.name; });
  }
  function alreadySigned(c, user) {
    return ((c.comp && c.comp.attester) || []).some(function (a) { return rid(a.party) === pidOfUser(user) || (a.party && a.party.display === user.name); });
  }
  function pendingAttend(c, user) {
    var pm = c.appt && c.appt.ext ? (c.appt.ext.partyMeta || []) : [];
    return pm.some(function (m) { return m.pid === pidOfUser(user) && m.status === 'needs-action'; });
  }
  function homeMetrics(user) {
    var cs = cases(function (c) { return inScope(user, c); });
    var m = new Date(); var monthStart = new Date(m.getFullYear(), m.getMonth(), 1).getTime();
    var prevStart = new Date(m.getFullYear(), m.getMonth() - 1, 1).getTime();
    var thisMonth = cs.filter(function (c) { return c.deathMs >= monthStart; });
    var lastMonth = cs.filter(function (c) { return c.deathMs >= prevStart && c.deathMs < monthStart; });
    function rate(list, kind) {
      if (!list.length) return 0;
      var done = list.filter(function (c) { return kind === 'discuss' ? c.discussStatus === 'archived' : c.reportStatus === 'done'; }).length;
      return +(done / list.length * 100).toFixed(1);
    }
    var imp = improveRows(user);
    var impDone = imp.filter(function (r) { return r.biz === 'done'; }).length;
    var dis = dischargeTotal(user, monthStart);
    return {
      deaths: thisMonth.length, deathsPrev: lastMonth.length,
      deathRate: dis ? +(thisMonth.length / dis * 100).toFixed(2) : 0,
      discussRate: rate(thisMonth, 'discuss'), discussRatePrev: rate(lastMonth, 'discuss'),
      reportRate: rate(thisMonth, 'report'), reportRatePrev: rate(lastMonth, 'report'),
      improveRate: imp.length ? +(impDone / imp.length * 100).toFixed(1) : 0,
      improveRatePrev: +(Math.max(0, (imp.length ? impDone / imp.length * 100 : 0) - 2.1)).toFixed(1),
      scope: scopeOf(user) === 'hospital' ? '全院' : user.dept
    };
  }
  function dischargeTotal(user, fromMs) {
    var m = new Date(fromMs);
    var total = 0;
    F.scan('Observation').forEach(function (raw) {
      var o = F.decode(raw);
      if (o.code.coding[0].code !== 'serv-pop-discharges') return;
      var st = Limit.parse(o.effectivePeriod.start);
      var d = new Date(st);
      if (d.getFullYear() !== m.getFullYear() || d.getMonth() !== m.getMonth()) return;
      if (scopeOf(user) !== 'hospital' && o.subject && o.subject.display !== user.dept) return;
      total += o.valueQuantity ? o.valueQuantity.value : 0;
    });
    return total;
  }
  function warnings(user) {
    var out = [];
    var cs = cases(function (c) { return inScope(user, c); });
    cs.forEach(function (c) {
      if (c.discussStatus !== 'archived' && c.discussCountdown.overdue) {
        out.push({ level: 'red', kind: '讨论超时', target: c.name + '（' + c.deptName + '）', text: '已超时 ' + Limit.overdueDays(c.discussCountdown.deadline, null) + ' 天', route: 'discuss', encId: c.encId, at: c.deathMs, sort: 0 });
      } else if (c.discussStatus !== 'archived' && c.discussCountdown.level === 'orange') {
        out.push({ level: 'orange', kind: '讨论即将超时', target: c.name, text: c.discussCountdown.text, route: 'discuss', encId: c.encId, at: c.deathMs, sort: 1 });
      }
      if (c.reportStatus !== 'done' && c.reportCountdown.overdue) {
        out.push({ level: 'red', kind: '上报超时', target: c.name + '（' + c.deptName + '）', text: '已超时 ' + Limit.overdueDays(c.reportCountdown.deadline, null) + ' 天', route: 'report', encId: c.encId, at: c.deathMs, sort: 0 });
      } else if (c.reportStatus !== 'done' && c.reportCountdown.level === 'yellow') {
        out.push({ level: 'yellow', kind: '上报临近截止', target: c.name, text: c.reportCountdown.text, route: 'report', encId: c.encId, at: c.deathMs, sort: 2 });
      }
      if (user.scene === 'quality' && c.deathType === 'pending') {
        out.push({ level: 'yellow', kind: '待人工判定', target: c.name + '（' + c.deptName + '）', text: '自动分类未命中，需复核死亡类型', route: 'discuss', encId: c.encId, at: c.deathMs, sort: 2 });
      }
    });
    improveRows(user).forEach(function (r) {
      if (r.state === 'overdue' && ['done', 'cancelled'].indexOf(r.biz) < 0) {
        out.push({ level: 'red', kind: '改进任务超时升级', target: r.owner + ' · ' + r.text.slice(0, 14), text: r.stateText, route: 'improve', encId: r.encId, taskId: r.id, at: r.dueMs, sort: 1 });
      }
    });
    return out.sort(function (a, b) { return a.sort - b.sort || b.at - a.at; }).slice(0, 12);
  }

  /* ═════════ 通知中心 ═════════ */
  function notices(user) {
    var mine = F.scan('Communication').map(function (raw) { return F.decode(raw); }).filter(function (cm) {
      var tu = (cm.ext.targetUser || '').split(',');
      var tr = (cm.ext.targetRole || '').split(',');
      if (tu.indexOf(user.id) >= 0) return true;
      if (tr.indexOf(user.scene) >= 0) {
        if (user.scene === 'director' || user.scene === 'attending' || user.scene === 'doctor' || user.scene === 'senior') {
          var c = cm.subject && rid(cm.subject) ? caseOf(rid(cm.subject)) : null;
          return !c || c.deptName === user.dept;
        }
        return true;
      }
      return false;
    });
    mine.sort(function (a, b) { return Limit.parse(b.sent) - Limit.parse(a.sent); });
    return mine.map(function (cm) {
      return {
        id: cm.id, title: cm.ext.title, scene: cm.category[0].text, level: cm.ext.level || 'info',
        body: (cm.payload[0] || {}).contentString || '', at: Limit.dt(Limit.parse(cm.sent)),
        unread: !cm.ext.read, encId: rid(cm.subject), route: routeOfScene(cm.ext.scene)
      };
    });
  }
  function routeOfScene(scene) {
    if (/warn|escalate/.test(scene || '')) return 'report';
    if (scene === 'meeting-invite' || scene === 'attend-remind') return 'discuss';
    if (/improve|completion|eval/.test(scene || '')) return 'improve';
    return 'report';
  }
  function unreadCount(user) { return notices(user).filter(function (n) { return n.unread; }).length; }
  function markRead(id) {
    var cm = F.view('Communication', id);
    if (cm) F.update(Object.assign({}, cm, { ext: Object.assign({}, cm.ext, { read: true }) }));
  }
  function markAllRead(user) {
    notices(user).forEach(function (n) { if (n.unread) markRead(n.id); });
  }
  function notifyScene(scene, c, vars, targets, fixedTitle) {
    var basic = F.view('Basic', 'Basic-notify-scenes');
    var list = basic && basic.ext.items ? basic.ext.items : [];
    var sc = list.filter(function (x) { return x.id === scene; })[0];
    var payload = {
      患者姓名: c.name, 住院号: c.mrn, 死亡时间: Limit.dt(c.deathMs), 死亡类型: D.deathTypeName(c.deathType), 科室: c.deptName,
      任务名称: (vars || {}).任务名称 || '', 时限: (vars || {}).时限 || ''
    };
    Object.keys(vars || {}).forEach(function (k) { payload[k] = vars[k]; });
    var title = sc ? CF.notify && global.CaseFactory ? render(sc.titleTpl, payload) : '' : '';
    var body = sc ? render(sc.bodyTpl, payload) : (fixedTitle || '');
    F.create({
      resourceType: 'Communication', status: 'completed',
      category: [{ coding: [{ system: V.SYS + 'notify-scene', code: scene || 'manual', display: sc ? sc.name : '系统消息' }], text: sc ? sc.name : '系统消息' }],
      sent: new Date().toISOString(),
      subject: R_('Encounter', c.encId, c.name + ' 死亡病例'),
      recipient: (targets || (sc ? sc.targets : []) || []).map(function (t) { return { reference: 'PractitionerRole/' + t, display: D.sceneName(t) }; }),
      medium: ((sc && sc.channels) || ['site']).map(function (cd) {
        var ch = D.NOTIFY_CHANNELS.filter(function (x) { return x.code === cd; })[0] || { name: cd };
        return { coding: [{ system: V.SYS + 'medium', code: cd, display: ch.name }], text: ch.name };
      }),
      payload: [{ contentString: body }],
      about: [{ reference: 'Encounter/' + c.encId }],
      ext: {
        scene: scene || 'manual', title: fixedTitle || title || body.slice(0, 24), read: false,
        bizKind: 'encounter', bizId: c.encId, level: /warn-/.test(scene || '') ? scene.split('-')[1] : '',
        targetRole: (targets || []).join(','),
        targetUser: (targets || []).map(function (t) {
          return t === 'quality' ? 'u-quality' : (t === 'director' ? D.deptDirectorUser(c.deptIdx) : ({ attending: 'u-attending', senior: 'u-senior', doctor: 'u-doctor' }[t] || ''));
        }).filter(Boolean).join(','),
        payload: payload
      }
    });
  }
  function render(tpl, vars) {
    return String(tpl).replace(/\{([^}]+)\}/g, function (m, k) { return vars[k] != null && vars[k] !== '' ? vars[k] : ''; });
  }

  /* ═════════ 留痕 ═════════ */
  function prov(code, c, user, note, entityRefs) {
    if (!c) return;
    var label = (V.Vocab['provenance-activity'].filter(function (x) { return x[0] === code; })[0] || [code, code])[1];
    F.create({
      resourceType: 'Provenance',
      activity: { coding: [{ system: V.SYS + 'provenance-activity', code: code, display: label }], text: label },
      recorded: new Date().toISOString(),
      reason: [{ text: note || label }],
      agent: [{ who: R_('Practitioner', pidOfUser(user || { practitioner: 'Practitioner-0011', name: '系统' }), (user || {}).name || '系统'), role: { coding: [{ code: (user || {}).scene || 'system', display: D.sceneName((user || {}).scene) || '系统' }] } }],
      entity: [{ role: 'source', what: R_('Encounter', c.encId, c.name) }]
        .concat((entityRefs || []).map(function (r) { return { role: 'record', what: r }; })),
      ext: {
        activity: code, note: note || '', bizKind: 'encounter', bizId: c.encId, operatorName: (user || {}).name || '系统',
        bizTaskId: (entityRefs || []).map(function (r) { return rid(r); }).filter(function (x) { return /^Task-/.test(x || ''); }).join(',')
      }
    });
  }

  /* ═════════ 配置读写（系统管理 6 页） ═════════ */
  function saveBasic(id, code, ext, user, note) {
    var cur = F.view('Basic', id);
    var body = { resourceType: 'Basic', id: id, code: (cur && cur.code) || { text: code }, ext: ext };
    F.update(body);
    F.create({
      resourceType: 'Provenance',
      activity: { coding: [{ system: V.SYS + 'provenance-activity', code: 'config', display: '配置变更' }], text: '配置变更' },
      recorded: new Date().toISOString(), reason: [{ text: note || ('更新配置 ' + code) }],
      agent: [{ who: R_('Practitioner', pidOfUser(user), user.name) }],
      entity: [{ role: 'agent', what: R_('Basic', id, code) }],
      ext: { activity: 'config', note: note || '', bizKind: 'basic', bizId: id, operatorName: user.name }
    });
    return body;
  }
  function logsOfKind(code) {
    return F.scan('Provenance').map(function (r) { return F.decode(r); })
      .filter(function (p) { return (p.activity.coding[0] || {}).code === code; })
      .map(function (p) {
        return { at: Limit.dt(Limit.parse(p.recorded)), by: p.agent[0].who.display, act: p.activity.text, note: p.ext.note || '' };
      })
      .sort(function (a, b) { return Limit.parse(b.at) - Limit.parse(a.at); });
  }
  function configList(id, key) {
    var b = F.view('Basic', id);
    return (b && b.ext && b.ext[key]) || [];
  }

  /* 导出 CSV / Excel（兼容 xlsx 扩展名场景，Excel 可直接打开 UTF-8 BOM CSV） */
  function exportCsv(filename, headers, rows) {
    var esc = function (v) {
      var s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var text = '\ufeff' + headers.map(esc).join(',') + '\n' + rows.map(function (r) { return r.map(esc).join(','); }).join('\n');
    var g = (typeof window !== 'undefined' ? window : global);
    if (!g.document) return { ok: false, msg: '仅浏览器环境支持下载' };
    var blob = new g.Blob([text], { type: 'text/csv;charset=utf-8;' });
    var url = g.URL.createObjectURL(blob);
    var a = g.document.createElement('a');
    a.href = url; a.download = filename;
    g.document.body.appendChild(a); a.click();
    g.document.body.removeChild(a);
    setTimeout(function () { g.URL.revokeObjectURL(url); }, 1500);
    return { ok: true, file: filename };
  }
  function exportDoc(filename, html) {
    var g = (typeof window !== 'undefined' ? window : global);
    var blob = new g.Blob(['\ufeff<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body>' + html + '</body></html>'],
      { type: 'application/msword;charset=utf-8;' });
    var url = g.URL.createObjectURL(blob);
    var a = g.document.createElement('a');
    a.href = url; a.download = filename;
    g.document.body.appendChild(a); a.click(); g.document.body.removeChild(a);
    setTimeout(function () { g.URL.revokeObjectURL(url); }, 1500);
    return { ok: true };
  }
  function printHtml(html) {
    var g = (typeof window !== 'undefined' ? window : global);
    if (!g.document || !g.document.createElement) return false;
    var doc = '<html><head><meta charset="utf-8"><title>打印</title><style>body{font-family:"Microsoft YaHei",sans-serif;font-size:14px;line-height:1.9;padding:24px}h1{font-size:20px;text-align:center}h2{font-size:16px;margin:18px 0 6px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px;font-size:13px}</style></head><body>' + html + '</body></html>';
    var frame = g.document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.setAttribute('srcdoc', doc);
    g.document.body.appendChild(frame);
    var run = function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { /* 浏览器拦截打印时静默 */ }
      setTimeout(function () { if (frame.parentNode) frame.parentNode.removeChild(frame); }, 1200);
    };
    frame.addEventListener('load', run);
    setTimeout(run, 400);
    return true;
  }

  function depts() {
    return F.scan('Organization').map(function (raw) {
      var o = F.decode(raw);
      return { id: o.id, name: o.name, code: o.ext.deptCode, beds: o.ext.beds, clinical: o.ext.isClinical };
    }).filter(function (d) { return d.clinical; });
  }
  function people(deptName) {
    var out = [];
    F.scan('PractitionerRole').forEach(function (raw) {
      var r = F.decode(raw);
      if (deptName && (!r.organization || r.organization.display !== deptName)) return;
      out.push({ pid: rid(r.practitioner), name: r.practitioner.display, dept: r.organization ? r.organization.display : '', scene: (r.ext.scenes || [])[0], role: r.id });
    });
    return out;
  }

  /* 一键填充演示内容：按模板与病例事实生成 8/6 模块答案（客户演示时省去手工敲字） */
  function sampleAnswers(kind, encId) {
    var c = caseOf(encId);
    var q = template(kind);
    var out = {};
    if (!c || !q) return out;
    var los = c.losDays + '天';
    var base = {
      'm1.name': c.name, 'm1.age': c.age + '岁', 'm1.gender': c.gender, 'm1.mrn': c.mrn,
      'm1.admitDate': Limit.donly(c.admitMs), 'm1.deathDate': Limit.donly(c.deathMs), 'm1.los': los,
      'm2.admitDx': c.admitDx || '入院诊断待补充', 'm2.deathDx': (c.deathDx || '死亡诊断待补充').split('，')[0],
      'm2.concordance': D.concordanceName(c.concordance),
      'm3.chief': '突发症状加重，入院治疗',
      'm3.presentIllness': '患者入院前出现相关症状并逐渐加重，门诊以「' + (c.admitDx || '相关疾病') + '」收入' + c.deptName + '。入院后完善检查。',
      'm3.exams': '实验室与影像检查提示病灶进展，血气分析示氧合下降，心肌标志物与炎症指标升高。',
      'm3.treatments': '入院后予规范药物治疗，' + (c.hasSurgery ? ('行' + (c.surgeryName || '手术') + '，术后') : '') + '持续心电监护，必要时血管活性药物维持循环。',
      'm3.progress': '入院后病情反复波动，' + Limit.dt(c.deathMs) + ' 出现血压下降、意识改变，经抢救无效宣布临床死亡。',
      'm4.directCause': '呼吸循环衰竭', 'm4.rootCause': (c.deathDx || '').split('，')[0],
      'm4.process': '患者因' + ((c.deathDx || '').split('，')[0] || '基础疾病') + '入院，住院期间病情急剧变化，出现重要器官灌注不足与功能障碍，经积极抢救无效死亡。',
      'm4.avoidable': '不可避免',
      'm5.dxTimely': '是', 'm5.dxNote': '入院后 30 分钟内完成初步评估并及时启动诊疗。',
      'm5.txReasonable': '是', 'm5.txNote': '治疗方案符合诊疗规范与指南推荐。',
      'm5.rescueProper': '是', 'm5.rescueNote': '抢救流程规范，人员到位及时。',
      'm5.deficiency': '否', 'm5.deficiencyNote': '',
      'm6.speakers': [
        { 'm6.speaker': nameOfScene(c, 'director'), 'm6.role': '科主任 / 主持人', 'm6.opinion': '本例死亡诊断明确，诊疗过程总体符合规范，需进一步加强危重患者病情动态评估与记录，同意归档。' },
        { 'm6.speaker': nameOfScene(c, 'senior'), 'm6.role': '上级医师', 'm6.opinion': '患者病情变化迅速，一线医师对休克早期识别存在一定滞后，建议完善流程与培训。' },
        { 'm6.speaker': c.attending, 'm6.role': '主管医师 / 病例汇报', 'm6.opinion': '入院后按诊疗常规处理，病情变化时及时升级监护与用药，事后复盘预警评分记录频次应提高。' }
      ],
      'm7.experience': '多学科协作响应及时，抢救流程执行规范，与家属沟通充分并书面留痕完整，可作为科室同类病例参考。',
      'm7.problems': '危重患者病情动态观察记录间隔偏长，趋势预警不足；交接班时段高风险环节提示不够具体。',
      'm7.direction': '建立死亡病例预警评分定时记录制度，强化交接班清单管理与科内培训，并纳入质量改进计划跟踪落实。',
      'm8.measures': [
        { 'm8.content': '加强危重患者病情动态评估，落实每 4 小时预警评分记录并纳入交接班清单', 'm8.owner': c.attending, 'm8.due': Limit.donly(Date.now() + 15 * DAY), 'm8.expected': '评分记录完整率达到 95% 以上，缺陷项清零。' },
        { 'm8.content': '组织全科死亡病例讨论制度与急救流程专题培训，并进行理论与操作考核', 'm8.owner': nameOfScene(c, 'senior'), 'm8.due': Limit.donly(Date.now() + 25 * DAY), 'm8.expected': '培训覆盖率 100%，考核合格率 100%。' }
      ],
      'r1.name': c.name, 'r1.gender': c.gender, 'r1.age': c.age + '岁', 'r1.mrn': c.mrn,
      'r1.admitDate': Limit.donly(c.admitMs), 'r1.deathDate': Limit.donly(c.deathMs), 'r1.los': los,
      'r2.admitDx': c.admitDx || '入院诊断待补充', 'r2.deathDx': (c.deathDx || '死亡诊断待补充'),
      'r2.secondaryDx': c.secondaryDx || '呼吸循环衰竭',
      'r2.rootReason': ((c.deathDx || '基础疾病').split('，')[0]) + '进展导致重要器官功能不可逆衰竭，住院期间已给予规范诊疗与积极抢救。',
      'r3.measures': '入院后完善相关检查，予' + (c.hasSurgery ? (c.surgeryName + '及') : '') + '药物治疗、器官支持与对症治疗，持续心电监护。',
      'r3.keyNodes': Limit.donly(c.admitMs) + ' 入院；' + (c.hasSurgery ? '手术治疗后转入病房；' : '住院期间病情反复；') + Limit.donly(c.deathMs) + ' 抢救无效死亡。',
      'r3.change': '患者入院后病情进行性加重，' + Limit.dt(c.deathMs) + ' 出现意识丧失、大动脉搏动消失，经抢救无效宣布临床死亡。',
      'r4.directCause': '呼吸循环衰竭', 'r4.rootCause': (c.deathDx || '').split('，')[0], 'r4.trigger': '感染与有效循环血量不足',
      'r5.deathType': c.deathType === 'expected' ? '预期死亡' : (c.deathType === 'special' ? '特殊死亡' : '非预期死亡'),
      'r5.avoidable': '不可避免', 'r5.negligence': '否',
      'r6.rescueStart': Limit.dt(c.deathMs - 2 * HOUR), 'r6.rescueEnd': Limit.dt(c.deathMs),
      'r6.rescueMeasures': '持续心肺复苏、电除颤 3 次、肾上腺素与去甲肾上腺素静推及泵入、气管插管接呼吸机辅助通气，共抢救 120 分钟。',
      'r6.rescueEffect': '抢救无效，' + Limit.dt(c.deathMs) + ' 宣布临床死亡，已向家属充分告知。'
    };
    (q.item || []).forEach(function (m) {
      (m.item || []).forEach(function (fd) {
        if (fd.type === 'group') {
          out[fd.linkId] = (base[fd.linkId] || []).map(function (row) {
            var r = {};
            (fd.item || []).forEach(function (c2) { r[c2.linkId] = row[c2.linkId] != null ? row[c2.linkId] : ''; });
            return r;
          });
          return;
        }
        out[fd.linkId] = base[fd.linkId] != null ? base[fd.linkId] : (fd.required ? '演示内容：' + fd.text + '，符合制度与模板要求。' : '');
      });
    });
    return out;
  }

  global.Svc = {
    now: now, index: index, sampleAnswers: sampleAnswers, cases: cases, caseOf: caseOf, scopeOf: scopeOf, inScope: inScope, inScopeTask: inScopeTask,
    depts: depts, people: people, rid: rid, R_: R_, render: render,
    discussList: discussList, discussStatusCounts: discussStatusCounts, discussDetail: discussDetail,
    recordView: recordView, saveRecord: saveRecord, signRecord: signRecord, archiveRecord: archiveRecord,
    signaturePanel: signaturePanel, moduleProgress: moduleProgress, validateAnswers: validateAnswers,
    flatAnswers: flatAnswers, template: template, minLen: minLen, nonEmpty: nonEmpty,
    arrangeMeeting: arrangeMeeting, confirmAttend: confirmAttend, urgeAttendees: urgeAttendees,
    fetchCharts: fetchCharts, uploadChart: uploadChart, docText: docText, judgeDeathType: judgeDeathType,
    reviewView: reviewView, reportList: reportList, reportOverview: reportOverview, reportDetail: reportDetail,
    saveReport: saveReport, approveReport: approveReport, submitMs: submitMs,
    improveRows: improveRows, improveList: improveList, improveOverview: improveOverview, improveDetail: improveDetail,
    updateImprove: updateImprove, addExecNote: addExecNote, saveCompletion: saveCompletion,
    evaluateImprove: evaluateImprove, markExcellent: markExcellent, progressOf: progressOf,
    todoTypes: todoTypes, todos: todos, homeMetrics: homeMetrics, warnings: warnings, dischargeTotal: dischargeTotal,
    notices: notices, unreadCount: unreadCount, markRead: markRead, markAllRead: markAllRead, notifyScene: notifyScene,
    prov: prov, logsOf: logsOf, logsOfKind: logsOfKind, saveBasic: saveBasic, configList: configList,
    exportCsv: exportCsv, exportDoc: exportDoc, printHtml: printHtml,
    findPerson: findPerson, sceneOfPid: sceneOfPid, isSigner: isSigner, alreadySigned: alreadySigned,
    sortList: sortList, answersToItems: answersToItems, valueOfField: valueOfField, pidOfUser: pidOfUser
  };
})(typeof window !== 'undefined' ? window : globalThis);
