# 死亡病例讨论制度闭环管理系统 · 仿真演示前端（SWBL v2.0）

严格依据 **《BA-UX-design-SWBL（v2.0）.md》** 实现的纯前端仿真系统：按信息架构图完成 **21 个页面**，
所有业务数据以 **FHIR R4 标准资源**表达并通过内置 Mock FHIR Server 完成 CRUD 与检索，
依赖的基础数据在浏览器内存（缓存）中按业务逻辑编造初始化，演示时通过**角色切换**走通
「自动识别 → 上报三级审核 → 组织讨论 → 8 模块记录 + CA 签名归档 → 改进措施任务化 →
效果评估 / PDCA 第二轮 → 全院统计分析与报表」的完整闭环。

## 运行

零依赖、零构建（Vue 3 本地库 + 手写 CSS，无需 npm install）。任选其一：

```bash
# 方式一：仓库根目录统一演示服务（推荐，端口 1599）
cd .. && ./demo.sh start        # 打开 http://10.5.0.4:1599/SWBL/

# 方式二：本目录静态服务
cd SWBL && python3 -m http.server 8099   # 打开 http://localhost:8099
```

自测（前三项复用同级 KJYWFJ/node_modules 中的 jsdom，无需安装依赖）：

```bash
node test/flow-test.js        # 业务闭环与数据层：84 项断言
node test/render-test.js      # 6 身份 × 22 路由渲染 + 403 + 写路径 + index.html 装配：274 项
node test/ui-flow-test.js     # jsdom 真实 DOM 点击走通闭环（含确认框、角色切换）：31 项
node test/coverage-check.js   # 种子覆盖矩阵（各状态/预警/类型均有数据）
node test/browser-e2e.js      # 真实 Chromium：布局溢出/深链/越权/FHIR 查看器/配置联动：39 项
node test/traceability-check.js --verbose   # FD 字段 D001-D130 / 按钮 B001-B105 可追溯性核对
```

`traceability-check.js` 解析设计文档「页面字段清单」的 130 个字段与 105 个按钮，逐条与渲染出的页面文本
及页面源码做归一化标签比对（先本页、再任意页两级匹配），输出命中率与未命中清单。它是**人工核对辅助报表**
（恒为 exit 0）：命中的是文案一致项，未命中的多为同义表述（如文档写「列表总记录数」、界面显示「共 595 条记录」），
需人判断是文案差异还是真缺失 —— 本轮核对出的唯一真缺失（D083 统计概览「数据最后更新时间」）已补齐。

`browser-e2e.js` 需要 Playwright（脚本会自动探测 `~/projects/data-quality-MS/node_modules/playwright`，
也可 `PLAYWRIGHT=/abs/path node test/browser-e2e.js` 指定），并先执行 `./demo.sh start` 起 1599 静态服务。
它负责 jsdom 覆盖不到的部分：真实 CSS 横向溢出、原生 `<select>`/日期控件、hash 深链刷新、
浏览器控制台零报错，并把关键页面截图写入 `test/shots/`（临时证据，可整目录删除）。

## 演示角色（顶部「🎭 演示角色切换」一键切换）

| 演示身份 | 姓名 | 科室 | 场景身份 | 导航角色 | 数据范围 | 可演示的关键操作 |
|---|---|---|---|---|---|---|
| 主管医师 | 李海峰 | 心血管内科 | attending | 临床医师 | 本科室 | 填上报单、书写讨论记录、CA 必签、执行改进措施 |
| 上级医师 | 王建国 | 心血管内科 | senior | 临床医师 | 本科室 | 一级审核、讨论记录 CA 必签 |
| 科主任 | 张德明 | 心血管内科 | director | 科主任 | 本科室 | 安排会议、催办、二级审核、效果评估、标记优秀措施 |
| 科室医师 | 赵敏 | 心血管内科 | doctor | 临床医师 | 本科室 | 确认参会/请假、自愿签名、执行改进 |
| 医务部管理员 | 刘文华 | 医务部 | quality | 医务部管理员 | 全院 | 三级终审、人工判定、统计分析、系统管理 |
| 科主任（对照） | 钱立群 | 呼吸内科 | director | 科主任 | 本科室 | 演示「本科室 vs 全院」数据权限差异 |

顶部工具条另提供：**🎬 本角色演示动线**（按当前角色列出下一步该点哪里）、
**⚡ FHIR 控制台**（实时 `POST/GET/PUT/DELETE /fhir/...` 请求日志）、
**🔍 FHIR 资源**（内存库规范化资源原文 + StructureDefinition）、**↻ 重置演示数据**。

## 推荐演示脚本（约 12 分钟走完 US-1.1 ~ US-1.6）

