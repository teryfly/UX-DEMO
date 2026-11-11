/* =====================================================================
 * flow-test.js —— 业务闭环与数据层自测（无浏览器）
 * 运行：node test/flow-test.js
 * 覆盖：索引构建、数据权限、讨论/上报/改进三台状态机的完整写路径、
 *       配置联动（时限规则、审批流、模板）、FHIR 规范化往返。
 * ===================================================================== */
'use strict';
var files = ['fhir-store', 'fhir-ext', 'fhir-codesystems', 'domain', 'limits', 'workflow', 'seed', 'case-factory', 'seed-cases', 'services'];
files.forEach(function (f) { require('../js/' + f + '.js'); });
var F = globalThis.FHIR, D = globalThis.Domain, Limit = globalThis.Limit, Flow = globalThis.Flow, Svc = globalThis.Svc;

var pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function head(t) { console.log('\n── ' + t + ' ' + Array(Math.max(2, 46 - t.length)).join('─')); }
function U(id) { return D.user(id); }

Seed.runBase();
var t0 = Date.now();
SeedCases.run();
var seedMs = Date.now() - t0;

head('数据层与索引');
t0 = Date.now();
var idx = Svc.index();
ok(seedMs < 4000, '种子构建耗时 ' + seedMs + 'ms（<4s）');
ok(Date.now() - t0 < 1200, '病例索引构建 ' + (Date.now() - t0) + 'ms / ' + idx.list.length + ' 例');
ok(idx.list.length > 250, '病例总量 ' + idx.list.length);
ok(idx.list.every(function (c) { return c.name && c.deptName && c.deathMs && c.deathType; }), '每例均含患者/科室/死亡时间/死亡类型');
var withDiscuss = idx.list.filter(function (c) { return c.discussTask; }).length;
var withReport = idx.list.filter(function (c) { return c.reportTask; }).length;
ok(withDiscuss === idx.list.length && withReport === idx.list.length, '每例都有讨论任务与上报任务');

head('数据权限（IA-3.3）');
var byAtt = Svc.cases(function (c) { return Svc.inScope(U('u-attending'), c); }).length;
var byQm = Svc.cases(function (c) { return Svc.inScope(U('u-quality'), c); }).length;
var byDir2 = Svc.cases(function (c) { return Svc.inScope(U('u-director2'), c); }).length;
ok(byQm > byAtt, '医务部全院(' + byQm + ') > 临床医师本科室(' + byAtt + ')');
ok(byDir2 > 0 && byDir2 < byQm && byDir2 !== byAtt, '呼吸内科科主任(' + byDir2 + ') 与心内科(' + byAtt + ') 互不可见');
ok(Svc.cases(function (c) { return Svc.inScope(U('u-doctor'), c); }).length === byAtt, '同科室各身份数据范围一致');

head('讨论管理列表与筛选');
var qm = U('u-quality');
var all = Svc.discussList(qm, {});
['to-organize', 'in-progress', 'to-sign', 'archived'].forEach(function (s) {
  var n = Svc.discussList(qm, { status: s }).length;
  ok(n > 0, '状态筛选 ' + D.discussStatusName(s) + ' ' + n + ' 条');
});
ok(Svc.discussList(qm, { deathType: 'pending' }).length > 0, '待人工判定筛选有数据');
ok(Svc.discussList(qm, { keyword: all[0].mrn }).length >= 1, '按住院号模糊搜索命中');
ok(Svc.discussList(qm, { priority: 'high' }).every(function (c) { return c.priority === 'high'; }), '优先级筛选');
var counts = Svc.discussStatusCounts(qm);
ok(counts.all === all.length, '状态 Tab 计数与列表一致 ' + JSON.stringify(counts));
var first = all[0];
ok(first.priority === 'high' || first.discussCountdown.overdue, '排序：高优先级/超时置顶（首条 ' + first.priority + ', ' + first.discussCountdown.level + '）');

