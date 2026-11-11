/* =====================================================================
 * pages/stat-report.js —— L3-4-7 报表管理（WF-L3-4-7 / IA-2.15 / FD-1.16）
 * 报表类型选择 → 生成与在线预览 → 导出 PDF/Word → 历史报表管理 → 定时统计设置
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, Stats = global.Stats, Limit = global.Limit;

  global.AMS.pages['stat-report'] = {
    data: function () { return { type: 'monthly', gOff: 1, rep: null, html: '', loading: false, sched: { enabled: true, when: 'month-end', types: ['monthly', 'unexpected'] } }; },
    computed: {
      types: function () { return Stats.REPORT_TYPES; },
      periods: function () {
        var t = this.types.filter(function (x) { return x.code === this.type; }, this)[0] || Stats.REPORT_TYPES[0];
        var n = t.g === 'year' ? 4 : (t.g === 'quarter' ? 8 : 13);
        var out = [];
        for (var i = 1; i <= n; i++) out.push({ v: i, label: Stats.period(t.g, i).label });
        return out;
      },
      history: function () { App.state.refresh; return Stats.history(); },
      periodLabel: function () {
        var t = this.types.filter(function (x) { return x.code === this.type; }, this)[0];
        return Stats.period(t.g, this.gOff).label;
      }
    },
    created: function () {
      var b = FHIR.view('Basic', 'Basic-report-schedule');
      if (b && b.ext.config) this.sched = Object.assign({}, this.sched, b.ext.config);
    },
    methods: {
      generate: function () {
        var self = this; this.loading = true;
        setTimeout(function () {
          var t = self.types.filter(function (x) { return x.code === self.type; })[0];
          var p = Stats.period(t.g, self.gOff);
          var rep = Stats.buildReport(self.type, p);
          self.rep = rep;
          self.html = Stats.reportToHtml(rep);
          self.loading = false;
          Stats.ensureHistory();
          App.bump();
          App.toast('报表已生成：' + rep.title);
        }, 520);
      },
      exportPdf: function () {
        if (!this.rep) { App.toast('请先生成报表预览', 'warn'); return; }
        var ok = Svc.printHtml(this.html);
        App.toast(ok ? '已调起打印/另存为 PDF（浏览器打印预览中选择「另存为 PDF」）' : '当前环境不支持打印', ok ? 'success' : 'warn');
      },
      exportWord: function () {
        if (!this.rep) { App.toast('请先生成报表预览', 'warn'); return; }
        Svc.exportDoc(this.rep.title + '.doc', this.html);
        App.toast('已导出 Word 文档：' + this.rep.title + '.doc');
        App.bump();
      },
      exportTable: function () {
        if (!this.rep) return;
        Svc.exportCsv(this.rep.title + '.csv', ['内容'], Stats.reportToRows(this.rep));
        App.toast('已导出报表数据 CSV');
        App.bump();
      },
      previewHistory: function (h) {
        var rep = Stats.loadReportDoc(h.id);
        if (!rep) { App.toast('该历史报表数据不完整', 'error'); return; }
        this.rep = rep; this.html = Stats.reportToHtml(rep);
        App.toast('已加载历史报表：' + h.name);
      },
      downloadHistory: function (h) {
        var rep = Stats.loadReportDoc(h.id);
        if (!rep) return;
        Svc.exportDoc(rep.title + '.doc', Stats.reportToHtml(rep));
        App.toast('已下载历史报表文件');
        App.bump();
      },
      async delHistory(h) {
        var okc = await App.ask('确定删除该历史报表记录？删除后不可恢复。', { title: '删除历史报表', danger: true, okText: '删除' });
        if (!okc) return;
        FHIR.remove('MeasureReport', h.id);
        App.toast('已删除历史报表记录');
        App.bump();
      },
      saveSched: function () {
        if (this.sched.enabled && !(this.sched.types || []).length) { App.toast('请至少选择一份定时生成的报表', 'error'); return; }
        Svc.saveBasic('Basic-report-schedule', '报表定时统计设置', { configKind: 'report-schedule', config: this.sched }, App.user(), '更新报表定时统计设置：' + (this.sched.enabled ? ('启用 · ' + this.sched.when + ' · ' + this.sched.types.join('/')) : '停用'));
        App.toast('定时统计设置已保存并生效');
        App.bump();
      },
      whenText: function (w) { return { 'month-end': '每月月末', 'quarter-end': '每季末', 'year-end': '每年年末' }[w] || w; }
    },
    template: `
    <div>
      <div class="page-head">
        <div><h1>📄 报表管理</h1><div class="desc">标准化统计报表生成、在线预览与导出（月报 / 季报 / 年报 / 非预期死亡专项报告）</div></div>
      </div>

      <div class="split">
        <div class="col" style="flex:0 0 340px">
          <!-- (C) 报表选择区 -->
          <div class="card">
            <div class="card-head"><h4>① 选择报表类型与周期</h4></div>
            <div class="card-body">
              <div class="side-nav">
                <div class="sn" v-for="t in types" :key="t.code" :class="{active: type===t.code}" @click="type=t.code">
                  📄 {{ t.name }}
                </div>
              </div>
              <div class="small muted mt8">{{ types.filter(x=>x.code===type)[0].desc }}</div>
              <div class="field mt12"><label class="req">统计周期</label>
                <select v-model.number="gOff"><option v-for="p in periods" :value="p.v">{{ p.label }}</option></select>
              </div>
              <div class="btn-row mt12"><button class="btn primary" style="width:100%" @click="generate" :disabled="loading">
                {{ loading ? '生成中…' : '生成 & 预览报表' }}</button></div>
            </div>
          </div>

          <!-- (E) 定时统计设置 -->
          <div class="card">
            <div class="card-head"><h4>③ 定时统计设置</h4>
              <label class="switch"><input type="checkbox" v-model="sched.enabled"><span class="sl"></span></label></div>
            <div class="card-body">
              <div class="field mb8"><label>执行时点</label>
                <select v-model="sched.when" :disabled="!sched.enabled">
                  <option value="month-end">每月月末</option><option value="quarter-end">每季度末</option><option value="year-end">每年年末</option>
                </select></div>
              <div class="field mb8"><label>自动生成报表类型</label>
                <div class="checks" style="flex-direction:column;gap:6px">
                  <label v-for="t in types" :key="t.code"><input type="checkbox" :value="t.code" v-model="sched.types" :disabled="!sched.enabled"> {{ t.name }}</label>
                </div></div>
              <div class="field mb8"><label>历史保留期数</label><input type="number" v-model.number="sched.keepHistory" min="1" max="120" style="width:110px" :disabled="!sched.enabled"></div>
              <label class="row" style="align-items:center"><input type="checkbox" v-model="sched.notify" :disabled="!sched.enabled"><span class="small">生成后向医务部管理员推送报表通知</span></label>
              <div class="btn-row mt12"><button class="btn" @click="saveSched">保存定时配置</button></div>
            </div>
          </div>
        </div>

        <!-- (D) 报表预览区 -->
        <div class="col">
          <div class="card">
            <div class="card-head">
              <h4>② 报表预览<span class="hint small" v-if="rep">{{ rep.title }} · 生成于 {{ rep.generatedAt }}</span></h4>
              <div class="btn-row" v-if="rep">
                <button class="btn sm" @click="exportPdf">导出 PDF</button>
                <button class="btn sm" @click="exportWord">导出 Word</button>
                <button class="btn sm" @click="exportTable">导出数据 CSV</button>
              </div>
            </div>
            <div class="card-body" style="background:#F5F6F8">
              <div class="overlay-loading" v-if="loading" style="position:static;padding:30px"><span class="spinner"></span><div class="muted small">报表生成中（异步导出，请稍候）…</div></div>
              <empty-state v-else-if="!rep" text="请选择报表类型与周期，点击「生成 & 预览报表」" icon="📄"
                           sub="报表数据由内存 FHIR 库实时聚合（Encounter / Task / QuestionnaireResponse / Composition / Observation）。"></empty-state>
              <div v-else style="background:#fff;padding:24px 28px;border-radius:6px;max-height:70vh;overflow:auto">
                <div style="font-size:19px;text-align:center;font-weight:600">{{ rep.title }}</div>
                <div class="text-c muted small mb16">生成时间：{{ rep.generatedAt }}　统计口径：按死亡时间归属　数据源：FHIR 实时聚合</div>
                <div v-for="(s,i) in rep.sections" :key="i" class="mb16">
                  <div style="font-weight:600;margin-bottom:6px">{{ s.title }}</div>
                  <table class="tbl dense" v-if="s.kind==='kv'"><tbody>
                    <tr v-for="(r,j) in s.rows" :key="j"><th style="width:30%;background:#FAFAFA">{{ r[0] }}</th><td>{{ r[1] }}</td></tr>
                  </tbody></table>
                  <table class="tbl dense" v-else-if="s.kind==='table'">
                    <thead><tr><th v-for="h in s.headers" :key="h">{{ h }}</th></tr></thead>
                    <tbody><tr v-for="(r,j) in s.rows" :key="j"><td v-for="(c,k) in r" :key="k">{{ c }}</td></tr></tbody>
                  </table>
                  <ol v-else><li v-for="(x,j) in s.items" :key="j" style="line-height:1.9">{{ x }}</li></ol>
                </div>
              </div>
            </div>
          </div>

          <!-- (F) 历史报表列表 -->
          <div class="card">
            <div class="card-head"><h4>历史报表列表<span class="hint small">（{{ history.length }} 份，含系统定时生成）</span></h4></div>
            <div class="card-body tight"><div class="table-wrap">
              <table class="tbl">
                <thead><tr><th>报表名称</th><th>报表类型</th><th>统计周期</th><th>生成时间</th><th>生成方式</th><th style="width:150px">操作</th></tr></thead>
                <tbody>
                  <tr v-for="h in history" :key="h.id">
                    <td><b>{{ h.name }}</b></td>
                    <td>{{ h.typeText }}</td><td>{{ h.period }}</td><td class="small">{{ h.generatedAt }}</td>
                    <td><span class="tag" :class="h.generator==='系统定时统计'?'blue':'gray'">{{ h.generator }}</span></td>
                    <td class="actions">
                      <button class="btn-link" @click="previewHistory(h)">预览</button>
                      <button class="btn-link" @click="downloadHistory(h)">下载</button>
                      <button class="btn-link danger" @click="delHistory(h)">删除</button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <empty-state v-if="!history.length" text="暂无已生成报表，系统将按定时设置自动生成" icon="📄"></empty-state>
            </div></div>
          </div>
        </div>
      </div>
    </div>`
  };
})(window);
