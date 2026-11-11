/* =====================================================================
 * pages/discuss-list.js —— L2-1 讨论管理（WF-L2-1 / IA-2.2 / FD-1.2 / FD-1.3 / IX-2.2）
 * (C) 状态快捷 Tab → (D) 组合筛选 → (E) 排序与批量操作 → (F) 任务列表（超时行高亮）
 * → (G) 分页；「人工判定」弹窗仅医务部管理员对「待人工判定」行可见（B011）。
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Limit = global.Limit;

  global.AMS.pages['discuss-list'] = {
    data: function () {
      return {
        status: 'all',
        filter: { deathType: 'all', priority: 'all', dept: 'all', from: '', to: '', keyword: '' },
        query: { deathType: 'all', priority: 'all', dept: 'all', from: '', to: '', keyword: '' },
        sort: 'death-desc',
        page: 1, size: 20,
        selected: [],
        errors: {},
        judge: null, judgeForm: { deathType: '', note: '' }, judgeErr: {},
        DN: D.DEATH_TYPES, PN: D.PRIORITIES, DS: D.DISCUSS_STATUS
      };
    },
    computed: {
      counts: function () { App.state.refresh; App.state.clock; return Svc.discussStatusCounts(App.user()); },
      all: function () {
        App.state.refresh; App.state.clock;
        var q = Object.assign({ status: this.status, sort: this.sort }, this.query);
        return Svc.discussList(App.user(), q);
      },
      rows: function () {
        var s = (this.page - 1) * this.size;
        return this.all.slice(s, s + this.size);
      },
      depts: function () { return Svc.depts().map(function (d) { return d.name; }); },
      tabs: function () {
        var c = this.counts;
        return [{ code: 'all', name: '全部', n: c.all }].concat(D.DISCUSS_STATUS.map(function (s) {
          return { code: s.code, name: s.name, n: c[s.code] || 0 };
        }));
      },
      legendOvertime: function () { return this.rows.filter(function (r) { return r.discussCountdown.overdue && r.discussStatus !== 'archived'; }).length; }
    },
    methods: {
      pickTab: function (code) { this.status = code; this.page = 1; },
      runQuery: function () {
        this.errors = {};
        if (this.filter.from && this.filter.to && Date.parse(this.filter.from) > Date.parse(this.filter.to)) {
          this.errors.range = '起始日期不能晚于结束日期';
          App.toast('起始日期不能晚于结束日期', 'error');
          return;
        }
        if (this.filter.keyword && this.filter.keyword.length > 50) {
          this.errors.keyword = '不超过 50 字符'; return;
        }
        this.query = Object.assign({}, this.filter);
        this.page = 1;
        App.bump();
      },
      resetFilter: function () {
        this.filter = { deathType: 'all', priority: 'all', dept: 'all', from: '', to: '', keyword: '' };
        this.query = Object.assign({}, this.filter);
        this.status = 'all'; this.page = 1; this.errors = {};
        App.bump();
      },
      view: function (c) { App.goCase('discuss-detail', c.encId); },
      /* FD-1.3 人工判定弹窗 */
      openJudge: function (c) {
        this.judge = c;
        this.judgeForm = { deathType: '', note: '' };
        this.judgeErr = {};
      },
      async submitJudge() {
        var f = this.judgeForm, e = {};
        if (!f.deathType) e.deathType = '请选择修正后的死亡类型';
        if (!f.note || f.note.length < 10 || f.note.length > 500) e.note = '判定说明不能为空，10-500 个字符';
        this.judgeErr = e;
        if (Object.keys(e).length) return;
        var okConfirm = await App.ask('确认提交本次人工判定？提交后将更新任务时限与优先级。', { title: '人工判定确认', okText: '确认判定' });
        if (!okConfirm) return;
        var r = Svc.judgeDeathType(this.judge.encId, { deathType: f.deathType, note: f.note }, App.user());
        this.judge = null;
        App.toast('人工判定完成，已重算时限与优先级（' + r.countdown.text + '）');
        App.bump();
      },
      toggle: function (encId, on) {
        var i = this.selected.indexOf(encId);
        if (on && i < 0) this.selected.push(encId);
        if (!on && i >= 0) this.selected.splice(i, 1);
      },
      async batchUrge() {
        if (!this.selected.length) { App.toast('请先勾选需要催办的记录', 'warn'); return; }
        var okConfirm = await App.ask('将向选中人员的未确认参会人发送催办提醒？', { title: '批量通知催办', okText: '发送催办' });
        if (!okConfirm) return;
        var n = 0;
        var self = this;
        this.selected.forEach(function (id) {
          var r = Svc.urgeAttendees(id, App.user());
          if (r.ok) n += r.count;
        });
        this.selected = [];
        App.toast(n ? ('已向 ' + n + ' 名未确认参会人员发送催办提醒') : '所选任务暂无待确认参会人员', n ? 'success' : 'info');
        App.bump();
      },
      limitDays: function () { return Limit.config().discussionDays.pending; },
      levelOf: function (c) { return c.discussStatus === 'archived' ? '' : (c.discussCountdown.overdue ? 'overtime' : ''); },
      showJudgeBtn: function (c) { return App.canRole('quality') && c.deathType === 'pending'; },
      cd: function (c) { return c.discussCountdown; }
    },
    created: function () {
      var p = App.state.params || {};
      if (p.status) { this.status = p.status; }
      ['deathType', 'priority', 'dept', 'keyword'].forEach(function (k) {
        if (p[k]) { this.filter[k] = p[k]; this.query[k] = p[k]; }
      }, this);
    },
    template: `
    <div>
      <div class="page-head">
        <div>
          <h1>💬 讨论管理</h1>
          <div class="desc">全部死亡病例讨论任务，支持多维度筛选与排序；点击列表行「查看」进入讨论任务详情。</div>
        </div>
        <div class="btn-row">
          <lock-btn label="批量通知催办" cls="sm" :ok="can('director|attending') || selected.length>0" :reason="why('director|attending','仅科主任/主管医师可发起催办')" @click="batchUrge"></lock-btn>
        </div>
      </div>

      <!-- (C) 状态快捷 Tab -->
      <div class="card"><div class="card-body" style="padding:10px 16px">
        <div class="chip-row">
          <span class="chip" v-for="t in tabs" :key="t.code" :class="{active: status===t.code}" @click="pickTab(t.code)">
            {{ t.name }}<b style="margin-left:5px">({{ t.n }})</b>
          </span>
        </div>
      </div></div>

      <!-- (D) 搜索筛选区 -->
      <div class="card">
        <div class="card-head"><h4>🔍 筛选条件</h4><span class="hint small">支持组合叠加；[重置筛选] 一键清空</span></div>
        <div class="card-body">
          <div class="filter-bar">
            <div class="field"><label>死亡类型</label>
              <select v-model="filter.deathType">
                <option value="all">全部</option>
                <option v-for="t in DN" :value="t.code">{{ t.name }}</option>
              </select>
            </div>
            <div class="field"><label>任务优先级</label>
              <select v-model="filter.priority">
                <option value="all">全部</option>
                <option v-for="p in PN" :value="p.code">{{ p.name }}</option>
              </select>
            </div>
            <div class="field"><label>所属科室</label>
              <select v-model="filter.dept">
                <option value="all">全部</option>
                <option v-for="d in depts" :value="d">{{ d }}</option>
              </select>
            </div>
            <div class="field"><label>死亡时间（起）</label><input type="date" v-model="filter.from"></div>
            <div class="field"><label>死亡时间（止）</label><input type="date" v-model="filter.to"></div>
            <div class="field" style="flex:1;min-width:200px"><label>患者姓名 / 住院号</label>
              <input type="text" v-model="filter.keyword" placeholder="模糊匹配，不超过 50 字符" @keyup.enter="runQuery">
            </div>
            <div class="btn-row">
              <button class="btn primary" @click="runQuery">查 询</button>
              <button class="btn" @click="resetFilter">重置筛选</button>
            </div>
          </div>
          <div class="err-text mt8" v-if="errors.range">{{ errors.range }}</div>
          <div class="err-text mt8" v-if="errors.keyword">{{ errors.keyword }}</div>
        </div>
      </div>

      <!-- (E) 操作栏 + (F) 列表 -->
      <div class="card">
        <div class="card-head">
          <div class="row">
            <span class="small muted">共 <b>{{ all.length }}</b> 条记录</span>
            <span class="tag red" v-if="legendOvertime">{{ legendOvertime }} 条已超时（行淡红高亮）</span>
            <span class="tag blue" v-if="selected.length">已选 {{ selected.length }} 条</span>
          </div>
          <div class="field inline">
            <label class="small muted">排序</label>
            <select v-model="sort" style="width:auto" @change="page=1">
              <option value="death-desc">死亡时间倒序</option>
              <option value="countdown">讨论时限倒计时</option>
              <option value="priority">任务优先级</option>
              <option value="status">讨论状态</option>
            </select>
          </div>
        </div>
        <div class="card-body tight">
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr>
                <th style="width:34px"><input type="checkbox" :checked="selected.length===rows.length && rows.length>0"
                     @change="rows.forEach(r=>toggle(r.encId,$event.target.checked)); if(!$event.target.checked) selected=[]"></th>
                <th>患者姓名</th><th>住院号</th><th>科室</th><th>死亡时间</th><th>死亡类型</th>
                <th>优先级</th><th>讨论状态</th><th>剩余时限</th><th>主管医师</th><th style="width:150px">操作</th>
              </tr></thead>
              <tbody>
                <tr v-for="c in rows" :key="c.encId" :class="levelOf(c)">
                  <td><input type="checkbox" :checked="selected.indexOf(c.encId)>=0" @change="toggle(c.encId,$event.target.checked)"></td>
                  <td><b>{{ c.name }}</b></td>
                  <td class="mono">{{ c.mrn }}</td>
                  <td>{{ c.deptName }}</td>
                  <td>{{ md(c.deathMs) }}</td>
                  <td><dict-tag :list="DN" :value="c.deathType"></dict-tag></td>
                  <td><dict-tag :list="PN" :value="c.priority"></dict-tag></td>
                  <td><dict-tag :list="DS" :value="c.discussStatus"></dict-tag></td>
                  <td><countdown-text :cd="cd(c)"></countdown-text></td>
                  <td>{{ c.attending }}</td>
                  <td class="actions">
                    <button class="btn-link" @click="view(c)">查看</button>
                    <button class="btn-link" v-if="showJudgeBtn(c)" @click="openJudge(c)">人工判定</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <empty-state v-if="!rows.length" text="暂无符合条件的讨论任务" icon="📋"
                       sub="调整筛选条件或切换状态 Tab 后重试；也可点击「重置筛选」。">
            <button class="btn" @click="resetFilter">清除筛选条件</button>
          </empty-state>
        </div>
        <!-- (F-注) 图例 -->
        <div class="card-body" style="border-top:1px solid var(--border-2);background:#FAFAFA">
          <div class="small muted" style="line-height:2">
            <div><b>图例</b>　死亡类型：<dict-tag :list="DN" value="expected"></dict-tag> <dict-tag :list="DN" value="unexpected"></dict-tag> <dict-tag :list="DN" value="special"></dict-tag> <dict-tag :list="DN" value="pending"></dict-tag>
              　状态：<dict-tag :list="DS" value="to-organize"></dict-tag> <dict-tag :list="DS" value="in-progress"></dict-tag> <dict-tag :list="DS" value="to-sign"></dict-tag> <dict-tag :list="DS" value="archived"></dict-tag></div>
            <div>剩余时限：<span class="countdown normal">剩余 3d 5h</span>（&gt;50%）<span class="countdown yellow">剩余 1d 2h</span>（&lt;50%）<span class="countdown orange">剩余 4h</span>（&lt;20%）<span class="countdown red">已超时</span>（超时行淡红高亮）；阈值取自「系统管理 › 时限规则配置」，倒计时每分钟刷新。</div>
            <div>「人工判定」按钮仅在死亡类型为 <dict-tag :list="DN" value="pending"></dict-tag> 且当前登录为医务部管理员时显示；列表默认按「高优先级 + 已超时」置顶排序。</div>
          </div>
        </div>
        <ui-pager v-if="all.length" :total="all.length" v-model:page="page" v-model:size="size"></ui-pager>
      </div>

      <!-- 人工判定弹窗（FD-1.3） -->
      <ui-modal v-if="judge" :title="'人工判定 — 死亡类型复核'" width="" @close="judge=null">
        <div class="alert warn"><span>⚠️</span><div>该病例未命中任何自动分类规则，系统标记为「待人工判定」（默认讨论时限 {{ limitDays }} 天）。请复核并修正死亡类型，提交后将按原死亡时间重算任务时限与优先级。</div></div>
        <kv-grid :rows="[
          ['患者', judge.name + '　/　' + judge.gender + '　/　' + judge.age + ' 岁'],
          ['住院号', judge.mrn],
          ['科室', judge.deptName],
          ['主管医师', judge.attending],
          ['死亡时间', dt(judge.deathMs)],
          ['死亡原因', judge.deathDx || '——'],
          ['死亡诊断', judge.deathDx || '（EMR 获取）'],
          ['当前判定', '待人工判定']
        ]" :cols="2"></kv-grid>
        <div class="divider-label">修正死亡类型</div>
        <div class="radios" style="flex-direction:column;align-items:flex-start;gap:9px">
          <label><input type="radio" value="expected" v-model="judgeForm.deathType"> 预期死亡（恶性肿瘤晚期 / 慢性病终末期 / 高龄自然死亡 / 已签署放弃抢救）</label>
          <label><input type="radio" value="unexpected" v-model="judgeForm.deathType"> 非预期死亡（入院 48h 内 / 术后 30 天内 / 诊疗中突然死亡 / 抢救无效）</label>
          <label><input type="radio" value="special" v-model="judgeForm.deathType"> 特殊死亡（麻醉意外 / 输血反应 / 药物过敏 / 医疗纠纷相关）</label>
        </div>
        <div class="err-text mt4" v-if="judgeErr.deathType">{{ judgeErr.deathType }}</div>
        <div class="field mt12"><label class="req">判定说明（10-500 字，用于留痕日志）</label>
          <textarea v-model="judgeForm.note" rows="3" placeholder="例如：患者因急性心肌梗死入院 48 小时内死亡，结合病历与抢救记录，判定为非预期死亡。"></textarea>
          <span class="field-help">{{ (judgeForm.note||'').length }} / 500</span>
        </div>
        <div class="err-text" v-if="judgeErr.note">{{ judgeErr.note }}</div>
        <template #foot>
          <button class="btn" @click="judge=null">取 消</button>
          <button class="btn primary" @click="submitJudge">确认判定</button>
        </template>
      </ui-modal>
    </div>`,
  };
})(window);
