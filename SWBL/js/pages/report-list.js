/* =====================================================================
 * pages/report-list.js —— L2-2 上报管理（WF-L2-2 / IA-2.5 / FD-1.6 / IX-2.5）
 * 双视图：上报人员视图（本人/本科室待填与进度 + 三色预警倒计时）
 *         审核人员视图（我的审核状态 + 提交审核时间倒序，不展示倒计时）
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Limit = global.Limit, Flow = global.Flow;

  global.AMS.pages['report-list'] = {
    data: function () {
      return {
        status: 'all',
        filter: { status: 'all', deathType: 'all', dept: 'all', level: 'all', from: '', to: '', keyword: '' },
        query: { status: 'all', deathType: 'all', dept: 'all', level: 'all', from: '', to: '', keyword: '' },
        sort: 'report-countdown', page: 1, size: 20, selected: [], expanded: {},
        DN: D.DEATH_TYPES, RS: D.REPORT_STATUS, WL: D.WARNING
      };
    },
    computed: {
      user: function () { return App.user(); },
      review: function () { return Svc.reviewView(App.user()); },
      overview: function () { App.state.refresh; return Svc.reportOverview(App.user()); },
      counts: function () {
        App.state.refresh;
        var list = Svc.reportList(App.user(), {});
        var o = { all: list.length, 'to-fill': 0, 'level-1': 0, 'level-2': 0, 'level-3': 0, returned: 0, done: 0, mine: 0 };
        list.forEach(function (c) {
          o[c.reportStatus] = (o[c.reportStatus] || 0) + 1;
          if (Flow.myReviewStatus(c.reportFlow, App.user().id).code === 'to-review') o.mine++;
        });
        return o;
      },
      tabs: function () {
        var c = this.counts, o = this.overview;
        if (this.review) {
          return [{ code: 'all', name: '全部', n: c.all }, { code: 'mine', name: '我的待审核', n: c.mine },
            { code: 'level-1', name: '待一级审核', n: c['level-1'] }, { code: 'level-2', name: '待二级审核', n: c['level-2'] },
            { code: 'level-3', name: '待三级审核', n: c['level-3'] }, { code: 'done', name: '已完成', n: c.done }];
        }
        return [{ code: 'all', name: '全部', n: c.all }].concat(D.REPORT_STATUS.map(function (s) {
          return { code: s.code, name: s.name, n: c[s.code] || 0 };
        }));
      },
      filtered: function () {
        App.state.refresh; App.state.clock;
        var q = Object.assign({ status: this.status, sort: this.sort }, this.query);
        return Svc.reportList(App.user(), q);
      },
      total: function () { return this.filtered.length; },
      rows: function () {
        var s = (this.page - 1) * this.size;
        return this.filtered.slice(s, s + this.size);
      },
      depts: function () { return Svc.depts().map(function (d) { return d.name; }); },
      sortOptions: function () {
        return this.review
          ? [{ code: 'submit-desc', name: '提交审核时间倒序' }, { code: 'death-desc', name: '死亡时间倒序' }]
          : [{ code: 'report-countdown', name: '上报时限倒计时' }, { code: 'death-desc', name: '死亡时间倒序' }, { code: 'status', name: '上报状态' }];
      }
    },
    created: function () {
      var p = App.state.params || {};
      if (p.status) { this.status = p.status; this.query.status = p.status; this.filter.status = p.status; }
      ['deathType', 'dept', 'level', 'keyword'].forEach(function (k) {
        if (p[k]) { this.filter[k] = p[k]; this.query[k] = p[k]; }
      }, this);
    },
    methods: {
      pickTab: function (c) { this.status = c; this.page = 1; },
      runQuery: function () {
        if (this.query.from && this.query.to && Date.parse(this.query.from) > Date.parse(this.query.to)) {
          App.toast('起始日期不能晚于结束日期', 'error'); return;
        }
        this.query = Object.assign({}, this.filter);
        this.page = 1; App.bump();
      },
      reset: function () {
        this.filter = { status: 'all', deathType: 'all', dept: 'all', level: 'all', from: '', to: '', keyword: '' };
        this.query = Object.assign({}, this.filter);
        this.status = 'all'; this.page = 1; App.bump();
      },
      rowAction: function (c) {
        if (c.reportStatus === 'to-fill') App.goCase('report-form', c.encId);
        else if (c.reportStatus === 'returned') App.goCase('report-form', c.encId);
        else if (this.review && Flow.myReviewStatus(c.reportFlow, App.user().id).code === 'to-review') App.goCase('report-form', c.encId);
        else App.goCase('report-form', c.encId, { readonly: true });
      },
      btnText: function (c) {
        if (c.reportStatus === 'to-fill') return '填写';
        if (c.reportStatus === 'returned') return '修改';
        if (this.review && Flow.myReviewStatus(c.reportFlow, App.user().id).code === 'to-review') return '审核';
        return '查看';
      },
      toggleExpand: function (c) { this.expanded[c.encId] = !this.expanded[c.encId]; },
      node: function (c) {
        var n = Flow.currentNode(c.reportFlow);
        return n ? n.name : '—';
      },
      myReview: function (c) { return Flow.myReviewStatus(c.reportFlow, App.user().id); },
      reviewTime: function (c) {
        var m = (c.reportFlow || []).filter(function (n) { return n.actorName === App.user().name && n.actedAt; });
        return m.length ? m[m.length - 1].actedAt : '——';
      },
      async urge() {
        if (!this.selected.length) { App.toast('请先勾选需要催办的待审核任务', 'warn'); return; }
        var ok = await App.ask('确定向选中任务的审核人发送催办提醒？', { title: '批量催办提醒' });
        if (!ok) return;
        App.toast('已向 ' + this.selected.length + ' 条任务的当前审核人发送催办提醒');
        this.selected.forEach(function (id) {
          var c = Svc.caseOf(id);
          if (c) Svc.notifyScene('review-task', c, { 提交人: App.user().name, 审核时限: '—' }, [App.user().scene]);
        });
        this.selected = [];
      },
      exportAll: function () {
        var self = this;
        var all = Svc.reportList(App.user(), Object.assign({ status: this.status, sort: this.sort }, this.query));
        var headers = ['患者姓名', '住院号', '科室', '死亡时间', '死亡类型', '上报状态', '当前审核节点', '上报时限倒计时', '预警等级'];
        var rows = all.map(function (c) {
          return [c.name, c.mrn, c.deptName, Limit.dt(c.deathMs), D.deathTypeName(c.deathType), D.reportStatusName(c.reportStatus),
            (Flow.currentNode(c.reportFlow) || {}).name || '—', c.reportCountdown.text, D.warningName(c.reportCountdown.level)];
        });
        var r = Svc.exportCsv('死亡病例上报任务清单_' + Limit.donly(Date.now()) + '.csv', headers, rows);
        App.toast(r.ok ? ('已导出 ' + rows.length + ' 条上报任务清单') : '当前环境不支持下载', r.ok ? 'success' : 'warn');
        App.bump();
      }
    },
    template: `
    <div>
      <div class="page-head">
        <div>
          <h1>📄 上报管理</h1>
          <div class="desc">{{ review ? '审核人员视图：处理流转至本人的死亡病例上报单审核（' + user.scene + '）' : '上报人员视图：填写、提交与跟踪死亡病例上报单' }}</div>
        </div>
        <div class="btn-row">
          <button class="btn sm" @click="urge">批量催办提醒</button>
          <button class="btn sm" @click="exportAll">批量导出上报任务清单</button>
        </div>
      </div>

      <!-- (C) 概览指标 -->
      <div class="stat-grid mb12" :class="review ? 'g3' : 'g4'">
        <template v-if="review">
          <div class="stat-card"><div class="label">⬜ 我的待审核</div><div class="value">{{ overview.toReview }}<small>条</small></div></div>
          <div class="stat-card"><div class="label">✅ 我已审核</div><div class="value">{{ overview.reviewed }}<small>条</small></div></div>
          <div class="stat-card"><div class="label">📚 全部上报单</div><div class="value">{{ overview.all }}<small>条</small></div></div>
        </template>
        <template v-else>
          <div class="stat-card"><div class="label">死亡病例总数</div><div class="value">{{ overview.all }}<small>条</small></div></div>
          <div class="stat-card"><div class="label">⬜ 待上报</div><div class="value">{{ overview.toFill }}<small>条</small></div></div>
          <div class="stat-card"><div class="label">🔵 审核中</div><div class="value">{{ overview.reviewing }}<small>条</small></div><div class="muted small" v-if="overview.returned">其中已退回 {{ overview.returned }} 条需修改</div></div>
          <div class="stat-card"><div class="label">✅ 已完成</div><div class="value">{{ overview.done }}<small>条</small></div></div>
        </template>
      </div>

      <!-- (D) 筛选 -->
      <div class="card"><div class="card-body">
        <div class="chip-row mb12">
          <span class="chip" v-for="t in tabs" :key="t.code" :class="{active: status===t.code}" @click="pickTab(t.code)">{{ t.name }}<b style="margin-left:5px">({{ t.n }})</b></span>
        </div>
        <div class="filter-bar">
          <div class="field"><label>上报状态</label>
            <select v-model="filter.status">
              <option value="all">全部</option>
              <option v-for="s in RS" :value="s.code">{{ s.name }}</option>
            </select></div>
          <div class="field"><label>死亡类型</label>
            <select v-model="filter.deathType"><option value="all">全部</option><option v-for="t in DN" :value="t.code">{{ t.name }}</option></select></div>
          <div class="field"><label>所属科室</label>
            <select v-model="filter.dept"><option value="all">全部</option><option v-for="d in depts" :value="d">{{ d }}</option></select></div>
          <div class="field" v-if="!review"><label>预警等级</label>
            <select v-model="filter.level"><option value="all">全部</option><option v-for="w in WL" :value="w.code">{{ w.name }}</option></select></div>
          <div class="field"><label>死亡时间（起）</label><input type="date" v-model="filter.from"></div>
          <div class="field"><label>死亡时间（止）</label><input type="date" v-model="filter.to"></div>
          <div class="field" style="flex:1;min-width:180px"><label>患者姓名 / 住院号</label><input type="text" v-model="filter.keyword" @keyup.enter="runQuery"></div>
          <div class="btn-row"><button class="btn primary" @click="runQuery">查 询</button><button class="btn" @click="reset">重 置</button></div>
        </div>
      </div></div>

      <!-- (E) 列表 -->
      <div class="card">
        <div class="card-head">
          <span class="small muted">共 <b>{{ total }}</b> 条记录{{ review ? '（审核视图不展示上报时限倒计时与预警等级）' : '' }}</span>
          <div class="field inline"><label class="small muted">排序</label>
            <select style="width:auto" v-model="sort" @change="page=1">
              <option v-for="o in sortOptions" :value="o.code">{{ o.name }}</option>
            </select></div>
        </div>
        <div class="card-body tight"><div class="table-wrap">
          <table class="tbl">
            <thead><tr>
              <th style="width:34px" v-if="review"><input type="checkbox" @change="selected=[]" ></th>
              <th>患者姓名</th><th>住院号</th><th>科室</th><th>死亡时间</th><th>死亡类型</th><th>上报状态</th>
              <th v-if="!review">预警</th>
              <th>当前审核节点</th>
              <th v-if="review">我的审核状态</th>
              <th v-if="!review">上报时限倒计时</th>
              <th v-if="review">审核时间</th>
              <th style="width:96px">操作</th>
            </tr></thead>
            <tbody>
              <template v-for="c in rows" :key="c.encId">
                <tr :class="{returned: c.reportStatus==='returned'}">
                  <td v-if="review"><input type="checkbox" :checked="selected.indexOf(c.encId)>=0" @change="selected.indexOf(c.encId)>=0?selected.splice(selected.indexOf(c.encId),1):selected.push(c.encId)"></td>
                  <td><b>{{ c.name }}</b></td>
                  <td class="mono">{{ c.mrn }}</td>
                  <td>{{ c.deptName }}</td>
                  <td>{{ md(c.deathMs) }}</td>
                  <td><dict-tag :list="DN" :value="c.deathType"></dict-tag></td>
                  <td>
                    <dict-tag :list="RS" :value="c.reportStatus"></dict-tag>
                    <button class="btn-link small" v-if="c.reportStatus==='returned'" @click="toggleExpand(c)">{{ expanded[c.encId] ? '收起' : '退回理由' }}</button>
                  </td>
                  <td v-if="!review">
                    <span class="tag" :class="wlCls(c.reportCountdown.level)">
                      {{ c.reportStatus==='done' ? '—' : wlName(c.reportCountdown.level) }}
                    </span>
                  </td>
                  <td>{{ node(c) }}</td>
                  <td v-if="review"><span class="tag" :class="myReview(c).cls">{{ myReview(c).name }}</span></td>
                  <td v-if="!review"><countdown-text :cd="c.reportCountdown"></countdown-text></td>
                  <td v-if="review" class="small">{{ reviewTime(c) }}</td>
                  <td class="actions"><button class="btn-link" @click="rowAction(c)">{{ btnText(c) }}</button></td>
                </tr>
                <tr class="expand-row" v-if="c.reportStatus==='returned' && expanded[c.encId]">
                  <td :colspan="review ? 10 : 10">
                    <b class="orange">🔙 退回理由：</b>{{ c.returnReason ? c.returnReason.text : '—' }}
                    <span class="muted" v-if="c.returnReason">（{{ c.returnReason.role }} {{ c.returnReason.by }} 于 {{ c.returnReason.at }} 退回，修改重提后将从{{ c.returnReason.levelName }}重新开始流转）</span>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <empty-state v-if="!rows.length" text="未找到符合条件的上报任务" icon="📄" sub="可清除筛选条件后重试。">
          <button class="btn" @click="reset">清除筛选条件</button>
        </empty-state>
        </div>
        <ui-pager v-if="total" :total="total" v-model:page="page" v-model:size="size"></ui-pager>
      </div>

      <div class="card"><div class="card-body small muted" style="line-height:2">
        <b>说明</b>：上报状态取「待填写 / 待一级审核 / 待二级审核 / 待三级审核 / 已退回 / 已完成」；
        预警等级按剩余时间占比触发（黄 &lt;50%、橙 &lt;20%、红 已超时），阈值可在「系统管理 › 时限规则配置」调整；
        三级审核链路（上级医师 → 科主任 → 医务部）可在「系统管理 › 审批流程配置」中调整层级与超时时限。
      </div></div>
    </div>`
  };
  var pg = global.AMS.pages['report-list'];
  Object.assign(pg.methods, {
    wlCls: function (lv) { return D.warningCls(lv); },
    wlName: function (lv) { return D.warningName(lv); }
  });
})(window);
