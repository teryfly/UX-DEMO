/* =====================================================================
 * render-test.js —— jsdom 渲染自测
 * 运行：node test/render-test.js          （依赖 ../KJYWFJ/node_modules/jsdom）
 *   或：node test/render-test.js --only=discuss-list,home
 * 校验：
 *   1) 全部脚本在浏览器环境可加载、应用可挂载、无 console.error / Vue 警告
 *   2) 6 个演示身份 × 全部已实现路由逐一渲染，产出足够 DOM 文本
 *   3) 越权路由渲染出 403 页面
 *   4) 角色切换与关键交互（确认框、导航）不产生异常
 * ===================================================================== */
'use strict';
var fs = require('fs');
var path = require('path');
var JSDOM_PATH = path.join(__dirname, '..', '..', 'KJYWFJ', 'node_modules', 'jsdom');
var JsdomModule = require(JSDOM_PATH);
var JSDOM = JsdomModule.JSDOM;

var ROOT = path.join(__dirname, '..');
var CORE = ['lib/vue.global.prod.js', 'js/fhir-store.js', 'js/fhir-ext.js', 'js/fhir-codesystems.js', 'js/domain.js',
  'js/limits.js', 'js/workflow.js', 'js/seed.js', 'js/case-factory.js', 'js/seed-cases.js',
  'js/services.js', 'js/stats.js', 'js/components/common.js', 'js/app.js'];
var only = (function () {
  var arg = process.argv.find(function (a) { return a.indexOf('--only=') === 0; });
  return arg ? arg.slice(7).split(',') : null;
})(0);

function pageFiles() {
  var dir = path.join(ROOT, 'js', 'pages');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); })
    .filter(function (f) { return !only || only.indexOf(f.replace(/\.js$/, '')) >= 0; })
    .map(function (f) { return 'js/pages/' + f; });
}

var files = CORE.concat(pageFiles());
var errors = [];
var dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/'
});
var win = dom.window;
win.scrollTo = function () { };
win.print = function () { };
win.open = function () { return { document: { write: function () { }, close: function () { } }, focus: function () { }, print: function () { } }; };
var origError = win.console.error, origWarn = win.console.warn;
win.console.error = function () {
  var a = Array.prototype.join.call(arguments, ' ');
  var st = (arguments[0] && arguments[0].stack) ? String(arguments[0].stack).split('\n').slice(1, 4).join(' | ') : '';
  errors.push('console.error: ' + a + (st ? '  @@ ' + st : ''));
  origError.apply(win.console, arguments);
};
win.console.warn = function () {
  var msg = Array.prototype.join.call(arguments, ' ');
  if (/DevTools|production|deprecated/i.test(msg)) return;
  errors.push('console.warn: ' + msg);
};
win.addEventListener('error', function (e) { errors.push('window.error: ' + (e.message || e.error)); });
process.on('unhandledRejection', function (e) { errors.push('unhandledRejection: ' + (e && e.message || e)); });

function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
win.eval('window.AMS = { components: {}, pages: {} };');   // 与 index.html 中的内联声明保持一致
var t0 = Date.now();
files.forEach(function (f) {
  try { win.eval(read(f)); }
  catch (e) { console.log('  ✗ 加载失败 ' + f + ' → ' + e.message); process.exit(1); }
});
try {
  win.eval('Seed.runBase(); SeedCases.run();');
} catch (e) {
  console.log('  ✗ 种子初始化失败 → ' + e.message + '\n' + e.stack);
  process.exit(1);
}
var seedMs = Date.now() - t0;
try { win.eval('__BOOT__();'); }
catch (e) { console.log('  ✗ 应用挂载失败 → ' + e.message + '\n' + (e.stack || '')); process.exit(1); }

var App = win.App, D = win.Domain, AMS = win.AMS;
var routes = Object.keys(AMS.pages);
var flush = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 40); }); };

var pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + String(extra).slice(0, 300) : '')); }
}

