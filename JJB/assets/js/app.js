/* ============================================================
 * app.js — 应用引导
 * ============================================================ */
(function () {
  const App = {};

  App.toggleConsole = () => {
    U.$('#fhir-console').classList.toggle('collapsed');
  };

  // 全局：重置演示数据
  App.resetDemo = async () => {
    const ok = await U.confirm({
      title: '重置演示数据', danger: true, okText: '重置',
      content: '将清空当前所有改动，恢复为初始 FHIR 基础数据。常用于重新给客户演示。确认重置？',
    });
    if (!ok) return;
    FHIR.reset();
    Router.render();
  };

  function boot() {
    FHIR.init();
    FHIR.renderConsole();
    // 数据变化时若当前页订阅了刷新，由各页面自行处理；这里仅刷新顶栏角标
    FHIR.subscribe(() => {
      // 顶栏未读角标随通知变化（轻量刷新）
      const bell = U.$('#topbar .bell');
      if (bell) {
        const unread = FHIR.search('Communication', c => c._handleStatus === '未处理', null, { silent: true }).length;
        bell.innerHTML = `🔔${unread ? `<span class="badge">${unread}</span>` : ''}`;
      }
    });
    if (!location.hash || location.hash === '#/') location.hash = '#/home';
    Router.render();
  }

  window.App = App;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
