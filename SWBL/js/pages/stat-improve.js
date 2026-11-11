/* =====================================================================
 * pages/stat-improve.js —— L3-4-5 改进跟踪统计（WF-L3-4-5 / IA-2.13 / FD-1.14）
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Stats = global.Stats, Limit = global.Limit;

  global.AMS.pages['stat-improve'] = {
    data: function () { return { g: 'quarter', offset: 0, ofDept: 'all', ofLevel: 'all' }; },
    computed: {
      p: function () { return Stats.period(this.g, this.offset); },
      s: function () { App.state.refresh; App.state.clock; return Stats.improveStats(App.user(), this.p); },
      cards: function () {
        return [
          { label: '改进措施总数', value: this.s.total, unit: '项', delta: Stats.delta(this.s.total, this.s.totalAll || this.s.total) },
          { label: '已落实数量', value: this.s.done, unit: '项' },
          { label: '落实率', value: this.s.rate, unit: '%', delta: Stats.delta(this.s.rate, this.s.ratePrev) },
          { label: '平均落实时间', value: this.s.avgDays, unit: '天' }
        ];
      },
      dist: function () {
        var d = this.s.dist;
        return [
          { label: '已完成', value: d.done || 0, color: '#52C41A' },
          { label: '进行中', value: d['in-progress'] || 0, color: '#1890FF' },
          { label: '待评估', value: d['to-evaluate'] || 0, color: '#FAAD14' },
          { label: '未开始', value: d['not-started'] || 0, color: '#BFBFBF' },
          { label: '已取消', value: d.cancelled || 0, color: '#FF7875' }
        ];
      },
      overdue: function () {
        var list = this.s.overdue, self = this;
        if (this.ofDept !== 'all') list = list.filter(function (r) { return r.dept === self.ofDept; });
        if (this.ofLevel !== 'all') list = list.filter(function (r) { return r.overdueDays >= (this.ofLevel === 'high' ? 15 : (this.ofLevel === 'mid' ? 7 : 1)); }, this);
        return list;
      },
      depts: function () { return Svc.depts().map(function (d) { return d.name; }); }
    },
    methods: {
      open: function (r) { App.navigate('improve-detail', { id: r.id }); },
      exportOverdue: function () {
        var rows = this.overdue.map(function (r) {
          return [r.id, r.patientName + '/' + r.mrn, r.dept, r.text, r.owner, r.due, r.overdueDays + ' 天', D.improveStatusName(r.biz)];
        });
        Svc.exportCsv('超时未落实改进措施清单.csv', ['任务编号', '关联病例', '科室', '措施内容', '责任人', '应完成时间', '已超时', '任务状态'], rows);
        App.toast('已导出超时未落实清单（' + rows.length + ' 条）');
        App.bump();
      },
      exportAll: function () {
        var rows = this.s.rows.map(function (r) {
          return [r.id, r.patientName + '/' + r.mrn, r.dept, r.text, r.owner, r.due, r.actualMs ? Limit.donly(r.actualMs) : '—', D.improveStatusName(r.biz), r.progress + '%', r.excellent ? '可全院推广' : ''];
        });
        Svc.exportCsv('全部改进措施明细.csv', ['任务编号', '关联病例', '科室', '措施内容', '责任人', '应完成时间', '实际完成时间', '状态', '进度', '标记'], rows);
        App.toast('已导出全量明细（' + rows.length + ' 条）');
        App.bump();
      },
      refresh: function () { App.bump(); App.toast('改进跟踪统计已刷新'); }
    },
    template: `
    <div>
      <div class="page-head">
        <div><h1>🔄 改进跟踪统计</h1><div class="desc">改进措施执行与落实情况统计：落实率、状态分布、趋势、科室对比与超时未落实清单</div></div>
      </div>
      <period-bar v-model:g="g" v-model:offset="offset" :label="p.label" @refresh="refresh"></period-bar>

      <div class="stat-grid g4 mb12">
        <div class="stat-card" v-for="(c,i) in cards" :key="i">
          <div class="label">{{ c.label }}</div>
          <div class="value">{{ c.value }}<small>{{ c.unit }}</small></div>
          <div class="delta" v-if="c.delta!==null && c.delta!==undefined">
            <span :class="c.delta>0?'delta good-up':(c.delta<0?'delta good-down':'delta flat')">{{ c.delta>0?'↑':(c.delta<0?'↓':'—') }} {{ Math.abs(c.delta) }} 环比</span>
          </div>
        </div>
      </div>

      <div class="chart-grid mb12">
        <div class="chart-box">
          <h4>措施状态分布<span class="tag red" v-if="s.overdue.length">超时未落实 {{ s.overdue.length }} 项</span></h4>
          <pie-chart :data="dist"></pie-chart>
        </div>
        <div class="chart-box"><h4>改进落实率趋势（近 6 个周期）</h4>
          <line-chart :series="[{key:'r',name:'落实率',color:'#52C41A',points:s.trend}]" :height="200" unit="%"></line-chart></div>
      </div>

      <div class="card"><div class="card-body">
        <b class="small">各科室改进落实率对比<span class="muted">（达标线 90%）</span></b>
        <div class="mt8"><hbar-chart :data="s.byDept" unit="%" :width="120"
             :kind="'g'"></hbar-chart></div>
      </div></div>

      <div class="card">
        <div class="card-head">
          <h4>🔴 超时未落实措施清单<span class="hint small">（{{ overdue.length }} 条，可下钻任务详情）</span></h4>
          <div class="row">
            <select style="width:auto" v-model="ofDept"><option value="all">全部科室</option><option v-for="d in depts" :value="d">{{ d }}</option></select>
            <select style="width:auto" v-model="ofLevel"><option value="all">全部超时等级</option><option value="low">1-6 天</option><option value="mid">7-14 天</option><option value="high">≥15 天</option></select>
            <button class="btn sm" @click="exportOverdue">导出 Excel</button>
          </div>
        </div>
        <div class="card-body tight"><div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>任务编号</th><th>关联病例</th><th>科室</th><th>措施内容</th><th>责任人</th><th>应完成时间</th><th>已超时</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="r in overdue" :key="r.id" class="overtime">
                <td class="mono small">{{ r.id }}</td>
                <td>{{ r.patientName }}<div class="muted small mono">{{ r.mrn }}</div></td>
                <td>{{ r.dept }}</td>
                <td style="max-width:280px">{{ r.text }}</td>
                <td>{{ r.owner }}</td>
                <td>{{ r.due }}</td>
                <td><span class="tag" :class="r.overdueDays>=15?'solid-red':(r.overdueDays>=7?'red':'orange')">超时 {{ r.overdueDays }} 天</span></td>
                <td><button class="btn-link" @click="open(r)">查看</button></td>
              </tr>
            </tbody>
          </table>
          <empty-state v-if="!overdue.length" text="暂无超时未落实记录" icon="✅" sub="本期改进措施均已按期落实或尚未到期。"></empty-state>
        </div></div>
      </div>

      <div class="card">
        <div class="card-head"><h4>全部改进措施明细<span class="hint small">（{{ s.rows.length }} 条）</span></h4>
          <button class="btn sm" @click="exportAll">导出 Excel</button></div>
        <div class="card-body tight"><div class="table-wrap" style="max-height:420px;overflow:auto">
          <table class="tbl dense">
            <thead><tr><th>任务编号</th><th>关联病例</th><th>科室</th><th>措施摘要</th><th>责任人</th><th>状态</th><th>应完成</th><th>实际完成</th><th>进度</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="r in s.rows.slice(0,80)" :key="r.id">
                <td class="mono small">{{ r.id }}</td>
                <td>{{ r.patientName }}</td><td>{{ r.dept }}</td>
                <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="r.text">{{ r.excellent?'⭐ ':'' }}{{ r.text }}</td>
                <td>{{ r.owner }}</td>
                <td><dict-tag :list="IS" :value="r.biz"></dict-tag></td>
                <td>{{ r.due }}</td>
                <td>{{ r.actualMs ? dd(r.actualMs) : '—' }}</td>
                <td><progress-bar :value="r.progress" thin="true" :kind="r.biz==='done'?'green':''"></progress-bar></td>
                <td><button class="btn-link" @click="open(r)">查看</button></td>
              </tr>
            </tbody>
          </table>
        </div></div>
      </div>
    </div>`,
    created: function () { this.IS = D.IMPROVE_STATUS; }
  };
  var pg = global.AMS.pages['stat-improve'];
  Object.assign(pg.methods, { dd: function (v) { return Limit.donly(v); } });
})(window);