1. **科主任 张德明** → 讨论管理（待组织、超时行淡红）→ 查看 → 安排会议并发通知 → 一键催办 →
   患者病历资料（含 1 份接口异常 → 手动上传补充、投屏展示）
2. **科室医师 赵敏** → 首页待办「待确认参会」→ 确认参会（或填原因请假）
3. **主管医师 李海峰** → 讨论记录书写：先填一半点「提交签名」→ 缺失清单拦截 →
   「填充演示内容」补全 8 模块 → 提交 → 三人逐一 CA 签名 → **提交归档** →
   自动按模块⑧生成改进任务（跳转改进跟踪）
4. **上级医师 王建国** → 上报管理（审核视图）→ 审核 → 退回修改（必填退回意见）；
   **主管医师** → 列表出现「已退回」→ 修改重提（自被退回层级重新开始）；
   **科主任 → 医务部** 逐级通过 → 标记上报完成并记录完成时间
5. **医务部 刘文华** → 对「待人工判定」行执行**人工判定**（改特殊死亡）→ 时限与优先级即时重算
   （按原死亡时间重算，判定当场可能即超时——这正是超时清单的真实来源）
6. **科主任** → 改进跟踪 → 确认/编辑自动提取的任务（改派责任人、时限）→ 责任人执行 + 提交完成报告 →
   效果评估选「需要持续改进」→ 自动生成第 2 轮 PDCA；另一条选「达标关闭」并标记优秀措施
7. **医务部** → 统计分析 7 页（周期切换、指标卡、下钻清单、导出）、报表管理（生成 / 预览 / 导出 Word / 历史报表）
8. **医务部** → 系统管理：改「时限规则配置」讨论时限 7→1 天 → 回列表看倒计时与超时清单整体翻面；
   改「审批流程配置」为 2 级 → 新上报单按 2 级流转、在途单沿用旧链路；
   改「模板管理」新增必填字段 → 上报单表单立即强制校验；取消某角色的页面权限 → 导航即时隐藏

## 页面清单（对应 IA-1.1 与页面清单表）

| 编号 | 页面 | 路由 | 已实现要点 |
|---|---|---|---|
| L1 | 首页工作台 | `home` | 待办卡片 + 倒计时色标、关键指标环比、预警通知、快速入口、系统通知，按角色差异化 |
| L2-1 | 讨论管理 | `discuss-list` | 5 状态 Tab 带计数、组合筛选、排序、10 列列表、超时行高亮、批量催办、分页、**人工判定弹窗** |
| L3-1-2 | 讨论任务详情 | `discuss-detail` | 进度步骤条、患者/死亡信息、Tab〔会议信息｜病历资料（投屏/手动补充）｜讨论记录（签名面板+8 段只读）〕 |
| L3-1-3 | 讨论记录书写与签名 | `discuss-record` | 模板驱动 8 模块、书写进度、草稿/自动保存、缺失清单、CA 签名、归档联动生成改进任务 |
| L2-2 | 上报管理 | `report-list` | **上报人员 / 审核人员双视图**、三色预警、退回理由展开、批量催办与导出 |
| L3-2-2 | 上报单填写与审核 | `report-form` | 6 模块表单 + 必填校验、5 节点审核流转、退回重提、审核时间线、完成归档视图 |
| L2-3 | 改进跟踪 | `improve-list` | 状态/责任人/超时筛选、执行进度条、PDCA 轮次徽标、优秀措施标记、导出 |
| L3-3-2 | 改进任务详情 | `improve-detail` | 任务编辑确认、执行记录时间线 + 附件、完成报告、三维度效果评估→新一轮 PDCA、变更日志 |
| L3-4-1..7 | 统计分析 7 页 | `stat-overview / dept / cause / trend / improve / timeliness / report` | 月/季/年周期、环比同比、四类排名、死因 TOP10、可避免占比、诊断符合性、严重程度交叉矩阵、超时/漏报清单下钻、趋势文字摘要、报表生成/预览/导出/定时/历史 |
| L3-5-1..6 | 系统管理 6 页 | `sys-template / timeout / basedata / role / notify / approval` | 模板字段编辑+版本回退+预览+启停、时限规则与冲突校验+恢复默认、ICD-10 与分类规则 CRUD+导入导出+日志、角色功能/数据权限树+用户关联+权限预览、12 通知场景+变量模板+测试发送、审批层级/绑定角色/超时升级 |

## FHIR 资源映射

