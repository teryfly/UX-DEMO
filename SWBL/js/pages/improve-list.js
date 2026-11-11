/* =====================================================================
 * pages/improve-list.js —— L2-3 改进跟踪（WF-L2-3 / IA-2.7 / FD-1.8 / IX-2.7）
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Limit = global.Limit;

  global.AMS.pages['improve-list'] = {
    data: function () {
      return {
        filter: { biz: 'all', owner: 'all', dept: 'all', overdue: 'all', from: '', to: '', keyword: '' },
        query: { biz: 'all', owner: 'all', dept: 'all', overdue: 'all', from: '', to: '', keyword: '' },
        sort: 'due', page: 1, size: 20,
        IS: D.IMPROVE_STATUS
      };
    },
    computed: {
      user: function () { return App.user(); },
      overview: function () { App.state.refresh; return Svc.improveOverview(App.user()); },
      filtered: function () {
        App.state.refresh; App.state.clock;
        return Svc.improveList(App.user(), Object.assign({ sort: this.sort }, this.query));
      },
      total: function () { return this.filtered.length; },
      rows: function () { var s = (this.page - 1) * this.size; return this.filtered.slice(s, s + this.size); },
      owners: function () {
        var set = {};
        Svc.improveRows(App.user()).forEach(function (r) { set[r.owner] = 1; });
        return Object.keys(set).sort();
      },
      depts: function () { return Svc.depts().map(function (d) { return d.name; }); }
    },
    created: function () {
      var p = App.state.params || {};
      if (p.overdue) { this.query.overdue = p.overdue; this.filter.overdue = p.overdue; }
      if (p.biz) { this.query.biz = p.biz; this.filter.biz = p.biz; }
    },
    methods: {
      runQuery: function () {
        if (this.query.from && this.query.to && Date.parse(this.query.from) > Date.parse(this.query.to)) {
          App.toast('起始日期不能晚于结束日期', 'error'); return;
        }
        this.query = Object.assign({}, this.filter); this.page = 1; App.bump();
      },
      reset: function () {
        this.filter = { biz: 'all', owner: 'all', dept: 'all', overdue: 'all', from: '', to: '', keyword: '' };
        this.query = Object.assign({}, this.filter); this.page = 1; App.bump();
      },
      open: function (r, mode) { App.navigate('improve-detail', { id: r.id, mode: mode }); },
      async markGood(r) {
        var okc = await App.ask('确认将该改进措施标记为优秀措施？标记后可供医务部全院推广。', { title: '标记优秀措施' });
        if (!okc) return;
        Svc.markExcellent(r.id, App.user(), true);
        App.toast('已标记为优秀改进措施（可全院推广）');
        App.bump();
      },
      stateTag: function (r) { return r.state === 'overdue' ? 'red' : (r.state === 'soon' ? 'yellow' : 'green'); },
      canEdit: function (r) { return App.can('director') && r.biz === 'not-started' && (r.dept === App.user().dept || Svc.scopeOf(App.user()) === 'hospital'); },
      canEval: function (r) { return App.can('director') && r.biz === 'to-evaluate' && (r.dept === App.user().dept || Svc.scopeOf(App.user()) === 'hospital'); },
      canExec: function (r) { return r.mine && ['not-started', 'in-progress'].indexOf(r.biz) >= 0; },
      actionText: function (r) {
        if (this.canEval(r)) return '评估';
        if (this.canExec(r)) return r.biz === 'not-started' ? '开始' : '更新进度';
        if (this.canEdit(r)) return '确认任务';
        return '查看';
      },
      exportRows: function () {
        var headers = ['措施编号', '改进措施', '所属病例', '住院号', '科室', '责任人', '完成时限', '时限状态', '任务状态', 'PDCA轮次', '优秀措施'];
        var rows = this.filtered.map(function (r) {
          return [r.id, r.text, r.patientName, r.mrn, r.dept, r.owner, r.due, r.stateText, D.improveStatusName(r.biz), '第' + r.round + '轮', r.excellent ? '可全院推广' : ''];
        });
        Svc.exportCsv('改进跟踪任务清单_' + Limit.donly(Date.now()) + '.csv', headers, rows);
        App.toast('已导出 ' + rows.length + ' 条改进任务清单');
        App.bump();
      }
    },
    template: `
    <div>
      <div class="page-head">
        <div><h1>🔄 改进跟踪</h1>
          <div class="desc">讨论记录中的改进措施自动任务化 · 执行跟踪 · 效果评估 · PDCA 闭环</div></div>
        <div class="btn-row"><button class="btn sm" @click="exportRows">导出清单</button></div>
      </div>

      <div class="stat-grid g4 mb12">
        <div class="stat-card"><div class="label">改进任务总数</div><div class="value">{{ overview.all }}<small>项</small></div></div>
        <div class="stat-card"><div class="label">🔵 未开始 / 进行中</div><div class="value">{{ overview.notStarted }} / {{ overview.progress }}<small>项</small></div></div>
        <div class="stat-card"><div class="label">🟠 待评估</div><div class="value">{{ overview.toEval }}<small>项</small></div><div class="muted small" v-if="can('director')">本科室待您评估的措施</div></div>
        <div class="stat-card" :class="{warn: overview.overdue>0}"><div class="label">🔴 超时未落实</div><div class="value">{{ overview.overdue }}<small>项</small></div><div class="muted small">⭐ 优秀措施 {{ overview.excellent }} 项</div></div>
      </div>

      <div class="card"><div class="card-body">
        <div class="filter-bar">
          <div class="field"><label>任务状态</label>
            <select v-model="query.biz" @change="page=1"><option value="all">全部</option><option v-for="s in IS" :value="s.code">{{ s.name }}</option></select></div>
          <div class="field"><label>责任人</label>
            <select v-model="query.owner" @change="page=1"><option value="all">全部</option><option v-for="o in owners" :value="o">{{ o }}</option></select></div>
          <div class="field" v-if="canRole('quality')"><label>所属科室</label>
            <select v-model="query.dept" @change="page=1"><option value="all">全部</option><option v-for="d in depts" :value="d">{{ d }}</option></select></div>
          <div class="field"><label>是否超时</label>
            <select v-model="query.overdue" @change="page=1"><option value="all">全部</option><option value="yes">是（超时）</option><option value="no">否</option></select></div>
          <div class="field"><label>时限范围（起）</label><input type="date" v-model="query.from"></div>
          <div class="field"><label>时限范围（止）</label><input type="date" v-model="query.to"></div>
          <div class="field" style="flex:1;min-width:170px"><label>措施 / 患者</label><input type="text" v-model="query.keyword" @keyup.enter="runQuery"></div>
          <div class="btn-row"><button class="btn primary" @click="runQuery">查 询</button><button class="btn" @click="reset">重 置</button></div>
        </div>
      </div></div>

      <div class="card">
        <div class="card-head">
          <span class="small muted">共 <b>{{ total }}</b> 条改进任务</span>
          <div class="field inline"><label class="small muted">排序</label>
            <select style="width:auto" v-model="sort">
              <option value="due">完成时限</option><option value="biz">任务状态</option>
              <option value="owner">责任人</option><option value="created">创建时间</option>
            </select></div>
        </div>
        <div class="card-body tight"><div class="table-wrap">
          <table class="tbl">
            <thead><tr>
              <th>改进措施摘要</th><th>所属病例</th><th>科室</th><th>责任人</th><th>完成时限</th>
              <th>时限状态</th><th>任务状态</th><th style="width:130px">执行进度</th><th>轮次</th><th style="width:110px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id" :class="{overtime: r.state==='overdue' && ['done','cancelled'].indexOf(r.biz)<0}">
                <td style="max-width:300px">
                  <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="r.text">{{ r.excellent ? '⭐ ' : '' }}{{ r.text }}</div>
                  <div class="muted small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">预期：{{ r.expected || '—' }}</div>
                </td>
                <td><b>{{ r.patientName }}</b><div class="muted small mono">{{ r.mrn }}</div></td>
                <td>{{ r.dept }}</td>
                <td>{{ r.owner }}<span class="tag blue" v-if="r.mine">我负责</span></td>
                <td>{{ r.due }}</td>
                <td><span class="tag" :class="['done','cancelled'].indexOf(r.biz)>=0 ? 'gray' : stateTag(r)">{{ ['done','cancelled'].indexOf(r.biz)>=0 ? '—' : r.stateText }}</span></td>
                <td><dict-tag :list="IS" :value="r.biz"></dict-tag>
                  <span class="tag purple" v-if="r.round>1" title="上一轮评估为需持续改进，自动开启新一轮">第{{ r.round }}轮</span></td>
                <td><progress-bar :value="r.progress" thin="true" :kind="r.biz==='done'?'green':(r.state==='overdue'?'danger':'')"></progress-bar></td>
                <td><span class="tag green" v-if="r.excellent">可全院推广</span><span class="muted small" v-else>—</span></td>
                <td class="actions">
                  <button class="btn-link" @click="open(r)">{{ actionText(r) }}</button>
                  <button class="btn-link" v-if="canEval(r)" @click="open(r,'evaluate')">评估</button>
                  <button class="btn-link" v-if="can('director') && r.biz==='done' && !r.excellent" @click="markGood(r)">标记优秀</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <empty-state v-if="!rows.length" text="暂无改进任务" icon="🔄" sub="讨论记录归档后，系统会自动提取模块⑧改进措施生成任务。">
          <button class="btn" @click="home">回到首页</button>
        </empty-state>
        </div>
        <ui-pager v-if="total" :total="total" v-model:page="page" v-model:size="size"></ui-pager>
      </div>

      <div class="card"><div class="card-body small muted" style="line-height:2">
        <b>时限规则</b>：正常（绿色）→ 临近截止提醒（黄色，剩余 ≤ {{ remindDays }} 天，来自「时限规则配置」）→ 超时（红色，自动升级推送科主任并记入时效统计）；
        <b>PDCA</b>：效果评估选择「需要持续改进」时自动生成下一轮任务并保留迭代关联；<b>优秀措施</b>由科主任标记，供医务部全院推广。
      </div></div>
    </div>`
  };
  var pg = global.AMS.pages['improve-list'];
  Object.assign(pg.computed, {
    remindDays: function () { return Limit.config().improveRemindDays; }
  });
  pg.methods.home = function () { App.navigate('home'); };
})(window);
