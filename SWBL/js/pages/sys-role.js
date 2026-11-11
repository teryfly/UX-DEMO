/* =====================================================================
 * pages/sys-role.js —— L3-5-4 角色权限管理（WF-L3-5-4 / IA-2.19 / FD-1.20 / IX-2.21）
 * 角色列表 + 功能权限树 + 数据权限范围 + 角色-用户关联 + 权限预览 + 变更日志
 * 保存后导航可见性（Domain.canAccess）与页面内按钮权限即时生效。
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Limit = global.Limit;

  var PERM_NODES = [
    { code: 'home', name: '首页工作台', children: [{ code: 'home:view', name: '查看工作台' }] },
    { code: 'discuss', name: '讨论管理', children: [
      { code: 'discuss:view', name: '查看讨论任务' }, { code: 'discuss:arrange-meeting', name: '安排讨论会议' },
      { code: 'discuss:urge', name: '参会催办' }, { code: 'discuss:write-record', name: '书写讨论记录' },
      { code: 'discuss:sign', name: 'CA 电子签名' }, { code: 'discuss:view-chart', name: '调阅病历资料' },
      { code: 'discuss:manual-judge', name: '人工判定死亡类型' }
    ] },
    { code: 'report', name: '上报管理', children: [
      { code: 'report:fill', name: '填写上报单' }, { code: 'report:submit', name: '提交审核' },
      { code: 'report:review-1', name: '一级审核' }, { code: 'report:review-2', name: '二级审核' },
      { code: 'report:review-3', name: '三级终审' }, { code: 'report:view-all', name: '查看全部上报单' },
      { code: 'report:export', name: '导出上报清单' }
    ] },
    { code: 'improve', name: '改进跟踪', children: [
      { code: 'improve:execute', name: '执行改进措施' }, { code: 'improve:report', name: '提交完成报告' },
      { code: 'improve:evaluate', name: '效果评估' }, { code: 'improve:edit', name: '编辑任务' },
      { code: 'improve:mark-excellent', name: '标记优秀措施' }, { code: 'improve:view', name: '查看全部任务' }
    ] },
    { code: 'stat', name: '统计分析', children: [{ code: 'stat:view', name: '查看统计分析' }, { code: 'stat:export', name: '导出报表' }] },
    { code: 'sys', name: '系统管理', children: [
      { code: 'sys:template', name: '模板管理' }, { code: 'sys:timeout', name: '时限规则配置' },
      { code: 'sys:basedata', name: '基础数据管理' }, { code: 'sys:role', name: '角色权限管理' },
      { code: 'sys:notify', name: '通知设置' }, { code: 'sys:approval', name: '审批流程配置' }
    ] }
  ];

  global.AMS.pages['sys-role'] = {
    data: function () {
      return {
        sel: 'clinician', editing: false, form: { name: '', desc: '', perms: [], dataScope: 'dept', users: [] },
        errs: {}, roleModal: null, showPreview: false, addedUser: ''
      };
    },
    computed: {
      basic: function () { App.state.refresh; return FHIR.view('Basic', 'Basic-role-permissions'); },
      roles: function () {
        var b = this.basic;
        if (!b) return [];
        var list = JSON.parse(JSON.stringify(b.ext.items || []));
        var users = {};
        FHIR.scan('PractitionerRole').forEach(function (r) {
          var pr = FHIR.decode(r);
          var nav = (pr.ext || {}).navRole || 'clinician';
          users[nav] = (users[nav] || 0) + 1;
        });
        return list.map(function (r) {
          r.userCount = D.DEMO_USERS.filter(function (u) { return u.navRole === r.role; }).length;
          r.pageCount = Object.keys(b.ext.pages || {}).filter(function (k) { return (b.ext.pages[k] || []).indexOf(r.role) >= 0; }).length;
          r.builtin = true;
          return r;
        });
      },
      current: function () { return this.roles.filter(function (r) { return r.role === this.sel; }, this)[0] || this.roles[0]; },
      pages: function () {
        var b = this.basic;
        return b && b.ext.pages ? Object.keys(b.ext.pages) : [];
      },
      pageNames: function () {
        var out = {};
        D.MODULES.forEach(function (m) {
          out[m.route] = m.name;
          m.pages.forEach(function (p) { if (!p.hidden) out[p.route] = m.name + ' › ' + p.name; });
        });
        return out;
      },
      logs: function () { App.state.refresh; return Svc.logsOfKind('role-perm').slice(0, 30); },
      allUsers: function () {
        return FHIR.scan('PractitionerRole').map(function (r) { return FHIR.decode(r); }).map(function (pr) {
          return { name: pr.practitioner.display, pid: pr.practitioner.reference.split('/')[1], dept: pr.organization ? pr.organization.display : '', role: pr.id };
        });
      }
    },
    created: function () { this.pick(this.sel); },
    methods: {
      pick: function (code) {
        this.sel = code;
        var r = this.roles.filter(function (x) { return x.role === code; })[0];
        if (!r) return;
        this.form = { name: r.name, desc: r.desc, perms: (r.perms || []).slice(), dataScope: r.dataScope, users: this.allUsers.filter(function (u) { return (D.userByName ? false : false) || false; }).slice(0, 0) };
        var b = this.basic;
        this.form.pages = this.pages.filter(function (k) { return ((b.ext.pages[k] || []).indexOf(code) >= 0); });
        this.editing = true;
      },
      togglePerm: function (code) {
        var i = this.form.perms.indexOf(code);
        if (i >= 0) this.form.perms.splice(i, 1); else this.form.perms.push(code);
      },
      togglePage: function (route) {
        var i = this.form.pages.indexOf(route);
        if (i >= 0) this.form.pages.splice(i, 1); else this.form.pages.push(route);
      },
      checkModule: function (node, on) { var self = this; node.children.forEach(function (c) { var has = self.form.perms.indexOf(c.code) >= 0; if (on && !has) self.form.perms.push(c.code); if (!on && has) self.form.perms.splice(self.form.perms.indexOf(c.code), 1); }); },
      moduleChecked: function (node) { var self = this; return node.children.every(function (c) { return self.form.perms.indexOf(c.code) >= 0; }); },
      save: async function () {
        var e = {};
        if (!this.form.name || this.form.name.length > 50) e.name = '角色名称不能为空（1-50 字符）';
        if (!this.form.perms.length) e.perms = '至少勾选一项可访问功能权限';
        if (!this.form.dataScope) e.scope = '请选择数据可见范围';
        this.errs = e;
        if (Object.keys(e).length) { App.toast('角色权限校验未通过', 'error'); return; }
        var okc = await App.ask('保存后角色权限立即生效，确认？', { title: '保存角色配置' });
        if (!okc) return;
        var b = this.basic;
        var items = JSON.parse(JSON.stringify(b.ext.items || [])).map(function (r) {
          return r.role === this.sel ? { role: r.role, name: this.form.name, desc: this.form.desc, dataScope: this.form.dataScope, perms: this.form.perms.slice() } : r;
        }, this);
        var pages = {};
        this.pages.forEach(function (k) {
          var cur = (b.ext.pages[k] || []).slice();
          var has = this.form.pages.indexOf(k) >= 0;
          var idx = cur.indexOf(this.sel);
          if (has && idx < 0) cur.push(this.sel);
          if (!has && idx >= 0) cur.splice(idx, 1);
          pages[k] = cur;
        }, this);
        var scopes = Object.assign({}, b.ext.scopes || {});
        scopes[this.sel] = this.form.dataScope;
        FHIR.update(Object.assign({}, b, { ext: Object.assign({}, b.ext, { items: items, pages: pages, scopes: scopes }) }));
        FHIR.create({
          resourceType: 'Provenance',
          activity: { coding: [{ system: global.Vocab.SYS + 'provenance-activity', code: 'role-perm', display: '角色权限变更' }], text: '角色权限变更' },
          recorded: new Date().toISOString(),
          reason: [{ text: '更新角色「' + this.form.name + '」功能权限 ' + this.form.perms.length + ' 项、可见页面 ' + this.form.pages.length + ' 个、数据范围 ' + D.dataScopeName(this.form.dataScope) }],
          agent: [{ who: { reference: 'Practitioner/' + App.user().practitioner, display: App.user().name } }],
          entity: [{ role: 'source', what: { reference: 'Basic/Basic-role-permissions', display: '角色功能与数据权限' } }],
          ext: { activity: 'role-perm', note: '角色 ' + this.sel + ' 权限变更', bizKind: 'basic', bizId: 'Basic-role-permissions', operatorName: App.user().name }
        });
        App.toast('角色权限已保存，导航与按钮权限即时生效');
        App.bump();
      },
      async del(r) {
        if (r.builtin) { App.toast('预置业务角色禁止删除（B099）', 'warn'); return; }
        var okc = await App.ask('确认删除该角色，角色下用户将失去该角色权限', { title: '删除角色', danger: true });
        if (!okc) return;
        App.toast('已删除自定义角色');
      },
      previewText: function () {
        var self = this;
        var mods = D.MODULES.filter(function (m) { return self.form.pages.indexOf(m.route) >= 0 || m.pages.some(function (p) { return self.form.pages.indexOf(p.route) >= 0; }); });
        return mods.map(function (m) { return m.name + '（' + m.pages.filter(function (p) { return !p.hidden; }).map(function (p) { return p.name; }).join('、') + '）'; }).join('；');
      }
    },
    template: `
    <div>
      <div class="page-head"><div><h1>👥 角色权限管理</h1>
        <div class="desc">配置系统角色的功能权限（页面 / 操作）与数据权限（本科室 / 全院 / 仅本人），保存后立即生效</div></div></div>

      <div class="card">
        <div class="card-head"><h4>角色列表</h4><span class="hint small">预置角色不可删除；关联用户数取自 PractitionerRole 绑定</span></div>
        <div class="card-body tight"><div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>角色名称</th><th>描述</th><th>导航角色</th><th class="num">关联用户数</th><th class="num">可见页面数</th><th class="num">功能权限项</th><th>数据范围</th><th style="width:120px">操作</th></tr></thead>
            <tbody>
              <tr v-for="r in roles" :key="r.role" :class="{clickable:true}" @click="pick(r.role)">
                <td><b :class="{blue: r.role===sel}">{{ r.name }}</b><span class="tag gray" v-if="r.builtin">预置</span></td>
                <td class="small muted">{{ r.desc }}</td>
                <td>{{ r.role==='clinician' ? '临床医师' : (r.role==='director'?'科主任':'医务部管理员') }}</td>
                <td class="num">{{ r.userCount }}</td><td class="num">{{ r.pageCount }}</td><td class="num">{{ (r.perms||[]).length }}</td>
                <td><span class="tag blue">{{ r.dataScope==='hospital'?'全院':(r.dataScope==='self'?'仅本人数据':'本科室') }}</span></td>
                <td class="actions"><button class="btn-link" @click.stop="pick(r.role)">编辑</button>
                  <button class="btn-link danger" @click.stop="del(r)">删除</button></td>
              </tr>
            </tbody>
          </table>
        </div></div>
      </div>

      <div class="split" v-if="current && editing">
        <div class="col card">
          <div class="card-head"><h4>角色基本信息</h4></div>
          <div class="card-body">
            <div class="form-row"><label class="req">角色名称</label><div class="ctrl">
              <input type="text" v-model="form.name" maxlength="50" :class="{invalid: errs.name}">
              <div class="err-text" v-if="errs.name">{{ errs.name }}</div></div></div>
            <div class="form-row vertical"><label>角色描述</label><div class="ctrl">
              <textarea v-model="form.desc" rows="2" maxlength="200"></textarea></div></div>
            <div class="divider-label">数据权限配置（F138）</div>
            <div class="radios" style="padding-top:0">
              <label v-for="s in SCOPES" :key="s.code"><input type="radio" :value="s.code" v-model="form.dataScope"> {{ s.name }}</label>
            </div>
            <div class="err-text" v-if="errs.scope">{{ errs.scope }}</div>
            <div class="hint small mt8">临床医师/科主任默认「本科室」，医务部管理员默认「全院」；改进任务对责任人始终可见本人任务。</div>

            <div class="divider-label">角色-用户关联（F139）</div>
            <table class="tbl dense">
              <thead><tr><th>用户名</th><th>姓名</th><th>所属科室</th></tr></thead>
              <tbody>
                <tr v-for="u in demoUsers" :key="u.id">
                  <td class="mono small">{{ u.id }}</td><td>{{ u.name }}<span class="tag blue" v-if="u.navRole===sel">已关联</span></td><td>{{ u.dept }}</td>
                </tr>
              </tbody>
            </table>
            <div class="btn-row mt12"><button class="btn primary" @click="save">保存角色配置</button>
              <button class="btn" @click="showPreview=true">权限预览</button></div>
          </div>
        </div>

        <div class="col card">
          <div class="card-head"><h4>功能权限配置（F137）</h4>
            <span class="hint small">已勾选 {{ form.perms.length }} 项 / 可见页面 {{ form.pages.length }} 个</span></div>
          <div class="card-body">
            <div class="divider-label">可访问页面</div>
            <div class="checks">
              <label v-for="p in pages" :key="p"><input type="checkbox" :checked="form.pages.indexOf(p)>=0" @change="togglePage(p)"> {{ pageNames[p] || p }}</label>
            </div>
            <div class="divider-label">操作权限树</div>
            <div class="perm-tree">
              <div class="perm-node" v-for="n in NODES" :key="n.code">
                <div class="lv1"><label style="display:flex;gap:6px;align-items:center;cursor:pointer">
                  <input type="checkbox" :checked="moduleChecked(n)" @change="checkModule(n,$event.target.checked)"> {{ n.name }}</label>
                  <span class="muted small">{{ n.children.length }} 项</span></div>
                <div class="leaves">
                  <label v-for="c in n.children" :key="c.code">
                    <input type="checkbox" :checked="form.perms.indexOf(c.code)>=0" @change="togglePerm(c.code)"> {{ c.name }}</label>
                </div>
              </div>
            </div>
            <div class="err-text mt8" v-if="errs.perms">{{ errs.perms }}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h4>权限变更日志</h4></div>
        <div class="card-body tight">
          <table class="tbl dense" v-if="logs.length"><thead><tr><th>操作人</th><th>操作时间</th><th>变更内容摘要</th></tr></thead>
            <tbody><tr v-for="(l,i) in logs" :key="i"><td>{{ l.by }}</td><td class="small">{{ l.at }}</td><td>{{ l.note }}</td></tr></tbody></table>
          <empty-state v-else text="暂无权限变更日志" icon="🧾"></empty-state>
        </div>
      </div>

      <ui-modal v-if="showPreview" title="权限预览 · 当前角色界面效果" @close="showPreview=false">
        <div class="alert info"><span>👁</span><div>按当前配置，「{{ form.name }}」登录后的主导航与可执行操作预览如下（保存后真实生效）。</div></div>
        <div class="kv" style="grid-template-columns:1fr">
          <div><span class="k">可见主导航</span><span class="v">{{ previewText() || '（无可见页面）' }}</span></div>
          <div><span class="k">数据可见范围</span><span class="v">{{ form.dataScope==='hospital'?'全院所有死亡病例数据':(form.dataScope==='self'?'仅本人相关数据':'本科室数据') }}</span></div>
          <div><span class="k">可执行操作</span><span class="v">{{ form.perms.join('、') || '—' }}</span></div>
        </div>
        <template #foot><button class="btn" @click="showPreview=false">关闭</button><button class="btn primary" @click="showPreview=false;save()">保存并生效</button></template>
      </ui-modal>
    </div>`,
    created2: function () { }
  };
  var pg = global.AMS.pages['sys-role'];
  Object.assign(pg.computed, {
    demoUsers: function () {
      var sel = this.sel;
      return D.DEMO_USERS.map(function (u) { return Object.assign({}, u, { linked: u.navRole === sel }); });
    }
  });
  pg.created = function () { this.NODES = PERM_NODES; this.SCOPES = D.DATA_SCOPES; this.pick(this.sel); };
  delete pg.created2;
})(window);
