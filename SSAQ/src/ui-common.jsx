/* 共享 UI：应用骨架、路由、角色切换、FHIR 控制台、通用组件 */
(function () {
  const SSAQ = window.SSAQ;
  const { useState, useEffect, useMemo } = React;
  const store = SSAQ.store;
  const {
    Layout, Menu, Dropdown, Button, Drawer, Badge, Tag, Avatar, Tooltip, Empty,
    Breadcrumb, Space, message, Modal, ConfigProvider, Card, Statistic,
  } = antd;
  const I = window.icons;

  /* ---------- 路由表 ---------- */
  const ROUTES = {
    '/home': { module: 'home', title: '系统首页', level: 1 },
    '/config/checklist': { module: 'config', title: '手术安全核查表配置', level: 3 },
    '/config/templates': { module: 'config', title: '核查表模板列表', level: 3 },
    '/config/templates/:id': { module: 'config', title: '核查表模板详情', level: 4, parent: '/config/templates', parentTitle: '核查表模板列表' },
    '/config/gate': { module: 'config', title: '核查卡控规则配置', level: 3 },
    '/config/time': { module: 'config', title: '核查时间规范配置', level: 3 },
    '/config/risk': { module: 'config', title: '手术风险评估标准配置', level: 3 },
    '/checklist/pre-anesthesia': { module: 'checklist', title: '麻醉前核查', level: 3 },
    '/checklist/pre-incision': { module: 'checklist', title: '开刀前核查', level: 3 },
    '/checklist/pre-departure': { module: 'checklist', title: '离室前核查', level: 3 },
    '/monitor/board': { module: 'monitor', title: '核查执行看板', level: 3 },
    '/monitor/record/:encId/:phase': { module: 'monitor', title: '核查记录', level: 4, parent: '/monitor/board', parentTitle: '核查执行看板' },
    '/monitor/violations': { module: 'monitor', title: '违规记录', level: 3 },
    '/analysis/stats': { module: 'analysis', title: '核查统计', level: 3 },
    '/analysis/report': { module: 'analysis', title: '核查质量报告', level: 3 },
  };

  const MODULES = [
    { key: 'config', name: '核查表配置', icon: 'SettingOutlined', home: '/config/checklist', roles: ['admin'] },
    { key: 'checklist', name: '三方核查', icon: 'ScheduleOutlined', home: '/checklist/pre-anesthesia', roles: ['anesthesiologist', 'surgeon', 'scrubNurse'] },
    { key: 'monitor', name: '核查监督', icon: 'DashboardOutlined', home: '/monitor/board', roles: ['orManager'] },
    { key: 'analysis', name: '核查分析', icon: 'BarChartOutlined', home: '/analysis/stats', roles: ['qualityManager'] },
  ];
  // 顶部一级导航展示项：固定「首页」入口 + 各功能模块（首页对所有角色可见）
  const NAV_ITEMS = [{ key: 'home', name: '首页', icon: 'HomeOutlined', home: '/home' }].concat(MODULES);

  const SECONDARY = {
    config: [
      { path: '/config/checklist', title: '手术安全核查表配置' },
      { path: '/config/templates', title: '核查表模板列表' },
      { path: '/config/gate', title: '核查卡控规则配置' },
      { path: '/config/time', title: '核查时间规范配置' },
      { path: '/config/risk', title: '手术风险评估标准配置' },
    ],
    checklist: [
      { path: '/checklist/pre-anesthesia', title: '麻醉前核查' },
      { path: '/checklist/pre-incision', title: '开刀前核查' },
      { path: '/checklist/pre-departure', title: '离室前核查' },
    ],
    monitor: [
      { path: '/monitor/board', title: '核查执行看板' },
      { path: '/monitor/violations', title: '违规记录' },
    ],
    analysis: [
      { path: '/analysis/stats', title: '核查统计' },
      { path: '/analysis/report', title: '核查质量报告' },
    ],
  };

  /* ---------- Hooks ---------- */
  function useFhir() {
    const [, setTick] = useState(0);
    useEffect(() => store.subscribe(() => setTick((t) => t + 1)), []);
    return store;
  }
  function useHash() {
    const get = () => window.location.hash.replace(/^#/, '') || '/home';
    const [hash, setHash] = useState(get());
    useEffect(() => {
      const fn = () => setHash(get());
      window.addEventListener('hashchange', fn);
      return () => window.removeEventListener('hashchange', fn);
    }, []);
    return hash;
  }
  function navigate(path) {
    window.location.hash = path;
  }
  function matchRoute(hash) {
    if (ROUTES[hash]) return { def: ROUTES[hash], path: hash, params: {}, routeKey: hash };
    // 动态路由 /config/templates/:id
    const parts = hash.split('/');
    if (parts[1] === 'config' && parts[2] === 'templates' && parts[3]) {
      return { def: ROUTES['/config/templates/:id'], path: hash, params: { id: parts[3] }, routeKey: '/config/templates/:id' };
    }
    // 动态路由 /monitor/record/:encId/:phase（监督视角核查记录只读查看）
    if (parts[1] === 'monitor' && parts[2] === 'record' && parts[3] && parts[4]) {
      return { def: ROUTES['/monitor/record/:encId/:phase'], path: hash, params: { encId: parts[3], phase: parts[4] }, routeKey: '/monitor/record/:encId/:phase' };
    }
    return { def: ROUTES['/home'], path: '/home', params: {}, routeKey: '/home' };
  }

  /* ---------- 通用展示组件 ---------- */
  function Ico({ name, ...rest }) {
    const C = I[name];
    return C ? <C {...rest} /> : null;
  }

  function PageHeader({ title, sub, extra }) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
        <div>
          <div className="page-title">{title}</div>
          {sub && <div className="page-sub">{sub}</div>}
        </div>
        {extra && <div>{extra}</div>}
      </div>
    );
  }

  function EntryCard({ icon, title, desc, onClick }) {
    return (
      <div className="entry-card" onClick={onClick}>
        <div className="ico"><Ico name={icon} /></div>
        <div>
          <div className="ec-title">{title}</div>
          <div className="ec-desc">{desc}</div>
        </div>
      </div>
    );
  }

  function StatCard({ title, value, suffix, color, hint }) {
    return (
      <Card size="small" bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
        <Statistic title={title} value={value} suffix={suffix} valueStyle={{ color: color || '#1677ff', fontSize: 26 }} />
        {hint && <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{hint}</div>}
      </Card>
    );
  }

  // 迷你柱状图
  function MiniBar({ data, unit, color }) {
    const max = Math.max(1, ...data.map((d) => d.value));
    return (
      <div className="minibar">
        {data.map((d, i) => (
          <div className="bar-wrap" key={i}>
            <div className="bar-val">{d.value}{unit || ''}</div>
            <div className="bar" style={{ height: (d.value / max) * 90 + '%', background: color }} />
            <div className="bar-label">{d.label}</div>
          </div>
        ))}
      </div>
    );
  }

  // 趋势折线图
  function LineChart({ data, height = 160, color = '#1677ff', unit = '' }) {
    const w = 560, pad = 28;
    const max = Math.max(...data.map((d) => d.value)), min = Math.min(...data.map((d) => d.value));
    const span = Math.max(1, max - min);
    const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, data.length - 1);
    const y = (v) => pad + (1 - (v - min) / span) * (height - pad * 2);
    const pts = data.map((d, i) => x(i) + ',' + y(d.value)).join(' ');
    return (
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} className="line-chart">
        {[0, 0.5, 1].map((g, i) => <line key={i} x1={pad} x2={w - pad} y1={pad + g * (height - pad * 2)} y2={pad + g * (height - pad * 2)} stroke="#f0f0f0" />)}
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(d.value)} r="3" fill={color} />
            {(data.length <= 8 || i % 2 === 0) && <text x={x(i)} y={height - 8} fontSize="10" fill="#999" textAnchor="middle">{d.label}</text>}
          </g>
        ))}
        <text x={x(data.length - 1)} y={y(data[data.length - 1].value) - 8} fontSize="11" fill={color} textAnchor="end">{data[data.length - 1].value}{unit}</text>
      </svg>
    );
  }

  // 饼图（占比统计）
  function PieChart({ data, size = 140, colors, unit = '' }) {
    const palette = colors || ['#1677ff', '#52c41a', '#faad14', '#ff7a45', '#722ed1', '#13c2c2', '#eb2f96', '#8c8c8c'];
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const r = size / 2 - 4, cx = size / 2, cy = size / 2;
    let angle = -90;
    const toXY = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
    const paths = data.map((d, i) => {
      const frac = d.value / total;
      const a0 = angle; angle += frac * 360; const a1 = angle;
      const large = a1 - a0 > 180 ? 1 : 0;
      const [x0, y0] = toXY(a0), [x1, y1] = toXY(a1);
      if (frac <= 0) return null;
      if (frac >= 0.9999) return <circle key={i} cx={cx} cy={cy} r={r} fill={palette[i % palette.length]} />;
      return <path key={i} d={`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`} fill={palette[i % palette.length]} stroke="#fff" strokeWidth="1" />;
    });
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>{paths}</svg>
        <div style={{ display: 'grid', gap: 6 }}>
          {data.map((d, i) => (
            <div key={i} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: palette[i % palette.length], display: 'inline-block', flex: 'none' }} />
              <span>{d.label}　{d.value}{unit}（{Math.round((d.value / total) * 1000) / 10}%）</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 横向条形图
  function HBar({ data, unit, color }) {
    const max = Math.max(1, ...data.map((d) => d.value));
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 72, fontSize: 12, color: '#666', textAlign: 'right', flex: 'none' }}>{d.label}</div>
            <div style={{ flex: 1, background: '#f5f5f5', borderRadius: 4, height: 16, position: 'relative' }}>
              <div style={{ width: (d.value / max) * 100 + '%', background: color || '#69b1ff', height: '100%', borderRadius: 4 }} />
            </div>
            <div style={{ width: 54, fontSize: 12, color: '#333', flex: 'none' }}>{d.value}{unit || ''}</div>
          </div>
        ))}
      </div>
    );
  }

  // 环形进度
  function Donut({ percent, label, color, size = 110 }) {
    const r = (size - 16) / 2;
    const c = 2 * Math.PI * r;
    const off = c * (1 - percent / 100);
    return (
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f0f0f0" strokeWidth="12" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color || '#1677ff'} strokeWidth="12"
            strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: color || '#1677ff' }}>{percent}%</div>
          <div style={{ fontSize: 12, color: '#888' }}>{label}</div>
        </div>
      </div>
    );
  }

  // 阶段状态标签
  function phaseTag(status) {
    const map = {
      passed: { color: 'success', text: '已完成', icon: 'CheckCircleFilled' },
      inProgress: { color: 'processing', text: '核查中', icon: 'SyncOutlined' },
      blocked: { color: 'error', text: '卡控拦截', icon: 'StopFilled' },
      notStarted: { color: 'default', text: '未开始', icon: 'MinusCircleOutlined' },
    };
    const m = map[status] || map.notStarted;
    return <Tag color={m.color} icon={<Ico name={m.icon} />}>{m.text}</Tag>;
  }

  function fmt(iso, withSec) {
    if (!iso) return '—';
    return dayjs(iso).format(withSec ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD HH:mm');
  }

  /* ---------- FHIR 控制台 ---------- */
  function FhirConsole({ open, onClose }) {
    const [, setTick] = useState(0);
    useEffect(() => store.subscribeLog(() => setTick((t) => t + 1)), []);
    const logs = store.log;
    const counts = store.db ? Object.keys(store.db).map((t) => ({ t, n: Object.keys(store.db[t]).length })) : [];
    return (
      <Drawer title={<span><Ico name="ApiOutlined" /> FHIR 接口请求日志（仿真）</span>} placement="right" width={460} open={open} onClose={onClose}
        extra={<Button size="small" onClick={() => { store.log = []; setTick((t) => t + 1); }}>清空</Button>}>
        <div style={{ marginBottom: 12, fontSize: 12, color: '#888' }}>
          所有页面操作均以 FHIR R4 RESTful 风格读写浏览器内缓存。下方实时展示模拟的 HTTP 请求。
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>当前缓存资源量</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {counts.map((c) => <Tag key={c.t}>{c.t}: {c.n}</Tag>)}
          </div>
        </div>
        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>请求流水（最近 {logs.length} 条）</div>
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, maxHeight: '60vh', overflow: 'auto' }}>
          {logs.length === 0 && <Empty description="暂无请求" style={{ padding: 24 }} />}
          {logs.map((l) => (
            <div className="fhir-log-item" key={l.id}>
              <span className={'fhir-method m-' + l.method}>{l.method}</span>
              <span className="fhir-url">{l.url}</span>
              <span className="fhir-status">{l.status}</span>
            </div>
          ))}
        </div>
      </Drawer>
    );
  }

  /* ---------- 应用骨架 ---------- */
  function AppShell({ renderPage }) {
    useFhir();
    const hash = useHash();
    const { def, path, params, routeKey } = matchRoute(hash);
    const role = store.currentRole();
    const accessibleModules = store.ROLE_MODULES[role.code];
    const [consoleOpen, setConsoleOpen] = useState(false);

    // 角色无权访问当前模块 → 跳回该角色首页
    useEffect(() => {
      const mod = def.module;
      if (mod !== 'home' && accessibleModules.indexOf(mod) < 0) {
        const m = MODULES.find((x) => x.roles.indexOf(role.code) >= 0);
        navigate(m ? m.home : '/home');
      }
    }, [hash, role.code]);

    const activeModule = def.module;
    const secondary = SECONDARY[activeModule];

    // 面包屑
    const crumbs = [{ title: '手术安全核查制度闭环管理' }];
    if (activeModule !== 'home') {
      const mod = MODULES.find((m) => m.key === activeModule);
      crumbs.push({ title: mod ? mod.name : '' });
      if (def.level >= 4 && def.parentTitle) crumbs.push({ title: def.parentTitle });
      if (def.level >= 3) crumbs.push({ title: def.title });
    }

    const roleMenu = {
      items: Object.values(store.ROLES).map((r) => ({
        key: r.code,
        label: (
          <div style={{ minWidth: 220 }}>
            <div style={{ fontWeight: r.code === role.code ? 700 : 500 }}>
              {r.name} {r.code === role.code && <Tag color="blue" style={{ marginLeft: 6 }}>当前</Tag>}
            </div>
            <div style={{ fontSize: 12, color: '#999' }}>{r.desc}</div>
          </div>
        ),
      })),
      onClick: ({ key }) => switchRole(key),
    };

    function switchRole(code) {
      store.setRole(code);
      const m = MODULES.find((x) => x.roles.indexOf(code) >= 0);
      navigate(m ? m.home : '/home');
      message.success('已切换为「' + store.ROLES[code].name + '」视角');
    }

    return (
      <ConfigProvider theme={{ token: { colorPrimary: '#1677ff', borderRadius: 8 } }}>
        {/* 顶部导航 */}
        <div className="ssaq-header">
          <div className="ssaq-logo">
            <span className="dot" /> 手术安全核查制度闭环管理
          </div>
          <div className="ssaq-nav">
            {NAV_ITEMS.map((m) => {
              const isHome = m.key === 'home';
              const enabled = isHome || accessibleModules.indexOf(m.key) >= 0;
              const active = isHome ? activeModule === 'home' : activeModule === m.key;
              return (
                <div key={m.key}
                  className={'nav-item' + (active ? ' active' : '') + (enabled ? '' : ' disabled')}
                  onClick={() => enabled ? navigate(m.home) : message.warning('当前角色「' + role.name + '」无权访问「' + m.name + '」')}>
                  <Ico name={m.icon} /> {m.name}
                </div>
              );
            })}
          </div>
          <div className="ssaq-header-right">
            <Tooltip title="FHIR 接口请求日志">
              <Button type="text" style={{ color: '#fff' }} icon={<Ico name="ApiOutlined" />} onClick={() => setConsoleOpen(true)}>FHIR 控制台</Button>
            </Tooltip>
            <Badge count={2} size="small"><Ico name="BellOutlined" style={{ color: '#fff', fontSize: 18 }} /></Badge>
            <Dropdown menu={roleMenu} trigger={['click']}>
              <span style={{ cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Avatar size={28} style={{ background: '#fff', color: '#1677ff' }}>{role.name[0]}</Avatar>
                {role.name} <Ico name="CaretDownOutlined" />
              </span>
            </Dropdown>
          </div>
        </div>

        {/* 演示用角色切换条 */}
        <div className="role-switch-bar">
          <span className="label"><Ico name="UserSwitchOutlined" /> 演示角色切换：</span>
          {Object.values(store.ROLES).map((r) => (
            <div key={r.code} className={'role-chip' + (r.code === role.code ? ' active' : '')} onClick={() => switchRole(r.code)}>
              {r.name}
            </div>
          ))}
          <span style={{ marginLeft: 'auto', color: '#999' }}>
            <Button size="small" type="link" danger onClick={() => Modal.confirm({ title: '重置演示数据？', content: '将清空全部更改并恢复初始仿真数据。', onOk: () => { store.reset(); navigate('/home'); message.success('已重置'); } })}>重置演示数据</Button>
          </span>
        </div>

        {/* 主体 */}
        <div className="ssaq-body">
          {activeModule === 'config' && secondary && (
            <div className="ssaq-sider">
              <Menu mode="inline" selectedKeys={[path]} style={{ borderInlineEnd: 'none' }}
                onClick={({ key }) => navigate(key)}
                items={secondary.map((s) => ({ key: s.path, label: s.title }))} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {activeModule !== 'config' && secondary && (
              <div className="ssaq-tabs">
                {secondary.map((s) => (
                  <div key={s.path} className={'tab' + (path === s.path ? ' active' : '')} onClick={() => navigate(s.path)}>{s.title}</div>
                ))}
              </div>
            )}
            <div className="ssaq-content">
              {def.level >= 2 && <Breadcrumb style={{ marginBottom: 12 }} items={crumbs} />}
              {renderPage(path, params, def, routeKey)}
            </div>
          </div>
        </div>

        <div className="ssaq-footer">© 2026 手术安全核查制度闭环管理系统 · 仿真演示（FHIR 数据模拟）　[帮助]　[隐私政策]</div>
        <FhirConsole open={consoleOpen} onClose={() => setConsoleOpen(false)} />
      </ConfigProvider>
    );
  }

  /* ---------- 导出 ---------- */
  SSAQ.ui = {
    useFhir, useHash, navigate, matchRoute, ROUTES, MODULES, NAV_ITEMS, SECONDARY,
    Ico, PageHeader, EntryCard, StatCard, MiniBar, LineChart, PieChart, HBar, Donut, phaseTag, fmt, AppShell, FhirConsole,
  };
})();
