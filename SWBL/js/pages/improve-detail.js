/* =====================================================================
 * pages/improve-detail.js —— L3-3-2 改进任务详情（WF-L3-3-2 / IA-2.8 / FD-1.9 / IX-2.8~2.10）
 * (C) 基础信息（科主任可编辑自动提取内容）→ (D) 执行进度 + 执行记录 + 完成报告
 * → (E) 效果评估（3 维度 + 优秀措施）→ (F) PDCA 关联任务 → 任务状态变更日志
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Limit = global.Limit;

  global.AMS.pages['improve-detail'] = {
    data: function () {
      return {
        editMode: false, evalMode: false, showAdd: false,
        form: { text: '', owner: '', due: '', expected: '' },
        exec: { text: '', files: [] },
        rep: { summary: '', effect: '', files: [] },
        ev: { implemented: '', effective: '', needContinue: '', opinion: '', excellent: false },
        errs: {},
        IS: D.IMPROVE_STATUS
      };
    },
    computed: {
      user: function () { return App.user(); },
      id: function () { return App.state.params && App.state.params.id; },
      d: function () { App.state.refresh; App.state.clock; return this.id ? Svc.improveDetail(this.id) : null; },
      c: function () { return this.d ? this.d.c : null; },
      isOwner: function () { return this.d && this.d.owner === App.user().name; },
      canEditTask: function () { return App.can('director') && this.d && this.d.biz === 'not-started'; },
      canExec: function () { return this.isOwner && this.d && ['not-started', 'in-progress'].indexOf(this.d.biz) >= 0; },
      canEval: function () { return App.can('director') && this.d && this.d.biz === 'to-evaluate'; },
      readonly: function () { return !this.canExec && !this.canEval && !this.editMode; },
      execRecords: function () {
        if (!this.d) return [];
        return this.d.records.slice().reverse().map(function (r) {
          return { title: r.by, at: r.at, text: r.text, level: 'ok' };
        });
      },
      logs: function () {
        if (!this.d) return [];
        return this.d.logs.map(function (l) {
          return { title: l.by + ' · ' + l.act, at: l.at, text: l.note, level: 'gray' };
        });
      },
      related: function () {
        if (!this.d || !this.d.history) return [];
        return this.d.history.filter(function (h) { return h.id !== this.id; }, this)
          .map(function (h) { return { id: h.id, round: h.round, biz: h.biz, text: h.text, owner: h.owner }; });
      },
      evalItems: function () {
        if (!this.d || !this.d.evaluation) return [];
        var e = this.d.evaluation;
        return [
          { label: '措施是否落实', value: e.implemented && e.implemented.text },
          { label: '效果是否达到预期', value: e.effective && e.effective.text },
          { label: '是否需要持续改进', value: e.needContinue && e.needContinue.text },
          { label: '评估意见', value: e.opinion },
          { label: '是否标记优秀措施', value: e.excellent ? '是（可全院推广）' : '否' }
        ];
      },
      progress: function () { return this.d ? this.d.progress : 0; }
    },
    created: function () {
      var p = App.state.params || {};
      if (p.mode === 'evaluate') this.evalMode = true;
    },
    methods: {
      back: function () { App.navigate('improve-list', {}); },
      startEdit: function () {
        this.form = { text: this.d.text, owner: this.d.owner, due: Limit.donly(this.d.dueMs), expected: this.d.expected };
        this.editMode = true;
      },
      submitEdit: async function () {
        var e = {};
        if (!this.form.text || this.form.text.length < 10) e.text = '改进措施内容不能为空（10-500 字符）';
        if (!this.form.owner) e.owner = '请选择责任人';
        if (!this.form.due) e.due = '请选择完成时限';
        else if (Date.parse(this.form.due) <= Limit.parse(this.d.task.authoredOn || this.d.task.lastModified)) e.due = '完成时限不能早于任务创建日期';
        if (!this.form.expected || this.form.expected.length < 10) e.expected = '预期效果不能为空（10-500 字符）';
        this.errs = e;
        if (Object.keys(e).length) { App.toast('表单校验未通过', 'error'); return; }
        var okc = await App.ask('保存任务修改，将推送通知给任务责任人', { title: '保存编辑任务' });
        if (!okc) return;
        Svc.updateImprove(this.id, this.form, App.user());
        this.editMode = false;
        App.toast('任务已更新，并已向新责任人推送任务通知');
        App.bump();
      },
      addExec: function () {
        if (!this.exec.text || this.exec.text.length < 10) { this.errs.exec = '执行情况记录不能为空（10-2000 字符）'; App.toast('执行情况记录不能为空', 'error'); return; }
        this.errs = {};
        Svc.addExecNote(this.id, { text: this.exec.text, files: this.exec.files }, App.user());
        this.exec = { text: '', files: [] };
        App.toast('已追加执行记录，任务进度同步更新');
        App.bump();
      },
      onFiles: function (ev, target) {
        var fs = [].slice.call(ev.target.files || []).map(function (f) { return { name: f.name, size: (f.size / 1024).toFixed(0) + ' KB' }; });
        this[target] = fs;
      },
      saveReport: function (submit) {
        if (submit && (!this.rep.summary || this.rep.summary.length < 20)) {
          this.errs.summary = '完成报告内容不能为空（20-3000 字符）';
          App.toast('完成报告内容不能为空', 'error'); return;
        }
        if (submit && !this.d.records.length) { App.toast('至少需要 1 条执行记录后方可提交完成报告', 'warn'); return; }
        this.errs = {};
        var r = Svc.saveCompletion(this.id, { summary: this.rep.summary, effect: this.rep.effect, files: this.rep.files }, App.user(), submit);
        if (submit) {
          App.toast('完成报告已提交，任务转「待评估」并已通知科主任');
          App.navigate('improve-list', {});
        } else App.toast('完成报告草稿已保存');
        App.bump();
      },
      submitEval: async function () {
        var e = {};
        if (!this.ev.implemented) e.implemented = '请选择措施是否落实';
        if (!this.ev.effective) e.effective = '请选择效果是否达到预期';
        if (!this.ev.needContinue) e.needContinue = '请选择是否需要持续改进';
        if (!this.ev.opinion || this.ev.opinion.length < 10) e.opinion = '评估意见不能为空（10-1000 字符）';
        this.errs = e;
        if (Object.keys(e).length) { App.toast('评估字段校验未通过', 'error'); return; }
        var okc = await App.ask('确认提交本次效果评估，评估结果将归档留存；选择需要持续改进会自动生成新一轮改进任务。', { title: '确认评估提交', okText: '提交评估' });
        if (!okc) return;
        var map = { yes: '已落实', partly: '部分落实', no: '未落实' };
        var map2 = { yes: '达到预期', partly: '部分达到', no: '未达到预期' };
        var r = Svc.evaluateImprove(this.id, {
          implemented: this.ev.implemented, implementedText: map[this.ev.implemented],
          effective: this.ev.effective, effectiveText: map2[this.ev.effective],
          needContinue: this.ev.needContinue, opinion: this.ev.opinion, excellent: this.ev.excellent
        }, App.user());
        App.toast(r.ok ? (r.needContinue ? '评估完成：已生成新一轮 PDCA 改进任务' : '评估完成：任务已关闭归档') : '评估提交失败', r.ok ? 'success' : 'error');
        this.evalMode = false;
        App.bump();
      },
      openTask: function (t) { App.navigate('improve-detail', { id: t.id }); },
      goCase: function () { App.goCase('discuss-detail', this.c.encId); },
      goRecord: function () { App.goCase('discuss-record', this.c.encId); },
      bizName: function (v) { return D.improveStatusName(v); }
    },
    template: `
    <div v-if="!d">
      <div class="card"><div class="card-body">
        <empty-state text="未找到该改进任务" icon="🔍" sub="可能不在当前角色的数据范围内。"><button class="btn" @click="back">返回改进跟踪</button></empty-state>
      </div></div>
    </div>
    <div v-else>
      <div class="page-head">
        <div><h1>改进任务详情</h1>
          <div class="desc">
            <span class="tag purple" v-if="d.round>1">第 {{ d.round }} 轮 PDCA</span>
            <dict-tag :list="IS" :value="d.biz"></dict-tag>
            <span class="tag" :class="['done','cancelled'].indexOf(d.biz)>=0?'gray':(d.state==='overdue'?'red':(d.state==='soon'?'yellow':'green'))">{{ ['done','cancelled'].indexOf(d.biz)>=0?'—':d.stateInfo.text }}</span>
            <span class="tag green" v-if="d.excellent">⭐ 优秀措施 · 可全院推广</span>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn" @click="back">‹ 返回列表</button>
          <button class="btn" v-if="canEditTask && !editMode" @click="startEdit">编辑任务</button>
          <button class="btn primary" v-if="canEval && !evalMode" @click="evalMode=true">进入评估</button>
        </div>
      </div>

      <!-- (C) 基础信息 -->
      <div class="card">
        <div class="card-head"><h4>改进任务基础信息</h4>
          <span class="hint small" v-if="editMode">科主任可核对并修正系统自动提取的任务内容</span></div>
        <div class="card-body">
          <template v-if="editMode">
            <div class="form-row vertical"><label class="req">改进措施内容</label><div class="ctrl">
              <textarea v-model="form.text" rows="2" maxlength="500" :class="{invalid: errs.text}"></textarea>
              <div class="err-text" v-if="errs.text">{{ errs.text }}</div></div></div>
            <div class="form-row"><label class="req">责任人</label><div class="ctrl">
              <select v-model="form.owner" :class="{invalid: errs.owner}">
                <option value="">请选择责任人</option>
                <option v-for="p in Svc.people(c.deptName)" :key="p.pid" :value="p.name">{{ p.name }}</option>
              </select><div class="err-text" v-if="errs.owner">{{ errs.owner }}</div></div></div>
            <div class="form-row"><label class="req">完成时限</label><div class="ctrl">
              <input type="date" v-model="form.due" style="width:190px" :class="{invalid: errs.due}">
              <div class="err-text" v-if="errs.due">{{ errs.due }}</div></div></div>
            <div class="form-row vertical"><label class="req">预期效果</label><div class="ctrl">
              <textarea v-model="form.expected" rows="2" maxlength="500" :class="{invalid: errs.expected}"></textarea>
              <div class="err-text" v-if="errs.expected">{{ errs.expected }}</div></div></div>
            <div class="btn-row end"><button class="btn" @click="editMode=false">取 消</button>
              <button class="btn primary" @click="submitEdit">保存编辑任务</button></div>
          </template>
          <template v-else>
            <div class="form-row vertical"><label>改进措施内容</label><div class="ctrl" style="line-height:1.9">{{ d.text }}</div></div>
            <kv-grid :cols="3" :rows="[
              ['所属病例', c.name + ' / ' + c.mrn],
              ['科室', c.deptName],
              ['来源讨论记录', (d.task.basedOn && d.task.basedOn[0]) ? (d.task.basedOn[0].display || '') + '（' + ((d.task.basedOn[0].reference||'').split('/')[1] || '') + '）' : '—'],
              ['责任人', d.owner + (d.owner===user.name ? '（我）' : '')],
              ['完成时限', d.due + '　' + (['done','cancelled'].indexOf(d.biz)>=0 ? '' : d.stateInfo.text)],
              ['任务状态', bizName(d.biz)],
              ['预期效果', d.expected || '——'],
              ['PDCA 轮次', '第 ' + d.round + ' 轮'],
              ['创建方式', d.pdca.createdBy || '系统自动提取']
            ]"></kv-grid>
            <div class="btn-row mt8">
              <button class="btn-link" @click="goCase">查看讨论任务详情</button>
              <button class="btn-link" @click="goRecord">查看来源讨论记录</button>
            </div>
          </template>
        </div>
      </div>

      <!-- 执行进度 -->
      <div class="card"><div class="card-body">
        <div class="row between mb12"><b class="small">任务执行进度跟踪</b><span class="small muted">未开始 → 进行中 → 待评估 → 已完成</span></div>
        <steps-bar :steps="d.steps" small="true"></steps-bar>
        <div class="mt12"><progress-bar :value="progress" :kind="d.biz==='done'?'green':(d.state==='overdue'?'danger':'')"></progress-bar></div>
      </div></div>

      <!-- (D) 执行情况记录 -->
      <div class="card">
        <div class="card-head"><h4>执行情况记录<span class="hint small">（责任人可多次追加，按时间倒序展示）</span></h4>
          <lock-btn label="＋ 添加执行情况" cls="sm" :ok="canExec" :reason="isOwner ? '当前状态无需再补充记录' : '仅任务责任人可记录执行情况'" @click="showAdd=true"></lock-btn></div>
        <div class="card-body">
          <timeline-list v-if="execRecords.length" :items="execRecords"></timeline-list>
          <empty-state v-else text="暂无执行记录" icon="📝" sub="责任人添加执行情况后即可提交完成报告。"></empty-state>
        </div>
      </div>

      <!-- 完成报告 -->
      <div class="card">
        <div class="card-head"><h4>完成报告</h4>
          <span class="hint small" v-if="d.report">责任人 {{ d.report.by }} 提交于 {{ d.report.submittedAt }}</span></div>
        <div class="card-body">
          <template v-if="d.report && !canExec">
            <div class="form-row vertical"><label>完成情况说明</label><div class="ctrl" style="line-height:1.9">{{ d.report.summary }}</div></div>
            <div class="form-row vertical"><label>实际效果描述</label><div class="ctrl" style="line-height:1.9">{{ d.report.effect }}</div></div>
            <div class="form-row vertical"><label>佐证材料</label><div class="ctrl">
              <a v-for="(f,i) in (d.report.attachments||[])" :key="i" class="btn-link" style="margin-right:14px">📎 {{ f.name }}（{{ f.size }}）</a>
              <span class="muted small" v-if="!(d.report.attachments||[]).length">无附件</span></div></div>
          </template>
          <template v-else-if="canExec">
            <div class="form-row vertical"><label class="req">完成情况说明（20-3000 字）</label><div class="ctrl">
              <textarea v-model="rep.summary" rows="3" maxlength="3000" :class="{invalid: errs.summary}" placeholder="例如：已组织两轮全科培训并考核；抽查 40 份病历记录完整率 96%……"></textarea>
              <div class="err-text" v-if="errs.summary">{{ errs.summary }}</div></div></div>
            <div class="form-row vertical"><label class="req">实际效果描述</label><div class="ctrl">
              <textarea v-model="rep.effect" rows="2" maxlength="3000" placeholder="与预期效果对比说明"></textarea></div></div>
            <div class="form-row"><label>佐证材料</label><div class="ctrl">
              <input type="file" multiple @change="onFiles($event,'rep.files')">
              <div class="field-help">单文件 ≤ 10MB，支持 jpg/png/pdf/xlsx，可多文件</div>
              <div class="mt4"><a v-for="(f,i) in rep.files" :key="i" class="btn-link" style="margin-right:12px">📎 {{ f.name }}</a></div></div></div>
            <div class="btn-row end">
              <button class="btn" @click="saveReport(false)">暂存草稿</button>
              <button class="btn primary" @click="saveReport(true)">提交完成报告</button>
            </div>
          </template>
          <empty-state v-else text="尚未提交完成报告" icon="📄"></empty-state>
        </div>
      </div>

      <!-- (E) 效果评估 -->
      <div class="card">
        <div class="card-head"><h4>效果评估<span class="hint small">（科主任三维度评估）</span></h4>
          <span class="tag orange" v-if="d.biz==='to-evaluate' && !d.evaluation">待评估</span></div>
        <div class="card-body">
          <template v-if="d.evaluation">
            <kv-grid :cols="1" :rows="evalItems"></kv-grid>
            <div class="alert success mt12 mb0" v-if="d.evaluation.nextRound"><span>🔄</span><div>评估结论为「需要持续改进」，系统已自动生成第 {{ d.round + 1 }} 轮改进任务，可在下方「关联改进任务」查看。</div></div>
            <div class="alert success mt12 mb0" v-else><span>✅</span><div>措施已闭环，改进案例纳入后续病例讨论参考。</div></div>
          </template>
          <template v-else-if="evalMode && canEval">
            <div class="form-row"><label class="req">① 措施是否落实</label><div class="ctrl"><div class="radios">
              <label><input type="radio" value="yes" v-model="ev.implemented"> 已落实</label>
              <label><input type="radio" value="partly" v-model="ev.implemented"> 部分落实</label>
              <label><input type="radio" value="no" v-model="ev.implemented"> 未落实</label>
            </div><div class="err-text" v-if="errs.implemented">{{ errs.implemented }}</div></div></div>
            <div class="form-row"><label class="req">② 效果是否达到预期</label><div class="ctrl"><div class="radios">
              <label><input type="radio" value="yes" v-model="ev.effective"> 达到预期</label>
              <label><input type="radio" value="partly" v-model="ev.effective"> 部分达到</label>
              <label><input type="radio" value="no" v-model="ev.effective"> 未达到预期</label>
            </div><div class="err-text" v-if="errs.effective">{{ errs.effective }}</div></div></div>
            <div class="form-row"><label class="req">③ 是否需要持续改进</label><div class="ctrl"><div class="radios">
              <label><input type="radio" value="yes" v-model="ev.needContinue"> 需要（自动生成新一轮 PDCA 任务）</label>
              <label><input type="radio" value="no" v-model="ev.needContinue"> 不需要（关闭任务）</label>
            </div><div class="err-text" v-if="errs.needContinue">{{ errs.needContinue }}</div></div></div>
            <div class="form-row vertical"><label class="req">评估意见（10-1000 字）</label><div class="ctrl">
              <textarea v-model="ev.opinion" rows="3" maxlength="1000" :class="{invalid: errs.opinion}"></textarea>
              <div class="field-help">{{ ev.opinion.length }}/1000</div>
              <div class="err-text" v-if="errs.opinion">{{ errs.opinion }}</div></div></div>
            <div class="form-row"><label>标记优秀</label><div class="ctrl"><label class="row" style="align-items:center">
              <input type="checkbox" v-model="ev.excellent"> 标记为优秀改进措施（供医务部全院推广）</label></div></div>
            <div class="btn-row end"><button class="btn" @click="evalMode=false">取 消</button>
              <button class="btn primary" @click="submitEval">确认评估提交</button></div>
          </template>
          <empty-state v-else text="待评估" icon="📋" :sub="d.biz==='to-evaluate' ? '责任人已提交完成报告，等待科主任开展效果评估。' : '任务完成后将进入效果评估环节。'"></empty-state>
        </div>
      </div>

      <!-- (F) 关联改进任务 + 日志 -->
      <div class="split">
        <div class="col card">
          <div class="card-head"><h4>关联改进任务（PDCA 历史）</h4></div>
          <div class="card-body">
            <div v-if="related.length">
              <div class="sign-row" v-for="t in related" :key="t.id">
                <span class="tag purple">第 {{ t.round }} 轮</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="t.text">{{ t.text }}</span>
                <span class="muted small">{{ t.owner }}</span>
                <dict-tag :list="IS" :value="t.biz"></dict-tag>
                <button class="btn-link" @click="openTask(t)">查看</button>
              </div>
            </div>
            <empty-state v-else text="无关联持续改进任务" icon="🔗"></empty-state>
          </div>
        </div>
        <div class="col card">
          <div class="card-head"><h4>任务状态变更日志</h4></div>
          <div class="card-body" style="max-height:320px;overflow:auto">
            <timeline-list v-if="logs.length" :items="logs" :plain="true"></timeline-list>
            <empty-state v-else text="暂无操作日志" icon="🧾"></empty-state>
          </div>
        </div>
      </div>

      <!-- 新增执行记录弹窗 -->
      <ui-modal v-if="showAdd" title="新增执行情况记录" @close="showAdd=false">
        <div class="field mb8"><label class="req">执行情况说明（10-2000 字符）</label>
          <textarea v-model="exec.text" rows="4" maxlength="2000" :class="{invalid: errs.exec}"
                    placeholder="记录本阶段进展、执行过程中遇到的问题与处理措施"></textarea>
          <div class="field-help">{{ exec.text.length }}/2000</div>
          <div class="err-text" v-if="errs.exec">{{ errs.exec }}</div></div>
        <div class="field"><label>佐证附件</label><input type="file" multiple @change="onFiles($event,'exec.files')">
          <div class="field-help">单文件 ≤10MB，支持 jpg/png/pdf/xlsx，可多文件</div>
          <div class="mt4"><a v-for="(f,i) in exec.files" :key="i" class="btn-link" style="margin-right:12px">📎 {{ f.name }}</a></div></div>
        <template #foot>
          <button class="btn" @click="showAdd=false">取 消</button>
          <button class="btn primary" @click="addExec">保存记录</button>
        </template>
      </ui-modal>
    </div>`
  };
  var pg = global.AMS.pages['improve-detail'];
  Object.assign(pg.computed, { Svc: function () { return Svc; } });
})(window);
