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
    guide: { label: '采购说明', icon: 'box', hash: '/guide' },
    settle: { label: '结算确认', icon: 'bill', hash: '/settle' },
    me: { label: '我的', icon: 'user', hash: '/profile' }
  };

  const TAB_OF = {
    home: 'home', catalog: 'catalog', checkout: 'catalog',
    orders: 'orders', order: 'orders', settle: 'orders',
    approvals: 'approve', supplier: 'supplier',
    accept: 'accept', drafts: 'drafts',
    reports: 'reports', profile: 'me', guide: 'me', login: '', budget: 'reports'
  };

  const state = { me: null, route: null };

  function titleOf(r) {
    if (r.name === 'order') return '订单详情';
    if (r.name === 'checkout') return '确认订单';
    if (r.name === 'accept') return r.params[0] ? '批次验收' : '收货验收';
    if (r.name === 'reports' && r.query.tab === 'recon') return '统一对账';
    if (r.name === 'budget') return '门店费用预算';
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
    if (me.role === 'central') { extra.push('recon'); extra.push('budget'); }
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
