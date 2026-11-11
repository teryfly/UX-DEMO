/* =====================================================================
 * pages/report-form.js —— L3-2-2 上报单填写与审核（WF-L3-2-2 / IA-2.6 / FD-1.7 / IX-2.6）
 * (C) 基本信息与上报时限 → (D) 三级审核流转步骤条 → (E)~(J) 6 大模块（模板驱动）
 * → (K) 退回理由 / 审核意见与决定 / 审核记录时间线 → 底部操作栏
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Limit = global.Limit, Flow = global.Flow;

  global.AMS.pages['report-form'] = {
    data: function () {
      return { answers: {}, errors: {}, missing: [], showMissing: false, decision: 'pass', opinion: '', savedAt: '', modules0: [] };
    },
    computed: {
      user: function () { return App.user(); },
      encId: function () { return App.state.params && App.state.params.id; },
      d: function () { App.state.refresh; App.state.clock; return this.encId ? Svc.reportDetail(this.encId, App.user()) : null; },
      c: function () { return this.d ? this.d.c : null; },
      modules: function () { return this.d && this.d.template ? this.d.template.item : []; },
      status: function () { return this.d ? this.d.status : ''; },
      isReadonly: function () {
        if (App.state.params && App.state.params.readonly) return true;
        if (!this.d) return true;
        if (this.status === 'done') return true;
        return !(this.canFill || this.canReview);
      },
      canFill: function () {
        if (!this.d) return false;
        return App.scene() === 'attending' && (this.status === 'to-fill' || this.status === 'returned');
      },
      canReview: function () { return !!this.d && this.d.mine.code === 'to-review'; },
      progress: function () {
        App.state.refresh;
        if (!this.d) return { pct: 0, groups: [] };
        return Svc.moduleProgress({ item: this.buildItems(), status: this.d.qr ? this.d.qr.status : 'draft', ext: { draftMeta: {} } }, 'report');
      },
      timeline: function () {
        if (!this.d) return [];
        var out = [];
        var c = this.c;
        if (c.reportQr && c.reportQr.status !== 'draft') {
          out.push({ title: '主管医师 ' + c.attending + ' 提交上报单', at: Limit.dt(Limit.parse(c.reportQr.authored)), level: 'ok', text: '6 大模块内容完整性校验通过' });
        }
        (this.d.flow || []).forEach(function (n) {
          if (n.status === 'approved') out.push({ title: n.roleName + ' ' + n.actorName + '（' + n.name + '）审核通过', at: n.actedAt || '', level: 'ok', text: n.opinion || '（未填写审核意见）' });
          else if (n.status === 'returned') out.push({ title: n.roleName + ' ' + n.actorName + '（' + n.name + '）退回修改', at: n.actedAt || '', level: 'err', text: n.opinion || '' });
          else if (n.status === 'current') out.push({ title: '等待 ' + n.roleName + ' ' + n.actorName + '（' + n.name + '）审核', at: '接收于 ' + (n.assignedAt || ''), level: 'warn', text: '本级审核时限 ' + Limit.reviewHoursOf(n.level) + ' 小时' + (App.state.params && App.state.params.x ? '' : '') });
        });
        if (this.status === 'done') out.push({ title: '✅ 上报完成', at: c.reportActualMs ? Limit.dt(c.reportActualMs) : '', level: 'ok', text: '已发布「死亡病例上报完成」事件，纳入全院死亡病例统计。' });
        return out;
      }
    },
    methods: {
      buildItems: function () {
        var self = this, src = this.d ? this.d.answers : {};
        var use = Object.keys(this.answers).length ? this.answers : src;
        var items = [];
        this.modules.forEach(function (m) {
          items.push({
            linkId: m.linkId, text: m.text, type: 'group',
            item: (m.item || []).map(function (fd) {
              return Object.assign({ linkId: fd.linkId, text: fd.text }, Svc.valueOfField(fd.type, use[fd.linkId]));
            })
          });
        });
        return items;
      },
      init: function () {
        var src = (this.d && this.d.answers) || {};
        var ans = {};
        this.modules.forEach(function (m) {
          (m.item || []).forEach(function (fd) {
            if (src[fd.linkId] !== undefined && src[fd.linkId] !== '') ans[fd.linkId] = src[fd.linkId];
          });
        });
        if (!Object.keys(ans).length && this.c) ans = Svc.sampleAnswers('report', this.encId);
        this.answers = ans;
      },
      prefilled: function (fd) { return (fd.extension || []).some(function (e) { return /prefilled/.test(e.url); }); },
      minLen: function (fd) { var e = (fd.extension || []).filter(function (x) { return /minLength$/.test(x.url); })[0]; return e ? e.valueInteger : null; },
      optList: function (fd) {
        return (fd.answerOption || []).map(function (o) {
          return o.valueCoding ? { code: o.valueCoding.code, name: o.valueCoding.display || o.valueCoding.code } : { code: o.valueString, name: o.valueString };
        });
      },
      val: function (fd) { var v = this.answers[fd.linkId]; return v == null ? '' : v; },
      onField: function () { this.errors = {}; this.showMissing = false; },
      fillSample: function () {
        this.answers = Svc.sampleAnswers('report', this.encId);
        this.missing = []; this.showMissing = false; this.errors = {};
        App.toast('已按病例与 EMR 数据填充 6 大模块演示内容');
      },
      save: function (mode) {
        if (!this.canFill) { App.toast('当前状态不支持编辑上报单', 'warn'); return; }
        Svc.saveReport(this.encId, this.answers, App.user(), mode);
        this.savedAt = Limit.dt(Date.now());
        if (mode !== 'submit') { App.toast('草稿已保存，不触发提交校验'); return; }
        var v = Svc.validateAnswers('report', this.answers);
        if (!v.ok) {
          this.missing = v.missing; this.showMissing = true;
          var e = {};
          v.missing.forEach(function (m) { e[m.id] = m.label + '不能为空' + (m.min ? ('，且不少于 ' + m.min + ' 字符') : ''); });
          this.errors = e;
          App.toast('6 大模块必填项缺失 ' + v.missing.length + ' 项，已列出清单并阻止提交', 'error');
          return;
        }
        this.showMissing = false;
        App.toast('上报单提交成功，已流转至一级审核（上级医师）');
        App.bump();
      },
      async submitReview() {
        if (this.decision === 'return' && (!this.opinion || this.opinion.length < 10)) {
          this.errors = { opinion: '退回修改必须填写退回意见（10-1000 字符）' };
          App.toast('退回修改必须填写退回意见', 'error'); return;
        }
        this.errors = {};
        if (this.decision === 'return') {
          var okc = await App.ask('确认将该上报单退回主管医师修改？退回后需重新提交并自本级重新开始流转。', { title: '退回修改', danger: true });
          if (!okc) return;
        }
        var r = Svc.approveReport(this.encId, { decision: this.decision, opinion: this.opinion }, App.user());
        if (!r.ok) { App.toast(r.msg, 'error'); return; }
        App.toast(this.decision === 'pass'
          ? (r.biz === 'done' ? '医务部终审通过，上报完成（已记录上报完成时间）' : '审核通过，已流转至下一审核节点')
          : '已退回主管医师修改，并推送退回通知');
        this.opinion = ''; this.decision = 'pass';
        App.bump();
      },
      back: function () { App.navigate('report-list', {}); },
      goMeeting: function () { App.goCase('discuss-detail', this.encId); }
    },
    created: function () { this.init(); },
    template: `
    <div v-if="!d || !c">
      <div class="card"><div class="card-body">
        <empty-state text="未找到该上报单" icon="🔍" sub="可能不在当前角色数据范围内。"><button class="btn" @click="back">返回上报管理</button></empty-state>
      </div></div>
    </div>
    <div v-else>
      <div class="page-head">
        <div><h1>{{ c.name }} 死亡病例上报单</h1>
          <div class="desc">6 大结构化模块 · 必填完整性校验 · 三级审核流转（上级医师 → 科主任 → 医务部）</div></div>
        <div class="btn-row">
          <button class="btn" @click="back">‹ 返回列表</button>
          <button class="btn" v-if="status==='done'" @click="goMeeting">查看会议详情 ›</button>
        </div>
      </div>

      <!-- (C) 基本信息 -->
      <div class="card"><div class="card-body" style="padding:12px 16px">
        <div class="info-strip">
          <span><b>{{ c.name }}</b>（{{ c.gender }} · {{ c.age }} 岁）</span><span class="sep">|</span>
          <span>住院号 {{ c.mrn }}</span><span class="sep">|</span>
          <span>{{ c.deptName }}</span><span class="sep">|</span>
          <span>主管医师 {{ c.attending }}</span><span class="sep">|</span>
          <span>死亡时间 {{ dt(c.deathMs) }}</span><span class="sep">|</span>
          <span>死亡类型 <dict-tag :list="DN2" :value="c.deathType"></dict-tag></span>
        </div>
        <div class="row mt12" style="gap:20px">
          <span>上报状态：<dict-tag :list="RS2" :value="status"></dict-tag></span>
          <span v-if="!isReadonly || status!=='done'">上报时限：<countdown-text :cd="d.countdown" :show-deadline="true"></countdown-text></span>
          <span v-if="status==='done'">上报完成时间：<b>{{ dt(c.reportActualMs) }}</b></span>
          <span class="spacer" style="flex:1"></span>
          <span class="small muted">审核时限：一级 {{ LimitH(1) }}h / 二级 {{ LimitH(2) }}h / 三级 {{ LimitH(3) }}h（「审批流程配置」可调）</span>
        </div>
      </div></div>

      <!-- (D) 审核流转进度 -->
      <div class="card"><div class="card-body">
        <div class="strong small mb12">审核流转进度</div>
        <steps-bar :steps="d.steps"></steps-bar>
      </div></div>

      <!-- 缺失清单 -->
      <div class="card" v-if="showMissing && missing.length">
        <div class="card-head"><h4>❌ 必填项校验未通过（{{ missing.length }} 项）</h4><span class="hint small">已阻止提交，请逐项补充</span></div>
        <div class="card-body"><span class="tag red" style="margin:0 8px 8px 0" v-for="(m,i) in missing" :key="i">{{ m.module }} › {{ m.label }}</span></div>
      </div>

      <!-- (E)~(J) 6 模块 -->
      <div class="card" v-for="m in modules" :key="m.linkId">
        <div class="card-head"><h4>{{ m.text }}<span class="hint small" v-if="m.linkId==='r1'">（HIS/EMR 预填充，请核实）</span></h4>
          <span class="tag" :class="moduleDone(m)?'green':'gray'">{{ moduleDone(m) ? '✅ 已完成' : '待填写' }}</span></div>
        <div class="card-body">
          <div class="form-row" v-for="fd in m.item" :key="fd.linkId" :class="{vertical: fd.type==='text'}">
            <label :class="{req: fd.required}">{{ fd.text }}</label>
            <div class="ctrl">
              <template v-if="isReadonly">
                <div style="line-height:1.9">{{ val(fd) || '——' }}</div>
              </template>
              <template v-else>
                <input v-if="prefilled(fd)" type="text" :value="val(fd)" disabled>
                <div class="radios" v-else-if="fd.type==='choice'">
                  <label v-for="o in optList(fd)" :key="o.code">
                    <input type="radio" :value="o.name" v-model="answers[fd.linkId]" @change="onField"> {{ o.name }}
                  </label>
                </div>
                <textarea v-else-if="fd.type==='text'" v-model="answers[fd.linkId]" rows="3" :maxlength="fd.maxLength||3000"
                          :class="{invalid: errors[fd.linkId]}" @input="onField"
                          :placeholder="(minLen(fd)?'不少于 '+minLen(fd)+' 字':'') + (fd.maxLength?'，最多 '+fd.maxLength+' 字':'')"></textarea>
                <input v-else-if="fd.type==='dateTime'" type="datetime-local" v-model="answers[fd.linkId]" :class="{invalid: errors[fd.linkId]}">
                <input v-else-if="fd.type==='date'" type="date" v-model="answers[fd.linkId]">
                <input v-else type="text" v-model="answers[fd.linkId]" :maxlength="fd.maxLength||200" :class="{invalid: errors[fd.linkId]}" @input="onField">
                <div class="field-help" v-if="prefilled(fd)">HIS/EMR 预填充，不可编辑</div>
                <div class="field-help" v-else-if="minLen(fd) || fd.maxLength">长度要求：{{ minLen(fd)||1 }} - {{ fd.maxLength||2000 }} 字符，当前 {{ String(val(fd)||'').length }}</div>
                <div class="err-text" v-if="errors[fd.linkId]">{{ errors[fd.linkId] }}</div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- (K) 退回理由 -->
      <div class="card" v-if="status==='returned' && c.returnReason">
        <div class="card-body">
          <div class="alert danger"><span>⚠️</span><div>
            <b>【{{ c.returnReason.levelName }}】{{ c.returnReason.role }} {{ c.returnReason.by }} 于 {{ c.returnReason.at }} 退回修改</b><br>
            退回理由：{{ c.returnReason.text }}<br>
            <span class="small">※ 修改后重新提交，将从【{{ c.returnReason.levelName }}】重新开始流转。</span>
          </div></div>
        </div>
      </div>

      <!-- (K) 审核意见区 / 审核记录时间线 -->
      <div class="card" v-if="canReview">
        <div class="card-head"><h4>📝 审核意见与决定</h4><span class="hint small">{{ (d.flow.filter(n=>n.status==='current')[0]||{}).name }} · {{ user.name }}</span></div>
        <div class="card-body">
          <div class="form-row vertical"><label>审核意见</label><div class="ctrl">
            <textarea v-model="opinion" rows="3" maxlength="1000" :class="{invalid: errors.opinion}"
                      placeholder="选择「退回修改」时必须填写退回理由（10-1000 字符）；审核通过可填写审核意见。"></textarea>
            <div class="field-help">{{ opinion.length }} / 1000</div>
            <div class="err-text" v-if="errors.opinion">{{ errors.opinion }}</div>
          </div></div>
          <div class="form-row"><label class="req">审核决定</label><div class="ctrl"><div class="radios">
            <label><input type="radio" value="pass" v-model="decision"> 审核通过<span class="muted small">（流转至下一级，终审通过即标记上报完成）</span></label>
            <label><input type="radio" value="return" v-model="decision"> 退回修改<span class="muted small">（退回主管医师并附退回意见）</span></label>
          </div></div></div>
        </div>
      </div>

      <div class="card" v-if="timeline.length">
        <div class="card-head"><h4>🕒 审核记录时间线</h4></div>
        <div class="card-body"><timeline-list :items="timeline"></timeline-list></div>
      </div>

      <!-- 底部操作栏 -->
      <div class="card"><div class="card-body">
        <div class="row between">
          <div class="small muted">
            <template v-if="canFill">可填写并提交；草稿不触发校验{{ savedAt ? '（上次保存：' + savedAt + '）' : '' }}</template>
            <template v-else-if="canReview">当前为审核操作视角，可修改审核意见后提交</template>
            <template v-else>当前为只读查看（{{ status==='done' ? '上报已完成归档' : '等待其他节点处理' }}）</template>
          </div>
          <div class="btn-row">
            <button class="btn" @click="fillSample" v-if="canFill">🧪 填充演示内容</button>
            <button class="btn" @click="save('draft')" v-if="canFill">保存草稿</button>
            <lock-btn v-if="canFill" label="提交上报" cls="primary" :ok="progress.pct>0" reason="上报单内容为空" @click="save('submit')"></lock-btn>
            <button class="btn primary" v-if="canReview" @click="submitReview">确认提交</button>
          </div>
        </div>
      </div></div>
    </div>`
  };
  var pg = global.AMS.pages['report-form'];
  Object.assign(pg.computed, {
    DN2: function () { return D.DEATH_TYPES; },
    RS2: function () { return D.REPORT_STATUS; }
  });
  Object.assign(pg.methods, {
    moduleDone: function (m) {
      var self = this;
      return (m.item || []).filter(function (fd) { return fd.required; }).every(function (fd) {
        var v = self.answers[fd.linkId];
        if (v === undefined || v === null || v === '') return false;
        var e = (fd.extension || []).filter(function (x) { return /minLength$/.test(x.url); })[0];
        return !e || String(v).length >= e.valueInteger;
      });
    },
    LimitH: function (lv) { return Limit.reviewHoursOf(lv); },
    dt: function (v) { return Limit.dt(v); }
  });
})(window);
