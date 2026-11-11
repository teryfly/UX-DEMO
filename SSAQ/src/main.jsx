/* 入口：路由分发并挂载应用 */
(function () {
  const SSAQ = window.SSAQ;
  const { AppShell } = SSAQ.ui;
  const P = SSAQ.pages;

  function renderPage(path, params, def, routeKey) {
    const map = {
      '/home': () => <P.Home />,
      '/config/checklist': () => <P.ChecklistConfig />,
      '/config/templates': () => <P.TemplateList />,
      '/config/templates/:id': () => <P.TemplateDetail id={params.id} />,
      '/config/gate': () => <P.GateConfig />,
      '/config/time': () => <P.TimeConfig />,
      '/config/risk': () => <P.RiskConfig />,
      '/checklist/pre-anesthesia': () => <P.PhaseCheck phase="preAnesthesia" />,
      '/checklist/pre-incision': () => <P.PhaseCheck phase="preIncision" />,
      '/checklist/pre-departure': () => <P.PhaseCheck phase="preDeparture" />,
      '/monitor/board': () => <P.Board />,
      '/monitor/record/:encId/:phase': () => <P.MonitorRecord encId={params.encId} phase={params.phase} />,
      '/monitor/violations': () => <P.Violations />,
      '/analysis/stats': () => <P.Stats />,
      '/analysis/report': () => <P.Report />,
    };
    const fn = map[routeKey || path] || map['/home'];
    return fn();
  }

  function App() {
    return <AppShell renderPage={renderPage} />;
  }

  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<App />);
})();
