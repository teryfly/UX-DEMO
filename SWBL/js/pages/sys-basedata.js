/* =====================================================================
 * pages/sys-basedata.js —— L3-5-3 基础数据管理（WF-L3-5-3 / IA-2.18 / FD-1.19 / IX-2.20）
 * ICD-10 死亡原因编码 CRUD + 死亡类型自动分类规则 CRUD + 导入导出 + 操作日志
 * 分类规则直接驱动 US-1.1 的自动分类引擎（Classify），修改后新病例即时生效。
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, V = global.Vocab, Limit = global.Limit;

  global.AMS.pages['sys-basedata'] = {
    data: function () {
      return {
        tab: 0, kw: '', icdPage: 1, icdSize: 20,
        icdModal: null, icdForm: { code: '', name: '', cat: '', note: '' }, icdErr: {},
        ruleModal: null, ruleForm: { id: '', name: '', field: 'deathDx', op: 'contains', value: '', deathType: 'unexpected', priority: 5, enabled: true },
        ruleErr: {}, fileKw: '', logs: []
      };
    },
    computed: {
      allIcd: function () {
        App.state.refresh;
        var cs = FHIR.view('CodeSystem', 'CodeSystem-icd10-death');
        var out = [];
        ((cs && cs.concept) || []).forEach(function (g) {
          if (!g || !g.concept) return;
          g.concept.forEach(function (c) {
            var w = ((c.property || []).filter(function (p) { return p.code === 'weight'; })[0] || {}).valueDecimal || 1;
            out.push({ code: c.code, name: c.display, cat: g.display, note: c.definition, weight: w });
          });
        });
        return out;
      },
      icdRows: function () {
        var k = (this.kw || '').toLowerCase();
        var list = this.allIcd.filter(function (i) { return !k || i.code.toLowerCase().indexOf(k) >= 0 || i.name.toLowerCase().indexOf(k) >= 0 || i.cat.indexOf(k) >= 0; });
        this.icdTotalCount = list.length;
        var s = (this.icdPage - 1) * this.icdSize;
        return list.slice(s, s + this.icdSize);
      },
      cats: function () { return V.ICD_GROUPS.map(function (g) { return g.cat; }); },
      rules: function () {
        App.state.refresh;
        var b = FHIR.view('Basic', 'Basic-death-classify-rules');
        return ((b && b.ext.rules) || []).slice().sort(function (a, x) { return (a.priority || 99) - (x.priority || 99); });
      },
      logs2: function () {
        App.state.refresh;
        return Svc.logsOfKind('basedata').concat(Svc.logsOfKind('config')).slice(0, 40);
      },
      total: function () { return this.icdTotalCount || this.allIcd.length; }
    },
    created: function () { this.icdTotalCount = 0; },
    methods: {
      newIcd: function () { this.icdForm = { code: '', name: '', cat: this.cats[0], note: '' }; this.icdErr = {}; this.icdModal = { isNew: true }; },
      editIcd: function (row) { this.icdForm = Object.assign({}, row); this.icdErr = {}; this.icdModal = { isNew: false, code: row.code }; },
      saveIcd: function () {
        var f = this.icdForm, e = {};
        if (!f.code || f.code.length > 20) e.code = 'ICD-10 编码不能为空（1-20 字符）';
        if (!f.name || f.name.length > 100) e.name = '编码名称不能为空（1-100 字符）';
        if (!f.cat) e.cat = '请选择编码所属分类';
        if ((f.note || '').length > 500) e.note = '说明备注最多 500 字符';
        if (!e.code && this.icdModal.isNew && this.allIcd.some(function (x) { return x.code === f.code; })) e.code = '该编码已存在';
        this.icdErr = e;
        if (Object.keys(e).length) return;
        this.writeIcd(this.icdModal.isNew ? 'add' : 'update', f);
        this.icdModal = null;
        App.toast(this.icdModal ? '' : ('ICD-10 编码已' + (this.allIcd.length ? '保存' : '保存') + '，共 ' + this.allIcd.length + ' 条'));
        App.bump();
      },
      async delIcd(row) {
        var okc = await App.ask('确认删除该 ICD-10 编码？删除后影响病例自动分类。', { title: '删除编码', danger: true, okText: '删除' });
        if (!okc) return;
        this.writeIcd('delete', row);
        App.toast('已删除编码 ' + row.code);
        App.bump();
      },
      writeIcd: function (op, f) {
        var cs = FHIR.view('CodeSystem', 'CodeSystem-icd10-death');
        var concepts = JSON.parse(JSON.stringify(cs.concept || []));
        function find(cat) {
          for (var i = 0; i < concepts.length; i++) if (concepts[i].display === cat) return concepts[i];
          var g = { code: 'CAT-' + cat, display: cat, definition: cat, concept: [] };
          concepts.push(g); return g;
        }
        if (op === 'delete') {
          concepts.forEach(function (g) { g.concept = (g.concept || []).filter(function (c) { return c.code !== f.code; }); });
        } else {
          var g = find(f.cat);
          g.concept = (g.concept || []).filter(function (c) { return c.code !== f.code; });
          g.concept.push({
            code: f.code, display: f.name, definition: f.note || '',
            property: [{ code: 'weight', valueDecimal: 1, valueString: '1' }, { code: 'cat', valueCode: f.cat }]
          });
        }
        FHIR.update(Object.assign({}, cs, { concept: concepts }));
        Svc.prov('basedata', null, App.user(), '');
        FHIR.create({
          resourceType: 'Provenance',
          activity: { coding: [{ system: V.SYS + 'provenance-activity', code: 'basedata', display: '基础数据变更' }], text: '基础数据变更' },
          recorded: new Date().toISOString(),
          reason: [{ text: (op === 'add' ? '新增' : op === 'update' ? '修改' : '删除') + ' ICD-10 编码：' + f.code + ' ' + (f.name || '') }],
          agent: [{ who: { reference: 'Practitioner/' + App.user().practitioner, display: App.user().name } }],
          entity: [{ role: 'source', what: { reference: 'CodeSystem/CodeSystem-icd10-death', display: 'ICD-10 死亡原因编码' } }],
          ext: { activity: 'basedata', note: (op === 'add' ? '新增' : op === 'update' ? '修改' : '删除') + ' ICD-10 编码 ' + f.code, bizKind: 'code', bizId: 'CodeSystem-icd10-death', operatorName: App.user().name }
        });
      },
      newRule: function () {
        this.ruleForm = { id: 'CR-' + String(this.rules.length + 1).padStart(2, '0'), name: '', field: 'deathDx', op: 'contains', value: '', deathType: 'unexpected', priority: this.rules.length + 1, enabled: true };
        this.ruleErr = {}; this.ruleModal = { isNew: true };
      },
      editRule: function (r) {
        this.ruleForm = {
          id: r.id, name: r.name, field: r.match.field, op: r.match.op,
          value: Array.isArray(r.match.value) ? r.match.value.join('、') : r.match.value,
          deathType: r.deathType, priority: r.priority, enabled: r.enabled !== false
        };
        this.ruleErr = {}; this.ruleModal = { isNew: false, id: r.id };
      },
      saveRule: function () {
        var f = this.ruleForm, e = {};
        if (!f.name || f.name.length > 100) e.name = '规则名称不能为空（1-100 字符）';
        if (!f.value || String(f.value).length < 2) e.value = '匹配条件不能为空（10-1000 字符）';
        if (!f.deathType) e.deathType = '请选择匹配输出死亡类型';
        this.ruleErr = e;
        if (Object.keys(e).length) return;
        var b = FHIR.view('Basic', 'Basic-death-classify-rules');
        var list = JSON.parse(JSON.stringify(b.ext.rules || []));
        var value = f.op === 'contains' ? String(f.value).split(/[、,，\/]/).map(function (x) { return x.trim(); }).filter(Boolean) : (f.op === 'bool' ? (f.value === 'true' || f.value === true) : +f.value);
        var item = { id: f.id, name: f.name, deathType: f.deathType, enabled: f.enabled, priority: +f.priority, match: { field: f.field, op: f.op, value: value }, note: f.name + ' → ' + D.deathTypeName(f.deathType) };
        var i = list.findIndex(function (x) { return x.id === f.id; });
        if (i >= 0) list[i] = item; else list.push(item);
        FHIR.update(Object.assign({}, b, { ext: Object.assign({}, b.ext, { rules: list }) }));
        global.Classify && global.Classify.rules && (function () { })();
        FHIR.create({
          resourceType: 'Provenance',
          activity: { coding: [{ system: V.SYS + 'provenance-activity', code: 'basedata', display: '基础数据变更' }], text: '基础数据变更' },
          recorded: new Date().toISOString(),
          reason: [{ text: (this.ruleModal.isNew ? '新增' : '修改') + '自动分类规则：' + f.name }],
          agent: [{ who: { reference: 'Practitioner/' + App.user().practitioner, display: App.user().name } }],
          entity: [{ role: 'source', what: { reference: 'Basic/Basic-death-classify-rules', display: '死亡类型自动分类规则' } }],
          ext: { activity: 'basedata', note: '规则 ' + f.id + ' ' + f.name + ' → ' + D.deathTypeName(f.deathType), bizKind: 'basic', bizId: 'Basic-death-classify-rules', operatorName: App.user().name }
        });
        this.ruleModal = null;
        App.toast('分类规则已保存，新进入的死亡病例将按该规则自动分类');
        App.bump();
      },
      async delRule(r) {
        var okc = await App.ask('确认删除该自动分类规则，会影响死亡病例自动识别。', { title: '删除分类规则', danger: true, okText: '删除' });
        if (!okc) return;
        var b = FHIR.view('Basic', 'Basic-death-classify-rules');
        var list = (b.ext.rules || []).filter(function (x) { return x.id !== r.id; });
        FHIR.update(Object.assign({}, b, { ext: Object.assign({}, b.ext, { rules: list }) }));
        App.toast('已删除规则 ' + r.name);
        App.bump();
      },
      toggleRule: function (r) {
        var b = FHIR.view('Basic', 'Basic-death-classify-rules');
        var list = (b.ext.rules || []).map(function (x) { return x.id === r.id ? Object.assign({}, x, { enabled: x.enabled === false }) : x; });
        FHIR.update(Object.assign({}, b, { ext: Object.assign({}, b.ext, { rules: list }) }));
        App.bump();
      },
      exportIcd: function () {
        Svc.exportCsv('ICD10死亡原因编码.csv', ['编码', '名称', '分类', '说明'], this.allIcd.map(function (i) { return [i.code, i.name, i.cat, i.note]; }));
        App.toast('已导出 ICD-10 编码（' + this.allIcd.length + ' 条）');
        App.bump();
      },
      exportRules: function () {
        Svc.exportCsv('死亡类型自动分类规则.csv', ['规则编号', '规则名称', '匹配字段', '匹配方式', '匹配值', '输出死亡类型', '优先级', '状态'],
          this.rules.map(function (r) { return [r.id, r.name, r.match.field, r.match.op, Array.isArray(r.match.value) ? r.match.value.join('、') : r.match.value, D.deathTypeName(r.deathType), r.priority, r.enabled === false ? '停用' : '启用']; }));
        App.toast('已导出分类规则');
        App.bump();
      },
      downloadTpl: function () {
        Svc.exportCsv('ICD10批量导入模板.csv', ['编码', '名称', '分类', '说明'], [['I99.9', '示例：循环系统疾病', '循环系统疾病', '导入前请删除示例行']]);
        App.toast('已下载导入模板（xlsx 可用 Excel 打开另存）');
        App.bump();
      },
      async doImport(ev) {
        var files = [].slice.call(ev.target.files || []);
        if (!files.length) { App.toast('请上传 xlsx / csv 格式导入模板文件', 'error'); return; }
        var okc = await App.ask('确认执行批量导入，将覆盖冲突条目（编码相同的记录按导入内容更新）。', { title: '批量导入' });
        if (!okc) { ev.target.value = ''; return; }
        var self = this, added = 0;
        var text = await files[0].text();
        text.split(/\r?\n/).slice(1).forEach(function (line) {
          var cols = line.split(',');
          if (cols.length >= 2 && cols[0]) {
            self.writeIcd('add', { code: cols[0].trim(), name: cols[1].trim(), cat: (cols[2] || '其他').trim(), note: (cols[3] || '').trim() });
            added++;
          }
        });
        ev.target.value = '';
        App.toast('批量导入完成，共处理 ' + added + ' 条编码');
        App.bump();
      },
      typeName: function (t) { return D.deathTypeName(t); },
      fieldOptions: function () {
        return [['deathDx', '死亡诊断文本'], ['icdCat', 'ICD 大类'], ['losHours', '住院时长(小时)'], ['daysSinceSurgery', '术后天数'], ['age', '年龄'], ['suddenDeath', '突然死亡'], ['rescueFailed', '抢救无效'], ['hasDispute', '存在医疗纠纷'], ['terminal', '慢性病终末期'], ['signedWaiver', '签署放弃抢救']];
      }
    },
    template: `
    <div>
      <div class="page-head"><div><h1>🗂 基础数据管理</h1>
        <div class="desc">维护 ICD-10 死亡原因编码与死亡类型自动分类规则（FHIR CodeSystem / Basic 资源），支持增删改查、批量导入导出与变更留痕</div></div></div>

      <div class="card">
        <div class="tabs-top">
          <div class="t" :class="{active: tab===0}" @click="tab=0">ICD-10 死亡原因编码<span class="n">（{{ total }}）</span></div>
          <div class="t" :class="{active: tab===1}" @click="tab=1">死亡类型自动分类规则<span class="n">（{{ rules.length }}）</span></div>
          <div class="t" :class="{active: tab===2}" @click="tab=2">操作日志</div>
        </div>

        <!-- ICD-10 -->
        <div class="card-body" v-show="tab===0">
          <div class="filter-bar mb12">
            <div class="field" style="flex:1;min-width:240px"><label>按编码 / 名称 / 分类搜索</label>
              <input type="text" v-model="kw" @input="icdPage=1" placeholder="如 I21、心肌梗死、恶性肿瘤"></div>
            <div class="btn-row">
              <button class="btn primary sm" @click="newIcd">＋ 新增 ICD-10 编码</button>
              <button class="btn sm" @click="exportIcd">全部数据导出</button>
            </div>
          </div>
          <div class="table-wrap" style="max-height:52vh;overflow:auto">
            <table class="tbl">
              <thead><tr><th>ICD-10 编码</th><th>名称</th><th>分类</th><th>说明备注</th><th style="width:120px">操作</th></tr></thead>
              <tbody>
                <tr v-for="i in icdRows" :key="i.code">
                  <td class="mono"><b>{{ i.code }}</b></td><td>{{ i.name }}</td>
                  <td><span class="tag blue">{{ i.cat }}</span></td>
                  <td class="small muted">{{ i.note }}</td>
                  <td class="actions"><button class="btn-link" @click="editIcd(i)">编辑</button><button class="btn-link danger" @click="delIcd(i)">删除</button></td>
                </tr>
              </tbody>
            </table>
            <empty-state v-if="!icdRows.length" text="暂无 ICD-10 编码数据" icon="🗂" sub="调整搜索关键词，或新增编码。"></empty-state>
          </div>
          <ui-pager :total="total" v-model:page="icdPage" v-model:size="icdSize"></ui-pager>
          <div class="divider-label">批量导入 / 导出</div>
          <div class="row">
            <button class="btn sm" @click="downloadTpl">下载导入模板</button>
            <label class="btn sm" style="cursor:pointer">选择 xlsx / csv 文件批量导入<input type="file" accept=".xlsx,.csv,.txt" style="display:none" @change="doImport"></label>
            <span class="small muted">导入规则：以「编码」为唯一键，存在即覆盖更新；导入操作写入变更日志。</span>
          </div>
        </div>

        <!-- 分类规则 -->
        <div class="card-body" v-show="tab===1">
          <div class="row between mb12">
            <div class="small muted">按优先级顺序匹配（数字越小越先判定）；命中即输出对应死亡类型，全部未命中则标记「待人工判定」并通知医务部复核（US-1.1 AC2/AC6）。</div>
            <div class="btn-row"><button class="btn primary sm" @click="newRule">＋ 新增分类规则</button>
              <button class="btn sm" @click="exportRules">导出</button></div>
          </div>
          <table class="tbl">
            <thead><tr><th style="width:64px">优先级</th><th>规则编号</th><th>规则名称</th><th>匹配条件</th><th>输出死亡类型</th><th>启用</th><th style="width:130px">操作</th></tr></thead>
            <tbody>
              <tr v-for="r in rules" :key="r.id">
                <td><span class="rank">{{ r.priority }}</span></td>
                <td class="mono small">{{ r.id }}</td>
                <td><b>{{ r.name }}</b></td>
                <td class="small">{{ r.match.field }} {{ opText(r) }} {{ valText(r) }}</td>
                <td><span class="tag" :class="Dcls(r.deathType)">{{ typeName(r.deathType) }}</span></td>
                <td><label class="switch"><input type="checkbox" :checked="r.enabled!==false" @change="toggleRule(r)"><span class="sl"></span></label></td>
                <td class="actions"><button class="btn-link" @click="editRule(r)">编辑</button><button class="btn-link danger" @click="delRule(r)">删除</button></td>
              </tr>
            </tbody>
          </table>
          <empty-state v-if="!rules.length" text="暂无分类规则" icon="🧠" sub="无规则时所有病例将全部进入待人工判定流程。"></empty-state>
        </div>

        <!-- 日志 -->
        <div class="card-body" v-show="tab===2">
          <table class="tbl dense" v-if="logs2.length">
            <thead><tr><th>操作人</th><th>操作时间</th><th>变更内容摘要</th></tr></thead>
            <tbody><tr v-for="(l,i) in logs2" :key="i"><td>{{ l.by }}</td><td class="small">{{ l.at }}</td><td>{{ l.note || l.act }}</td></tr></tbody>
          </table>
          <empty-state v-else text="暂无操作日志" icon="🧾"></empty-state>
        </div>
      </div>

      <ui-modal v-if="icdModal" :title="icdModal.isNew ? '新增 ICD-10 死亡原因编码' : '编辑 ICD-10 编码'" @close="icdModal=null">
        <div class="form-row"><label class="req">ICD-10 编码</label><div class="ctrl">
          <input type="text" v-model="icdForm.code" maxlength="20" :disabled="!icdModal.isNew" :class="{invalid: icdErr.code}">
          <div class="err-text" v-if="icdErr.code">{{ icdErr.code }}</div></div></div>
        <div class="form-row"><label class="req">编码名称</label><div class="ctrl">
          <input type="text" v-model="icdForm.name" maxlength="100" :class="{invalid: icdErr.name}">
          <div class="err-text" v-if="icdErr.name">{{ icdErr.name }}</div></div></div>
        <div class="form-row"><label class="req">编码分类</label><div class="ctrl">
          <select v-model="icdForm.cat" :class="{invalid: icdErr.cat}">
            <option value="">请选择</option><option v-for="c in cats" :value="c">{{ c }}</option>
          </select><div class="err-text" v-if="icdErr.cat">{{ icdErr.cat }}</div></div></div>
        <div class="form-row vertical"><label>说明备注</label><div class="ctrl">
          <textarea v-model="icdForm.note" rows="2" maxlength="500"></textarea>
          <div class="err-text" v-if="icdErr.note">{{ icdErr.note }}</div></div></div>
        <template #foot><button class="btn" @click="icdModal=null">取消</button><button class="btn primary" @click="saveIcd">保存</button></template>
      </ui-modal>

      <ui-modal v-if="ruleModal" :title="ruleModal.isNew ? '新增自动分类规则' : '编辑分类规则'" @close="ruleModal=null">
        <div class="form-row"><label>规则编号</label><div class="ctrl"><input type="text" v-model="ruleForm.id" :disabled="!ruleModal.isNew"></div></div>
        <div class="form-row"><label class="req">规则名称</label><div class="ctrl">
          <input type="text" v-model="ruleForm.name" maxlength="100" :class="{invalid: ruleErr.name}" placeholder="如：入院 48 小时内死亡">
          <div class="err-text" v-if="ruleErr.name">{{ ruleErr.name }}</div></div></div>
        <div class="form-row"><label>匹配字段</label><div class="ctrl">
          <select v-model="ruleForm.field"><option v-for="f in fieldOptions()" :key="f[0]" :value="f[0]">{{ f[1] }}</option></select></div></div>
        <div class="form-row"><label>匹配方式</label><div class="ctrl">
          <select v-model="ruleForm.op">
            <option value="contains">包含关键词</option><option value="lte">小于等于</option>
            <option value="gte">大于等于</option><option value="eq">等于</option><option value="bool">布尔为真/假</option>
          </select></div></div>
        <div class="form-row vertical"><label class="req">匹配条件</label><div class="ctrl">
          <input type="text" v-model="ruleForm.value" :class="{invalid: ruleErr.value}"
                 placeholder="包含：多个关键词用、分隔；数值：如 48；布尔：true / false">
          <div class="field-help">对应文档 F132 匹配条件（10-1000 字符）</div>
          <div class="err-text" v-if="ruleErr.value">{{ ruleErr.value }}</div></div></div>
        <div class="form-row"><label class="req">输出死亡类型</label><div class="ctrl"><div class="radios">
          <label><input type="radio" value="expected" v-model="ruleForm.deathType"> 预期死亡</label>
          <label><input type="radio" value="unexpected" v-model="ruleForm.deathType"> 非预期死亡</label>
          <label><input type="radio" value="special" v-model="ruleForm.deathType"> 特殊死亡</label>
        </div></div></div>
        <div class="form-row"><label>优先级</label><div class="ctrl"><input type="number" v-model.number="ruleForm.priority" min="1" style="width:100px"></div></div>
        <template #foot><button class="btn" @click="ruleModal=null">取消</button><button class="btn primary" @click="saveRule">保存规则</button></template>
      </ui-modal>
    </div>`,
    created: function () {
      this.Dcls = function (t) { return D.deathTypeCls(t); };
      this.opText = function (r) { return { contains: '包含', lte: '≤', gte: '≥', eq: '=', bool: '为' }[r.match.op] || r.match.op; };
      this.valText = function (r) {
        var v = r.match.value;
        if (Array.isArray(v)) return '「' + v.join('」「') + '」';
        if (r.match.op === 'bool') return v ? '真' : '假';
        return String(v);
      };
    }
  };
})(window);
