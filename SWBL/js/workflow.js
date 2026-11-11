/* =====================================================================
 * workflow.js —— 业务状态机（纯派生 + 流转守卫）
 * ---------------------------------------------------------------------
 * 原则：只存原始事实（会议是否安排、记录是否提交、签名是否齐、审核节点、
 * 执行报告与评估 Observation），业务状态一律现算，避免状态与事实不一致。
 * FHIR 表达：Task.status 承载粗粒度原生状态，Task.businessStatus 承载本系统
 * 细粒度业务状态（FHIR 正是为此设计的原生元素）。
 * ===================================================================== */
(function (global) {
  'use strict';

  var D = global.Domain, Limit = global.Limit;

  /* 细粒度业务状态 → FHIR Task.status 粗粒度 */
  var COARSE = {
    'to-organize': 'requested', 'in-progress': 'in-progress', 'to-sign': 'in-progress', 'archived': 'completed',
    'to-fill': 'requested', 'level-1': 'in-progress', 'level-2': 'in-progress', 'level-3': 'in-progress',
    'returned': 'in-progress', 'done': 'completed',
    'not-started': 'requested', 'to-evaluate': 'in-progress', 'cancelled': 'cancelled'
  };
  function coarseOf(status) { return COARSE[status] || 'requested'; }
  function businessStatusOf(task) {
    if (task && task.businessStatus && task.businessStatus.coding && task.businessStatus.coding[0]) {
      return task.businessStatus.coding[0].code;
    }
    return null;
  }

  /* ───── 讨论会议 ───── */
  // Appointment.status: proposed(草稿) / booked(已安排) / fulfilled(已召开) / cancelled(已改期)
  function meetingStage(appt) {
    if (!appt) return 'none';
    if (appt.status === 'fulfilled') return 'fulfilled';
    if (appt.status === 'booked') return 'booked';
    if (appt.status === 'proposed') return 'proposed';
    return 'none';
  }

  /* 参会人展示态：已确认 / 待确认 / 已请假 / 缺席（超过会议时间仍未确认） */
  function attendStatusOf(p, appt, now) {
    var st = p.status || 'needs-action';
    if (st === 'accepted') return 'accepted';
    if (st === 'declared-leave' || (p.ext && p.ext.leaveReason)) return 'declared-leave';
    var endMs = appt && appt.end ? Limit.parse(appt.end) : null;
    if (st === 'needs-action' && endMs != null && (now || Date.now()) > endMs) return 'absent';
    return st;
  }

  /* ───── 讨论记录（8 模块） ───── */
  /* 状态：none 未填写 / draft 草稿 / to-sign 待签名 / archived 已归档
   * 事实源：QuestionnaireResponse.status + Composition.status */
  function recordStatusOf(qr, comp) {
    if (comp && comp.status === 'final') return 'archived';
    if (!qr) return 'none';
    if (qr.status === 'draft') return 'draft';
    if (qr.status === 'submitted' || qr.status === 'amended') return 'to-sign';
    if (qr.status === 'completed') return 'archived';
    return 'none';
  }
  /* 编辑锁级别：none 可编辑 / content 内容锁（只可签名）/ full 完全锁 */
  function lockLevelOf(status) {
    if (status === 'archived') return 'full';
    if (status === 'to-sign') return 'content';
    return 'none';
  }

  /* ───── 上报单（6 模块 + 三级审核） ───── */
  /* 审核链路节点：[{level, roleCode, actorName, actorRef, status, assignedAt, actedAt, opinion, decision}]
   * status: pending | current | approved | returned | skipped */
  function reportStatusOf(qr, flow) {
    if (!flow || !flow.length) return qr && qr.status !== 'draft' ? 'level-1' : 'to-fill';
    if (!qr || qr.status === 'draft') {
      var anyReturn = flow.filter(function (n) { return n.status === 'returned'; });
      return anyReturn.length ? 'returned' : 'to-fill';
    }
    for (var i = 0; i < flow.length; i++) {
      if (flow[i].status === 'returned') return 'returned';
      if (flow[i].status === 'current' || flow[i].status === 'pending') {
        return 'level-' + (flow[i].level);
      }
    }
    return 'done';
  }
  function currentNode(flow) {
    for (var i = 0; i < (flow || []).length; i++) {
      if (flow[i].status === 'current' || flow[i].status === 'pending') return flow[i];
    }
    return null;
  }
  function returnedNode(flow) {
    var out = null;
    (flow || []).forEach(function (n) { if (n.status === 'returned') out = n; });
    return out;
  }
  /* 「我的审核状态」：待审核 / 已通过 / 已退回 / —（无需本人审核） */
  function myReviewStatus(flow, userId) {
    var mine = null;
    (flow || []).forEach(function (n) { if (n.actorRef === userId || n.demoUser === userId) mine = n; });
    if (!mine) return { code: 'none', name: '—', cls: 'gray' };
    if (mine.status === 'current') return { code: 'to-review', name: '待审核', cls: 'gray' };
    if (mine.status === 'approved') return { code: 'approved', name: '已通过', cls: 'green' };
    if (mine.status === 'returned') return { code: 'returned', name: '已退回', cls: 'orange' };
    return { code: 'waiting', name: '—', cls: 'gray' };
  }

  /* ───── 改进任务（PDCA） ───── */
  function improveStatusOf(task, evalObs) {
    var st = businessStatusOf(task);
    if (st) return st;
    if (task.status === 'cancelled') return 'cancelled';
    if (task.status === 'completed') return 'done';
    if (evalObs) return 'done';
    return task.status === 'in-progress' ? 'in-progress' : 'not-started';
  }
  /* 持续改进为派生徽标：存在 partOf 指向本任务的后继轮次 */
  function hasSuccessor(taskId, successors) {
    return (successors || []).indexOf(taskId) >= 0;
  }

  /* ───── 病历调阅状态 ───── */
  /* docs: [{docType, fetchError, sourceType}]；期望 6 类 */
  function chartStateOf(docs) {
    if (!docs || !docs.length) return { code: 'not-fetched', name: '未调阅', cls: 'gray' };
    var failed = docs.filter(function (d) { return d.fetchError; });
    var manual = docs.filter(function (d) { return d.sourceType === 'manual'; });
    if (failed.length) return { code: 'error', name: '接口异常待补充', cls: 'red' };
    if (manual.length) return { code: 'supplemented', name: '已调阅（含手动补充）', cls: 'green' };
    return { code: 'fetched', name: '已调阅', cls: 'green' };
  }

  /* ───── 讨论任务状态（综合派生） ─────
   * ctx = { task, appt, qr, comp, requiredSigners }
   * 讨论任务本身 completed / businessStatus=archived 时直接判定已完成
   * （历史病例可能没有会议与记录工件，只有任务收口时间） */
  function discussStatusOf(ctx) {
    var t = ctx.task;
    var bizT = t && t.businessStatus && t.businessStatus.coding[0] ? t.businessStatus.coding[0].code : null;
    if (bizT === 'archived' || (t && t.status === 'completed')) return 'archived';
    var stage = meetingStage(ctx.appt);
    var rec = recordStatusOf(ctx.qr, ctx.comp);
    if (rec === 'archived') return 'archived';
    if (rec === 'to-sign') return 'to-sign';
    if (stage === 'none' || stage === 'proposed') return 'to-organize';
    return 'in-progress';
  }

  /* ───── 讨论进度步骤条（5 节点，文案按「已完成=已X / 当前=待X」派生） ───── */
  var STEPS = [
    { key: 'schedule', verb: '安排会议' },
    { key: 'meet', verb: '召开会议' },
    { key: 'document', verb: '填写讨论记录' },
    { key: 'sign', verb: '完成签名' },
    { key: 'archive', verb: '提交归档' }
  ];
  function stepBar(ctx) {
    var stage = meetingStage(ctx.appt);
    var rec = recordStatusOf(ctx.qr, ctx.comp);
    var closed = discussStatusOf(ctx) === 'archived';
    var heldAt = ctx.task && ctx.task.executionPeriod && ctx.task.executionPeriod.end;
    var done = {
      schedule: stage === 'booked' || stage === 'fulfilled' || closed,
      meet: stage === 'fulfilled' || !!heldAt || closed,
      document: rec === 'to-sign' || rec === 'archived' || closed,
      sign: rec === 'archived' || allRequiredSigned(ctx) || closed,
      archive: rec === 'archived' || closed
    };
    var idx = -1;
    for (var i = 0; i < STEPS.length; i++) if (!done[STEPS[i].key]) { idx = i; break; }
    return STEPS.map(function (s, i) {
      return {
        key: s.key,
        state: done[s.key] ? 'done' : (i === idx ? 'current' : 'pending'),
        name: done[s.key] ? '已' + s.verb : (i === idx ? '待' + s.verb : s.verb),
        at: done[s.key] ? stepTime(s.key, ctx) : null
      };
    });
  }
  function allRequiredSigned(ctx) {
    if (!ctx.comp || !ctx.comp.attester) return false;
    var need = (ctx.requiredSigners || []).length;
    if (!need) return false;
    var signed = ctx.comp.attester.filter(function (a) { return a.mode === 'legal' || a.mode === 'official'; }).length;
    return signed >= need;
  }
  function stepTime(key, ctx) {
    if (key === 'schedule') return ctx.appt ? Limit.parse(ctx.appt._savedAt) : null;
    if (key === 'meet') return ctx.appt && ctx.appt.start ? Limit.parse(ctx.appt.start) : null;
    if (key === 'document') return ctx.qr && ctx.qr.authoredDate ? Limit.parse(ctx.qr.authoredDate) : null;
    if (key === 'sign') return ctx.comp && ctx.comp.date ? Limit.parse(ctx.comp.date) : null;
    if (key === 'archive') return ctx.comp && ctx.comp.ext && ctx.comp.ext.archivedAt ? Limit.parse(ctx.comp.ext.archivedAt) : null;
    return null;
  }

  /* ───── 流转守卫 ───── */
  var GUARDS = {
    discuss: {
      'to-organize': ['in-progress'],
      'in-progress': ['to-sign', 'to-organize'],
      'to-sign': ['archived', 'in-progress'],
      'archived': []
    },
    report: {
      'to-fill': ['level-1', 'returned'],
      'returned': ['level-1', 'level-2', 'level-3'],
      'level-1': ['level-2', 'returned', 'level-1'],
      'level-2': ['level-3', 'returned', 'level-1'],
      'level-3': ['done', 'returned', 'level-1'],
      'done': []
    },
    improve: {
      'not-started': ['in-progress', 'cancelled'],
      'in-progress': ['to-evaluate', 'cancelled', 'in-progress'],
      'to-evaluate': ['done', 'in-progress'],
      'done': [], 'cancelled': []
    },
    record: {
      'none': ['draft'], 'draft': ['to-sign'], 'to-sign': ['archived', 'draft'], 'archived': []
    }
  };
  function assertTransition(flowKind, from, to, actor) {
    var g = GUARDS[flowKind] || {};
    var allow = g[from] || [];
    if (allow.indexOf(to) >= 0) return { ok: true };
    return {
      ok: false,
      reason: (actor ? actor + '：' : '') + '当前状态「' + statusName(flowKind, from) + '」不允许流转到「' + statusName(flowKind, to) + '」'
    };
  }
  function statusName(flowKind, code) {
    if (flowKind === 'discuss') return D.discussStatusName(code);
    if (flowKind === 'report') return D.reportStatusName(code);
    if (flowKind === 'improve') return D.improveStatusName(code);
    if (flowKind === 'record') return D.recordStatusName(code);
    return code;
  }

  global.Flow = {
    COARSE: COARSE, coarseOf: coarseOf, businessStatusOf: businessStatusOf,
    meetingStage: meetingStage, attendStatusOf: attendStatusOf,
    recordStatusOf: recordStatusOf, lockLevelOf: lockLevelOf,
    reportStatusOf: reportStatusOf, currentNode: currentNode, returnedNode: returnedNode,
    myReviewStatus: myReviewStatus, improveStatusOf: improveStatusOf, hasSuccessor: hasSuccessor,
    chartStateOf: chartStateOf, discussStatusOf: discussStatusOf,
    STEPS: STEPS, stepBar: stepBar, assertTransition: assertTransition, statusName: statusName,
    allRequiredSigned: allRequiredSigned
  };
})(typeof window !== 'undefined' ? window : globalThis);
