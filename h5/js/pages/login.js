/* 登录 / 身份选择 */
(function (Views) {
  Views.login = function (root) {
    const groups = Session.grouped();
    const wecom = Session.wecomState();
    const external = Session.isExternal();

    const wecomBlock = wecom.state === 'on'
      ? '<div class="wecom-card">' + UI.icon('check') + '<div><b>企业微信身份已识别</b>' + UI.esc(wecom.text) + '，将按组织架构自动确定角色与数据范围。</div></div>'
      : '<div class="wecom-card">' + UI.icon('shop') + '<div><b>这是本机演示环境</b>当前未接入企业微信，请选择一个身份体验对应角色。正式版在企业微信工作台打开时会免登，身份与门店/部门由通讯录决定。</div></div>';

    root.innerHTML =
      '<div class="login">' +
        '<div class="login-hero">' +
          '<div class="login-logo">安</div>' +
          '<h1>' + UI.esc(APP_CONFIG.brand) + '</h1>' +
          '<p>门店采购 · 分级审批 · 供应商履约 · 验收对账</p>' +
        '</div>' +
        wecomBlock +
        (external
          ? '<div class="login-group"><button class="btn primary block" id="btn-enter" style="margin-top:16px">进入系统</button></div>'
          : groups.map(function (g) {
              if (!g.items.length) return '';
              return '<div class="login-group">' +
                '<h3>' + UI.esc(g.title) + '<span>' + UI.esc(g.note) + '</span></h3>' +
                g.items.map(function (p) {
                  return '<button class="id-card" data-id="' + UI.esc(p.id) + '">' +
                    '<span class="av">' + UI.esc(Session.avatarOf(p)) + '</span>' +
                    '<span class="col grow"><span class="nm">' + UI.esc(p.name) + '</span>' +
                    '<span class="ds">' + UI.esc(p.desc || p.zone || '') + '</span></span>' +
                    UI.icon('right') + '</button>';
                }).join('') +
              '</div>';
            }).join('')) +
        '<div class="login-alt">演示数据均为虚构 · 数据保存在本机浏览器</div>' +
      '</div>';

    root.querySelectorAll('[data-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        try {
          const p = Session.switchTo(el.dataset.id);
          UI.toast('已切换为 ' + p.name, 'good', 1400);
          App.go('/home');
        } catch (e) {
          UI.toast(e.message, 'error');
        }
      });
    });

    const enter = root.querySelector('#btn-enter');
    if (enter) enter.onclick = function () { App.go('/home'); };
  };
})(window.Views);
