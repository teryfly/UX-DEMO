/* =====================================================================
 * pages/stat-dept.js —— L3-4-2 科室死亡病例分析（WF-L3-4-2 / IA-2.10 / FD-1.11）
 * 四张排名表 + 科室综合明细表 + 科室下钻弹窗 + 导出
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Stats = global.Stats, Limit = global.Limit;

  global.AMS.pages['stat-dept'] = {
    data: function () { return { g: 'quarter', offset: 0, detail: null, onlyHave: false }; },
    computed: {
      p: function () { return Stats.period(this.g, this.offset); },
      r: function () { App.state.refresh; return Stats.deptAnalysis(App.user(), this.p); },
      rows: function () { return this.onlyHave ? this.r.rows.filter(function (x) { return x.deaths > 0; }) : this.r.rows; },
      byDeaths: function () { return this.r.rows.slice().sort(function (a, b) { return b.deaths - a.deaths; }).slice(0, 8); },
      byRate: function () { return this.r.rows.filter(function (r) { return r.deaths > 0; }).sort(function (a, b) { return b.deathRate - a.deathRate; }).slice(0, 8); },
      byDiscuss: function () { return this.r.rows.filter(function (r) { return r.deaths > 0; }).sort(function (a, b) { return b.discussRate - a.discussRate; }).slice(0, 8); },
      byImprove: function () { return this.r.rows.filter(function (r) { return r.improveTotal > 0; }).sort(function (a, b) { return b.improveRate - a.improveRate; }).slice(0, 8); },
      cards: function () {
        return [
          { label: '涉及科室总数', value: this.r.totalDepts, unit: '个' },
          { label: '死亡例数最高科室', value: this.r.topDeaths ? this.r.topDeaths.name : '—', unit: this.r.topDeaths ? this.r.topDeaths.deaths + ' 例' : '' },
          { label: '死亡率最高科室', value: this.r.topRate ? this.r.topRate.name : '—', unit: this.r.topRate ? this.r.topRate.deathRate + '%' : '' },
          { label: '讨论完成率最低科室', value: this.r.lowDiscuss ? this.r.lowDiscuss.name : '—', unit: this.r.lowDiscuss ? this.r.lowDiscuss.discussRate + '%' : '' }
        ];
      }
    },
    methods: {
      openDetail: function (row) { this.detail = row; },
      close: function () { this.detail = null; },
      exportXls: function () {
        var headers = ['科室', '开放床位', '死亡例数', '出院人次', '死亡率%', '讨论完成率%', '上报完成率%', '改进任务数', '已落实', '改进落实率%', '平均落实天数', '超时讨论', '漏报'];
        var rows = this.rows.map(function (r) {
          return [r.name, r.beds, r.deaths, r.discharges, r.deathRate, r.discussRate, r.reportRate, r.improveTotal, r.improveDone, r.improveRate, r.avgLandingDays, r.overdueDiscuss, r.missed];
        });
        Svc.exportCsv('科室死亡病例分析_' + this.r.rows.length + '科室.csv', headers, rows);
        App.toast('已导出科室综合明细（' + rows.length + ' 个科室）');
        App.bump();
      },
      viewCase: function (c, mode) {
        this.detail = null;
        if (mode === 'discuss') App.goCase('discuss-detail', c.encId);
        else App.goCase('report-form', c.encId, { readonly: true });
      },
      rateCls: function (v, avg) { return v > avg * 1.25 ? 'red' : (v < avg * 0.75 ? 'green' : ''); },
      refresh: function () { App.bump(); App.toast('统计已刷新 ' + Limit.dt(Date.now())); }
    },
    template: `
    <div>
      <div class="page-head">
        <div><h1>🏥 科室死亡病例分析</h1><div class="desc">按科室维度统计死亡例数、死亡率、讨论与改进落实情况并排名对比</div></div>
      </div>
      <period-bar v-model:g="g" v-model:offset="offset" :label="p.label" :updated-at="r.updatedAt" @refresh="refresh"></period-bar>

      <div class="stat-grid g4 mb12">
        <div class="stat-card" v-for="(c,i) in cards" :key="i">
          <div class="label">{{ c.label }}</div>
          <div class="value" :style="{fontSize: typeof c.value==='string'&&c.value.length>4 ? '17px' : '25px'}">{{ c.value }}<small v-if="c.unit">{{ c.unit }}</small></div>
        </div>
      </div>

      <div class="chart-grid mb12">
        <div class="chart-box"><h4>科室死亡病例数排名</h4>
          <hbar-chart :data="byDeaths.map(x=>({label:x.name, value:x.deaths}))" unit=" 例"></hbar-chart></div>
        <div class="chart-box"><h4>科室死亡率排名<span class="muted small">（全院均值 {{ r.avgDeathRate }}%）</span></h4>
          <hbar-chart :data="byRate.map(x=>({label:x.name, value:x.deathRate, kind: x.deathRate > r.avgDeathRate ? 'r' : 'g'}))" unit="%"></hbar-chart></div>
        <div class="chart-box"><h4>科室讨论完成率排名</h4>
          <hbar-chart :data="byDiscuss.map(x=>({label:x.name, value:x.discussRate, kind: x.discussRate>=90?'g':(x.discussRate>=70?'':'o')}))" unit="%"></hbar-chart></div>
        <div class="chart-box"><h4>科室改进措施落实率排名</h4>
          <hbar-chart :data="byImprove.map(x=>({label:x.name, value:x.improveRate, kind: x.improveRate>=90?'g':(x.improveRate>=70?'':'o')}))" unit="%"></hbar-chart></div>
      </div>

      <div class="card">
        <div class="card-head">
          <h4>科室综合明细表<span class="hint small">（点击科室名或「明细」可下钻查看该科室死亡病例清单）</span></h4>
          <div class="btn-row">
            <label class="chip" :class="{active: onlyHave}" @click="onlyHave=!onlyHave">仅显示有死亡病例的科室</label>
            <button class="btn sm" @click="exportXls">导出 Excel</button>
          </div>
        </div>
        <div class="card-body tight"><div class="table-wrap">
          <table class="tbl">
            <thead><tr>
              <th style="width:52px">排名</th><th>科室</th><th class="num">死亡例数</th><th class="num">出院人次</th>
              <th class="num">死亡率</th><th class="num">讨论完成率</th><th class="num">上报完成率</th>
              <th class="num">改进落实率</th><th class="num">超时讨论</th><th class="num">漏报</th><th style="width:70px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="(row,i) in rows" :key="row.deptId" class="clickable" @click="openDetail(row)">
                <td><span class="rank" :class="i<3?('top'+(i+1)):''">{{ i+1 }}</span></td>
                <td><b>{{ row.name }}</b><span class="muted small">（{{ row.beds }} 床）</span></td>
                <td class="num">{{ row.deaths }}</td>
                <td class="num">{{ row.discharges }}</td>
                <td class="num"><span :class="rateCls(row.deathRate, r.avgDeathRate)">{{ row.deathRate }}%</span></td>
                <td class="num" :class="row.discussRate>=90?'green':(row.discussRate<70?'orange':'')">{{ row.discussRate }}%</td>
                <td class="num" :class="row.reportRate>=90?'green':(row.reportRate<70?'orange':'')">{{ row.reportRate }}%</td>
                <td class="num">{{ row.improveRate }}%<span class="muted small">（{{ row.improveDone }}/{{ row.improveTotal }}）</span></td>
                <td class="num" :class="row.overdueDiscuss?'red':''">{{ row.overdueDiscuss }}</td>
                <td class="num" :class="row.missed?'red':''">{{ row.missed }}</td>
                <td><button class="btn-link" @click.stop="openDetail(row)">明细</button></td>
              </tr>
            </tbody>
          </table>
        </div></div>
      </div>

      <!-- 科室下钻弹窗 -->
      <ui-modal v-if="detail" :title="detail.name + ' · 死亡病例明细（' + r.period.label + '）'" width="wide" @close="close">
        <div class="stat-grid g4 mb12">
          <div class="stat-card"><div class="label">死亡例数</div><div class="value">{{ detail.deaths }}</div></div>
          <div class="stat-card"><div class="label">死亡率</div><div class="value">{{ detail.deathRate }}<small>%</small></div></div>
          <div class="stat-card"><div class="label">讨论完成率</div><div class="value">{{ detail.discussRate }}<small>%</small></div></div>
          <div class="stat-card"><div class="label">改进落实率</div><div class="value">{{ detail.improveRate }}<small>%</small></div></div>
        </div>
        <div class="table-wrap" style="max-height:46vh;overflow:auto">
          <table class="tbl dense">
            <thead><tr><th>患者</th><th>住院号</th><th>死亡时间</th><th>死亡类型</th><th>主要死因</th><th>讨论状态</th><th>上报状态</th><th>时限</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="c in detail.cases" :key="c.encId" :class="{overtime: c.discussCountdown.overdue && c.discussStatus!=='archived'}">
                <td><b>{{ c.name }}</b><span class="muted small"> {{ c.gender }} {{ c.age }}岁</span></td>
                <td class="mono">{{ c.mrn }}</td>
                <td>{{ md(c.deathMs) }}</td>
                <td><dict-tag :list="DICT.death" :value="c.deathType"></dict-tag></td>
                <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ (c.deathDx||'').split('，')[0] }}</td>
                <td><dict-tag :list="DICT.discuss" :value="c.discussStatus"></dict-tag></td>
                <td><dict-tag :list="DICT.report" :value="c.reportStatus"></dict-tag></td>
                <td><countdown-text :cd="c.discussCountdown"></countdown-text></td>
                <td class="actions">
                  <button class="btn-link" @click="viewCase(c,'discuss')">讨论</button>
                  <button class="btn-link" @click="viewCase(c,'report')">上报</button>
                </td>
              </tr>
            </tbody>
          </table>
          <empty-state v-if="!detail.cases.length" text="暂无该科室死亡病例" icon="📭"></empty-state>
        </div>
        <template #foot><button class="btn" @click="close">关闭</button></template>
      </ui-modal>
    </div>`,
    created: function () { this.DICT = { death: D.DEATH_TYPES, discuss: D.DISCUSS_STATUS, report: D.REPORT_STATUS }; }
  };
})(window);
