/* =====================================================================
 * traceability-check.js —— FD 字段/按钮清单 ↔ 页面实现 可追溯性核对
 * 运行：node test/traceability-check.js [--verbose]
 * 做法：解析设计文档「页面字段清单」(D001-D130) 与「按钮清单」(B001-B105)，
 *   按 WF 编号映射到本系统路由，在 jsdom 中真实渲染该页，再用归一化后的
 *   标签文本比对页面 DOM 与页面源码，输出每页命中率与未命中清单。
 * 定位为「人工核对辅助报表」：始终 exit 0，未命中项交由人判断是文案差异还是真缺失。
 * ===================================================================== */
'use strict';
var fs = require('fs'), path = require('path');
var JSDOM = require(path.join(__dirname, '..', '..', 'KJYWFJ', 'node_modules', 'jsdom')).JSDOM;
var ROOT = path.join(__dirname, '..');
var DOC = path.join(ROOT, '..', 'BA-UX-design-SWBL（v2.0）.md');
var verbose = process.argv.indexOf('--verbose') >= 0;

/* ── 1. 解析文档 ── */
function norm(s) {
  return String(s || '')
    .replace(/[（(].*?[)）]/g, '')          // 去掉括注
    .replace(/[\s‑‑–—\-·、,，。.:：;；/\\|]+/g, '')
    .replace(/^(展示字段|输入字段)/, '');
}
function segs(name) {                                  /* 拆出可比对的候选片段 */
  var out = {};
  String(name).split(/[\u2010-\u2015\-：:、,，/\\（）()；;\s]+/).concat([String(name)]).forEach(function (raw) {
    var k = norm(raw);
    if (k.length >= 3 && !/^[\d\u4e00-\u9fa5]{0}$/.test(k)) out[k] = 1;
  });
  var keys = Object.keys(out);
  return keys.length ? keys : [norm(name)];
}

function parseDoc() {
  /* 文档由 Word 导出：CRLF、非断行连字符 U+2011、** \* 转义混杂，先归一化再解析 */
  var lines = fs.readFileSync(DOC, 'utf8').replace(/\r/g, '')
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-').split('\n');
  var pages = [], cur = null;
  lines.forEach(function (ln) {
    var m = ln.match(/FD-1\.(\d+)\s+([^*(（]+)[（(][^）)]*?WF-([A-Z0-9-]+)[^）)]*[）)]/);
    if (m) { cur = { no: +m[1], name: m[2].trim(), wf: m[3], fields: [], buttons: [] }; pages.push(cur); return; }
    if (/^#{1,4}\s/.test(ln)) { if (!/字段|按钮/.test(ln)) cur = cur; }
    if (!cur) return;
    var d = ln.match(/^\|\s*(D\d{3})\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/);
    if (d) { cur.fields.push({ id: d[1], name: d[2].trim(), region: d[3].trim() }); return; }
    var b = ln.match(/^\|\s*(B\d{3})\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/);
    if (b) cur.buttons.push({ id: b[1], label: b[2].trim(), region: b[3].trim(), action: b[4].trim(), cond: b[5].trim(), confirm: b[6].trim() });
  });
  return pages.filter(function (p) { return p.fields.length || p.buttons.length; });
}

/* ── 2. WF → 路由 ── */
var WF2ROUTE = {
  'L1': 'home', 'L2-1': 'discuss-list', 'L3-1-2': 'discuss-detail', 'L3-1-3': 'discuss-record',
  'L2-2': 'report-list', 'L3-2-2': 'report-form', 'L2-3': 'improve-list', 'L3-3-2': 'improve-detail',
  'L3-4-1': 'stat-overview', 'L3-4-2': 'stat-dept', 'L3-4-3': 'stat-cause', 'L3-4-4': 'stat-trend',
  'L3-4-5': 'stat-improve', 'L3-4-6': 'stat-timeliness', 'L3-4-7': 'stat-report',
  'L2-5-1': 'sys-template', 'L2-5-2': 'sys-timeout', 'L2-5-3': 'sys-basedata', 'L2-5-4': 'sys-role',
  'L2-5-5': 'sys-notify', 'L2-5-6': 'sys-approval',
  'L3-5-1': 'sys-template', 'L3-5-2': 'sys-timeout', 'L3-5-3': 'sys-basedata', 'L3-5-4': 'sys-role',
  'L3-5-5': 'sys-notify', 'L3-5-6': 'sys-approval', 'L3-1-1': 'discuss-list', 'L3-2-1': 'report-list'
};
var ROUTE_ROLE = {
  home: 'u-attending', 'discuss-list': 'u-quality', 'discuss-detail': 'u-director', 'discuss-record': 'u-attending',
  'report-list': 'u-quality', 'report-form': 'u-quality', 'improve-list': 'u-quality', 'improve-detail': 'u-quality'
};

/* ── 3. 启动 jsdom 应用并预渲染每条路由 ── */
var CORE = ['lib/vue.global.prod.js', 'js/fhir-store.js', 'js/fhir-ext.js', 'js/fhir-codesystems.js', 'js/domain.js',
  'js/limits.js', 'js/workflow.js', 'js/seed.js', 'js/case-factory.js', 'js/seed-cases.js',
  'js/services.js', 'js/stats.js', 'js/components/common.js', 'js/app.js'];
