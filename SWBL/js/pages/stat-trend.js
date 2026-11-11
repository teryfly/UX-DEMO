/* =====================================================================
 * pages/stat-trend.js —— L3-4-4 死亡病例趋势分析（WF-L3-4-4 / IA-2.12 / FD-1.13）
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Stats = global.Stats, Limit = global.Limit;

  global.AMS.pages['stat-trend'] = {
    data: function () {
      return { g: 'month', offset: 0, count: 12, hidden: [], pickedDepts: null };
    },
    computed: {
      t: function () { App.state.refresh; return Stats.trend(App.user(), this.g, this.g === 'month' ? 13 : 8); },
      series: function () {
        var s = this.t.series;
        return [
          { key: 'all', name: '总死亡率', color: '#1890FF', points: s.map(function (x) { return { label: x.label, value: x.deathRate }; }) },
          { key: 'unexpect', name: '非预期死亡率', color: '#FF4D4F', points: s.map(function (x) { return { label: x.label, value: x.unexpectedRate }; }) },
          { key: 'avoid', name: '可避免死亡率', color: '#FAAD14', points: s.map(function (x) { return { label: x.label, value: x.avoidableRate }; }) }
        ];
      },
      deptSeries: function () {
        var self = this, t = this.t, s = t.series;
        var depts = this.pickedDepts || t.deptCandidates || [];
        var colors = ['#722ED1', '#13C2C2', '#FA8C16', '#52C41A', '#EB2F96'];
        return depts.slice(0, 5).map(function (name, i) {
          return {
            key: name, name: name, color: colors[i % colors.length],
            points: s.map(function (x) {
              var list = Stats.inRange(Svc.cases(function (c) { return c.deptName === name; }), { start: x.start, end: x.end });
              return { label: x.label, value: +(list.length / Math.max(1, x.discharges / 6) * 100 / 2).toFixed(2) };
            })
          };
        });
      },
      cards: function () {
        var t = this.t, last = t.series[t.series.length - 1] || {};
        return [
          { label: '本期死亡率', value: (last.deathRate || 0) + '%', delta: t.qoq, hint: '环比' },
          { label: '同比增长', value: (t.yoy > 0 ? '+' : '') + t.yoy + 'pp', delta: t.yoy, hint: '与去年同期相比' },
          { label: '本期死亡数', value: (last.deaths || 0) + ' 例', delta: null },
          { label: '同期出院人次', value: last.discharges || 0, delta: null }
        ];
      }
    },
    methods: {
      toggleLegend: function (k) {
        var i = this.hidden.indexOf(k);
        if (i >= 0) this.hidden.splice(i, 1); else this.hidden.push(k);
      },
      toggleDept: function (name) {
        var cur = this.pickedDepts || this.t.deptCandidates.slice(0, 3);
        var i = cur.indexOf(name);
        if (i >= 0) cur.splice(i, 1); else cur.push(name);
        this.pickedDepts = cur.slice();
      },
      exportXls: function () {
        var rows = this.t.series.map(function (x, i) {
          var prev = i ? this.t.series[i - 1] : null;
          var yoy = i >= 12 ? this.t.series[i - 12] : null;
          return [x.label, x.deaths, x.discharges, x.deathRate + '%',
            prev ? ((x.deathRate - prev.deathRate) > 0 ? '+' : '') + (x.deathRate - prev.deathRate).toFixed(2) + 'pp' : '—',
            yoy ? ((x.deathRate - yoy.deathRate) > 0 ? '+' : '') + (x.deathRate - yoy.deathRate).toFixed(2) + 'pp' : '—',
            x.unexpectedRate + '%', x.avoidableRate + '%', x.discussRate + '%', x.reportRate + '%'];
        }, this);
        Svc.exportCsv('死亡病例趋势分析明细.csv', ['周期', '死亡数', '出院人次', '死亡率', '环比', '同比', '非预期死亡率', '可避免死亡率', '讨论完成率', '上报完成率'], rows);
        App.toast('已导出月度明细数据');
        App.bump();
      },
      refresh: function () { App.bump(); App.toast('趋势数据已刷新'); }
    },
    template: `
    <div>
      <div class="page-head">
        <div><h1>📉 死亡病例趋势分析</h1><div class="desc">死亡率、非预期死亡率、可避免死亡率时间趋势与同比环比对比，用于评估医疗质量改进效果</div></div>
      </div>
      <period-bar v-model:g="g" v-model:offset="offset" :label="'最近 ' + t.series.length + ' 个' + (g==='year'?'年度':(g==='quarter'?'季度':'月份'))" @refresh="refresh"></period-bar>

      <div class="stat-grid g4 mb12">
        <div class="stat-card" v-for="(c,i) in cards" :key="i">
          <div class="label">{{ c.label }}</div>
          <div class="value">{{ c.value }}</div>
          <div class="delta" v-if="c.delta!==null">
            <span :class="c.delta>0?'delta up':(c.delta<0?'delta down':'delta flat')">{{ c.delta>0?'↑':(c.delta<0?'↓':'—') }} {{ Math.abs(c.delta) }}pp {{ c.hint }}</span>
          </div>
        </div>
      </div>

      <div class="card"><div class="card-body">
        <div class="row between mb8"><b class="small">死亡率主趋势（总死亡率 / 非预期死亡率 / 可避免死亡率）</b>
          <span class="muted small">鼠标悬停查看各时间点具体数值；点击图例可显隐曲线</span></div>
        <line-chart :series="series" :height="240" unit="%" selectable="true" :hidden="hidden" @toggle="toggleLegend"></line-chart>
        <div class="mt12" v-if="t.nodes.length">
          <b class="small muted">关键节点标注</b>
          <div class="row mt4" style="gap:8px;flex-wrap:wrap">
            <span class="tag blue" v-for="(n,i) in t.nodes" :key="i">{{ n.label }}：{{ n.text }}</span>
          </div>
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <div class="row between mb8"><b class="small">分科室死亡率对比</b>
          <div class="chip-row">
            <span class="chip" v-for="d in t.deptCandidates" :key="d" :class="{active: (pickedDepts||t.deptCandidates.slice(0,3)).indexOf(d)>=0}" @click="toggleDept(d)">{{ d }}</span>
          </div>
        </div>
        <line-chart :series="deptSeries" :height="200" unit="%"></line-chart>
      </div></div>

      <div class="card">
        <div class="card-head"><h4>周期明细数据<span class="hint small">（颜色标记环比/同比升降）</span></h4>
          <button class="btn sm" @click="exportXls">导出 Excel 明细</button></div>
        <div class="card-body tight"><div class="table-wrap" style="max-height:420px;overflow:auto">
          <table class="tbl dense">
            <thead><tr><th>周期</th><th class="num">死亡数</th><th class="num">出院人次</th><th class="num">死亡率</th>
              <th class="num">环比</th><th class="num">同比</th><th class="num">非预期死亡率</th><th class="num">可避免死亡率</th>
              <th class="num">讨论完成率</th><th class="num">上报完成率</th></tr></thead>
            <tbody>
              <tr v-for="(x,i) in t.series" :key="x.key">
                <td>{{ x.label }}</td>
                <td class="num">{{ x.deaths }}</td>
                <td class="num">{{ x.discharges }}</td>
                <td class="num"><b>{{ x.deathRate }}%</b></td>
                <td class="num" v-if="i" v-html="diff(i,'deathRate')"></td><td class="num muted" v-else>—</td>
                <td class="num" v-if="i>=12" v-html="diff(i,'deathRate',12)"></td><td class="num muted" v-else>—</td>
                <td class="num">{{ x.unexpectedRate }}%</td>
                <td class="num">{{ x.avoidableRate }}%</td>
                <td class="num" :class="x.discussRate>=90?'green':''">{{ x.discussRate }}%</td>
                <td class="num" :class="x.reportRate>=90?'green':''">{{ x.reportRate }}%</td>
              </tr>
            </tbody>
          </table>
        </div></div>
      </div>

      <div class="card"><div class="card-head"><h4>🧠 系统自动生成趋势分析说明</h4></div>
        <div class="card-body"><p style="line-height:2;margin:0">{{ t.summary }}</p></div></div>
    </div>`,
    methodsX: {}
  };
  var pg = global.AMS.pages['stat-trend'];
  Object.assign(pg.methods, {
    diff: function (i, key, back) {
      var s = this.t.series, b = s[i - (back || 1)];
      if (!b) return '—';
      var v = +(s[i][key] - b[key]).toFixed(2);
      return (v > 0 ? '<span class="red">↑' : (v < 0 ? '<span class="green">↓' : '<span>—')) + Math.abs(v) + '</span>';
    }
  });
  delete pg.methodsX;
})(window);
