/* =====================================================================
 * pages/sys-approval.js —— L3-5-6 审批流程配置（IA-2.21 / FD-1.22 / IX-2.23）
 * 审核层级定义与顺序调整、每级绑定角色、审核超时时限与升级推送策略；
 * 保存后新生成上报单使用新链路，已在流转的上报单沿用原链路（B105）。
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, Svc = global.Svc, D = global.Domain, Limit = global.Limit;

  global.AMS.pages['sys-approval'] = {
    data: function () {
      return {
        nodes: [], escalate: true, errs: {},
        boundUsers: {}
      };
    },
    computed: {
      pd: function () { App.state.refresh; return FHIR.view('PlanDefinition', 'PlanDefinition-report-approval'); },
      roles: function () { return D.SCENES.filter(function (s) { return ['senior', 'director', 'quality', 'attending'].indexOf(s.code) >= 0; }); },
      preview: function () {
        var steps = [{ key: 'submit', name: '主管医师提交', state: 'current', actor: '填写人', at: '' }];
        this.nodes.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (n, i) {
          steps.push({ key: 'l' + n.level, name: n.name, state: 'pending', actor: this.roleName(n.roleCode), at: n.hours + ' 小时超时' });
        }, this);
        steps.push({ key: 'done', name: '上报完成', state: 'pending', actor: '系统', at: '' });
        return steps;
      },
      affected: function () {
        App.state.refresh;
        return Svc.cases(function (c) { return c.reportStatus === 'to-fill'; }).length;
      },
      flowing: function () {
        App.state.refresh;
        return Svc.cases(function (c) { return ['level-1', 'level-2', 'level-3', 'returned'].indexOf(c.reportStatus) >= 0; }).length;
      }
    },
    created: function () {
      var pd = this.pd;
      this.nodes = JSON.parse(JSON.stringify(pd.ext.nodes || []));
      this.escalate = this.nodes.length > 0 && this.nodes[0].escalate !== false;
    },
    methods: {
      roleName: function (c) { return D.sceneName(c); },
      addLevel: function () {
        var lv = this.nodes.length + 1;
        this.nodes.push({ level: lv, name: lv + ' 级审核', roleCode: 'quality', roleName: D.sceneName('quality'), hours: 48, escalate: true, order: lv, enabled: true });
      },
      removeLevel: function (i) {
        if (this.nodes.length <= 1) { App.toast('至少保留一级审核', 'warn'); return; }
        this.nodes.splice(i, 1);
        this.nodes.forEach(function (n, k) { n.order = k + 1; n.level = k + 1; });
      },
      move: function (i, dir) {
        var j = i + dir;
        if (j < 0 || j >= this.nodes.length) return;
        var a = this.nodes[i]; this.nodes[i] = this.nodes[j]; this.nodes[j] = a;
        this.nodes.forEach(function (n, k) { n.order = k + 1; });
      },
      onRole: function (n) { n.roleName = D.sceneName(n.roleCode); },
      save: async function () {
        var e = {};
        this.nodes.forEach(function (n, i) {
          if (!n.name || n.name.length > 30) e['n' + i] = '层级名称不能为空';
          if (!n.roleCode) e['n' + i] = '请选择绑定角色';
          if (!(n.hours > 0)) e['n' + i] = '超时时限必须为正整数（小时）';
        });
        this.errs = e;
        if (Object.keys(e).length) { App.toast('审核层级配置校验未通过', 'error'); return; }
        var okc = await App.ask('保存配置，新生成上报单将使用该审批链路，已在流转上报单不改变审核链路，确认保存？', { title: '保存审批流程配置' });
        if (!okc) return;
        var pd = this.pd;
        var nodes = this.nodes.map(function (n, i) {
          return Object.assign({}, n, { level: i + 1, order: i + 1, escalate: this.escalate });
        }, this);
        FHIR.update(Object.assign({}, pd, {
          status: 'active', date: new Date().toISOString(),
          version: String(parseFloat(pd.version || '1') + 1),
          ext: Object.assign({}, pd.ext, { nodes: nodes })
        }));
        var cfg = JSON.parse(JSON.stringify(Limit.config()));
        nodes.forEach(function (n) { cfg.reviewHours[n.level] = n.hours; });
        Limit.setConfig(cfg);
        FHIR.create({
          resourceType: 'Provenance',
          activity: { coding: [{ system: global.Vocab.SYS + 'provenance-activity', code: 'config', display: '配置变更' }], text: '配置变更' },
          recorded: new Date().toISOString(),
          reason: [{ text: '更新上报审批流程：' + nodes.map(function (n) { return n.name + '(' + n.roleName + ',' + n.hours + 'h)'; }).join(' → ') }],
          agent: [{ who: { reference: 'Practitioner/' + App.user().practitioner, display: App.user().name } }],
          entity: [{ role: 'source', what: { reference: 'PlanDefinition/PlanDefinition-report-approval', display: '死亡病例上报三级审核流程' } }],
          ext: { activity: 'config', note: '审批流程配置变更，新版本 v' + (parseFloat(pd.version || '1') + 1), bizKind: 'plan', bizId: 'PlanDefinition-report-approval', operatorName: App.user().name }
        });
        App.toast('审批流程已保存：新生成上报单按 ' + nodes.length + ' 级流转，在途上报单沿用原链路');
        App.bump();
      },
      resetDefault: function () {
        this.nodes = [
          { level: 1, name: '一级审核', roleCode: 'senior', roleName: '上级医师', hours: 48, escalate: true, order: 1, enabled: true },
          { level: 2, name: '二级审核', roleCode: 'director', roleName: '科主任', hours: 48, escalate: true, order: 2, enabled: true },
          { level: 3, name: '三级审核（终审）', roleCode: 'quality', roleName: '医务部管理员', hours: 24, escalate: false, order: 3, enabled: true }
        ];
        this.escalate = true;
        App.toast('已恢复默认三级审核链路（未保存前不生效）', 'info');
      }
    },
    template: `
    <div>
      <div class="page-head"><div><h1>🧾 审批流程配置</h1>
        <div class="desc">定义死亡病例上报审核层级、绑定审核角色、配置各级超时时限与升级推送策略（对应 US-1.2 三级审核）</div></div></div>

      <div class="alert info"><span>ℹ️</span><div>
        当前共 <b>{{ nodes.length }}</b> 级审核。保存后<b>新生成的上报单</b>（{{ affected }} 例待填写病例后续提交）使用本链路；
        <b>已在流转的上报单</b>（{{ flowing }} 例）沿用其创建时的链路，保证审核留痕不可追溯篡改。
      </div></div>

      <div class="card"><div class="card-head"><h4>① 审核层级配置（F147-F149）</h4>
        <button class="btn sm" @click="addLevel">＋ 新增审核层级</button></div>
        <div class="card-body tight"><div class="table-wrap">
          <table class="tbl">
            <thead><tr><th style="width:70px">顺序</th><th>层级名称</th><th>绑定角色</th><th style="width:150px">超时时限（小时）</th><th>升级推送</th><th style="width:150px">操作</th></tr></thead>
            <tbody>
              <tr v-for="(n,i) in nodes" :key="i">
                <td><div class="row" style="gap:2px">
                  <button class="btn-link" :disabled="i===0" @click="move(i,-1)">↑</button>
                  <b>{{ i+1 }}</b>
                  <button class="btn-link" :disabled="i===nodes.length-1" @click="move(i,1)">↓</button>
                </div></td>
                <td><input type="text" v-model="n.name" maxlength="30"></td>
                <td><select v-model="n.roleCode" @change="onRole(n)">
                  <option v-for="r in roles" :key="r.code" :value="r.code">{{ r.name }}</option>
                </select></td>
                <td><input type="number" min="1" v-model.number="n.hours"></td>
                <td><label class="switch"><input type="checkbox" v-model="n.escalate"><span class="sl"></span></label></td>
                <td class="actions"><button class="btn-link gray" @click="previewNode(n)">查看该级审核人</button>
                  <button class="btn-link danger" @click="removeLevel(i)">删除</button></td>
              </tr>
            </tbody>
          </table>
        </div></div>
        <div class="card-body">
          <div class="err-text" v-for="(v,k) in errs" :key="k">{{ v }}</div>
        </div>
      </div>

      <div class="split">
        <div class="col card">
          <div class="card-head"><h4>② 审核超时规则（F150-F153）</h4></div>
          <div class="card-body">
            <div class="form-row" v-for="(n,i) in nodes" :key="i">
              <label>{{ n.name }}超时时限</label>
              <div class="ctrl"><input type="number" min="1" v-model.number="n.hours" style="width:110px">
                <span class="hint">小时（默认 {{ i===2 ? 24 : 48 }} 小时）</span></div>
            </div>
            <div class="form-row"><label>超时升级推送</label><div class="ctrl" style="padding-top:6px">
              <label class="row" style="align-items:center"><input type="checkbox" v-model="escalate">
                <span>开启后本级审核超时，向上一级管理角色（科主任 / 医务部）推送提醒，并计入时效分析</span></label></div></div>
            <div class="divider-label">各级审核人（按演示身份所在科室）</div>
            <table class="tbl dense">
              <thead><tr><th>层级</th><th>绑定角色</th><th>心血管内科</th><th>呼吸内科</th><th>医务部</th></tr></thead>
              <tbody><tr v-for="(n,i) in nodes" :key="n.level">
                <td>{{ n.name }}</td><td>{{ n.roleName }}</td>
                <td>{{ actorOf(n.roleCode, 1) }}</td>
                <td>{{ actorOf(n.roleCode, 2) }}</td>
                <td>{{ actorOf(n.roleCode, 0) }}</td>
              </tr></tbody>
            </table>
          </div>
        </div>

        <div class="col card">
          <div class="card-head"><h4>③ 流程预览（D130）</h4><button class="btn sm" @click="$forceUpdate()">刷新预览</button></div>
          <div class="card-body">
            <steps-bar :steps="preview"></steps-bar>
            <div class="alert plain mt16"><span>🧭</span><div class="small">
              审核流转规则：主管医师提交 → 逐级审核；<b>审核通过</b>流转至下一级，最后一级通过后标记「上报完成」并记录上报完成时间；
              <b>退回修改</b>需填写退回意见，退回主管医师，重提后自被退回层级重新开始流转；各级审核状态与时限在上报管理列表与上报单页实时可见。
            </div></div>
            <div class="btn-row mt12">
              <button class="btn primary" @click="save">保存审批流程配置</button>
              <button class="btn" @click="resetDefault">恢复默认三级</button>
            </div>
          </div>
        </div>
      </div>
    </div>`
  };
  var pg = global.AMS.pages['sys-approval'];
  Object.assign(pg.methods, {
    actorOf: function (roleCode, deptIdx) {
      if (roleCode === 'quality') return (global.CaseFactory.qualityStaff() || {}).name || '刘文华';
      if (!deptIdx) return '—';
      var st = global.CaseFactory.STAFF[deptIdx] || {};
      var list = st[roleCode] || [];
      return list.length ? list[0].name : '—';
    },
    previewNode: function (n) {
      App.toast('「' + n.name + '」由' + n.roleName + '承担；本科室候选审核人：' + this.actorOf(n.roleCode, 1) + '、' + this.actorOf(n.roleCode, 2), 'info');
    }
  });
})(window);