var pageFiles = fs.readdirSync(path.join(ROOT, 'js', 'pages')).filter(function (f) { return /\.js$/.test(f); }).map(function (f) { return 'js/pages/' + f; });
var dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
var win = dom.window;
win.scrollTo = function () { }; win.console.warn = function () { }; win.console.error = function () { };
win.eval('window.AMS = { components: {}, pages: {} };');
CORE.concat(pageFiles).forEach(function (f) { win.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')); });
win.eval('Seed.runBase(); SeedCases.run(); __BOOT__();');
var App = win.App, Svc = win.Svc, D = win.Domain;
function flush(ms) { return new Promise(function (r) { setTimeout(r, ms || 70); }); }

/* 语料 = 该页渲染出的文本 + 该页源码；源码兜底避免「实现了但当前无数据行」误报 */
var srcByRoute = {};
pageFiles.forEach(function (f) {
  var route = f.replace('js/pages/', '').replace(/\.js$/, '');
  srcByRoute[route] = fs.readFileSync(path.join(ROOT, f), 'utf8');
});
var sharedSrc = ['js/services.js', 'js/stats.js', 'js/components/common.js', 'js/domain.js', 'js/limits.js', 'js/workflow.js']
  .map(function (f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }).join('\n');

function caseIdFor(route, role) {
  var u = D.user(role);
  if (route === 'improve-detail') { var r = Svc.improveRows(u)[0]; return r ? r.id : null; }
  var pool = Svc.cases(function (x) { return Svc.inScope(u, x) && (route.indexOf('report') === 0 ? x.reportTask : x.discussTask); });
  return pool.length ? pool[0].encId : null;
}

(async function () {
  var routes = Object.keys(win.AMS.pages).filter(function (r) { return r !== 'forbidden'; });
  var corpus = {};
  for (var ri = 0; ri < routes.length; ri++) {
    var rt = routes[ri], role = ROUTE_ROLE[rt] || 'u-quality';
    App.switchUser(role);
    var params = {};
    if (/detail|record|form/.test(rt)) { var id = caseIdFor(rt, role); if (id) params.id = id; }
    App.navigate(rt, params);
    await flush(70);
    var txt = norm(win.document.getElementById('app').textContent || '');
    corpus[rt] = txt + '\n' + norm(srcByRoute[rt] || '') + '\n' + norm(sharedSrc);
  }
  var globalHay = Object.keys(corpus).map(function (k) { return corpus[k]; }).join('\n');

  var pages = parseDoc();
  var totF = 0, ownF = 0, elseF = 0, totB = 0, ownB = 0, elseB = 0, misses = [];
  console.log('══ FD 可追溯性核对 ══');
  console.log('  文档解析：' + pages.length + ' 个 FD 小节 · 字段 ' +
    pages.reduce(function (a, p) { return a + p.fields.length; }, 0) + ' 项 · 按钮 ' +
    pages.reduce(function (a, p) { return a + p.buttons.length; }, 0) + ' 项');
  console.log('  （文档 FD 章仅到 1.14，其表内继续列出时效/报表/系统管理条目，故按「本页→任意页」两级匹配）\n');

  function check(items, kind) {
    var own = 0, elsewhere = 0, miss = [];
    items.forEach(function (it) {
      var label = kind === 'D' ? it.name : it.label;
      var keys = segs(label);
      var here = route && keys.some(function (k) { return corpus[route].indexOf(k) >= 0; });
      if (here) { own++; return; }
      var found = null;
      Object.keys(corpus).some(function (r) {
        if (keys.some(function (k) { return corpus[r].indexOf(k) >= 0; })) { found = r; return true; }
        return false;
      });
      if (found) elsewhere++;
      else miss.push(kind + ':' + it.id + ' ' + label + '  @' + (secName || '未映射'));
    });
    return { own: own, elsewhere: elsewhere, miss: miss };
  }

  for (var i = 0; i < pages.length; i++) {
    var pg = pages[i], route = WF2ROUTE[pg.wf];
    var secName = 'FD-1.' + pg.no + ' ' + pg.name;
    if (!route || !corpus[route]) { console.log('  ? ' + secName + '（WF-' + pg.wf + '）未映射路由'); continue; }
    var f = check(pg.fields, 'D'), b = check(pg.buttons, 'B');
    totF += pg.fields.length; ownF += f.own; elseF += f.elsewhere;
    totB += pg.buttons.length; ownB += b.own; elseB += b.elsewhere;
    misses = misses.concat(f.miss, b.miss);
    console.log('  ' + secName + ' → ' + route +
      '   字段 ' + f.own + '(+' + f.elsewhere + ')/' + pg.fields.length +
      '   按钮 ' + b.own + '(+' + b.elsewhere + ')/' + pg.buttons.length);
  }
  console.log('\n── 汇总 ──');
  console.log('  字段 D001-D130：本页命中 ' + ownF + ' · 他页命中 ' + elseF + ' · 合计 ' + (ownF + elseF) + '/' + totF +
    '（' + ((ownF + elseF) * 100 / totF).toFixed(1) + '%）');
  console.log('  按钮 B001-B105：本页命中 ' + ownB + ' · 他页命中 ' + elseB + ' · 合计 ' + (ownB + elseB) + '/' + totB +
    '（' + ((ownB + elseB) * 100 / totB).toFixed(1) + '%）');
  if (misses.length) {
    console.log('\n  未命中 ' + misses.length + ' 项（人工判断：文案差异 or 真缺失）：');
    (verbose ? misses : misses.slice(0, 45)).forEach(function (m) { console.log('    · ' + m); });
    if (!verbose && misses.length > 45) console.log('    … 其余 ' + (misses.length - 45) + ' 项见 --verbose');
  } else console.log('\n  ✓ 文档字段与按钮清单全部命中');
  process.exit(0);
})();
