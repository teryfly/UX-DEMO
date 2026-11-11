/* =====================================================================
 * seed-cases.js —— 演示病例剧本（showcase + 开放态覆盖 + 历史背景量）
 * ---------------------------------------------------------------------
 * 覆盖矩阵保证：讨论四态、上报六态、改进五态、死亡类型四态、优先级三档、
 * 三色预警（正常/黄/橙/红）、PDCA 第二轮、优秀措施、退回重提、超时讨论、
 * 漏报未上报、接口异常病历、参会混合状态等，在演示当天都有真实数据可看。
 *
 * 演示身份集中在 dept-1 心血管内科（李海峰/王建国/张德明/赵敏）与
 * dept-2 呼吸内科（钱立群），因此开放态病例优先落在这两个科室；
 * 其余科室由背景量支撑全院统计与排名。
 * ===================================================================== */
(function (global) {
  'use strict';

  var S = global.Seed, CF = global.CaseFactory, D = global.Domain, Limit = global.Limit;
  var DAY = S.day, HOUR = S.hour;
  var chance = CF.chance, weighted = CF.weighted, int = S.int;
  var NOW = S.T0;

  function ms(offset) { return NOW + offset; }

  /* ───── 1. showcase：与低保真原型对齐的手写病例（姓名可预测） ───── */
  function showcase() {
    var cases = [
      // ① 待组织 · 非预期 · 高优先级 · 已超时（演示超时清单、催办、上报待填写）
      {
        deptIdx: 1, mode: 'full', patient: { name: '王秀兰', age: 68, gender: 'female' }, icd: 'I21.9',
        deathMs: ms(-3 * DAY - 6 * HOUR), losHours: 40, attending: '李海峰', senior: '王建国', director: '张德明',
        facts: { losHours: 40, suddenDeath: false, rescueFailed: true, terminal: false },
        discuss: { state: 'to-organize' }, report: { state: 'to-fill' },
        showcase: true, provenance: [{ code: 'auto-classify', text: '系统自动分类', note: '命中规则 CR-08 抢救无效死亡 → 非预期死亡，讨论时限 3 天' }]
      },
      // ② 待组织 · 特殊死亡 · 橙色即将超时（演示强制上报与高优先级）
      {
        deptIdx: 1, mode: 'full', patient: { name: '陈志强', age: 45, gender: 'male' }, icd: 'T88.6',
        deathMs: ms(-22 * HOUR), losHours: 96, attending: '李海峰',
        facts: { deathDx: '药物过敏致过敏性休克', suddenDeath: true, rescueFailed: true },
        discuss: { state: 'to-organize' }, report: { state: 'level-1' },
        showcase: true
      },
      // ③ 待人工判定（演示医务部「人工判定」弹窗与判定后时限重算）
      {
        deptIdx: 1, mode: 'full', patient: { name: '周桂芳', age: 57, gender: 'female' }, icd: 'R09.2',
        deathMs: ms(-2 * DAY - 3 * HOUR), losHours: 260, attending: '李海峰',
        facts: { deathDx: '呼吸循环衰竭待查', icdCat: '症状和体征', terminal: false, suddenDeath: false, rescueFailed: false, hasDispute: false, signedWaiver: false, losHours: 260, daysSinceSurgery: null },
        hasSurgery: false,
        discuss: { state: 'to-organize' }, report: { state: 'to-fill' },
        showcase: true
      },
      // ④ 进行中 · 会议已安排 · 参会状态混合（演示确认参会/请假/催办）
      {
        deptIdx: 1, mode: 'full', patient: { name: '刘德福', age: 72, gender: 'male' }, icd: 'J18.9',
        deathMs: ms(-4 * DAY), losHours: 120, attending: '李海峰',
        discuss: { state: 'booked', meetingMs: ms(1 * DAY + 4 * HOUR), attendMixed: true },
        report: { state: 'level-2' },
        showcase: true
      },
      // ⑤ 进行中 · 会议已召开 · 讨论记录草稿（演示 8 模块书写、进度、缺失清单）
      {
        deptIdx: 1, mode: 'full', patient: { name: '张丽华', age: 64, gender: 'female' }, icd: 'C16.9',
        deathMs: ms(-6 * DAY), losHours: 300, attending: '李海峰',
        discuss: { state: 'draft', meetingMs: ms(-DAY - 2 * HOUR), draftComplete: false },
        report: { state: 'level-3' },
        docError: ['surgery'], docManual: [],
        showcase: true
      },
      // ⑥ 待签名 · 必签 1/3（演示 CA 签名面板与归档门禁）
      {
        deptIdx: 1, mode: 'full', patient: { name: '孙国平', age: 59, gender: 'male' }, icd: 'I61.9',
        deathMs: ms(-8 * DAY), losHours: 60, attending: '李海峰',
        facts: { suddenDeath: true, rescueFailed: true, terminal: false, daysSinceSurgery: null },
        discuss: { state: 'to-sign', meetingMs: ms(-3 * DAY), signed: 1 },
        report: { state: 'done' },
        showcase: true
      },
      // ⑦ 已归档 · 改进任务全状态（演示改进跟踪与效果评估）
      {
        deptIdx: 1, mode: 'full', patient: { name: '吴海涛', age: 66, gender: 'male' }, icd: 'I25.1',
        deathMs: ms(-26 * DAY), losHours: 220, attending: '李海峰',
        discuss: { state: 'archived', meetingMs: ms(-22 * DAY), signedAtMs: ms(-21 * DAY) },
        report: { state: 'done' },
        improve: { states: ['not-started', 'in-progress', 'to-evaluate', 'done'] },
        showcase: true
      },
      // ⑧ 已归档 · 超时讨论（演示时效分析超时清单下钻）
      {
        deptIdx: 2, mode: 'full', patient: { name: '郑淑芬', age: 74, gender: 'female' }, icd: 'J44.1',
        deathMs: ms(-40 * DAY), losHours: 36 * 24, attending: '胡文华',
        discuss: { state: 'archived', meetingMs: ms(-30 * DAY), signedAtMs: ms(-30 * DAY) },
        report: { state: 'done', late: true },
        improve: { states: ['done', 'cancelled'] },
        showcase: true
      },
      // ⑨ 呼吸内科 · 待组织（演示钱立群仅见本科室）
      {
        deptIdx: 2, mode: 'full', patient: { name: '马长庚', age: 70, gender: 'male' }, icd: 'J96.9',
        deathMs: ms(-1 * DAY - 8 * HOUR), losHours: 70,
        facts: { rescueFailed: true },
        discuss: { state: 'to-organize' }, report: { state: 'level-1' },
        showcase: true
      },
      // ⑩ 呼吸内科 · 上报被退回（演示退回修改与重新提交）
      {
        deptIdx: 2, mode: 'full', patient: { name: '林宝珍', age: 61, gender: 'female' }, icd: 'A41.9',
        deathMs: ms(-5 * DAY), losHours: 150,
        facts: { rescueFailed: true, suddenDeath: false },
        discuss: { state: 'booked', meetingMs: ms(2 * DAY) },
        report: { state: 'returned', returnedLevel: 2, returnNote: '抢救措施记录与死亡时间不一致，请核对后重新提交。' },
        showcase: true
      },
      // ⑪ 呼吸内科 · 待签名（演示他科室的签名链路完整性）
      {
        deptIdx: 2, mode: 'full', patient: { name: '高连生', age: 68, gender: 'male' }, icd: 'C34.9',
        deathMs: ms(-9 * DAY), losHours: 400,
        discuss: { state: 'to-sign', meetingMs: ms(-5 * DAY), signed: 2 },
        report: { state: 'level-3' },
        showcase: true
      }
    ];
    cases.forEach(function (c) { CF.make(c); });
  }

  /* ───── 2. 开放态覆盖：近 3 个月的在办病例（散布各科室，供医务部看全院） ─────
   * 死亡时间按目标预警档位反推，保证「正常/黄/橙/红」四档在演示当天都有数据 */
  function deathMsFor(kind, level, deathType) {
    var limit = Limit.daysOf(kind, deathType) * DAY;
    var ratio = { normal: 0.3, yellow: 0.65, orange: 0.9, red: 1.15 }[level];
    return NOW - Math.round(limit * ratio) - int(0, 50) * 60000;
  }
  function openCases() {
    var discussStates = ['to-organize', 'booked', 'draft', 'to-sign', 'archived'];
    var reportStates = ['to-fill', 'level-1', 'level-2', 'level-3', 'returned', 'done'];
    var levels = ['normal', 'yellow', 'orange', 'red'];
    var types = ['expected', 'unexpected', 'special', 'pending'];
    // 16 例落在本统计月（用于演示三色预警与在办流转），8 例为历史积压（超时未办清单来源）
    var monthShift = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3];
    for (var i = 0; i < 24; i++) {
      var dept = 1 + (i % 12);
      var ds = discussStates[i % discussStates.length];
      var rs = reportStates[(i + 2) % reportStates.length];
      var level = levels[i % levels.length];
      var deathType = types[(i + 1) % types.length];
      // 让讨论时限处于目标预警档位（上报时限同类型时同步近似）
      var deathMs = deathMsFor('discussion', level, deathType) - (monthShift[i] || 0) * 30 * DAY;
      if (monthShift[i]) level = 'red';
      var plans = {
        deptIdx: dept, mode: 'full', deathMs: deathMs, losHours: 12 + (i * 13) % 500,
        discuss: {
          state: ds, meetingMs: deathMs + Limit.daysOf('discussion', deathType) * DAY / 2,
          attendMixed: i % 3 === 0, signed: i % 4, draftComplete: i % 2 === 0
        },
        report: { state: rs === 'done' && ds !== 'archived' ? 'level-3' : rs, returnedLevel: 1 + (i % 3) },
        improve: { due: ['normal', 'soon', 'overdue'], states: i % 2 ? null : ['done', 'in-progress'] },
        docError: i % 11 === 0 ? ['progress'] : null,
        docManual: i % 8 === 0 ? ['exam'] : null,
        // 用事实微调使死亡类型贴近目标（分类引擎仍按规则实算）
        facts: deathType === 'expected' ? { terminal: true, losHours: 300, suddenDeath: false, rescueFailed: false, daysSinceSurgery: null, hasDispute: false }
          : deathType === 'special' ? { forceSpecial: true, deathDx: '麻醉意外', losHours: 300, suddenDeath: false, rescueFailed: false, daysSinceSurgery: null, terminal: false }
            : deathType === 'pending' ? { terminal: false, losHours: 300, suddenDeath: false, rescueFailed: false, hasDispute: false, daysSinceSurgery: null, signedWaiver: false, deathDx: '呼吸循环衰竭待查', icdCat: '症状和体征' }
              : { terminal: false, losHours: 30, suddenDeath: false, rescueFailed: true, daysSinceSurgery: null, hasDispute: false }
      };
      CF.make(plans);
    }
    // 超时未讨论 / 长期未上报（时效分析与统计概览预警清单的来源）
    for (var k = 0; k < 10; k++) {
      var d = 1 + (k % 12);
      CF.make({
        deptIdx: d, mode: 'full',
        deathMs: NOW - (24 + k * 9) * DAY, losHours: 20 + k * 30,
        facts: { losHours: 20 + k * 30, rescueFailed: true, terminal: false, daysSinceSurgery: null },
        discuss: { state: 'to-organize' },
        report: { state: k % 3 === 0 ? 'to-fill' : 'level-1' }
      });
    }
  }

  /* ───── 3. 背景量：24 个月历史死亡病例（全部为终态，支撑排名/趋势/同比环比） ───── */
  function volume() {
    var monthStart = new Date(new Date(NOW).getFullYear(), new Date(NOW).getMonth(), 1).getTime();
    for (var m = 0; m <= 24; m++) {
      var n = 20 + ((m * 3) % 5);
      for (var i = 0; i < n; i++) {
        var dept = 1 + ((m * 7 + i * 3) % 12);
        // 当月病例落在「月初 ~ 今天-9 天」之间，保证已归档病例有足够分母
        var deathMs = m === 0 ? NOW - (8 + (i % 13)) * DAY - int(0, 20) * HOUR : NOW - m * 30 * DAY - i * 17 * HOUR;
        var x = (m * 11 + i * 7) % 100;   // 稳定的百分位分配
        var recent = m <= 6;
        CF.make({
          deptIdx: dept, mode: 'stub', deathMs: deathMs,
          discuss: { state: 'archived', late: x < 12 || (!recent && x < 16), never: recent && x >= 96 },
          report: { state: (recent && x >= 95) ? 'to-fill' : ((recent && x < 5) ? 'level-2' : 'done'), late: x >= 5 && x < 14 },
          improve: { late: x >= 88 && x < 95 }
        });
      }
    }
  }

  function run() {
    CF.buildStaff();
    showcase();
    openCases();
    volume();
    CF.dischargeCounts(25);
    var st = global.FHIR.stats();
    var total = Object.keys(st).reduce(function (a, k) { return a + st[k]; }, 0);
    console.log('[seed-cases] 病例 ' + CF.seq() + ' 例 · 资源合计 ' + total + ' · ' + JSON.stringify(st));
  }

  global.SeedCases = { run: run, showcase: showcase, openCases: openCases, volume: volume };
})(typeof window !== 'undefined' ? window : globalThis);
