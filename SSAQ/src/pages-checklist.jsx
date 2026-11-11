/* L2-2 / L3-2-x 三方核查模块（核心业务流程） */
(function () {
  const SSAQ = window.SSAQ;
  const store = SSAQ.store;
  const { useState, useEffect } = React;
  const {
    Card, Tag, Button, Modal, Checkbox, Select, Space, Alert, Progress, message,
    Descriptions, Steps, Result, Divider, Row, Col, Empty, Tooltip,
  } = antd;
  const U = SSAQ.ui;
  const { PageHeader, navigate, Ico, phaseTag, fmt } = U;
  const PHASES = store.PHASES;
  const PARTY_ROLES = store.PARTY_ROLES;
  const ORDER = ['preAnesthesia', 'preIncision', 'preDeparture'];
  const SLUG = { preAnesthesia: 'pre-anesthesia', preIncision: 'pre-incision', preDeparture: 'pre-departure' };
  const roleName = (c) => store.ROLES[c].name;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function mySurgeries(roleCode) {
    return Object.values(store.db.Encounter || {})
      .filter((e) => e.participant.some((p) => p.role === roleCode));
  }
  function patientOf(enc) { return store.db.Patient[enc.subject.reference.split('/')[1]]; }
  function procOf(enc) { return store.db.Procedure['proc-' + enc.id]; }

  function ensureQR(enc, phaseKey) {
    const id = 'qr-' + enc.id + '-' + phaseKey;
    let qr = (store.db.QuestionnaireResponse || {})[id];
    if (qr) return qr;
    const q = store.db.Questionnaire[enc.questionnaire];
    const parties = {};
    PARTY_ROLES.forEach((role) => {
      const its = q.item.filter((it) => it.phase === phaseKey && it.party === role).sort((a, b) => a.order - b.order);
      const actor = enc.participant.find((p) => p.role === role).actor;
      parties[role] = { role, actorRef: actor.reference, actorName: actor.display, items: its.map((it) => ({ text: it.text, required: it.required, confirmed: false })), signed: false, qualificationValid: null, signedAt: null, provenance: null };
    });
    qr = { id, status: 'in-progress', questionnaire: 'Questionnaire/' + q.id, encounter: { reference: 'Encounter/' + enc.id }, subject: enc.subject, phase: phaseKey, authored: SSAQ.nowIso(), completedAt: null, durationMinutes: null, parties };
    // 静默创建（不触发 setState-during-render），首屏即可拿到核查单
    return store.create('QuestionnaireResponse', qr, { silent: true });
  }

  function createAudit(enc, type, phaseKey, detail, subtype, agentName) {
    store.create('AuditEvent', {
      type, subtype: subtype || null, recorded: SSAQ.nowIso(), outcome: '4',
      room: enc.room, department: enc.department, encounter: enc.id,
      patientName: patientOf(enc).name[0].text, agentName: agentName || '系统', phase: phaseKey, detail,
    });
  }

  /* ---------- L3-2-x 单阶段核查 ---------- */
  function PhaseCheck({ phase }) {
    U.useFhir();
    const role = store.currentRole();
    const phaseDef = PHASES.find((p) => p.key === phase);
    const list = mySurgeries(role.code);
    const cur = list.find((e) => e.id === store.session.selectedEncounter) || list[0];
    const [signModal, setSignModal] = useState(null); // role
    const [simTimeout, setSimTimeout] = useState(false);

    // 顺序卡控：前一阶段是否通过
    const idx = ORDER.indexOf(phase);
    const prevPhase = idx > 0 ? ORDER[idx - 1] : null;
    const blockedByPrev = cur && prevPhase && cur.phaseStatus[prevPhase] !== 'passed';

    if (!cur) return <div><PageHeader title={phaseDef.name} /><Empty description="当前角色暂无参与的手术" /></div>;

    const pat = patientOf(cur), proc = procOf(cur);
    // 首屏同步保证核查单存在（未被前置卡控拦截时）
    const qr = (store.db.QuestionnaireResponse || {})['qr-' + cur.id + '-' + phase] || (!blockedByPrev ? ensureQR(cur, phase) : null);

    // 卡控拦截视图
    if (blockedByPrev) {
      const prevName = PHASES.find((p) => p.key === prevPhase).name;
      return (
        <div>
          <PageHeader title={phaseDef.name} sub={phaseDef.lead && roleName(phaseDef.lead) + '牵头 · 三方核查'} extra={surgerySelector(list, cur)} />
          {breadcrumbInfo(cur, pat, proc)}
          <Alert type="error" showIcon style={{ marginTop: 12 }}
            message={<b>卡控拦截：{prevName}未完成</b>}
            description={<span>根据卡控规则，{prevName}三方核查通过前，禁止启动{phaseDef.name}及其后续「{phaseDef.blocks}」。请先完成{prevName}。</span>}
            action={<Space direction="vertical">
              <Button size="small" type="primary" onClick={() => navigate('/checklist/' + SLUG[prevPhase])}>前往{prevName}</Button>
              <Button size="small" danger onClick={() => { createAudit(cur, 'block', phase, '在' + prevName + '未完成时尝试启动' + phaseDef.name + '，已强制拦截', null, role.name); message.warning('操作被卡控拦截，已记录违规日志'); }}>尝试强制启动（演示拦截）</Button>
            </Space>} />
        </div>
      );
    }

    if (!qr) return <div><PageHeader title={phaseDef.name} />正在初始化核查…</div>;

    // 牵头角色优先排序
    const partyOrder = [phaseDef.lead].concat(PARTY_ROLES.filter((r) => r !== phaseDef.lead));
    const allSigned = PARTY_ROLES.every((r) => qr.parties[r].signed);
    const confirmedCount = PARTY_ROLES.reduce((n, r) => n + qr.parties[r].items.filter((it) => it.confirmed).length, 0);
    const totalCount = PARTY_ROLES.reduce((n, r) => n + qr.parties[r].items.length, 0);
    const signedCount = PARTY_ROLES.filter((r) => qr.parties[r].signed).length;

    function toggleItem(prole, i) {
      if (prole !== role.code) { message.info('您只能确认本人（' + roleName(role.code) + '）的核查项'); return; }
      if (qr.parties[prole].signed) return;
      const next = clone(qr);
      next.parties[prole].items[i].confirmed = !next.parties[prole].items[i].confirmed;
      store.update('QuestionnaireResponse', qr.id, next);
    }

    function doSign(prole) {
      const pr = store.practitionerForRole(cur.id, prole);
      const prole2 = store.practitionerRole(pr.id);
      const party = qr.parties[prole];
      if (!party.items.every((it) => !it.required || it.confirmed)) { message.warning('请先逐项确认全部必填核查项'); return; }
      // 资质校验（US AC5）
      if (!prole2.qualification.valid) {
        const next = clone(qr); next.parties[prole].qualificationValid = false; store.update('QuestionnaireResponse', qr.id, next);
        createAudit(cur, 'qualification', phase, '签名人「' + party.actorName + '」执业资质校验未通过（' + prole2.qualification.note + '），拒绝签名', null, party.actorName);
        Modal.error({ title: '资质校验未通过', content: prole2.qualification.note + '。根据规则，资质不符者拒绝通过本环节，请协调具备资质人员。' });
        setSignModal(null);
        return;
      }
      // CA 电子签名 → Provenance
      const prov = store.create('Provenance', {
        target: [{ reference: 'QuestionnaireResponse/' + qr.id }], recorded: SSAQ.nowIso(),
        activity: { text: 'CA 电子签名' }, kind: 'signature',
        agent: [{ who: { display: party.actorName }, role: prole }],
        signature: { type: 'CA', when: SSAQ.nowIso(), who: party.actorName, qualification: prole2.qualification.licenseNo },
      }, { silent: true });

      const next = clone(qr);
      next.parties[prole].items.forEach((it) => (it.confirmed = true));
      next.parties[prole].signed = true;
      next.parties[prole].qualificationValid = true;
      next.parties[prole].signedAt = SSAQ.nowIso();
      next.parties[prole].provenance = 'Provenance/' + prov.id;

      const nowAll = PARTY_ROLES.every((r) => next.parties[r].signed);
      if (nowAll) {
        next.status = 'completed';
        next.completedAt = SSAQ.nowIso();
        next.durationMinutes = simTimeout ? phaseDef.key === 'preAnesthesia' ? 11 : 9 : 4;
        // 时间合规校验（US AC6）
        const tn = store.db.TimeNorm['tn-' + phase];
        if (simTimeout && tn && next.durationMinutes > tn.threshold) {
          next.timedOut = true;
          createAudit(cur, 'timeout', phase, phaseDef.name + '耗时' + next.durationMinutes + '分钟，超过' + tn.threshold + '分钟阈值', 'staff', party.actorName);
        }
        // 放行 → 更新手术阶段，解锁后续流程
        const encNext = clone(cur);
        encNext.phaseStatus[phase] = 'passed';
        if (idx < 2) {
          const nx = ORDER[idx + 1];
          if (encNext.phaseStatus[nx] === 'notStarted') encNext.phaseStatus[nx] = 'inProgress';
          encNext.currentPhase = nx;
        } else {
          encNext.status = 'finished';
        }
        store.update('Encounter', cur.id, encNext);
      }
      store.update('QuestionnaireResponse', qr.id, next);
      setSignModal(null);
      if (nowAll) {
        Modal.success({ title: phaseDef.name + '三方核查通过', content: '三方均完成确认与签名，已解锁「' + phaseDef.blocks + '」。' + (idx < 2 ? '可继续进行' + PHASES.find((p) => p.key === ORDER[idx + 1]).name + '。' : '本台手术核查全部完成。') });
      } else {
        message.success(roleName(prole) + ' 签名完成');
      }
    }

    return (
      <div>
        <PageHeader title={phaseDef.name} sub={roleName(phaseDef.lead) + '牵头 · 三方逐项确认 → 签名 → 资质校验 → 放行（US-1.' + (idx + 2) + '）'} extra={surgerySelector(list, cur)} />
        {breadcrumbInfo(cur, pat, proc)}

        {/* 进度条 */}
        <Card size="small" style={{ marginBottom: 12 }}>
          <Steps size="small" current={idx} items={PHASES.map((ph) => ({ title: ph.name, status: cur.phaseStatus[ph.key] === 'passed' ? 'finish' : ph.key === phase ? 'process' : 'wait' }))} />
        </Card>

        {/* 核查完成进度指示 */}
        <Card size="small" style={{ marginBottom: 12 }}>
          <Row gutter={16} align="middle">
            <Col span={10}><div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>逐项确认进度（{confirmedCount}/{totalCount}）</div><Progress percent={Math.round((confirmedCount / totalCount) * 100)} /></Col>
            <Col span={8}><div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>三方签名（{signedCount}/3）</div>
              <Space>{PARTY_ROLES.map((r) => <Tag key={r} color={qr.parties[r].signed ? 'success' : 'default'} icon={<Ico name={qr.parties[r].signed ? 'CheckCircleOutlined' : 'ClockCircleOutlined'} />}>{roleName(r)}</Tag>)}</Space>
            </Col>
            <Col span={6} style={{ textAlign: 'right' }}>
              <Tooltip title="开启后，本阶段完成时将模拟超过时间阈值并记录超时违规">
                <Checkbox checked={simTimeout} onChange={(e) => setSimTimeout(e.target.checked)}>模拟核查超时（演示）</Checkbox>
              </Tooltip>
            </Col>
          </Row>
        </Card>

        {/* 三方确认区 */}
        <div className="party-grid">
          {partyOrder.map((prole) => {
            const party = qr.parties[prole];
            const isMe = prole === role.code;
            const allItemConfirmed = party.items.every((it) => !it.required || it.confirmed);
            return (
              <div className={'party-card' + (isMe ? ' me' : '') + (party.signed ? ' done' : '')} key={prole}>
                <div className="party-head">
                  <span className="party-name">{roleName(prole)}：{party.actorName} {prole === phaseDef.lead && <Tag color="gold">牵头</Tag>} {isMe && <Tag color="blue">本人</Tag>}</span>
                  {party.signed ? <Tag color="success" icon={<Ico name="CheckCircleFilled" />}>已确认</Tag>
                    : party.qualificationValid === false ? <Tag color="error">资质异常</Tag>
                      : <Tag>未确认</Tag>}
                </div>
                {party.items.map((it, i) => (
                  <div className="check-item" key={i}>
                    <Checkbox checked={it.confirmed} disabled={!isMe || party.signed} onChange={() => toggleItem(prole, i)}>
                      <span className="txt">{i + 1}. {it.text}</span>
                    </Checkbox>
                  </div>
                ))}
                <div style={{ marginTop: 10 }}>
                  {party.signed ? (
                    <div style={{ fontSize: 12, color: '#52c41a' }}>
                      <Ico name="SafetyCertificateOutlined" /> 资质有效 · 签名于 {fmt(party.signedAt, true)}
                    </div>
                  ) : isMe ? (
                    <Button type="primary" block icon={<Ico name="EditOutlined" />} disabled={!allItemConfirmed} onClick={() => setSignModal(prole)}>
                      {allItemConfirmed ? '逐项确认并签名' : '请先勾选全部核查项'}
                    </Button>
                  ) : (
                    <div style={{ fontSize: 12, color: '#aaa', textAlign: 'center' }}>等待 {party.actorName} 本人确认（可切换角色演示）</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 离室前：换班人员签名提示 */}
        {phase === 'preDeparture' && (
          <Alert style={{ marginTop: 12 }} type="warning" showIcon message="换班人员签名提示"
            description="若签名人员与核查发起人员不一致（如已换班），签名人需具备同等执业资质，资质继承规则：以实际签名人当时的资质有效性为准进行校验。" />
        )}

        {/* 核查结论区 */}
        <Card size="small" title="核查结论" style={{ marginTop: 12 }}>
          <Descriptions size="small" column={3}>
            {PARTY_ROLES.map((r) => <Descriptions.Item key={r} label={roleName(r)}>{qr.parties[r].signed ? <Tag color="success">已确认</Tag> : qr.parties[r].qualificationValid === false ? <Tag color="error">资质异常</Tag> : <Tag>未确认</Tag>}</Descriptions.Item>)}
          </Descriptions>
          <Divider style={{ margin: '10px 0' }} />
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>核查结论：{allSigned ? <Tag color="success" icon={<Ico name="CheckCircleFilled" />}>三方核查通过，已放行「{phaseDef.blocks}」</Tag> : <Tag color="processing">待三方全部确认后自动判定</Tag>}</div>
            <div>超时状态：{qr.timedOut ? <Tag color="error" icon={<Ico name="WarningFilled" />}>已超时违规（{qr.durationMinutes}分钟）</Tag> : allSigned ? <Tag color="success">耗时 {qr.durationMinutes} 分钟，符合规范</Tag> : <span style={{ color: '#999' }}>—（核查进行中）</span>}</div>
            {!allSigned && <Alert type="info" showIcon message={phaseDef.name + '未完成，「' + phaseDef.blocks + '」不可启动（强制卡控）'} />}
            <div style={{ fontSize: 12, color: '#aaa' }}>核查发起：{fmt(qr.authored, true)}{qr.completedAt && ' · 完成：' + fmt(qr.completedAt, true)}</div>
          </Space>
        </Card>

        {/* 签名弹窗 */}
        <Modal title="CA 电子签名确认" open={!!signModal} footer={null} onCancel={() => setSignModal(null)} destroyOnClose>
          {signModal && (() => {
            const pr = store.practitionerForRole(cur.id, signModal);
            const prole2 = store.practitionerRole(pr.id);
            const valid = prole2.qualification.valid;
            return (
              <div>
                <Descriptions size="small" column={1} bordered>
                  <Descriptions.Item label="签名人">{qr.parties[signModal].actorName}（{roleName(signModal)}）</Descriptions.Item>
                  <Descriptions.Item label="执业证号">{prole2.qualification.licenseNo}</Descriptions.Item>
                  <Descriptions.Item label="资质状态">{valid ? <Tag color="success" icon={<Ico name="SafetyCertificateOutlined" />}>有效（至 {prole2.qualification.validUntil}）</Tag> : <Tag color="error" icon={<Ico name="CloseCircleOutlined" />}>无效 · {prole2.qualification.note}</Tag>}</Descriptions.Item>
                  <Descriptions.Item label="签名时间">{fmt(SSAQ.nowIso(), true)}</Descriptions.Item>
                </Descriptions>
                {!valid && <Alert style={{ marginTop: 12 }} type="error" showIcon message="资质校验将不通过，签名会被拒绝并记录异常日志。可切换为资质有效的角色/人员演示通过流程。" />}
                <div style={{ textAlign: 'right', marginTop: 16 }}>
                  <Space>
                    <Button onClick={() => setSignModal(null)}>取消</Button>
                    <Button type="primary" icon={<Ico name="EditOutlined" />} onClick={() => doSign(signModal)}>确认签名并提交</Button>
                  </Space>
                </div>
              </div>
            );
          })()}
        </Modal>
      </div>
    );
  }

  function surgerySelector(list, cur) {
    if (list.length <= 1) return null;
    return <Select value={cur && cur.id} style={{ width: 280 }} onChange={(v) => store.setEncounter(v)}
      options={list.map((e) => ({ value: e.id, label: e.room + ' · ' + patientOf(e).name[0].text + ' · ' + procOf(e).code.text }))} />;
  }

  function breadcrumbInfo(enc, pat, proc) {
    const surgeon = enc.participant.find((p) => p.role === 'surgeon');
    const anes = enc.participant.find((p) => p.role === 'anesthesiologist');
    const nurse = enc.participant.find((p) => p.role === 'scrubNurse');
    return (
      <div className="info-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <b><Ico name="ProfileOutlined" /> 手术信息（自动从电子病历系统带入）</b>
          <Tag color="blue">EMR 自动带入 · 无需重复录入</Tag>
        </div>
        <div className="info-grid">
          <div><span className="k">手术间：</span><span className="v">{enc.room}</span></div>
          <div><span className="k">科室：</span><span className="v">{enc.department}</span></div>
          <div><span className="k">手术日期：</span><span className="v">{enc.surgeryDate}</span></div>
          <div><span className="k">患者：</span><span className="v">{pat.name[0].text}</span></div>
          <div><span className="k">性别：</span><span className="v">{pat.gender === 'male' ? '男' : '女'}</span></div>
          <div><span className="k">年龄：</span><span className="v">{pat.age}岁</span></div>
          <div><span className="k">住院号：</span><span className="v">{pat.identifier[0].value}</span></div>
          <div><span className="k">床号：</span><span className="v">{pat.bed}</span></div>
          <div><span className="k">拟行术式：</span><span className="v">{proc.code.text}</span></div>
          <div><span className="k">手术部位：</span><span className="v">{proc.bodySite[0].text}</span></div>
          <div><span className="k">主刀医生：</span><span className="v">{surgeon ? surgeon.actor.display : '—'}</span></div>
          <div><span className="k">麻醉医生：</span><span className="v">{anes ? anes.actor.display : '—'}</span></div>
          <div><span className="k">洗手护士：</span><span className="v">{nurse ? nurse.actor.display : '—'}</span></div>
        </div>
      </div>
    );
  }

  Object.assign(SSAQ.pages, { PhaseCheck });
})();