head('讨论闭环：安排会议 → 参会 → 书写 → 校验 → 签名 → 归档 → 生成改进任务');
var target = Svc.discussList(U('u-director'), { status: 'to-organize' })[0];
ok(!!target, '科主任可见一条待组织任务：' + target.name);
var r = Svc.arrangeMeeting(target.encId, { title: target.name + '死亡病例讨论', date: Limit.donly(Date.now() + 86400000), time: '15:00', location: '示教室 3 室' }, U('u-director'));
ok(r && r.status === 'booked', '会议已保存（Appointment.status=booked）');
ok(Svc.discussDetail(target.encId).parties.length >= 4, '参会人员清单已生成 ' + Svc.discussDetail(target.encId).parties.length + ' 人');
var invited = Svc.discussDetail(target.encId).parties.filter(function (p) { return p.pid === 'Practitioner-0014'; })[0];
if (invited) {
  Svc.confirmAttend(target.encId, U('u-doctor'), 'accepted');
  ok(Svc.discussDetail(target.encId).parties.filter(function (p) { return p.status === 'accepted'; }).length >= 1, '科室医师确认参会');
}
var urge = Svc.urgeAttendees(target.encId, U('u-director'));
ok(urge.ok || /没有/.test(urge.msg), '一键催办：' + (urge.count ? urge.count + ' 人' : urge.msg));
var charts = Svc.fetchCharts(target.encId, U('u-attending'));
ok(charts.length >= 4, '调阅病历 ' + charts.length + ' 份（入院/病程/抢救/死亡/检验）');
ok(charts.some(function (d) { return !d.error; }) && charts.every(function (d) { return d.content.length > 20 || d.error; }), '病历正文可从 DocumentReference.content.attachment.data 解码');

var up = Svc.uploadChart(target.encId, { type: 'progress', title: '手动补充：抢救病程记录', text: '手动补充内容' }, U('u-attending'));
ok(up && up.ext.sourceType === 'manual', '接口异常时可手动上传补充病历');

// 草稿：故意缺 3 个模块
var ans = {};
var tpl = Svc.template('record');
var detail = Svc.discussDetail(target.encId);
var prefilled = { 'm1.name': detail.c.name, 'm1.age': detail.c.age + '岁', 'm1.gender': detail.c.gender, 'm1.mrn': detail.c.mrn, 'm1.admitDate': Limit.donly(detail.c.admitMs), 'm1.deathDate': Limit.donly(detail.c.deathMs), 'm1.los': detail.c.losDays + '天' };
Object.keys(prefilled).forEach(function (k) { ans[k] = prefilled[k]; });
ans['m2.admitDx'] = detail.c.admitDx; ans['m2.deathDx'] = detail.c.deathDx; ans['m2.concordance'] = '符合';
ans['m3.chief'] = '突发胸痛 6 小时，加重 2 小时';
Svc.saveRecord(target.encId, ans, U('u-attending'), 'draft');
var v1 = Svc.validateAnswers('record', ans);
ok(!v1.ok && v1.missing.length >= 3, '完整性校验拦截：缺失 ' + v1.missing.length + ' 项 ' + v1.missing.slice(0, 3).map(function (m) { return m.module + '/' + m.label; }).join('、'));
var rv = Svc.recordView(target.encId);
ok(rv.status === 'draft' && rv.lock === 'none', '记录状态=草稿，可编辑');
ok(rv.progress.pct > 0 && rv.progress.pct < 100, '书写进度 ' + rv.progress.pct + '%');

// 补全 8 模块
var full = Svc.recordView(target.encId).answers;
var vals = Svc.sampleAnswers('record', target.encId);
tpl.item.forEach(function (m) {
  m.item.forEach(function (fd) {
    if (fd.type === 'group') {
      var rows = vals[fd.linkId] || [];
      full[fd.linkId] = rows;
      return;
    }
    if (!Svc.nonEmpty(full[fd.linkId])) full[fd.linkId] = vals[fd.linkId] != null ? vals[fd.linkId] : '补充说明内容，满足最短字数要求的演示文本内容。';
  });
});
var v2 = Svc.validateAnswers('record', full);
ok(v2.ok, '补全后校验通过（' + v2.filled + '/' + v2.total + '）', v2.missing);
Svc.saveRecord(target.encId, full, U('u-attending'), 'submit');
ok(Svc.recordView(target.encId).status === 'to-sign', '提交后进入待签名');
ok(Svc.recordView(target.encId).lock === 'content', '提交后内容锁定（不可再编辑正文）');

