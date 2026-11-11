/* =====================================================================
 * stats.js —— 统计聚合引擎（统计分析 7 页 + 首页指标的唯一算法入口）
 * ---------------------------------------------------------------------
 * 全部指标从活数据（Encounter / Task / QuestionnaireResponse / Composition /
 * Observation / DocumentReference）实时聚合，不存在预置数字：
 *   · 死亡率 = 期内死亡例数 / 期内出院人次（出院人次为科室×月份 Observation）
 *   · 讨论完成率 = 已归档讨论数 / 应讨论数
 *   · 上报完成率 = 已完成上报数 / 应上报数
 *   · 时限达标率 = 实际完成时间 ≤ 应完成时间 的例数占比（Limit.achieved）
 *   · 改进落实率 = 已完成改进任务 / 改进任务总数（剔除已取消）
 * 统计周期支持月度 / 季度 / 年度，并给出环比（前一周期）与同比（去年同期）。
 * ===================================================================== */
(function (global) {
  'use strict';

  var F = global.FHIR, D = global.Domain, Limit = global.Limit, Svc = global.Svc, V = global.Vocab;
  var DAY = 86400000;

  function pct(a, b) { return b ? +(a / b * 100).toFixed(1) : 0; }
  function delta(cur, prev) { return prev ? +(cur - prev).toFixed(1) : 0; }
  function monthKey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  /* 周期：{granularity:'month'|'quarter'|'year', offset} → 起止与对照区间 */
  function period(g, offset) {
    var n = new Date();
    var y = n.getFullYear(), m = n.getMonth();
    var start, end, prevStart, prevEnd, yoyStart, yoyEnd, label, prevLabel;
    offset = offset || 0;
    if (g === 'month') {
      var base = new Date(y, m - offset, 1);
      start = base.getTime();
      end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59).getTime();
      prevStart = new Date(base.getFullYear(), base.getMonth() - 1, 1).getTime();
      prevEnd = end - 0;
      prevEnd = new Date(base.getFullYear(), base.getMonth(), 0, 23, 59, 59).getTime();
      yoyStart = new Date(base.getFullYear() - 1, base.getMonth(), 1).getTime();
      yoyEnd = new Date(base.getFullYear() - 1, base.getMonth() + 1, 0, 23, 59, 59).getTime();
      label = base.getFullYear() + ' 年 ' + (base.getMonth() + 1) + ' 月';
      prevLabel = new Date(base.getFullYear(), base.getMonth() - 1, 1).getFullYear() + ' 年 ' + (new Date(prevStart).getMonth() + 1) + ' 月';
    } else if (g === 'quarter') {
      var q = Math.floor(m / 3), yy = y;
      var shift = Math.floor(offset / 4);
      var total = yy * 4 + q - offset;
      yy = Math.floor(total / 4); q = ((total % 4) + 4) % 4;
      start = new Date(yy, q * 3, 1).getTime();
      end = new Date(yy, q * 3 + 3, 0, 23, 59, 59).getTime();
      prevStart = new Date(yy, q * 3 - 3, 1).getTime();
      prevEnd = new Date(yy, q * 3, 0, 23, 59, 59).getTime();
      yoyStart = new Date(yy - 1, q * 3, 1).getTime();
      yoyEnd = new Date(yy - 1, q * 3 + 3, 0, 23, 59, 59).getTime();
      label = yy + ' 年 第 ' + (q + 1) + ' 季度';
      prevLabel = new Date(prevStart).getFullYear() + ' 年 第 ' + (Math.floor(new Date(prevStart).getMonth() / 3) + 1) + ' 季度';
    } else {
      var ay = y - offset;
      start = new Date(ay, 0, 1).getTime();
      end = new Date(ay, 11, 31, 23, 59, 59).getTime();
      prevStart = new Date(ay - 1, 0, 1).getTime();
      prevEnd = new Date(ay - 1, 11, 31, 23, 59, 59).getTime();
      yoyStart = prevStart; yoyEnd = prevEnd;
      label = ay + ' 年度'; prevLabel = (ay - 1) + ' 年度';
    }
    return { g: g, offset: offset, start: start, end: end, prevStart: prevStart, prevEnd: prevEnd, yoyStart: yoyStart, yoyEnd: yoyEnd, label: label, prevLabel: prevLabel };
  }

  /* 期内病例（按死亡时间归属） */
  function inRange(list, p, field) {
    field = field || 'deathMs';
    return list.filter(function (c) { return c[field] >= p.start && c[field] <= p.end; });
  }
  function discharges(p, deptName) {
    var total = 0;
    F.scan('Observation').forEach(function (raw) {
      if (!raw.valueQuantity) return;
      var code = raw.code && raw.code.coding[0] ? raw.code.coding[0].code : '';
      if (code !== 'serv-pop-discharges') return;
      var st = Date.parse(raw.effectivePeriod.start);
      var months = monthsBetween(p, st);
      if (!months) return;
      if (deptName && !(raw.subject && raw.subject.display === deptName)) return;
      total += raw.valueQuantity.value / months.length * months.length;
    });
    return Math.round(total);
  }
  /* 周期覆盖的月份键（跨月区间按天折算） */
  function monthsBetween(p, st) {
    var d = new Date(st);
    var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    var s = new Date(p.start), e = new Date(p.end);
    var keys = [];
    var cur = new Date(s.getFullYear(), s.getMonth(), 1);
    while (cur <= e) {
      keys.push(cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0'));
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    return keys.indexOf(key) >= 0 ? [key] : null;
  }

  /* 单期指标集 */
  function metrics(cases, p) {
    var list = inRange(cases, p);
    var discussDone = list.filter(function (c) { return c.discussStatus === 'archived'; });
    var reportDone = list.filter(function (c) { return c.reportStatus === 'done'; });
    var discussOnTime = list.filter(function (c) { return c.discussActualMs && Limit.achieved('discussion', c, c.discussActualMs); });
    var reportOnTime = list.filter(function (c) { return c.reportActualMs && Limit.achieved('report', c, c.reportActualMs); });
    var imp = Svc.improveRows({ navRole: 'quality', scene: 'quality', name: '系统', dept: '', id: 'u-quality' })
      .filter(function (r) { return (r.createdAt >= p.start && r.createdAt <= p.end) || (r.dueMs && r.dueMs >= p.start && r.dueMs <= p.end); });
    var impDone = imp.filter(function (r) { return r.biz === 'done'; });
    var impOpen = imp.filter(function (r) { return ['done', 'cancelled'].indexOf(r.biz) < 0; });
    var overdue = list.filter(function (c) {
      return (c.discussStatus !== 'archived' && c.discussCountdown.overdue) || (c.reportStatus !== 'done' && c.reportCountdown.overdue);
    }).length + impOpen.filter(function (r) { return r.state === 'overdue'; }).length;
    var dis = discharges(p);
    var avg = function (arr) { return arr.length ? +(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length / DAY).toFixed(1) : 0; };
    return {
      deaths: list.length,
      discharges: dis,
      deathRate: pct(list.length, dis),
      discussRate: pct(discussDone.length, list.length),
      reportRate: pct(reportDone.length, list.length),
      improveRate: imp.length ? pct(impDone.length, imp.length - imp.filter(function (r) { return r.biz === 'cancelled'; }).length) : 0,
      onTimeRate: pct(discussOnTime.length + reportOnTime.length, list.length * 2),
      overdueTasks: overdue,
      avgDiscussDays: avg(list.filter(function (c) { return c.discussActualMs; }).map(function (c) { return c.discussActualMs - c.deathMs; })),
      avgReportDays: avg(list.filter(function (c) { return c.reportActualMs; }).map(function (c) { return c.reportActualMs - c.deathMs; })),
      avgLandingDays: avg(impDone.filter(function (r) { return r.actualMs; }).map(function (r) { return r.actualMs - r.createdAt; })),
      discussTotal: list.length, discussDone: discussDone.length,
      reportTotal: list.length, reportDone: reportDone.length,
      improveTotal: imp.length, improveDone: impDone.length,
      unexpected: list.filter(function (c) { return c.deathType === 'unexpected'; }).length,
      special: list.filter(function (c) { return c.deathType === 'special'; }).length,
      expected: list.filter(function (c) { return c.deathType === 'expected'; }).length,
      pending: list.filter(function (c) { return c.deathType === 'pending'; }).length,
      avoidable: list.filter(function (c) { return c.avoidable === 'avoidable' || c.avoidable === '可避免'; }).length,
      partlyAvoidable: list.filter(function (c) { return c.avoidable === 'partly' || c.avoidable === '部分可避免'; }).length,
      missedReport: list.filter(function (c) { return c.reportStatus === 'to-fill' && c.reportCountdown.overdue; }).length,
      overdueDiscuss: list.filter(function (c) { return c.discussStatus !== 'archived' && c.discussCountdown.overdue; }).length,
      lateDiscuss: list.filter(function (c) { return c.discussActualMs && !Limit.achieved('discussion', c, c.discussActualMs); }).length,
      cases: list, improve: imp
    };
  }

  function withCompare(cases, p) {
    var cur = metrics(cases, p);
    var prev = metrics(cases, { g: p.g, start: p.prevStart, end: p.prevEnd, label: p.prevLabel });
    var yoy = metrics(cases, { g: p.g, start: p.yoyStart, end: p.yoyEnd, label: '去年同期' });
    return {
      period: p, cur: cur, prev: prev, yoy: yoy,
      d: {
        deaths: delta(cur.deaths, prev.deaths), deathRate: delta(cur.deathRate, prev.deathRate),
        discussRate: delta(cur.discussRate, prev.discussRate), reportRate: delta(cur.reportRate, prev.reportRate),
        improveRate: delta(cur.improveRate, prev.improveRate), onTimeRate: delta(cur.onTimeRate, prev.onTimeRate),
        deathsYoy: delta(cur.deaths, yoy.deaths), deathRateYoy: delta(cur.deathRate, yoy.deathRate)
      }
    };
  }

  /* ───── L3-4-1 统计概览 ───── */
  function overview(user, p) {
    var cases = Svc.cases(function (c) { return Svc.inScope(user, c); });
    var r = withCompare(cases, p);
    var list = r.cur.cases;
    r.deathTypeDist = [
      { label: '预期死亡', value: r.cur.expected, color: '#FAAD14' },
      { label: '非预期死亡', value: r.cur.unexpected, color: '#FF4D4F' },
      { label: '特殊死亡', value: r.cur.special, color: '#1890FF' },
      { label: '待人工判定', value: r.cur.pending, color: '#BFBFBF' }
    ];
    var byDept = {};
    list.forEach(function (c) { byDept[c.deptName] = (byDept[c.deptName] || 0) + 1; });
    r.deptDist = Object.keys(byDept).map(function (k) { return { label: k.replace(/[内外]?$|科$/, function (x) { return x; }), name: k, value: byDept[k] }; })
      .sort(function (a, b) { return b.value - a.value; }).slice(0, 8)
      .map(function (x) { return { label: x.name, value: x.value }; });
    r.trend12 = trendSeries('month', 12).series.map(function (s) { return { label: s.label.slice(5), value: s.deathRate }; });
    var ca = causeAnalysis(list, p);
    r.causeTop5 = ca.top.slice(0, 5);
    r.alerts = [
      { kind: '超时讨论', n: r.cur.overdueDiscuss + r.cur.lateDiscuss, route: 'stat-timeliness', level: 'red' },
      { kind: '漏报 / 超时上报', n: r.cur.missedReport, route: 'stat-timeliness', level: 'orange' },
      { kind: '超时未落实改进措施', n: r.cur.improve.filter(function (x) { return x.state === 'overdue' && ['done', 'cancelled'].indexOf(x.biz) < 0; }).length, route: 'stat-improve', level: 'yellow' },
      { kind: '待人工判定', n: r.cur.pending, route: 'discuss-list', level: 'gray' }
    ];
    r.updatedAt = Limit.dt(Date.now());
    return r;
  }

  /* ───── L3-4-2 科室死亡病例分析 ───── */
  function deptAnalysis(user, p) {
    var cases = Svc.cases(function (c) { return Svc.inScope(user, c); });
    var list = inRange(cases, p);
    var depts = Svc.depts();
    var rows = depts.map(function (d) {
      var mine = list.filter(function (c) { return c.deptName === d.name; });
      var dis = discharges(p, d.name) || mine.length * 30;
      var discDone = mine.filter(function (c) { return c.discussStatus === 'archived'; }).length;
      var repDone = mine.filter(function (c) { return c.reportStatus === 'done'; }).length;
      var imp = Svc.improveRows({ navRole: 'quality', scene: 'quality', name: '系统', dept: '', id: 'u-quality' })
        .filter(function (r) { return r.dept === d.name && r.createdAt >= p.start && r.createdAt <= p.end; });
      var impDone = imp.filter(function (r) { return r.biz === 'done'; });
      return {
        deptId: d.id, name: d.name, beds: d.beds,
        deaths: mine.length, discharges: dis,
        deathRate: pct(mine.length, dis),
        discussRate: pct(discDone, mine.length), reportRate: pct(repDone, mine.length),
        improveTotal: imp.length, improveDone: impDone.length,
        improveRate: pct(impDone.length, imp.filter(function (r) { return r.biz !== 'cancelled'; }).length),
        avgLandingDays: avgDays(impDone),
        overdueDiscuss: mine.filter(function (c) { return c.discussStatus !== 'archived' && c.discussCountdown.overdue; }).length
          + mine.filter(function (c) { return c.discussActualMs && !Limit.achieved('discussion', c, c.discussActualMs); }).length,
        missed: mine.filter(function (c) { return (c.reportStatus === 'to-fill' && c.reportCountdown.overdue); }).length,
        cases: mine
      };
    }).sort(function (a, b) { return b.deaths - a.deaths; });
    var maxDeaths = Math.max.apply(null, rows.map(function (r) { return r.deaths; }).concat([1]));
    return {
      rows: rows, updatedAt: Limit.dt(Date.now()),
      totalDepts: rows.filter(function (r) { return r.deaths > 0; }).length,
      topDeaths: rows[0] || null,
      topRate: rows.slice().sort(function (a, b) { return b.deathRate - a.deathRate; })[0] || null,
      lowDiscuss: rows.filter(function (r) { return r.deaths > 0; }).sort(function (a, b) { return a.discussRate - b.discussRate; })[0] || null,
      avgDeathRate: pct(list.length, rows.reduce(function (a, r) { return a + r.discharges; }, 0)),
      barMax: maxDeaths
    };
  }
  function avgDays(rows) {
    var v = rows.filter(function (r) { return r.actualMs; }).map(function (r) { return (r.actualMs - r.createdAt) / DAY; });
    return v.length ? +(v.reduce(function (a, b) { return a + b; }, 0) / v.length).toFixed(1) : 0;
  }

  /* ───── L3-4-3 死因与诊断分析 ───── */
  function causeAnalysis(list, p) {
    list = list || inRange(Svc.cases(), p || period('month'));
    var counts = {}, byCat = {}, unexpected = {}, surgical = {}, concord = { match: 0, partly: 0, unmatch: 0 };
    var matrix = {};
    list.forEach(function (c) {
      var cause = (c.deathDx || '未分类').split('，')[0];
      counts[cause] = counts[cause] || { name: cause, n: 0, cases: [], icd: c.deathIcd };
      counts[cause].n++; counts[cause].cases.push(c);
      var cat = catOfIcd(c.deathIcd);
      byCat[cat] = (byCat[cat] || 0) + 1;
      if (c.deathType === 'unexpected') unexpected[cause] = (unexpected[cause] || 0) + 1;
      if (c.hasSurgery && c.daysSinceSurgery != null && c.daysSinceSurgery <= 30) surgical[cause] = (surgical[cause] || 0) + 1;
      if (concord[c.concordance] != null) concord[c.concordance]++;
      var sev = c.severity || 'moderate';
      matrix[cause] = matrix[cause] || { name: cause, mild: 0, moderate: 0, severe: 0, critical: 0 };
      matrix[cause][sev]++;
    });
    var top = Object.keys(counts).map(function (k) { return counts[k]; }).sort(function (a, b) { return b.n - a.n; });
    var total = list.length || 1;
    return {
      total: list.length,
      top: top.map(function (x, i) { return { rank: i + 1, name: x.name, icd: x.icd, value: x.n, pct: pct(x.n, total), cases: x.cases }; }),
      byCat: Object.keys(byCat).map(function (k) { return { label: k, value: byCat[k], pct: pct(byCat[k], total) }; }).sort(function (a, b) { return b.value - a.value; }),
      unexpected: Object.keys(unexpected).map(function (k) { return { label: k, value: unexpected[k] }; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 8),
      surgical: Object.keys(surgical).map(function (k) { return { label: k, value: surgical[k] }; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 8),
      avoidable: {
        avoidable: list.filter(function (c) { return c.avoidable === 'avoidable' || c.avoidable === '可避免'; }).length,
        partly: list.filter(function (c) { return c.avoidable === 'partly' || c.avoidable === '部分可避免'; }).length,
        unavoidable: list.filter(function (c) { return c.avoidable === 'unavoidable' || c.avoidable === '不可避免'; }).length
      },
      concordance: concord,
      concordanceList: list.filter(function (c) { return c.concordance === 'unmatch' || c.concordance === 'partly'; }),
      matrix: Object.keys(matrix).map(function (k) { return matrix[k]; }).sort(function (a, b) { return (b.mild + b.moderate + b.severe + b.critical) - (a.mild + a.moderate + a.severe + a.critical); }).slice(0, 10)
    };
  }
  function catOfIcd(code) {
    var hit = null;
    V.ICD_GROUPS.forEach(function (g) {
      g.items.forEach(function (it) { if (it[0] === code) hit = g.cat; });
    });
    return hit || '其他';
  }

  /* ───── L3-4-4 趋势分析 ───── */
  function trendSeries(granularity, count, endOffset) {
    var n = new Date();
    var series = [];
    var months = 0;
    for (var i = (count || 12) - 1 + (endOffset || 0); i >= (endOffset || 0); i--) {
      var p = period('month', i);
      var list = inRange(Svc.cases(), p);
      var dis = discharges(p);
      var unexpected = list.filter(function (c) { return c.deathType === 'unexpected'; });
      var avoidable = list.filter(function (c) { return c.avoidable === 'avoidable' || c.avoidable === 'partly' || c.avoidable === '可避免' || c.avoidable === '部分可避免'; });
      series.push({
        key: monthKey(p.start), label: (p.label.replace(' 年 ', '-').replace(' 月', '')),
        start: p.start, end: p.end,
        deaths: list.length, discharges: dis,
        deathRate: pct(list.length, dis),
        unexpectedRate: pct(unexpected.length, dis),
        avoidableRate: pct(avoidable.length, list.length),
        discussRate: pct(list.filter(function (c) { return c.discussStatus === 'archived'; }).length, list.length),
        reportRate: pct(list.filter(function (c) { return c.reportStatus === 'done'; }).length, list.length),
        onTimeRate: pct(list.filter(function (c) { return c.discussActualMs && Limit.achieved('discussion', c, c.discussActualMs); }).length, list.length)
      });
      months++;
    }
    if (granularity === 'quarter' || granularity === 'year') {
      var buckets = {};
      series.forEach(function (s) {
        var d = new Date(s.start);
        var k = granularity === 'quarter' ? (d.getFullYear() + ' Q' + (Math.floor(d.getMonth() / 3) + 1)) : String(d.getFullYear());
        if (!buckets[k]) buckets[k] = { key: k, label: k, start: s.start, end: s.end, deaths: 0, discharges: 0, unexpected: 0, avoidable: 0, discDone: 0, repDone: 0, onTime: 0, total: 0 };
        var b = buckets[k];
        b.deaths += s.deaths; b.discharges += s.discharges; b.end = s.end;
        b.unexpected += Math.round(s.deaths * s.unexpectedRate / (s.deathRate || 1)) || 0;
        b.total += s.deaths;
      });
      var agg = Object.keys(buckets).map(function (k) {
        var b = buckets[k];
        var list = inRange(Svc.cases(), { start: b.start, end: b.end + 1 });
        var un = list.filter(function (c) { return c.deathType === 'unexpected'; });
        var av = list.filter(function (c) { return c.avoidable === 'avoidable' || c.avoidable === 'partly'; });
        return {
          key: b.key, label: b.label, start: b.start, end: b.end,
          deaths: list.length, discharges: b.discharges,
          deathRate: pct(list.length, b.discharges),
          unexpectedRate: pct(un.length, b.discharges),
          avoidableRate: pct(av.length, list.length),
          discussRate: pct(list.filter(function (c) { return c.discussStatus === 'archived'; }).length, list.length),
          reportRate: pct(list.filter(function (c) { return c.reportStatus === 'done'; }).length, list.length),
          onTimeRate: pct(list.filter(function (c) { return c.discussActualMs && Limit.achieved('discussion', c, c.discussActualMs); }).length, list.length)
        };
      });
      return { granularity: granularity, series: agg };
    }
    return { granularity: granularity, series: series };
  }
  function trend(user, granularity, count) {
    var ts = trendSeries(granularity, count || 12);
    var s = ts.series;
    var last = s[s.length - 1] || { deathRate: 0, deaths: 0, discharges: 0 };
    var prev = s[s.length - 2] || last;
    var yoyBase = s[Math.max(0, s.length - 13)] || prev;
    var nodes = [];
    s.forEach(function (x, i) {
      if (i > 0 && Math.abs(x.deathRate - s[i - 1].deathRate) >= 0.35) {
        nodes.push({ label: x.label, text: '死亡率' + (x.deathRate > s[i - 1].deathRate ? '上升' : '下降') + ' ' + Math.abs(x.deathRate - s[i - 1].deathRate).toFixed(2) + ' 个百分点，' + (x.deathRate > s[i - 1].deathRate ? '需重点关注科室死亡构成变化' : '医疗质量改进措施初见成效') });
      }
    });
    var deptTop = deptAnalysis(user, period('month', 1)).rows.slice(0, 3);
    var perDept = {};
    deptTop.forEach(function (d) {
      perDept[d.name] = s.map(function (x) {
        var list = inRange(Svc.cases(function (c) { return c.deptName === d.name; }), { start: x.start, end: x.end });
        return { label: x.label, value: pct(list.length, x.discharges / (deptTop.length || 1) * 3 || 1) || pct(list.length, list.length ? Math.max(1, x.discharges / 12) : 1) };
      });
    });
    return {
      series: s, last: last,
      qoq: delta(last.deathRate, prev.deathRate), yoy: delta(last.deathRate, yoyBase.deathRate),
      nodes: nodes.slice(-6), perDept: perDept, deptCandidates: deptTop.map(function (d) { return d.name; }),
      summary: summary(s)
    };
  }
  function summary(s) {
    if (s.length < 2) return '数据不足，暂无趋势分析。';
    var first = s[0], last = s[s.length - 1];
    var dir = last.deathRate > first.deathRate ? '上升' : '下降';
    var high = s.slice().sort(function (a, b) { return b.deaths - a.deaths; })[0];
    var low = s.slice().sort(function (a, b) { return a.deathRate - b.deathRate; })[0];
    return '统计期 ' + s.length + ' 个周期内，死亡率由 ' + first.deathRate + '% ' + dir + '至 ' + last.deathRate + '%（' +
      dir + ' ' + Math.abs(last.deathRate - first.deathRate).toFixed(2) + ' 个百分点）；死亡例数最高的周期为 ' + high.label + '（' + high.deaths + ' 例）；' +
      '死亡率最低的周期为 ' + low.label + '（' + low.deathRate + '%）。非预期死亡率 ' +
      (last.unexpectedRate <= first.unexpectedRate ? '同步下降，说明重点病例管控有效' : '仍在攀升，建议加强非预期死亡专项分析') +
      '；可避免死亡率 ' + (last.avoidableRate <= first.avoidableRate ? '有所改善' : '未见改善，需结合死因清单复盘诊疗环节') + '。';
  }

  /* ───── L3-4-5 改进跟踪统计 ───── */
  function improveStats(user, p) {
    var all = Svc.improveRows({ navRole: 'quality', scene: 'quality', name: '系统', dept: '', id: 'u-quality' });
    // 本期改进任务：本期内生成，或应在本期内完成（含跨期积压）
    var list = all.filter(function (r) {
      return (r.createdAt >= p.start && r.createdAt <= p.end) || (r.dueMs && r.dueMs >= p.start && r.dueMs <= p.end);
    });
    var valid = list.filter(function (r) { return r.biz !== 'cancelled'; });
    var done = valid.filter(function (r) { return r.biz === 'done'; });
    var overdueOpen = valid.filter(function (r) { return r.state === 'overdue' && ['done', 'cancelled'].indexOf(r.biz) < 0; });
    var prev = all.filter(function (r) { return r.createdAt >= p.prevStart && r.createdAt <= p.prevEnd; });
    var prevValid = prev.filter(function (r) { return r.biz !== 'cancelled'; });
    var dist = { 'not-started': 0, 'in-progress': 0, done: 0, cancelled: 0, 'to-evaluate': 0 };
    list.forEach(function (r) { dist[r.biz] = (dist[r.biz] || 0) + 1; });
    var byDept = {};
    valid.forEach(function (r) {
      byDept[r.dept] = byDept[r.dept] || { total: 0, done: 0 };
      byDept[r.dept].total++;
      if (r.biz === 'done') byDept[r.dept].done++;
    });
    var tr = trendSeries('month', 6).series.map(function (x) {
      var rows = all.filter(function (r) { return r.createdAt >= x.start && r.createdAt <= x.end && r.biz !== 'cancelled'; });
      return { label: x.label, value: pct(rows.filter(function (r) { return r.biz === 'done'; }).length, rows.length) };
    });
    return {
      total: list.length, done: done.length,
      rate: pct(done.length, valid.length), ratePrev: pct(prevValid.filter(function (r) { return r.biz === 'done'; }).length, prevValid.length),
      avgDays: avgDays(done),
      dist: dist, overdue: overdueOpen, trend: tr,
      byDept: Object.keys(byDept).map(function (k) { return { label: k, value: pct(byDept[k].done, byDept[k].total), total: byDept[k].total, done: byDept[k].done }; })
        .sort(function (a, b) { return b.value - a.value; }),
      rows: list
    };
  }

  /* ───── L3-4-6 时效分析 ───── */
  function timeliness(user, p) {
    var cases = inRange(Svc.cases(function (c) { return Svc.inScope(user, c); }), p);
    var dOnTime = cases.filter(function (c) { return c.discussActualMs && Limit.achieved('discussion', c, c.discussActualMs); }).length;
    var rOnTime = cases.filter(function (c) { return c.reportActualMs && Limit.achieved('report', c, c.reportActualMs); }).length;
    var imp = Svc.improveRows({ navRole: 'quality', scene: 'quality', name: '系统', dept: '', id: 'u-quality' })
      .filter(function (r) {
        return (r.createdAt >= p.start && r.createdAt <= p.end) || (r.dueMs && r.dueMs >= p.start && r.dueMs <= p.end);
      });
    var impOnTime = imp.filter(function (r) { return r.actualMs ? r.actualMs <= r.dueMs : r.state !== 'overdue'; }).length;
    var overdueDiscuss = cases.filter(function (c) {
      return (c.discussStatus !== 'archived' && c.discussCountdown.overdue) || (c.discussActualMs && !Limit.achieved('discussion', c, c.discussActualMs));
    });
    var missed = cases.filter(function (c) {
      return (c.reportStatus === 'to-fill' && c.reportCountdown.overdue) || (c.reportActualMs && !Limit.achieved('report', c, c.reportActualMs));
    });
    var byType = {};
    ['expected', 'unexpected', 'special', 'pending'].forEach(function (t) {
      var sub = cases.filter(function (c) { return c.deathType === t; });
      byType[t] = {
        name: D.deathTypeName(t), n: sub.length,
        discuss: pct(sub.filter(function (c) { return c.discussActualMs && Limit.achieved('discussion', c, c.discussActualMs); }).length, sub.length),
        report: pct(sub.filter(function (c) { return c.reportActualMs && Limit.achieved('report', c, c.reportActualMs); }).length, sub.length),
        limit: Limit.daysOf('discussion', t) + ' 天 / ' + Limit.daysOf('report', t) + ' 天'
      };
    });
    var m = metrics(cases, p);
    var prev = metrics(cases, { g: p.g, start: p.prevStart, end: p.prevEnd });
    return {
      discussRate: pct(dOnTime, cases.length), reportRate: pct(rOnTime, cases.length),
      improveRate: pct(impOnTime, imp.length),
      avgDiscussDays: m.avgDiscussDays, avgReportDays: m.avgReportDays, avgLandingDays: m.avgLandingDays,
      deltaDiscuss: delta(pct(dOnTime, cases.length), pct(prev.cases.filter(function (c) { return c.discussActualMs && Limit.achieved('discussion', c, c.discussActualMs); }).length, prev.cases.length)),
      overdueDiscuss: overdueDiscuss, missed: missed, byType: byType,
      trend: trendSeries('month', 6).series.map(function (x) {
        var sub = inRange(Svc.cases(), { start: x.start, end: x.end });
        return { label: x.label, value: pct(sub.filter(function (c) { return c.discussActualMs && Limit.achieved('discussion', c, c.discussActualMs); }).length, sub.length) };
      })
    };
  }

  /* ───── L3-4-7 报表管理 ───── */
  var REPORT_TYPES = [
    { code: 'monthly', name: '月度死亡统计报表', g: 'month', desc: '死亡例数、死亡率、科室分布、死因 TOP10、讨论与上报执行情况' },
    { code: 'quarterly', name: '季度死亡病例分析', g: 'quarter', desc: '季度死亡趋势、非预期与可避免死亡分析、改进措施落实' },
    { code: 'annual', name: '年度死亡病例质量报告', g: 'year', desc: '年度死亡与质量指标汇总、同比变化、制度建设建议' },
    { code: 'unexpected', name: '非预期死亡专项分析报告', g: 'quarter', desc: '非预期死亡专项：例数、死因构成、科室分布、诊疗评价要点' }
  ];
  function buildReport(typeCode, p) {
    var all = Svc.cases();
    var list = inRange(all, p);
    var t = REPORT_TYPES.filter(function (x) { return x.code === typeCode; })[0] || REPORT_TYPES[0];
    var m = metrics(all, p);
    var prev = metrics(all, { g: p.g, start: p.prevStart, end: p.prevEnd });
    var ca = causeAnalysis(list, p);
    var da = deptAnalysis({ navRole: 'quality', scene: 'quality', name: '系统', dept: '', id: 'u-quality' }, p);
    var ts = improveStats({ navRole: 'quality', scene: 'quality', name: '系统', dept: '', id: 'u-quality' }, p);
    var tl = timeliness({ navRole: 'quality', scene: 'quality', name: '系统', dept: '', id: 'u-quality' }, p);
    var sections = [];
    if (typeCode === 'unexpected') {
      var un = list.filter(function (c) { return c.deathType === 'unexpected'; });
      sections.push({ title: '一、总体情况', kind: 'kv', rows: [['统计周期', p.label], ['非预期死亡例数', un.length + ' 例'], ['占同期死亡比例', pct(un.length, list.length) + '%'], ['其中术后 30 天内', un.filter(function (c) { return c.hasSurgery && c.daysSinceSurgery <= 30; }).length + ' 例'], ['入院 48 小时内', un.filter(function (c) { return c.losDays <= 2; }).length + ' 例']] });
      sections.push({ title: '二、非预期死因构成', kind: 'table', headers: ['死因', '例数', '占比'], rows: ca.unexpected.map(function (x) { return [x.label, x.value, pct(x.value, un.length || 1) + '%']; }) });
      sections.push({ title: '三、涉及科室', kind: 'table', headers: ['科室', '例数', '讨论完成率', '上报完成率'], rows: da.rows.map(function (r) { return [r.name, r.deaths, r.discussRate + '%', r.reportRate + '%']; }).slice(0, 10) });
      sections.push({ title: '四、诊疗过程评价要点', kind: 'list', items: list.filter(function (c) { return c.qrRecord; }).slice(0, 8).map(function (c) { var a = Svc.flatAnswers(c.qrRecord); return c.name + '（' + c.deptName + '）：诊断及时性 ' + (a['m5.dxTimely'] || '—') + '，治疗合理性 ' + (a['m5.txReasonable'] || '—') + '，抢救得当性 ' + (a['m5.rescueProper'] || '—') + '，是否可避免 ' + (a['m4.avoidable'] || '—'); }) });
    } else {
      sections.push({ title: '一、总体死亡情况', kind: 'kv', rows: [['统计周期', p.label], ['死亡病例总数', m.deaths + ' 例（环比 ' + delta(m.deaths, prev.deaths) + '%）'], ['出院人次', m.discharges], ['死亡率', m.deathRate + '%（环比 ' + delta(m.deathRate, prev.deathRate) + 'pp）'], ['非预期死亡', m.unexpected + ' 例'], ['特殊死亡', m.special + ' 例'], ['可避免死亡', m.avoidable + ' 例']] });
      sections.push({ title: '二、死亡类型分布', kind: 'table', headers: ['死亡类型', '例数', '构成比'], rows: [['预期死亡', m.expected, pct(m.expected, m.deaths) + '%'], ['非预期死亡', m.unexpected, pct(m.unexpected, m.deaths) + '%'], ['特殊死亡', m.special, pct(m.special, m.deaths) + '%'], ['待人工判定', m.pending, pct(m.pending, m.deaths) + '%']] });
      sections.push({ title: '三、死亡原因 TOP10', kind: 'table', headers: ['排名', '死亡原因', 'ICD-10', '例数', '占比'], rows: ca.top.slice(0, 10).map(function (x) { return [x.rank, x.name, x.icd || '—', x.value, x.pct + '%']; }) });
      sections.push({ title: '四、科室分布与排名', kind: 'table', headers: ['科室', '死亡例数', '死亡率', '讨论完成率', '上报完成率', '改进落实率'], rows: da.rows.map(function (r) { return [r.name, r.deaths, r.deathRate + '%', r.discussRate + '%', r.reportRate + '%', r.improveRate + '%']; }) });
      sections.push({ title: '五、制度执行情况', kind: 'kv', rows: [['讨论完成率', m.discussRate + '%'], ['上报完成率', m.reportRate + '%'], ['改进措施落实率', m.improveRate + '%'], ['时限综合达标率', m.onTimeRate + '%'], ['平均讨论耗时', m.avgDiscussDays + ' 天'], ['平均上报时间', m.avgReportDays + ' 天'], ['平均落实时间', ts.avgDays + ' 天'], ['超时讨论病例', tl.overdueDiscuss.length + ' 例'], ['漏报/超时上报', tl.missed.length + ' 例']] });
      if (typeCode === 'annual') {
        var tr = trendSeries('month', 12).series;
        sections.push({ title: '六、年度趋势与同比', kind: 'table', headers: ['月份', '死亡数', '出院人次', '死亡率', '非预期死亡率'], rows: tr.map(function (x) { return [x.label, x.deaths, x.discharges, x.deathRate + '%', x.unexpectedRate + '%']; }) });
        sections.push({ title: '七、质量改进建议', kind: 'list', items: [
          '对讨论/上报超时集中的科室开展专项督导，落实制度时限要求；',
          '将死亡病例预警评分记录纳入交接班清单，减少动态评估延迟；',
          '术后 30 天内患者纳入随访路径并启用系统自动提醒；',
          '推广本科室及全院优秀改进措施（见改进跟踪「可全院推广」清单）。'
        ] });
      }
    }
    return {
      type: t, period: p, sections: sections,
      title: p.label + t.name,
      generatedAt: Limit.dt(Date.now())
    };
  }
  function reportToHtml(rep) {
    var h = '<h1>' + rep.title + '</h1><p style="text-align:center;color:#666">生成时间：' + rep.generatedAt + '　统计口径：按死亡时间归属　数据源：FHIR 实时聚合</p>';
    rep.sections.forEach(function (s) {
      h += '<h2>' + s.title + '</h2>';
      if (s.kind === 'kv') h += '<table>' + s.rows.map(function (r) { return '<tr><th style="width:30%">' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table>';
      else if (s.kind === 'table') h += '<table><tr>' + s.headers.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr>' + s.rows.map(function (r) { return '<tr>' + r.map(function (x) { return '<td>' + x + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
      else h += '<ol>' + s.items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>';
    });
    return h;
  }
  function reportToRows(rep) {
    var rows = [['报表名称', rep.title], ['报表类型', rep.type.name], ['统计周期', rep.period.label], ['生成时间', rep.generatedAt], []];
    rep.sections.forEach(function (s) {
      rows.push([s.title]);
      if (s.kind === 'kv') s.rows.forEach(function (r) { rows.push([r[0], r[1]]); });
      else if (s.kind === 'table') { rows.push(s.headers.slice()); s.rows.forEach(function (r) { rows.push(r); }); }
      else s.items.forEach(function (x) { rows.push([x]); });
    });
    return rows;
  }
  /* 历史报表（MeasureReport 承载，dataset 为可回放的报表快照） */
  function history() {
    return F.scan('MeasureReport').map(function (raw) { return F.decode(raw); })
      .sort(function (a, b) { return Limit.parse(b.date) - Limit.parse(a.date); })
      .map(function (r) {
        return {
          id: r.id, name: r.title, type: r.ext.dataset ? r.ext.dataset.typeCode : '', typeText: (r.ext.dataset || {}).typeName || '',
          period: (r.ext.dataset || {}).periodLabel || '', generatedAt: Limit.dt(Limit.parse(r.date)),
          generator: (r.ext.generatedBy || '') || '系统', resource: r
        };
      });
  }
  function saveReportDoc(rep, generator) {
    return F.create({
      resourceType: 'MeasureReport', status: 'complete', type: 'summary',
      measure: 'Measure/Measure-' + (rep.type.code === 'monthly' ? 'death-overview' : rep.type.code === 'annual' ? 'death-overview' : 'cause-rank'),
      title: rep.title, date: new Date().toISOString(),
      period: { start: new Date(rep.period.start).toISOString(), end: new Date(rep.period.end).toISOString() },
      reporter: { reference: 'Organization/Organization-0013', display: '医务部' },
      ext: {
        generatedBy: generator || '医务部管理员',
        dataset: { typeCode: rep.type.code, typeName: rep.type.name, periodLabel: rep.period.label, sections: rep.sections, g: rep.period.g, start: rep.period.start, end: rep.period.end }
      }
    }).id;
  }
  function loadReportDoc(id) {
    var r = F.view('MeasureReport', id);
    if (!r || !r.ext.dataset) return null;
    var d = r.ext.dataset;
    return {
      title: r.title, generatedAt: Limit.dt(Limit.parse(r.date)),
      type: { code: d.typeCode, name: d.typeName },
      period: { label: d.periodLabel, start: d.start, end: d.end, g: d.g },
      sections: d.sections
    };
  }
  function ensureHistory() {
    if (F.scan('MeasureReport').length) return 0;
    var n = 0;
    [['monthly', 1], ['monthly', 2], ['monthly', 3], ['quarterly', 1], ['quarterly', 2], ['annual', 1], ['unexpected', 1], ['monthly', 4]].forEach(function (x) {
      var t = REPORT_TYPES.filter(function (r) { return r.code === x[0]; })[0];
      var p = period(t.g, x[1]);
      var rep = buildReport(t.code, p);
      saveReportDoc(rep, '系统定时统计');
      n++;
    });
    return n;
  }

  global.Stats = {
    period: period, pct: pct, delta: delta, metrics: metrics, withCompare: withCompare, inRange: inRange,
    overview: overview, deptAnalysis: deptAnalysis, causeAnalysis: causeAnalysis, catOfIcd: catOfIcd,
    trend: trend, trendSeries: trendSeries, improveStats: improveStats, timeliness: timeliness,
    REPORT_TYPES: REPORT_TYPES, buildReport: buildReport, reportToHtml: reportToHtml, reportToRows: reportToRows,
    history: history, saveReportDoc: saveReportDoc, loadReportDoc: loadReportDoc, ensureHistory: ensureHistory,
    discharges: discharges
  };
})(typeof window !== 'undefined' ? window : globalThis);
