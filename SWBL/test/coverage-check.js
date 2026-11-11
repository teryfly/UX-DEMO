/* 种子覆盖矩阵自检：确认每种状态/类型/预警都有数据可演示 */
'use strict';
var files = ['fhir-store', 'fhir-ext', 'fhir-codesystems', 'domain', 'limits', 'workflow', 'seed', 'case-factory', 'seed-cases'];
files.forEach(function (f) { require('../js/' + f + '.js'); });
var F = globalThis.FHIR, D = globalThis.Domain, Limit = globalThis.Limit;

Seed.runBase();
SeedCases.run();

var now = Date.now();
function tally(obj, k) { obj[k] = (obj[k] || 0) + 1; }

var biz = {};
F.scan('Task').forEach(function (r) {
  var code = r.code.coding[0].code;
  var b = r.businessStatus && r.businessStatus.coding[0] ? r.businessStatus.coding[0].code : '-';
  biz[code] = biz[code] || {};
  tally(biz[code], b);
});
console.log('① 任务业务状态：', JSON.stringify(biz));

var dt = {};
F.scan('Encounter').forEach(function (r) {
  var e = (r.modifierExtension || []).filter(function (x) { return /deathType$/.test(x.url); })[0];
  tally(dt, e ? e.valueCode : 'none');
});
console.log('② 死亡类型分布：', JSON.stringify(dt));

var pri = {};
F.scan('Task').filter(function (r) { return r.code.coding[0].code === 'discussion'; })
  .forEach(function (r) { tally(pri, r.priority); });
console.log('③ 优先级分布：', JSON.stringify(pri));

var lv = { discussion: {}, report: {} };
var openEnc = {};
F.scan('Task').forEach(function (r) {
  if (r.code.coding[0].code !== 'discussion') return;
  var b = r.businessStatus && r.businessStatus.coding[0] ? r.businessStatus.coding[0].code : '';
  if (b === 'archived') return;
  if (r.encounter) openEnc[r.encounter.reference.split('/')[1]] = 1;
});
F.scan('Encounter').forEach(function (r) {
  if (!openEnc[r.id]) return;
  var e = F.decode(r);
  var c = { deathType: e.ext.deathType, deathTimeMs: Limit.parse(e.period.end) };
  tally(lv.discussion, Limit.countdownOf('discussion', c, now).level);
  tally(lv.report, Limit.countdownOf('report', c, now).level);
});
console.log('④ 倒计时色标（在办病例 ' + Object.keys(openEnc).length + ' 例）：', JSON.stringify(lv));

var imp = { over: 0, soon: 0, normal: 0, excellent: 0, round2: 0, withReport: 0, evaluated: 0 };
F.scan('Task').forEach(function (r) {
  var e = F.decode(r);
  if (e.ext.taskKind !== 'improvement') return;
  if (e.ext.excellent) imp.excellent++;
  if (e.ext.pdca && e.ext.pdca.round > 1) imp.round2++;
  if (e.ext.completionReport) imp.withReport++;
  var st = e.businessStatus.coding[0].code;
  if (st === 'done' || st === 'cancelled') return;
  var s = Limit.improveStateOf(Limit.parse(e.dueDate), now);
  if (s.state === 'overdue') imp.over++; else if (s.state === 'soon') imp.soon++; else imp.normal++;
});
imp.evaluated = F.scan('Observation').filter(function (r) {
  return r.code.coding[0].code === 'improvement-eval';
}).length;
console.log('⑤ 改进任务：', JSON.stringify(imp));

var docStat = { total: 0, error: 0, manual: 0, byType: {} };
F.scan('DocumentReference').forEach(function (r) {
  var e = F.decode(r);
  docStat.total++;
  if (e.ext.fetchError) docStat.error++;
  if (e.ext.sourceType === 'manual') docStat.manual++;
  tally(docStat.byType, e.ext.docType);
});
console.log('⑥ 病历文档：', JSON.stringify(docStat));

var comms = {};
F.scan('Communication').forEach(function (r) {
  var e = F.decode(r);
  (e.ext.targetUser || '').split(',').filter(Boolean).forEach(function (u) { tally(comms, u); });
});
console.log('⑦ 通知按演示身份：', JSON.stringify(comms));

['u-attending', 'u-senior', 'u-director', 'u-doctor', 'u-quality', 'u-director2'].forEach(function (u) {
  var mine = F.scan('Encounter').map(function (r) { return F.decode(r); }).filter(function (e) {
    var usr = D.user(u);
    if (!usr) return false;
    if (usr.navRole === 'quality') return true;
    return e.serviceProvider && e.serviceProvider.display === usr.dept;
  });
  console.log('⑧ 数据范围 ' + u + '(' + D.user(u).dept + ')：可见病例 ' + mine.length);
});
console.log('⑨ QR：讨论记录', F.search('QuestionnaireResponse', function (r) { return /discussion-record/.test(r.questionnaire || ''); }).length,
  '上报单', F.search('QuestionnaireResponse', function (r) { return /death-case-report/.test(r.questionnaire || ''); }).length);
console.log('⑩ 签名 Composition：final', F.search('Composition', function (c) { return c.status === 'final'; }).length,
  'preliminary', F.search('Composition', function (c) { return c.status === 'preliminary'; }).length);
console.log('⑪ 出院人数 Observation：', F.scan('Observation').filter(function (r) { return r.code.coding[0].code === 'serv-pop-discharges'; }).length);
