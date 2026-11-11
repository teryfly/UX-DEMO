/* =====================================================================
 * fhir-codesystems.js —— 受控词表、ICD-10 基础数据与 Profile 声明
 * ---------------------------------------------------------------------
 * 1) Vocab：系统内部全部编码概念的 CodeSystem 定义（死亡类型、任务类型、
 *    文档类型、评估维度、通知场景、Provenance 活动…），供资源 coding 引用。
 * 2) ICD10：ICD-10 死亡原因编码（18 大类 / 60+ 概念），作为「基础数据管理」
 *    页可增删改的 CodeSystem 内容，并驱动死亡病例的诊断大类分布与交叉分析。
 * 3) structureDefinitions()：为所有承载业务数据的 extension 生成
 *    StructureDefinition 资源，保证「扩展不是随手塞的 JSON」，可在
 *    FHIR 资源查看器中逐条追溯。
 * ===================================================================== */
(function (global) {
  'use strict';

  var SYS = 'https://fhir.swbl-demo.example/CodeSystem/';

  /* ───── 受控词表（概念 → 显示名） ───── */
  var Vocab = {
    'death-type': [
      ['expected', '预期死亡'], ['unexpected', '非预期死亡'],
      ['special', '特殊死亡'], ['pending', '待人工判定']
    ],
    'task-kind': [
      ['discussion', '死亡病例讨论任务'], ['report', '死亡病例上报任务'],
      ['improvement', '改进措施跟踪任务']
    ],
    'task-status-map': [
      ['not-started', '未开始'], ['requested', '待执行'], ['in-progress', '进行中'],
      ['received', '待评估'], ['completed', '已完成'], ['cancelled', '已取消']
    ],
    'doc-type': [
      ['admission', '入院记录'], ['progress', '病程记录'], ['surgery', '手术记录'],
      ['rescue', '抢救记录'], ['death', '死亡记录'], ['exam', '检查检验结果']
    ],
    'condition-category': [
      ['admission', '入院诊断'], ['death-main', '死亡主要诊断'],
      ['death-secondary', '死亡次要诊断'], ['comorbidity', '合并症']
    ],
    'obs-code': [
      ['dx-concordance', '入院-死亡诊断符合性'], ['serv-pop-discharges', '同期出院人数'],
      ['severity-score', '疾病严重程度评分'], ['lab-result', '检验结果'], ['imaging-result', '检查结果']
    ],
    'eval-dimension': [
      ['implemented', '措施是否落实'], ['effective', '效果是否达到预期'], ['continue', '是否需要持续改进']
    ],
    'notify-scene': [
      ['task-created', '任务生成通知'], ['meeting-invite', '会议通知'], ['attend-remind', '参会确认提醒'],
      ['review-task', '审核任务通知'], ['review-result', '审核结果通知'],
      ['warn-yellow', '时限黄色预警'], ['warn-orange', '时限橙色预警'], ['warn-red', '时限超时预警'],
      ['escalate', '超时升级通知'], ['improve-remind', '改进任务提醒'],
      ['completion-report', '完成报告通知'], ['eval-result', '评估结果通知']
    ],
    'provenance-activity': [
      ['auto-classify', '系统自动分类'], ['manual-judge', '人工判定'], ['arrange-meeting', '安排会议'],
      ['attend-confirm', '参会确认'], ['urge', '催办提醒'], ['submit-report', '提交上报'],
      ['approve', '审核通过'], ['return', '审核退回'], ['submit-record', '提交讨论记录'],
      ['sign', 'CA 数字签名'], ['archive', '归档'], ['create-improvement', '生成改进任务'],
      ['update-progress', '更新执行进度'], ['submit-completion', '提交完成报告'],
      ['evaluate', '效果评估'], ['mark-excellent', '标记优秀措施'], ['config', '配置变更'],
      ['basedata', '基础数据变更'], ['role-perm', '角色权限变更'], ['chart-fetch', '病历调阅'],
      ['chart-upload', '手动补充病历'], ['export', '数据导出']
    ],
    'medium': [['app', 'APP 推送'], ['site', '站内消息'], ['sms', '短信'], ['wechat', '微信']],
    'business-status': [
      ['to-organize', '待组织'], ['in-progress', '进行中'], ['to-sign', '待签名'], ['archived', '已完成'],
      ['to-fill', '待填写'], ['level-1', '待一级审核'], ['level-2', '待二级审核'], ['level-3', '待三级审核'],
      ['returned', '已退回'], ['done', '已完成'],
      ['not-started', '未开始'], ['to-evaluate', '待评估'], ['cancelled', '已取消']
    ],
    'concordance': [['match', '符合'], ['partly', '部分符合'], ['unmatch', '不符合']],
    'eval': [['yes', '是'], ['no', '否'], ['partly', '部分']],
    'scene': [
      ['attending', '主管医师'], ['senior', '上级医师'], ['director', '科主任'],
      ['doctor', '科室全体医师'], ['quality', '医务部管理员'], ['owner', '任务责任人']
    ],
    'org-type': [['dept-clinical', '临床科室'], ['dept-admin', '职能科室'], ['dept-tech', '医技科室']],
    'severity': [['mild', '轻度'], ['moderate', '中度'], ['severe', '重度'], ['critical', '极重度']],
    'report-type': [
      ['monthly', '月度死亡统计报表'], ['quarterly', '季度死亡病例分析'],
      ['annual', '年度死亡病例质量报告'], ['unexpected', '非预期死亡专项分析报告']
    ]
  };

  function code(kind, system) {
    var list = Vocab[kind] || [];
    var out = {};
    out[kind] = list.map(function (c) { return { code: c[0], display: c[1] }; });
    return { system: system || (SYS + kind), display: list.length ? list[0][1] : '' };
  }

  /* cc('death-type','unexpected') → CodeableConcept */
  function cc(kind, c, display) {
    var list = Vocab[kind] || [];
    var name = display;
    if (!name) for (var i = 0; i < list.length; i++) if (list[i][0] === c) name = list[i][1];
    return { coding: [{ system: SYS + kind, code: c, display: name || c }], text: name || c };
  }

  /* ───── ICD-10 死亡原因编码（大类 → 编码明细） ─────
   * weight：种子生成时的相对权重，使 TOP10 排行呈现真实梯度 */
  var ICD_GROUPS = [
    { cat: '循环系统疾病', system: 'ICD-10', items: [
      ['I21.9', '急性心肌梗死', 13, '冠状动脉急性闭塞致心肌坏死'],
      ['I25.1', '动脉粥样硬化性心脏病', 8, '慢性冠脉病变心衰终末'],
      ['I50.9', '心力衰竭', 10, '难治性充血性心力衰竭'],
      ['I48.9', '心房颤动', 3, '快速房颤致血流动力学障碍'],
      ['I26.9', '肺栓塞', 3, '大面积肺动脉栓塞'],
      ['I71.9', '主动脉瘤破裂', 2, '主动脉夹层/动脉瘤破裂']
    ] },
    { cat: '脑血管疾病', system: 'ICD-10', items: [
      ['I61.9', '脑出血', 8, '自发性脑出血破入脑室'],
      ['I63.9', '脑梗死', 7, '大面积脑梗死伴脑疝'],
      ['I60.9', '蛛网膜下腔出血', 3, '动脉瘤破裂致 SAH']
    ] },
    { cat: '呼吸系统疾病', system: 'ICD-10', items: [
      ['J18.9', '肺炎', 7, '重症社区获得性肺炎'],
      ['J44.1', '慢性阻塞性肺疾病伴急性加重', 5, '慢阻肺终末期呼吸衰竭'],
      ['J96.9', '呼吸衰竭', 6, 'Ⅱ型呼吸衰竭'],
      ['J80', '急性呼吸窘迫综合征', 3, 'ARDS 多器官支持无效'],
      ['J98.4', '术后肺部并发症', 2, '肺不张/排痰障碍']
    ] },
    { cat: '消化系统疾病', system: 'ICD-10', items: [
      ['K27.5', '胃溃疡伴出血', 3, '上消化道大出血'],
      ['K74.6', '肝硬化', 4, '失代偿期肝硬化伴消化道出血'],
      ['K85.9', '急性胰腺炎', 3, '重症坏死性胰腺炎'],
      ['K72.9', '肝衰竭', 2, '肝性脑病']
    ] },
    { cat: '恶性肿瘤', system: 'ICD-10', items: [
      ['C34.9', '支气管和肺恶性肿瘤', 12, '晚期肺癌多线治疗后进展'],
      ['C16.9', '胃恶性肿瘤', 5, '晚期胃癌恶病质'],
      ['C50.9', '乳腺恶性肿瘤', 3, '乳腺癌广泛转移'],
      ['C22.9', '肝恶性肿瘤', 4, '原发性肝癌破裂/衰竭'],
      ['C81.9', '霍奇金淋巴瘤', 1, '血液肿瘤终末期'],
      ['C25.9', '胰腺恶性肿瘤', 3, '胰腺癌晚期']
    ] },
    { cat: '泌尿生殖系统疾病', system: 'ICD-10', items: [
      ['N17.9', '急性肾衰竭', 3, '横纹肌溶解/休克肾'],
      ['N18.9', '慢性肾病', 4, '尿毒症透析中断'],
      ['N39.0', '尿路感染', 2, '尿源性脓毒症']
    ] },
    { cat: '感染性与寄生虫疾病', system: 'ICD-10', items: [
      ['A41.9', '脓毒症', 8, '感染性休克多器官衰竭'],
      ['A16.2', '肺结核', 2, '结核终末期'],
      ['A09', '感染性胃肠炎', 1, '重度脱水电解质紊乱']
    ] },
    { cat: '内分泌营养代谢疾病', system: 'ICD-10', items: [
      ['E11.9', '2型糖尿病', 4, '糖尿病酮症/高渗昏迷'],
      ['E86', '容量不足', 2, '重度脱水'],
      ['E87.2', '酸中毒', 2, '代谢性酸中毒']
    ] },
    { cat: '血液免疫系统疾病', system: 'ICD-10', items: [
      ['D69.6', '血小板减少', 2, 'ITP 颅内出血'],
      ['D89.9', '免疫系统疾患', 1, '免疫抑制继发感染']
    ] },
    { cat: '神经系统疾病', system: 'ICD-10', items: [
      ['G60.9', '遗传性共济失调', 1, '神经退行性疾病终末'],
      ['G40.9', '癫痫持续状态', 2, '癫痫持续状态']
    ] },
    { cat: '精神行为障碍', system: 'ICD-10', items: [
      ['F10.9', '酒精使用障碍', 1, '酒精依赖戒断'],
      ['F32.9', '抑郁发作', 1, '重度抑郁']
    ] },
    { cat: '肌肉骨骼结缔组织疾病', system: 'ICD-10', items: [
      ['M81.9', '骨质疏松', 1, '骨质疏松性骨折并发症'],
      ['M31.5', '血管炎', 1, '系统性血管炎']
    ] },
    { cat: '损伤与中毒', system: 'ICD-10', items: [
      ['T14.9', '多发伤', 4, '严重创伤失血性休克'],
      ['T79.4', '创伤后失血性休克', 3, '创伤大出血'],
      ['X49', '意外中毒', 1, '药物/毒物中毒'],
      ['T90.5', '颅内损伤后遗症', 1, '重型颅脑损伤']
    ] },
    { cat: '手术、治疗与麻醉并发症', system: 'ICD-10', items: [
      ['Y83.6', '麻醉的有害效应', 2, '麻醉意外'],
      ['T80.9', '输注相关并发症', 1, '输血反应'],
      ['T88.6', '药物有害效应', 2, '药物过敏'],
      ['T81.4', '操作后并发症', 3, '术后感染/出血']
    ] },
    { cat: '症状和体征', system: 'ICD-10', items: [
      ['R09.2', '呼吸骤停', 4, '院内心跳呼吸骤停'],
      ['R57.9', '休克', 3, '不明类型休克']
    ] },
    { cat: '围产期疾病', system: 'ICD-10', items: [
      ['P22.0', '新生儿窒息', 1, '重度窒息'],
      ['P07.3', '早产', 1, '极早早产儿']
    ] },
    { cat: '妊娠分娩产褥期并发症', system: 'ICD-10', items: [
      ['O15.0', '重度子痫前期', 1, '子痫'],
      ['O72.1', '产后出血', 1, '羊水栓塞']
    ] },
    { cat: '先天畸形', system: 'ICD-10', items: [
      ['Q24.9', '先天性心脏病', 1, '复杂先心病术后']
    ] },
    { cat: '皮肤皮下组织疾病', system: 'ICD-10', items: [
      ['L03.9', '蜂窝织炎', 1, '坏死性筋膜炎']
    ] }
  ];

  function icdFlat() {
    var out = [];
    ICD_GROUPS.forEach(function (g) {
      g.items.forEach(function (it) {
        out.push({ code: it[0], name: it[1], cat: g.cat, weight: it[2], note: it[3] });
      });
    });
    return out;
  }

  /* ───── 业务扩展字段声明（用于生成 StructureDefinition） ───── */
  var EXT_FIELDS = {
    Organization: ['deptCode', 'beds', 'isClinical', 'deptKind'],
    Practitioner: ['titleCode', 'title', 'phone'],
    PractitionerRole: ['dataScope', 'scenes', 'navRole', 'isDemoUser'],
    Patient: ['mrn', 'bedNo', 'admitTime', 'ageYears', 'dischargeDisposition', 'signedWaiver'],
    Encounter: ['deathType', 'deathTime', 'deathPlace', 'attendingName', 'partyNote', 'caseNo', 'autoClassified', 'classifyRuleId', 'losDays'],
    Condition: ['catCode', 'isPrimary', 'sensitivity'],
    Procedure: ['surgeryName', 'opGrade', 'anaesthesia', 'outcome'],
    Observation: ['obsKind', 'dataset', 'detail', 'abnormal', 'refRange'],
    DocumentReference: ['fetchError', 'sourceType', 'docType', 'docTitle', 'periodText', 'uploadedBy'],
    Task: ['taskKind', 'approvalFlow', 'completionReport', 'deadlineSig', 'pdca', 'caseInfo', 'decision', 'returnReason', 'expectedEffect', 'excellent', 'measureText', 'sourceRecordId', 'tags', 'improveState'],
    Appointment: ['meeting', 'partyMeta', 'notifyChannels', 'meetingTitle', 'location', 'preparedBy'],
    Questionnaire: ['modules', 'history', 'templateKind'],
    QuestionnaireResponse: ['draftMeta', 'respondentName', 'missingList'],
    Composition: ['archiveMeta', 'archivedAt', 'recordNo'],
    PlanDefinition: ['nodes', 'flowKind'],
    Measure: ['measureKind', 'formula'],
    MeasureReport: ['dataset', 'indicators', 'table', 'generatedBy', 'fileKind'],
    Communication: ['scene', 'payload', 'read', 'bizId', 'bizKind', 'level', 'targetUser', 'targetRole', 'title'],
    Provenance: ['activity', 'from', 'to', 'note', 'change', 'bizId', 'bizKind', 'operatorName', 'ruleId', 'used'],
    Basic: ['configKind', 'rules', 'items', 'pages', 'config', 'scopes', 'settings', 'summary'],
    CodeSystem: ['concept', 'groupCount', 'conceptCount'],
    ValueSet: ['boundTo'],
    StructureDefinition: ['fieldKind', 'note']
  };

  /* 为每个业务扩展字段生成 StructureDefinition（kind=complex-type 的扩展定义） */
  function structureDefinitions(BASE) {
    var out = [];
    var seq = 0;
    Object.keys(EXT_FIELDS).forEach(function (rt) {
      var reg = (global.FHIRExt && global.FHIRExt.REGISTRY[rt]) || {};
      EXT_FIELDS[rt].forEach(function (field) {
        seq++;
        var isModifier = (reg.modifier || []).indexOf(field) >= 0;
        var isJson = (reg.json || []).indexOf(field) >= 0;
        var isList = (reg.list || []).indexOf(field) >= 0 || (reg.json || []).indexOf(field) >= 0;
        var valueTypes = isJson ? 'string（JSON 序列化）' : (isList ? '重复标量' : '标量');
        out.push({
          resourceType: 'StructureDefinition',
          id: 'StructureDefinition-' + String(seq).padStart(3, '0'),
          url: BASE + rt + '-' + field,
          name: rt + '_' + field,
          title: rt + '.' + field,
          status: 'active',
          kind: 'complex-type',
          abstract: false,
          type: 'Extension',
          baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Extension',
          derivation: 'constraint',
          description: (isModifier ? '【modifierExtension】' : '【extension】') + rt + ' 承载业务字段 ' + field +
            '；取值形态：' + valueTypes + '。' + (isJson ? '（复杂结构以 valueString 承载 JSON，real-world FHIR 常见做法）' : ''),
          context: [{ type: 'element', expression: rt }],
          ext: { fieldKind: isModifier ? 'modifier' : (isJson ? 'json' : (isList ? 'list' : 'scalar')), note: rt + ' Profile' }
        });
      });
    });
    return out;
  }

  global.Vocab = {
    SYS: SYS, Vocab: Vocab, cc: cc, code: code, icdFlat: icdFlat,
    ICD_GROUPS: ICD_GROUPS, EXT_FIELDS: EXT_FIELDS, structureDefinitions: structureDefinitions
  };
})(typeof window !== 'undefined' ? window : globalThis);
