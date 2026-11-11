/* =====================================================================
 * ui-flow-test.js —— 在渲染出的 DOM 上点击走通主流程（jsdom）
 * 运行：node test/ui-flow-test.js
 * 目的：验证「页面按钮 ↔ services 写路径」真实接线（而不只是服务层可用）：
 *   科主任安排会议 → 主管医师书写并提交 → 三方 CA 签名 → 提交归档生成改进任务
 *   → 上报三级审核退回与重提 → 医务部人工判定 → 时限规则保存后全局倒计时翻面
 *   → 角色权限配置即时影响导航可见性
 * ===================================================================== */
'use strict';
var fs = require('fs');
var path = require('path');
var JSDOM = require(path.join(__dirname, '..', '..', 'KJYWFJ', 'node_modules', 'jsdom')).JSDOM;
var ROOT = path.join(__dirname, '..');

var CORE = ['lib/vue.global.prod.js', 'js/fhir-store.js', 'js/fhir-ext.js', 'js/fhir-codesystems.js', 'js/domain.js',
  'js/limits.js', 'js/workflow.js', 'js/seed.js', 'js/case-factory.js', 'js/seed-cases.js',
  'js/services.js', 'js/stats.js', 'js/components/common.js', 'js/app.js'];
var pages = fs.readdirSync(path.join(ROOT, 'js', 'pages')).filter(function (f) { return /\.js$/.test(f); }).map(function (f) { return 'js/pages/' + f; });
var files = CORE.concat(pages);

var errors = [];
var dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
var win = dom.window, doc = win.document;
win.scrollTo = function () { };
win.open = function () { return { document: { write: function () { }, close: function () { } }, focus: function () { }, print: function () { } }; };
win.console.error = function () { errors.push(Array.prototype.join.call(arguments, ' ')); };
win.console.warn = function () { };
win.addEventListener('error', function (e) { errors.push('window.error ' + e.message); });
process.on('unhandledRejection', function (e) { errors.push('rejection ' + ((e && e.message) || e)); });
win.eval('window.AMS = { components: {}, pages: {} };');   // 与 index.html 内联声明一致

files.forEach(function (f) {
  try { win.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')); }
  catch (e) { console.log('✗ 加载 ' + f + ' → ' + e.message); process.exit(1); }
});
try {
  win.eval('Seed.runBase(); SeedCases.run(); __BOOT__();');
} catch (e) { console.log('✗ 启动失败 → ' + e.message); process.exit(1); }

var App = win.App, Svc = win.Svc, D = win.Domain, F = win.FHIR, Limit = win.Limit;
var pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + x : '')); } }
function h1text() { var e = doc.querySelector('h1'); return e ? e.textContent : ''; }
function win_doc_h1() { return h1text(); }
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 45); }); }
function all(sel) { return [].slice.call(doc.querySelectorAll(sel)); }
function byText(txt) {
  return all('button, a, .btn-link, .chip, .sn, .t').filter(function (el) {
    return (el.textContent || '').replace(/\s+/g, '').indexOf(txt.replace(/\s+/g, '')) >= 0;
  })[0] || null;
}
function click(el, name) {
  if (!el) { ok(false, '点击 ' + name, '未找到元素'); return false; }
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  return true;
}
function type(el, value) {
  if (!el) return false;
  el.value = value;
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
  return true;
}
function pickRadio(value) {
  var r = all('input[type=radio]').filter(function (x) { return x.value === value; })[0];
  if (!r) return false;
  r.checked = true;
  r.dispatchEvent(new win.Event('change', { bubbles: true }));
  return true;
}
function checkIt(el) { if (!el) return false; el.checked = true; el.dispatchEvent(new win.Event('change', { bubbles: true })); return true; }
function lastText(txt) {
  var list = all('button').filter(function (el) {
    return (el.textContent || '').replace(/\s+/g, '').indexOf(txt.replace(/\s+/g, '')) >= 0;
  });
  return list.length ? list[list.length - 1] : null;
}
function confirmYes() {
  var b = lastText('确 定') || lastText('确定') || lastText('确认归档') || lastText('确认判定') || lastText('仍然保存');
  return click(b, '确认框·确定');
}

