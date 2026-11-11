/* L1 系统首页（按角色自适应） */
(function () {
  const SSAQ = window.SSAQ;
  const store = SSAQ.store;
  const { Card, Tag, Row, Col, List, Progress, Button, Empty, Divider } = antd;
  const U = SSAQ.ui;
  const { PageHeader, StatCard, EntryCard, navigate, Ico, LineChart, PieChart, phaseTag, fmt } = U;

  const PROBLEM_DEFS = [
    { label: '卡控拦截', match: (a) => a.type === 'block' },
    { label: '资质异常', match: (a) => a.type === 'qualification' },
    { label: '超时·人员延迟', match: (a) => a.type === 'timeout' && a.subtype === 'staff' },
    { label: '超时·术中突发', match: (a) => a.type === 'timeout' && a.subtype === 'intraop' },
    { label: '超时·系统异常', match: (a) => a.type === 'timeout' && a.subtype === 'system' },
  ];

  function compute() {
    const encs = Object.values(store.db.Encounter || {});
    const qrs = Object.values(store.db.QuestionnaireResponse || {});
    const audits = Object.values(store.db.AuditEvent || {});
    const inProgress = encs.filter((e) => e.status === 'in-progress');
    const pending = encs.filter((e) => e.status !== 'finished');
    const doneToday = qrs.filter((q) => q.status === 'completed').length;
    return { encs, inProgress, pending, doneToday, audits };
  }

  function invalidParticipants(enc) {
    return enc.participant.filter((p) => {
      const pr = store.practitionerRole(p.actor.reference.split('/')[1]);
      return pr && !pr.qualification.valid;
    });
  }

  function AdminHome() {
    const qs = Object.values(store.db.Questionnaire || {});
    const active = qs.filter((q) => q.status === 'active').length;
    const draft = qs.filter((q) => q.status === 'draft' || q.status === 'inactive').length;
    const provs = Object.values(store.db.Provenance || {}).filter((p) => p.kind === 'config')
      .sort((a, b) => (a.recorded < b.recorded ? 1 : -1));
    const gate = Object.values(store.db.GateRule || {});
    const tn = Object.values(store.db.TimeNorm || {});
    return (
      <div>
        <PageHeader title="配置工作台 · 系统管理员" sub="快速掌握核查表与规则配置全局状态，发现待维护项" />
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard title="核查表模板总数" value={qs.length} suffix="个" />
          <StatCard title="已生效模板" value={active} suffix="个" color="#52c41a" />
          <StatCard title="草稿待维护" value={draft} suffix="个" color="#faad14" />
          <StatCard title="近30天配置变更" value={provs.length} suffix="次" />
        </div>
        <Row gutter={16}>
          <Col span={14}>
            <Card title="配置状态概览" size="small" style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col span={12}>
                  <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>核查表模板 生效 / 草稿占比</div>
                  <Progress percent={Math.round((active / qs.length) * 100)} strokeColor="#52c41a" />
                </Col>
                <Col span={12}>
                  <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>规则启用情况</div>
                  <div>卡控规则：<Tag color="green">{gate.filter((g) => g.enabled).length}/{gate.length} 启用</Tag></div>
                  <div style={{ marginTop: 6 }}>时间规范：<Tag color="green">{tn.filter((t) => t.enabled).length}/{tn.length} 启用</Tag></div>
                </Col>
              </Row>
            </Card>
            <Card title="近期配置变更" size="small" extra={<a onClick={() => navigate('/config/templates')}>查看全部</a>}>
              <List size="small" dataSource={provs.slice(0, 5)}
                renderItem={(p) => (
                  <List.Item>
                    <List.Item.Meta title={p.summary} description={(p.agent[0].who.display) + ' · ' + fmt(p.recorded)} />
                    <Tag>{p.target[0].reference}</Tag>
                  </List.Item>
                )} />
            </Card>
          </Col>
          <Col span={10}>
            <Card title="快捷入口" size="small">
              <div style={{ display: 'grid', gap: 12 }}>
                <EntryCard icon="FormOutlined" title="手术安全核查表配置" desc="按手术类型差异化配置核查内容项" onClick={() => navigate('/config/checklist')} />
                <EntryCard icon="UnorderedListOutlined" title="核查表模板列表" desc="加载、复用与版本维护" onClick={() => navigate('/config/templates')} />
                <EntryCard icon="StopOutlined" title="核查卡控规则配置" desc="关键节点强制卡控规则" onClick={() => navigate('/config/gate')} />
                <EntryCard icon="ClockCircleOutlined" title="核查时间规范配置" desc="超时阈值与时间规范" onClick={() => navigate('/config/time')} />
                <EntryCard icon="SafetycertificateOutlined" title="手术风险评估标准配置" desc="ASA 分级等评估标准" onClick={() => navigate('/config/risk')} />
              </div>
            </Card>
          </Col>
        </Row>
      </div>
    );
  }

  function ClinicalHome() {
    const role = store.currentRole();
    const { inProgress, doneToday } = compute();
    // 当前角色参与且进行中的手术
    const mine = inProgress.filter((e) => e.participant.some((p) => p.role === role.code));
    const cur = mine.find((e) => e.id === store.session.selectedEncounter) || mine[0];
    const phases = store.PHASES;
    const myLeadPhase = phases.find((p) => p.lead === role.code);
    const trend = [{ label: '第1周', value: 80 }, { label: '第2周', value: 86 }, { label: '第3周', value: 92 }, { label: '第4周', value: 96 }];
    return (
      <div>
        <PageHeader title={'核查工作台 · ' + role.name} sub="立即查看当前待核查手术，重点关注您牵头的核查环节" />
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard title="今日核查完成" value={doneToday} suffix="项" color="#52c41a" />
          <StatCard title="待核查手术" value={mine.length} suffix="台" color="#faad14" />
          <StatCard title="本人累计参与" value={28} suffix="次" />
          <StatCard title="超时违规" value={0} suffix="次" color="#52c41a" />
        </div>
        <Row gutter={16}>
          <Col span={15}>
            <Card title="当前待核查手术" size="small" style={{ marginBottom: 16 }}>
              {!cur && <Empty description="暂无您参与的进行中手术" />}
              {cur && (() => {
                const pat = store.db.Patient[cur.subject.reference.split('/')[1]];
                const proc = store.db.Procedure['proc-' + cur.id];
                const surgeon = cur.participant.find((p) => p.role === 'surgeon');
                const anes = cur.participant.find((p) => p.role === 'anesthesiologist');
                const nurse = cur.participant.find((p) => p.role === 'scrubNurse');
                return (
                  <div>
                    <div className="info-grid" style={{ marginBottom: 14 }}>
                      <div><span className="k">手术间：</span><span className="v">{cur.room}</span></div>
                      <div><span className="k">科室：</span><span className="v">{cur.department}</span></div>
                      <div><span className="k">患者：</span><span className="v">{pat.name[0].text}</span></div>
                      <div><span className="k">术式：</span><span className="v">{proc.code.text}</span></div>
                      <div><span className="k">手术部位：</span><span className="v">{proc.bodySite[0].text}</span></div>
                      <div><span className="k">手术日期：</span><span className="v">{cur.surgeryDate}</span></div>
                      <div><span className="k">麻醉医生：</span><span className="v">{anes ? anes.actor.display : '—'}</span></div>
                      <div><span className="k">主刀医生：</span><span className="v">{surgeon ? surgeon.actor.display : '—'}</span></div>
                      <div><span className="k">洗手护士：</span><span className="v">{nurse ? nurse.actor.display : '—'}</span></div>
                    </div>
                    <div className="phase-steps" style={{ marginBottom: 14 }}>
                      {phases.map((ph, i) => (
                        <React.Fragment key={ph.key}>
                          <div className="ps">{phaseTag(cur.phaseStatus[ph.key])}<span>{ph.name}</span></div>
                          {i < 2 && <span className="arrow">→</span>}
                        </React.Fragment>
                      ))}
                    </div>
                    {myLeadPhase && (
                      <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
                        <Ico name="WarningOutlined" style={{ color: '#faad14' }} /> {myLeadPhase.name}为您牵头的核查环节
                      </div>
                    )}
                    <Button type="primary" onClick={() => { store.setEncounter(cur.id); navigate('/checklist/' + ({ preAnesthesia: 'pre-anesthesia', preIncision: 'pre-incision', preDeparture: 'pre-departure' }[cur.currentPhase])); }}>
                      进入{phases.find((p) => p.key === cur.currentPhase).name} →
                    </Button>
                  </div>
                );
              })()}
            </Card>
            <Card title="本人核查统计" size="small">
              <Row gutter={16} style={{ marginBottom: 8 }}>
                <Col span={8}><div style={{ color: '#888', fontSize: 13 }}>本月完成率</div><div style={{ fontSize: 20, fontWeight: 700, color: '#52c41a' }}>96.5%</div></Col>
                <Col span={8}><div style={{ color: '#888', fontSize: 13 }}>签名合规率</div><div style={{ fontSize: 20, fontWeight: 700, color: '#1677ff' }}>100%</div></Col>
                <Col span={8}><div style={{ color: '#888', fontSize: 13 }}>参与台数</div><div style={{ fontSize: 20, fontWeight: 700 }}>12 台</div></Col>
              </Row>
              <Divider style={{ margin: '8px 0' }} />
              <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>近4周核查完成率趋势</div>
              <LineChart data={trend} unit="%" height={130} />
            </Card>
          </Col>
          <Col span={9}>
            <Card title="三方核查快捷入口" size="small">
              <div style={{ display: 'grid', gap: 12 }}>
                <EntryCard icon="ExperimentOutlined" title="麻醉前核查" desc="麻醉医生牵头三方确认" onClick={() => navigate('/checklist/pre-anesthesia')} />
                <EntryCard icon="ScissorOutlined" title="开刀前核查" desc="主刀医生牵头三方确认" onClick={() => navigate('/checklist/pre-incision')} />
                <EntryCard icon="LogoutOutlined" title="离室前核查" desc="洗手护士牵头三方确认" onClick={() => navigate('/checklist/pre-departure')} />
              </div>
            </Card>
          </Col>
        </Row>
      </div>
    );
  }

  function ManagerHome() {
    const { inProgress, doneToday, pending, audits } = compute();
    const encs = Object.values(store.db.Encounter || {});
    const blocked = encs.filter((e) => Object.values(e.phaseStatus).some((s) => s === 'blocked'));
    const timeoutAudits = audits.filter((a) => a.type === 'timeout');
    const qualWarn = encs.flatMap((e) => invalidParticipants(e).map((p) => ({ enc: e, p })));
    const TIMEOUT_SUB = { staff: '人员延迟', intraop: '术中突发', system: '系统异常' };
    return (
      <div>
        <PageHeader title="监督工作台 · 手术室管理部门" sub="全局掌握当日核查执行情况与合规重点" />
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard title="今日完成核查" value={doneToday} suffix="项" color="#52c41a" />
          <StatCard title="今日待核查手术" value={pending.length} suffix="台" color="#faad14" />
          <StatCard title="卡控拦截" value={blocked.length} suffix="台" color="#ff4d4f" />
          <StatCard title="今日核查超时" value={timeoutAudits.length} suffix="次" color="#fa8c16" />
        </div>
        <Row gutter={16}>
          <Col span={16}>
            <Card title="手术室核查状态总览" size="small" extra={<a onClick={() => navigate('/monitor/board')}>进入看板</a>}>
              <List size="small" dataSource={inProgress}
                renderItem={(e) => {
                  const proc = store.db.Procedure['proc-' + e.id];
                  return (
                    <List.Item actions={[<a onClick={() => { store.setEncounter(e.id); navigate('/monitor/board'); }}>查看</a>]}>
                      <List.Item.Meta
                        title={<span>{e.room} · {store.db.Patient[e.subject.reference.split('/')[1]].name[0].text}</span>}
                        description={<span>
                          科室：{e.department}　手术名称：{proc ? proc.code.text : '—'}
                          <br />
                          {store.PHASES.map((ph) => <span key={ph.key} style={{ marginRight: 12 }}>{ph.short}: {phaseTag(e.phaseStatus[ph.key])}</span>)}
                        </span>} />
                    </List.Item>
                  );
                }} />
            </Card>
          </Col>
          <Col span={8}>
            <Card title="快捷入口" size="small">
              <div style={{ display: 'grid', gap: 12 }}>
                <EntryCard icon="DashboardOutlined" title="核查执行看板" desc="多台手术并行状态全局视图" onClick={() => navigate('/monitor/board')} />
                <EntryCard icon="AuditOutlined" title="违规记录" desc="卡控/资质/超时违规追溯" onClick={() => navigate('/monitor/violations')} />
              </div>
            </Card>
          </Col>
        </Row>
        <Card title={<span><Ico name="WarningOutlined" style={{ color: '#fa8c16' }} /> 违规预警通知</span>} size="small" style={{ marginTop: 16 }}
          extra={<a onClick={() => navigate('/monitor/violations')}>查看全部违规记录 →</a>}>
          <Row gutter={16}>
            <Col span={12}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#fa541c' }}><Ico name="SafetyCertificateOutlined" /> 资质异常</div>
              {qualWarn.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无资质异常" /> : (
                <List size="small" dataSource={qualWarn} renderItem={({ enc, p }) => {
                  const pr = store.practitionerRole(p.actor.reference.split('/')[1]);
                  return <List.Item><List.Item.Meta title={<span>{enc.room} · {p.actor.display}（{store.ROLES[p.role].name}）</span>} description={<span style={{ fontSize: 12, color: '#fa541c' }}>{pr.qualification.note}</span>} /></List.Item>;
                }} />
              )}
            </Col>
            <Col span={12}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#fa8c16' }}><Ico name="ClockCircleOutlined" /> 超时违规</div>
              {timeoutAudits.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无超时违规" /> : (
                <List size="small" dataSource={timeoutAudits} renderItem={(a) => (
                  <List.Item><List.Item.Meta title={<span>{a.room} · {a.patientName} <Tag color="gold">{TIMEOUT_SUB[a.subtype]}</Tag></span>} description={<span style={{ fontSize: 12 }}>{a.detail}</span>} /></List.Item>
                )} />
              )}
            </Col>
          </Row>
        </Card>
      </div>
    );
  }

  function QualityHome() {
    const docs = Object.values(store.db.DocumentReference || {});
    const encs = Object.values(store.db.Encounter || {});
    const audits = Object.values(store.db.AuditEvent || {});
    const totalPhases = encs.length * 3;
    const passedPhases = encs.reduce((n, e) => n + Object.values(e.phaseStatus).filter((s) => s === 'passed').length, 0);
    const completionRate = totalPhases ? Math.round((passedPhases / totalPhases) * 1000) / 10 : 0;
    const violationRate = totalPhases ? Math.round((audits.length / totalPhases) * 1000) / 10 : 0;
    const problems = PROBLEM_DEFS.map((p) => ({ label: p.label, value: audits.filter(p.match).length })).filter((p) => p.value > 0);
    const trend = Array.from({ length: 12 }, (_, i) => ({ label: 'W' + (i + 1), value: i === 11 ? completionRate : Math.max(60, Math.round((completionRate - (11 - i) * 0.6) * 10) / 10) }));
    const siteCheck = Object.values(store.db.Procedure || {}).map((p) => {
      const enc = store.db.Encounter[p.encounter.reference.split('/')[1]];
      const consistent = p.requestedBodySite === p.bodySite[0].text;
      return { room: enc ? enc.room : '—', patient: enc ? store.db.Patient[enc.subject.reference.split('/')[1]].name[0].text : '—', requested: p.requestedBodySite, checked: p.bodySite[0].text, consistent };
    });
    const mismatches = siteCheck.filter((s) => !s.consistent);
    return (
      <div>
        <PageHeader title="质量分析工作台 · 医疗质量管理部门" sub="掌握核查完成率、风险评估数据与质量报告概况" />
        <div className="stat-grid cols-3" style={{ marginBottom: 20 }}>
          <StatCard title="核查完成率" value={completionRate} suffix="%" color="#52c41a" />
          <StatCard title="违规率" value={violationRate} suffix="%" color="#faad14" />
          <StatCard title="已出具报告" value={docs.length} suffix="份" />
        </div>
        <Row gutter={16}>
          <Col span={12}>
            <Card title="核查完成率趋势（近12周）" size="small" style={{ marginBottom: 16 }}>
              <LineChart data={trend} unit="%" height={140} />
            </Card>
          </Col>
          <Col span={12}>
            <Card title="快捷入口" size="small" style={{ marginBottom: 16 }}>
              <div style={{ display: 'grid', gap: 12 }}>
                <EntryCard icon="BarChartOutlined" title="核查统计" desc="完成率、问题分布、风险评估" onClick={() => navigate('/analysis/stats')} />
                <EntryCard icon="FileTextOutlined" title="核查质量报告" desc="生成与归档质量评价报告" onClick={() => navigate('/analysis/report')} />
              </div>
            </Card>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Card title="问题类型分布" size="small" extra={<a onClick={() => navigate('/analysis/stats')}>进入核查统计 →</a>}>
              {problems.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无违规记录" /> : <PieChart data={problems} unit="次" />}
            </Card>
          </Col>
          <Col span={12}>
            <Card title="手术部位核对情况" size="small" extra={<a onClick={() => navigate('/analysis/stats')}>查看全部 →</a>}>
              <Row gutter={16} style={{ marginBottom: 10 }}>
                <Col span={8}><div style={{ color: '#888', fontSize: 13 }}>本期核对</div><div style={{ fontSize: 20, fontWeight: 700 }}>{siteCheck.length}</div></Col>
                <Col span={8}><div style={{ color: '#888', fontSize: 13 }}>一致</div><div style={{ fontSize: 20, fontWeight: 700, color: '#52c41a' }}>{siteCheck.length - mismatches.length}</div></Col>
                <Col span={8}><div style={{ color: '#888', fontSize: 13 }}>不一致</div><div style={{ fontSize: 20, fontWeight: 700, color: '#ff4d4f' }}>{mismatches.length}</div></Col>
              </Row>
              {mismatches.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无部位核对不一致记录" /> : (
                <List size="small" dataSource={mismatches} renderItem={(m) => (
                  <List.Item>
                    <List.Item.Meta title={<span>{m.room} · {m.patient}</span>} description={<span style={{ color: '#ff4d4f', fontSize: 12 }}>申请：{m.requested} → 核查确认：{m.checked}</span>} />
                    <Tag color="error">不一致</Tag>
                  </List.Item>
                )} />
              )}
            </Card>
          </Col>
        </Row>
      </div>
    );
  }

  function Home() {
    U.useFhir();
    const code = store.currentRole().code;
    if (code === 'admin') return <AdminHome />;
    if (code === 'orManager') return <ManagerHome />;
    if (code === 'qualityManager') return <QualityHome />;
    return <ClinicalHome />;
  }

  SSAQ.pages = SSAQ.pages || {};
  SSAQ.pages.Home = Home;
})();
