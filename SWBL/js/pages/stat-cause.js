/* =====================================================================
 * pages/stat-cause.js —— L3-4-3 死因与诊断分析（WF-L3-4-3 / IA-2.11 / FD-1.12）
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Stats = global.Stats, Limit = global.Limit;

  global.AMS.pages['stat-cause'] = {
    data: function () { return { g: 'quarter', offset: 0, drill: null }; },
    computed: {
      p: function () { return Stats.period(this.g, this.offset); },
      ca: function () { App.state.refresh; return Stats.causeAnalysis(null, this.p); },
      total: function () { return this.ca.total; },
      cards: function () {
        var top = this.ca.top[0];
        var av = this.ca.avoidable;
        var c = this.ca.concordance, sum = c.match + c.partly + c.unmatch || 1;
        return [
          { label: '死亡原因 TOP1', value: top ? top.name : '—', sub: top ? (top.value + ' 例，占 ' + top.pct + '%') : '' },
          { label: '诊断符合率', value: (c.match / sum * 100).toFixed(1) + '%', sub: '符合 ' + c.match + ' ／ 部分符合 ' + c.partly + ' ／ 不符合 ' + c.unmatch },
          { label: '可避免死亡占比', value: (av.avoidable / (this.total || 1) * 100).toFixed(1) + '%', sub: '可避免 ' + av.avoidable + ' 例，部分可避免 ' + av.partly + ' 例' },
          { label: '统计期内死亡病例', value: this.total + ' 例', sub: this.p.label }
        ];
      },
      avoidPie: function () {
        var a = this.ca.avoidable;
        return [
          { label: '可避免', value: a.avoidable, color: '#FF4D4F' },
          { label: '部分可避免', value: a.partly, color: '#FAAD14' },
          { label: '不可避免', value: a.unavoidable, color: '#52C41A' }
        ];
      },
      unexpectedPie: function () { return this.ca.unexpected.slice(0, 6).map(function (x, i) { return { label: x.label, value: x.value, color: ['#FF4D4F', '#FF7875', '#FA8C16', '#FAAD14', '#1890FF', '#13C2C2'][i % 6] }; }); },
      surgicalPie: function () { return this.ca.surgical.slice(0, 6).map(function (x, i) { return { label: x.label, value: x.value, color: ['#722ED1', '#B37FEB', '#FAAD14', '#FA8C16', '#1890FF', '#52C2C2'][i % 6] }; }); },
      concordRows: function () {
        var c = this.ca.concordance, sum = c.match + c.partly + c.unmatch || 1;
        return [
          { name: '符合', n: c.match, pct: (c.match / sum * 100).toFixed(1), cls: 'green' },
          { name: '部分符合', n: c.partly, pct: (c.partly / sum * 100).toFixed(1), cls: 'yellow' },
          { name: '不符合', n: c.unmatch, pct: (c.unmatch / sum * 100).toFixed(1), cls: 'red' }
        ];
      }
    },
    methods: {
      openDrill: function (item) { this.drill = item; },
      refresh: function () { App.bump(); App.toast('死因分析已刷新'); },
      exportXls: function () {
        var rows = this.ca.concordanceList.map(function (c) {
          return [c.name, c.mrn, c.deptName, c.admitDx, c.deathDx, D.concordanceName(c.concordance), Limit.donly(c.deathMs)];
        });
        Svc.exportCsv('诊断不符合病例清单_' + this.p.label + '.csv', ['患者姓名', '住院号', '科室', '入院诊断', '死亡诊断', '符合度', '死亡时间'], rows);
        App.toast('已导出 ' + rows.length + ' 条诊断符合性异常病例');
        App.bump();
      },
      viewCase: function (c) { this.drill = null; App.goCase('discuss-detail', c.encId); }
    },
    template: `
    <div>
      <div class="page-head">
        <div><h1>🫀 死因与诊断分析</h1><div class="desc">死亡原因 TOP10、可避免死亡占比、非预期与术后死因分布、诊断符合性与严重程度关联分析</div></div>
      </div>
      <period-bar v-model:g="g" v-model:offset="offset" :label="p.label" @refresh="refresh"></period-bar>

      <div class="stat-grid g4 mb12">
        <div class="stat-card" v-for="(c,i) in cards" :key="i">
          <div class="label">{{ c.label }}</div>
          <div class="value" :style="{fontSize: String(c.value).length>6?'16px':'25px'}">{{ c.value }}</div>
          <div class="muted small mt4">{{ c.sub }}</div>
        </div>
      </div>

      <div class="chart-grid mb12">
        <div class="chart-box">
          <h4>死亡原因 TOP10 排行<span class="muted small">（点击查看对应病例）</span></h4>
          <rank-list :items="ca.top">
            <template #after="{ item }"><button class="btn-link small" @click="openDrill(item)">查看明细</button></template>
          </rank-list>
        </div>
        <div class="chart-box"><h4>可避免死亡占比</h4><pie-chart :data="avoidPie"></pie-chart></div>
        <div class="chart-box"><h4>非预期死亡原因分布</h4><pie-chart :data="unexpectedPie" v-if="unexpectedPie.length"></pie-chart><empty-state v-else text="暂无数据"></empty-state></div>
        <div class="chart-box"><h4>术后死亡原因分布（术后 30 天内）</h4><pie-chart :data="surgicalPie" v-if="surgicalPie.length"></pie-chart><empty-state v-else text="暂无数据"></empty-state></div>
      </div>

      <div class="chart-grid mb12">
        <div class="chart-box"><h4>死亡诊断（ICD-10 大类）分布</h4>
          <hbar-chart :data="ca.byCat" unit=" 例" :width="140"></hbar-chart></div>
        <div class="chart-box">
          <h4>入院-死亡诊断符合性分析</h4>
          <table class="tbl dense">
            <thead><tr><th>符合程度</th><th class="num">例数</th><th class="num">占比</th></tr></thead>
            <tbody><tr v-for="r in concordRows" :key="r.name"><td><span class="tag" :class="r.cls">{{ r.name }}</span></td><td class="num">{{ r.n }}</td><td class="num">{{ r.pct }}%</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h4>诊断不符合 / 部分符合病例清单<span class="hint small">（{{ ca.concordanceList.length }} 例）</span></h4>
          <button class="btn sm" @click="exportXls">导出 Excel</button></div>
        <div class="card-body tight"><div class="table-wrap" style="max-height:380px;overflow:auto">
          <table class="tbl dense">
            <thead><tr><th>住院号</th><th>姓名</th><th>科室</th><th>入院诊断</th><th>死亡诊断</th><th>符合度</th><th>死亡时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="c in ca.concordanceList.slice(0,60)" :key="c.encId">
                <td class="mono">{{ c.mrn }}</td><td><b>{{ c.name }}</b></td><td>{{ c.deptName }}</td>
                <td style="max-width:190px">{{ c.admitDx }}</td>
                <td style="max-width:190px">{{ c.deathDx }}</td>
                <td><span class="tag" :class="c.concordance==='unmatch'?'red':'yellow'">{{ D2.concordName(c.concordance) }}</span></td>
                <td>{{ md(c.deathMs) }}</td>
                <td><button class="btn-link" @click="viewCase(c)">查看</button></td>
              </tr>
            </tbody>
          </table>
          <empty-state v-if="!ca.concordanceList.length" text="暂无数据" icon="📭"></empty-state>
        </div></div>
      </div>

      <div class="card">
        <div class="card-head"><h4>死亡原因 × 疾病严重程度交叉分析<span class="hint small">（严重程度取自 Condition.severity）</span></h4></div>
        <div class="card-body tight"><div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>死亡原因</th><th class="num">轻度</th><th class="num">中度</th><th class="num">重度</th><th class="num">极重度</th><th class="num">合计</th></tr></thead>
            <tbody>
              <tr v-for="m in ca.matrix" :key="m.name">
                <td>{{ m.name }}</td>
                <td class="num">{{ m.mild || '—' }}</td><td class="num">{{ m.moderate || '—' }}</td>
                <td class="num">{{ m.severe || '—' }}</td>
                <td class="num"><span :class="m.critical?'red':''">{{ m.critical || '—' }}</span></td>
                <td class="num"><b>{{ m.mild + m.moderate + m.severe + m.critical }}</b></td>
              </tr>
            </tbody>
          </table>
        </div></div>
      </div>

      <ui-modal v-if="drill" :title="'死因明细 · ' + drill.name + '（' + drill.value + ' 例）'" width="wide" @close="drill=null">
        <div class="table-wrap" style="max-height:52vh;overflow:auto">
          <table class="tbl dense">
            <thead><tr><th>患者</th><th>住院号</th><th>科室</th><th>死亡时间</th><th>死亡类型</th><th>讨论状态</th><th>操作</th></tr></thead>
            <tbody><tr v-for="c in drill.cases" :key="c.encId">
              <td><b>{{ c.name }}</b></td><td class="mono">{{ c.mrn }}</td><td>{{ c.deptName }}</td><td>{{ md(c.deathMs) }}</td>
              <td><dict-tag :list="DICT.death" :value="c.deathType"></dict-tag></td>
              <td><dict-tag :list="DICT.discuss" :value="c.discussStatus"></dict-tag></td>
              <td><button class="btn-link" @click="viewCase(c)">查看讨论详情</button></td>
            </tr></tbody>
          </table>
        </div>
        <template #foot><button class="btn" @click="drill=null">关闭</button></template>
      </ui-modal>
    </div>`,
    created: function () {
      this.DICT = { death: D.DEATH_TYPES, discuss: D.DISCUSS_STATUS };
      var self = this;
      this.D2 = { concordName: function (v) { return D.concordanceName(v); } };
    }
  };
})(window);
