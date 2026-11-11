/* =====================================================================
 * pages/discuss-detail.js —— L3-1-2 讨论任务详情（WF-L3-1-2 / IA-2.3 / FD-1.4 / IX-2.3）
 * (C) 进度步骤条 + 讨论时限 → (D)(E) 患者与死亡信息 →
 * (F) Tab〔讨论会议信息｜患者病历资料｜讨论记录〕→ (A3) 操作按钮区
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Limit = global.Limit, Flow = global.Flow;

  global.AMS.pages['discuss-detail'] = {
    data: function () {
      return {
        tab: 0,
        meeting: { title: '', date: '', time: '15:00', location: '' },
        editing: false,
        meetErr: {},
        leave: null, leaveReason: '',
        proj: null,
        activeDoc: 0,
        upload: null, uploadForm: { type: 'progress', title: '', text: '', replaces: '' },
        DN: D.DEATH_TYPES, PN: D.PRIORITIES, DS: D.DISCUSS_STATUS, AS: D.ATTEND_STATUS, RS: D.RECORD_STATUS
      };
    },
    computed: {
      user: function () { return App.user(); },
      encId: function () { return App.state.params && App.state.params.id; },
      d: function () { App.state.refresh; App.state.clock; return this.encId ? Svc.discussDetail(this.encId) : null; },
      c: function () { return this.d ? this.d.c : null; },
      status: function () { return this.c ? this.c.discussStatus : ''; },
      stage: function () { return this.d ? Flow.meetingStage(this.d.appt) : 'none'; },
      recordStatus: function () { return this.d ? this.d.recordStatus : 'none'; },
      modules: function () {
        if (!this.d || !this.c || !this.c.qrRecord) return [];
        var ans = Svc.flatAnswers(this.c.qrRecord);
        return D ? Svc.template('record').item.map(function (m) {
          return {
            id: m.linkId, title: m.text,
            fields: (m.item || []).map(function (fd) {
              var v = ans[fd.linkId];
              if (fd.type === 'group') {
                return { label: fd.text, rows: (v || []).map(function (row) {
                  var out = {};
                  (fd.item || []).forEach(function (v2) {
                    var hit = (row || {})[v2.linkId];
                    out[v2.text] = hit === undefined || hit === '' ? '——' : hit;
                  });
                  return out;
                }) };
              }
              return { label: fd.text, value: v === undefined || v === '' ? '——' : v };
            })
          };
        }) : [];
      },
      canArrange: function () { return App.can('director') && this.status === 'to-organize'; },
      canWrite: function () { return (App.can('attending|director')) && this.status === 'in-progress' && this.stage === 'fulfilled'; },
      canSign: function () { return this.status === 'to-sign' && Svc.isSigner(this.c, App.user()) && !Svc.alreadySigned(this.c, App.user()); },
      canUrge: function () { return App.can('director') && this.stage === 'booked'; },
      myParty: function () {
        if (!this.d) return null;
        var pid = App.user().practitioner;
        return this.d.parties.filter(function (p) { return p.pid === pid; })[0] || null;
      },
      patientRows: function () {
        var c = this.c; if (!c) return [];
        return [
          ['姓名', c.name], ['性别', c.gender], ['年龄', c.age + ' 岁'], ['住院号', c.mrn],
          ['入院日期', this.dd(c.admitMs)], ['死亡日期', this.dd(c.deathMs)],
          ['住院天数', c.losDays + ' 天'], ['所属科室', c.deptName], ['主管医师', c.attending], ['床位号', (global.FHIR.view('Patient', c.patientId).ext || {}).bedNo || '——']
        ];
      },
      deathRows: function () {
        var c = this.c; if (!c) return [];
        return [
          ['死亡时间', this.dt(c.deathMs)], ['死亡地点', c.deathPlace || '——'],
          ['死亡原因', (c.deathDx || '').split('，')[0]], ['死亡诊断', c.deathDx],
          ['ICD-10 编码', c.deathIcd || '——'], ['疾病严重程度', D.severityName(c.severity)],
          ['入院诊断', c.admitDx], ['诊断符合情况', D.concordanceName(c.concordance)]
        ];
      },
      deathTypeTags: function () {
        var c = this.c; if (!c) return [];
        return [{ k: '死亡类型', v: D.deathTypeName(c.deathType), cls: D.deathTypeCls(c.deathType) },
          { k: '任务优先级', v: D.priorityName(c.priority), cls: D.priorityCls(c.priority) }];
      }
    },
    methods: {
      back: function () { App.navigate('discuss-list', {}); },
      goRecord: function () { App.goCase('discuss-record', this.encId); },
      startEdit: function () {
        var m = this.d && this.d.appt ? this.d.appt.ext.meeting : null;
        this.meeting = {
          title: m ? m.title : (this.c.name + '死亡病例讨论'),
          date: m ? Limit.donly(Limit.parse(this.d.appt.start)) : Limit.donly(Date.now() + 86400000),
          time: m ? Limit.dt(Limit.parse(this.d.appt.start)).slice(11, 16) : '15:00',
          location: m ? m.location : ''
        };
        this.editing = true; this.meetErr = {};
      },
      submitMeeting: function () {
        var f = this.meeting, e = {};
        if (!f.title || f.title.length > 100) e.title = '会议标题不能为空，最多 100 字符';
        if (!f.date) e.date = '请选择会议日期';
        else if (Date.parse(f.date) < this.c.deathMs) e.date = '会议日期不能早于患者死亡日期';
        if (!f.time) e.time = '请选择会议时间';
        if (!f.location || f.location.length > 100) e.location = '会议地点不能为空，最多 100 字符';
        this.meetErr = e;
        if (Object.keys(e).length) { App.toast('表单校验未通过，请检查标红字段', 'error'); return; }
        Svc.arrangeMeeting(this.encId, f, App.user());
        this.editing = false;
        App.toast('会议已安排，已向参会人员推送会议通知');
        App.bump();
      },
      async urgeOne(p) {
        var r = Svc.urgeAttendees(this.encId, App.user(), p.pid);
        App.toast(r.ok ? ('已向 ' + p.name + ' 发送参会催办提醒') : r.msg, r.ok ? 'success' : 'info');
      },
      async urgeAll() {
        var okConfirm = await App.ask('确定向所有待确认参会人员发送催办提醒？', { title: '一键催办' });
        if (!okConfirm) return;
        var r = Svc.urgeAttendees(this.encId, App.user());
        App.toast(r.ok ? ('已向 ' + r.count + ' 名待确认人员发送催办：' + r.names.join('、')) : r.msg, r.ok ? 'success' : 'info');
        App.bump();
      },
      confirmAttend: function (st) {
        var r = Svc.confirmAttend(this.encId, App.user(), st);
        if (r.ok) App.toast(st === 'accepted' ? '已确认参会（签到）' : '已提交请假申请');
        this.leave = null; this.leaveReason = '';
        App.bump();
      },
      submitLeave: function () {
        if ((this.leaveReason || '').length < 4) { App.toast('请填写请假原因（不少于 4 字）', 'error'); return; }
        Svc.confirmAttend(this.encId, App.user(), 'declared-leave', this.leaveReason);
        this.leave = null;
        App.toast('已提交请假，原因已记录备查（需线下经科主任批准）');
        App.bump();
      },
      loadCharts: function () {
        var docs = Svc.fetchCharts(this.encId, App.user());
        App.toast('已自动调阅 EMR 病历资料 ' + docs.length + ' 份' + (docs.some(function (d) { return d.error; }) ? '，其中 1 份接口异常，可手动补充' : ''));
        App.bump();
      },
      pickDoc: function (i) { this.activeDoc = i; },
      project: function (doc) { this.proj = doc; },
      openUpload: function (doc) {
        this.uploadForm = { type: doc ? doc.type : 'progress', title: doc ? doc.name + '（手动补充）' : '', text: '', replaces: doc ? doc.id : '' };
        this.upload = true;
      },
      submitUpload: function () {
        if (!this.uploadForm.title) { App.toast('请填写文档标题', 'error'); return; }
        Svc.uploadChart(this.encId, this.uploadForm, App.user());
        this.upload = null;
        App.toast('病历资料已手动补充并记入调阅日志');
        App.bump();
      },
      doSign: function () {
        var r = Svc.signRecord(this.encId, App.user());
        if (!r.ok) { App.toast(r.msg, 'error'); return; }
        App.toast('CA 数字签名成功，签名时间 ' + Limit.dt(Date.now()));
        if (r.allSigned) App.toast('全部必签人员已完成签名，可提交归档', 'info', 4200);
        App.bump();
      },
      moduleDone: function (m) { return m.filled === m.total && m.total > 0; },
      tabName: function (i) { return ['讨论会议信息', '患者病历资料', '讨论记录'][i]; },
      rsName: function (v) { return D.recordStatusName(v); },
      dname: function (t) { return D.docTypeName(t); }
    },
    template: `
    <div v-if="!d">
      <div class="card"><div class="card-body">
        <empty-state text="未找到该讨论任务" icon="🔍" sub="可能已被处理或不在当前角色的数据范围内，请返回列表重试。">
          <button class="btn" @click="back">返回讨论管理</button>
        </empty-state>
      </div></div>
    </div>
    <div v-else>
      <div class="page-head">
        <div>
          <h1>{{ c.name }} 死亡病例讨论</h1>
          <div class="desc">
            <span class="tag" :class="c.priority==='high'?'red':'orange'" v-if="c.priority==='high'">⚡ 高优先级</span>
            <dict-tag :list="DN" :value="c.deathType"></dict-tag>
            <dict-tag :list="DS" :value="c.discussStatus"></dict-tag>
            <span class="muted small">{{ c.deptName }} · 住院号 {{ c.mrn }}</span>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn" @click="back">‹ 返回列表</button>
          <lock-btn v-if="stage==='none'||stage==='proposed'" label="安排会议" cls="primary" :ok="canArrange" :reason="why('director','仅科主任可组织讨论会议')" @click="startEdit"></lock-btn>
          <lock-btn v-if="canWrite" label="进入讨论记录书写" cls="primary" ok @click="goRecord"></lock-btn>
          <button class="btn" v-if="status==='in-progress' && !canWrite && recordStatus==='none'" :disabled="true" title="等待会议召开后即可书写记录">进入讨论记录书写</button>
        </div>
      </div>

      <!-- (C) 进度步骤条 + 时限 -->
      <div class="card"><div class="card-body">
        <div class="row between mb12" style="align-items:flex-start">
          <div class="strong">讨论任务状态与进度</div>
          <div class="row">
            <span class="small muted">讨论时限</span>
            <countdown-text :cd="c.discussCountdown" :show-deadline="true"></countdown-text>
          </div>
        </div>
        <steps-bar :steps="d.steps"></steps-bar>
      </div></div>

      <!-- (D)(E) 患者基本信息 / 死亡信息 -->
      <div class="card"><div class="card-body">
        <div class="split">
          <div class="col">
            <div class="divider-label">患者基本信息<span class="hint small">（EMR 预填充，只读）</span></div>
            <kv-grid :rows="patientRows" :cols="1"></kv-grid>
          </div>
          <div class="col">
            <div class="divider-label">死亡信息<span class="hint small">（EMR / 自动分类结果）</span></div>
            <kv-grid :rows="deathRows" :cols="1"></kv-grid>
            <div class="row mt8">
              <span class="small muted">死亡类型</span><dict-tag :list="DN" :value="c.deathType"></dict-tag>
              <span class="small muted">优先级</span><dict-tag :list="PN" :value="c.priority"></dict-tag>
              <span class="tag blue" v-if="c.autoClassified">自动分类 {{ c.classifyRuleId }}</span>
              <span class="tag gray" v-else>人工判定 / 规则未命中</span>
            </div>
          </div>
        </div>
      </div></div>

      <!-- (F) Tab -->
      <div class="card">
        <div class="tabs-top">
          <div class="t" v-for="(n,i) in ['讨论会议信息','患者病历资料','讨论记录']" :key="i" :class="{active: tab===i}" @click="tab=i">
            {{ n }}<span class="n" v-if="i===1">（{{ d.docs.length }}）</span><span class="n" v-if="i===2">（{{ rsName(recordStatus) }}）</span>
          </div>
        </div>

        <!-- Tab1 会议信息 -->
        <div class="card-body" v-show="tab===0">
          <div class="divider-label">会议安排</div>
          <div v-if="!d.appt || stage==='proposed'">
            <div class="alert plain"><span>ℹ️</span><div>尚未安排讨论会议{{ canArrange ? '：请点击右上角「安排会议」维护讨论时间、地点并下发通知。' : '（由科主任维护）。' }}</div></div>
            <div v-if="editing">
              <div class="form-row"><label class="req">会议标题</label><div class="ctrl">
                <input type="text" v-model="meeting.title" :class="{invalid: meetErr.title}" maxlength="100">
                <div class="err-text" v-if="meetErr.title">{{ meetErr.title }}</div>
                <div class="hint">默认按「{患者姓名}死亡病例讨论」生成，可编辑</div></div></div>
              <div class="form-row"><label class="req">会议日期 / 时间</label><div class="ctrl"><div class="row">
                <input type="date" v-model="meeting.date" :class="{invalid: meetErr.date}" style="width:190px">
                <input type="time" v-model="meeting.time" :class="{invalid: meetErr.time}" style="width:140px">
                <span class="muted small">会议时长默认 90 分钟</span></div>
                <div class="err-text" v-if="meetErr.date || meetErr.time">{{ meetErr.date || meetErr.time }}</div></div></div>
              <div class="form-row"><label class="req">会议地点</label><div class="ctrl">
                <input type="text" v-model="meeting.location" :class="{invalid: meetErr.location}" maxlength="100" placeholder="如：示教室 3 室">
                <div class="err-text" v-if="meetErr.location">{{ meetErr.location }}</div></div></div>
              <div class="form-row"><label>会议准备人</label><div class="ctrl"><input type="text" :value="c.attending + '（主管医师）'" disabled><span class="hint">系统自动填入，不可修改</span></div></div>
              <div class="btn-row end">
                <button class="btn" @click="editing=false">取 消</button>
                <button class="btn primary" @click="submitMeeting">确定并发送通知</button>
              </div>
            </div>
            <div class="btn-row" v-if="!editing && canArrange"><button class="btn primary" @click="startEdit">安排会议</button></div>
          </div>
          <div v-else>
            <kv-grid :cols="2" :rows="[
              ['会议标题', d.appt.ext.meeting.title],
              ['会议时间', dt(d.appt.start) + ' ~ ' + d.appt.end.slice(11,16)],
              ['会议地点', d.appt.ext.meeting.location],
              ['会议准备人', d.appt.ext.meeting.preparedBy + '（主管医师）'],
              ['会议状态', stage==='fulfilled' ? '已召开' : '已安排，待召开'],
              ['通知方式', (d.appt.ext.notifyChannels||[]).map(x=>({app:'APP 推送',site:'站内消息',sms:'短信',wechat:'微信'})[x]||x).join(' / ')],
              ['通知下发时间', dt(Date.parse(d.appt.ext.meeting.notifiedAt))],
              ['参会要求', '必签人员：科主任（主持人）、主管医师、上级医师']
            ]"></kv-grid>
            <div class="btn-row mt12" v-if="canArrange"><button class="btn" @click="startEdit">修改会议安排</button></div>
          </div>

          <div class="divider-label">参会人员清单<span class="hint small">（{{ d.partySummary.accepted }} 已确认 / {{ d.partySummary.needs }} 待确认 / {{ d.partySummary.leave }} 已请假{{ d.partySummary.absent ? ' / ' + d.partySummary.absent + ' 缺席' : '' }}）</span></div>
          <div class="row between mb8">
            <div class="small muted">科主任可在此查看确认情况并对未确认人员发送提醒；参会为强制性要求。</div>
            <lock-btn label="一键催办" cls="sm" :ok="canUrge && d.partySummary.needs>0" :reason="canUrge ? '暂无待确认人员' : why('director','仅科主任可催办')" @click="urgeAll"></lock-btn>
          </div>
          <div class="table-wrap"><table class="tbl dense">
            <thead><tr><th>姓名</th><th>角色</th><th>科室</th><th>参会确认状态</th><th>说明</th><th style="width:150px">操作</th></tr></thead>
            <tbody>
              <tr v-for="p in d.parties" :key="p.pid">
                <td><b>{{ p.name }}</b><span class="tag blue" v-if="p.pid===user.practitioner">本人</span></td>
                <td>{{ p.role }}</td><td>{{ p.dept }}</td>
                <td><dict-tag :list="AS" :value="p.status"></dict-tag></td>
                <td class="small muted">{{ p.leaveReason || (p.status==='needs-action' ? '系统已发送通知，等待确认' : '—') }}</td>
                <td class="actions">
                  <template v-if="p.pid===user.practitioner">
                    <button class="btn-link" v-if="p.status==='needs-action' && stage==='booked'" @click="confirmAttend('accepted')">确认参会</button>
                    <button class="btn-link" v-if="p.status==='needs-action' && stage==='booked'" @click="leave=true">请假</button>
                    <span class="muted small" v-if="p.status==='accepted'">已签到</span>
                  </template>
                  <button class="btn-link" v-else-if="canUrge && p.status==='needs-action'" @click="urgeOne(p)">催办提醒</button>
                  <span class="muted small" v-else>—</span>
                </td>
              </tr>
            </tbody>
          </table></div>
          <div class="alert warn mt12 mb0"><span>⚠️</span><div>参会为强制性要求，特殊情况需向科主任请假并获批准（请假原因将记录备查，超过会议时间未确认自动记为「缺席」）。</div></div>
        </div>

        <!-- Tab2 病历资料 -->
        <div class="card-body" v-show="tab===1">
          <div class="row between mb12">
            <div class="small muted">系统自动从 EMR 调阅入院记录、病程记录、手术记录（如有）、抢救记录、死亡记录与检查检验结果，供会议投屏与记录书写参考。</div>
            <div class="btn-row">
              <button class="btn sm" @click="loadCharts">调阅病历</button>
              <button class="btn sm" :disabled="!d.docs.length" @click="project(d.docs[activeDoc])">投屏展示</button>
              <button class="btn sm" @click="openUpload(null)">手动上传补充</button>
            </div>
          </div>
          <div class="row mb12"><span class="small muted">病历调阅状态：</span><span class="tag" :class="d.chartState.cls">{{ d.chartState.name }}</span></div>
          <div class="row" style="align-items:stretch;gap:14px" v-if="d.docs.length">
            <div class="doc-list">
              <div class="dl" v-for="(doc,i) in d.docs" :key="doc.id" :class="{active: activeDoc===i}" @click="pickDoc(i)">
                <span>{{ doc.error ? '⚠' : '📄' }}</span>
                <span style="flex:1">
                  <div>{{ doc.name }}</div>
                  <div class="muted small">{{ doc.period }} · {{ doc.source }}</div>
                </span>
                <span class="tag red" v-if="doc.error">接口异常</span>
                <span class="tag green" v-else-if="doc.source.indexOf('手动')>=0">手动补充</span>
              </div>
            </div>
            <div class="doc-viewer">
              <div class="row between mb8">
                <b>{{ d.docs[activeDoc] ? d.docs[activeDoc].name : '' }}</b>
                <span class="small muted">{{ d.docs[activeDoc] ? d.docs[activeDoc].date : '' }}</span>
              </div>
              <div class="doc-paper" v-if="d.docs[activeDoc] && d.docs[activeDoc].content">{{ d.docs[activeDoc].content }}</div>
              <div class="alert warn" v-else-if="d.docs[activeDoc]"><span>⚠️</span><div>该病历资料接口调用异常（超时 5 秒/文档），未获取到内容。请支持<b>手动上传补充</b>，系统已记录异常日志。</div>
                <button class="btn sm" @click="openUpload(d.docs[activeDoc])">手动上传补充</button></div>
              <empty-state v-else text="点击左侧文档行，内容在此区域预览展示" icon="📄"></empty-state>
            </div>
          </div>
          <empty-state v-else text="暂无病历资料" icon="📄" sub="点击「调阅病历」从 EMR 拉取；接口异常时可手动上传补充。"></empty-state>
        </div>

        <!-- Tab3 讨论记录 -->
        <div class="card-body" v-show="tab===2">
          <div v-if="recordStatus==='none'">
            <empty-state text="📝 暂无讨论记录" icon="🗂" sub="主管医师尚未完成讨论记录书写，当前无法查看或签名。讨论记录书写完成并提交后，系统将通知所有参会人员签名。">
              <button class="btn primary" v-if="canWrite" @click="goRecord">进入讨论记录书写</button>
            </empty-state>
          </div>
          <div v-else>
            <div class="info-strip mb12">
              <span>记录状态：<dict-tag :list="RS" :value="recordStatus"></dict-tag></span>
              <span class="sep">|</span>
              <span>提交人：{{ c.qrRecord ? c.qrRecord.ext.respondentName : '—' }}</span>
              <span class="sep">|</span>
              <span>讨论日期：{{ c.qrRecord && c.qrRecord.ext.draftMeta ? c.qrRecord.ext.draftMeta.discussDate : '—' }}</span>
              <span class="sep">|</span>
              <span>地点：{{ c.qrRecord && c.qrRecord.ext.draftMeta ? c.qrRecord.ext.draftMeta.location : '—' }}</span>
              <span class="sep">|</span>
              <span>主持人：{{ c.qrRecord && c.qrRecord.ext.draftMeta ? c.qrRecord.ext.draftMeta.moderator : '—' }}</span>
              <span class="sep">|</span>
              <span>书写进度：<b>{{ d.progress.pct }}%</b></span>
              <span class="spacer" style="flex:1"></span>
              <button class="btn sm primary" v-if="canWrite && recordStatus==='draft'" @click="goRecord">继续书写</button>
              <button class="btn sm primary" v-if="canSign" @click="doSign">CA 数字签名</button>
              <span class="tag green" v-if="status==='archived'">✅ 已归档至 EMR，记录锁定</span>
            </div>

            <div class="sign-box mb12">
              <div class="row between mb8"><b class="small">签名进度面板</b>
                <span class="small muted">{{ d.signers.signedRequired }}/{{ d.signers.totalRequired }} 必签完成 ｜ {{ d.signers.signedOptional }}/{{ d.signers.totalOptional }} 可选签完成</span></div>
              <div class="small muted mb4">必签人员（科主任/主持人、主管医师、上级医师）</div>
              <div class="sign-row" v-for="p in d.signers.required" :key="p.pid">
                <span style="width:150px">{{ p.name }}</span><span class="tag gray" style="width:130px">{{ p.role }}</span>
                <span v-if="p.signed" class="green">✅ 已签名</span><span v-else class="muted">⬜ 待签名</span>
                <span class="muted small" v-if="p.signed">{{ p.time }}</span>
                <span class="spacer" style="flex:1"></span>
                <button class="btn sm" v-if="!p.signed && p.pid===user.practitioner && recordStatus==='to-sign'" @click="doSign">去签名</button>
              </div>
              <div class="small muted mt8 mb4">其他参会医师（可选签名）</div>
              <div class="sign-row" v-for="p in d.signers.optional" :key="'o'+p.pid">
                <span style="width:150px">{{ p.name }}</span><span class="tag gray" style="width:130px">{{ p.role }}</span>
                <span v-if="p.signed" class="green">✅ 已签名</span>
                <span v-else-if="p.onLeave" class="blue">— 已请假（不纳入签名范围）</span>
                <span v-else class="muted">⬜ 待签名</span>
                <span class="muted small" v-if="p.signed">{{ p.time }}</span>
                <span class="spacer" style="flex:1"></span>
                <button class="btn sm" v-if="!p.signed && p.pid===user.practitioner && recordStatus==='to-sign'" @click="doSign">自愿签名</button>
              </div>
            </div>

            <div class="record-layout">
              <div class="record-nav">
                <div class="side-nav">
                  <div class="sn" v-for="(m,i) in modules" :key="m.id" :class="{active: i===0}">
                    {{ m.title }}<span class="ok" v-if="moduleDone(m)">✅</span><span class="todo" v-else>☐</span>
                  </div>
                </div>
                <div class="alert plain mt8"><span>👁</span><div class="small">当前为只读审阅模式；如需修改记录，请在「讨论记录书写与签名」页操作（仅主管医师、草稿状态可编辑）。</div></div>
              </div>
              <div class="record-main">
                <div class="module-block" v-for="m in modules" :key="m.id">
                  <div class="mh">{{ m.title }}<span class="st">{{ moduleDone(m) ? '✅ 已填写' : '☐ 未填写' }}</span></div>
                  <div class="mb">
                    <div v-for="f in m.fields" :key="f.label" class="mb12">
                      <div class="small muted mb4">{{ f.label }}</div>
                      <div v-if="f.rows && f.rows.length" class="table-wrap">
                        <table class="table-sub">
                          <thead><tr><th style="width:34px">#</th><th v-for="k in Object.keys(f.rows[0])" :key="k">{{ k }}</th></tr></thead>
                          <tbody><tr v-for="(r,i) in f.rows" :key="i"><td>{{ i+1 }}</td><td v-for="k in Object.keys(r)" :key="k">{{ r[k] }}</td></tr></tbody>
                        </table>
                      </div>
                      <div v-else-if="f.rows" class="muted small">（未填写）</div>
                      <div v-else style="line-height:1.9">{{ f.value }}</div>
                    </div>
                  </div>
                </div>
                <div class="btn-row end"><button class="btn" @click="toast('已调起打印（演示环境浏览器打印预览）')">🖨 打印记录</button></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 请假弹窗 -->
      <ui-modal v-if="leave" title="申请请假" width="narrow" @close="leave=null">
        <div class="alert warn"><span>⚠️</span><div>参会为强制性要求。请假需线下向科主任报告并获批准，本系统仅记录请假原因备查。</div></div>
        <div class="field"><label class="req">请假原因</label>
          <textarea v-model="leaveReason" rows="3" placeholder="例如：同日门诊排班冲突，已向张德明科主任口头报告并获批准"></textarea></div>
        <template #foot>
          <button class="btn" @click="leave=null">取 消</button>
          <button class="btn primary" @click="submitLeave">提交请假</button>
        </template>
      </ui-modal>

      <!-- 手动补充病历 -->
      <ui-modal v-if="upload" title="手动上传补充病历资料" @close="upload=null">
        <div class="field mb8"><label>文档类型</label>
          <select v-model="uploadForm.type">
            <option v-for="t in ['admission','progress','surgery','rescue','death','exam']" :key="t" :value="t">{{ dname(t) }}</option>
          </select></div>
        <div class="field mb8"><label class="req">文档标题</label><input type="text" v-model="uploadForm.title"></div>
        <div class="field mb8"><label>文件（≤10MB，支持 pdf/jpg/png/docx）</label><input type="file"></div>
        <div class="field"><label>补充说明</label><textarea v-model="uploadForm.text" rows="2" placeholder="例如：接口未返回的抢救病程记录，由主管医师从纸质病历补录"></textarea></div>
        <template #foot>
          <button class="btn" @click="upload=null">取 消</button>
          <button class="btn primary" @click="submitUpload">上传并记入调阅日志</button>
        </template>
      </ui-modal>

      <!-- 投屏模式 -->
      <div class="projection" v-if="proj" @click="proj=null">
        <div class="row between mb12">
          <h2 style="color:#fff">{{ proj.name }} — 会议投屏展示</h2>
          <button class="btn" @click.stop="proj=null">退出投屏（Esc/点击任意处）</button>
        </div>
        <div class="doc-paper">{{ proj.content || '（接口异常，无内容）' }}</div>
        <div class="muted small mt12" style="color:#8fa4bd">投屏内容来源：FHIR DocumentReference.content.attachment.data（base64 解码）；点击任意位置退出。</div>
      </div>
    </div>`,
    methods2: {}
  };
  var pg = global.AMS.pages['discuss-detail'];
  pg.methods.dd = function (v) { return Limit.donly(v); };
  pg.methods.dt = function (v) { return Limit.dt(v); };
  delete pg.methods2;
})(window);