| 业务对象 | FHIR 资源 | 关键原生元素 | 扩展承载 |
|---|---|---|---|
| 科室 | `Organization` | name / type / active / identifier | `beds`、`deptCode`、`deptKind` |
| 人员 / 角色与数据范围 | `Practitioner` + **`PractitionerRole`** | qualification、practitioner、organization、code | `title`；`dataScope`(modifier)、`scenes`、`navRole` |
| 患者（已故） | `Patient` | **deceasedDateTime**、identifier(MRN)、gender、birthDate | `ageYears`、`bedNo`、`signedWaiver` |
| 住院死亡病例 | `Encounter` | status=finished、class=IMP、period、participant[ATND]、serviceProvider、dischargeDisposition=expired | **`deathType`(modifier)**、`caseNo`、`attendingName`、`classifyRuleId`、`losDays` |
| 入院/死亡主要/次要/合并症诊断 | `Condition` | code(ICD-10)、category、**severity**、subject、encounter | `catCode`、`isPrimary` |
| 诊断符合性 / 严重程度 / 出院人次 / 检验结果 | `Observation` | code、valueCodeableConcept、valueQuantity、effective(Period) | `obsKind`、`refRange`、`abnormal` |
| 手术 | `Procedure` | status、code、performedDateTime | `anaesthesia`、`opGrade` |
| 病历资料（6 类 / 接口异常 / 手动补充） | `DocumentReference` | type、status、content.attachment.data(base64)、context.encounter | `docType`、**`fetchError`(modifier)**、`sourceType`、`periodText` |
| 讨论 / 上报 / 改进任务 | **`Task`** | code(判别)、**status + businessStatus**、priority、dueDate、completedDate、owner、partOf(PDCA)、basedOn、note(执行记录)、executionPeriod、instantiatesCanonical | `taskKind`(modifier)、`approvalFlow`、`completionReport`、`pdca`、`expectedEffect`、`measureText`、`deadlineSig`、`returnReason`、`excellent` |
| 讨论会议与参会确认 | `Appointment` | status、start/end、**participant.actor/required/status**、subject、instruction | `meeting`、`partyMeta`、`notifyChannels` |
| 讨论记录 8 模块 / 上报单 6 模块 | **`QuestionnaireResponse`** | item 嵌套 group、linkId=`模块.字段`、value[x]、status draft→submitted、subject、basedOn | `draftMeta`、`respondentName` |
| 签名与归档 | **`Composition`** | status preliminary→final、**attester[mode/time/party]**、section、custodian、relatesTo | `archiveMeta`、`archivedAt`、`recordNo` |
| 模板（字段定义与版本） | `Questionnaire` | item[].linkId/type/required/repeats/maxLength、url、version、status | `templateKind`、`modules`、`history`；item 级 `minLength`/`prefilled` |
| 审批流程配置 | `PlanDefinition` | status、version、url | `nodes`（层级 / 角色 / 超时 / 升级） |
| 效果评估（3 维度） | `Observation` | subject=Task、component[]×3 | `detail`（意见 / 评估人 / 优秀 / 下轮） |
| 通知（多渠道 / 已读 / 业务关联） | `Communication` | category、medium[]、sent、recipient、payload、about | `scene`、`title`、`read`、`targetUser`、`level` |
| 留痕与操作日志 | `Provenance` | activity、agent、recorded、reason、entity | `note`、`bizId`、`bizTaskId`、`from`/`to` |
| ICD-10 基础数据 | `CodeSystem` + `ValueSet` | concept 两级（大类→编码）、property(weight) | — |
| 分类规则 / 时限 / 通知场景 / 角色权限 / 报表定时 | `Basic` | code | `rules`、`config`、`items`、`pages`、`scopes` |
| 统计口径与历史报表 | `Measure`×8 + `MeasureReport` | group.population/stratifier、period、measure、date | `dataset`（报表章节快照） |
| 扩展声明 | `StructureDefinition` | baseDefinition=Extension、context、derivation | 119 个，逐个声明业务扩展 |

> 存储层为纯 FHIR：`FHIR.create / read / update / patch / remove / search / bundle / transaction`。
> 业务代码书写可读的 `res.ext` 投影，入库时由 `fhir-ext.js` 编码为规范 `extension` /
> `modifierExtension`（标量→`valueCode/valueString/valueInteger/valueBoolean`，重复字段→多条目，
> 复杂结构→`valueString` 承载 JSON），读取时解码还原，且全部在 `StructureDefinition` 中显式声明。

## 业务规则实现要点

