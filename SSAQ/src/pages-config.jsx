/* L2-1 / L3-1-x / L4-1-2-1 核查表配置模块 */
(function () {
  const SSAQ = window.SSAQ;
  const store = SSAQ.store;
  const { useState, useEffect } = React;
  const {
    Card, Table, Tag, Button, Modal, Form, Input, Select, Switch, InputNumber, Space, Radio,
    Tabs, message, Popconfirm, Descriptions, Timeline, Row, Col, Alert, Divider, Empty, Collapse, Tooltip, Segmented,
  } = antd;
  const U = SSAQ.ui;
  const { PageHeader, navigate, Ico, fmt } = U;
  const PHASES = store.PHASES;
  const PARTY_ROLES = store.PARTY_ROLES;
  const roleName = (c) => store.ROLES[c].name;
  const SURGERY_TYPES = ['普外科', '肝胆外科', '骨科', '心外科', '神经外科', '泌尿外科', '胸外科', '妇科', '耳鼻喉科', '眼科', '血管外科', '通用'];

  function statusTag(s) {
    if (s === 'active') return <Tag color="success">已生效</Tag>;
    if (s === 'draft') return <Tag color="warning">草稿</Tag>;
    return <Tag color="default">停用</Tag>;
  }
  function logChange(targetRef, type, summary, version) {
    store.create('Provenance', {
      target: [{ reference: targetRef }], recorded: SSAQ.nowIso(), activity: { text: type },
      kind: 'config', opType: type, agent: [{ who: { display: store.currentRole().name } }], summary, version,
    }, { silent: true });
  }

  /* ---------- L3-1-1 手术安全核查表配置（列表 → 配置详情）---------- */
  function ChecklistConfig() {
    U.useFhir();
    const [configId, setConfigId] = useState(null); // null=列表视图
    const [fType, setFType] = useState();
    const [fStatus, setFStatus] = useState();
    const [kw, setKw] = useState('');
    if (configId) return <ChecklistEditor id={configId} onBack={() => setConfigId(null)} onOpen={setConfigId} />;

    let data = Object.values(store.db.Questionnaire || {});
    if (fType) data = data.filter((d) => (d.surgeryTypes || []).indexOf(fType) >= 0);
    if (fStatus) data = data.filter((d) => d.status === fStatus);
    if (kw) data = data.filter((d) => d.name.indexOf(kw) >= 0 || (d.code || '').indexOf(kw) >= 0);

    const columns = [
      { title: '序号', render: (_, __, i) => i + 1, width: 60 },
      { title: '核查表名称', dataIndex: 'name', render: (t, r) => <a onClick={() => setConfigId(r.id)}>{t}</a> },
      { title: '适用手术类型', dataIndex: 'surgeryTypes', render: (s) => (s || []).map((x) => <Tag key={x}>{x}</Tag>) },
      { title: '阶段数', render: () => 3, width: 70 },
      { title: '状态', dataIndex: 'status', render: statusTag, width: 90 },
      { title: '更新时间', dataIndex: 'meta', render: (m) => fmt(m.lastUpdated), sorter: (a, b) => a.meta.lastUpdated < b.meta.lastUpdated ? -1 : 1 },
      { title: '更新人', dataIndex: 'updater', width: 90 },
      { title: '操作', width: 90, render: (_, r) => <a onClick={() => setConfigId(r.id)}>配置</a> },
    ];
    return (
      <div>
        <PageHeader title="手术安全核查表配置" sub="按手术类型差异化配置核查内容项（US-1.1 AC1）"
          extra={<Button type="primary" icon={<Ico name="PlusOutlined" />} onClick={() => {
            const id = SSAQ.genId('questionnaire');
            store.create('Questionnaire', { id, name: '新建核查表', title: '新建核查表', code: 'SFC-NEW-' + id.slice(-3), surgeryTypes: [], status: 'draft', version: '0.1', updater: store.currentRole().name, item: [] });
            logChange('Questionnaire/' + id, '新增', '创建核查表（草稿）', 'v0.1');
            setConfigId(id); message.success('已新建草稿核查表');
          }}>+ 新增核查表</Button>} />
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space wrap>
            手术类型：<Select allowClear placeholder="全部" style={{ width: 130 }} value={fType} onChange={setFType} options={SURGERY_TYPES.map((s) => ({ value: s, label: s }))} />
            状态：<Select allowClear placeholder="全部" style={{ width: 110 }} value={fStatus} onChange={setFStatus} options={[{ value: 'active', label: '已生效' }, { value: 'draft', label: '草稿' }, { value: 'inactive', label: '停用' }]} />
            <Input.Search placeholder="搜索核查表名称…" style={{ width: 200 }} onSearch={setKw} allowClear />
          </Space>
        </Card>
        <Card size="small">
          {data.length === 0
            ? <Empty description="暂无核查表模板"><Button type="primary">+ 新建核查表</Button></Empty>
            : <Table rowKey="id" size="small" columns={columns} dataSource={data}
                rowClassName={(r) => r.status === 'inactive' ? 'row-dim' : ''} pagination={{ pageSize: 8, showTotal: (t) => '共 ' + t + ' 条' }} />}
        </Card>
      </div>
    );
  }

  function ChecklistEditor({ id, onBack, onOpen }) {
    U.useFhir();
    const q = store.db.Questionnaire[id];
    const [phase, setPhase] = useState('preAnesthesia');
    const [itemEdit, setItemEdit] = useState(null); // {gi?} 内联编辑
    const [loadModal, setLoadModal] = useState(false);
    const [loadSel, setLoadSel] = useState(null);
    const [valErr, setValErr] = useState(null);
    const [form] = Form.useForm();
    const [infoForm] = Form.useForm();
    useEffect(() => { if (q) infoForm.setFieldsValue({ name: q.name, code: q.code, surgeryTypes: q.surgeryTypes, status: q.status }); }, [id]);
    if (!q) return <Empty description="核查表不存在" />;

    const indexed = q.item.map((it, gi) => ({ ...it, _gi: gi }));
    const phaseItems = indexed.filter((it) => it.phase === phase).sort((a, b) => (a.party === b.party ? a.order - b.order : PARTY_ROLES.indexOf(a.party) - PARTY_ROLES.indexOf(b.party)));
    const reqCount = phaseItems.filter((it) => it.required).length;

    function saveInfo(silent) {
      const v = infoForm.getFieldsValue();
      store.update('Questionnaire', q.id, { ...q, name: v.name, title: v.name, code: v.code, surgeryTypes: v.surgeryTypes, updater: store.currentRole().name });
      if (!silent) message.success('已保存基本信息');
    }
    function openAdd() { form.setFieldsValue({ text: '', parties: [PHASES.find((p) => p.key === phase).lead], required: true, order: phaseItems.length + 1 }); setItemEdit({}); }
    function openEdit(it) { form.setFieldsValue({ text: it.text, party: it.party, required: it.required, order: it.order }); setItemEdit({ gi: it._gi }); }
    function saveItem() {
      form.validateFields().then((v) => {
        const item = q.item.map((x) => ({ ...x }));
        if (itemEdit.gi != null) {
          item[itemEdit.gi] = { ...item[itemEdit.gi], text: v.text, party: v.party, required: v.required, order: v.order };
          logChange('Questionnaire/' + q.id, '编辑', '修改核查项「' + v.text + '」');
        } else {
          const parties = (v.parties && v.parties.length) ? v.parties : [PHASES.find((p) => p.key === phase).lead];
          parties.forEach((p) => item.push({ phase, party: p, text: v.text, required: v.required, order: v.order }));
          logChange('Questionnaire/' + q.id, '编辑', '新增核查项「' + v.text + '」（' + parties.map(roleName).join('/') + '）');
        }
        store.update('Questionnaire', q.id, { ...q, item, updater: store.currentRole().name });
        setItemEdit(null); message.success('核查项已保存');
      });
    }
    function delItem(gi) {
      store.update('Questionnaire', q.id, { ...q, item: q.item.filter((_, i) => i !== gi), updater: store.currentRole().name });
      logChange('Questionnaire/' + q.id, '编辑', '删除一条核查项'); message.success('已删除');
    }
    function loadTemplate() {
      const src = store.db.Questionnaire[loadSel];
      if (!src) { message.warning('请选择模板'); return; }
      const loaded = src.item.map((it) => ({ ...it }));
      store.update('Questionnaire', q.id, { ...q, item: loaded, updater: store.currentRole().name });
      logChange('Questionnaire/' + q.id, '编辑', '从模板「' + src.name + '」加载麻醉前、开刀前、离室前全部核查项');
      setLoadModal(false); setLoadSel(null); message.success('已加载模板核查项（覆盖麻醉前、开刀前、离室前三阶段）');
    }
    function saveDraft() { saveInfo(true); store.update('Questionnaire', q.id, { ...store.db.Questionnaire[q.id], status: 'draft', updater: store.currentRole().name }); logChange('Questionnaire/' + q.id, '编辑', '保存草稿'); message.success('已保存为草稿'); }
    function activate() {
      saveInfo(true);
      const missing = PHASES.filter((ph) => q.item.filter((it) => it.phase === ph.key && it.required).length === 0).map((ph) => ph.name);
      if (missing.length) { setValErr(missing); return; }
      setValErr(null);
      const nv = 'v' + (parseFloat((q.version || '0').replace('v', '')) + 0.1).toFixed(1);
      store.update('Questionnaire', q.id, { ...store.db.Questionnaire[q.id], status: 'active', version: nv.replace('v', ''), updater: store.currentRole().name });
      logChange('Questionnaire/' + q.id, '编辑', '确认生效，发布 ' + nv, nv);
      message.success('核查表已确认生效（' + nv + '）');
    }
    function toggleStatus(checked) {
      if (checked) { activate(); return; }
      store.update('Questionnaire', q.id, { ...store.db.Questionnaire[q.id], status: 'inactive', updater: store.currentRole().name });
      logChange('Questionnaire/' + q.id, '停用', '手动停用该核查表');
      message.success('已停用该核查表');
    }

    const logs = Object.values(store.db.Provenance || {}).filter((p) => p.kind === 'config' && p.target[0].reference === 'Questionnaire/' + q.id).sort((a, b) => a.recorded < b.recorded ? 1 : -1);

    return (
      <div>
        <PageHeader title={<span><a onClick={onBack}>手术安全核查表配置</a> <Ico name="RightOutlined" style={{ fontSize: 12, color: '#bbb' }} /> {q.name}</span>}
          sub="从模板快速加载或手动配置核查项，确认生效前自动校验必填项" extra={<Button onClick={onBack} icon={<Ico name="ArrowLeftOutlined" />}>返回列表</Button>} />

        {q.status === 'inactive' && <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="该模板已停用，不可用于核查执行。可编辑后重新确认生效。" />}

        <Card size="small" title="核查表基本信息" style={{ marginBottom: 12 }}>
          <Form form={infoForm} layout="inline" onValuesChange={() => {}}>
            <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input style={{ width: 220 }} /></Form.Item>
            <Form.Item name="code" label="编码"><Input style={{ width: 160 }} /></Form.Item>
            <Form.Item name="surgeryTypes" label="适用手术类型"><Select mode="multiple" style={{ minWidth: 260 }} placeholder="可多选" options={SURGERY_TYPES.map((s) => ({ value: s, label: s }))} /></Form.Item>
            <Form.Item label="状态">
              <Space>
                {statusTag(q.status)}
                <Switch checked={q.status === 'active'} checkedChildren="启用" unCheckedChildren="停用" onChange={toggleStatus} />
                <span style={{ color: '#aaa' }}>版本 {q.version}</span>
              </Space>
            </Form.Item>
          </Form>
        </Card>

        <Card size="small" title="核查内容项配置" style={{ marginBottom: 12 }}
          extra={<Space><Button size="small" icon={<Ico name="ImportOutlined" />} onClick={() => setLoadModal(true)}>从模板加载</Button><Button size="small" type="primary" icon={<Ico name="PlusOutlined" />} onClick={openAdd}>+ 新增核查项</Button></Space>}>
          <Tabs activeKey={phase} onChange={(k) => { setPhase(k); setItemEdit(null); }} tabPosition="left"
            items={PHASES.map((ph) => ({
              key: ph.key,
              label: <span>{ph.name}</span>,
              children: (
                <div>
                  <div style={{ marginBottom: 8, color: '#888', fontSize: 13 }}>{ph.name}内容项（共 {phaseItems.length} 项，必填 {reqCount} 项）· {roleName(ph.lead)}牵头</div>
                  {itemEdit && (
                    <Card size="small" style={{ marginBottom: 10, background: '#f6faff' }} title={itemEdit.gi != null ? '编辑核查项' : '新增核查项'}>
                      <Form form={form} layout="inline">
                        <Form.Item name="text" label="核查项文本" rules={[{ required: true, message: '请输入' }]}><Input style={{ width: 280 }} /></Form.Item>
                        {itemEdit.gi != null
                          ? <Form.Item name="party" label="确认角色"><Select style={{ width: 120 }} options={PARTY_ROLES.map((r) => ({ value: r, label: roleName(r) }))} /></Form.Item>
                          : <Form.Item name="parties" label="确认角色" rules={[{ required: true, message: '至少选择一个角色' }]}
                              tooltip="可多选，同一核查项将按所选角色各生成一条记录，无需重复添加">
                              <Select mode="multiple" style={{ width: 220 }} placeholder="可多选" options={PARTY_ROLES.map((r) => ({ value: r, label: roleName(r) }))} />
                            </Form.Item>}
                        <Form.Item name="order" label="排序"><InputNumber min={1} style={{ width: 70 }} /></Form.Item>
                        <Form.Item name="required" label="必填" valuePropName="checked"><Switch /></Form.Item>
                        <Form.Item><Space><Button size="small" onClick={() => setItemEdit(null)}>取消</Button><Button size="small" type="primary" onClick={saveItem}>确认</Button></Space></Form.Item>
                      </Form>
                    </Card>
                  )}
                  {phaseItems.length === 0
                    ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无核查内容项"><Button size="small" type="primary" onClick={openAdd}>添加核查项</Button></Empty>
                    : <Table rowKey="_gi" size="small" pagination={false} dataSource={phaseItems}
                        columns={[
                          { title: '序号', render: (_, __, i) => i + 1, width: 60 },
                          { title: '核查项文本', dataIndex: 'text' },
                          { title: '确认角色', dataIndex: 'party', width: 110, render: (p) => <Tag color="blue">{roleName(p)}</Tag> },
                          { title: '必填', dataIndex: 'required', width: 70, render: (r) => r ? <Tag color="red">必填</Tag> : <span style={{ color: '#bbb' }}>选填</span> },
                          { title: '排序', dataIndex: 'order', width: 60 },
                          { title: '操作', width: 110, render: (_, it) => <Space><a onClick={() => openEdit(it)}>编辑</a><Popconfirm title="删除该核查项？" onConfirm={() => delItem(it._gi)}><a style={{ color: '#ff4d4f' }}>删除</a></Popconfirm></Space> },
                        ]} />}
                  <div style={{ marginTop: 6, color: '#bbb', fontSize: 12 }}>提示：可按“确认角色”分组维护各方核查项</div>
                </div>
              ),
            }))} />
        </Card>

        {valErr && <Alert style={{ marginBottom: 12 }} type="error" showIcon message="确认生效校验未通过：以下阶段缺少必填核查项，请补充后重试"
          description={<ul style={{ margin: 0 }}>{valErr.map((m) => <li key={m}>{m}阶段：至少需 1 项必填核查项</li>)}</ul>} />}

        <div style={{ textAlign: 'right', marginBottom: 12 }}>
          <Space>
            <Button onClick={onBack}>取消</Button>
            <Button onClick={saveDraft}>保存草稿</Button>
            <Button type="primary" icon={<Ico name="CheckCircleOutlined" />} onClick={activate}>确认生效</Button>
          </Space>
        </div>

        <Card size="small" title={<span><Ico name="HistoryOutlined" /> 核查表配置操作日志（可追溯 · US-1.1 AC3）</span>}>
          {logs.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无变更记录" />
            : <Table rowKey="id" size="small" pagination={false} dataSource={logs.slice(0, 10)}
                columns={[
                  { title: '操作时间', render: (l) => fmt(l.recorded, true), width: 170 },
                  { title: '操作人', render: (l) => l.agent[0].who.display, width: 100 },
                  { title: '操作类型', dataIndex: 'opType', width: 90, render: (t) => <Tag>{t}</Tag> },
                  { title: '变更内容摘要', dataIndex: 'summary' },
                ]} />}
        </Card>

        <Modal title="从模板加载" open={loadModal} onOk={loadTemplate} onCancel={() => setLoadModal(false)} width={680} okText="确认加载所选模板">
          <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="加载模板将覆盖当前核查表已有的麻醉前、开刀前、离室前全部核查内容项" />
          <Radio.Group value={loadSel} onChange={(e) => setLoadSel(e.target.value)} style={{ width: '100%' }}>
            <Table rowKey="id" size="small" pagination={false}
              dataSource={Object.values(store.db.Questionnaire).filter((t) => t.status === 'active' && t.id !== id)}
              columns={[
                { title: '', width: 40, render: (_, r) => <Radio value={r.id} /> },
                { title: '模板名称', dataIndex: 'name' },
                { title: '适用手术类型', dataIndex: 'surgeryTypes', render: (s) => (s || []).map((x) => <Tag key={x}>{x}</Tag>) },
                { title: '状态', dataIndex: 'status', render: statusTag },
                { title: '阶段数', render: () => 3 },
              ]} />
          </Radio.Group>
        </Modal>
      </div>
    );
  }

  /* ---------- L3-1-2 核查表模板列表 ---------- */
  function TemplateList() {
    U.useFhir();
    const [fType, setFType] = useState();
    const [fStatus, setFStatus] = useState();
    const [kw, setKw] = useState('');
    const [editId, setEditId] = useState(null); // 仅针对模板本身的编辑，独立于「手术安全核查表配置」的浏览状态
    if (editId) return <ChecklistEditor id={editId} onBack={() => setEditId(null)} onOpen={setEditId} />;
    let data = Object.values(store.db.Questionnaire || {});
    const total = data.length, active = data.filter((d) => d.status === 'active').length, draft = data.filter((d) => d.status === 'draft').length, inactive = data.filter((d) => d.status === 'inactive').length;
    if (fType) data = data.filter((d) => (d.surgeryTypes || []).indexOf(fType) >= 0);
    if (fStatus) data = data.filter((d) => d.status === fStatus);
    if (kw) data = data.filter((d) => d.name.indexOf(kw) >= 0 || (d.code || '').indexOf(kw) >= 0);

    const columns = [
      { title: '序号', render: (_, __, i) => i + 1, width: 60 },
      { title: '模板名称', dataIndex: 'name', render: (t, r) => <a onClick={() => navigate('/config/templates/' + r.id)}>{t}</a>, sorter: (a, b) => a.name.localeCompare(b.name) },
      { title: '编码', dataIndex: 'code' },
      { title: '适用手术类型', dataIndex: 'surgeryTypes', render: (s) => (s || []).map((x) => <Tag key={x}>{x}</Tag>) },
      { title: '核查阶段数', render: () => 3, width: 100 },
      { title: '状态', dataIndex: 'status', render: statusTag, width: 90 },
      { title: '更新时间', dataIndex: 'meta', render: (m) => fmt(m.lastUpdated), sorter: (a, b) => a.meta.lastUpdated < b.meta.lastUpdated ? -1 : 1 },
      { title: '操作', width: 150, render: (_, r) => <Space>
        <a onClick={() => navigate('/config/templates/' + r.id)}>详情</a>
        <a onClick={() => setEditId(r.id)}>编辑</a>
        <Popconfirm title="确定删除该模板？删除后不可恢复。" onConfirm={() => { store.remove('Questionnaire', r.id); message.success('已删除'); }}><a style={{ color: '#ff4d4f' }}>删除</a></Popconfirm>
      </Space> },
    ];
    return (
      <div>
        <PageHeader title="核查表模板列表" sub="展示已配置的核查表模板，支持加载复用、筛选与检索（US-1.1 AC2）" />
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space wrap>
            <span>模板总数 <b>{total}</b></span><Divider type="vertical" />
            <span>已生效 <b style={{ color: '#52c41a' }}>{active}</b></span>
            <span>草稿 <b style={{ color: '#faad14' }}>{draft}</b></span>
            <span>停用 <b style={{ color: '#8c8c8c' }}>{inactive}</b></span>
            <Divider type="vertical" />
            <Select allowClear placeholder="手术类型" style={{ width: 130 }} value={fType} onChange={setFType} options={SURGERY_TYPES.map((s) => ({ value: s, label: s }))} />
            <Select allowClear placeholder="状态" style={{ width: 120 }} value={fStatus} onChange={setFStatus} options={[{ value: 'active', label: '已生效' }, { value: 'draft', label: '草稿' }, { value: 'inactive', label: '停用' }]} />
            <Input.Search placeholder="名称/编码关键词" style={{ width: 180 }} onSearch={setKw} allowClear />
          </Space>
        </Card>
        <Card size="small">
          {data.length === 0
            ? <Empty description="暂无核查表模板" />
            : <Table rowKey="id" size="small" columns={columns} dataSource={data}
                rowClassName={(r) => r.status === 'inactive' ? 'row-dim' : ''}
                pagination={{ pageSize: 8, showSizeChanger: true, showTotal: (t) => '共 ' + t + ' 条' }} />}
        </Card>
      </div>
    );
  }

  /* ---------- L4-1-2-1 核查表模板详情 ---------- */
  function TemplateDetail({ id }) {
    U.useFhir();
    const q = store.db.Questionnaire[id];
    if (!q) return <Empty description="模板不存在" />;
    const logs = Object.values(store.db.Provenance || {}).filter((p) => p.kind === 'config' && p.target[0].reference === 'Questionnaire/' + id && p.version).sort((a, b) => a.recorded < b.recorded ? 1 : -1);

    function activate() {
      const missing = PHASES.filter((ph) => q.item.filter((it) => it.phase === ph.key && it.required).length === 0).map((ph) => ph.name);
      if (missing.length) { Modal.error({ title: '确认生效校验未通过', content: missing.join('、') + ' 阶段缺少必填核查项，请补充后重新确认。' }); return; }
      const nv = 'v' + (parseFloat((q.version || '0')) + 0.1).toFixed(1);
      store.update('Questionnaire', id, { ...q, status: 'active', version: nv.replace('v', ''), updater: store.currentRole().name });
      logChange('Questionnaire/' + id, '编辑', '确认生效，发布 ' + nv, nv);
      message.success('模板已确认生效，' + nv);
    }
    function rollback() { logChange('Questionnaire/' + id, '回滚', '版本回滚（演示）', 'v' + q.version); message.success('已记录版本回滚（演示）'); }

    const phaseGroups = PHASES.map((ph) => {
      const items = q.item.filter((it) => it.phase === ph.key).sort((a, b) => a.party === b.party ? a.order - b.order : PARTY_ROLES.indexOf(a.party) - PARTY_ROLES.indexOf(b.party));
      return { ph, items, req: items.filter((it) => it.required).length };
    });

    return (
      <div>
        <PageHeader title={'核查表模板详情 · ' + q.name}
          sub="查看完整配置内容，支持编辑、确认生效与版本维护（US-1.1 AC3）"
          extra={<Space>
            <Button icon={<Ico name="EditOutlined" />} onClick={() => navigate('/config/checklist')}>编辑</Button>
            <Button type="primary" icon={<Ico name="CheckCircleOutlined" />} disabled={q.status === 'active'} onClick={activate}>确认生效</Button>
            <Popconfirm title={'确认回滚至上一版本？回滚后当前版本将被记录为新版本，原版本内容不会丢失。'} onConfirm={rollback}><Button icon={<Ico name="RollbackOutlined" />}>版本回滚</Button></Popconfirm>
          </Space>} />
        {q.status === 'inactive' && <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="该模板已停用，不可用于核查执行。" />}
        <Row gutter={16}>
          <Col span={16}>
            <Card size="small" title="核查内容项详情" style={{ marginBottom: 16 }}>
              <Collapse defaultActiveKey={PHASES.map((p) => p.key)} items={phaseGroups.map((g) => ({
                key: g.ph.key,
                label: <span><b>{g.ph.name}</b>　<span style={{ color: '#999', fontSize: 12 }}>共 {g.items.length} 项，必填 {g.req} 项</span></span>,
                children: g.items.length === 0
                  ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无核查内容项" />
                  : <Table rowKey={(_, i) => g.ph.key + i} size="small" pagination={false} dataSource={g.items}
                      columns={[
                        { title: '序号', render: (_, __, i) => i + 1, width: 60 },
                        { title: '核查项文本', dataIndex: 'text' },
                        { title: '确认角色', dataIndex: 'party', width: 110, render: (p) => <Tag color="blue">{roleName(p)}</Tag> },
                        { title: '必填', dataIndex: 'required', width: 70, render: (r) => r ? <span style={{ color: '#ff4d4f' }}>★</span> : '' },
                        { title: '排序', dataIndex: 'order', width: 60 },
                      ]} />,
              }))} />
            </Card>
            <Card size="small" title={<span><Ico name="HistoryOutlined" /> 版本更新记录</span>}>
              {logs.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无更新记录" />
                : <Table rowKey="id" size="small" pagination={false} dataSource={logs}
                    columns={[
                      { title: '版本号', dataIndex: 'version', width: 90, render: (v) => <Tag color="geekblue">{v}</Tag> },
                      { title: '更新时间', render: (l) => fmt(l.recorded, true), width: 170 },
                      { title: '更新人', render: (l) => l.agent[0].who.display, width: 100 },
                      { title: '变更内容摘要', dataIndex: 'summary' },
                    ]} />}
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" title="模板基本信息" style={{ marginBottom: 16 }}>
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="名称">{q.name}</Descriptions.Item>
                <Descriptions.Item label="编码">{q.code}</Descriptions.Item>
                <Descriptions.Item label="版本">v{q.version}</Descriptions.Item>
                <Descriptions.Item label="状态">{statusTag(q.status)}</Descriptions.Item>
                <Descriptions.Item label="核查项总数">{q.item.length}</Descriptions.Item>
                <Descriptions.Item label="最后更新">{fmt(q.meta.lastUpdated)}</Descriptions.Item>
              </Descriptions>
            </Card>
            <Card size="small" title="关联手术类型">
              {(q.surgeryTypes || []).map((s) => <Tooltip key={s} title="点击跳转至该手术类型核查表配置"><Tag color="blue" style={{ cursor: 'pointer', marginBottom: 6 }} onClick={() => navigate('/config/checklist')}>{s}</Tag></Tooltip>)}
              {(!q.surgeryTypes || !q.surgeryTypes.length) && <span style={{ color: '#ccc' }}>未关联</span>}
            </Card>
          </Col>
        </Row>
      </div>
    );
  }

  /* ---------- L3-1-3 核查卡控规则配置 ---------- */
  function GateConfig() {
    U.useFhir();
    const data = Object.values(store.db.GateRule || {});
    const [edit, setEdit] = useState(null);
    const [form] = Form.useForm();
    function open(r) { setEdit(r); form.setFieldsValue(r); }
    function add() { const r = { id: SSAQ.genId('gate'), node: 'preAnesthesia', nodeName: '麻醉前核查', gateType: 'block', blockedProcess: '', condition: '', enabled: true, _new: true }; setEdit(r); form.setFieldsValue(r); }
    function save() {
      form.validateFields().then((v) => {
        v.nodeName = (PHASES.find((p) => p.key === v.node) || {}).name;
        if (v.gateType === 'warn') v.blockedProcess = '—';
        if (edit._new) { store.create('GateRule', { ...edit, ...v, _new: undefined }); logChange('GateRule/' + edit.id, '新增', '新增卡控规则：' + v.nodeName + ' / ' + v.condition); }
        else { store.update('GateRule', edit.id, { ...edit, ...v }); logChange('GateRule/' + edit.id, '编辑', '修改卡控规则：' + v.nodeName + ' / ' + v.condition); }
        message.success('卡控规则已保存'); setEdit(null);
      });
    }
    const columns = [
      { title: '序号', render: (_, __, i) => i + 1, width: 60 },
      { title: '卡控节点', dataIndex: 'nodeName', width: 110 },
      { title: '卡控类型', dataIndex: 'gateType', width: 110, render: (t) => t === 'block' ? <Tag color="red">强制拦截</Tag> : <Tag color="orange">警告提示</Tag> },
      { title: '阻断流程', dataIndex: 'blockedProcess', width: 130 },
      { title: '拦截条件', dataIndex: 'condition' },
      { title: '状态', dataIndex: 'enabled', width: 90, render: (e, r) => <Switch checked={e} checkedChildren="启用" unCheckedChildren="禁用" onChange={(c) => { store.update('GateRule', r.id, { ...r, enabled: c }); logChange('GateRule/' + r.id, c ? '启用' : '禁用', (c ? '启用' : '禁用') + '卡控规则：' + r.condition); }} /> },
      { title: '操作', width: 70, render: (_, r) => <a onClick={() => open(r)}>编辑</a> },
    ];
    return (
      <div>
        <PageHeader title="核查卡控规则配置" sub="维护各手术关键节点的强制卡控规则与拦截条件（US-1.5 AC1）"
          extra={<Button type="primary" icon={<Ico name="PlusOutlined" />} onClick={add}>+ 新增卡控规则</Button>} />
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="卡控节点说明"
          description={<div>· 麻醉前核查未完成 → 禁止启动麻醉记录流程<br />· 开刀前核查未完成 → 禁止启动手术后续流程<br />· 离室前核查未完成 → 禁止启动患者离室流程</div>} />
        <Card size="small"><Table rowKey="id" size="small" columns={columns} dataSource={data} pagination={false} rowClassName={(r) => r.enabled ? '' : 'row-dim'} /></Card>
        <ChangeLog targetPrefix="GateRule/" title="卡控规则变更日志" />
        <Modal title={edit && edit._new ? '新增卡控规则' : '编辑卡控规则'} open={!!edit} onOk={save} onCancel={() => setEdit(null)} destroyOnClose>
          <Form form={form} layout="vertical" onValuesChange={(c, all) => { if (c.gateType) form.setFieldsValue({}); }}>
            <Form.Item name="node" label="卡控节点" rules={[{ required: true }]}><Select options={PHASES.map((p) => ({ value: p.key, label: p.name }))} /></Form.Item>
            <Form.Item name="gateType" label="卡控类型"><Radio.Group><Radio value="block">强制拦截</Radio><Radio value="warn">警告提示</Radio></Radio.Group></Form.Item>
            <Form.Item shouldUpdate={(p, c) => p.gateType !== c.gateType} noStyle>
              {() => form.getFieldValue('gateType') === 'block' && <Form.Item name="blockedProcess" label="阻断流程（强制拦截时必填）" rules={[{ required: true }]}><Input placeholder="如 麻醉记录流程" /></Form.Item>}
            </Form.Item>
            <Form.Item name="condition" label="拦截条件" rules={[{ required: true }]}><Input placeholder="如 麻醉前核查未完成" /></Form.Item>
            <Form.Item name="enabled" label="是否启用" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="禁用" /></Form.Item>
          </Form>
        </Modal>
      </div>
    );
  }

  /* ---------- L3-1-4 核查时间规范配置 ---------- */
  function TimeConfig() {
    U.useFhir();
    const norms = Object.values(store.db.TimeNorm || {});
    const tcat = store.db.TimeoutCategory['tcat'];
    const [vals, setVals] = useState(() => { const o = {}; norms.forEach((n) => (o[n.phase] = n.threshold)); return o; });
    const [catEdit, setCatEdit] = useState(null);
    const [form] = Form.useForm();
    function saveThresholds() {
      norms.forEach((n) => { if (n.threshold !== vals[n.phase]) { store.update('TimeNorm', n.id, { ...n, threshold: vals[n.phase] }, { silent: true }); logChange('TimeNorm/' + n.id, '编辑', PHASES.find((p) => p.key === n.phase).name + '超时阈值调整为 ' + vals[n.phase] + ' 分钟'); } });
      store._notify(); message.success('时间规范已保存');
    }
    function resetThresholds() { const o = {}; norms.forEach((n) => (o[n.phase] = n.threshold)); setVals(o); }
    function openCat(c, i) { setCatEdit({ i }); form.setFieldsValue(c); }
    function addCat() { setCatEdit({ i: null }); form.resetFields(); form.setFieldsValue({ code: '', name: '', note: '' }); }
    function saveCat() {
      form.validateFields().then((v) => {
        const cats = tcat.categories.map((c) => ({ ...c }));
        if (catEdit.i != null) { cats[catEdit.i] = { ...cats[catEdit.i], ...v }; }
        else { cats.push({ code: v.code || SSAQ.genId('cat'), name: v.name, note: v.note }); }
        store.update('TimeoutCategory', tcat.id, { ...tcat, categories: cats });
        logChange('TimeNorm/tcat', catEdit.i != null ? '编辑' : '新增', (catEdit.i != null ? '修改' : '新增') + '超时分类「' + v.name + '」');
        setCatEdit(null); message.success('已保存');
      });
    }
    return (
      <div>
        <PageHeader title="核查时间规范配置" sub="维护各核查阶段超时阈值与超时分类标记规则（US-1.5 AC3）" />
        <Card size="small" title="核查阶段时间阈值配置" style={{ marginBottom: 12 }}>
          <div style={{ maxWidth: 460 }}>
            {PHASES.map((ph) => (
              <div key={ph.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{ width: 160 }}>{ph.name}超时阈值</span>
                <InputNumber min={1} value={vals[ph.key]} onChange={(v) => setVals({ ...vals, [ph.key]: v })} addonAfter="分钟" style={{ width: 140 }} />
              </div>
            ))}
            <div style={{ color: '#999', fontSize: 12, margin: '6px 0 12px' }}>说明：超时阈值指该核查阶段从发起至三方签名完成的最大允许时长。超过阈值系统自动标记违规并记录至违规日志。</div>
            <Space><Button onClick={resetThresholds}>重置</Button><Button type="primary" onClick={saveThresholds}>保存</Button></Space>
          </div>
        </Card>
        <Card size="small" title="超时违规分类标记" style={{ marginBottom: 12 }}
          extra={<Button size="small" type="primary" icon={<Ico name="PlusOutlined" />} onClick={addCat}>+ 新增分类</Button>}>
          <Table rowKey="code" size="small" pagination={false} dataSource={tcat.categories}
            columns={[
              { title: '标记分类', dataIndex: 'name', width: 140, render: (n) => <Tag color="orange">{n}</Tag> },
              { title: '说明', dataIndex: 'note' },
              { title: '操作', width: 70, render: (_, c, i) => <a onClick={() => openCat(c, i)}>编辑</a> },
            ]} />
          <Alert style={{ marginTop: 10 }} type="warning" showIcon message="超时违规记录将按以上分类归因，用于违规记录页面的分类筛选" />
        </Card>
        <ChangeLog targetPrefix="TimeNorm/" title="规范变更日志" />
        <Modal title={catEdit && catEdit.i != null ? '编辑超时分类' : '新增超时分类'} open={!!catEdit} onOk={saveCat} onCancel={() => setCatEdit(null)} destroyOnClose>
          <Form form={form} layout="vertical">
            {catEdit && catEdit.i == null && <Form.Item name="code" label="分类编码" rules={[{ required: true, message: '请输入分类编码' }]}><Input placeholder="如 equipment（英文标识，用于系统内部归因）" /></Form.Item>}
            <Form.Item name="name" label="分类名称" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="note" label="分类说明"><Input.TextArea rows={2} /></Form.Item>
          </Form>
        </Modal>
      </div>
    );
  }

  /* ---------- L3-1-5 手术风险评估标准配置 ---------- */
  function RiskConfig() {
    U.useFhir();
    const standards = Object.values(store.db.RiskStandard || {});
    const [fName, setFName] = useState();
    const [fStatus, setFStatus] = useState();
    const [kw, setKw] = useState('');
    const [edit, setEdit] = useState(null); // {stdId, idx?}
    const [form] = Form.useForm();
    // 拍平为行
    let rows = [];
    standards.forEach((st) => st.grades.forEach((g, idx) => rows.push({ stdId: st.id, stdName: st.name, idx, ...g })));
    if (fName) rows = rows.filter((r) => r.stdName === fName);
    if (fStatus) rows = rows.filter((r) => (fStatus === 'on' ? r.enabled : !r.enabled));
    if (kw) rows = rows.filter((r) => r.grade.indexOf(kw) >= 0 || (r.desc || '').indexOf(kw) >= 0 || (r.basis || '').indexOf(kw) >= 0);

    function open(stdId, idx) {
      const st = store.db.RiskStandard[stdId];
      setEdit({ stdId, idx });
      form.setFieldsValue(idx != null ? st.grades[idx] : { grade: '', desc: '', basis: '', enabled: true });
    }
    function save() {
      form.validateFields().then((v) => {
        const st = store.db.RiskStandard[edit.stdId];
        const grades = st.grades.map((g) => ({ ...g }));
        if (edit.idx != null) grades[edit.idx] = v; else grades.push(v);
        store.update('RiskStandard', st.id, { ...st, grades });
        logChange('RiskStandard/' + st.id, edit.idx != null ? '编辑' : '新增', (edit.idx != null ? '修改' : '新增') + '评估等级 ' + v.grade);
        message.success('评估标准已保存'); setEdit(null);
      });
    }
    function del(stdId, idx) {
      const st = store.db.RiskStandard[stdId];
      store.update('RiskStandard', st.id, { ...st, grades: st.grades.filter((_, i) => i !== idx) });
      logChange('RiskStandard/' + st.id, '删除', '删除一个评估等级'); message.success('已删除');
    }
    function toggle(stdId, idx, c) {
      const st = store.db.RiskStandard[stdId];
      const grades = st.grades.map((g, i) => i === idx ? { ...g, enabled: c } : g);
      store.update('RiskStandard', st.id, { ...st, grades });
    }
    const columns = [
      { title: '序号', render: (_, __, i) => i + 1, width: 60 },
      { title: '标准名称', dataIndex: 'stdName', width: 160, render: (n) => <Tag color="geekblue">{n}</Tag> },
      { title: '分级等级', dataIndex: 'grade', width: 100, render: (g) => <b>{g}</b> },
      { title: '等级描述', dataIndex: 'desc' },
      { title: '评估依据', dataIndex: 'basis' },
      { title: '状态', dataIndex: 'enabled', width: 90, render: (e, r) => <Switch checked={e} checkedChildren="启用" unCheckedChildren="停用" onChange={(c) => toggle(r.stdId, r.idx, c)} /> },
      { title: '操作', width: 110, render: (_, r) => <Space><a onClick={() => open(r.stdId, r.idx)}>编辑</a><Popconfirm title="删除？" onConfirm={() => del(r.stdId, r.idx)}><a style={{ color: '#ff4d4f' }}>删除</a></Popconfirm></Space> },
    ];
    return (
      <div>
        <PageHeader title="手术风险评估标准配置" sub="维护 ASA / NNIS 等风险评估标准，统一跨科室统计口径（US-1.6 AC2）"
          extra={<Button type="primary" icon={<Ico name="PlusOutlined" />} onClick={() => open(standards[0].id, null)}>+ 新增等级</Button>} />
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="标准适用范围说明"
          description="当前评估标准适用于全科室手术风险评估统计，统计口径以 ASA 分级为统一标准，各科室核查统计中的风险评估数据均依据本页配置的标准定义。" />
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space wrap>
            标准名称：<Select allowClear placeholder="全部" style={{ width: 180 }} value={fName} onChange={setFName} options={standards.map((s) => ({ value: s.name, label: s.name }))} />
            状态：<Select allowClear placeholder="全部" style={{ width: 110 }} value={fStatus} onChange={setFStatus} options={[{ value: 'on', label: '启用' }, { value: 'off', label: '停用' }]} />
            <Input.Search placeholder="关键字搜索（分级/描述/依据）" style={{ width: 220 }} onSearch={setKw} allowClear />
          </Space>
        </Card>
        <Card size="small">
          <Table rowKey={(r) => r.stdId + r.idx} size="small" columns={columns} dataSource={rows} pagination={{ pageSize: 10, showTotal: (t) => '共 ' + t + ' 条' }} rowClassName={(r) => r.enabled ? '' : 'row-dim'} />
        </Card>
        <ChangeLog targetPrefix="RiskStandard/" title="标准变更日志" />
        <Modal title={edit && edit.idx != null ? '编辑评估标准' : '新增评估标准'} open={!!edit} onOk={save} onCancel={() => setEdit(null)} destroyOnClose width={600}>
          <Form form={form} layout="vertical">
            <Form.Item label="标准名称">
              <Select value={edit && edit.stdId} onChange={(v) => setEdit({ ...edit, stdId: v, idx: null })} options={standards.map((s) => ({ value: s.id, label: s.name }))} />
            </Form.Item>
            <Form.Item name="grade" label="分级等级" rules={[{ required: true, message: '请输入分级等级' }]}><Input placeholder="如 ASA Ⅱ" /></Form.Item>
            <Form.Item name="desc" label="等级描述" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
            <Form.Item name="basis" label="评估依据" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="enabled" label="是否启用" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
          </Form>
        </Modal>
      </div>
    );
  }

  /* 通用变更日志组件 */
  function ChangeLog({ targetPrefix, title }) {
    const logs = Object.values(store.db.Provenance || {})
      .filter((p) => p.kind === 'config' && p.target[0].reference.indexOf(targetPrefix) === 0)
      .sort((a, b) => a.recorded < b.recorded ? 1 : -1).slice(0, 8);
    return (
      <Card size="small" title={<span><Ico name="HistoryOutlined" /> {title}</span>} style={{ marginTop: 12 }}>
        {logs.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无变更记录" />
          : <Table rowKey="id" size="small" pagination={false} dataSource={logs}
              columns={[
                { title: '操作时间', render: (l) => fmt(l.recorded, true), width: 170 },
                { title: '操作人', render: (l) => l.agent[0].who.display, width: 100 },
                { title: '操作类型', dataIndex: 'opType', width: 90, render: (t) => <Tag>{t}</Tag> },
                { title: '变更内容摘要', dataIndex: 'summary' },
              ]} />}
      </Card>
    );
  }

  Object.assign(SSAQ.pages, { ChecklistConfig, TemplateList, TemplateDetail, GateConfig, TimeConfig, RiskConfig });
})();
