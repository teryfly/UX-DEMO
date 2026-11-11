/* =====================================================================
 * pages/stat-overview.js —— L3-4-1 统计概览（WF-L3-4-1 / IA-2.9 / FD-1.10 / IX-2.11）
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Stats = global.Stats, Limit = global.Limit;

  global.AMS.pages['stat-overview'] = {
    data: function () { return { g: 'month', offset: 0, spin: false, snapAt: Date.now() }; },
    computed: {
      r: function () {
        App.state.refresh; App.state.clock;
        return Stats.overview(App.user(), Stats.period(this.g, this.offset));
      },
      cards1: function () {
        var m = this.r.cur, d = this.r.d;
        return [
          { label: '死亡病例总数', value: m.deaths, unit: '例', delta: d.deaths, yoy: d.deathsYoy },
          { label: '死亡率（死亡/出院）', value: m.deathRate, unit: '%', delta: d.deathRate, yoy: d.deathRateYoy },
          { label: '同期出院人次', value: m.discharges, unit: '人次', delta: null, yoy: null }
        ];
      },
      cards2: function () {
        var m = this.r.cur, d = this.r.d;
        return [
          { label: '讨论完成率', value: m.discussRate, unit: '%', delta: d.discussRate, good: true, sub: m.discussDone + '/' + m.discussTotal },
          { label: '上报完成率', value: m.reportRate, unit: '%', delta: d.reportRate, good: true, sub: m.reportDone + '/' + m.reportTotal },
          { label: '改进措施落实率', value: m.improveRate, unit: '%', delta: d.improveRate, good: true, sub: m.improveDone + '/' + m.improveTotal },
          { label: '时限综合达标率', value: m.onTimeRate, unit: '%', delta: d.onTimeRate, good: true },
          { label: '超时任务数', value: m.overdueTasks, unit: '项', delta: null, danger: true }
        ];
      }
    },
    methods: {
      go: function (r, q) { App.navigate(r, q || {}); },
      refresh: function () {
        var self = this; this.spin = true;
        setTimeout(function () { self.spin = false; self.snapAt = Date.now(); App.bump(); App.toast('已重新聚合全量 FHIR 数据完成统计（' + Limit.dt(self.snapAt) + '）'); }, 420);
      },
      snapLabel: function () { return Limit.dt(this.snapAt); },
      fmtDelta: function (v, unit) { return v == null ? '' : (v > 0 ? '↑ ' : (v < 0 ? '↓ ' : '— ')) + Math.abs(v) + (unit || '%'); }
    },
    template: `
    <div>
      <div class="page-head">
        <div><h1>📊 统计概览</h1><div class="desc">全院死亡病例核心指标与异常预警总览（数据由 FHIR 资源实时聚合）</div></div>
      </div>
      <period-bar v-model:g="g" v-model:offset="offset" :label="r.period.label" :updated-at="r.updatedAt" @refresh="refresh"></period-bar>
      <div class="overlay-loading" v-if="spin"><span class="spinner"></span><div class="muted small">正在聚合统计…</div></div>

      <!-- (E) 核心指标第一行 -->
      <div class="stat-grid g3 mb12">
        <div class="stat-card" v-for="(c,i) in cards1" :key="i">
          <div class="label">{{ c.label }}</div>
          <div class="value">{{ c.value }}<small>{{ c.unit }}</small></div>
          <div class="delta" v-if="c.delta!==null">
            <span :class="'delta ' + (c.delta>0?'up':(c.delta<0?'down':'flat'))">{{ fmtDelta(c.delta) }} 环比</span>
            <span class="muted" v-if="c.yoy!==null && c.yoy!==undefined"> ｜ {{ fmtDelta(c.yoy) }} 同比</span>
          </div>
        </div>
      </div>
      <!-- (F) 核心指标第二行 -->
      <div class="stat-grid g5 mb12">
        <div class="stat-card" :class="{warn: c.danger && c.value>0}" v-for="(c,i) in cards2" :key="'b'+i">
          <div class="label">{{ c.label }}</div>
          <div class="value">{{ c.value }}<small>{{ c.unit }}</small></div>
          <div class="delta" v-if="c.delta!==null">
            <span :class="c.good ? (c.delta>0?'delta good-up':(c.delta<0?'delta good-down':'delta flat')) : (c.delta>0?'delta up':'delta flat')">
              {{ fmtDelta(c.delta) }} 环比
            </span>
          </div>
          <div class="muted small mt4" v-if="c.sub">{{ c.sub }}</div>
        </div>
      </div>

      <!-- (G) 异常预警区 -->
      <div class="card">
        <div class="card-head"><h3>🚨 关键异常预警<span class="hint small">点击卡片下钻查看对应清单</span></h3>
          <a class="btn-link" @click="go('stat-timeliness')">时效分析 ›</a></div>
        <div class="card-body">
          <div class="stat-grid g4">
            <div class="stat-card clickable" v-for="(a,i) in r.alerts" :key="i" @click="go(a.route)" :style="{borderLeftColor: a.level==='red'?'var(--danger)':(a.level==='orange'?'var(--orange)':(a.level==='yellow'?'var(--warning)':'var(--border)')), borderLeftWidth:'3px'}">
              <div class="label">{{ a.kind }}</div>
              <div class="value">{{ a.n }}<small>例</small></div>
              <div class="muted small mt4">{{ a.n ? '点击查看明细清单' : '本期无异常' }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="chart-grid">
        <div class="chart-box">
          <h3>死亡类型分布 <span class="muted small">{{ r.period.label }}</span></h3>
          <pie-chart :data="r.deathTypeDist"></pie-chart>
        </div>
        <div class="chart-box">
          <h3>科室死亡病例分布概览<a class="btn-link small" @click="go('stat-dept')">科室分析 ›</a></h3>
          <bar-chart v-if="r.deptDist.length" :data="r.deptDist"></bar-chart>
          <empty-state v-else text="暂无数据" icon="📊"></empty-state>
        </div>
        <div class="chart-box">
          <h3>近 12 个月死亡率趋势<a class="btn-link small" @click="go('stat-trend')">趋势分析 ›</a></h3>
          <line-chart v-if="r.trend12.length" :series="[{key:'rate',name:'死亡率',color:'#1890FF',points:r.trend12}]" unit="%" :height="180"></line-chart>
          <empty-state v-else text="暂无数据" icon="📈"></empty-state>
        </div>
        <div class="chart-box">
          <h3>死亡原因 TOP5<a class="btn-link small" @click="go('stat-cause')">死因分析 ›</a></h3>
          <rank-list :items="r.causeTop5"></rank-list>
        </div>
      </div>

      <div class="card"><div class="card-body small muted" style="line-height:1.9">
        统计口径：按<b>死亡时间</b>归属统计周期；死亡率分母为同期各科室出院人次（Observation）；
        讨论完成 = 讨论记录已签名归档（Composition.status=final）；上报完成 = 医务部三级终审通过（Task.completedDate）；
        达标判定依据「系统管理 › 时限规则配置」的时限阈值，修改配置后本页指标即时联动。
        <div class="mt4">数据最后更新时间：<b class="mono">{{ snapLabel() }}</b>（统计结果为该时刻的内存 FHIR 快照）</div>
      </div></div>
    </div>`
  };
})(window);
