/* =====================================================================
 * browser-e2e.js —— 真实 Chromium 端到端验证（Playwright）
 * 运行：node test/browser-e2e.js [--base=http://127.0.0.1:1599] [--headed]
 *      PLAYWRIGHT=/abs/path/to/playwright 可覆盖模块位置
 * 与 jsdom 自测的分工：jsdom 覆盖「逻辑 + 组件渲染」，本脚本补浏览器才暴露的
 * 问题——真实 CSS 布局（横向溢出）、原生控件行为、hash 深链刷新、控制台零报错、
 * 以及关键页面视觉留证（截图落地 test/shots/）。
 * ===================================================================== */
'use strict';
var path = require('path'), fs = require('fs');

function loadPlaywright() {
  var cands = [process.env.PLAYWRIGHT,
    path.join(__dirname, '..', '..', '..', '..', 'projects', 'data-quality-MS', 'node_modules', 'playwright'),
    'playwright'].filter(Boolean);
  for (var i = 0; i < cands.length; i++) { try { return require(cands[i]); } catch (_) { } }
  console.log('✗ 未找到 playwright（export PLAYWRIGHT=/abs/path/to/playwright 后重试）');
  process.exit(1);
}

var argv = process.argv.slice(2);
function flag(name, dflt) {
  var a = argv.find(function (x) { return x.indexOf('--' + name + '=') === 0; });
  return a ? a.slice(name.length + 3) : dflt;
}
var BASE = flag('base', 'http://127.0.0.1:1599').replace(/\/$/, '');
var APP = BASE + '/SWBL/';
var SHOTS = path.join(__dirname, 'shots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS);

var pw = loadPlaywright();
var pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + extra : '')); }
}
function sec(t) { console.log('\n── ' + t + ' ──'); }