- **单一事实源**：死亡时间只有 `Patient.deceasedDateTime`（`Encounter.period.end` 同步）；实际讨论时间取讨论任务 `executionPeriod.end`；上报完成与实际落实时间取 `Task.completedDate`。状态、倒计时、达标率、超时天数、住院天数、优先级一律现算，不冗余存储。
- **时限单一真源**（`js/limits.js`）：讨论/上报时限、黄 `<50%`／橙 `<20%`／红超时阈值、改进临近提醒天数、审核超时小时全部读自「时限规则配置」；`Task.dueDate` 仅是带 `deadlineSig` 的缓存，配置版本一变即自愈重算 —— 配置保存的瞬间，全局倒计时、三色预警、达标率、超时清单同步翻面（满足 IX-1.6「页面不可硬编码」）。
- **自动分类引擎**（`Classify`）：12 条规则（麻醉意外 / 输血反应 / 药物过敏 / 医疗纠纷 → 特殊；入院 48h 内 / 术后 30 天内 / 突然死亡 / 抢救无效 → 非预期；恶性肿瘤晚期 / 慢病终末期 / 高龄 / 放弃抢救 → 预期）全部来自「基础数据管理」；命中即决定类型与优先级，未命中 → **待人工判定**。页面增删规则会即时改变新病例分类结果。
- **状态机**（`js/workflow.js`）：讨论 待组织→进行中→待签名→已完成；上报 待填写→一/二/三级→已完成（含退回层级记忆）；改进 未开始→进行中→待评估→已完成／已取消（持续改进为派生徽标）；病历调阅状态与讨论记录锁级别（none/content/full）均为派生。
- **归档联动**：必签（科主任·主持人 / 主管医师 / 上级医师）齐签 → 记录 `final` 锁定 → 生成归档 `DocumentReference` → 讨论任务收口 → 发布「讨论完成」事件（`Provenance`）→ **按模块⑧逐条自动创建改进任务**并通知责任人。
- **数据权限**：所有列表统一经 `Svc.inScope()` 收口（临床医师 / 科主任=本科室，医务部=全院，改进任务额外可见本人负责项），与 IA-3.3 一致；越权路由渲染 403。病例详情页另在路由层 `App.canSee()` 做**病例级数据范围**二次校验——页面权限 + 该病例是否属于当前角色，手工改 hash 深链他科病例同样落到 403，不会读出患者信息。
- **已关闭任务的时限呈现**：讨论归档 / 上报终审通过后倒计时停止走时，`剩余时限` 改显 **按时完成**（绿）或 **超时完成**（橙），判定口径为「实际完成时刻 vs 按当前规则重算的截止时间」，与 `Limit.achieved()` 和时效分析的达标率完全同源；超时行的淡红高亮与「N 条已超时」图例只统计尚未关闭的任务。

## 与文档不一致处的裁决（以 FD 字段表与按钮可用条件为准）

1. 首页关键指标卡全员可见，但「查看详情」跳转仅医务部（B003）。
2. 讨论进度步骤条统一 5 节点，文案按「已完成=已X、当前=待X」派生（D029 4 节点与线框 5 节点的命名冲突折中）。
3. 改进任务第五态取**待评估**（F070/D066），「持续改进」作为派生徽标（IA-2.7 的第五态）。
4. 通知场景 12 条（IA-2.20 的 10 类 + 时限预警拆黄/橙/红）。
5. 预警色统一按剩余时间**占比**（阈值可配），绝对值仅用于文字格式（`2d 6h`／`4h`）。
6. 「人工判定」按钮严格按 B011：仅「待人工判定」行 + 医务部管理员可见。
7. 上报时限与讨论时限同样锚定死亡时间（AC4 的「结合讨论完成」不作为依赖校验）。
8. 人工判定按原死亡时间重算时限，判定当场可能即超时（B014 已承诺更新任务时限）。
9. 6 个演示身份映射 3 个导航角色（IA-3.3），页面内按钮按场景身份判定。
10. 手动补充病历的 `relatesTo.code` 用 `component`（R4 无 appends 码）。
11. 效果评估（IX-2.9 提到的 L3-3-1）内嵌于 L3-3-2 详情页，与 FD-1.9 及跳转链路一致。

## 目录结构

```
SWBL/
  index.html   css/styles.css   lib/vue.global.prod.js
  js/  fhir-store.js  fhir-ext.js  fhir-codesystems.js  domain.js
       limits.js  workflow.js  seed.js  case-factory.js  seed-cases.js
       services.js  stats.js  app.js
  js/components/common.js      通用组件（弹窗/抽屉/分页/标签/步骤条/时间线/进度/空态/骨架/图表）
  js/pages/<route>.js          22 个页面组件（IA 的 21 条业务路由 + 403 越权页）
  test/ flow-test.js  render-test.js  ui-flow-test.js  browser-e2e.js
         coverage-check.js  traceability-check.js
```

种子规模：约 **595 例死亡病例 / 24 个月 / 12 个临床科室**、8300+ 个 FHIR 资源。近 3 个月病例带完整流程
工件（病历文档、会议、讨论记录、上报单与审核链、改进任务与评估、通知与留痕），历史月份只产统计所需的
终态事实。所有时间相对**打开页面的真实时刻**偏移，因此绿/黄/橙/红四态与超时清单在任何日期演示都成立；
随机量使用固定种子 PRNG，同一时刻刷新数据完全可复现，「↻ 重置演示数据」可随时恢复初始状态反复演示。