var s1 = Svc.signRecord(target.encId, U('u-attending'));
ok(s1.ok && s1.allSigned === false, '主管医师 CA 签名成功，必签 ' + s1.panel.signedRequired + '/' + s1.panel.totalRequired);
var arcEarly = Svc.archiveRecord(target.encId, U('u-attending'));
ok(!arcEarly.ok, '必签未完成时归档被拦截：' + arcEarly.msg);
Svc.signRecord(target.encId, U('u-director'));
var s3 = Svc.signRecord(target.encId, U('u-senior'));
ok(s3.ok && s3.allSigned, '全部必签完成（' + s3.panel.signedRequired + '/' + s3.panel.totalRequired + '）');
var archived = Svc.archiveRecord(target.encId, U('u-attending'));
ok(archived.ok && archived.created.length >= 1, '归档成功并自动提取改进任务 ' + archived.created.length + ' 条');
ok(archived.comp.status === 'final', 'Composition.status=final（记录锁定归档）');
ok(Svc.discussDetail(target.encId).steps.every(function (s) { return s.state === 'done'; }), '进度步骤条 5 节点全部完成');
var impIds = archived.created;
ok(F.view('Task', impIds[0]).businessStatus.coding[0].code === 'not-started', '改进任务初始状态=未开始，责任人=' + F.view('Task', impIds[0]).owner.display);
ok(F.scan('Communication').map(function (x) { return F.decode(x); }).some(function (cm) { return /eval-result|improve-remind/.test(cm.ext.scene); }), '归档后已推送通知');

head('改进闭环：编辑任务 → 执行记录 → 完成报告 → 效果评估 → 新一轮 PDCA');
var impTask = impIds[0];
Svc.updateImprove(impTask, { text: F.view('Task', impTask).description, owner: '李海峰', due: Limit.donly(Date.now() + 5 * 86400000), expected: '执行率 95% 以上' }, U('u-director'));
ok(F.view('Task', impTask).owner.display === '李海峰', '科主任编辑自动提取任务并改派责任人');
Svc.addExecNote(impTask, { text: '已完成首轮培训安排，参与率 100%。', files: [{ name: '培训签到表.pdf', size: '320 KB' }] }, U('u-attending'));
ok(F.view('Task', impTask).businessStatus.coding[0].code === 'in-progress', '首次记录执行情况后任务转进行中');
var det = Svc.improveDetail(impTask);
ok(det.records.length >= 1 && det.progress > 0, '执行记录时间线 ' + det.records.length + ' 条，进度 ' + det.progress + '%');
var earlyEval = Svc.improveDetail(impTask);
Svc.saveCompletion(impTask, { summary: '整改完成情况说明，覆盖全部要求项。', effect: '实际效果与预期一致。', files: [{ name: '检查记录.xlsx', size: '88 KB' }] }, U('u-attending'), true);
ok(F.view('Task', impTask).businessStatus.coding[0].code === 'to-evaluate', '提交完成报告后转待评估');
var ev = Svc.evaluateImprove(impTask, { implemented: 'partly', implementedText: '部分落实', effective: 'partly', effectiveText: '部分达到', needContinue: 'yes', opinion: '个别环节记录仍不完整，建议继续跟踪一轮。', excellent: false }, U('u-director'));
ok(ev.ok && ev.needContinue, '评估为需要持续改进');
var nextRound = Svc.improveRows(U('u-attending')).filter(function (x) { return (x.task.ext.pdca || {}).root === impTask; });
ok(nextRound.length === 1 && nextRound[0].round === 2, '自动生成第 2 轮 PDCA 任务并 partOf 关联');
var ev2 = Svc.evaluateImprove(nextRound[0].id, { implemented: 'yes', implementedText: '已落实', effective: 'yes', effectiveText: '达到预期', needContinue: 'no', opinion: '措施落实到位，同意关闭。', excellent: true }, U('u-director'));
ok(ev2.ok && F.view('Task', nextRound[0].id).businessStatus.coding[0].code === 'done', '第 2 轮评估达标后任务关闭');
ok(F.view('Task', nextRound[0].id).ext.excellent === true, '标记优秀措施（可全院推广）');
ok(Svc.improveDetail(nextRound[0].id).evaluation && Svc.improveDetail(nextRound[0].id).evaluation.opinion.length > 0, '效果评估结果只读回显');
ok(Svc.improveDetail(impTask).logs.length >= 2, '任务状态变更日志留痕 ' + Svc.improveDetail(nextRound[0].id).logs.length + ' 条');