(async function () {
  var browser = await pw.chromium.launch({ headless: !argv.includes('--headed') });
  var page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  var errors = [], warns = [];
  page.on('console', function (m) {
    var t = m.type();
    if (t === 'error') errors.push('[console] ' + m.text());
    else if (t === 'warning') warns.push(m.text());
  });
  page.on('pageerror', function (e) { errors.push('[pageerror] ' + e.message); });
  page.on('requestfailed', function (r) { errors.push('[fail] ' + r.url() + ' ' + ((r.failure() || {}).errorText || '')); });

  async function shot(name) {
    try { await page.screenshot({ path: path.join(SHOTS, name + '.jpg'), type: 'jpeg', quality: 60 }); } catch (_) { }
  }
  async function toApp() {
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.waitForSelector('.role-switch .role-pill:not(.tool)', { timeout: 20000 });
  }
  var h1 = title;
  async function pickRole(id) {
    var pills = await page.$$('.role-switch .role-pill:not(.tool)');
    for (var i = 0; i < pills.length; i++) {
      if (((await pills[i].getAttribute('data-uid')) || '') === id) { await pills[i].click(); return page.waitForTimeout(300); }
    }
    await pills[0].click(); await page.waitForTimeout(300);
  }
  async function go(route, params) {
    await page.evaluate(function (a) { window.App.navigate(a.r, a.p || {}); }, { r: route, p: params || null });
    await page.waitForTimeout(320);
  }
  function title() {
    return page.evaluate(function () {
      var e = document.querySelector('.page-head h1, .forbidden h2, .card-head h2, h1');
      return e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
    });
  }
  /* 依次点掉堆叠的确认弹窗（保存配置会先弹规则冲突提示，再弹生效确认） */
  async function confirmYes(what) {
    var n = 0;
    for (var i = 0; i < 3; i++) {
      var b = await page.$('.modal-mask .modal-foot button:last-child');
      if (!b) break;
      await b.click(); n++; await page.waitForTimeout(320);
    }
    if (!n) { ok(false, '确认框·' + what, '未出现确认弹窗'); return false; }
    return true;
  }
  function overflow() {
    return page.evaluate(function () {
      var d = document.documentElement; return d.scrollWidth - d.clientWidth;
    });
  }

  console.log('══ SWBL 真实浏览器端到端 · ' + APP + ' ══');

  sec('1. 应用启动');
  await toApp();
  var info = await page.evaluate(function () {
    return {
      users: (window.Domain.DEMO_USERS || []).map(function (u) { return u.id; }),
      routes: Object.keys(window.AMS.pages),
      cases: window.Svc.cases().length
    };
  });
  ok(info.users.length === 6, '演示身份 6 个（' + info.users.join(' ') + '）');
  ok(info.routes.length >= 21, '页面路由 ' + info.routes.length + ' 个');
  ok(info.cases > 500, '演示病例 ' + info.cases + ' 例');
  ok((await page.$$('.role-switch .role-pill:not(.tool)')).length === 6, '角色切换条 6 个真实按钮');
  ok(/我的待办/.test(await title()), '首页 (B) 区 H2 标题 = ' + (await title()));
  var of0 = await overflow();
  ok(of0 <= 2, '首页无横向溢出（' + of0 + 'px）');
  await shot('01-home');

  sec('2. 6 角色 × 全路由渲染 + 布局');
  var bad = [], overs = [], total = 0;
  for (var ui = 0; ui < info.users.length; ui++) {
    var uid = info.users[ui];
    await toApp();
    await pickRole(uid);
    var who = await page.$eval('.user-menu', function (e) { return e.textContent; }).catch(function () { return ''; });
    ok(who.length > 0, uid + ' 已切换（右上角 ' + who.replace(/\s+/g, ' ').trim().slice(0, 20) + '）');
    var reach = await page.evaluate(function (u) {
      var D = window.Domain, AMS = window.AMS, navRole = D.user(u).navRole;
      return Object.keys(AMS.pages).filter(function (r) { return D.canAccess(navRole, r); });
    }, uid);
    total += reach.length;
    for (var ri = 0; ri < reach.length; ri++) {
      await go(reach[ri], {});
      var t = await title(), ox = await overflow();
      var chars = await page.evaluate(function () { return (document.body.innerText || '').length; });
      if (chars < 200 || /403|无权访问/.test(t)) bad.push(uid + '/' + reach[ri] + ' → "' + t + '" ' + chars + '字');
      if (ox > 4) overs.push(uid + '/' + reach[ri] + ' +' + ox + 'px');
    }
    await shot('role-' + uid);
  }
  ok(bad.length === 0, '6 角色 ' + total + ' 个可访问组合均渲染出实际内容（无空白页）', bad.join(' | '));
  ok(overs.length === 0, '全角色全路由 1440px 视口无横向溢出', overs.slice(0, 6).join(' | '));

  sec('3. 列表真实点击进详情');
  await toApp();
  await pickRole('u-director');
  await go('discuss-list', {});
  ok((await page.$$('.tbl tbody tr')).length > 0, '讨论管理列表渲染 ' + (await page.$$('.tbl tbody tr')).length + ' 行');
  ok((await page.$$('.chip')).length >= 5, '状态 Tab ' + (await page.$$('.chip')).length + ' 个（含数量角标）');
  var vb = await page.$('.tbl tbody tr td:last-child button, .tbl tbody tr td:last-child .btn-link');
  if (vb) { await vb.click(); await page.waitForTimeout(360); }
  ok(/详情|讨论/.test(await h1()), '点击「查看」进详情 h1=' + (await h1()));
  ok((await page.$$('.step, .steps .st, .step-item')).length >= 5, '步骤条 5 节点（' + (await page.$$('.step, .steps .st, .step-item')).length + '）');
  ok((await overflow()) <= 4, '详情页无横向溢出');
  await shot('03-discuss-detail');

  sec('4. FHIR 控制台 / 资源查看');
  await page.evaluate(function () { window.FHIR.create({ resourceType: 'Basic', id: 'e2e-probe', ext: { note: 'from-browser' } }); });
  var btns = await page.$$eval('.role-pill, button', function (els) { return els.map(function (e) { return (e.textContent || '').replace(/\s+/g, ''); }); });
  var fb = btns.filter(function (t) { return /FHIR/.test(t); });
  ok(fb.length >= 2, '顶栏 FHIR 入口 ' + fb.length + ' 个（' + fb.join(' / ') + '）');
  await page.click('.role-pill:has-text("FHIR 资源")');
  await page.waitForTimeout(360);
  var typeOpts = await page.$$eval('.modal select >> nth=0 >> option', function (o) { return o.map(function (x) { return x.textContent; }); });
  ok(typeOpts.length >= 20, '资源查看器列出 ' + typeOpts.length + ' 类 FHIR 资源');
  await page.selectOption('.modal select >> nth=0', 'Basic');
  await page.waitForTimeout(260);
  var instOpts = await page.$$eval('.modal select >> nth=1 >> option', function (o) { return o.map(function (x) { return x.value; }); });
  ok(instOpts.indexOf('e2e-probe') >= 0, '浏览器内新建的 Basic/e2e-probe 出现在实例清单（' + instOpts.length + ' 个 Basic）');
  await page.selectOption('.modal select >> nth=1', 'e2e-probe');
  await page.waitForTimeout(260);
  var json = await page.$eval('.json-view', function (e) { return e.innerText; });
  ok(/"resourceType":\s*"Basic"/.test(json), '查看器展示规范化 Basic JSON');
  ok(/StructureDefinition\/Basic-note|extension/.test(json), 'ext 以标准 extension 数组承载（可审计）');
  await shot('04-fhir-viewer');
  await page.click('.modal-head .x'); await page.waitForTimeout(260);
  await page.click('.role-pill:has-text("FHIR 控制台")');
  await page.waitForTimeout(360);
  var reqs = await page.$$eval('.req-log', function (rows) {
    return rows.slice(0, 400).map(function (r) { var c = r.children; return c[0].textContent + ' ' + c[1].textContent; });
  });
  ok(reqs.length > 0, '控制台记录 ' + reqs.length + ' 条真实 FHIR 读写请求');
  ok(reqs.some(function (r) { return /^POST \/fhir\/Basic/.test(r); }), '新建资源对应 POST /fhir/Basic（RESTful 语义可见）');
  await shot('05-fhir-console');
  await page.click('.drawer-head .x, .modal-head .x'); await page.waitForTimeout(260);

  sec('5. 系统配置联动');
  await toApp();
  await pickRole('u-quality');
  await go('sys-timeout', {});
  await shot('06-sys-timeout');
  var probe = await page.evaluate(function () {
    var c = window.Svc.cases(function (x) { return x.deathType === 'expected'; })[0];
    return { encId: c.encId, before: window.Svc.caseOf(c.encId).discussCountdown.totalMs };
  });
  var filled = await page.evaluate(function () {
    var rows = [].slice.call(document.querySelectorAll('.card input[type=number]'));
    var hit = rows.filter(function (i) { return i.value === '7'; })[0];
    if (!hit) return 'no-7';
    hit.value = '1';
    hit.dispatchEvent(new Event('input', { bubbles: true }));
    hit.dispatchEvent(new Event('change', { bubbles: true }));
    return rows.length;
  });
  ok(filled !== 'no-7', '时限规则输入框已定位并改为 1 天（页面共 ' + filled + ' 个数值输入）');
  await page.click('button:has-text("保存配置")');
  await page.waitForTimeout(320);
  await page.waitForTimeout(320);
  await confirmYes('保存时限配置');
  await page.waitForTimeout(380);
  var after = await page.evaluate(function (a) { return window.Svc.caseOf(a.id).discussCountdown.totalMs; }, { id: probe.encId });
  ok(probe.before === 7 * 864e5 && after === 864e5, '时限 7→1 天后倒计时同步（' + probe.before / 864e5 + 'd → ' + after / 864e5 + 'd）');
  await page.evaluate(function () {
    var c = JSON.parse(JSON.stringify(window.Limit.config())); c.discussionDays.expected = 7; window.Limit.setConfig(c);
  });
  await go('sys-template', {});
  ok((await h1()).length > 0 && (await overflow()) <= 4, '模板管理页正常 h1=' + (await h1()));
  await shot('07-sys-template');
  await go('sys-role', {});
  ok((await h1()).length > 0, '角色权限页正常 h1=' + (await h1()));

  sec('6. 统计图表真实绘制');
  var statRoutes = ['stat-overview', 'stat-dept', 'stat-cause', 'stat-trend', 'stat-improve', 'stat-timeliness', 'stat-report'];
  var statBad = [], drawn = 0;
  for (var si = 0; si < statRoutes.length; si++) {
    await go(statRoutes[si], {});
    var s = await page.evaluate(function () {
      return {
        h1: (document.querySelector('h1') || {}).textContent || '',
        g: document.querySelectorAll('svg, canvas, rect, .bar, .bar-row, .hbar').length,
        ox: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    if (!s.h1 || /403/.test(s.h1) || s.ox > 4 || /无权/.test(s.h1)) statBad.push(statRoutes[si] + ' ' + JSON.stringify(s));
    if (s.g > 0) drawn++;
    await shot('stat-' + statRoutes[si]);
  }
  ok(statBad.length === 0, '7 个统计页渲染且无溢出（含图形元素 ' + drawn + '/7）', statBad.join(' | '));

  sec('7. 权限与重置');
  await pickRole('u-attending');
  await go('sys-timeout', {});
  ok(/403|无权/.test(await h1()), '临床医师访问系统管理 → ' + (await h1()));
  await shot('08-forbidden');
  await page.click('.role-pill:has-text("重置演示数据")');
  await page.waitForTimeout(320);
  await confirmYes('重置演示数据');
  await page.waitForTimeout(2200);
  var rb = await page.evaluate(function () {
    return { cases: window.Svc.cases().length, probe: !!window.FHIR.view('Basic', 'e2e-probe') };
  });
  ok(rb.cases > 500, '重置后演示数据重建（' + rb.cases + ' 例）');
  ok(!rb.probe, '重置清除运行期写入（回到初始态）');

  sec('7b. 病例数据范围（越科深链）');
  var scope = await page.evaluate(function () {
    var S = window.Svc;
    var foreign = S.cases(function (c) { return c.deptName !== '心血管内科'; })[0];
    var own = S.cases(function (c) { return c.deptName === '心血管内科'; })[0];
    return { foreign: foreign.encId, own: own.encId };
  });
  await pickRole('u-director');
  await go('discuss-detail', { id: scope.foreign });
  ok(/无权|403/.test(await title()), '科主任直接深链他科病例 → ' + (await title()));
  await page.evaluate(function (a) { location.hash = 'discuss-detail/' + a.id; }, { id: scope.foreign });
  await page.waitForTimeout(420);
  ok(/无权|403/.test(await title()), '手工改 hash 绕过入口也被拦截 → ' + (await title()));
  await go('discuss-detail', { id: scope.own });
  ok(/死亡病例讨论/.test(await title()), '本科病例正常打开 → ' + (await title()));

  sec('8. 深链与刷新');
  await go('discuss-list', {});
  var deepUrl = page.url();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.role-switch .role-pill:not(.tool)'); await page.waitForTimeout(460);
  ok(/discuss-list/.test(deepUrl) && (await h1()).indexOf('讨论') >= 0, '刷新后仍在讨论管理（#' + (deepUrl.split('#')[1] || '') + '）h1=' + (await h1()));

  sec('结果');
  console.log('  截图 ' + fs.readdirSync(SHOTS).length + ' 张 → test/shots/');
  if (warns.length) console.log('  Vue 警告样本：\n    ' + warns.slice(0, 5).join('\n    '));
  if (errors.length) console.log('  浏览器错误 ' + errors.length + ' 条：\n    ' + errors.slice(0, 12).join('\n    '));
  ok(errors.length === 0, '浏览器控制台零错误');
  console.log('\n══ 真实浏览器端到端：' + pass + ' 通过 / ' + fail + ' 失败 ══');
  await browser.close();
  process.exit(fail ? 2 : 0);
})().catch(function (e) { console.log('\n✗ 执行异常：' + ((e && e.stack) || e)); process.exit(3); });
