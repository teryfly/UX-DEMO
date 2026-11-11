/* =====================================================================
 * pages/stat-timeliness.js —— L3-4-6 时效分析（WF-L3-4-6 / IA-2.14 / FD-1.15）
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Stats = global.Stats, Limit = global.Limit;

  global.AMS.pages['stat-timeliness'] = {
    data: function () { return { g: 'quarter', offset: 0, odDept: 'all', odType: 'all', msDept: 'all', msStatus: 'all' }; },
    computed: {
      p: function () { return Stats.period(this.g, this.offset); },
      t: function () { App.state.refresh; App.state.clock; return Stats.timeliness(App.user(), this.p); },
      cards: function () {
        var t = this.t;
        return [
          { label: '讨论时限达标率', value: t.discussRate, unit: '%', delta: t.deltaDiscuss, sub: '平均讨论耗时 ' + t.avgDiscussDays + ' 天' },
          { label: '上报时限达标率', value: t.reportRate, unit: '%', sub: '平均上报时间 ' + t.avgReportDays + ' 天' },
          { label: '改进措施按时落实率', value: t.improveRate, unit: '%', sub: '平均落实时间 ' + t.avgLandingDays + ' 天' }
        ];
      },
      overdueDiscuss: function () {
        var list = this.t.overdueDiscuss, self = this;
        if (this.odDept !== 'all') list = list.filter(function (c) { return c.deptName === self.odDept; });
        if (this.odType !== 'all') list = list.filter(function (c) { return c.deathType === self.odType; });
        return list;
      },
      missed: function () {
        var list = this.t.missed, self = this;
        if (this.msDept !== 'all') list = list.filter(function (c) { return c.deptName === self.msDept; });
        if (this.msStatus !== 'all') list = list.filter(function (c) { return c.reportStatus === self.msStatus; });
        return list;
      },
      depts: function () { return Svc.depts().map(function (d) { return d.name; }); },
      typeRows: function () {
        var b = this.t.byType;
        return Object.keys(b).map(function (k) { return b[k]; });
      }
    },
    methods: {
      viewDiscuss: function (c) { App.goCase('discuss-detail', c.encId); },
      viewReport: function (c) { App.goCase('report-form', c.encId, { readonly: true }); },
      exportList: function (kind) {
        var list = kind === 'discuss' ? this.overdueDiscuss : this.missed;
        var headers = kind === 'discuss'
          ? ['患者姓名', '住院号', '科室', '死亡时间', '死亡类型', '应讨论截止时间', '实际讨论时间', '超时天数']
          : ['患者姓名', '住院号', '科室', '死亡时间', '死亡类型', '应上报截止时间', '上报状态', '超时天数'];
        var rows = list.map(function (c) {
          var cd = kind === 'discuss' ? c.discussCountdown : c.reportCountdown;
          return [c.name, c.mrn, c.deptName, Limit.dt(c.deathMs), D.deathTypeName(c.deathType),
            Limit.dt(cd.deadline), (kind === 'discuss' ? (c.discussActualMs ? Limit.dt(c.discussActualMs) : '未讨论') : (c.reportActualMs ? Limit.dt(c.reportActualMs) : '未上报')),
            Limit.overdueDays(cd.deadline, kind === 'discuss' ? c.discussActualMs : c.reportActualMs) + ' 天'];
        });
        Svc.exportCsv((kind === 'discuss' ? '超时讨论病例清单' : '漏报超时上报病例清单') + '_' + this.p.label + '.csv', headers, rows);
        App.toast('已导出 ' + rows.length + ' 条清单');
        App.bump();
      },
      refresh: function () { App.bump(); App.toast('时效统计已刷新'); },
      overDays: function (c, kind) {
        var cd = kind === 'discuss' ? c.discussCountdown : c.reportCountdown;
        return Limit.overdueDays(cd.deadline, kind === 'discuss' ? c.discussActualMs : c.reportActualMs);
      }
    },
    template: `
    <div>
      <div class="page-head">
        <div><h1>⏱ 时效分析</h1><div class="desc">讨论、上报、改进各环节时限达标率与超时/漏报问题清单（阈值取自「时限规则配置」）</div></div>
      </div>
      <period-bar v-model:g="g" v-model:offset="offset" :label="p.label" @refresh="refresh"></period-bar>

      <div class="stat-grid g3 mb12">
        <div class="stat-card" v-for="(c,i) in cards" :key="i">
          <div class="label">{{ c.label }}</div>
          <div class="value">{{ c.value }}<small>{{ c.unit }}</small></div>
          <div class="delta" v-if="c.delta!==undefined && c.delta!==null">
            <span :class="c.delta>=0?'delta good-up':'delta good-down'">{{ c.delta>=0?'↑':'↓' }} {{ Math.abs(c.delta) }}pp 环比</span>
          </div>
          <div class="muted small mt4">{{ c.sub }}</div>
        </div>
      </div>

      <div class="chart-grid mb12">
        <div class="chart-box"><h4>时限达标率趋势（讨论环节，近 6 周期）</h4>
          <line-chart :series="[{key:'d',name:'讨论达标率',color:'#1890FF',points:t.trend}]" :height="190" unit="%"></line-chart></div>
        <div class="chart-box">
          <h4>按死亡类型分维度达标情况<span class="muted small">（不同类型时限要求不同）</span></h4>
          <table class="tbl dense">
            <thead><tr><th>死亡类型</th><th class="num">例数</th><th>时限要求</th><th class="num">讨论达标率</th><th class="num">上报达标率</th></tr></thead>
            <tbody><tr v-for="r in typeRows" :key="r.name">
              <td><b>{{ r.name }}</b></td><td class="num">{{ r.n }}</td><td class="small muted">{{ r.limit }}</td>
              <td class="num" :class="r.discuss>=90?'green':(r.discuss<70?'orange':'')">{{ r.discuss }}%</td>
              <td class="num" :class="r.report>=90?'green':(r.report<70?'orange':'')">{{ r.report }}%</td>
            </tr></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h4>🔴 超时讨论病例清单<span class="hint small">（{{ overdueDiscuss.length }} 例）</span></h4>
          <div class="row">
            <select style="width:auto" v-model="odDept"><option value="all">全部科室</option><option v-for="d in depts" :value="d">{{ d }}</option></select>
            <select style="width:auto" v-model="odType"><option value="all">全部死亡类型</option><option value="expected">预期死亡</option><option value="unexpected">非预期死亡</option><option value="special">特殊死亡</option><option value="pending">待人工判定</option></select>
            <button class="btn sm" @click="exportList('discuss')">导出 Excel</button>
          </div>
        </div>
        <div class="card-body tight"><div class="table-wrap" style="max-height:400px;overflow:auto">
          <table class="tbl">
            <thead><tr><th>患者姓名</th><th>住院号</th><th>科室</th><th>死亡时间</th><th>死亡类型</th><th>应讨论截止</th><th>实际讨论时间</th><th>超时天数</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="c in overdueDiscuss" :key="c.encId" class="overtime">
                <td><b>{{ c.name }}</b></td><td class="mono">{{ c.mrn }}</td><td>{{ c.deptName }}</td>
                <td>{{ md(c.deathMs) }}</td>
                <td><dict-tag :list="DICT.death" :value="c.deathType"></dict-tag></td>
                <td>{{ dt(c.discussCountdown.deadline) }}</td>
                <td>{{ c.discussActualMs ? dt(c.discussActualMs) : '未讨论' }}</td>
                <td><span class="tag" :class="overDays(c,'discuss')>=15?'solid-red':'red'">超时 {{ overDays(c,'discuss') }} 天</span></td>
                <td><button class="btn-link" @click="viewDiscuss(c)">查看讨论</button></td>
              </tr>
            </tbody>
          </table>
          <empty-state v-if="!overdueDiscuss.length" text="暂无超时讨论病例" icon="✅"></empty-state>
        </div></div>
      </div>

      <div class="card">
        <div class="card-head">
          <h4>🟠 漏报 / 超时上报病例清单<span class="hint small">（{{ missed.length }} 例）</span></h4>
          <div class="row">
            <select style="width:auto" v-model="msDept"><option value="all">全部科室</option><option v-for="d in depts" :value="d">{{ d }}</option></select>
            <select style="width:auto" v-model="msStatus"><option value="all">全部上报状态</option><option value="to-fill">待填写（漏报）</option><option value="level-1">待一级审核</option><option value="level-2">待二级审核</option><option value="level-3">待三级审核</option></select>
            <button class="btn sm" @click="exportList('report')">导出 Excel</button>
          </div>
        </div>
        <div class="card-body tight"><div class="table-wrap" style="max-height:400px;overflow:auto">
          <table class="tbl">
            <thead><tr><th>患者姓名</th><th>住院号</th><th>科室</th><th>死亡时间</th><th>应上报截止</th><th>实际上报时间</th><th>上报状态</th><th>超时天数</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="c in missed" :key="'m'+c.encId" class="overtime">
                <td><b>{{ c.name }}</b></td><td class="mono">{{ c.mrn }}</td><td>{{ c.deptName }}</td>
                <td>{{ md(c.deathMs) }}</td><td>{{ dt(c.reportCountdown.deadline) }}</td>
                <td>{{ c.reportActualMs ? dt(c.reportActualMs) : '未上报' }}</td>
                <td><dict-tag :list="DICT.report" :value="c.reportStatus"></dict-tag></td>
                <td><span class="tag" :class="overDays(c,'report')>=15?'solid-red':'orange'">超时 {{ overDays(c,'report') }} 天</span></td>
                <td><button class="btn-link" @click="viewReport(c)">查看上报单</button></td>
              </tr>
            </tbody>
          </table>
          <empty-state v-if="!missed.length" text="暂无漏报、超时上报病例" icon="✅"></empty-state>
        </div></div>
      </div>
    </div>`,
    created: function () { this.DICT = { death: D.DEATH_TYPES, report: D.REPORT_STATUS }; }
  };
  var pg = global.AMS.pages['stat-timeliness'];
  Object.assign(pg.methods, {
    dt: function (v) { return Limit.dt(v); },
    md: function (v) { return Limit.mdhm(v); }
  });
})(window);