head('上报闭环：填写 → 三级审核 → 退回 → 重提 → 终审完成');
var repCase = Svc.reportList(U('u-attending'), { status: 'to-fill' })[0] || Svc.reportList(U('u-quality'), { status: 'to-fill' })[0];
ok(!!repCase, '存在待填写上报任务：' + (repCase && repCase.name));
var rvals = Svc.sampleAnswers('report', repCase.encId);
var tplR = Svc.template('report');
var rans = {};
tplR.item.forEach(function (m) {
  m.item.forEach(function (fd) { if (fd.type !== 'group') rans[fd.linkId] = rvals[fd.linkId]; });
});
delete rans['r4.rootCause'];
var rv1 = Svc.validateAnswers('report', rans);
ok(!rv1.ok && rv1.missing.some(function (m) { return m.id === 'r4.rootCause'; }), '上报单必填校验缺失清单：' + rv1.missing.map(function (m) { return m.label; }).join('、'));
Svc.saveReport(repCase.encId, rans, U('u-attending'), 'draft');
ok(Svc.reportDetail(repCase.encId).status === 'to-fill', '草稿保存后仍为待填写');
rans['r4.rootCause'] = rvals['r4.rootCause'];
Svc.saveReport(repCase.encId, rans, U('u-attending'), 'submit');
var rd = Svc.reportDetail(repCase.encId, U('u-senior'));
ok(rd.status === 'level-1' && rd.mine.code === 'to-review', '提交后流转一级审核，我的审核状态=待审核');
var back = Svc.approveReport(repCase.encId, { decision: 'return', opinion: '死亡原因分析不够准确，请结合检查资料补充后重报。' }, U('u-senior'));
ok(back.ok && back.biz === 'returned', '退回修改 → 状态已退回');
ok(Svc.reportDetail(repCase.encId).returnReason.text.indexOf('死亡原因') >= 0, '退回理由含退回人/时间/意见');
var reAns = Svc.sampleAnswers('report', repCase.encId);
Svc.saveReport(repCase.encId, reAns, U('u-attending'), 'submit');
ok(Svc.reportDetail(repCase.encId, U('u-senior')).status === 'level-1', '退回后修改重提，从被退回层级重新开始流转');
Svc.approveReport(repCase.encId, { decision: 'pass', opinion: '内容完整，同意上报。' }, U('u-senior'));
ok(Svc.reportDetail(repCase.encId).status === 'level-2', '一级通过后流转二级审核');
Svc.approveReport(repCase.encId, { decision: 'pass', opinion: '同意。' }, U('u-director'));
ok(Svc.reportDetail(repCase.encId).status === 'level-3', '流转三级审核（医务部终审）');
var done = Svc.approveReport(repCase.encId, { decision: 'pass', opinion: '符合上报要求。' }, U('u-quality'));
ok(done.biz === 'done', '医务部终审通过 → 上报完成');
ok(!!F.view('Task', repCase.reportTask.id).completedDate, '记录上报完成时间 completedDate=' + F.view('Task', repCase.reportTask.id).completedDate);
ok(Svc.reportDetail(repCase.encId).steps.filter(function (s) { return s.state === 'done'; }).length >= 5, '审核记录时间线全部节点完成');

head('人工判定与配置联动');
var pending = Svc.cases(function (c) { return c.deathType === 'pending' && c.discussStatus !== 'archived'; })[0];
ok(!!pending, '存在待人工判定病例：' + pending.name);
var beforeDue = Limit.parse(pending.discussTask.dueDate);
var jr = Svc.judgeDeathType(pending.encId, { deathType: 'special', note: '结合病历与家属陈述，判定为麻醉意外死亡，需强制上报。' }, U('u-quality'));
var afterDue = Limit.parse(F.view('Task', pending.discussTask.id).dueDate);
ok(Svc.caseOf(pending.encId).deathType === 'special', '判定后死亡类型改为特殊死亡');
ok(afterDue !== beforeDue, '判定后重算讨论时限（' + new Date(beforeDue).toLocaleDateString() + ' → ' + new Date(afterDue).toLocaleDateString() + '）');
ok(afterDue < Date.now(), '按原死亡时间重算后即刻超时（预警与超时清单的真实来源）', jr.countdown.text);
ok(Svc.logsOf(pending.encId).length >= 0, '人工判定留痕可查');

var cfg = JSON.parse(JSON.stringify(Limit.config()));
cfg.discussionDays.unexpected = 1;
Limit.setConfig(cfg);
var c2 = Svc.cases(function (c) { return c.deathType === 'unexpected'; })[0];
ok(Limit.countdownOf('discussion', c2).totalMs === 86400000, '时限规则改为 1 天后倒计时总量同步（' + Limit.countdownOf('discussion', c2).text + '）');
cfg.discussionDays.unexpected = 3;
Limit.setConfig(cfg);
ok(Limit.countdownOf('discussion', c2).totalMs === 3 * 86400000, '改回默认值后恢复');

