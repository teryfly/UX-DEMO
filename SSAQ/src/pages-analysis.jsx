/* L2-4 / L3-4-x 核查分析模块 */
(function () {
  const SSAQ = window.SSAQ;
  const store = SSAQ.store;
  const { useState } = React;
  const {
    Card, Table, Tag, Button, Space, Alert, Row, Col, Select, Empty,
    Divider, message, Modal, DatePicker,
  } = antd;
  const { RangePicker } = DatePicker;
  const U = SSAQ.ui;
  const { PageHeader, StatCard, navigate, Ico, fmt, LineChart, PieChart, HBar, Donut } = U;

  const DEPTS = ['普外科', '肝胆外科', '骨科', '心外科', '神经外科', '泌尿外科', '胸外科', '妇科', '耳鼻喉科', '眼科'];
  const PROBLEM_DEFS = [
    { label: '卡控拦截', match: (a) => a.type === 'block' },
    { label: '资质异常', match: (a) => a.type === 'qualification' },
    { label: '超时·人员延迟', match: (a) => a.type === 'timeout' && a.subtype === 'staff' },
    { label: '超时·术中突发', match: (a) => a.type === 'timeout' && a.subtype === 'intraop' },
    { label: '超时·系统异常', match: (a) => a.type === 'timeout' && a.subtype === 'system' },
  ];

  // 以种子手术数据中最晚的手术日期作为演示基准“当前日期”，避免统计口径随真实系统时钟漂移而失真
  function demoNow() {
    const dates = Object.values(store.db.Encounter || {}).map((e) => e.surgeryDate).filter(Boolean).sort();
    return dates.length ? dayjs(dates[dates.length - 1]) : dayjs();
  }

  /* ---------- L3-4-1 核查统计 ---------- */
  function Stats() {
    U.useFhir();
    const [dept, setDept] = useState();
    const [range, setRange] = useState(null); // [dayjs, dayjs] | null（null = 全部区间）
    const [genDoc, setGenDoc] = useState(null);

    function presetMonth() { const now = demoNow(); setRange([now.startOf('month'), now.endOf('month')]); }
    function presetQuarter() { const now = demoNow(); const q = Math.floor(now.month() / 3); setRange([now.month(q * 3).startOf('month'), now.month(q * 3 + 2).endOf('month')]); }
    function presetAll() { setRange(null); }

    const startStr = range ? range[0].format('YYYY-MM-DD') : null;
    const endStr = range ? range[1].format('YYYY-MM-DD') : null;

    // ---- 按筛选条件（科室 + 统计周期起止日期）联动计算全部统计数据 ----
    let encs = Object.values(store.db.Encounter || {});
    if (dept) encs = encs.filter((e) => e.department === dept);
    if (startStr) encs = encs.filter((e) => e.surgeryDate >= startStr && e.surgeryDate <= endStr);
    const encIds = new Set(encs.map((e) => e.id));

    let audits = Object.values(store.db.AuditEvent || {});
    if (dept) audits = audits.filter((a) => a.department === dept);
    if (startStr) audits = audits.filter((a) => { const d = dayjs(a.recorded).format('YYYY-MM-DD'); return d >= startStr && d <= endStr; });

    const totalPhases = encs.length * 3;
    const passedPhases = encs.reduce((n, e) => n + Object.values(e.phaseStatus).filter((s) => s === 'passed').length, 0);
    const completionRate = totalPhases ? Math.round((passedPhases / totalPhases) * 1000) / 10 : 0;
    const violationRate = totalPhases ? Math.round((audits.length / totalPhases) * 1000) / 10 : 0;

    const problems = PROBLEM_DEFS.map((p) => ({ label: p.label, value: audits.filter(p.match).length })).filter((p) => p.value > 0);

    const asaStd = store.db.RiskStandard['risk-asa'];
    const asaCounts = {};
    Object.values(store.db.Observation || {}).forEach((o) => {
      if (o.category !== 'risk-assessment') return;
      const encId = o.encounter && o.encounter.reference.split('/')[1];
      if (!encIds.has(encId)) return;
      const g = o.valueCodeableConcept.text;
      asaCounts[g] = (asaCounts[g] || 0) + 1;
    });
    const asaDist = asaStd.grades.filter((g) => g.enabled).map((g) => ({ label: g.grade, value: asaCounts[g.grade] || 0 }));

    const siteCheck = Object.values(store.db.Procedure || {})
      .filter((p) => encIds.has(p.encounter.reference.split('/')[1]))
      .map((p) => {
        const enc = store.db.Encounter[p.encounter.reference.split('/')[1]];
        const consistent = p.requestedBodySite === p.bodySite[0].text;
        return { room: enc.room, patient: store.db.Patient[enc.subject.reference.split('/')[1]].name[0].text, requested: p.requestedBodySite, checked: p.bodySite[0].text, consistent };
      });

    // 近12周完成率趋势：以当前筛选口径的完成率为终值，向前呈渐进走势（演示性示意趋势）
    const trend = Array.from({ length: 12 }, (_, i) => {
      const v = Math.max(60, Math.round((completionRate - (11 - i) * 0.6) * 10) / 10);
      return { label: 'W' + (i + 1), value: i === 11 ? completionRate : v };
    });

    function genReportFromStats() {
      const periodLabel = range ? (startStr === endStr ? startStr : startStr + ' ~ ' + endStr) : '全部区间';
      const content = {
        totalSurgery: encs.length, completionRate, violationRate, problems, asaDist, siteCheck,
        summary: periodLabel + ' ' + (dept || '全院') + '手术安全核查质量评价报告：核查总数量 ' + encs.length + ' 台，整体完成率 ' + completionRate + '%，违规发生率 ' + violationRate + '%。',
      };
      const doc = store.create('DocumentReference', {
        status: 'current', type: { text: '手术室核查质量评价报告' },
        title: periodLabel + ' ' + (dept || '全院') + '手术室核查质量评价报告',
        period: periodLabel, department: dept || '全院', date: SSAQ.nowIso(), archived: true, content,
      });
      setGenDoc(doc);
      message.success('质量报表已生成并自动归档，可在下方下载，或前往「核查质量报告」查看');
    }

    return (
      <div>
        <PageHeader title="核查统计" sub="交互式查询完成率、问题占比、风险评估与手术部位二次核对（US-1.6）" />
        <Card size="small" title="统计条件配置" style={{ marginBottom: 12 }}
          extra={<Button size="small" icon={<Ico name="ExportOutlined" />} onClick={() => message.success('已导出原始数据（演示）')}>导出原始数据</Button>}>
          <Space wrap>
            <span>快捷模板：</span>
            <Button size="small" onClick={presetMonth}>本月汇总</Button>
            <Button size="small" onClick={presetQuarter}>季度复盘</Button>
            <Button size="small" onClick={presetAll}>全部区间</Button>
            <Divider type="vertical" />
            统计周期（起止日期）：<RangePicker value={range} onChange={setRange} allowClear placeholder={['开始日期', '结束日期']} />
            科室：<Select allowClear placeholder="全科室" style={{ width: 130 }} value={dept} onChange={setDept} options={DEPTS.map((d) => ({ value: d, label: d }))} />
            <Tag color="blue">口径：{dept || '全科室'} · {range ? (startStr === endStr ? startStr : startStr + ' ~ ' + endStr) : '全部区间'}</Tag>
          </Space>
        </Card>

        <div className="stat-grid cols-3" style={{ marginBottom: 12 }}>
          <StatCard title="总手术数" value={encs.length} suffix="台" />
          <StatCard title="核查完成率" value={completionRate} suffix="%" color="#52c41a" hint="完成率 =（三方均签名通过的核查阶段数 ÷ 应核查阶段总数）× 100%" />
          <StatCard title="平均违规率" value={violationRate} suffix="%" color="#faad14" />
        </div>

        <Row gutter={12}>
          <Col span={14}>
            <Card size="small" title="近 12 周核查完成率趋势" style={{ marginBottom: 12 }}>
              <LineChart data={trend} unit="%" />
              <Alert style={{ marginTop: 4 }} type="info" showIcon message="完成率计算规则：完成率 =（三方均签名通过的核查阶段数 ÷ 应核查阶段总数）× 100%，全院统一口径；末值取当前筛选口径实时完成率。" />
            </Card>
          </Col>
          <Col span={10}>
            <Card size="small" title="核查问题占比（按违规大类细分）" style={{ marginBottom: 12 }}>
              {problems.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下暂无违规记录" /> : <PieChart data={problems} unit="次" />}
            </Card>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={10}>
            <Card size="small" title="手术风险评估数据（ASA 分级分布）" style={{ marginBottom: 12 }}>
              <HBar data={asaDist} unit="例" color="#69b1ff" />
            </Card>
          </Col>
          <Col span={14}>
            <Card size="small" title="手术部位二次核对明细（申请单登记 vs 开刀前核查三方确认）" style={{ marginBottom: 12 }}>
              {siteCheck.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下暂无手术" /> : (
                <Table rowKey={(r, i) => i} size="small" pagination={false} dataSource={siteCheck}
                  columns={[
                    { title: '序号', render: (_, __, i) => i + 1, width: 60 },
                    { title: '手术间', dataIndex: 'room', width: 90 },
                    { title: '患者', dataIndex: 'patient', width: 100 },
                    { title: '申请时部位（手术申请单登记）', dataIndex: 'requested' },
                    { title: '核查时确认部位（开刀前核查三方确认）', dataIndex: 'checked' },
                    { title: '核查比对结果', width: 130, render: (_, r) => r.consistent ? <Tag color="success" icon={<Ico name="CheckCircleOutlined" />}>一致</Tag> : <Tag color="error" icon={<Ico name="WarningOutlined" />}>不一致 · 异常</Tag> },
                  ]}
                  rowClassName={(r) => r.consistent ? '' : 'site-mismatch'} />
              )}
              <div style={{ marginTop: 6, color: '#aaa', fontSize: 12 }}>说明：“核查时确认部位”取自开刀前核查中主刀医生逐项确认的“手术部位与标识确认”核查项所对应的手术部位；与手术申请单登记的部位不一致时自动高亮标红，形成申请-核查双重校验。</div>
            </Card>
          </Col>
        </Row>

        <Space>
          <Button type="primary" icon={<Ico name="FileTextOutlined" />} onClick={genReportFromStats}>基于当前统计生成质量报表</Button>
          {genDoc && <Button icon={<Ico name="DownloadOutlined" />} onClick={() => message.success('已下载「' + genDoc.title + '」（演示 PDF）')}>下载报表</Button>}
          {genDoc && <a onClick={() => navigate('/analysis/report')}>已归档，前往「核查质量报告」查看 →</a>}
        </Space>
      </div>
    );
  }

  /* ---------- L3-4-2 核查质量报告 ---------- */
  function Report() {
    U.useFhir();
    const [fDept, setFDept] = useState();
    const [fRange, setFRange] = useState(null);
    const [selectedRowKeys, setSelectedRowKeys] = useState([]);
    const [viewDoc, setViewDoc] = useState(null);
    let docs = Object.values(store.db.DocumentReference || {}).sort((a, b) => a.date < b.date ? 1 : -1);
    if (fDept) docs = docs.filter((d) => d.department === fDept);
    if (fRange && fRange[0] && fRange[1]) {
      const s = fRange[0].format('YYYY-MM-DD'), e = fRange[1].format('YYYY-MM-DD');
      docs = docs.filter((d) => { const dd = dayjs(d.date).format('YYYY-MM-DD'); return dd >= s && dd <= e; });
    }

    function exportPdf() {
      if (!selectedRowKeys.length) { message.warning('请先勾选要导出的报告'); return; }
      message.success('已导出 ' + selectedRowKeys.length + ' 份报告为 PDF（演示）');
      setSelectedRowKeys([]);
    }

    const columns = [
      { title: '序号', render: (_, __, i) => i + 1, width: 60 },
      { title: '报告名称', dataIndex: 'title', render: (t, r) => <a onClick={() => setViewDoc(r)}>{t}</a> },
      { title: '统计周期', dataIndex: 'period', width: 160 },
      { title: '科室', dataIndex: 'department', width: 90 },
      { title: '生成时间', dataIndex: 'date', render: (d) => fmt(d, true), width: 160 },
      { title: '归档状态', dataIndex: 'archived', width: 90, render: (a) => a ? <Tag color="success">已归档</Tag> : <Tag>未归档</Tag> },
      { title: '操作', width: 110, render: (_, r) => <Space><a onClick={() => setViewDoc(r)}>查看</a><a onClick={() => message.success('已导出 ' + r.title + '（演示）')}>导出</a></Space> },
    ];

    return (
      <div>
        <PageHeader title="核查质量报告" sub="浏览与归档手术室核查质量评价报告（US-1.6 AC3）" />
        <Card size="small" title="报告筛选" style={{ marginBottom: 12 }}>
          <Space wrap>
            生成时间：<RangePicker value={fRange} onChange={setFRange} allowClear placeholder={['开始日期', '结束日期']} />
            科室：<Select allowClear placeholder="全院" style={{ width: 130 }} value={fDept} onChange={setFDept} options={['全院'].concat(DEPTS).map((d) => ({ value: d, label: d }))} />
            <Divider type="vertical" />
            <Button icon={<Ico name="ExportOutlined" />} onClick={exportPdf}>导出PDF</Button>
          </Space>
        </Card>
        <Card size="small" title="历史归档报告列表" style={{ marginBottom: 12 }}>
          <Table rowKey="id" size="small" columns={columns} dataSource={docs} pagination={{ pageSize: 8 }}
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }} />
          <div style={{ marginTop: 6, color: '#aaa', fontSize: 12 }}>说明：勾选报告后点击上方「导出PDF」批量导出；点击「查看」弹出报告详情。报告由「核查统计」页面基于当前统计筛选条件生成并自动归档，本页不支持手动新建。</div>
        </Card>
        <Modal title={viewDoc ? viewDoc.title : ''} open={!!viewDoc} onCancel={() => setViewDoc(null)} width={860}
          footer={<Space>
            <Button onClick={() => setViewDoc(null)}>关闭</Button>
            <Button type="primary" icon={<Ico name="DownloadOutlined" />} onClick={() => viewDoc && message.success('已下载「' + viewDoc.title + '」（演示 PDF）')}>下载 PDF</Button>
          </Space>}>
          {viewDoc && <ReportBody doc={viewDoc} />}
        </Modal>
      </div>
    );
  }

  function ReportBody({ doc }) {
    const c = doc.content || {};
    const hasDetail = !!(c.problems || c.asaDist || c.siteCheck);
    return (
      <div style={{ lineHeight: 1.9, maxWidth: 800 }}>
        <div style={{ textAlign: 'center', color: '#999', marginBottom: 12 }}>统计周期：{doc.period} · 范围：{doc.department} · 生成时间：{fmt(doc.date, true)}</div>
        <Divider orientation="left" plain>一、核心指标汇总</Divider>
        <Row gutter={16} style={{ marginBottom: 8 }}>
          <Col span={8} style={{ textAlign: 'center' }}><Donut percent={c.completionRate || 0} label="核查完成率" color="#52c41a" /></Col>
          <Col span={16}>
            <p>核查总数量：{c.totalSurgery != null ? c.totalSurgery : '—'} 台　｜　整体完成率：{c.completionRate}%　｜　违规发生率：{c.violationRate}%</p>
            <p style={{ color: '#888' }}>{c.summary}</p>
          </Col>
        </Row>
        {!hasDetail && <Alert type="info" showIcon message="该历史报告为早期归档版本，仅含核心指标汇总，无逐项明细数据。" style={{ marginBottom: 8 }} />}
        {c.problems && (
          <div>
            <Divider orientation="left" plain>二、核查问题占比</Divider>
            {c.problems.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本期无违规记录" /> : <U.PieChart data={c.problems} unit="次" />}
          </div>
        )}
        {c.asaDist && (
          <div>
            <Divider orientation="left" plain>三、ASA 手术风险分布</Divider>
            <U.HBar data={c.asaDist} unit="例" color="#69b1ff" />
          </div>
        )}
        {c.siteCheck && (
          <div>
            <Divider orientation="left" plain>四、手术部位二次核对明细</Divider>
            {c.siteCheck.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本期无手术部位核对数据" /> : (
              <Table rowKey={(r, i) => i} size="small" pagination={false} dataSource={c.siteCheck}
                columns={[
                  { title: '手术间', dataIndex: 'room', width: 90 },
                  { title: '患者', dataIndex: 'patient', width: 100 },
                  { title: '申请时部位', dataIndex: 'requested' },
                  { title: '核查时确认部位', dataIndex: 'checked' },
                  { title: '比对结果', width: 110, render: (_, r) => r.consistent ? <Tag color="success">一致</Tag> : <Tag color="error">不一致</Tag> },
                ]}
                rowClassName={(r) => r.consistent ? '' : 'site-mismatch'} />
            )}
          </div>
        )}
        <Divider orientation="left" plain>五、整改改进建议</Divider>
        <ul>
          <li>强化术前器械清点培训，重点术前双侧部位标识复核；</li>
          <li>推进三方并行确认，缩短核查等待耗时；核查发起前预校验三方资质，减少术中阻断；</li>
          <li>超时违规按原因分类归因（人员延迟/术中突发/系统异常），提升管理分析精度。</li>
        </ul>
        <div style={{ textAlign: 'right', color: '#52c41a' }}><Ico name="CheckCircleOutlined" /> 报告已自动归档保存</div>
      </div>
    );
  }

  Object.assign(SSAQ.pages, { Stats, Report });
})();
