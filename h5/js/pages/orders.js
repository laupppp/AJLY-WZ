/* 订单列表：按状态分组筛选 + 搜索 */
(function (Views) {
  const GROUPS = [
    { key: 'all', label: '全部', test: function () { return true; } },
    { key: 'todo', label: '待处理', test: function (s) { return ['order-review', 'budget-region', 'budget-central', 'amount-approval', 'dept-approval', 'supplier', 'preparing'].indexOf(s) >= 0; } },
    { key: 'ship', label: '配送中', test: function (s) { return ['delivering', 'delivered', 'partial'].indexOf(s) >= 0; } },
    { key: 'settle', label: '结算中', test: function (s) { return ['settle-pending', 'settle-supplier', 'settle-disputed'].indexOf(s) >= 0; } },
    { key: 'accept', label: '待对账', test: function (s) { return s === 'accepted'; } },
    { key: 'done', label: '已完成', test: function (s) { return s === 'done'; } },
    { key: 'closed', label: '已关闭', test: function (s) { return ['rejected', 'cancelled'].indexOf(s) >= 0; } }
  ];

  Views.orders = function (root, r, ctx) {
    const domain = BIZ.domain;
    const me = ctx.me;
    const state = ctx.state;
    const orders = domain.visibleOrders(state, me);

    let filter = r.query.tab && GROUPS.some(function (g) { return g.key === r.query.tab; }) ? r.query.tab : 'all';
    let keyword = '';

    const slaRows = domain.slaEntries(state);
    const slaByOrder = {};
    slaRows.forEach(function (x) {
      if (me.role === 'supplier' && x.owner !== me.supplier) return;
      const cur = slaByOrder[x.orderId];
      if (!cur || (cur.level !== 'overdue' && x.level === 'overdue')) slaByOrder[x.orderId] = x;
    });

    function matches(o, g) {
      if (!GROUPS.filter(function (x) { return x.key === g; })[0].test(o.status)) return false;
      if (!keyword) return true;
      const kw = keyword.toLowerCase();
      const hay = [o.id, o.store, o.manager, o.department, o.supplier, (o.items || []).map(function (x) { return x.name; }).join(' ')]
        .join(' ').toLowerCase();
      return hay.indexOf(kw) >= 0;
    }

    function counts() {
      const map = {};
      GROUPS.forEach(function (g) {
        map[g.key] = orders.filter(function (o) { return matches(o, g.key); }).length;
      });
      return map;
    }

    function card(o) {
      // 结算/待对账阶段以订单状态为准：供应商分项此时已 accepted，
      // 若仍显示「已完成」会误导供应商不去确认结算金额；这些阶段也不该报审批/接单超时
      const inSettle = me.role === 'supplier' &&
        ['settle-pending', 'settle-supplier', 'settle-disputed', 'accepted'].indexOf(o.status) >= 0;
      const sla = inSettle ? null : slaByOrder[o.id];
      const myRec = inSettle ? null : (me.role === 'supplier' ? (o.supplierRecords || {})[me.supplier] : null);
      const itemNames = (o.items || []).slice(0, 3).map(function (x) { return x.name + '×' + x.qty; }).join('、');
      const more = (o.items || []).length > 3 ? ' 等 ' + o.items.length + ' 项' : '';
      const statusHtml = myRec
        ? UI.supplierPill(myRec.status)
        : UI.statusPill(o.status);
      return '<a class="order-card" href="#/order/' + UI.esc(o.id) + '">' +
        '<div class="order-top"><span class="order-id">' + UI.esc(o.id) + '</span>' + statusHtml +
          (sla ? '<span class="sla ' + (sla.level === 'overdue' ? 'bad' : 'warn') + '" style="margin-left:auto">' + UI.icon('clock', 'xs') + BIZ.fmt.hoursText(sla.hours) + (sla.level === 'overdue' ? '超时' : '') + '</span>' : '') +
        '</div>' +
        '<div class="order-meta">' + UI.esc(o.purchaseType === 'department' ? ('部门采购 · ' + (o.department || '')) : o.store) +
          ' · ' + UI.esc(BIZ.fmt.shortTime(o.createdAt || o.created)) + '</div>' +
        '<div class="order-items">' + UI.esc(itemNames + more) + '</div>' +
        '<div class="order-foot">' +
          '<span class="pill line">' + UI.esc(BIZ.fmt.TIER_LABEL[o.tier] || '') + '</span>' +
          '<span class="tiny muted">' + (o.items || []).length + ' 种商品</span>' +
          '<span class="order-amt" style="margin-left:auto">¥' + UI.money(o.total) + '<small>' + (o.store || '') + '</small></span>' +
        '</div>' +
      '</a>';
    }

    function renderList() {
      const list = orders.filter(function (o) { return matches(o, filter); })
        .sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
      const c = counts();

      root.querySelector('#chips').innerHTML = GROUPS.map(function (g) {
        return '<button class="chip' + (filter === g.key ? ' on' : '') + '" data-f="' + g.key + '">' +
          g.label + (c[g.key] ? '<span class="n">' + c[g.key] + '</span>' : '') + '</button>';
      }).join('');

      const host = root.querySelector('#order-list');
      if (!list.length) {
        host.innerHTML = UI.empty('📋', keyword ? '没有匹配的订单' : '该分类暂无订单', keyword ? '换个关键词试试' : '');
      } else {
        host.innerHTML = list.map(card).join('');
      }
      root.querySelector('#list-count').textContent = '共 ' + list.length + ' 笔';
    }

    root.innerHTML =
      '<div class="between" style="margin-bottom:8px">' +
        '<div class="search" style="margin:0;flex:1;max-width:420px">' +
          UI.icon('search') +
          '<input id="q" type="search" placeholder="搜索订单号 / 门店 / 商品" autocomplete="off">' +
        '</div>' +
        '<span class="tiny muted nowrap" id="list-count"></span>' +
      '</div>' +
      '<div class="chips" id="chips"></div>' +
      '<div id="order-list"></div>';

    root.querySelector('#chips').addEventListener('click', function (e) {
      const chip = e.target.closest('[data-f]');
      if (!chip) return;
      filter = chip.dataset.f;
      renderList();
      window.scrollTo({ top: 0 });
    });

    root.querySelector('#q').addEventListener('input', UI.debounce(function (e) {
      keyword = e.target.value.trim();
      renderList();
    }, 160));

    renderList();
  };
})(window.Views);
