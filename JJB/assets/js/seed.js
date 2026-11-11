/* ============================================================
 * seed.js — 初始化基础数据（全部以 FHIR R4 资源表达）
 *  覆盖：Organization 科室 / Practitioner 人员 / PractitionerRole 资质
 *        Patient 患者 / Encounter 在院 / Condition 诊断 / Flag 重点标记
 *        Task 待办(医嘱/会诊/危急值) / Observation 危急值
 *        Slot 值班排班 / Basic 规则·模板·参数
 *        Composition+Provenance 交接记录·签名 / Communication 异常 / AuditEvent 审计
 * 全局：window.SEED
 * ============================================================ */
(function () {
  const SEED = {};
  const T0 = new Date('2026-06-20T08:00:00');   // 演示“当前时间”
  const d = (s) => new Date(s);
  const iso = (x) => x.toISOString();

  SEED.build = function (FHIR) {
    const C = (r) => FHIR.create(r, { silent: true });   // 静默批量写入

    /* ---------------- 科室 Organization ---------------- */
    const orgs = [
      { id: 'org-card', code: 'DEPT-CARD', name: '心血管内科' },
      { id: 'org-surg', code: 'DEPT-SURG', name: '普外科' },
      { id: 'org-neuro', code: 'DEPT-NEUR', name: '神经内科' },
      { id: 'org-emer', code: 'DEPT-EMER', name: '急诊科' },
    ];
    orgs.forEach(o => C({
      resourceType: 'Organization', id: o.id, active: true,
      identifier: [{ system: 'http://hospital/dept', value: o.code }],
      type: [{ coding: [{ code: 'dept', display: '临床科室' }] }],
      name: o.name,
    }));

    /* ---------------- 人员 Practitioner + 资质 PractitionerRole ---------------- */
    // appRole：系统角色（用于登录身份/权限）；qualification：职称；specialty：执业范围
    const docs = [
      // 心血管内科
      { id: 'doc-zw', name: '张伟', org: 'org-card', q: '主治医师', sp: '内科', appRole: '值班医生', user: 'zhangwei' },
      { id: 'doc-ln', name: '李娜', org: 'org-card', q: '主治医师', sp: '内科', appRole: '接班医生', user: 'lina' },
      { id: 'doc-wjg', name: '王建国', org: 'org-card', q: '主任医师', sp: '内科', appRole: '科室负责人', user: 'wangjg' },
      { id: 'doc-csy', name: '陈思远', org: 'org-card', q: '副主任医师', sp: '内科', user: 'chensy' },
      { id: 'doc-zl', name: '赵磊', org: 'org-card', q: '住院医师', sp: '内科', user: 'zhaolei' },
      { id: 'doc-syt', name: '孙雅婷', org: 'org-card', q: '主治医师', sp: '内科', user: 'sunyt' },
      // 普外科
      { id: 'doc-zq', name: '周强', org: 'org-surg', q: '主任医师', sp: '外科', user: 'zhouq' },
      { id: 'doc-wf', name: '吴芳', org: 'org-surg', q: '主治医师', sp: '外科', user: 'wufang' },
      // 神经内科
      { id: 'doc-zm', name: '郑明', org: 'org-neuro', q: '副主任医师', sp: '神经内科', user: 'zhengm' },
      // 急诊科
      { id: 'doc-hj', name: '黄杰', org: 'org-emer', q: '主治医师', sp: '急诊', user: 'huangj' },
      // 管理类身份
      { id: 'doc-zhm', name: '赵敏', org: 'org-card', q: '—', sp: '—', appRole: '医院管理部门', user: 'zhaomin' },
      { id: 'doc-admin', name: '系统管理员', org: 'org-card', q: '—', sp: '—', appRole: '管理员', user: 'admin' },
    ];
    docs.forEach(x => {
      C({
        resourceType: 'Practitioner', id: x.id, active: true,
        identifier: [{ system: 'http://hospital/staff', value: x.id.toUpperCase() }],
        name: [{ text: x.name, family: x.name[0], given: [x.name.slice(1)] }],
        qualification: x.q !== '—' ? [{ code: { text: x.q } }] : [],
        // 自定义账号信息（演示用扩展）
        _account: { username: x.user, status: 'active', appRole: x.appRole || '' },
      });
      C({
        resourceType: 'PractitionerRole', id: 'role-' + x.id, active: true,
        practitioner: FHIR.refStr('Practitioner', x.id),
        organization: FHIR.refStr('Organization', x.org),
        code: x.appRole ? [{ text: x.appRole }] : [{ text: '值班医生' }],
        specialty: x.sp !== '—' ? [{ text: x.sp }] : [],
        _qualification: x.q,
      });
    });

    /* ---------------- 在院患者 Patient + Encounter + Condition + Flag ---------------- */
    // 重点标记类别：危重患者 / 近期手术患者 / 病情波动患者
    const patients = [
      { id: 'pat-01', name: '刘建华', g: 'male', age: 67, bed: '心内-08', dx: '急性广泛前壁心肌梗死', sev: '危重', adm: '2026-06-18', flags: ['危重患者', '病情波动患者'] },
      { id: 'pat-02', name: '杨秀英', g: 'female', age: 72, bed: '心内-12', dx: '慢性心力衰竭急性加重', sev: '危重', adm: '2026-06-16', flags: ['危重患者'] },
      { id: 'pat-03', name: '马志强', g: 'male', age: 58, bed: '心内-05', dx: '主动脉夹层(Stanford B型)术后', sev: '较重', adm: '2026-06-17', flags: ['近期手术患者'] },
      { id: 'pat-04', name: '徐丽', g: 'female', age: 49, bed: '心内-03', dx: '不稳定型心绞痛', sev: '较重', adm: '2026-06-19', flags: ['病情波动患者'] },
      { id: 'pat-05', name: '何平', g: 'male', age: 63, bed: '心内-15', dx: '阵发性心房颤动', sev: '一般', adm: '2026-06-15', flags: [] },
      { id: 'pat-06', name: '罗桂兰', g: 'female', age: 70, bed: '心内-18', dx: '高血压性心脏病', sev: '一般', adm: '2026-06-14', flags: [] },
      { id: 'pat-07', name: '邓伟', g: 'male', age: 55, bed: '心内-21', dx: '冠状动脉支架植入术后', sev: '一般', adm: '2026-06-13', flags: ['近期手术患者'] },
      { id: 'pat-08', name: '冯敏', g: 'female', age: 61, bed: '心内-09', dx: '扩张型心肌病', sev: '较重', adm: '2026-06-12', flags: ['病情波动患者'] },
    ];
    patients.forEach(p => {
      C({
        resourceType: 'Patient', id: p.id, active: true,
        identifier: [{ system: 'http://hospital/mrn', value: 'MRN' + p.id.slice(-2) + '8801' }],
        name: [{ text: p.name }], gender: p.g,
        birthDate: String(2026 - p.age) + '-01-01',
      });
      C({
        resourceType: 'Encounter', id: 'enc-' + p.id.slice(-2), status: 'in-progress',
        class: { code: 'IMP', display: '住院' },
        subject: FHIR.refStr('Patient', p.id),
        serviceProvider: FHIR.refStr('Organization', 'org-card'),
        location: [{ location: { display: p.bed }, status: 'active' }],
        period: { start: p.adm + 'T10:00:00' },
        _bed: p.bed, _severity: p.sev,
      });
      C({
        resourceType: 'Condition', id: 'cond-' + p.id.slice(-2),
        clinicalStatus: { coding: [{ code: 'active' }] },
        subject: FHIR.refStr('Patient', p.id),
        code: { text: p.dx },
        severity: { text: p.sev },
      });
      p.flags.forEach((f, i) => C({
        resourceType: 'Flag', id: 'flag-' + p.id.slice(-2) + '-' + i, status: 'active',
        category: [{ text: '重点交接' }],
        code: { text: f },
        subject: FHIR.refStr('Patient', p.id),
        _source: 'EMR/HIS 诊疗数据自动识别',
      }));
    });

    /* ---------------- 待办事项 Task（医嘱/会诊/危急值，均未完成） ---------------- */
    // source: HIS-医嘱 / 会诊 / 危急值；priority：紧急/高/普通
    const tasks = [
      { p: 'pat-01', src: '危急值', pr: '紧急', t: '肌钙蛋白I 12.6 ng/mL（参考<0.04），危急值待复核处理' },
      { p: 'pat-01', src: '医嘱', pr: '高', t: '床旁心电监护并q2h记录，备除颤仪' },
      { p: 'pat-01', src: '会诊', pr: '高', t: '心外科会诊评估急诊介入/搭桥指征' },
      { p: 'pat-02', src: '危急值', pr: '紧急', t: '血钾 6.8 mmol/L 危急值，待复核并处理高钾' },
      { p: 'pat-02', src: '医嘱', pr: '高', t: '静脉泵入呋塞米，记录24h出入量' },
      { p: 'pat-03', src: '医嘱', pr: '高', t: '术后控制血压(目标SBP 100-120)，复查床旁超声' },
      { p: 'pat-03', src: '会诊', pr: '普通', t: '血管外科会诊评估支架贴壁情况' },
      { p: 'pat-04', src: '医嘱', pr: '普通', t: '复查心肌酶谱及心电图，胸痛随时汇报' },
      { p: 'pat-08', src: '会诊', pr: '普通', t: '心律失常专科会诊评估CRT-D指征' },
      { p: 'pat-08', src: '医嘱', pr: '普通', t: '调整抗心衰药物剂量，监测肾功能' },
    ];
    tasks.forEach((x, i) => C({
      resourceType: 'Task', id: 'task-' + String(i + 1).padStart(2, '0'), status: 'in-progress',
      intent: 'order',
      priority: x.pr === '紧急' ? 'stat' : (x.pr === '高' ? 'urgent' : 'routine'),
      focus: FHIR.refStr('Patient', x.p),
      for: FHIR.refStr('Patient', x.p),
      description: x.t,
      businessStatus: { text: '未完成' },
      _source: x.src, _priority: x.pr,
    }));

    /* ---------------- 危急值 Observation（关联危急值待办） ---------------- */
    [{ p: 'pat-01', code: '肌钙蛋白I', v: '12.6 ng/mL' }, { p: 'pat-02', code: '血钾', v: '6.8 mmol/L' }]
      .forEach((o, i) => C({
        resourceType: 'Observation', id: 'obs-crit-' + (i + 1), status: 'preliminary',
        category: [{ coding: [{ code: 'laboratory' }], text: '危急值' }],
        interpretation: [{ coding: [{ code: 'AA', display: '危急异常' }] }],
        code: { text: o.code }, subject: FHIR.refStr('Patient', o.p),
        valueString: o.v, effectiveDateTime: '2026-06-20T06:40:00',
      }));

    /* ---------------- 排班规则 / 模板 / 交接模板 / 系统参数（FHIR Basic） ---------------- */
    C({
      resourceType: 'Basic', id: 'rule-01', code: { coding: [{ code: 'scheduling-rule' }] },
      _name: '心血管内科标准排班规则', _cycle: '按周', _start: '2026-06-15', _status: 'active',
      _org: 'org-card', author: FHIR.refStr('Practitioner', 'doc-wjg'), created: '2026-05-20',
      _shifts: [
        { name: '白班', start: '08:00', end: '20:00', minTitle: '住院医师', scope: '内科' },
        { name: '夜班', start: '20:00', end: '08:00', minTitle: '主治医师', scope: '内科' },
      ],
    });
    C({
      resourceType: 'Basic', id: 'rule-02', code: { coding: [{ code: 'scheduling-rule' }] },
      _name: '节假日值班规则', _cycle: '按周', _start: '2026-06-01', _status: 'inactive',
      _org: 'org-card', author: FHIR.refStr('Practitioner', 'doc-wjg'), created: '2026-05-10',
      _shifts: [{ name: '全天班', start: '08:00', end: '08:00', minTitle: '主治医师', scope: '内科' }],
    });
    // 普外科规则——用于验证“排班规则限定适用科室”与“值班排班按科室切换”不会串数据
    C({
      resourceType: 'Basic', id: 'rule-03', code: { coding: [{ code: 'scheduling-rule' }] },
      _name: '普外科标准排班规则', _cycle: '按周', _start: '2026-06-15', _status: 'active',
      _org: 'org-surg', author: FHIR.refStr('Practitioner', 'doc-zq'), created: '2026-05-23',
      _shifts: [
        { name: '白班', start: '08:00', end: '20:00', minTitle: '主治医师', scope: '外科' },
        { name: '夜班', start: '20:00', end: '08:00', minTitle: '主治医师', scope: '外科' },
      ],
    });
    C({
      resourceType: 'Basic', id: 'tpl-01', code: { coding: [{ code: 'scheduling-template' }] },
      _name: '一周白夜轮转模板', _cycle: '按周', _rule: 'rule-01', _org: 'org-card',
      _desc: '工作日白夜两班轮转，周末双值班', _lastUsed: '2026-06-14', created: '2026-05-21',
      // 每格人员安排（行=班次，列=周一..周日）；空=待安排
      _plan: {
        '白班': ['doc-zl', 'doc-syt', 'doc-zl', 'doc-syt', 'doc-zw', 'doc-csy', 'doc-zw'],
        '夜班': ['doc-zw', 'doc-ln', 'doc-zw', 'doc-ln', 'doc-csy', 'doc-syt', 'doc-ln'],
      },
    });
    C({
      resourceType: 'Basic', id: 'tpl-02', code: { coding: [{ code: 'scheduling-template' }] },
      _name: '节假日排班模板', _cycle: '按周', _rule: 'rule-02', _org: 'org-card',
      _desc: '节假日全天班单人值守', _lastUsed: null, created: '2026-05-22',
      _plan: { '全天班': ['doc-wjg', '', 'doc-csy', '', 'doc-zw', '', 'doc-ln'] },
    });
    C({
      resourceType: 'Basic', id: 'tpl-03', code: { coding: [{ code: 'scheduling-template' }] },
      _name: '普外科白夜轮转模板', _cycle: '按周', _rule: 'rule-03', _org: 'org-surg',
      _desc: '白夜两班固定轮转', _lastUsed: '2026-06-15', created: '2026-05-24',
      _plan: {
        '白班': ['doc-zq', 'doc-zq', 'doc-zq', 'doc-zq', 'doc-zq', 'doc-zq', 'doc-zq'],
        '夜班': ['doc-wf', 'doc-wf', 'doc-wf', 'doc-wf', 'doc-wf', 'doc-wf', 'doc-wf'],
      },
    });
    // 交接班记录模板
    C({
      resourceType: 'Basic', id: 'htpl-01', code: { coding: [{ code: 'handover-template' }] },
      _name: '心血管内科交接班模板', _status: 'active', created: '2026-05-25', _createdBy: '王建国',
      _sections: ['在院患者清单', '重点患者标记', '待办事项汇总', '交接补充信息', '双方电子签名'],
      _orgs: ['心血管内科'],
    });
    C({
      resourceType: 'Basic', id: 'htpl-02', code: { coding: [{ code: 'handover-template' }] },
      _name: '通用交接班模板', _status: 'inactive', created: '2026-05-18', _createdBy: '系统管理员',
      _sections: ['在院患者清单', '待办事项汇总', '双方电子签名'],
      _orgs: ['心血管内科', '普外科', '神经内科', '急诊科'],
    });
    // 系统参数（分组）
    C({
      resourceType: 'Basic', id: 'sysparam', code: { coding: [{ code: 'system-parameter' }] },
      _params: [
        { group: '交接班', key: 'handover_timeout', name: '交接班超时阈值', value: 30, type: 'number', unit: '分钟', desc: '超过该时长未完成交接判定为超时' },
        { group: '交接班', key: 'remind_before', name: '值班提醒提前时间', value: 60, type: 'number', unit: '分钟', desc: '值班开始前发送提醒的提前量' },
        { group: '数据配置', key: 'fhir_sync_cycle', name: 'FHIR 自动同步周期', value: 60, type: 'number', unit: '分钟', desc: '人员/科室数据自动同步周期' },
        { group: '数据配置', key: 'data_stale', name: '数据同步异常阈值', value: 30, type: 'number', unit: '分钟', desc: '来源系统超过该时长未同步标记为异常' },
        { group: '质量统计', key: 'attend_warn', name: '到岗率预警阈值', value: 90, type: 'number', unit: '%', desc: '低于该值的科室在对比分析中预警' },
        { group: '质量统计', key: 'exception_warn', name: '异常事件预警阈值', value: 5, type: 'number', unit: '件', desc: '高于该值的科室在对比分析中预警' },
        { group: '质量统计', key: 'stat_cycle', name: '统计聚合周期', value: '周', type: 'enum', options: ['日', '周', '月', '季'], unit: '', desc: '质量报告默认聚合粒度' },
      ],
    });

    /* ---------------- 值班排班 Slot（本周 06-15 ~ 06-21） ----------------
     * _practitioners：值班人员数组（支持同一班次多人共同值班，如临床带教/多人协同值班场景）
     * 06-19 夜班 = doc-zw、06-20 白班 = doc-ln：与「交接班清单」当前交接班次
     * （06-20 白班，交班=doc-zw、接班=doc-ln）严格对齐——张伟深夜下班后与李娜完成早交接。 */
    const weekStart = d('2026-06-15');
    const planWhite = ['doc-zl', 'doc-syt', 'doc-zl', 'doc-syt', 'doc-csy', 'doc-ln', 'doc-zw'];
    const planNight = ['doc-zw', 'doc-ln', 'doc-zw', 'doc-ln', 'doc-zw', 'doc-syt', 'doc-ln'];
    for (let i = 0; i < 7; i++) {
      const day = U.addDays(weekStart, i);
      const ds = U.fmtDate(day);
      [['白班', '08:00', '20:00', planWhite[i]], ['夜班', '20:00', '08:00', planNight[i]]].forEach(([shift, s, e, doc]) => {
        C({
          resourceType: 'Slot', id: FHIR.slotId('org-card', ds, shift), status: 'busy',
          serviceType: [{ text: shift }],
          start: `${ds}T${s}:00`, end: `${ds}T${e}:00`,
          schedule: FHIR.refStr('Schedule', 'sch-card'),
          _practitioners: [doc], _org: 'org-card', _date: ds, _shift: shift,
        });
      });
    }
    /* 普外科同一周排班（固定白/夜两人轮值，用于验证按科室切换互不影响） */
    const planSurgWhite = ['doc-zq', 'doc-zq', 'doc-zq', 'doc-zq', 'doc-zq', 'doc-zq', 'doc-zq'];
    const planSurgNight = ['doc-wf', 'doc-wf', 'doc-wf', 'doc-wf', 'doc-wf', 'doc-wf', 'doc-wf'];
    for (let i = 0; i < 7; i++) {
      const ds = U.fmtDate(U.addDays(weekStart, i));
      [['白班', '08:00', '20:00', planSurgWhite[i]], ['夜班', '20:00', '08:00', planSurgNight[i]]].forEach(([shift, s, e, doc]) => {
        C({
          resourceType: 'Slot', id: FHIR.slotId('org-surg', ds, shift), status: 'busy',
          serviceType: [{ text: shift }],
          start: `${ds}T${s}:00`, end: `${ds}T${e}:00`,
          schedule: FHIR.refStr('Schedule', 'sch-surg'),
          _practitioners: [doc], _org: 'org-surg', _date: ds, _shift: shift,
        });
      });
    }

    /* ---------------- 历史交接班记录 Composition + 签名 Provenance ---------------- */
    // status final 即不可篡改；attester 记录双方（可各为多人）电子签名，全员签完才算交接完成。
    // 患者清单/待办事项按“交接当时”留存快照（_patientSnapshot/_todoSnapshot），
    // 即使患者后续出院、待办后续办结，历史交接记录详情仍应还原交接当时的真实内容。
    function snapshot(patIds, taskIds) {
      const pats = patIds.map(pid => {
        const p = patients.find(x => x.id === pid);
        const flags = p.flags || [];
        return { bed: p.bed, name: p.name, dx: p.dx, severity: p.sev, flags };
      });
      const todos = taskIds.map(tid => {
        const t = tasks[tid - 1];
        const p = patients.find(x => x.id === t.p);
        return { bed: p.bed, name: p.name, source: t.src, desc: t.t, priority: t.pr };
      });
      return { pats, todos };
    }
    function handoverRecord(id, date, shift, givers, receivers, status, supplement, snap) {
      givers = Array.isArray(givers) ? givers : [givers];
      receivers = Array.isArray(receivers) ? receivers : [receivers];
      const startIso = `${date}T${shift === '白班' ? '08:00' : '20:00'}:00`;
      const finishOffset = status === '超时' ? 38 : 12;       // 超时记录完成时长 > 30 分钟阈值
      const giverSigs = {}, receiverSigs = {};
      const attester = [];
      givers.forEach((g, i) => {
        const t = addMin(startIso, 3 + i * 2);
        giverSigs[g] = Object.assign({ time: t }, caSig(g));
        attester.push({ mode: 'professional', time: t, party: FHIR.refStr('Practitioner', g), _ca: giverSigs[g] });
      });
      receivers.forEach((r, i) => {
        const t = addMin(startIso, finishOffset + i * 2);
        receiverSigs[r] = Object.assign({ time: t }, caSig(r));
        attester.push({ mode: 'legal', time: t, party: FHIR.refStr('Practitioner', r), _ca: receiverSigs[r] });
      });
      const finishTime = addMin(startIso, finishOffset + (receivers.length - 1) * 2);
      const sn = snap ? snapshot(snap.pats, snap.todos) : { pats: [], todos: [] };
      const comp = {
        resourceType: 'Composition', id, status: 'final',
        type: { text: '值班交接班记录' },
        date: startIso,
        title: `${date} ${shift} 交接班记录`,
        author: givers.map(g => FHIR.refStr('Practitioner', g)),
        _shift: shift, _date: date, _org: 'org-card',
        _status: status,           // 正常 / 超时
        _supplement: supplement || '',
        _givers: givers, _receivers: receivers,
        _giverSigs: giverSigs, _receiverSigs: receiverSigs,
        _patientCount: sn.pats.length, _todoCount: sn.todos.length,
        _patientSnapshot: sn.pats, _todoSnapshot: sn.todos,
        attester,
        _finishTime: finishTime,
      };
      C(comp);
      C({
        resourceType: 'Provenance', id: 'prov-' + id,
        target: [FHIR.refStr('Composition', id)],
        recorded: finishTime,
        activity: { text: '交接班双方CA电子签名' },
        agent: [
          ...givers.map(g => ({ who: FHIR.refStr('Practitioner', g), type: { text: '交班医生' } })),
          ...receivers.map(r => ({ who: FHIR.refStr('Practitioner', r), type: { text: '接班医生' } })),
        ],
        signature: [
          ...givers.map(g => ({ type: [{ code: '1.2.840.10065.1.12.1.1', display: '交班签名' }], when: giverSigs[g].time, who: FHIR.refStr('Practitioner', g) })),
          ...receivers.map(r => ({ type: [{ code: '1.2.840.10065.1.12.1.5', display: '接班签名' }], when: receiverSigs[r].time, who: FHIR.refStr('Practitioner', r) })),
        ],
      });
      return comp;
    }
    handoverRecord('comp-01', '2026-06-17', '夜班', 'doc-zw', 'doc-zl', '正常',
      '03床马志强术后血压偏低，已下达补液医嘱，注意复测。',
      { pats: ['pat-01', 'pat-03', 'pat-05'], todos: [6, 7] });
    handoverRecord('comp-02', '2026-06-18', '白班', 'doc-zl', 'doc-zw', '正常', '',
      { pats: ['pat-01', 'pat-02', 'pat-06'], todos: [1, 4] });
    // 演示“多人对多人”交接：夜班两位医生（doc-zw、doc-csy）共同交接给白班两位医生（doc-ln、doc-syt）
    handoverRecord('comp-03', '2026-06-18', '夜班', ['doc-zw', 'doc-csy'], ['doc-ln', 'doc-syt'], '超时',
      'CA签名系统响应慢，08床新发危急值需重点关注。',
      { pats: ['pat-01', 'pat-02', 'pat-08'], todos: [1, 4, 9] });
    handoverRecord('comp-04', '2026-06-19', '白班', 'doc-syt', 'doc-zw', '正常',
      '12床杨秀英血钾偏高，已复查待结果。',
      { pats: ['pat-02', 'pat-04', 'pat-07'], todos: [4, 5, 8] });

    /* ---------------- 异常通知 Communication ---------------- */
    // _givers/_receivers 与关联交接记录的交出方/接收方保持一致，供「交出方」「接收方」两栏展示，
    // 而非笼统的“相关人员”（避免多人交接时无法区分角色）。
    [
      { id: 'comm-01', type: '交接超时', givers: ['doc-zw', 'doc-csy'], receivers: ['doc-ln', 'doc-syt'], org: 'org-card', dur: '8分钟', sent: '2026-06-18T20:38:00', st: '已处理', note: '已电话确认，CA系统延迟导致，已正常完成交接。' },
      { id: 'comm-02', type: '到岗超时', givers: ['doc-zw'], receivers: ['doc-ln'], org: 'org-card', dur: '9分钟', sent: '2026-06-20T08:09:00', st: '未处理', note: '' },
    ].forEach(x => C({
      resourceType: 'Communication', id: x.id, status: 'completed',
      category: [{ text: x.type }],
      priority: 'urgent',
      sent: x.sent,
      recipient: [FHIR.refStr('Practitioner', 'doc-wjg')],
      _givers: x.givers, _receivers: x.receivers,
      payload: [{ contentString: `${x.type}：${x.dur}` }],
      _org: x.org, _duration: x.dur, _handleStatus: x.st, _handleNote: x.note,
    }));

    /* ---------------- 排班模板使用记录 AuditEvent（近30天套用次数，供首页管理员统计） ---------------- */
    [
      { a: '套用排班模板', who: '王建国', t: '2026-06-14T09:00:00', detail: '一周白夜轮转模板 → 06-15~06-21' },
      { a: '套用排班模板', who: '王建国', t: '2026-06-07T09:00:00', detail: '一周白夜轮转模板 → 06-08~06-14' },
      { a: '套用排班模板', who: '周强', t: '2026-06-15T09:00:00', detail: '普外科白夜轮转模板 → 06-15~06-21' },
    ].forEach((x, i) => C({
      resourceType: 'AuditEvent', id: 'audit-tpl-' + (i + 1),
      type: { text: '排班' }, action: 'C', recorded: x.t,
      agent: [{ who: { display: x.who }, requestor: true }], _action: x.a, _detail: x.detail,
    }));

    /* ---------------- 变更记录 AuditEvent ---------------- */
    [
      { id: 'audit-01', a: '同步 FHIR 人员数据', who: '系统管理员', t: '2026-06-02T09:10:00', cat: '数据同步', detail: '更新 12 条人员记录' },
      { id: 'audit-02', a: '同步 FHIR 科室数据', who: '系统管理员', t: '2026-06-02T09:20:00', cat: '数据同步', detail: '更新 4 条科室记录' },
      { id: 'audit-03', a: '修改排班规则', who: '王建国', t: '2026-05-20T14:30:00', cat: '配置变更', detail: '新增“心血管内科标准排班规则”' },
      { id: 'audit-04', a: '修改系统参数', who: '系统管理员', t: '2026-06-10T11:05:00', cat: '配置变更', detail: '交接班超时阈值 30→30 分钟（确认）' },
    ].forEach(x => C({
      resourceType: 'AuditEvent', id: x.id,
      type: { text: x.cat },
      action: 'U', recorded: x.t,
      agent: [{ who: { display: x.who }, requestor: true }],
      _action: x.a, _detail: x.detail,
    }));
  };

  /* ---------- 辅助 ---------- */
  function addMin(isoStr, m) { const x = new Date(isoStr); x.setMinutes(x.getMinutes() + m); return x.toISOString(); }
  function caSig(docId) { return { provider: 'CA签名平台', serial: 'CA-' + docId.toUpperCase() + '-' + Math.floor(Math.random() * 9000 + 1000), verified: true }; }

  SEED.T0 = T0;
  window.SEED = SEED;
})();
