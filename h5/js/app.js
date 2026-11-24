/* 应用外壳：路由、导航、状态读写与页面生命周期 */
(function (global) {
  const domain = BIZ.domain;
  const perm = BIZ.perm;
  const Views = (global.Views = global.Views || {});

  const NAV = {
    home: { label: '首页', icon: 'home', hash: '/home' },
    catalog: { label: '采购下单', icon: 'cart', hash: '/catalog' },
    orders: { label: '我的订单', icon: 'orders', hash: '/orders' },
    approve: { label: '待办审批', icon: 'check', hash: '/approvals' },
    supplier: { label: '供应商工作台', icon: 'truck', hash: '/supplier' },
    accept: { label: '收货验收', icon: 'camera', hash: '/accept' },
    reports: { label: '统计看板', icon: 'chart', hash: '/reports' },
    recon: { label: '统一对账', icon: 'bill', hash: '/reports?tab=recon' },
    drafts: { label: '草稿箱', icon: 'box', hash: '/drafts' },
    budget: { label: '预算设置', icon: 'bill', hash: '/budget' },
    console: { label: '中台操作台', icon: 'shop', hash: '/console' },
    guide: { label: '采购说明', icon: 'box', hash: '/guide' },
    settle: { label: '结算确认', icon: 'bill', hash: '/settle' },
    me: { label: '我的', icon: 'user', hash: '/profile' }
  };

  const TAB_OF = {
    home: 'home', catalog: 'catalog', checkout: 'catalog',
    orders: 'orders', order: 'orders', settle: 'orders',
    approvals: 'approve', supplier: 'supplier',
    accept: 'accept', drafts: 'drafts',
    reports: 'reports', profile: 'me', guide: 'me', login: '', budget: 'budget', console: 'console'
  };

  const state = { me: null, route: null };

  function titleOf(r) {
    if (r.name === 'order') return '订单详情';
    if (r.name === 'checkout') return '确认订单';
    if (r.name === 'accept') return r.params[0] ? '批次验收' : '收货验收';
    if (r.name === 'reports' && r.query.tab === 'recon') return '统一对账';
    if (r.name === 'budget') return '门店费用预算';
    if (r.name === 'console') return '中台操作台';
    if (r.name === 'guide') return '采购流程说明';
    if (r.name === 'settle') return '结算金额确认';
    const key = TAB_OF[r.name];
    return NAV[key] ? NAV[key].label : APP_CONFIG.short;
  }

  function route() {
    const raw = (location.hash || '').replace(/^#/, '') || '/home';
    const parts = raw.split('?');
    const seg = parts[0].split('/').filter(Boolean);
    const query = {};
    new URLSearchParams(parts[1] || '').forEach(function (v, k) { query[k] = v; });
    return { name: seg[0] || 'home', params: seg.slice(1), query: query, hash: raw };
  }

  function go(hash, replace) {
    const target = '#' + (hash.charAt(0) === '/' ? hash : '/' + hash);
    if (location.hash === target) { render(); return; }
    if (replace) location.replace(target);
    else location.hash = target;
  }

  /* ---------------- 导航 ---------------- */
  function badgeCounts(me, st) {
    const counts = {};
    if (!me) return counts;
    // actionCount 已包含「战区审核 / 金额审批 / 结算共同确认」待办，与首页待办同源
    if (me.role === 'central' || me.role === 'region') {
      counts.approve = domain.actionCount(st, me);
    }
    if (me.role === 'supplier') {
      counts.supplier = domain.actionCount(st, me);
    }
    if (me.role === 'store' || me.role === 'department') {
      counts.accept = domain.actionCount(st, me);
    }
    return counts;
  }

  function renderChrome() {
    const me = Session.current();
    const st = Store.loadState();
    const counts = badgeCounts(me, st);

    const tabKeys = perm.tabs(me).map(function (t) { return t.key; });
    const extra = [];
    if (me.role === 'store' || me.role === 'department') {
      if (tabKeys.indexOf('accept') < 0) extra.push('accept');
    }
    if (me.role === 'central') { extra.push('console'); extra.push('recon'); extra.push('budget'); }
    const sideKeys = tabKeys.concat(extra);

    document.getElementById('side-nav').innerHTML = sideKeys.map(function (key) {
      const n = NAV[key];
      if (!n) return '';
      const b = counts[key] || 0;
      return '<a href="#' + n.hash + '" data-nav="' + key + '">' +
        UI.icon(n.icon) + '<span>' + n.label + '</span>' +
        (b ? '<span class="n">' + (b > 99 ? '99+' : b) + '</span>' : '') + '</a>';
    }).join('');

    document.getElementById('tabbar').innerHTML = tabKeys.map(function (key) {
      const n = NAV[key];
      if (!n) return '';
      const b = counts[key] || 0;
      return '<a href="#' + n.hash + '" data-nav="' + key + '">' + UI.icon(n.icon) +
        '<span>' + n.label + '</span>' +
        (b ? '<span class="dot' + (b > 1 ? ' num' : '') + '">' + (b > 9 ? '9+' : b) + '</span>' : '') + '</a>';
    }).join('');

    const sideUser = document.getElementById('side-user');
    if (me) {
      sideUser.innerHTML = '<span class="av">' + UI.esc(Session.avatarOf(me)) + '</span>' +
        '<span class="col grow"><span class="nm ellipsis">' + UI.esc(me.name) + '</span>' +
        '<span class="rl ellipsis">' + UI.esc(perm.roleMeta(me.role).label) + '</span></span>';
    } else {
      sideUser.innerHTML = '<span class="av">?</span><span class="col"><span class="nm">未登录</span></span>';
    }

    renderTopIdentityPill(me);
  }

  function idPillLabel(me) {
    if (!me) return '未登录';
    if (me.role === 'store') {
      const stName = (me.stores && me.stores[0]) ? me.stores[0] : '';
      return stName ? (stName + ' · ' + me.name.replace('测试', '')) : me.name;
    }
    if (me.role === 'region') return (me.zone || '战区') + ' · 负责人';
    if (me.role === 'central') return '运营管理部 · 中台';
    if (me.role === 'department') return me.department || me.name;
    if (me.role === 'supplier') return String(me.supplier || '').replace(/[（(].*[)）]/g, '');
    return me.name;
  }

  function openQuickIdentitySheet() {
    if (Session.isExternal()) { go('/profile'); return; }
    const groups = Session.grouped();
    const cur = Session.current();
    const body = '<div class="tiny muted mb8">切换当前测试账号，立即在当前页面以对应权限视角查看（正式企业微信环境按通讯录免登）。</div>' +
      groups.map(function (g) {
        if (!g.items.length) return '';
        return '<div class="login-group" style="margin-top:10px">' +
          '<h3>' + UI.esc(g.title) + '<span>' + UI.esc(g.note) + '</span></h3>' +
          g.items.map(function (p) {
            const on = cur && cur.id === p.id;
            return '<button class="id-card" type="button" data-quick-id="' + UI.esc(p.id) + '" style="' + (on ? 'border-color:var(--brand-2);background:#f3f8fe' : '') + '">' +
              '<span class="av">' + UI.esc(Session.avatarOf(p)) + '</span>' +
              '<span class="col grow"><span class="nm">' + UI.esc(p.name) + (on ? ' <span class="pill good">当前</span>' : '') + '</span>' +
              '<span class="ds">' + UI.esc(p.desc || p.zone || '') + '</span></span>' +
              UI.icon('right') + '</button>';
          }).join('') +
        '</div>';
      }).join('');
    UI.sheet({
      title: '切换体验身份',
      sub: '门店店长 · 战区负责人 · 运营管理部 · 职能部门 · 供应商',
      body: body,
      mount: function (bodyEl, close) {
        bodyEl.addEventListener('click', function (e) {
          const btn = e.target.closest('[data-quick-id]');
          if (!btn) return;
          try {
            const p = Session.switchTo(btn.dataset.quickId);
            close();
            UI.toast('已切换为 ' + p.name, 'good', 1400);
            render();
          } catch (err) { UI.toast(err.message, 'error'); }
        });
      }
    });
  }

  function renderTopIdentityPill(me) {
    const host = document.getElementById('topbar-act');
    if (!host) return;
    const old = host.querySelector('#top-id-pill');
    if (old) old.remove();
    if (!me) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'top-id-pill';
    btn.className = 'id-pill role-' + (me.role || 'store');
    btn.title = Session.isExternal() ? '查看当前账号详情' : '点击快速切换测试角色';
    btn.innerHTML = '<span class="dot"></span><span class="txt">' + UI.esc(idPillLabel(me)) + '</span>' +
      (!Session.isExternal() ? UI.icon('switch', 'xs') : '');
    btn.onclick = function () {
      if (Session.isExternal()) go('/profile');
      else openQuickIdentitySheet();
    };
    host.appendChild(btn);
  }

  function markNav(name) {
    const active = TAB_OF[name] || '';
    document.querySelectorAll('[data-nav]').forEach(function (el) {
      el.classList.toggle('on', el.dataset.nav === active);
    });
  }

  /* ---------------- 路由渲染 ---------------- */
  let lastHash = '';

  function render(opts) {
    opts = opts || {};
    const r = route();
    const me = Session.current();

    if (!me || r.name === 'login') {
      document.body.dataset.page = r.name === 'login' ? 'login' : 'guest';
      const view = document.getElementById('view');
      view.className = 'view';
      view.innerHTML = '';
      document.getElementById('topbar-title').textContent = '登录';
      document.getElementById('btn-back').classList.remove('on');
      document.getElementById('topbar-act').innerHTML = '';
      if (Views.login) Views.login(view, r, {});
      markNav('login');
      return;
    }

    const view = Views[r.name];
    if (!view) { go('/home', true); return; }

    state.me = me;
    state.route = r;
    document.body.dataset.page = r.name;

    // 每次渲染换一个全新的 #view 节点：避免页面在 root 上绑定的委托事件随着往返累积
    const old = document.getElementById('view');
    const container = old.cloneNode(false);
    container.className = 'view' + (r.name === 'catalog' ? ' wide flush' : '');
    old.parentNode.replaceChild(container, old);
    document.getElementById('topbar-title').textContent = titleOf(r);
    document.getElementById('topbar-act').innerHTML = '';

    const isTabRoot = ['home', 'catalog', 'orders', 'approvals', 'supplier', 'accept', 'reports', 'profile', 'drafts'].indexOf(r.name) >= 0;
    const back = document.getElementById('btn-back');
    back.classList.toggle('on', !isTabRoot);
    back.onclick = function () {
      if (history.length > 1) history.back();
      else go('/home');
    };

    try {
      view(container, r, { me: me, state: Store.loadState(), go: go, app: api });
    } catch (err) {
      console.error(err);
      container.innerHTML = '<div class="card card-pad"><div class="strong">页面渲染失败</div><div class="small muted mt8">' + UI.esc(err.message) + '</div></div>';
    }

    markNav(r.name);
    renderChrome();

    if (!opts.keepScroll && r.hash !== lastHash) window.scrollTo(0, 0);
    lastHash = r.hash;
  }

  /* ---------------- 业务动作 ---------------- */
  function mutate(fn) {
    const st = Store.loadState();
    const me = Session.current();
    const result = fn(st, me);
    Store.saveState(st);
    if (result) {
      if (result.audit) Store.appendAudit([result.audit]);
      if (result.audits) Store.appendAudit(result.audits);
    }
    renderChrome();
    return result;
  }

  function title(text) {
    document.getElementById('topbar-title').textContent = text;
  }

  function topAction(html, onMount) {
    const host = document.getElementById('topbar-act');
    host.innerHTML = html;
    if (onMount) onMount(host);
  }

  const api = {
    go: go,
    render: function (opts) { render(opts); },
    reload: function () { render({ keepScroll: true }); },
    mutate: mutate,
    title: title,
    topAction: topAction,
    me: function () { return Session.current(); },
    state: function () { return Store.loadState(); },
    route: function () { return state.route || route(); }
  };

  global.App = api;
  global.Views = Views;
  global.NAV = NAV;

  /* ---------------- 启动 ---------------- */
  function boot() {
    const logoEl = document.getElementById('side-logo-img');
    if (logoEl && global.UI) logoEl.src = UI.logoSrc();
    Session.bootstrap().then(function () {
      // 演示便利：?as=TEST-CENTRAL 可直接以指定身份进入（正式环境不会用到）
      const as = new URLSearchParams(location.search).get('as');
      if (as && !Session.isExternal()) {
        try { Session.switchTo(as); } catch (e) { /* ignore */ }
      }
      const hasIdentity = !!localStorage.getItem(Store.KEYS.identity);
      if (!location.hash) {
        location.hash = hasIdentity || Session.isExternal() ? '#/home' : '#/login';
      }
      renderChrome();
      render();
      window.addEventListener('hashchange', function () { render(); });
      window.addEventListener('error', function (e) {
        if (e && e.message) console.error('[h5]', e.message);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