(async function run() {
  await flush(120);
  console.log('种子 ' + seedMs + 'ms · 页面 ' + routes.length + ' 个 · 资源 ' +
    Object.keys(win.FHIR.stats()).length + ' 类');
  console.log('已实现路由：' + routes.join(', '));

  /* 1. 全角色 × 全路由渲染 */
  var users = D.DEMO_USERS;
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    App.switchUser(u.id);
    await flush(20);
    for (var j = 0; j < routes.length; j++) {
      var r = routes[j];
      var before = errors.length;
      App.navigate(r, {});
      await flush(30);
      var html = win.document.getElementById('app').innerHTML;
      ok(html.length > 400, u.id + ' → ' + r + ' 渲染', 'DOM 仅 ' + html.length + ' 字节');
      ok(errors.length === before, u.id + ' → ' + r + ' 无新增报错', errors.slice(before).join(' | '));
    }
  }

  /* 2. 越权访问 → 403 */
  App.switchUser('u-doctor');
  App.navigate('stat-overview', {});
  await flush(40);
  ok(win.document.getElementById('app').innerHTML.indexOf('403') > 0, '临床医师访问统计分析显示 403');
  App.navigate('sys-timeout', {});
  await flush(40);
  ok(win.document.getElementById('app').innerHTML.indexOf('无权限访问') > 0, '临床医师访问系统管理显示无权限');
  App.switchUser('u-quality');
  App.navigate('stat-overview', {});
  await flush(60);
  ok(win.document.getElementById('app').innerHTML.indexOf('403') < 0, '医务部可正常访问统计概览');

  /* 3. 首页待办按角色差异化 */
  var seen = {};
  for (var k = 0; k < users.length; k++) {
    App.switchUser(users[k].id);
    App.navigate('home', {});
    await flush(40);
    seen[users[k].id] = win.document.getElementById('app').innerHTML.length;
  }
  ok(Object.keys(seen).every(function (x) { return seen[x] > 400; }), '各角色首页均有内容');

  /* 4. 详情页带参数渲染 */
  var enc = win.Svc.cases(function (c) { return c.discussTask; })[0].encId;
  App.switchUser('u-director');
  ['discuss-detail', 'discuss-record', 'report-form'].forEach(function (r) {
    App.navigate(r, { id: enc });
    return null;
  });
  await flush(80);
  ok(win.document.getElementById('app').innerHTML.length > 500, '详情页带 id 参数可渲染');

  var impId = win.Svc.improveRows(win.Domain.user('u-quality'))[0];
  if (impId) {
    App.navigate('improve-detail', { id: impId.id });
    await flush(80);
    ok(win.document.getElementById('app').innerHTML.length > 500, '改进任务详情可渲染');
  }

  /* 5. FHIR 写入链路在浏览器环境下可用 */
  try {
    var target = win.Svc.cases(function (c) { return c.discussStatus === 'to-organize'; })[0];
    win.Svc.arrangeMeeting(target.encId, { title: 'T', date: win.Limit.donly(Date.now() + 86400000), time: '15:00', location: '示教室' }, win.Domain.user('u-director'));
    ok(true, 'jsdom 下可完成一次 FHIR 写入（安排会议）');
  } catch (e) { ok(false, 'jsdom 下 FHIR 写入', e.message); }

  /* 6. index.html 实际加载清单 == 自测清单（防止新页面在浏览器里 404/未注册） */
  (function () {
    var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    var refs = [];
    html.replace(/<(?:script|link)[^>]*\s(?:src|href)="([^"]+)"[^>]*>/g, function (_, s) { refs.push(s.replace(/^\.?\//, '')); return ''; });
    var want = files.slice();
    var missing = want.filter(function (f) { return refs.indexOf(f) < 0; });
    var ghosts = refs.filter(function (f) { return !fs.existsSync(path.join(ROOT, f)); });
    ok(missing.length === 0, 'index.html 加载全部 ' + want.length + ' 个脚本/样式', missing.join(','));
    ok(ghosts.length === 0, 'index.html 无失效引用', ghosts.join(','));
    var core = ['js/fhir-store.js', 'js/domain.js', 'js/limits.js', 'js/workflow.js', 'js/services.js', 'js/stats.js', 'js/app.js'];
    ok(core.every(function (c) { return refs.indexOf(c) < refs.indexOf('js/pages/home.js'); }), '核心模块在页面前加载');
  })();

  console.log('\n══ 渲染自测：' + pass + ' 通过 / ' + fail + ' 失败 ══');
  if (fail) {
    console.log('\n最近错误样本：\n' + errors.slice(-14).join('\n'));
  }
  process.exit(fail ? 2 : 0);
})();
