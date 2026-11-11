/* =====================================================================
 * pages/sys-timeout.js —— L3-5-2 时限规则配置（IA-2.17 / FD-1.18 / IX-2.19）
 * 讨论时限 / 上报时限 / 三色预警阈值 / 改进任务提醒；保存前做规则合理性校验；
 * 保存后全局倒计时、三色预警、达标率与超时清单即时联动生效。
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, Limit = global.Limit, D = global.Domain;

  global.AMS.pages['sys-timeout'] = {
    data: function () {
      return { cfg: JSON.parse(JSON.stringify(Limit.config())), savedAt: '' };
    },
    computed: {
      conflicts: function () {
        var c = this.cfg, out = [];
        Object.keys(c.reportDays).forEach(function (k) {
          var dk = k === 'expected' ? 'expected' : k;
          if (c.reportDays[k] > c.discussionDays[dk]) {
            out.push(D.deathTypeName(dk) + '：上报时限（' + c.reportDays[k] + ' 天）大于讨论时限（' + c.discussionDays[dk] + ' 天），建议调整');
          }
        });
        if (c.warnOrangePct >= c.warnYellowPct) out.push('橙色预警阈值必须小于黄色预警阈值');
        if (c.improveRemindDays <= 0) out.push('改进任务临近截止提醒天数必须为正整数');
        return out;
      },
      preview: function () {
        var self = this;
        return ['special', 'unexpected', 'expected', 'pending'].map(function (t) {
          var total = (self.cfg.discussionDays[t] || 1) * 86400000;
          var mk = function (ratio) {
            var remain = total * (1 - ratio);
            return Limit.warningLevelOf(remain / total, remain <= 0);
          };
          return {
            type: D.deathTypeName(t), days: self.cfg.discussionDays[t],
            reportDays: self.cfg.reportDays[t === 'pending' ? 'expected' : t] || self.cfg.reportDays.expected,
            lv50: mk(0.45), lv85: mk(0.85), lv105: mk(1.05)
          };
        });
      }
    },
    methods: {
      intOk: function (v) { return Number.isInteger(+v) && +v > 0; },
      async save() {
        var c = this.cfg, bad = [];
        [['discussionDays', c.discussionDays], ['reportDays', c.reportDays]].forEach(function (pair) {
          Object.keys(pair[1]).forEach(function (k) { if (!this.intOk(pair[1][k])) bad.push(k); }, this);
        }, this);
        if (!this.intOk(c.improveRemindDays)) bad.push('改进提醒天数');
        if (bad.length) { App.toast('时限必须填写正整数（单位：天）', 'error'); return; }
        if (this.conflicts.length) {
          var go = await App.ask('存在规则冲突：' + this.conflicts[0] + '。仍要保存吗？', { title: '规则冲突提示', danger: true, okText: '仍然保存' });
          if (!go) return;
        }
        var okc = await App.ask('保存后全局任务的倒计时、预警规则立即生效，确认保存？', { title: '保存配置' });
        if (!okc) return;
        Limit.setConfig(JSON.parse(JSON.stringify(c)));
        this.savedAt = Limit.dt(Date.now());
        Svc.prov('config', Svc.cases(function (c2) { return true; })[0], App.user(), '更新时限规则配置：讨论 ' + JSON.stringify(c.discussionDays) + ' 天，上报 ' + JSON.stringify(c.reportDays) + ' 天，预警阈值 黄<' + c.warnYellowPct + '% 橙<' + c.warnOrangePct + '%');
        App.toast('时限规则已保存，全局倒计时与三色预警即时生效');
        App.bump();
      },
      async resetDefault() {
        var okc = await App.ask('确认恢复全部时限规则为系统出厂默认值？', { title: '恢复系统默认值' });
        if (!okc) return;
        this.cfg = JSON.parse(JSON.stringify(Limit.DEFAULTS));
        Limit.setConfig(JSON.parse(JSON.stringify(this.cfg)));
        App.toast('已恢复系统默认时限规则');
        App.bump();
      },
      lvName: function (v) { return D.warningName(v); },
      lvCls: function (v) { return D.warningCls(v); }
    },
    template: `
    <div>
      <div class="page-head"><div><h1>⏱ 时限规则配置</h1>
        <div class="desc">按死亡类型配置讨论时限、上报时限与三色预警阈值；本页为全局时限的唯一定义来源，任何页面不硬编码天数</div></div></div>

      <div class="alert info"><span>ℹ️</span><div>规则依据 US-1.1 AC3/AC4 与 IX-1.6：默认预期死亡讨论 7 天、非预期 3 天、特殊 24 小时；
        上报特殊死亡 24 小时、非预期 48 小时、普通死亡 7 天；剩余时间 &lt;50% 黄色、&lt;20% 橙色、已超时红色。</div></div>

      <div class="split">
        <div class="col" style="flex:1.4">
          <div class="card"><div class="card-head"><h4>讨论时限（单位：天）</h4></div>
            <div class="card-body"><div class="config-grid">
              <div class="field"><label>预期死亡讨论时限</label><input type="number" min="1" v-model.number="cfg.discussionDays.expected"></div>
              <div class="field"><label>非预期死亡讨论时限</label><input type="number" min="1" v-model.number="cfg.discussionDays.unexpected"></div>
              <div class="field"><label>特殊死亡讨论时限<span class="hint small">（1 天 = 24 小时）</span></label><input type="number" min="1" v-model.number="cfg.discussionDays.special"></div>
              <div class="field"><label>待人工判定讨论时限</label><input type="number" min="1" v-model.number="cfg.discussionDays.pending"></div>
            </div></div></div>

          <div class="card"><div class="card-head"><h4>上报时限（单位：天）</h4></div>
            <div class="card-body"><div class="config-grid">
              <div class="field"><label>特殊死亡上报时限</label><input type="number" min="1" v-model.number="cfg.reportDays.special"></div>
              <div class="field"><label>非预期死亡上报时限</label><input type="number" min="1" v-model.number="cfg.reportDays.unexpected"></div>
              <div class="field"><label>普通（预期）死亡上报时限</label><input type="number" min="1" v-model.number="cfg.reportDays.expected"></div>
            </div></div></div>

          <div class="card"><div class="card-head"><h4>三色预警阈值（剩余时间占比 %）</h4></div>
            <div class="card-body"><div class="config-grid">
              <div class="field"><label>黄色预警阈值（剩余 &lt; 该值触发）</label><input type="number" min="1" max="99" v-model.number="cfg.warnYellowPct"></div>
              <div class="field"><label>橙色预警阈值（剩余 &lt; 该值触发）</label><input type="number" min="1" max="98" v-model.number="cfg.warnOrangePct"></div>
              <div class="field"><label>红色预警</label><input type="text" value="已超时（剩余时间 ≤ 0）" disabled></div>
            </div></div></div>

          <div class="card"><div class="card-head"><h4>改进任务提醒规则</h4></div>
            <div class="card-body"><div class="config-grid">
              <div class="field"><label>临近截止提前提醒天数</label><input type="number" min="1" v-model.number="cfg.improveRemindDays"></div>
              <div class="field"><label>超时升级推送</label>
                <label class="switch mt4"><input type="checkbox" v-model="cfg.improveEscalate"><span class="sl"></span></label>
                <span class="hint small">开启后超时自动升级推送科主任</span></div>
              <div class="field"><label>审核超时时限（小时）</label>
                <div class="row">
                  <input type="number" min="1" v-model.number="cfg.reviewHours[1]" style="width:70px" title="一级">
                  <input type="number" min="1" v-model.number="cfg.reviewHours[2]" style="width:70px" title="二级">
                  <input type="number" min="1" v-model.number="cfg.reviewHours[3]" style="width:70px" title="三级">
                </div><span class="hint small">分别对应一 / 二 / 三级审核节点</span></div>
            </div></div></div>
        </div>

        <div class="col">
          <div class="card"><div class="card-head"><h4>规则合理性校验</h4></div>
            <div class="card-body">
              <div class="alert success mb0" v-if="!conflicts.length"><span>✅</span><div>当前配置未发现冲突，可保存生效。</div></div>
              <div class="alert danger" v-for="(x,i) in conflicts" :key="i"><span>⚠️</span><div>{{ x }}</div></div>
            </div></div>

          <div class="card"><div class="card-head"><h4>预警效果实时预览</h4><span class="hint small">按当前阈值模拟剩余时间</span></div>
            <div class="card-body tight"><table class="tbl dense">
              <thead><tr><th>死亡类型</th><th class="num">讨论</th><th class="num">上报</th><th>剩 55%</th><th>剩 15%</th><th>超时</th></tr></thead>
              <tbody><tr v-for="p in preview" :key="p.type">
                <td>{{ p.type }}</td><td class="num">{{ p.days }}d</td><td class="num">{{ p.reportDays }}d</td>
                <td><span class="tag" :class="lvCls(p.lv50)">{{ lvName(p.lv50) }}</span></td>
                <td><span class="tag" :class="lvCls(p.lv85)">{{ lvName(p.lv85) }}</span></td>
                <td><span class="tag" :class="lvCls(p.lv105)">{{ lvName(p.lv105) }}</span></td>
              </tr></tbody>
            </table></div></div>

          <div class="card"><div class="card-body">
            <div class="small muted mb8">联动范围：讨论管理 / 上报管理列表倒计时与行高亮、首页待办与预警、时效分析达标率与超时清单、统计概览预警卡片。</div>
            <div class="btn-row">
              <button class="btn primary" @click="save">保存配置</button>
              <button class="btn" @click="resetDefault">恢复系统默认值</button>
            </div>
            <div class="hint small mt8" v-if="savedAt">最后保存：{{ savedAt }}（由 {{ user.name }} 操作，已记入配置变更日志）</div>
          </div></div>
        </div>
      </div>
    </div>`,
    created: function () { this.user = App.user(); }
  };
})(window);
