/* =====================================================================
 * pages/forbidden.js —— 403 无权限页（IX-1.4：无页面权限 → 403 + 返回首页）
 * ===================================================================== */
(function (global) {
  'use strict';
  var App = global.App, D = global.Domain;

  global.AMS.pages['forbidden'] = {
    computed: {
      target: function () { return App.state.params && App.state.params.route; },
      name: function () { return this.target ? (D.pageName(this.target) || this.target) : '未知页面'; },
      role: function () { return D.sceneName(App.scene()); },
      modules: function () { return D.visibleModules(App.navRole()).map(function (m) { return m.name; }).join('、'); }
    },
    methods: {
      home: function () { App.navigate('home'); },
      switchTo: function (id) { App.switchUser(id); App.navigate('home'); }
    },
    template: `
      <div class="card"><div class="forbidden">
        <div class="code">403</div>
        <h2>无权限访问</h2>
        <p class="muted">当前登录身份（{{ role }}）无权访问「{{ name }}」。{{ target ? '该页面在导航中对本角色不可见。' : '' }}</p>
        <p class="muted small">本角色可访问模块：{{ modules }}</p>
        <div class="btn-row center mt16">
          <button class="btn primary" @click="home">返回首页</button>
          <button class="btn" @click="switchTo('u-quality')">切换为医务部管理员查看</button>
        </div>
      </div></div>`
  };
})(window);