(async function () {
  await tick(160);
  console.log('DOM 就绪，按钮 ' + all('button').length + ' 个');

  /* ── 1. 科主任：列表 → 详情 → 安排会议 ── */
  App.switchUser('u-director');
  App.navigate('discuss-list', {});
  await tick(90);
  var target = Svc.cases(function (c) {
    return c.discussStatus === 'to-organize' && c.deptName === '心血管内科' && c.attending === '李海峰';
  })[0];
  ok(!!target, '定位心内科待组织病例：' + (target && target.name));
  App.goCase('discuss-detail', target.encId);
  await tick(90);
  click(byText('安排会议'), '安排会议');
  await tick(70);
  ok(!!doc.querySelector('input[type=date]'), '会议表单已展开');
  type(all('input[type=text]')[0], target.name + '死亡病例讨论（UI 自测）');
  type(all('input[type=date]')[0], Limit.donly(Date.now() + 2 * 86400000));
  if (all('input[type=time]')[0]) type(all('input[type=time]')[0], '15:30');
  type(all('input[type=text]').filter(function (i) { return !i.value; })[0], '示教室 9 室');
  click(byText('确定并发送通知'), '确定并发送通知');
  await tick(120);
  var det = Svc.discussDetail(target.encId);
  ok(det.appt && det.appt.status === 'booked', '会议写入 FHIR（Appointment.status=booked）');
  ok(/UI 自测/.test(det.appt.ext.meeting.title), '会议标题按输入保存');
  ok(det.parties.length >= 4, '参会清单 ' + det.parties.length + ' 人');

  /* ── 2. 主管医师：书写 8 模块 → 提交 → 三方签名 → 归档 ── */
  App.switchUser('u-attending');
  App.goCase('discuss-record', target.encId);
  await tick(100);
  click(byText('填充演示内容'), '填充演示内容');
  await tick(80);
  ok(doc.querySelectorAll('textarea').length > 5, '模板驱动表单渲染（textarea ' + doc.querySelectorAll('textarea').length + ' 个）');
  click(byText('提交签名'), '提交签名');
  await tick(150);
  var qr = Svc.caseOf(target.encId).qrRecord;
  ok(qr && qr.status === 'submitted', 'QuestionnaireResponse.status=submitted');
  ok(Svc.recordView(target.encId).status === 'to-sign', '记录状态派生为待签名');

  var panel = Svc.signaturePanel(Svc.caseOf(target.encId));
  var guard = 0;
  while (panel.signedRequired < panel.totalRequired && guard++ < 6) {
    var miss = panel.required.filter(function (p) { return !p.signed; })[0];
    var uid = miss.name === '李海峰' ? 'u-attending' : (miss.name === '王建国' ? 'u-senior' : 'u-director');
    App.switchUser(uid);
    App.goCase('discuss-record', target.encId);
    await tick(100);
    checkIt([].slice.call(doc.querySelectorAll('input[type=checkbox]')).filter(function (c) {
      return ((c.closest('label') || {}).textContent || '').indexOf('我已仔细阅读') >= 0;
    })[0]);
    click(byText('CA 数字签名'), uid + ' CA 签名');
    await tick(110);
    panel = Svc.signaturePanel(Svc.caseOf(target.encId));
  }
  ok(panel.signedRequired === panel.totalRequired && panel.totalRequired >= 3,
    '必签全部完成（' + panel.signedRequired + '/' + panel.totalRequired + '）');

  App.switchUser('u-attending');
  App.goCase('discuss-record', target.encId);
  await tick(100);
  var before = F.scan('Task').length;
  click(byText('提交归档'), '提交归档');
  await tick(90);
  confirmYes();
  await tick(200);
  var c2 = Svc.caseOf(target.encId);
  ok(c2.comp && c2.comp.status === 'final', 'Composition 归档 final（锁定）');
  ok(c2.discussStatus === 'archived', '讨论任务状态=已完成');
  ok(F.scan('Task').length > before, '自动提取并生成改进任务 +' + (F.scan('Task').length - before) + ' 条');
  ok(Svc.discussDetail(target.encId).steps.every(function (s) { return s.state === 'done'; }), '步骤条 5 节点全绿');

  /* ── 3. 上报：提交 → 退回 → 重提 → 三级通过 ── */
  var rc = Svc.reportList(D.user('u-attending'), { status: 'to-fill' })[0]
    || Svc.cases(function (x) { return x.reportStatus === 'to-fill'; })[0];
  App.switchUser('u-attending');
  App.goCase('report-form', rc.encId);
  await tick(100);
  click(byText('填充演示内容'), '上报单填充演示内容');
  await tick(70);
  click(byText('提交上报'), '提交上报');
  await tick(150);
  ok(Svc.reportDetail(rc.encId).status === 'level-1', '提交后进入一级审核');

  App.switchUser('u-senior');
  App.goCase('report-form', rc.encId);
  await tick(100);
  pickRadio('return');
  var opinionTa = all('textarea').filter(function (t) { return (t.getAttribute('placeholder') || '').indexOf('退回') >= 0; })[0];
  ok(!!opinionTa, '审核意见输入框已渲染');
  type(opinionTa, 'UI 自测：死亡原因分析需补充因果关系说明后重新提交。');
  click(byText('确认提交'), '一级审核退回');
  await tick(80);
  confirmYes();                      // 退回修改需二次确认
  await tick(200);
  ok(Svc.reportDetail(rc.encId).status === 'returned', '退回后状态=已退回');
  ok(/UI 自测/.test((Svc.reportDetail(rc.encId).returnReason || {}).text || ''), '退回理由已留存');

  App.switchUser('u-attending');
  App.goCase('report-form', rc.encId);
  await tick(100);
  click(byText('提交上报') || byText('提交'), '修改后重提');
  await tick(220);
  var chain = [['u-senior', 'level-2'], ['u-director', 'level-3'], ['u-quality', 'done']];
  for (var j = 0; j < chain.length; j++) {
    App.switchUser(chain[j][0]);
    App.goCase('report-form', rc.encId);
    await tick(100);
    pickRadio('pass');
    click(byText('确认提交'), chain[j][0] + ' 审核通过');
    await tick(160);
    ok(Svc.reportDetail(rc.encId).status === chain[j][1],
      '审核后状态=' + chain[j][1] + '（实际 ' + Svc.reportDetail(rc.encId).status + '）');
  }

  /* ── 4. 医务部人工判定 ── */
  App.switchUser('u-quality');
  App.navigate('discuss-list', { deathType: 'pending' });
  await tick(140);
  ok(!!byText('人工判定'), '「待人工判定」行渲染出人工判定按钮（列表支持跨页筛选参数）');
  click(byText('人工判定'), '打开人工判定弹窗');
  await tick(100);
  ok(!!byText('确认判定'), '弹窗已打开');
  pickRadio('unexpected');
  var noteTa = all('textarea')[0];
  type(noteTa, 'UI 自测：结合病历与抢救记录复核，入院 48 小时内死亡，判定为非预期死亡。');
  click(byText('确认判定'), '提交判定');
  await tick(110);
  confirmYes();
  await tick(280);
  var judged = Svc.cases(function (x) { return x.autoClassified === false; });
  ok(judged.length > 0, '人工判定写回 Encounter 并标记人工（' + judged.length + ' 例）');
  ok(F.search('Provenance').some(function (p) { return (p.ext || {}).activity === 'manual-judge'; }), '人工判定已留痕 Provenance');

  /* ── 5. 时限规则保存 → 全局倒计时联动 ── */
  App.switchUser('u-quality');
  App.navigate('sys-timeout', {});
  await tick(110);
  var probe = Svc.cases(function (c) { return c.deathType === 'expected'; })[0];
  var beforeTotal = Svc.caseOf(probe.encId).discussCountdown.totalMs;
  type(all('input[type=number]')[0], '1');
  click(byText('保存配置'), '保存配置');
  await tick(120);
  confirmYes();
  await tick(120);
  confirmYes();
  await tick(200);
  var after = Svc.caseOf(probe.encId).discussCountdown.totalMs;
  ok(beforeTotal === 7 * 86400000 && after === 86400000,
    '预期死亡讨论时限 7→1 天，倒计时总量联动（' + beforeTotal / 86400000 + 'd → ' + after / 86400000 + 'd）');
  var cfg = JSON.parse(JSON.stringify(Limit.config()));
  cfg.discussionDays.expected = 7;
  Limit.setConfig(cfg);
  ok(Svc.caseOf(probe.encId).discussCountdown.totalMs === 7 * 86400000, '恢复后倒计时回落');

  /* ── 6. 通知中心 ── */
  App.switchUser('u-director');
  App.navigate('home', {});
  await tick(110);
  click(doc.querySelector('.bell'), '点击通知铃铛');
  await tick(90);
  ok(!!byText('全部已读'), '通知面板展开');
  click(byText('全部已读'), '全部已读');
  await tick(90);
  ok(Svc.unreadCount(D.user('u-director')) === 0, '未读通知清零');

  /* ── 7. 角色权限联动导航 ── */
  App.switchUser('u-quality');
  App.navigate('sys-role', {});
  await tick(110);
  ok(all('table').length >= 2, '角色权限页渲染（' + all('table').length + ' 张表）');
  var b = F.view('Basic', 'Basic-role-permissions');
  var pc = JSON.parse(JSON.stringify(b.ext.pages));
  pc['improve-list'] = ['quality'];
  F.update(Object.assign({}, b, { ext: Object.assign({}, b.ext, { pages: pc }) }));
  App.switchUser('u-attending');
  App.navigate('improve-list', {});
  await tick(110);
  ok(((win_doc_h1()) || '') .indexOf('无权限访问') >= 0 || doc.getElementById('app').innerHTML.indexOf('403') > 0,
    '权限收回后该角色访问显示 403');
  var b2 = F.view('Basic', 'Basic-role-permissions');
  var rb = JSON.parse(JSON.stringify(b2.ext.pages));
  rb['improve-list'] = ['clinician', 'director', 'quality'];
  F.update(Object.assign({}, b2, { ext: Object.assign({}, b2.ext, { pages: rb }) }));
  App.navigate('improve-list', {});
  await tick(110);
  ok((h1text() || '').indexOf('改进跟踪') >= 0, '权限恢复后页面重新可见（当前 h1=' + h1text() + '）');

  console.log('\n运行期 console.error：' + errors.length + (errors.length ? '\n  ' + errors.slice(0, 5).join('\n  ') : ''));
  console.log('══ UI 点击流自测：' + pass + ' 通过 / ' + fail + ' 失败 ══');
  process.exit(fail || errors.length ? 2 : 0);
})().catch(function (e) { console.log('测试异常：' + (e.stack || e)); process.exit(2); });
