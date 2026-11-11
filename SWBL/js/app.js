/* =====================================================================
 * app.js —— 应用壳：一级/二级导航、面包屑、演示角色切换、通知中心、
 *           确认框、Toast、403、骨架屏、FHIR 资源查看器与请求控制台
 * 导航结构遵循 IA-3.1（一级顶部横式 + 二级左侧垂直），可见性遵循 IA-3.3。
 * ===================================================================== */
(function (global) {
  'use strict';
  var Vue = global.Vue, D = global.Domain, Svc = global.Svc, Limit = global.Limit;
  var AMS = global.AMS = global.AMS || { components: {}, pages: {} };

  var state = Vue.reactive({
    userId: 'u-director',      // 默认以科主任进入：可完整演示组织讨论与效果评估
    route: 'home',
    params: {},
    refresh: 0,
    loading: false,
    toasts: [],
    confirm: null,
    showNotif: false,
    showUser: false,
    showDemo: false,
    showFhir: false,
    showConsole: false,
    clock: Date.now()
  });

  var App = global.App = {
    state: state,
    user: function () { return D.user(state.userId) || D.user('u-attending'); },
    navRole: function () { return App.user().navRole; },
    scene: function () { return App.user().scene; },
    /* 场景身份判定：can('attending') / can('director|quality') */
    can: function (scenes) {
      var s = App.scene();
      return String(scenes).split('|').indexOf(s) >= 0;
    },
    canRole: function (roles) {
      var r = App.navRole();
      return String(roles).split('|').indexOf(r) >= 0;
    },
    /* IX-1.4：无操作权限 → 按钮禁用 + tooltip 说明 */
    why: function (scenes, msg) { return App.can(scenes) ? '' : (msg || '当前角色无此操作权限'); },
    /* 页面权限 + 病例数据范围双闸：直接改 hash 也不能越科读取病例 */
    canSee: function (route, params) {
      if (route === 'home' || route === 'forbidden') return true;
      if (!D.canAccess(App.navRole(), route)) return false;
      var id = params && params.id;
      if (!id) return true;
      var c = global.Svc.caseOf(id);
      return !c || global.Svc.inScope(D.user(App.state.userId), c);
    },
    navigate: function (route, params) {
      if (!App.canSee(route, params)) {
        state.route = 'forbidden';
        state.params = { route: route };
      } else {
        state.route = route;
        state.params = params || {};
      }
      global.location.hash = route + (params && params.id ? ('/' + params.id) : '');
      state.showNotif = false; state.showUser = false;
      App.skeleton();
      if (global.scrollTo) global.scrollTo(0, 0);
      App.bump();
    },
    goCase: function (route, encId, extra) {
      var p = extra || {}; p.id = encId;
      App.navigate(route, p);
    },
    goTask: function (route, taskId) { App.navigate(route, { id: taskId }); },
    skeleton: function () {
      state.loading = true;
      setTimeout(function () { state.loading = false; App.bump(); }, 180);
    },
    switchUser: function (id) {
      state.userId = id;
      state.showDemo = false;
      var u = D.user(id);
      var cur = state.route;
      if (!App.canSee(cur, state.params)) { state.route = 'forbidden'; state.params = { route: cur }; }
      App.bump();
      App.toast('已切换为「' + u.name + ' · ' + D.sceneName(u.scene) + ' · ' + u.dept + '」', 'info');
      if (global.scrollTo) global.scrollTo(0, 0);
    },
    bump: function () { state.refresh++; },
    toast: function (msg, type, ms) {
      var id = Date.now() + Math.random();
      state.toasts.push({ id: id, msg: msg, type: type || 'success' });
      /* IX-1.2：成功 2s、警告/失败 5s */
      var life = ms || (type === 'error' || type === 'warn' ? 5000 : 2600);
      setTimeout(function () {
        var i = state.toasts.findIndex(function (t) { return t.id === id; });
        if (i >= 0) state.toasts.splice(i, 1);
      }, life);
    },
    /* 破坏性操作二次确认（IX-1.7） */
    confirm: function (opts) {
      return new Promise(function (resolve) {
        state.confirm = {
          title: opts.title || '操作确认',
          message: opts.message || '',
          detail: opts.detail || '',
          okText: opts.okText || '确 定',
          cancelText: opts.cancelText || '取 消',
          danger: !!opts.danger,
          resolve: resolve
        };
      });
    },
    ask: function (message, opts) {
      opts = opts || {};
      opts.message = message;
      return App.confirm(opts);
    },
    /* 重置演示数据 */
    reset: function () {
      return App.ask('确认重置演示数据？将恢复到初始 FHIR 基础数据，本次演示中新增的会议、签名、审核与改进任务都会清空。', { danger: true, okText: '确认重置', title: '重置演示数据' }).then(function (ok) {
        if (!ok) return;
        FHIR.reset();
        Seed.runBase();
        SeedCases.run();
        App.bump();
        App.toast('演示数据已重置为初始状态');
      });
    },
    dict: function (name) { return D[name]; },
    fmtDT: function (v) { return v == null ? '——' : Limit.dt(v); },
    fmtD: function (v) { return v == null ? '——' : Limit.donly(v); },
    short: function (v) { return v == null ? '——' : Limit.mdhm(v); },
    demoPath: function () {
      var s = App.scene();
      var P = {
        attending: [
          ['上报管理', '填写死亡病例上报单并提交（列表「待填写 → 填写」）', 'report-list'],
          ['上报单', '6 大模块完整性校验：故意留空可看到缺失字段清单', 'report-form'],
          ['讨论管理', '会议已安排后调阅病历、准备病例汇报', 'discuss-list'],
          ['讨论记录', '书写 8 大模块结构化记录 → 提交签名', 'discuss-list'],
          ['签名', '作为必签人员完成 CA 数字签名', 'discuss-list'],
          ['改进跟踪', '作为任务责任人更新进度、提交完成报告', 'improve-list']
        ],
        senior: [
          ['上报管理', '切到「审核」视图，处理待本人审核的上报单（一级审核）', 'report-list'],
          ['上报单', '审核通过 / 填写退回意见退回修改', 'report-list'],
          ['讨论管理', '查看会议安排并调阅病历', 'discuss-list'],
          ['讨论记录', '完成上级医师 CA 必签', 'discuss-list']
        ],
        director: [
          ['讨论管理', '打开「待组织」任务 → 安排讨论会议并下发通知', 'discuss-list'],
          ['讨论任务详情', '查看参会确认情况，一键催办未确认人员', 'discuss-list'],
          ['讨论记录', '主持讨论后书写/审阅记录，完成主持人 CA 必签', 'discuss-list'],
          ['上报管理', '二级审核：通过或退回主管医师', 'report-list'],
          ['改进跟踪', '确认系统自动提取的改进任务（编辑责任人/时限）', 'improve-list'],
          ['改进任务详情', '效果评估三维度；选「需要持续改进」自动生成新一轮 PDCA', 'improve-list'],
          ['改进跟踪', '对已完成任务标记优秀措施（可全院推广）', 'improve-list']
        ],
        doctor: [
          ['首页', '查看「待确认参会」待办', 'home'],
          ['讨论管理', '进入会议详情完成参会确认（或请假并填写原因）', 'discuss-list'],
          ['讨论记录', '审阅记录并自愿 CA 签名', 'discuss-list'],
          ['改进跟踪', '作为责任人执行改进措施、追加执行记录', 'improve-list']
        ],
        quality: [
          ['讨论管理', '对「待人工判定」病例执行人工判定（时限与优先级重算）', 'discuss-list'],
          ['上报管理', '三级终审：通过后标记上报完成', 'report-list'],
          ['统计分析', '统计概览 → 异常预警下钻时效分析', 'stat-overview'],
          ['统计分析', '科室分析 / 死因分析 / 趋势 / 改进统计 / 报表导出', 'stat-dept'],
          ['系统管理', '模板管理、时限规则、基础数据、角色权限、通知、审批流配置', 'sys-template']
        ]
      };
      return P[s] || [];
    }
  };

  global.FHIR.subscribe(function () { App.bump(); });
  /* IX-1.6：倒计时每分钟自动刷新 */
  setInterval(function () { state.clock = Date.now(); App.bump(); }, 60000);

  var Root = {
    data: function () {
      return { fhirType: 'Encounter', fhirId: '', fhirKeyword: '', consoleTab: 'log' };
    },
    computed: {
      s: function () { return state; },
      user: function () { return App.user(); },
      role: function () { return App.navRole(); },
      users: function () { return D.DEMO_USERS; },
      modules: function () { return D.visibleModules(App.navRole()); },
      pageComp: function () { return 'page-' + state.route; },
      side: function () { return D.sideMenu(state.route); },
      crumbs: function () { return D.crumbs(state.route); },
      showTopNavHome: function () { return true; },
      unread: function () { state.refresh; return Svc.unreadCount(App.user()); },
      notifs: function () { state.refresh; return Svc.notices(App.user()).slice(0, 10); },
      pageKey: function () { return state.route + '|' + state.userId; },
      demoOpen: function () { return state.showDemo; },
      path: function () { return App.demoPath(); },
      scopeName: function () { return Svc.scopeOf(App.user()) === 'hospital' ? '全院数据' : (Svc.scopeOf(App.user()) === 'self' ? '仅本人数据' : '本科室数据（' + App.user().dept + '）'); },
      fhirTypes: function () { state.refresh; return FHIR.types(); },
      fhirStat: function () { state.refresh; return FHIR.stats(); },
      fhirList: function () {
        state.refresh;
        var self = this;
        var all = FHIR.canonicalAll(this.fhirType);
        var kw = (this.fhirKeyword || '').toLowerCase();
        return all.map(function (r) {
          var label = (r.name && (r.name[0] ? r.name[0].text : r.name)) || r.title || (r.code && (r.code.text || (r.code.coding && r.code.coding[0] && r.code.coding[0].display))) || r.id;
          return { id: r.id, label: String(label) };
        }).filter(function (x) { return !kw || x.id.toLowerCase().indexOf(kw) >= 0 || x.label.toLowerCase().indexOf(kw) >= 0; }).slice(0, 200);
      },
      fhirJson: function () {
        var id = this.fhirId || (this.fhirList[0] && this.fhirList[0].id);
        if (!id) return '（无匹配资源）';
        return JSON.stringify(FHIR.canonical(this.fhirType, id), null, 2);
      },
      reqs: function () { state.refresh; state.clock; return FHIR.requests().slice(0, 60); },
      total: function () { var t = 0, s = this.fhirStat; Object.keys(s).forEach(function (k) { t += s[k]; }); return t; }
    },
    methods: {
      go: function (r) { App.navigate(r); },
      goPath: function (r) { state.showDemo = false; App.navigate(r); },
      switchUser: function (u) { App.switchUser(u); },
      isModuleActive: function (m) {
        var cur = m.route;
        return state.route === cur || (D.moduleOf(state.route) || {}).code === m.code;
      },
      modulePages: function (m) {
        var role = App.navRole();
        return m.pages.filter(function (p) { return !p.hidden && p.roles.indexOf(role) >= 0; });
      },
      openNotif: function () { state.showNotif = !state.showNotif; state.showUser = false; },
      readAll: function () { Svc.markAllRead(App.user()); App.bump(); },
      openFhir: function () { state.showFhir = true; state.showNotif = false; },
      openConsole: function () { state.showConsole = true; },
      resetSeed: function () { App.reset(); },
      onFhirType: function () { this.fhirId = ''; },
      closeConfirm: function (v) { var c = state.confirm; if (c) { c.resolve(v); state.confirm = null; } },
      DN: function (v) { return D.deathTypeName(v); },
      dt: function (v) { return Limit.dt(v); }
    },
    mounted: function () {
      var hash = (global.location.hash || '').replace('#', '').split('/');
      if (hash[0] && hash[0] !== 'home' && App.canSee(hash[0], { id: hash[1] })) {
        state.route = hash[0];
        state.params = { id: hash[1] };
      }
      global.addEventListener('hashchange', function () {
        var h = (global.location.hash || '').replace('#', '').split('/');
        if (h[0] && h[0] !== state.route && (h[0] === 'home' || App.canSee(h[0], { id: h[1] }))) {
          state.route = h[0]; state.params = { id: h[1] }; App.bump();
        }
      });
      /* 首次进入做一次骨架屏，符合 IX-1.1 */
      App.skeleton();
    },
    template: `
    <div>
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand"><span class="logo">⚕</span> 死亡病例讨论制度闭环管理系统<span class="sub">v2.0 · 演示环境</span></div>
          <nav class="nav">
            <div class="nav-item" :class="{active: s.route==='home'}"><a @click="go('home')">首页</a></div>
            <div class="nav-item" v-for="m in modules" :key="m.code" :class="{active: isModuleActive(m)}">
              <a>{{ m.icon }} {{ m.name }}</a>
              <div class="nav-dropdown">
                <a v-for="p in modulePages(m)" :key="p.route" :class="{active: s.route===p.route}" @click="go(p.route)">{{ p.name }}</a>
              </div>
            </div>
          </nav>
          <div class="topbar-right">
            <div class="bell" @click.stop="openNotif">🔔<i class="badge" v-if="unread">{{ unread }}</i></div>
            <div class="user-menu" @click.stop="s.showUser=!s.showUser">
              <span class="avatar">{{ user.name.charAt(0) }}</span>
              <span style="font-size:13px">{{ user.name }}</span>
              <span style="font-size:11px;opacity:.75">▾</span>
            </div>
          </div>
        </div>

        <!-- 通知中心（最近 10 条 + 查看全部） -->
        <div v-if="s.showNotif" class="dropdown-panel" style="width:378px" @click.stop>
          <div class="flex-between" style="padding:11px 14px;border-bottom:1px solid var(--border-2);display:flex;justify-content:space-between;align-items:center">
            <b>🔔 通知中心</b><a class="btn-link" @click="readAll">全部已读</a>
          </div>
          <div style="max-height:360px;overflow:auto;padding:0 14px">
            <div v-for="n in notifs" :key="n.id" class="notice-item" @click="n.encId && goPath(n.route==='improve'?'improve-list':(n.route==='report'?'report-list':'discuss-list'))">
              <div class="ttl"><i class="new" v-if="n.unread"></i>{{ n.title }}</div>
              <div class="bd">{{ n.body }}</div>
              <div class="bd">{{ n.at }} · {{ n.scene }}</div>
            </div>
            <empty-state v-if="!notifs.length" text="暂无通知" icon="🔕"></empty-state>
          </div>
          <div style="padding:9px 14px;border-top:1px solid var(--border-2);text-align:center">
            <a class="btn-link" @click="go('home')">查看全部通知</a>
          </div>
        </div>

        <!-- 用户信息 -->
        <div v-if="s.showUser" class="dropdown-panel" style="width:268px;padding:10px" @click.stop>
          <div style="border-bottom:1px solid var(--border-2);padding-bottom:9px;margin-bottom:8px">
            <b>{{ user.name }}</b><span class="muted small">（{{ user.title }}）</span>
            <div class="muted small mt4">{{ user.dept }} · {{ DN(user.scene) === user.scene ? '' : '' }}{{ '场景身份：' + (user.scene==='attending'?'主管医师':user.scene==='senior'?'上级医师':user.scene==='director'?'科主任':user.scene==='quality'?'医务部管理员':'科室医师') }}</div>
            <div class="muted small">数据可见范围：{{ scopeName }}</div>
          </div>
          <div class="small muted">🎭 在下方演示条中可随时切换身份；「🎬 演示动线」会给出当前角色的下一步操作。</div>
        </div>
      </header>

      <!-- 演示工具条 -->
      <div class="role-switch">
        <div class="role-switch-inner">
          <span class="label">🎭 演示角色切换：</span>
          <span class="role-pill" v-for="u in users" :key="u.id" :data-uid="u.id" :class="{active: u.id===s.userId}" @click="switchUser(u.id)">
            {{ u.icon }} {{ u.name }}<span style="opacity:.8">·{{ u.dept }}</span>
          </span>
          <span class="spacer" style="flex:1"></span>
          <span class="role-pill tool" @click="s.showDemo=!s.showDemo">🎬 本角色演示动线</span>
          <span class="role-pill tool" @click="openConsole">⚡ FHIR 控制台</span>
          <span class="role-pill tool" @click="openFhir">🔍 FHIR 资源</span>
          <span class="role-pill tool" @click="resetSeed">↻ 重置演示数据</span>
        </div>
        <div v-if="s.showDemo" style="max-width:1680px;margin:0 auto;padding:0 20px 10px">
          <div style="background:#fff;border:1px solid #FFE58F;border-radius:8px;padding:10px 14px">
            <b class="small">{{ user.icon }} {{ user.name }}（{{ user.scene==='attending'?'主管医师':user.scene==='senior'?'上级医师':user.scene==='director'?'科主任':user.scene==='quality'?'医务部管理员':'科室医师' }}）演示动线</b>
            <div class="row mt8" style="align-items:stretch">
              <div v-for="(p,i) in path" :key="i" class="quick-btn" style="flex:1 1 210px" @click="goPath(p[2])">
                <span class="ic">{{ i+1 }}</span>
                <span><b>{{ p[0] }}</b><div class="small muted">{{ p[1] }}</div></span>
              </div>
            </div>
            <div class="small muted mt8">提示：走完一条链路后按提示切换下一角色，即可完整演示 US-1.1 ~ US-1.6 全流程闭环。</div>
          </div>
        </div>
      </div>

      <!-- 主体 -->
      <main class="page">
        <aside class="side-menu" v-if="side">
          <div class="sm-title">{{ side.module.name }}</div>
          <a v-for="p in side.pages" :key="p.route" :class="{active: s.route===p.route}" @click="go(p.route)" :title="p.name">
            <span v-if="s.route===p.route">▸ </span>{{ p.name }}
          </a>
        </aside>
        <div class="page-main">
          <div class="breadcrumb" v-if="crumbs.length">
            <template v-for="(c,i) in crumbs" :key="i">
              <a v-if="c.route" @click="go(c.route)">{{ c.name }}</a>
              <span v-else class="cur">{{ c.name }}</span>
              <span v-if="i<crumbs.length-1" class="sep">›</span>
            </template>
          </div>
          <div class="overlay-loading" v-if="s.loading"><span class="spinner" style="width:26px;height:26px"></span><div class="muted small">数据加载中…</div></div>
          <component :is="pageComp" :key="pageKey"></component>
        </div>
      </main>

      <footer class="footer">
        <span>© 2026 死亡病例讨论制度闭环管理系统 v2.0 · 演示数据均为 FHIR R4 标准资源模拟</span>
        <span><a>帮助中心</a><a>意见反馈</a><a>隐私政策</a></span>
      </footer>

      <!-- 确认弹窗 -->
      <ui-modal v-if="s.confirm" :title="'⚠ ' + s.confirm.title" width="narrow" @close="closeConfirm(false)">
        <p style="line-height:1.9;margin:0">{{ s.confirm.message }}</p>
        <p class="muted small" v-if="s.confirm.detail" style="margin:8px 0 0">{{ s.confirm.detail }}</p>
        <template #foot>
          <button class="btn" @click="closeConfirm(false)">{{ s.confirm.cancelText }}</button>
          <button :class="s.confirm.danger ? 'btn solid-danger' : 'btn primary'" @click="closeConfirm(true)">{{ s.confirm.okText }}</button>
        </template>
      </ui-modal>

      <!-- FHIR 资源查看器 -->
      <ui-modal v-if="s.showFhir" title="🔍 FHIR 资源查看器（内存库中的规范化资源）" width="wide" @close="s.showFhir=false">
        <div class="alert info"><span>ℹ️</span><div>
          本系统所有业务数据均为标准 <b>FHIR R4</b> 资源：患者 <code>Patient</code>（deceasedDateTime）、就诊 <code>Encounter</code>、
          诊断 <code>Condition</code>、检验检查 <code>Observation</code>、病历文档 <code>DocumentReference</code>、
          任务 <code>Task</code>、会议 <code>Appointment</code>、模板 <code>Questionnaire</code>、表单 <code>QuestionnaireResponse</code>、
          归档签名 <code>Composition.attester</code>、审核流 <code>PlanDefinition</code>、统计 <code>MeasureReport</code>、
          通知 <code>Communication</code>、留痕 <code>Provenance</code>、基础数据 <code>CodeSystem</code>。
          基础资源无法表达的业务字段通过 <b>extension / modifierExtension</b> 承载，并逐个声明于
          <b>StructureDefinition</b>（共 {{ fhirStat.StructureDefinition || 0 }} 个）。当前内存资源总量 <b>{{ total }}</b> 个。
        </div></div>
        <div class="filter-bar mb12">
          <div class="field"><label>资源类型（{{ fhirTypes.length }} 类）</label>
            <select v-model="fhirType" @change="onFhirType">
              <option v-for="t in fhirTypes" :value="t">{{ t }}（{{ fhirStat[t] }}）</option>
            </select>
          </div>
          <div class="field" style="flex:1"><label>资源实例（可搜索 id / 名称）</label>
            <input type="text" v-model="fhirKeyword" placeholder="输入住院号、患者姓名或资源 id 过滤">
          </div>
        </div>
        <div class="field mb8"><label>选择实例（{{ fhirList.length }} 条）</label>
          <select v-model="fhirId">
            <option v-for="r in fhirList" :value="r.id">{{ r.id }} · {{ r.label }}</option>
          </select>
        </div>
        <pre class="json-view">{{ fhirJson }}</pre>
        <template #foot><button class="btn" @click="s.showFhir=false">关闭</button></template>
      </ui-modal>

      <!-- FHIR 请求控制台 -->
      <ui-drawer v-if="s.showConsole" title="⚡ FHIR 请求控制台（实时）" @close="s.showConsole=false">
        <div class="alert plain"><span>🧾</span><div>下列为本次演示过程中前端实际发起的 FHIR 读写请求（<code>POST/GET/PUT/DELETE /fhir/{Type}</code>），最新在前。</div></div>
        <table class="tbl dense">
          <thead><tr><th style="width:74px">方法</th><th>接口</th><th style="width:120px">参数</th><th style="width:78px">耗时</th></tr></thead>
          <tbody>
            <tr v-for="(r,i) in reqs" :key="i" class="req-log">
              <td><span class="m" :class="r.method">{{ r.method }}</span></td>
              <td class="mono">{{ r.url }}</td>
              <td class="muted small">{{ r.note }}</td>
              <td class="muted small">{{ r.at.slice(11,19) }}</td>
            </tr>
          </tbody>
        </table>
        <empty-state v-if="!reqs.length" text="暂无请求" icon="⚡"></empty-state>
        <template #foot>
          <button class="btn" @click="FHIR_clear()">清空日志</button>
          <button class="btn primary" @click="s.showConsole=false">关闭</button>
        </template>
      </ui-drawer>

      <!-- 全局提示 -->
      <div class="toast-wrap">
        <div v-for="t in s.toasts" :key="t.id" class="toast" :class="t.type">
          <span>{{ t.type==='error' ? '❌' : (t.type==='warn' ? '⚠️' : (t.type==='info' ? 'ℹ️' : '✅')) }}</span><span>{{ t.msg }}</span>
        </div>
      </div>
    </div>`
  };

  Root.methods.FHIR_clear = function () { FHIR.clearRequests(); App.bump(); };

  function boot() {
    var app = Vue.createApp(Root);
    Object.keys(AMS.components).forEach(function (k) { app.component(k, AMS.components[k]); });
    Object.keys(AMS.pages).forEach(function (k) { app.component('page-' + k, AMS.pages[k]); });
    /* 全局混入：页面可直接使用的工具 */
    app.mixin({
      computed: {
        $user: function () { return App.user(); },
        $scene: function () { return App.scene(); },
        $role: function () { return App.navRole(); },
        $refresh: function () { return state.refresh; }
      },
      methods: {
        can: App.can, canRole: App.canRole, why: App.why,
        go: App.navigate, goCase: App.goCase, goTask: App.goTask,
        toast: function (m, t) { App.toast(m, t); },
        ask: function (m, o) { return App.ask(m, o); },
        dt: function (v) { return v == null ? '——' : Limit.dt(v); },
        dd: function (v) { return v == null ? '——' : Limit.donly(v); },
        md: function (v) { return v == null ? '——' : Limit.mdhm(v); },
        refreshData: function () { App.bump(); }
      }
    });
    App._vm = app.mount('#app');
    // 页面加载完成后统计快照初始化（供报表管理历史列表）
    if (global.Stats) Stats.ensureHistory();
    console.log('[SWBL] 已挂载，页面组件：' + Object.keys(AMS.pages).join(', '));
  }

  global.__BOOT__ = boot;
})(typeof window !== 'undefined' ? window : globalThis);
