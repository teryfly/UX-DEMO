/* =====================================================================
 * pages/discuss-record.js —— L3-1-3 讨论记录书写与签名（WF-L3-1-3 / IA-2.4 / FD-1.5 / IX-2.4）
 * (G) 记录状态栏与书写进度 → (H) 左侧 8 段导航 → (I) 右侧结构化书写区（模板驱动）
 * → 完整性校验缺失清单 → (J) 签名操作栏（CA 数字签名）→ 归档视图
 * 视图态：草稿(主管医师可编辑) / 未填写(他角色只读提示) / 待签名(只读+签名) / 已归档(锁定)
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Limit = global.Limit, Flow = global.Flow;

  global.AMS.pages['discuss-record'] = {
    data: function () {
      return {
        answers: {}, errors: {}, missing: [], showMissing: false,
        confirmRead: false, current: 'm1', autoSaveAt: '', sideDoc: 0, showDocs: true,
        RS: D.RECORD_STATUS, DN: D.DEATH_TYPES
      };
    },
    computed: {
      user: function () { return App.user(); },
      encId: function () { return App.state.params && App.state.params.id; },
      view: function () { App.state.refresh; App.state.clock; return this.encId ? Svc.recordView(this.encId) : null; },
      c: function () { return this.view ? this.view.c : null; },
      detail: function () { App.state.refresh; return this.encId ? Svc.discussDetail(this.encId) : null; },
      modules: function () { return this.view && this.view.template ? this.view.template.item : []; },
      status: function () { return this.view ? this.view.status : 'none'; },
      lock: function () { return this.view ? this.view.lock : 'none'; },
      readonly: function () { return this.lock !== 'none'; },
      canEdit: function () { return (App.can('attending|director')) && (this.status === 'draft' || this.status === 'none'); },
      progress: function () {
        App.state.refresh;
        if (!this.view) return { groups: [], pct: 0 };
        return Svc.moduleProgress({ item: this.buildItems(this.answers), status: 'draft', ext: { draftMeta: {}, respondentName: '' } }, 'record');
      },
      steps: function () { return this.detail ? this.detail.steps : []; },
      signers: function () { return this.detail ? this.detail.signers : { required: [], optional: [], signedRequired: 0, totalRequired: 0, signedOptional: 0, totalOptional: 0 }; },
      moduleTitles: function () {
        var self = this;
        return this.modules.map(function (m) {
          var g = (self.progress.groups || []).filter(function (x) { return x.id === m.linkId; })[0] || { filled: 0, total: 0, done: false };
          return { id: m.linkId, title: m.text, done: g.done, filled: g.filled, total: g.total };
        });
      },
      archived: function () { return this.status === 'archived'; },
      improveCount: function () { return this.c ? (this.c.improveTasks || []).length : 0; },
      docs: function () { return this.detail ? this.detail.docs : []; }
    },
    methods: {
      moduleName: function (id) { return D.docTypeName(id); },
      /* 把编辑中的 answers 组装成 QuestionnaireResponse.item，供书写进度实时计算 */
      buildItems: function (ans) {
        var items = [];
        this.modules.forEach(function (m) {
          var children = [];
          (m.item || []).forEach(function (fd) {
            if (fd.type === 'group') {
              var rows = (ans[fd.linkId] || []).map(function (row) {
                return { item: (fd.item || []).map(function (c) {
                  return Object.assign({ linkId: c.linkId, text: c.text }, Svc.valueOfField(c.type, row[c.linkId]));
                }) };
              });
              children.push({ linkId: fd.linkId, text: fd.text, type: 'group', repeats: true, item: rows });
              return;
            }
            children.push(Object.assign({ linkId: fd.linkId, text: fd.text }, Svc.valueOfField(fd.type, ans[fd.linkId])));
          });
          items.push({ linkId: m.linkId, text: m.text, type: 'group', item: children });
        });
        return items;
      },
      init: function () {
        var src = (this.view && this.view.answers) || {};
        var ans = {};
        var self = this;
        this.modules.forEach(function (m) {
          (m.item || []).forEach(function (fd) {
            if (fd.type === 'group') {
              ans[fd.linkId] = (src[fd.linkId] || []).map(function (row) {
                var o = {};
                (fd.item || []).forEach(function (c) { o[c.linkId] = row[c.linkId] || ''; });
                return o;
              });
              return;
            }
            ans[fd.linkId] = src[fd.linkId] != null ? src[fd.linkId] : (fd.extension || []).some(function (e) { return /prefilled/.test(e.url); }) ? '' : '';
          });
        });
        // 预填充模块①②（EMR 带入）
        if (this.c) {
          var d = this.detail;
          if (!ans['m1.name']) ans['m1.name'] = this.c.name;
          if (!ans['m1.age']) ans['m1.age'] = this.c.age + '岁';
          if (!ans['m1.gender']) ans['m1.gender'] = this.c.gender;
          if (!ans['m1.mrn']) ans['m1.mrn'] = this.c.mrn;
          if (!ans['m1.admitDate']) ans['m1.admitDate'] = Limit.donly(this.c.admitMs);
          if (!ans['m1.deathDate']) ans['m1.deathDate'] = Limit.donly(this.c.deathMs);
          if (!ans['m1.los']) ans['m1.los'] = this.c.losDays + '天';
          if (!ans['m2.admitDx'] && d) ans['m2.admitDx'] = this.c.admitDx;
          if (!ans['m2.deathDx'] && d) ans['m2.deathDx'] = (this.c.deathDx || '').split('，')[0];
          if (!ans['m2.concordance'] && this.c.concordance) ans['m2.concordance'] = D.concordanceName(this.c.concordance);
          if (!ans['m4.rootCause']) ans['m4.rootCause'] = (this.c.deathDx || '').split('，')[0];
          if (!ans['m4.directCause']) ans['m4.directCause'] = this.c.avoidable ? '' : '';
        }
        this.answers = ans;
      },
      prefilled: function (fd) { return (fd.extension || []).some(function (e) { return /prefilled/.test(e.url); }); },
      minLen: function (fd) { var e = (fd.extension || []).filter(function (x) { return /minLength$/.test(x.url); })[0]; return e ? e.valueInteger : null; },
      enabled: function (fd) {
        if (!fd.enableWhen) return true;
        var q = fd.enableWhen[0];
        return this.answers[q.question] === (q.answerString != null ? q.answerString : q.answerCode);
      },
      optList: function (fd) {
        return (fd.answerOption || []).map(function (o) {
          return o.valueCoding ? { code: o.valueCoding.code, name: o.valueCoding.display || o.valueCoding.code } : { code: o.valueString, name: o.valueString };
        });
      },
      people: function (dept) { return Svc.people(dept); },
      addRow: function (fd) {
        var row = {};
        (fd.item || []).forEach(function (c) { row[c.linkId] = ''; });
        if (fd.linkId === 'm8.measures' && this.c) { row['m8.owner'] = this.c.attending; row['m8.due'] = Limit.donly(Date.now() + 15 * 86400000); }
        this.answers[fd.linkId] = (this.answers[fd.linkId] || []).concat([row]);
      },
      delRow: function (fd, i) { this.answers[fd.linkId].splice(i, 1); },
      onField: function () { this.errors = {}; this.showMissing = false; },
      fillSample: function () {
        var s = Svc.sampleAnswers('record', this.encId);
        var self = this;
        this.modules.forEach(function (m) {
          (m.item || []).forEach(function (fd) {
            if (fd.type === 'group') { self.answers[fd.linkId] = s[fd.linkId] || []; return; }
            self.answers[fd.linkId] = s[fd.linkId] != null ? s[fd.linkId] : '';
          });
        });
        this.missing = []; this.showMissing = false; this.errors = {};
        App.toast('已按病例事实填充 8 大模块演示内容，可在此基础上修改');
      },
      save: function (mode) {
        if (!this.canEdit) { App.toast('当前状态不允许编辑记录', 'warn'); return; }
        var r = Svc.saveRecord(this.encId, this.answers, App.user(), mode);
        this.autoSaveAt = Limit.dt(Date.now());
        if (mode === 'draft') { App.toast('已保存草稿（保留全部内容，未触发提交校验）'); this.init(); return; }
        var v = Svc.validateAnswers('record', this.answers);
        if (!v.ok) {
          this.missing = v.missing; this.showMissing = true;
          this.errors = {};
          v.missing.forEach(function (m) { this.errors[m.id] = m.min ? (m.label + '不能为空且不少于 ' + m.min + ' 字符') : (m.label + '不能为空'); }, this);
          App.toast('8 大模块存在 ' + v.missing.length + ' 项缺失，已列出缺失清单并禁止提交', 'error');
          var first = document.getElementById('mod-' + v.missing[0].moduleId);
          if (first && first.scrollIntoView) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        this.showMissing = false;
        App.toast('完整性校验通过，记录已提交，进入签名流程');
        App.bump();
        this.init();
      },
      autoSave: function () {
        if (!this.canEdit) return;
        if (!Object.keys(this.answers).some(function (k) { return this.answers[k] !== ''; }, this)) return;
        Svc.saveRecord(this.encId, this.answers, App.user(), 'draft');
        this.autoSaveAt = Limit.dt(Date.now());
      },
      jump: function (id) {
        this.current = id;
        var el = document.getElementById('mod-' + id);
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      doSign: function () {
        if (!this.confirmRead) { App.toast('请勾选确认阅读记录内容后再签名', 'error'); return; }
        var r = Svc.signRecord(this.encId, App.user());
        if (!r.ok) { App.toast(r.msg, 'error'); return; }
        App.toast('CA 数字签名成功（' + Limit.dt(Date.now()) + '）' + (r.allSigned ? '，全部必签已完成' : ''));
        this.confirmRead = false;
        App.bump();
      },
      async archive() {
        var okConfirm = await App.ask('确认归档讨论记录？归档后记录将锁定不可修改。', {
          title: '提交归档', okText: '确认归档', danger: true,
          detail: '归档后：① 记录写入 EMR 病历；② 发布「死亡病例讨论完成」事件；③ 自动提取模块⑧改进措施生成改进跟踪任务并通知责任人。'
        });
        if (!okConfirm) return;
        var r = Svc.archiveRecord(this.encId, App.user());
        if (!r.ok) { App.toast(r.msg, 'error'); return; }
        App.toast('讨论记录已归档，自动提取并生成 ' + r.created.length + ' 条改进跟踪任务');
        App.navigate('improve-list', {});
      },
      print: function () {
        var self = this;
        var html = '<h1>' + (this.c ? this.c.name : '') + ' 死亡病例讨论记录</h1>';
        this.modules.forEach(function (m) {
          html += '<h2>' + m.text + '</h2><table>';
          (m.item || []).forEach(function (fd) {
            if (fd.type === 'group') {
              var rows = self.answers[fd.linkId] || [];
              html += '<tr><td colspan="2">' + fd.text + '</td></tr>';
              rows.forEach(function (r, i) {
                html += '<tr><td>' + (i + 1) + '</td><td>' + Object.keys(r).map(function (k) { return k + '=' + r[k]; }).join('；') + '</td></tr>';
              });
              return;
            }
            html += '<tr><th style="width:26%">' + fd.text + '</th><td>' + (self.answers[fd.linkId] || '') + '</td></tr>';
          });
          html += '</table>';
        });
        if (Svc.printHtml(html)) App.toast('已调起打印预览'); else App.toast('当前环境不支持打印', 'warn');
      },
      val: function (fd) {
        var v = this.answers[fd.linkId];
        return v === undefined || v === null ? '' : v;
      },
      goDetail: function () { App.goCase('discuss-detail', this.encId); },
      goImprove: function () { App.navigate('improve-list', {}); },
      goList: function () { App.navigate('discuss-list', {}); }
    },
    created: function () {
      this.init();
      var self = this;
      this.timer = setInterval(function () { self.autoSave(); }, 45000);
    },
    unmounted: function () { if (this.timer) clearInterval(this.timer); },
    template: `
    <div v-if="!view || !c">
      <div class="card"><div class="card-body">
        <empty-state text="未找到该讨论记录" icon="🔍" sub="请先在讨论管理列表中选择一条讨论任务。">
          <button class="btn" @click="goList">返回讨论管理</button>
        </empty-state>
      </div></div>
    </div>
    <div v-else>
      <div class="page-head">
        <div>
          <h1>{{ c.name }} 死亡病例讨论记录</h1>
          <div class="desc">8 大模块结构化书写 · 完整性校验 · CA 电子签名 · 归档至 EMR 并自动生成改进跟踪任务</div>
        </div>
        <div class="btn-row">
          <button class="btn" @click="goDetail">‹ 讨论任务详情</button>
          <button class="btn" @click="showDocs=!showDocs">{{ showDocs ? '隐藏' : '参考' }}病历资料</button>
        </div>
      </div>

      <!-- (C) 进度步骤条 -->
      <div class="card"><div class="card-body">
        <div class="row between mb12">
          <span class="strong small">讨论进度</span>
          <countdown-text :cd="c.discussCountdown" :show-deadline="true"></countdown-text>
        </div>
        <steps-bar :steps="steps" small="true"></steps-bar>
      </div></div>

      <!-- (G) 记录状态栏 -->
      <div class="card"><div class="card-body" style="padding:12px 16px">
        <div class="row" style="gap:18px">
          <span>记录状态：<dict-tag :list="RS" :value="status"></dict-tag></span>
          <span class="small muted">讨论日期：{{ c.qrRecord && c.qrRecord.ext.draftMeta ? c.qrRecord.ext.draftMeta.discussDate : (detail && detail.appt ? dd(detail.appt.start) : dd(c.deathMs)) }}</span>
          <span class="small muted">地点：{{ c.qrRecord && c.qrRecord.ext.draftMeta ? c.qrRecord.ext.draftMeta.location : '示教室' }}</span>
          <span class="small muted">主持人：{{ detail && detail.appt ? detail.appt.ext.partyMeta.filter(p=>p.role==='科主任')[0].name : '—' }}</span>
          <span class="small muted">记录整理：{{ user.name }}</span>
          <span class="spacer" style="flex:1"></span>
          <span class="row" style="min-width:220px"><span class="small muted">书写进度</span>
            <progress-bar :value="progress.pct" :kind="progress.pct===100?'green':''" style="flex:1;min-width:110px"></progress-bar>
          </span>
        </div>
        <div class="alert warn mt8 mb0" v-if="canEdit"><span>⚠️</span><div>8 个段落均为必填项，全部填写完成后方可「提交签名」；提交后进入签名流程，内容将被锁定。</div></div>
        <div class="alert success mt8 mb0" v-if="archived"><span>✅</span><div>全部必签人员已签名，讨论记录已归档至 EMR 病历系统，记录锁定不可修改。</div></div>
        <div class="alert success mt8 mb0" v-if="archived && improveCount"><span>✅</span><div>改进措施跟踪任务已自动生成（共 {{ improveCount }} 条），可在「改进跟踪」模块查看。<button class="btn-link" @click="goImprove">前往查看</button></div></div>
      </div></div>

      <!-- 缺失清单 -->
      <div class="card" v-if="showMissing && missing.length">
        <div class="card-head"><h4>❌ 完整性校验未通过（{{ missing.length }} 项缺失）</h4>
          <span class="hint small">系统已禁止提交，请逐项补充</span></div>
        <div class="card-body">
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <span class="tag red" v-for="(m,i) in missing" :key="i" style="cursor:pointer" @click="jump(m.moduleId)">
              {{ m.module }} › {{ m.label }}{{ m.min ? '（不少于 ' + m.min + ' 字）' : '' }}
            </span>
          </div>
        </div>
      </div>

      <div class="record-layout">
        <!-- (H) 左侧段落导航 -->
        <div class="record-nav">
          <div class="side-nav">
            <div class="sn" v-for="m in moduleTitles" :key="m.id" :class="{active: current===m.id}" @click="jump(m.id)">
              {{ m.title }}
              <span class="ok" v-if="m.done">✅</span>
              <span class="cur" v-else-if="m.filled">◐ {{ m.filled }}/{{ m.total }}</span>
              <span class="todo" v-else>☐</span>
            </div>
          </div>
          <div class="alert plain mt8"><span>🧭</span><div class="small">点击段落可快速跳转；✅ 已填写完整，◐ 部分填写，☐ 未填写。</div></div>
          <div class="card" v-if="archived"><div class="card-body small">全部段落已归档 📁<div class="muted mt4">归档时间：{{ c.comp && c.comp.ext.archivedAt ? dt(Date.parse(c.comp.ext.archivedAt)) : '—' }}</div></div></div>

          <!-- 病历资料参考 -->
          <div class="card" v-if="showDocs">
            <div class="card-head"><h4 class="small">📄 病历资料参考</h4></div>
            <div class="card-body" style="padding:8px">
              <div class="side-nav">
                <div class="sn" v-for="(doc,i) in docs" :key="doc.id" :class="{active: sideDoc===i}" @click="sideDoc=i">
                  <span>{{ doc.error ? '⚠' : '📄' }}</span>{{ doc.name }}
                </div>
              </div>
              <div class="doc-paper mt8" style="max-height:240px;font-size:12px;line-height:1.85">{{ docs[sideDoc] ? (docs[sideDoc].content || '（接口异常，无内容）') : '暂无病历资料' }}</div>
            </div>
          </div>
        </div>

        <!-- (I) 右侧书写区 -->
        <div class="record-main">
          <div v-if="status==='none' && !canEdit">
            <empty-state text="📝 暂无讨论记录" icon="🗂"
              sub="主管医师尚未完成讨论记录书写，当前无法查看或签名。记录提交后系统将通知所有参会人员签名。"></empty-state>
          </div>
          <div v-else>
            <div class="module-block" v-for="m in modules" :key="m.linkId" :id="'mod-'+m.linkId" :class="{error: showMissing && missing.some(x=>x.moduleId===m.linkId)}">
              <div class="mh">{{ m.text }}
                <span class="st" v-if="m.extension && m.extension.length">{{ '' }}</span>
                <span class="st muted small">{{ moduleTitles.find(x=>x.id===m.linkId).done ? '✅ 已填写' : '待填写' }}</span>
              </div>
              <div class="mb">
                <div v-for="fd in m.item" :key="fd.linkId" v-show="enabled(fd)">
                  <!-- 只读（已提交/已归档/无编辑权限） -->
                  <div class="form-row vertical" v-if="readonly || !canEdit">
                    <label>{{ fd.text }}<span class="req" v-if="fd.required"></span></label>
                    <div class="ctrl" v-if="fd.type==='group'">
                      <div class="table-wrap" v-if="(answers[fd.linkId]||[]).length">
                        <table class="table-sub">
                          <thead><tr><th style="width:34px">#</th><th v-for="c in (fd.item||[])" :key="c.linkId">{{ c.text }}</th></tr></thead>
                          <tbody><tr v-for="(r,i) in (answers[fd.linkId]||[])" :key="i"><td>{{ i+1 }}</td><td v-for="c in (fd.item||[])" :key="c.linkId">{{ r[c.linkId] || '——' }}</td></tr></tbody>
                        </table>
                      </div>
                      <div class="muted small" v-else>（未填写）</div>
                    </div>
                    <div class="ctrl" v-else style="line-height:1.9">{{ val(fd) || '——' }}</div>
                  </div>

                  <!-- 可编辑 -->
                  <template v-else>
                    <!-- 重复分组（发言人 / 改进措施） -->
                    <div v-if="fd.type==='group'" class="mb12">
                      <div class="row between mb8">
                        <label class="strong small"><span class="req" v-if="fd.required"></span>{{ fd.text }}</label>
                        <button class="btn sm" @click="addRow(fd)">＋ 添加{{ fd.text }}</button>
                      </div>
                      <div class="card flat" style="margin-bottom:8px" v-for="(row,ri) in (answers[fd.linkId]||[])" :key="ri">
                        <div class="card-body" style="padding:10px 12px">
                          <div class="row between mb8"><b class="small">条目 {{ ri+1 }}</b>
                            <button class="btn-link danger" @click="delRow(fd,ri)">删除</button></div>
                          <div class="form-row" v-for="c in (fd.item||[])" :key="c.linkId" :class="{vertical:['text'].indexOf(c.type)>=0}">
                            <label :class="{req: c.required}">{{ c.text }}</label>
                            <div class="ctrl">
                              <select v-if="c.linkId.indexOf('owner')>=0" v-model="row[c.linkId]" :class="{invalid: errors[c.linkId]}">
                                <option value="">请选择责任人</option>
                                <option v-for="p in people(c.dept || user.dept)" :key="p.pid" :value="p.name">{{ p.name }}（{{ p.scene==='attending'?'主管医师':p.scene==='senior'?'上级医师':p.scene==='director'?'科主任':'科室医师' }}）</option>
                              </select>
                              <input v-else-if="c.type==='date'" type="date" v-model="row[c.linkId]" :class="{invalid: errors[c.linkId]}">
                              <textarea v-else-if="c.type==='text'" v-model="row[c.linkId]" rows="2" :maxlength="c.maxLength||3000"
                                        :class="{invalid: errors[c.linkId]}" @input="onField" :placeholder="'不少于 '+(c.extension&&c.extension[0]?c.extension[0].valueInteger:10)+' 字'"></textarea>
                              <input v-else type="text" v-model="row[c.linkId]" :maxlength="c.maxLength||200" :class="{invalid: errors[c.linkId]}" @input="onField">
                              <div class="err-text" v-if="errors[c.linkId]">{{ errors[c.linkId] }}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div class="muted small" v-if="!(answers[fd.linkId]||[]).length">尚未添加条目，请点击右上角「添加」。</div>
                    </div>

                    <div class="form-row" v-else :class="{vertical: fd.type==='text'}">
                      <label :class="{req: fd.required}">{{ fd.text }}</label>
                      <div class="ctrl">
                        <input v-if="prefilled(fd)" type="text" :value="val(fd)" disabled>
                        <div class="radios" v-else-if="fd.type==='choice'">
                          <label v-for="o in optList(fd)" :key="o.code">
                            <input type="radio" :value="o.name" v-model="answers[fd.linkId]" @change="onField"> {{ o.name }}
                          </label>
                        </div>
                        <textarea v-else-if="fd.type==='text'" v-model="answers[fd.linkId]" rows="3"
                                  :maxlength="fd.maxLength || 4000" :class="{invalid: errors[fd.linkId]}" @input="onField"
                                  :placeholder="(minLen(fd)?('不少于 '+minLen(fd)+' 字'):'') + (fd.maxLength?('，最多 '+fd.maxLength+' 字'):'')"></textarea>
                        <input v-else-if="fd.type==='date'" type="date" v-model="answers[fd.linkId]" :class="{invalid: errors[fd.linkId]}">
                        <select v-else-if="fd.type==='reference'" v-model="answers[fd.linkId]">
                          <option value="">请选择</option>
                          <option v-for="p in people(user.dept)" :key="p.pid" :value="p.name">{{ p.name }}</option>
                        </select>
                        <input v-else type="text" v-model="answers[fd.linkId]" :maxlength="fd.maxLength||200" :class="{invalid: errors[fd.linkId]}" @input="onField">
                        <div class="field-help" v-if="prefilled(fd)">EMR 自动带入，不可修改</div>
                        <div class="field-help" v-else-if="minLen(fd) || fd.maxLength">
                          长度要求：{{ minLen(fd)||1 }} - {{ fd.maxLength||2000 }} 字符，当前 {{ String(val(fd)||'').length }}
                        </div>
                        <div class="err-text" v-if="errors[fd.linkId]">{{ errors[fd.linkId] }}</div>
                      </div>
                    </div>
                  </template>
                </div>
                <div class="text-r" v-if="canEdit"><button class="btn sm" @click="jump(nextModule(m.linkId))">下一段 →</button></div>
              </div>
            </div>

            <!-- (J) 签名操作栏 -->
            <div class="card" v-if="status==='to-sign' || archived">
              <div class="card-head"><h4>✍️ 电子签名（CA 数字证书）</h4>
                <span class="hint small">必签：科主任（主持人）/ 主管医师 / 上级医师；其他参会医师可自愿签名</span></div>
              <div class="card-body">
                <div class="sign-box">
                  <div class="small muted mb8">必签人员</div>
                  <div class="sign-row" v-for="p in signers.required" :key="p.pid">
                    <span style="width:130px"><b>{{ p.name }}</b></span>
                    <span class="tag gray" style="width:140px">{{ p.role }}</span>
                    <span v-if="p.signed" class="green">✅ 已签名</span><span v-else class="muted">⬜ 待签名</span>
                    <span class="muted small" v-if="p.signed">{{ p.time }}</span>
                    <span class="spacer" style="flex:1"></span>
                    <button class="btn sm" v-if="!p.signed && status==='to-sign' && p.pid===user.practitioner" @click="doSign">CA 数字签名</button>
                  </div>
                  <div class="small muted mt8 mb8">其他参会医师（可选）</div>
                  <div class="sign-row" v-for="p in signers.optional" :key="'o'+p.pid">
                    <span style="width:130px">{{ p.name }}</span><span class="tag gray" style="width:140px">{{ p.role }}</span>
                    <span v-if="p.signed" class="green">✅ 已签名</span>
                    <span v-else-if="p.onLeave" class="blue">— 已请假（不纳入签名范围，记录备查）</span>
                    <span v-else class="muted">⬜ 待签名</span>
                    <span class="muted small" v-if="p.signed">{{ p.time }}</span>
                    <span class="spacer" style="flex:1"></span>
                    <button class="btn sm" v-if="!p.signed && !p.onLeave && status==='to-sign' && p.pid===user.practitioner" @click="doSign">自愿签名</button>
                  </div>
                  <div class="row between mt12">
                    <div class="small muted">签名进度：必签 {{ signers.signedRequired }}/{{ signers.totalRequired }} ｜ 可选 {{ signers.signedOptional }}/{{ signers.totalOptional }}</div>
                    <progress-bar v-if="signers.totalRequired" :value="Math.round(signers.signedRequired/signers.totalRequired*100)" style="width:220px" :kind="signers.signedRequired===signers.totalRequired?'green':'warn'"></progress-bar>
                  </div>
                </div>
                <div v-if="canSignNow" class="mt12">
                  <label class="row" style="align-items:center">
                    <input type="checkbox" v-model="confirmRead">
                    <span>我已仔细阅读并确认以上讨论记录全部内容（签名前必须勾选）</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部固定操作栏 -->
      <div class="card"><div class="card-body">
        <div class="row between">
          <div class="small muted">
            <template v-if="canEdit">自动保存草稿：{{ autoSaveAt ? dt(new Date(autoSaveAt).getTime()) : '编辑中将在 45 秒内自动保存' }}</template>
            <template v-else-if="archived">讨论记录已归档，不可修改。</template>
            <template v-else>当前为只读/签名状态。</template>
          </div>
          <div class="btn-row">
            <button class="btn" @click="fillSample" v-if="canEdit">🧪 填充演示内容</button>
            <button class="btn" @click="save('draft')" v-if="canEdit">保存草稿</button>
            <lock-btn v-if="canEdit" label="提交签名" cls="primary" :ok="progress.pct>0" reason="记录内容为空" @click="save('submit')"></lock-btn>
            <lock-btn v-if="status==='to-sign' && can('attending')" label="提交归档" cls="primary"
                      :ok="signers.totalRequired>0 && signers.signedRequired===signers.totalRequired"
                      :reason="'必签人员尚未全部完成签名（'+signers.signedRequired+'/'+signers.totalRequired+'）'" @click="archive"></lock-btn>
            <button class="btn" @click="print" v-if="status==='to-sign'||archived">🖨 打印记录</button>
          </div>
        </div>
      </div></div>
    </div>`,
    methodsX: {}
  };
  var pg = global.AMS.pages['discuss-record'];
  Object.assign(pg.computed, {
    canSignNow: function () {
      if (this.status !== 'to-sign') return false;
      var pid = App.user().practitioner;
      return this.signers.required.concat(this.signers.optional).some(function (p) { return p.pid === pid && !p.signed; });
    }
  });
  Object.assign(pg.methods, {
    nextModule: function (id) {
      var ids = this.modules.map(function (m) { return m.linkId; });
      var i = ids.indexOf(id);
      return ids[Math.min(ids.length - 1, i + 1)];
    },
    dd: function (v) { return Limit.donly(v); },
    dt: function (v) { return Limit.dt(v); }
  });
  delete pg.methodsX;
})(window);
