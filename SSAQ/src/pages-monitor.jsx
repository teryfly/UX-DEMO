/* L2-3 / L3-3-x 核查监督模块 */
(function () {
  const SSAQ = window.SSAQ;
  const store = SSAQ.store;
  const { useState } = React;
  const {
    Card, Table, Tag, Button, Modal, Form, Select, Input, Space, Alert, Row, Col,
    List, Empty, Divider, Progress, message, Checkbox, DatePicker,
  } = antd;
  const { RangePicker } = DatePicker;
  const U = SSAQ.ui;
  const { PageHeader, StatCard, navigate, Ico, phaseTag, fmt } = U;
  const PHASES = store.PHASES;
  const SLUG = { preAnesthesia: 'pre-anesthesia', preIncision: 'pre-incision', preDeparture: 'pre-departure' };
  const AUDIT_TYPE = {
    block: { color: 'red', text: '卡控拦截', icon: 'StopOutlined' },
    qualification: { color: 'volcano', text: '资质异常', icon: 'SafetyCertificateOutlined' },
    timeout: { color: 'orange', text: '超时违规', icon: 'ClockCircleOutlined' },
  };
  const TIMEOUT_SUB = { staff: '人员延迟', intraop: '术中突发', system: '系统异常' };
  const patName = (e) => store.db.Patient[e.subject.reference.split('/')[1]].name[0].text;
  const phaseName = (k) => { const p = PHASES.find((x) => x.key === k); return p ? p.name : k; };
  const procName = (a) => { const enc = a.encounter && store.db.Encounter[a.encounter]; const proc = enc && store.db.Procedure['proc-' + enc.id]; return proc ? proc.code.text : '—'; };

  function invalidParticipants(enc) {
    return enc.participant.filter((p) => {
      const pr = store.practitionerRole(p.actor.reference.split('/')[1]);
      return pr && !pr.qualification.valid;
    });
  }

  /* ---------- L3-3-1 核查执行看板 ---------- */
  function Board() {
    U.useFhir();
    const [fRoom, setFRoom] = useState();
    const [fDept, setFDept] = useState();
    let encs = Object.values(store.db.Encounter || {});
    const audits = Object.values(store.db.AuditEvent || {});
    const blockAudits = audits.filter((a) => a.type === 'block');
    const timeoutAudits = audits.filter((a) => a.type === 'timeout');
    const qualWarn = encs.flatMap((e) => invalidParticipants(e).map((p) => ({ enc: e, p })));
    const done = Object.values(store.db.QuestionnaireResponse || {}).filter((q) => q.status === 'completed').length;
    const blocked = encs.filter((e) => Object.values(e.phaseStatus).some((s) => s === 'blocked')).length;
    const pendingSurgeries = encs.filter((e) => e.status !== 'finished').length;

    const rooms = [...new Set(Object.values(store.db.Encounter).map((e) => e.room))];
    const depts = [...new Set(Object.values(store.db.Encounter).map((e) => e.department))];
    if (fRoom) encs = encs.filter((e) => e.room === fRoom);
    if (fDept) encs = encs.filter((e) => e.department === fDept);

    // 阶段完成率
    const allEncs = Object.values(store.db.Encounter);
    const phaseRate = PHASES.map((ph) => ({ label: ph.short, value: Math.round(allEncs.filter((e) => e.phaseStatus[ph.key] === 'passed').length / allEncs.length * 100) }));

    const columns = [
      { title: '手术间', dataIndex: 'room', render: (r) => <b>{r}</b>, width: 90 },
      { title: '患者', render: (_, e) => patName(e), width: 90 },
      { title: '科室', dataIndex: 'department', width: 100 },
      { title: '术式', render: (_, e) => store.db.Procedure['proc-' + e.id].code.text },
      { title: '当前阶段', render: (_, e) => phaseName(e.currentPhase), width: 110 },
      { title: '状态', render: (_, e) => phaseTag(e.phaseStatus[e.currentPhase]), width: 110 },
      { title: '三阶段进度', render: (_, e) => <Space size={4}>{PHASES.map((ph) => phaseTag(e.phaseStatus[ph.key]))}</Space> },
      { title: '操作', width: 90, render: (_, e) => <a onClick={() => navigate('/monitor/record/' + e.id + '/' + e.currentPhase)}>查看核查</a> },
    ];

    return (
      <div>
        <PageHeader title="核查执行看板" sub="多台手术并行核查状态全局监控（US-1.5 AC1）" />
        <div className="stat-grid" style={{ marginBottom: 12 }}>
          <StatCard title="今日完成核查" value={done} suffix="项" color="#52c41a" />
          <StatCard title="今日待核查手术" value={pendingSurgeries} suffix="台" color="#faad14" />
          <StatCard title="卡控拦截" value={blocked + blockAudits.length} suffix="次" color="#ff4d4f" />
          <StatCard title="今日核查超时" value={timeoutAudits.length} suffix="次" color="#fa8c16" />
        </div>
        <Card size="small" style={{ marginBottom: 12 }}
          title={<span><Ico name="TableOutlined" /> 手术室核查状态总览</span>}
          extra={<Space>
            <Select allowClear placeholder="手术间" style={{ width: 120 }} value={fRoom} onChange={setFRoom} options={rooms.map((r) => ({ value: r, label: r }))} />
            <Select allowClear placeholder="科室" style={{ width: 120 }} value={fDept} onChange={setFDept} options={depts.map((d) => ({ value: d, label: d }))} />
            <Button size="small" onClick={() => { setFRoom(); setFDept(); }}>重置</Button>
          </Space>}>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#999' }}>
            状态图例：{phaseTag('inProgress')} {phaseTag('notStarted')} {phaseTag('blocked')} {phaseTag('passed')}　点击行可跳转对应核查页面
          </div>
          {encs.length === 0 ? <Empty description="暂无符合筛选条件的手术" /> : <Table rowKey="id" size="small" columns={columns} dataSource={encs} pagination={false} />}
        </Card>
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={8}>
            <Card size="small" title={<span style={{ color: '#ff4d4f' }}><Ico name="StopOutlined" /> 强制卡控拦截记录</span>} bodyStyle={{ minHeight: 150 }}>
              {blockAudits.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前无卡控拦截" />
                : <List size="small" dataSource={blockAudits} renderItem={(a) => (
                  <List.Item><List.Item.Meta title={<span>{a.room} · {a.patientName} · {phaseName(a.phase)}</span>} description={<span style={{ fontSize: 12 }}>{a.detail}</span>} /></List.Item>)} />}
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" title={<span style={{ color: '#fa541c' }}><Ico name="SafetyCertificateOutlined" /> 签名资质异常预警</span>} bodyStyle={{ minHeight: 150 }}>
              {qualWarn.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无资质异常" />
                : <List size="small" dataSource={qualWarn} renderItem={({ enc, p }) => {
                  const pr = store.practitionerRole(p.actor.reference.split('/')[1]);
                  return <List.Item><List.Item.Meta title={<span>{enc.room} · {p.actor.display}（{store.ROLES[p.role].name}）</span>} description={<span style={{ fontSize: 12, color: '#fa541c' }}>{pr.qualification.note}</span>} /><Tag color="error">资质异常</Tag></List.Item>;
                }} />}
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" title={<span style={{ color: '#fa8c16' }}><Ico name="ClockCircleOutlined" /> 超时违规预警</span>} bodyStyle={{ minHeight: 150 }}
              extra={<a onClick={() => navigate('/monitor/violations')}>查看全部违规 →</a>}>
              {timeoutAudits.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无超时违规" />
                : <List size="small" dataSource={timeoutAudits} renderItem={(a) => (
                  <List.Item><List.Item.Meta title={<span>{a.room} · {a.patientName} <Tag color="gold">{TIMEOUT_SUB[a.subtype]}</Tag></span>} description={<span style={{ fontSize: 12 }}>{a.detail}</span>} /></List.Item>)} />}
            </Card>
          </Col>
        </Row>
        <Card size="small" title="各阶段核查完成率">
          <Row gutter={24} align="middle">
            {phaseRate.map((p) => (
              <Col span={8} key={p.label}>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>{p.label}核查完成率</div>
                <Progress percent={p.value} status="active" strokeColor="#1677ff" />
              </Col>
            ))}
          </Row>
        </Card>
      </div>
    );
  }

  /* ---------- 核查记录（监督视角只读查看，对应看板“查看核查”）---------- */
  function MonitorRecord({ encId, phase }) {
    U.useFhir();
    const enc = store.db.Encounter[encId];
    const phaseDef = PHASES.find((p) => p.key === phase);
    if (!enc || !phaseDef) {
      return <div><PageHeader title="核查记录" extra={<Button onClick={() => navigate('/monitor/board')}>返回看板</Button>} /><Empty description="核查记录不存在" /></div>;
    }
    const pat = store.db.Patient[enc.subject.reference.split('/')[1]];
    const proc = store.db.Procedure['proc-' + enc.id];
    const qr = store.db.QuestionnaireResponse['qr-' + enc.id + '-' + phase];
    const partyRoles = store.PARTY_ROLES;
    const roleNm = (c) => store.ROLES[c].name;
    const surgeon = enc.participant.find((p) => p.role === 'surgeon');
    const anes = enc.participant.find((p) => p.role === 'anesthesiologist');
    const nurse = enc.participant.find((p) => p.role === 'scrubNurse');
    return (
      <div>
        <PageHeader title={phaseDef.name + '核查记录'} sub={enc.room + ' · ' + patName(enc) + ' · 只读查看（手术室管理部门监督视角）'}
          extra={<Button icon={<Ico name="ArrowLeftOutlined" />} onClick={() => navigate('/monitor/board')}>返回看板</Button>} />
        <Card size="small" style={{ marginBottom: 12 }} title="手术信息">
          <div className="info-grid">
            <div><span className="k">手术间：</span><span className="v">{enc.room}</span></div>
            <div><span className="k">科室：</span><span className="v">{enc.department}</span></div>
            <div><span className="k">手术日期：</span><span className="v">{enc.surgeryDate}</span></div>
            <div><span className="k">患者：</span><span className="v">{pat.name[0].text}</span></div>
            <div><span className="k">拟行术式：</span><span className="v">{proc.code.text}</span></div>
            <div><span className="k">手术部位：</span><span className="v">{proc.bodySite[0].text}</span></div>
            <div><span className="k">主刀医生：</span><span className="v">{surgeon ? surgeon.actor.display : '—'}</span></div>
            <div><span className="k">麻醉医生：</span><span className="v">{anes ? anes.actor.display : '—'}</span></div>
            <div><span className="k">洗手护士：</span><span className="v">{nurse ? nurse.actor.display : '—'}</span></div>
          </div>
        </Card>
        {!qr ? <Empty description={phaseDef.name + '尚未发起'} /> : (
          <div>
            <Card size="small" style={{ marginBottom: 12 }} title="核查结论">
              <Space size={16}>
                <span>核查状态：{qr.status === 'completed' ? <Tag color="success" icon={<Ico name="CheckCircleFilled" />}>已完成</Tag> : <Tag color="processing">核查中</Tag>}</span>
                {qr.timedOut && <Tag color="error" icon={<Ico name="WarningFilled" />}>超时违规（{qr.durationMinutes}分钟）</Tag>}
              </Space>
              <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>发起：{fmt(qr.authored, true)}{qr.completedAt && ' · 完成：' + fmt(qr.completedAt, true)}</div>
            </Card>
            <div className="party-grid">
              {partyRoles.map((prole) => {
                const party = qr.parties[prole];
                return (
                  <div className={'party-card' + (party.signed ? ' done' : '')} key={prole}>
                    <div className="party-head">
                      <span className="party-name">{roleNm(prole)}：{party.actorName} {prole === phaseDef.lead && <Tag color="gold">牵头</Tag>}</span>
                      {party.signed ? <Tag color="success" icon={<Ico name="CheckCircleFilled" />}>已确认</Tag>
                        : party.qualificationValid === false ? <Tag color="error">资质异常</Tag> : <Tag>未确认</Tag>}
                    </div>
                    {party.items.map((it, i) => (
                      <div className="check-item" key={i}>
                        <Checkbox checked={it.confirmed} disabled><span className="txt">{i + 1}. {it.text}</span></Checkbox>
                      </div>
                    ))}
                    {party.signed && <div style={{ marginTop: 8, fontSize: 12, color: '#52c41a' }}><Ico name="SafetyCertificateOutlined" /> 签名于 {fmt(party.signedAt, true)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ---------- L3-3-2 违规记录 ---------- */
  function Violations() {
    U.useFhir();
    const [fType, setFType] = useState();
    const [fRoom, setFRoom] = useState();
    const [fName, setFName] = useState('');
    const [fRange, setFRange] = useState(null); // [dayjs, dayjs]
    const [edit, setEdit] = useState(null);
    const [form] = Form.useForm();
    let data = Object.values(store.db.AuditEvent || {}).sort((a, b) => a.recorded < b.recorded ? 1 : -1);
    const all = data;
    const counts = { block: all.filter((d) => d.type === 'block').length, qualification: all.filter((d) => d.type === 'qualification').length, timeout: all.filter((d) => d.type === 'timeout').length };
    if (fType) data = data.filter((d) => d.type === fType);
    if (fRoom) data = data.filter((d) => d.room === fRoom);
    if (fName) data = data.filter((d) => (d.agentName || '').indexOf(fName) >= 0);
    if (fRange && fRange[0] && fRange[1]) {
      const start = fRange[0].startOf('day'), end = fRange[1].endOf('day');
      data = data.filter((d) => { const t = dayjs(d.recorded); return !t.isBefore(start) && !t.isAfter(end); });
    }
    const rooms = [...new Set(all.map((d) => d.room))];

    function openEdit(r) { setEdit(r); form.setFieldsValue({ subtype: r.subtype, detail: r.detail }); }
    function saveEdit() { form.validateFields().then((v) => { store.update('AuditEvent', edit.id, { ...edit, ...v }); message.success('已更新违规分类'); setEdit(null); }); }

    const columns = [
      { title: '序号', render: (_, __, i) => i + 1, width: 60 },
      { title: '手术间', dataIndex: 'room', width: 90 },
      { title: '科室', dataIndex: 'department', width: 100 },
      { title: '术式', render: procName, width: 130, ellipsis: true },
      { title: '患者', dataIndex: 'patientName', width: 100 },
      { title: '违规大类', dataIndex: 'type', width: 110, render: (t) => <Tag color={AUDIT_TYPE[t].color} icon={<Ico name={AUDIT_TYPE[t].icon} />}>{AUDIT_TYPE[t].text}</Tag> },
      { title: '超时细分原因', dataIndex: 'subtype', width: 110, render: (s) => s ? <Tag color="gold">{TIMEOUT_SUB[s]}</Tag> : <span style={{ color: '#ccc' }}>—</span> },
      { title: '责任人', dataIndex: 'agentName', width: 90 },
      { title: '核查阶段', dataIndex: 'phase', width: 100, render: phaseName },
      { title: '发生时间', dataIndex: 'recorded', render: (r) => fmt(r, true), width: 160 },
      { title: '违规详情', dataIndex: 'detail', ellipsis: true },
      { title: '操作', width: 70, render: (_, r) => r.type === 'timeout' ? <a onClick={() => openEdit(r)}>编辑</a> : <a onClick={() => Modal.info({ title: '违规详情', content: r.detail })}>查看</a> },
    ];
    return (
      <div>
        <PageHeader title="违规记录" sub="卡控拦截 / 资质异常 / 超时违规三类日志多维度追溯（US-1.5 AC4）" />
        <Card size="small" style={{ marginBottom: 12 }} title="筛选与快捷预设"
          extra={<Button size="small" icon={<Ico name="ExportOutlined" />} onClick={() => message.success('已导出违规记录（演示）')}>导出数据</Button>}>
          <Space wrap>
            <Select allowClear placeholder="违规类型" style={{ width: 130 }} value={fType} onChange={setFType} options={Object.keys(AUDIT_TYPE).map((t) => ({ value: t, label: AUDIT_TYPE[t].text }))} />
            <Select allowClear placeholder="手术间" style={{ width: 120 }} value={fRoom} onChange={setFRoom} options={rooms.map((r) => ({ value: r, label: r }))} />
            <Input placeholder="人员姓名" style={{ width: 140 }} value={fName} onChange={(e) => setFName(e.target.value)} allowClear />
            <RangePicker value={fRange} onChange={setFRange} allowClear placeholder={['发生开始日期', '发生结束日期']} />
            <Divider type="vertical" />
            <Button size="small" onClick={() => { setFType('timeout'); setFRoom(); setFName(''); setFRange(null); }}>本周超时</Button>
            <Button size="small" onClick={() => { setFType('qualification'); setFRoom(); setFName(''); setFRange(null); }}>本科资质异常</Button>
            <Button size="small" onClick={() => { setFType('block'); setFRoom(); setFName(''); setFRange(null); }}>全部拦截</Button>
            <Button size="small" onClick={() => { setFType(); setFRoom(); setFName(''); setFRange(null); }}>重置</Button>
          </Space>
        </Card>
        <div className="stat-grid cols-3" style={{ marginBottom: 12 }}>
          <StatCard title="卡控拦截" value={counts.block} suffix="条" color="#ff4d4f" />
          <StatCard title="资质异常" value={counts.qualification} suffix="条" color="#fa541c" />
          <StatCard title="超时违规" value={counts.timeout} suffix="条" color="#fa8c16" />
        </div>
        <Card size="small">
          {data.length === 0 ? <Empty description="暂无违规记录" />
            : <Table rowKey="id" size="small" columns={columns} dataSource={data} pagination={{ pageSize: 8, showTotal: (t) => '共 ' + t + ' 条' }} />}
        </Card>
        <Modal title="编辑超时违规分类" open={!!edit} onOk={saveEdit} onCancel={() => setEdit(null)} destroyOnClose>
          <Alert style={{ marginBottom: 12 }} type="info" showIcon message="仅超时违规可编辑分类归因；卡控拦截与资质异常为系统固定记录，不可修改。" />
          <Form form={form} layout="vertical">
            <Form.Item name="subtype" label="超时细分原因" rules={[{ required: true }]}>
              <Select options={Object.keys(TIMEOUT_SUB).map((k) => ({ value: k, label: TIMEOUT_SUB[k] }))} />
            </Form.Item>
            <Form.Item name="detail" label="违规详情"><Input.TextArea rows={3} /></Form.Item>
          </Form>
        </Modal>
      </div>
    );
  }

  Object.assign(SSAQ.pages, { Board, MonitorRecord, Violations });
})();
