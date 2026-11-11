/* =====================================================================
 * pages/home.js —— L1 首页（WF-L1 / IA-2.1 / FD-1.1 / IX-2.1）
 * 角色化工作台：(B) 我的待办 + 时限倒计时 → (C) 关键指标概览 →
 * (D) 预警通知 → (E) 快速入口 → 系统通知消息
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Limit = global.Limit, Stats = global.Stats;

  global.AMS.pages['home'] = {
    data: function () { return { tab: 'todo', DN: D.DEATH_TYPES }; },
    computed: {
      user: function () { App.state.refresh; App.state.clock; return App.user(); },
      todos: function () { App.state.refresh; App.state.clock; return Svc.todos(App.user()); },
      metrics: function () {
        App.state.refresh;
        var p = Stats.period('month', 0);
        var r = Stats.withCompare(Svc.cases(function (c) { return Svc.inScope(App.user(), c); }), p);
        return r;
      },
      warnings: function () { App.state.refresh; App.state.clock; return Svc.warnings(App.user()); },
      notices: function () { App.state.refresh; return Svc.notices(App.user()).slice(0, 8); },
      quick: function () {
        var s = App.scene(), out = [];
        if (s === 'attending') out.push({ ic: '📝', t: '新建上报单', r: 'report-list', q: { status: 'to-fill' } });
        if (s === 'director') out.push({ ic: '💬', t: '安排讨论', r: 'discuss-list', q: { status: 'to-organize' } });
        if (s === 'attending' || s === 'director') out.push({ ic: '📄', t: '我的上报待办', r: 'report-list', q: {} });
        if (App.canRole('quality')) out.push({ ic: '📊', t: '查看统计报表', r: 'stat-report', q: {} });
        out.push({ ic: '🔄', t: '改进任务跟踪', r: 'improve-list', q: {} });
        if (App.canRole('quality')) out.push({ ic: '⏱', t: '时效分析', r: 'stat-timeliness', q: {} });
        if (App.canRole('quality')) out.push({ ic: '⚙️', t: '系统管理', r: 'sys-template', q: {} });
        return out;
      },
      cards: function () {
        var m = this.metrics;
        return [
          { label: '本月死亡病例数', value: m.cur.deaths, unit: '例', delta: m.d.deaths, icon: '🛏', route: 'stat-overview', goodDown: false },
          { label: '讨论完成率', value: m.cur.discussRate, unit: '%', delta: m.d.discussRate, icon: '💬', route: 'stat-overview', goodDown: false, sub: m.cur.discussDone + ' / ' + m.cur.discussTotal + ' 例已完成归档' },
          { label: '上报完成率', value: m.cur.reportRate, unit: '%', delta: m.d.reportRate, icon: '📄', route: 'stat-overview', goodDown: false, sub: m.cur.reportDone + ' / ' + m.cur.reportTotal + ' 例已完成上报' },
          { label: '改进措施落实率', value: m.cur.improveRate, unit: '%', delta: m.d.improveRate, icon: '🔄', route: 'stat-improve', goodDown: false, sub: '本期改进任务 ' + m.cur.improveTotal + ' 项' }
        ];
      },
      scopeName: function () { return Svc.scopeOf(App.user()) === 'hospital' ? '全院' : App.user().dept; }
    },
    methods: {
      open: function (t) {
        if (t.route === 'report') App.navigate('report-list', { id: t.encId, focus: t.type });
        else if (t.route === 'improve') App.navigate('improve-list', { id: t.encId, focus: t.type });
        else App.goCase('discuss-detail', t.encId);
      },
      viewAll: function (route) { App.navigate(route, {}); },
      viewWarn: function (w) {
        if (w.route === 'discuss-list') App.navigate('discuss-list', { status: 'to-organize' });
        else if (w.route === 'report') App.navigate('report-list', {});
        else if (w.route === 'improve') App.navigate('improve-list', { overdue: 'yes' });
        else App.navigate(w.route, {});
      },
      openNotice: function (n) {
        if (n.unread) Svc.markRead(n.id);
        var r = n.route === 'improve' ? 'improve-list' : (n.route === 'discuss' ? 'discuss-list' : 'report-list');
        if (n.encId && r === 'discuss-list') App.goCase('discuss-detail', n.encId);
        else App.navigate(r, {});
      },
      goQuick: function (q) { App.navigate(q.r, q.q || {}); },
      canDrill: function () { return App.canRole('quality'); },
      drill: function (c) { if (this.canDrill()) App.navigate(c.route, {}); else App.toast('关键指标明细仅医务部管理员可查看（B003）', 'info'); },
      typeLabel: function (t) { return t === 'attending' ? '主管医师' : t === 'senior' ? '上级医师' : t === 'director' ? '科主任' : t === 'quality' ? '医务部管理员' : '科室医师'; }
    },
    template: `
    <div>
      <!-- (A) 欢迎条 -->
      <div class="card"><div class="card-body" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <span class="avatar" style="width:42px;height:42px;font-size:17px">{{ user.name.charAt(0) }}</span>
        <div style="flex:1;min-width:220px">
          <div style="font-size:16px;font-weight:600">{{ user.name }}（{{ user.title }}·{{ user.dept }}）｜当前场景身份：<span class="tag blue">{{ typeLabel(user.scene) }}</span></div>
          <div class="muted small mt4">数据可见范围：{{ scopeName }}｜今日待办 {{ todos.length }} 项｜预警 {{ warnings.length }} 项｜未读通知 {{ notices.filter(n=>n.unread).length }} 条</div>
        </div>
        <div class="text-r">
          <div class="muted small">统计口径</div>
          <b>{{ metrics.period.label }}（{{ scopeName }}）</b>
        </div>
      </div></div>

      <!-- (B) 我的待办 -->
      <div class="card">
        <div class="card-head">
          <h2>📋 我的待办<span class="hint">（按优先级与时限紧迫度排序，最多展示 10 条）</span></h2>
          <a class="btn-link" v-if="todos.length" @click="viewAll('discuss-list')">查看全部 ›</a>
        </div>
        <div class="card-body">
          <div class="todo-list" v-if="todos.length">
            <div v-for="(t,i) in todos" :key="i" class="todo-card" :class="'lv-'+t.level">
              <div class="main">
                <div class="l1">
                  <span class="type">● {{ t.type }}</span>
                  <b>{{ t.name }}</b>
                  <span class="muted">住院号 {{ t.mrn }}</span>
                  <dict-tag :list="DN" :value="t.deathType"></dict-tag>
                  <span class="tag gray" v-if="t.dept !== user.dept">{{ t.dept }}</span>
                </div>
                <div class="l2">
                  <countdown-text :cd="{text:t.text, level:t.level}"></countdown-text>
                  <span v-if="t.note" class="tag orange">{{ t.note }}</span>
                  <span>{{ t.dept }}</span>
                </div>
              </div>
              <button class="btn primary sm" @click="open(t)">去处理</button>
            </div>
          </div>
          <empty-state v-else text="暂无待办任务 ✅" icon="🎉" sub="当前身份下所有任务均已处理完毕。可在顶部切换其他角色继续演示。"></empty-state>
        </div>
      </div>

      <div class="split">
        <div class="col" style="flex:1.35">
          <!-- (C) 关键指标概览 -->
          <div class="card">
            <div class="card-head">
              <h4>📈 关键指标概览<span class="hint">（{{ scopeName }} · {{ metrics.period.label }}，含环比）</span></h4>
              <a class="btn-link" v-if="canDrill()" @click="viewAll('stat-overview')">查看详情 ›</a>
            </div>
            <div class="card-body">
              <div class="stat-grid g2">
                <div class="stat-card clickable" v-for="(c,i) in cards" :key="i" @click="drill(c)">
                  <span class="icon">{{ c.icon }}</span>
                  <div class="label">{{ c.label }}</div>
                  <div class="value">{{ c.value }}<small>{{ c.unit }}</small></div>
                  <div class="delta">
                    <span :class="'delta ' + (c.delta>0?'up':(c.delta<0?'down':'flat'))">
                      {{ c.delta>0?'↑':(c.delta<0?'↓':'—') }} {{ Math.abs(c.delta) }}{{ c.unit==='%'?'pp':'%' }} 环比
                    </span>
                  </div>
                  <div class="muted small mt4" v-if="c.sub">{{ c.sub }}</div>
                </div>
              </div>
              <div class="alert plain mt12 mb0" v-if="!canDrill()">
                <span>🔒</span><div>指标卡「查看详情」跳转统计分析模块仅对医务部管理员开放（FD-1.1 B003）。</div>
              </div>
            </div>
          </div>

          <!-- 系统通知消息（P3） -->
          <div class="card">
            <div class="card-head"><h4>📩 系统通知消息</h4><a class="btn-link" @click="viewAll('home')">全部已读请在顶部 🔔 操作</a></div>
            <div class="card-body">
              <div v-for="n in notices" :key="n.id" class="notice-item" @click="openNotice(n)">
                <div class="ttl"><i class="new" v-if="n.unread"></i>{{ n.title }}<span class="tag gray">{{ n.scene }}</span></div>
                <div class="bd">{{ n.body }}</div>
                <div class="bd">{{ n.at }}</div>
              </div>
              <empty-state v-if="!notices.length" text="暂无系统通知" icon="🔕"></empty-state>
            </div>
          </div>
        </div>

        <div class="col">
          <!-- (D) 预警通知 -->
          <div class="card">
            <div class="card-head">
              <h4>🚨 预警通知<span class="hint">（按紧急程度排序）</span></h4>
            </div>
            <div class="card-body">
              <div v-if="warnings.length">
                <div class="warn-item" v-for="(w,i) in warnings" :key="i" :class="w.level" @click="viewWarn(w)" style="cursor:pointer">
                  <span class="dot"></span>
                  <div style="flex:1;min-width:0">
                    <div><b>{{ w.kind }}</b> <span class="muted">{{ w.target }}</span></div>
                    <div class="muted small">{{ w.text }}</div>
                  </div>
                  <a class="btn-link">查看</a>
                </div>
              </div>
              <empty-state v-else text="暂无预警通知" icon="✅" sub="当前范围内没有超时或漏报事项。"></empty-state>
              <div class="text-r mt8"><a class="btn-link" v-if="warnings.length" @click="viewWarn(warnings[0])">查看全部 ›</a></div>
            </div>
          </div>

          <!-- (E) 快速入口 -->
          <div class="card">
            <div class="card-head"><h4>⚡ 快速入口</h4><span class="hint small">按当前角色动态显示</span></div>
            <div class="card-body">
              <div class="quick-grid">
                <button class="quick-btn" v-for="(q,i) in quick" :key="i" @click="goQuick(q)">
                  <span class="ic">{{ q.ic }}</span><span>{{ q.t }}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h4>🧭 演示提示</h4></div>
            <div class="card-body small">
              <p class="muted" style="line-height:1.9;margin:0">
                本页为<b>{{ typeLabel(user.scene) }}</b>视角的聚合工作台。点击右上角「🎬 本角色演示动线」查看该角色应完成的每一步；
                切换到下一角色即可接续流程，六个角色走完即为完整 PDCA 闭环。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>`,
  };
})(window);
