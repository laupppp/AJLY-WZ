/* 首页：身份概览、待办、预算、快捷入口 */
(function (Views) {
  const ENTRY_HASH = {
    order: '/catalog', orders: '/orders', accept: '/accept', drafts: '/drafts',
    approve: '/approvals', recon: '/reports?tab=recon', reports: '/reports', supply: '/supplier'
  };
  const TONE = { blue: 'blue', navy: 'navy', teal: 'teal', amber: 'amber', violet: 'violet', gray: 'gray' };

  function greeting() {
    const h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 9) return '早上好';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  function dateText() {
    const d = new Date();
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + week;
  }

  function isActive(o) {
    return ['done', 'cancelled', 'rejected'].indexOf(o.status) < 0;
  }

  Views.home = function (root, r, ctx) {
    const domain = BIZ.domain;
    const perm = BIZ.perm;
    const me = ctx.me;
    const st = ctx.state;
    const orders = domain.visibleOrders(st, me);
    const active = orders.filter(isActive);
    const approvals = domain.pendingApprovals(st, me);
    const accepts = domain.pendingAcceptOrders(st, me);
    const budgets = domain.budgetSummary(st, me);
    const report = domain.reportSummary(st);

    const visibleIds = orders.map(function (o) { return o.id; });
    let sla = domain.slaEntries(st).filter(function (x) { return visibleIds.indexOf(x.orderId) >= 0; });
    if (me.role === 'supplier') sla = sla.filter(function (x) { return x.owner === me.supplier; });
    const overdue = sla.filter(function (x) { return x.level === 'overdue'; }).length;
    const warning = sla.filter(function (x) { return x.level === 'warning'; }).length;

    const totalAmount = orders.filter(function (o) { return ['cancelled', 'rejected'].indexOf(o.status) < 0; })
      .reduce(function (s, o) { return s + Number(o.total || 0); }, 0);

    // 统计卡：按角色换口径
    let stats = [];
    if (me.role === 'store' || me.role === 'department') {
      const mine = me.role === 'store'
        ? budgets.reduce(function (s, b) { return s + b.available; }, 0)
        : null;
      stats = [
        { k: '待我处理', v: domain.actionCount(st, me), d: '验收 / 结算' },
        { k: '在途订单', v: active.length, d: '未完成' },
        { k: '累计采购', v: '¥' + UI.money(totalAmount), d: '含审批中' },
        { k: me.role === 'store' ? '可用预算' : '部门采购', v: me.role === 'store' ? '¥' + UI.money(mine) : orders.length + ' 单', d: me.role === 'store' ? '含在途占用' : '全部批次' }
      ];
    } else if (me.role === 'region') {
      stats = [
        { k: '待我审批', v: approvals.length, d: '预算 / 金额' },
        { k: '战区在途', v: active.length, d: '未完成订单' },
        { k: '战区采购额', v: '¥' + UI.money(totalAmount), d: '含审批中' },
        { k: '超时预警', v: overdue, d: warning ? warning + ' 单临近超时' : '暂无临近' }
      ];
    } else if (me.role === 'central') {
      stats = [
        { k: '待我处理', v: approvals.length, d: '核定 / 确认' },
        { k: '在途订单', v: active.length, d: '全公司' },
        { k: '采购总额', v: '¥' + UI.money(report.totals.requested), d: '有效订单' },
        { k: '待对账金额', v: '¥' + UI.money(report.totals.unreconciledAccepted), d: '已验收未对账' }
      ];
    } else {
      const mineOrders = orders.filter(function (o) {
        const rec = (o.supplierRecords || {})[me.supplier];
        return rec && rec.status === 'pending' && ['cancelled', 'rejected'].indexOf(o.status) < 0;
      });
      const toShip = orders.filter(function (o) {
        const rec = (o.supplierRecords || {})[me.supplier];
        return rec && rec.status === 'confirmed';
      });
      const shipping = orders.filter(function (o) {
        const rec = (o.supplierRecords || {})[me.supplier];
        return rec && rec.status === 'shipping';
      });
      const myAmount = orders.reduce(function (sum, o) {
        return sum + o.items.filter(function (x) { return x.supplier === me.supplier; })
          .reduce(function (s, x) { return s + Number(x.price || 0) * Number(x.qty || 0); }, 0);
      }, 0);
      stats = [
        { k: '待接单', v: mineOrders.length, d: '请及时确认' },
        { k: '待发货', v: toShip.length, d: '已接单' },
        { k: '配送中', v: shipping.length, d: '在途批次' },
        { k: '供货金额', v: '¥' + UI.money(myAmount), d: '累计' }
      ];
    }

    // 待办
    let todos = [];
    if (me.role === 'central' || me.role === 'region') {
      todos = approvals.slice(0, 3).map(function (o) {
        return {
          icon: 'check', tone: '',
          title: o.id + ' ' + BIZ.fmt.statusLabel(o.status),
          sub: (o.store || '') + ' · ¥' + UI.money(o.total),
          hash: '/approvals'
        };
      });
    } else if (me.role === 'store' || me.role === 'department') {
      todos = accepts.slice(0, 3).map(function (o) {
        return {
          icon: 'camera', tone: 'good',
          title: o.id + ' 待验收',
          sub: (o.store || '') + ' · ¥' + UI.money(o.total),
          hash: '/accept'
        };
      });
    } else {
      todos = orders.filter(function (o) {
        const rec = (o.supplierRecords || {})[me.supplier];
        return rec && rec.status === 'pending' && ['cancelled', 'rejected'].indexOf(o.status) < 0;
      }).slice(0, 3).map(function (o) {
        return {
          icon: 'truck', tone: 'info',
          title: o.id + ' 待接单',
          sub: (o.store || '') + ' · 我的商品 ' + o.items.filter(function (x) { return x.supplier === me.supplier; }).length + ' 项',
          hash: '/supplier'
        };
      });
    }

    // 结算金额共同确认：门店/部门填写金额，供应商确认；与「待我处理」计数同源
    const settleTodos = domain.pendingSettleOrders(st, me).slice(0, 2).map(function (o) {
      return {
        icon: 'bill', tone: '',
        title: (me.role === 'supplier' ? '待确认结算' : '待填写结算') + ' · ' + o.id,
        sub: (o.store || '') + ' · ¥' + UI.money(o.total),
        hash: '/settle/' + o.id
      };
    });
    if (settleTodos.length) todos = settleTodos.concat(todos).slice(0, 4);

    const entries = perm.homeEntries(me);
    const meta = perm.roleMeta(me.role);

    root.innerHTML =
      '<div class="hero">' +
        '<div class="hero-top">' +
          '<div>' +
            '<div class="hero-hello">' + greeting() + '</div>' +
            '<div class="hero-name">' + UI.esc(me.name) +
              (me.name.indexOf(meta.label) < 0 ? '<span class="hero-tag">' + UI.esc(meta.label) + '</span>' : '') +
            '</div>' +
            '<div class="hero-scope">' + UI.esc(Session.scopeOf(me)) + '</div>' +
          '</div>' +
          '<div class="hero-date">' + dateText() + '</div>' +
        '</div>' +
        '<div class="hero-foot">' +
          // 待办数统一取 actionCount：含验收、结算共同确认等所有待我动作
          '<div class="hero-metric"><div class="k">待办</div><div class="v">' + domain.actionCount(st, me) + '</div></div>' +
          '<div class="hero-metric"><div class="k">在途</div><div class="v">' + active.length + '</div></div>' +
          '<div class="hero-metric"><div class="k">超时</div><div class="v">' + overdue + '</div></div>' +
          '<a class="hero-switch" href="#/profile">' + (Session.isExternal() ? '我的' : '切换身份') + UI.icon('right', 'xs') + '</a>' +
        '</div>' +
      '</div>' +

      (overdue || warning
        ? '<a class="alert ' + (overdue ? '' : 'warn') + '" style="margin-top:12px" href="#/orders">' +
            UI.icon('clock', 'sm') +
            '<span>' + (overdue ? overdue + ' 单已超时' : '') + (overdue && warning ? '，' : '') + (warning ? warning + ' 单临近超时' : '') + '</span>' +
            '<span class="go">查看 ›</span></a>'
        : '') +

      '<div class="stat-grid" style="margin-top:12px">' +
        stats.map(function (s) {
          return '<div class="stat"><div class="k">' + UI.esc(s.k) + '</div>' +
            '<div class="v num">' + s.v + '</div>' +
            '<div class="d">' + UI.esc(s.d) + '</div></div>';
        }).join('') +
      '</div>' +

      '<div class="section">' +
        '<div class="section-head"><span class="section-title">快捷入口</span></div>' +
        '<div class="quick-grid' + (entries.length === 3 ? ' n3' : '') + '">' +
          entries.map(function (e) {
            const badge = e.key === 'approve' ? approvals.length : (e.key === 'accept' ? accepts.length : 0);
            return '<a class="quick" href="#' + (ENTRY_HASH[e.key] || '/home') + '">' +
              '<span class="qi ' + (TONE[e.tone] || 'blue') + '">' + UI.icon(ICON_OF[e.key]) + '</span>' +
              '<span class="ql">' + UI.esc(e.label) + '</span>' +
              (badge ? '<span class="qb">' + badge + '</span>' : '') + '</a>';
          }).join('') +
        '</div>' +
      '</div>' +

      (budgets.length
        ? '<div class="section"><div class="card card-pad">' +
            '<div class="between" style="margin-bottom:6px"><span class="section-title">预算占用</span>' +
            '<a class="section-more" href="#/reports">明细 ' + UI.icon('right', 'xs') + '</a></div>' +
            budgets.slice(0, 4).map(budgetRow).join('') +
            '<div class="tiny muted" style="margin-top:8px">占用率 = （基础已用 + 在途占用 + 已验收）/ 额度</div>' +
          '</div></div>'
        : '') +

      '<div class="section">' +
        '<div class="section-head"><span class="section-title">待办</span>' +
          '<a class="section-more" href="#' + (me.role === 'supplier' ? '/supplier' : me.role === 'store' || me.role === 'department' ? '/accept' : '/approvals') + '">全部 ' + UI.icon('right', 'xs') + '</a>' +
        '</div>' +
        (todos.length
          ? '<div class="card">' + todos.map(function (t) {
              return '<a class="todo" href="#' + t.hash + '">' +
                '<span class="todo-ico ' + (t.tone || '') + '">' + UI.icon(t.icon, 'sm') + '</span>' +
                '<span class="todo-main"><span class="todo-title">' + UI.esc(t.title) + '</span>' +
                '<span class="todo-sub">' + UI.esc(t.sub) + '</span></span>' +
                UI.icon('right', 'sm') + '</a>';
            }).join('') + '</div>'
          : '<div class="card card-pad"><div class="small muted" style="text-align:center;padding:8px 0">暂无待办，' + (me.role === 'supplier' ? '保持及时接单' : '可以开始采购了') + '</div></div>') +
      '</div>' +

      (me.role === 'central' || me.role === 'region'
        ? '<div class="section"><div class="card card-pad">' +
            '<div class="between" style="margin-bottom:8px"><span class="section-title">金额口径</span>' +
            '<a class="section-more" href="#/reports">看板 ' + UI.icon('right', 'xs') + '</a></div>' +
            '<div class="kv"><span class="k">已申请</span><span class="v num">¥' + UI.money(report.totals.requested) + '</span></div>' +
            '<div class="kv"><span class="k">已验收</span><span class="v num">¥' + UI.money(report.totals.accepted) + '</span></div>' +
            '<div class="kv"><span class="k">已对账</span><span class="v num">¥' + UI.money(report.totals.reconciled) + '</span></div>' +
            '<div class="kv"><span class="k">待对账</span><span class="v num money red">¥' + UI.money(report.totals.unreconciledAccepted) + '</span></div>' +
          '</div></div>'
        : '');
  };

  function budgetRow(b) {
    const tone = b.usedPct >= 90 ? 'bad' : b.usedPct >= 70 ? 'warn' : '';
    const items = (b.items || []).map(function (it) {
      const t = it.usedPct >= 90 ? 'bad' : it.usedPct >= 70 ? 'warn' : '';
      return '<div class="budget-item">' +
        '<span class="bi-name">' + UI.esc(it.name) + '</span>' +
        '<span class="bi-bar"><i class="' + t + '" style="width:' + Math.min(100, it.usedPct) + '%"></i></span>' +
        '<span class="bi-pct">¥' + UI.money(it.used) + ' / ' + UI.money(it.budget) + '</span>' +
        '</div>';
    }).join('');
    return '<div class="budget-row">' +
      '<div class="budget-top"><span class="budget-store">' + UI.esc(b.store) + '</span>' +
      '<span class="budget-num">¥' + UI.money(b.used) + ' / ¥' + UI.money(b.budget) + '</span></div>' +
      '<div class="bar"><i class="' + tone + '" style="width:' + b.usedPct + '%"></i></div>' +
      '<div class="bar-legend"><span>' + b.rooms + ' 间房</span><span>在途 ¥' + UI.money(b.occupied) + '</span><span>已验收 ¥' + UI.money(b.spent) + '</span>' +
      '<span style="margin-left:auto">占用 ' + b.usedPct + '%</span></div>' +
      (items ? '<div class="budget-items">' + items + '</div>' : '') +
    '</div>';
  }

  const ICON_OF = {
    order: 'cart', orders: 'orders', accept: 'camera', drafts: 'box',
    approve: 'check', recon: 'bill', reports: 'chart', supply: 'truck', budget: 'bill'
  };
})(window.Views);
