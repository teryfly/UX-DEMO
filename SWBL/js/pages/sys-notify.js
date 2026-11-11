/* =====================================================================
 * pages/sys-notify.js —— L3-5-5 通知设置（WF-L3-5-5 / IA-2.20 / FD-1.21 / IX-2.22）
 * 12 个通知场景：通知对象（角色）/ 通知方式（APP·站内·短信·微信）/ 触发时机（即时·延时）
 * + 消息模板（支持 {变量占位}）+ 场景启停；保存后通知中心即时按新配置推送。
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Limit = global.Limit, V = global.Vocab;

  global.AMS.pages['sys-notify'] = {
    data: function () {
      return { sel: null, form: { name: '', targets: [], channels: ['site'], timing: 'immediate', delayMin: 10, titleTpl: '', bodyTpl: '', enabled: true, trigger: '' }, errs: {} };
    },
    computed: {
      list: function () {
        App.state.refresh;
        var b = FHIR.view('Basic', 'Basic-notify-scenes');
        return (b && b.ext.items) || [];
      },
      current: function () { var s = this.sel; return this.list.filter(function (x) { return x.id === s; })[0] || null; },
      groups: function () {
        var g = {};
        this.list.forEach(function (s) { (g[s.kind || '其他'] = g[s.kind || '其他'] || []).push(s); });
        return Object.keys(g).map(function (k) { return { kind: k, items: g[k] }; });
      },
      roles: function () { return D.SCENES; },
      channels: function () { return D.NOTIFY_CHANNELS; },
      recent: function () {
        App.state.refresh;
        return FHIR.scan('Communication').map(function (r) { return FHIR.decode(r); })
          .sort(function (a, b) { return Limit.parse(b.sent) - Limit.parse(a.sent); }).slice(0, 12)
          .map(function (c) {
            return { scene: c.category[0].text, title: c.ext.title, body: (c.payload[0] || {}).contentString || '', at: Limit.dt(Limit.parse(c.sent)), channels: (c.medium || []).map(function (m) { return m.text; }).join('、'), targets: c.ext.targetRole || '' };
          });
      },
      vars: function () { return ['患者姓名', '住院号', '死亡时间', '死亡类型', '科室', '任务名称', '时限', '会议时间', '完成时限', '剩余天数', '截止时间', '审核人', '审核结果', '审核意见', '超时时长']; }
    },
    created: function () { if (this.list.length) this.open(this.list[0]); },
    methods: {
      open: function (s) {
        if (!s) return;
        this.sel = s.id;
        this.form = {
          name: s.name, trigger: s.trigger, targets: (s.targets || []).slice(), channels: (s.channels || []).slice(),
          timing: s.timing || 'immediate', delayMin: s.delayMin || 10, titleTpl: s.titleTpl, bodyTpl: s.bodyTpl, enabled: s.enabled !== false
        };
        this.errs = {};
      },
      toggleArr: function (arr, v, on) {
        var i = arr.indexOf(v);
        if (on && i < 0) arr.push(v);
        if (!on && i >= 0) arr.splice(i, 1);
      },
      insertVar: function (v, which) {
        this.form[which] = (this.form[which] || '') + '{' + v + '}';
      },
      previewBody: function () {
        var sample = { 患者姓名: '王秀兰', 住院号: '2026000123', 死亡时间: Limit.dt(Date.now() - 3 * 86400000), 死亡类型: '非预期死亡', 科室: '心血管内科', 任务名称: '组织死亡病例讨论', 时限: '3 天', 会议时间: Limit.dt(Date.now() + 86400000), 完成时限: Limit.donly(Date.now() + 15 * 86400000), 剩余天数: '2', 截止时间: Limit.dt(Date.now() + 2 * 86400000), 审核人: '王建国', 审核结果: '退回', 审核意见: '死亡原因分析不完整，请补充。', 超时时长: '1 天' };
        return Svc.render(this.form.bodyTpl || '', sample);
      },
      previewTitle: function () {
        return Svc.render(this.form.titleTpl || '', { 患者姓名: '王秀兰', 任务类型: '死亡病例讨论', 任务名称: '组织死亡病例讨论', 剩余占比: '50%', 截止时间: Limit.dt(Date.now() + 86400000), 超时时长: '1 天', 措施摘要: '加强危重患者动态评估', 完成时限: Limit.donly(Date.now() + 15 * 86400000), 会议时间: Limit.dt(Date.now() + 86400000), 评估结论: '已达标关闭', 提交人: '李海峰', 审核时限: '48 小时', 责任人: '李海峰', 剩余天数: '2' });
      },
      save: async function () {
        var f = this.form, e = {};
        if (f.enabled) {
          if (!f.targets.length) e.targets = '启用通知必须选择通知接收角色';
          if (!f.channels.length) e.channels = '请至少选择一种通知方式';
          if (!f.titleTpl || f.titleTpl.length > 100) e.titleTpl = '通知标题不能为空（1-100 字符）';
          if (!f.bodyTpl || f.bodyTpl.length < 10 || f.bodyTpl.length > 800) e.bodyTpl = '通知正文模板不能为空（10-800 字符）';
          if (f.timing === 'delay' && !(f.delayMin > 0)) e.delayMin = '延时必须填写大于 0 的整数';
        }
        this.errs = e;
        if (Object.keys(e).length) { App.toast('通知配置校验未通过', 'error'); return; }
        var okc = await App.ask('保存后该通知场景配置立即生效，确认？', { title: '保存通知场景配置' });
        if (!okc) return;
        var b = FHIR.view('Basic', 'Basic-notify-scenes');
        var items = JSON.parse(JSON.stringify(b.ext.items || [])).map(function (s) {
          return s.id === this.sel ? Object.assign({}, s, {
            targets: f.targets.slice(), channels: f.channels.slice(), timing: f.timing, delayMin: f.timing === 'delay' ? f.delayMin : 0,
            titleTpl: f.titleTpl, bodyTpl: f.bodyTpl, enabled: f.enabled
          }) : s;
        }, this);
        FHIR.update(Object.assign({}, b, { ext: Object.assign({}, b.ext, { items: items }) }));
        FHIR.create({
          resourceType: 'Provenance',
          activity: { coding: [{ system: V.SYS + 'provenance-activity', code: 'config', display: '配置变更' }], text: '配置变更' },
          recorded: new Date().toISOString(),
          reason: [{ text: '更新通知场景「' + f.name + '」：' + (f.enabled ? '启用' : '停用') + '，对象 ' + f.targets.join('/') + '，方式 ' + f.channels.join('/') }],
          agent: [{ who: { reference: 'Practitioner/' + App.user().practitioner, display: App.user().name } }],
          entity: [{ role: 'source', what: { reference: 'Basic/Basic-notify-scenes', display: '通知场景配置' } }],
          ext: { activity: 'config', note: '通知场景 ' + this.sel + ' 配置变更', bizKind: 'basic', bizId: 'Basic-notify-scenes', operatorName: App.user().name }
        });
        App.toast('通知场景已保存并生效（含变量占位符渲染）');
        App.bump();
      },
      roleName: function (r) { return D.sceneName(r); },
      testSend: function () {
        var c = Svc.cases(function (x) { return x.discussStatus !== 'archived'; })[0];
        if (!c) { App.toast('暂无可用于测试的病例', 'warn'); return; }
        Svc.notifyScene(this.sel, c, { 任务名称: this.form.name, 会议时间: Limit.dt(Date.now() + 86400000), 时限: '3 天', 剩余占比: '40%', 截止时间: Limit.dt(Date.now() + 2 * 86400000), 超时时长: '0 天', 措施摘要: '示例措施', 完成时限: Limit.donly(Date.now() + 10 * 86400000), 剩余天数: '10' }, this.form.targets);
        App.toast('已按当前配置试发一条通知，可在右上角 🔔 通知中心查看');
        App.bump();
      }
    },
    template: `
    <div>
      <div class="page-head"><div><h1>🔔 通知设置</h1>
        <div class="desc">配置 {{ list.length }} 个通知场景的触发条件、通知对象、通知方式与消息模板；保存后系统按新配置推送</div></div></div>

      <div class="split">
        <div class="col" style="flex:0 0 320px">
          <div class="card">
            <div class="card-head"><h4>通知场景列表</h4></div>
            <div class="card-body" style="padding:8px;max-height:70vh;overflow:auto">
              <div v-for="g in groups" :key="g.kind" class="mb8">
                <div class="muted small" style="padding:4px 6px">{{ g.kind }}</div>
                <div class="side-nav">
                  <div class="sn" v-for="s in g.items" :key="s.id" :class="{active: sel===s.id}" @click="open(s)">
                    {{ s.name }}
                    <span class="tag" :class="s.enabled!==false?'green':'gray'" style="margin-left:auto">{{ s.enabled!==false?'启用':'停用' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="col" v-if="current">
          <div class="card">
            <div class="card-head"><h4>{{ current.name }} · 规则配置</h4>
              <label class="switch"><input type="checkbox" v-model="form.enabled"><span class="sl"></span></label></div>
            <div class="card-body">
              <div class="alert plain"><span>⚡</span><div><b>触发条件：</b>{{ current.trigger }}
                <span class="muted small">（场景编码 {{ current.id }}）</span></div></div>

              <div class="divider-label">通知对象（F141）</div>
              <div class="checks">
                <label v-for="r in roles" :key="r.code">
                  <input type="checkbox" :checked="form.targets.indexOf(r.code)>=0" @change="toggleArr(form.targets, r.code, $event.target.checked)"> {{ r.name }}
                </label>
              </div>
              <div class="err-text mt4" v-if="errs.targets">{{ errs.targets }}</div>

              <div class="divider-label">通知方式（F142）</div>
              <div class="checks">
                <label v-for="c in channels" :key="c.code">
                  <input type="checkbox" :checked="form.channels.indexOf(c.code)>=0" @change="toggleArr(form.channels, c.code, $event.target.checked)"> {{ c.name }}
                </label>
              </div>
              <div class="err-text mt4" v-if="errs.channels">{{ errs.channels }}</div>

              <div class="divider-label">触发时机（F143/F144）</div>
              <div class="row">
                <div class="radios" style="padding-top:0">
                  <label><input type="radio" value="immediate" v-model="form.timing"> 即时</label>
                  <label><input type="radio" value="delay" v-model="form.timing"> 延时</label>
                </div>
                <input type="number" min="1" v-model.number="form.delayMin" style="width:96px" :disabled="form.timing!=='delay'">
                <span class="muted small">分钟</span>
              </div>
              <div class="err-text mt4" v-if="errs.delayMin">{{ errs.delayMin }}</div>

              <div class="divider-label">消息模板（F145/F146，支持 {变量占位}）</div>
              <div class="field mb8"><label class="req">通知标题模板</label>
                <input type="text" v-model="form.titleTpl" maxlength="100" :class="{invalid: errs.titleTpl}">
                <div class="err-text" v-if="errs.titleTpl">{{ errs.titleTpl }}</div></div>
              <div class="field mb8"><label class="req">通知正文模板（10-800 字符）</label>
                <textarea v-model="form.bodyTpl" rows="4" maxlength="800" :class="{invalid: errs.bodyTpl}"></textarea>
                <div class="field-help">{{ form.bodyTpl.length }}/800</div>
                <div class="err-text" v-if="errs.bodyTpl">{{ errs.bodyTpl }}</div></div>
              <div class="chip-row mb12">
                <span class="chip" v-for="v in vars" :key="v" @click="insertVar(v,'bodyTpl')">{{ '{' + v + '}' }}</span>
              </div>

              <div class="divider-label">渲染效果预览</div>
              <div class="sign-box">
                <b class="small">{{ previewTitle() }}</b>
                <div class="small muted mt4" style="line-height:1.9">{{ previewBody() }}</div>
              </div>
              <div class="btn-row mt12">
                <button class="btn primary" @click="save">保存场景配置</button>
                <button class="btn" @click="testSend" :disabled="!form.enabled">发送测试通知</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h4>最近推送记录<span class="hint small">（Communication 资源，含通知方式与接收角色）</span></h4></div>
        <div class="card-body tight"><div class="table-wrap" style="max-height:340px;overflow:auto">
          <table class="tbl dense">
            <thead><tr><th>场景</th><th>标题</th><th>方式</th><th>接收角色</th><th>推送时间</th></tr></thead>
            <tbody><tr v-for="(r,i) in recent" :key="i">
              <td><span class="tag blue">{{ r.scene }}</span></td>
              <td><div>{{ r.title }}</div><div class="muted small" style="max-width:420px;overflow:hidden;text-overflow:ellipsis">{{ r.body }}</div></td>
              <td class="small">{{ r.channels }}</td><td class="small">{{ r.targets }}</td><td class="small muted">{{ r.at }}</td>
            </tr></tbody>
          </table>
        </div></div>
      </div>
    </div>`
  };
})(window);