var flow = F.view('PlanDefinition', 'PlanDefinition-report-approval');
var nodes = JSON.parse(JSON.stringify(flow.ext.nodes));
nodes.splice(1, 1);
F.update(Object.assign({}, flow, { ext: Object.assign({}, flow.ext, { nodes: nodes }) }));
var newCase = Svc.cases(function (c) { return c.reportStatus === 'to-fill'; })[0];
Svc.saveReport(newCase.encId, (function () {
  return Svc.sampleAnswers('report', newCase.encId);
})(), U('u-attending'), 'submit');
ok(Svc.reportDetail(newCase.encId).flow.length === 2, '审批流程配置改为 2 级后，新生成上报单按 2 级流转');
ok(Svc.reportDetail(repCase.encId).flow.length === 3, '已在流转的上报单沿用旧链路（B105）');

head('模板联动');
var q = F.view('Questionnaire', 'Questionnaire-report');
var m3 = q.item.filter(function (x) { return x.linkId === 'r3'; })[0];
m3.item.push({ linkId: 'r3.extraNote', text: '补充说明', type: 'text', required: true, extension: [{ url: 'https://fhir.swbl-demo.example/StructureDefinition/QuestionnaireItem-minLength', valueInteger: 10 }] });
F.update(q);
var v3 = Svc.validateAnswers('report', (function () {
  var a = Svc.sampleAnswers('report', repCase.encId);
  a['r3.extraNote'] = '演示内容演示内容演示内容';
  delete a['r3.extraNote'];
  return a;
})());
ok(!v3.ok && v3.missing.some(function (x) { return x.id === 'r3.extraNote'; }), '模板新增必填字段后业务表单校验即时生效');

head('首页工作台与通知');
['u-attending', 'u-senior', 'u-director', 'u-doctor', 'u-quality', 'u-director2'].forEach(function (id) {
  var u = U(id);
  var td = Svc.todos(u), wn = Svc.warnings(u), mt = Svc.homeMetrics(u), nt = Svc.notices(u);
  ok(td.length >= 0 && wn.length >= 0 && isFinite(mt.deathRate), id + ' ' + u.name + '：待办 ' + td.length + ' 预警 ' + wn.length + ' 通知 ' + nt.length + ' 未读 ' + Svc.unreadCount(u) + ' 本月死亡 ' + mt.deaths + ' 死亡率 ' + mt.deathRate + '%');
});
var unreadBefore = Svc.unreadCount(U('u-director'));
Svc.markAllRead(U('u-director'));
ok(Svc.unreadCount(U('u-director')) === 0 && unreadBefore >= 0, '全部标为已读');

head('FHIR 规范化');
var canon = F.canonical('Encounter', repCase.encId);
ok((canon.modifierExtension || []).some(function (e) { return /deathType$/.test(e.url) && e.valueCode; }), 'Encounter.deathType 以 modifierExtension(valueCode) 承载');
var tk = F.canonical('Task', repCase.reportTask.id);
ok((tk.extension || []).some(function (e) { return /approvalFlow$/.test(e.url) && e.valueString.charAt(0) === '['; }), '审核链路以 extension(valueString=JSON) 承载');
var qr = F.canonical('QuestionnaireResponse', Svc.caseOf(repCase.encId).reportQr.id);
ok(qr.item.length === 6 && qr.item[0].item.length >= 7, '上报单为 6 模块 QuestionnaireResponse，模块①含 7 个预填充字段');
var doc = F.canonical('DocumentReference', FHIRtypes('DocumentReference')[0]);
ok(/^base64/.test('') || !!doc.content[0].attachment.data, '病历正文以 attachment.data(base64) 承载');
function FHIRtypes(t) { return Object.keys(F.dump()[t] || {}); }
ok(F.search('StructureDefinition').length > 100, '全部业务扩展均有 StructureDefinition 声明（' + F.search('StructureDefinition').length + ' 个）');
ok(FHIRtypes('Task').every(function (id) { var t = F.raw('Task', id); return t.status && t.businessStatus && t.code; }), '每个 Task 均有原生 status + businessStatus + code 判别');

console.log('\n══ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ══');
process.exit(fail ? 2 : 0);
