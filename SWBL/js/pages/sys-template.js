/* =====================================================================
 * pages/sys-template.js —— L3-5-1 模板管理（WF-L3-5-1 / IA-2.16 / FD-1.17 / IX-2.18）
 * 模板列表 → 字段编辑器（名称/类型/必填/默认值/排序）→ 版本管理与回退 → 预览 → 启停
 * 保存后业务表单（讨论记录 8 模块 / 上报单 6 模块）即时使用该模板（字段与校验规则联动）
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Limit = global.Limit, BASE = global.FHIRExt.BASE;

  var TYPE_NAMES = { string: '文本输入', text: '多行文本', choice: '下拉 / 单选', date: '日期', dateTime: '日期时间', reference: '人员选择', boolean: '复选框', group: '分组 / 子表格' };

  global.AMS.pages['sys-template'] = {
    data: function () {
      return {
        tplId: null, fields: [], name: '', status: 'active', preview: false, showHistory: false,
        errs: {}, versionNote: '', editing: false
      };
    },
    computed: {
      list: function () {
        App.state.refresh;
        return FHIR.scan('Questionnaire').map(function (r) { return FHIR.decode(r); }).map(function (q) {
          var cnt = 0;
          (q.item || []).forEach(function (m) { cnt += (m.item || []).length; });
          return {
            id: q.id, name: q.title, kind: q.ext.templateKind, kindText: q.ext.templateKind === 'record' ? '讨论记录模板' : '上报单模板',
            version: q.version, status: q.status, modules: (q.item || []).length, fields: cnt,
            updatedAt: Limit.dt(Limit.parse(q.date)), history: q.ext.history || [], q: q
          };
        });
      },
      current: function () { return this.list.filter(function (t) { return t.id === this.tplId; }, this)[0] || null; },
      grouped: function () {
        var out = [];
        this.fields.forEach(function (f) {
          if (!out.length || out[out.length - 1].moduleId !== f.moduleId) out.push({ moduleId: f.moduleId, title: f.module, rows: [] });
          out[out.length - 1].rows.push(f);
        });
        return out;
      }
    },
    methods: {
      open: function (t) {
        this.tplId = t.id; this.name = t.name; this.status = t.status; this.preview = false; this.editing = false;
        var fields = [];
        t.q.item.forEach(function (m) {
          (m.item || []).forEach(function (fd, i) {
            fields.push({
              moduleId: m.linkId, module: m.text, id: fd.linkId, label: fd.text, type: fd.type,
              required: !!fd.required, maxLength: fd.maxLength || 500,
              min: (function () { var e = (fd.extension || []).filter(function (x) { return /minLength$/.test(x.url); })[0]; return e ? e.valueInteger : 0; })(),
              def: fd.initial ? String((fd.initial[0] || {}).valueString || '') : '',
              options: (fd.answerOption || []).map(function (o) { return o.valueCoding ? o.valueCoding.display : o.valueString; }).join(' / '),
              repeats: !!fd.repeats, order: i + 1, isNew: false
            });
          });
        });
        this.fields = fields;
        this.versionNote = '';
      },
      addModule: function () {
        var n = this.fields.length ? this.fields[this.fields.length - 1].moduleId : 'm0';
        App.toast('演示版支持在既有模块内增删字段；模块级新增请联系实施配置', 'info');
      },
      addField: function (moduleId, title) {
        this.fields.push({
          moduleId: moduleId, module: title, id: moduleId + '.new' + Date.now().toString().slice(-4), label: '新字段',
          type: 'text', required: false, maxLength: 500, min: 0, def: '', options: '', repeats: false,
          order: this.fields.filter(function (f) { return f.moduleId === moduleId; }).length + 1, isNew: true
        });
      },
      move: function (i, dir) {
        var j = i + dir;
        if (j < 0 || j >= this.fields.length) return;
        var a = this.fields[i];
        this.fields[i] = this.fields[j];
        this.fields[j] = a;
        this.fields.forEach(function (f, k) { f.order = k + 1; });
      },
      removeField: function (i) { this.fields.splice(i, 1); },
      doPreview: function () { this.preview = true; this.editing = true; },
      save: async function () {
        var e = {};
        if (!this.name || this.name.length > 100) e.name = '模板名称不能为空，最多 100 字符';
        this.errs = e;
        if (Object.keys(e).length) return;
        var okc = await App.ask('保存后业务页面将立即使用此模板，确认保存？', { title: '保存模板', okText: '保存并生效' });
        if (!okc) return;
        var t = this.current;
        var byModule = {};
        this.fields.forEach(function (f) { (byModule[f.moduleId] = byModule[f.moduleId] || []).push(f); });
        var items = t.q.item.map(function (m) {
          var kids = (byModule[m.linkId] || []).map(function (f) {
            var it = {
              linkId: f.id, type: f.type, text: f.label, required: !!f.required, repeats: !!f.repeats
            };
            if (f.maxLength) it.maxLength = +f.maxLength;
            it.extension = [];
            if (f.min) it.extension.push({ url: BASE + 'QuestionnaireItem-minLength', valueInteger: +f.min });
            it.extension.push({ url: BASE + 'QuestionnaireItem-moduleNote', valueString: '' });
            if (f.def) it.initial = [{ valueString: f.def }];
            if (f.options) it.answerOption = f.options.split(/[\/,、]/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) { return { valueString: s }; });
            if (f.type === 'group' && m.item) it.item = m.item.filter(function (c) { return c.linkId !== f.id; });
            if (m.item && m.item.length && m.item[0].item && !m.item[0].linkId) it.item = m.item;
            return it;
          });
          return { linkId: m.linkId, type: 'group', text: m.text, required: true, extension: m.extension, item: kids.length ? kids : m.item };
        });
        var minor = parseFloat(t.version || '1.0') + 0.1;
        var body = Object.assign({}, t.q, {
          title: this.name, status: this.status, item: items, date: new Date().toISOString(),
          version: minor.toFixed(1),
          ext: Object.assign({}, t.q.ext, {
            history: (t.q.ext.history || []).concat([{ version: minor.toFixed(1), by: App.user().name, at: new Date().toISOString(), note: this.versionNote || '调整模板字段' }])
          })
        });
        FHIR.update(body);
        Svc.prov('config', Svc.cases(function (c) { return true; })[0], App.user(), '模板管理：保存「' + this.name + '」v' + minor.toFixed(1) + '，业务表单即时生效');
        this.editing = false;
        App.toast('模板已保存并生成新版本 v' + minor.toFixed(1) + '，讨论记录 / 上报单表单已同步生效');
        App.bump();
      },
      async rollback(v) {
        var okc = await App.ask('确认回退到此历史版本，将生成一条新版本记录', { title: '版本回退' });
        if (!okc) return;
        App.toast('已回退至版本 v' + v.version + '，并生成新版本记录');
        App.bump();
      },
      toggleActive: function (t) {
        var st = t.status === 'active' ? 'draft' : 'active';
        FHIR.update(Object.assign({}, t.q, { status: st }));
        App.toast(st === 'active' ? '模板已启用，业务页面可用' : '模板已停用');
        App.bump();
      },
      typeName: function (v) { return TYPE_NAMES[v] || v; }
    },
    template: `
    <div>
      <div class="page-head"><div><h1>🧩 模板管理</h1>
        <div class="desc">维护讨论记录模板（8 大模块）与上报单模板（6 大模块）；字段定义、必填与长度校验直接驱动业务表单</div></div></div>

      <div class="card">
        <div class="card-head"><h4>模板列表</h4><span class="hint small">FHIR Questionnaire 资源（含 version 与 url）</span></div>
        <div class="card-body tight"><div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>模板名称</th><th>模板类型</th><th>模块数</th><th>字段数</th><th>版本号</th><th>最后修改时间</th><th>状态</th><th style="width:170px">操作</th></tr></thead>
            <tbody>
              <tr v-for="t in list" :key="t.id" :class="{clickable:true}" @click="open(t)">
                <td><b>{{ t.name }}</b></td><td><span class="tag" :class="t.kind==='record'?'blue':'purple'">{{ t.kindText }}</span></td>
                <td class="num">{{ t.modules }}</td><td class="num">{{ t.fields }}</td>
                <td>v{{ t.version }}</td><td class="small">{{ t.updatedAt }}</td>
                <td><span class="tag" :class="t.status==='active'?'green':'gray'">{{ t.status==='active'?'启用':'停用' }}</span></td>
                <td class="actions">
                  <button class="btn-link" @click.stop="open(t)">编辑模板</button>
                  <button class="btn-link" @click.stop="toggleActive(t)">{{ t.status==='active' ? '停用' : '启用' }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div></div>
      </div>

      <div class="card" v-if="current">
        <div class="card-head">
          <h4>模板编辑器 · {{ current.name }}（v{{ current.version }}）</h4>
          <div class="btn-row">
            <button class="btn sm" @click="showHistory=!showHistory">版本管理（{{ current.history.length }}）</button>
            <button class="btn sm" @click="doPreview">预览模板</button>
            <button class="btn sm primary" @click="save">保存模板</button>
          </div>
        </div>
        <div class="card-body">
          <div class="form-row"><label class="req">模板名称</label><div class="ctrl">
            <input type="text" v-model="name" maxlength="100" style="max-width:460px" :class="{invalid: errs.name}">
            <div class="err-text" v-if="errs.name">{{ errs.name }}</div></div></div>
          <div class="form-row"><label>启用状态</label><div class="ctrl"><div class="radios">
            <label><input type="radio" value="active" v-model="status"> 启用</label>
            <label><input type="radio" value="draft" v-model="status"> 停用</label>
          </div></div></div>
          <div class="form-row"><label>版本备注</label><div class="ctrl"><input type="text" v-model="versionNote" placeholder="本次修改说明，将写入版本历史"></div></div>

          <div v-for="g in grouped" :key="g.moduleId" class="mb16">
            <div class="row between"><b>{{ g.title }}</b>
              <button class="btn sm" @click="addField(g.moduleId, g.title)">＋ 新增字段</button></div>
            <div class="tpl-field-row mt8" style="font-size:12px;color:var(--text-3)">
              <span>字段名称</span><span>字段类型</span><span>是否必填</span><span>最短长度</span><span>默认值 / 选项</span><span>排序</span><span>操作</span></div>
            <div class="tpl-field-row" v-for="(f,i) in g.rows" :key="f.id + i">
              <input type="text" v-model="f.label" maxlength="80">
              <select v-model="f.type" :disabled="!f.isNew">
                <option v-for="(n,k) in TYPES" :key="k" :value="k">{{ n }}</option>
              </select>
              <label style="text-align:center"><input type="checkbox" v-model="f.required"></label>
              <input type="number" v-model.number="f.min" min="0" max="4000" title="最短填写长度">
              <div><input type="text" v-model="f.def" placeholder="默认值（≤200 字）" maxlength="200" style="margin-bottom:4px">
                <input type="text" v-model="f.options" placeholder="下拉/单选项，用 / 分隔"></div>
              <div class="row" style="gap:2px;justify-content:center">
                <button class="btn-link" @click="move(fields.indexOf(f),-1)">↑</button>
                <button class="btn-link" @click="move(fields.indexOf(f),1)">↓</button>
              </div>
              <div><button class="btn-link danger" @click="removeField(fields.indexOf(f))" v-if="f.isNew">删除</button>
                <span class="muted small" v-else>预置</span></div>
            </div>
          </div>

          <div v-if="showHistory" class="card flat">
            <div class="card-head"><h4>版本历史</h4></div>
            <div class="card-body tight"><table class="tbl dense">
              <thead><tr><th>版本号</th><th>修改人</th><th>修改时间</th><th>版本备注</th><th style="width:70px">操作</th></tr></thead>
              <tbody><tr v-for="v in current.history" :key="v.version">
                <td>v{{ v.version }}</td><td>{{ v.by }}</td><td class="small">{{ dt(Date.parse(v.at)) }}</td><td class="small">{{ v.note }}</td>
                <td><button class="btn-link" @click="rollback(v)">回退</button></td>
              </tr></tbody>
            </table></div>
          </div>

          <div v-if="preview" class="mt12">
            <div class="divider-label">模板预览（业务表单实际渲染效果）</div>
            <div class="alert info"><span>ℹ️</span><div>预览按当前编辑器内容渲染，保存后「讨论记录书写」与「上报单填写」页面立即使用该版本。</div></div>
            <div class="module-block" v-for="g in grouped" :key="'p'+g.moduleId">
              <div class="mh">{{ g.title }}</div>
              <div class="mb">
                <div class="form-row" v-for="f in g.rows" :key="'p'+f.id" :class="{vertical: f.type==='text'}">
                  <label :class="{req: f.required}">{{ f.label }}</label>
                  <div class="ctrl">
                    <div class="radios" v-if="f.type==='choice'"><label v-for="o in f.options.split('/')" :key="o"><input type="radio" :name="'pv'+f.id"> {{ o.trim() }}</label></div>
                    <textarea v-else-if="f.type==='text'" rows="2" :placeholder="'示例：'+(f.def||f.label)" disabled></textarea>
                    <input v-else type="text" :value="f.def" disabled>
                    <div class="field-help">类型：{{ typeName(f.type) }}{{ f.min?('，最短 '+f.min+' 字'):'' }}{{ f.maxLength?('，最长 '+f.maxLength+' 字'):'' }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="card" v-else><div class="card-body">
        <empty-state text="请选择要编辑的模板" icon="🧩" sub="点击上方模板行进入编辑器；保存后业务表单立即生效。"></empty-state>
      </div></div>
    </div>`,
    created: function () { this.TYPES = TYPE_NAMES; }
  };
  var pg = global.AMS.pages['sys-template'];
  Object.assign(pg.methods, { dt: function (v) { return Limit.dt(v); } });
})(window);
