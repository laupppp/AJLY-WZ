const share = require('../../utils/share');
const store = require('../../utils/store');
const session = require('../../utils/session');
const domain = require('../../utils/domain');
const fmt = require('../../utils/format');
const { SUPPLIERS } = require('../../data/seed');

Page({
  onShareAppMessage: share.handler,
  data: {
    me: null,
    role: '',
    tabs: [],
    active: 'overview',
    totals: null,
    funnel: [],
    byZone: [],
    bySupplier: [],
    departments: [],
    budgetRows: [],
    budgetItemTotals: [],
    budgetTotals: null,
    recons: [],
    suppliers: SUPPLIERS,
    supplierIndex: 0,
    supplierName: SUPPLIERS[0],
    period: '',
    canCreate: false
  },

  onLoad(query) {
    if (query && query.tab) this.pendingTab = query.tab;
  },

  onShow() {
    const now = new Date();
    this.setData({ period: now.getFullYear() + '年' + (now.getMonth() + 1) + '月' });
    if (this.pendingTab) {
      this.setData({ active: this.pendingTab });
      this.pendingTab = '';
    }
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh();
    wx.stopPullDownRefresh();
  },

  refresh() {
    const state = store.loadState();
    const me = session.current();
    let tabs = [{ key: 'overview', label: '概览' }];
    if (me.role === 'central') {
      tabs = [
        { key: 'overview', label: '概览' },
        { key: 'zone', label: '战区金额' },
        { key: 'dept', label: '部门金额' },
        { key: 'recon', label: '统一对账' }
      ];
    } else if (me.role === 'supplier') {
      tabs = [{ key: 'recon', label: '对账确认' }];
    }

    let active = this.data.active;
    if (!tabs.some(function (t) { return t.key === active; })) active = tabs[0].key;

    const visible = domain.visibleOrders(state, me);
    const summary = domain.reportSummary({ orders: visible });
    const totals = {
      requests: summary.totals.requests,
      activeOrders: summary.totals.activeOrders,
      requestedText: fmt.money(summary.totals.requested),
      acceptedText: fmt.money(summary.totals.accepted),
      reconciledText: fmt.money(summary.totals.reconciled),
      unreconciledText: fmt.money(summary.totals.unreconciledAccepted)
    };
    const requested = summary.totals.requested || 1;
    const funnel = [
      { label: '申请金额', text: fmt.money(summary.totals.requested), pct: 100, cls: 'navy' },
      { label: '已验收金额', text: fmt.money(summary.totals.accepted), pct: Math.round(summary.totals.accepted / requested * 100), cls: 'blue' },
      { label: '已对账金额', text: fmt.money(summary.totals.reconciled), pct: Math.round(summary.totals.reconciled / requested * 100), cls: 'green' }
    ];

    const byZone = summary.byZone.map(function (x) {
      return {
        key: x.key,
        orders: x.orders,
        requestedText: fmt.money(x.requested),
        acceptedText: fmt.money(x.accepted),
        rate: x.requested > 0 ? Math.round(x.accepted / x.requested * 100) : 0
      };
    }).sort(function (a, b) { return b.rate - a.rate; });

    const bySupplier = summary.bySupplier.map(function (x) {
      return {
        key: x.key,
        orders: x.orders,
        requestedText: fmt.money(x.requested),
        acceptedText: fmt.money(x.accepted),
        reconciledText: fmt.money(x.reconciled)
      };
    });

    const deptRaw = domain.departmentSummary(state);
    const departments = deptRaw.map(function (r) {
      return {
        department: r.department,
        orders: r.orders,
        requestedText: fmt.money(r.requested),
        acceptedText: fmt.money(r.accepted),
        reconciledText: fmt.money(r.reconciled)
      };
    }).sort(function (a, b) {
      return Number(b.requestedText.replace(/,/g, '')) - Number(a.requestedText.replace(/,/g, ''));
    });

    const deptTotals = {
      orders: deptRaw.reduce(function (s, r) { return s + r.orders; }, 0),
      requestedText: fmt.money(deptRaw.reduce(function (s, r) { return s + r.requested; }, 0)),
      acceptedText: fmt.money(deptRaw.reduce(function (s, r) { return s + r.accepted; }, 0)),
      reconciledText: fmt.money(deptRaw.reduce(function (s, r) { return s + r.reconciled; }, 0))
    };

    const budgetRaw = domain.budgetSummary(state, me);
    const budgetRows = budgetRaw.map(function (r) {
      return {
        store: r.store,
        zone: r.zone,
        rooms: r.rooms,
        pct: r.usedPct,
        level: r.usedPct >= 90 ? 'bad' : r.usedPct >= 75 ? 'warn' : 'blue',
        budgetText: fmt.money(r.budget),
        usedText: fmt.money(r.used),
        occupiedText: fmt.money(r.occupied),
        spentText: fmt.money(r.spent),
        availableText: fmt.money(r.available),
        items: (r.items || []).map(function (it) {
          return {
            key: it.key,
            name: it.name,
            pct: it.usedPct,
            level: it.usedPct >= 90 ? 'bad' : it.usedPct >= 75 ? 'warn' : 'blue',
            budgetText: fmt.money(it.budget),
            usedText: fmt.money(it.used),
            availableText: fmt.money(it.available)
          };
        })
      };
    });
    // 各科目全公司/战区合计，便于横向比较
    const budgetItemTotals = (budgetRaw[0] ? budgetRaw[0].items : []).map(function (base, i) {
      const budget = budgetRaw.reduce(function (s, r) { return s + (r.items[i] ? r.items[i].budget : 0); }, 0);
      const used = budgetRaw.reduce(function (s, r) { return s + (r.items[i] ? r.items[i].used : 0); }, 0);
      const pct = budget > 0 ? Math.round(used / budget * 100) : 0;
      return {
        key: base.key,
        name: base.name,
        pct: Math.min(100, pct),
        level: pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'blue',
        budgetText: fmt.money(budget),
        usedText: fmt.money(used),
        availableText: fmt.money(budget - used)
      };
    });
    let budgetTotals = null;
    if (budgetRaw.length && me.role !== 'store') {
      const budget = budgetRaw.reduce(function (s, r) { return s + r.budget; }, 0);
      const used = budgetRaw.reduce(function (s, r) { return s + r.used; }, 0);
      budgetTotals = {
        stores: budgetRaw.length,
        budgetText: fmt.money(budget),
        usedText: fmt.money(used),
        occupiedText: fmt.money(budgetRaw.reduce(function (s, r) { return s + r.occupied; }, 0)),
        spentText: fmt.money(budgetRaw.reduce(function (s, r) { return s + r.spent; }, 0)),
        availableText: fmt.money(budgetRaw.reduce(function (s, r) { return s + r.available; }, 0)),
        pct: budget > 0 ? Math.min(100, Math.round(used / budget * 100)) : 0
      };
    }

    // 战区金额：门店单按战区汇总（部门采购在「部门金额」页单独看）
    const zoneAgg = {};
    domain.visibleOrders(state, me).forEach(function (o) {
      if (o.purchaseType !== 'store') return;
      if (['rejected', 'cancelled'].indexOf(o.status) >= 0) return;
      const key = o.zone || '未归属战区';
      if (!zoneAgg[key]) zoneAgg[key] = { key: key, orders: 0, requested: 0, accepted: 0, reconciled: 0, stores: {} };
      const a = zoneAgg[key];
      a.orders += 1;
      a.stores[o.store] = 1;
      a.requested += Number(o.total || 0);
      (o.items || []).forEach(function (line) {
        const price = Number(line.price || 0);
        a.accepted += Number(line.accepted || 0) * price;
        a.reconciled += Number(line.reconciled || 0) * price;
      });
    });
    // 战区预算占用（按 budgetRaw 的战区字段汇总，门店数以预算台账为准）
    const zoneBudget = {};
    budgetRaw.forEach(function (r) {
      if (!r.zone) return;
      if (!zoneBudget[r.zone]) zoneBudget[r.zone] = { budget: 0, used: 0, stores: 0 };
      zoneBudget[r.zone].budget += Number(r.budget || 0);
      zoneBudget[r.zone].used += Number(r.used || 0);
      zoneBudget[r.zone].stores += 1;
    });
    const zones = Object.keys(zoneAgg).map(function (k) {
      const a = zoneAgg[k];
      const b = zoneBudget[k] || { budget: 0, used: 0, stores: 0 };
      const pct = b.budget > 0 ? Math.min(100, Math.round(b.used / b.budget * 100)) : 0;
      return {
        key: k,
        stores: b.stores || Object.keys(a.stores).length,
        orders: a.orders,
        requestedText: fmt.money(a.requested),
        acceptedText: fmt.money(a.accepted),
        reconciledText: fmt.money(a.reconciled),
        pendingText: fmt.money(Math.max(0, a.requested - a.accepted)),
        rate: a.requested > 0 ? Math.round(a.accepted / a.requested * 100) : 0,
        budgetText: fmt.money(b.budget),
        usedText: fmt.money(b.used),
        usedPct: pct,
        level: pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'blue'
      };
    }).sort(function (x, y) {
      return Number(String(y.requestedText).replace(/,/g, '')) - Number(String(x.requestedText).replace(/,/g, ''));
    });
    const zoneTotals = {
      zones: zones.length,
      stores: zones.reduce(function (s, z) { return s + z.stores; }, 0),
      orders: zones.reduce(function (s, z) { return s + z.orders; }, 0),
      requestedText: fmt.money(zones.reduce(function (s, z) { return s + Number(String(z.requestedText).replace(/,/g, '')); }, 0)),
      acceptedText: fmt.money(zones.reduce(function (s, z) { return s + Number(String(z.acceptedText).replace(/,/g, '')); }, 0)),
      reconciledText: fmt.money(zones.reduce(function (s, z) { return s + Number(String(z.reconciledText).replace(/,/g, '')); }, 0))
    };

    const statusMap = {
      'supplier-pending': { text: '待供应商确认', cls: 'warn' },
      'supplier-confirmed': { text: '待运营管理部锁定', cls: 'info' },
      'locked': { text: '已锁定', cls: 'good' },
      'disputed': { text: '供应商提出差异', cls: 'bad' }
    };

    const recons = (state.recons || []).filter(function (r) {
      return me.role !== 'supplier' || r.supplier === me.supplier;
    }).map(function (r) {
      const meta = statusMap[r.status] || { text: r.status, cls: 'gray' };
      return {
        id: r.id,
        supplier: r.supplier,
        period: r.period,
        totalText: fmt.money(r.total),
        lineCount: (r.lines || []).length,
        statusText: meta.text,
        cls: meta.cls,
        created: fmt.shortTime(r.createdAt),
        canLock: me.role === 'central' && r.status === 'supplier-confirmed',
        canConfirm: me.role === 'supplier' && r.status === 'supplier-pending',
        canDispute: me.role === 'supplier' && r.status === 'supplier-pending',
        note: r.disputeNote || ''
      };
    });

    this.setData({
      me: me,
      role: me.role,
      tabs: tabs,
      active: active,
      totals: totals,
      funnel: funnel,
      byZone: byZone,
      zones: zones,
      zoneTotals: zoneTotals,
      bySupplier: bySupplier,
      departments: departments,
      deptTotals: deptTotals,
      budgetRows: budgetRows,
      budgetItemTotals: budgetItemTotals,
      budgetTotals: budgetTotals,
      recons: recons,
      canCreate: me.role === 'central'
    });
  },

  onTab(e) {
    this.setData({ active: e.currentTarget.dataset.key });
  },

  onSupplier(e) {
    const index = Number(e.detail.value);
    this.setData({ supplierIndex: index, supplierName: SUPPLIERS[index] });
  },

  onPeriod(e) {
    this.setData({ period: e.detail.value });
  },

  createRecon() {
    try {
      const state = store.loadState();
      const supplier = SUPPLIERS[this.data.supplierIndex];
      const result = domain.createReconciliation(state, this.data.me, { supplier: supplier, period: this.data.period });
      store.saveState(state);
      wx.showModal({
        title: '对账单已生成',
        content: result.recon.id + ' · ' + supplier + '\n共 ' + result.recon.lines.length + ' 条明细，合计 ¥' + fmt.money(result.recon.total) + '，待供应商确认。',
        showCancel: false
      });
      this.refresh();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  reconAction(e) {
    const id = e.currentTarget.dataset.id;
    const action = e.currentTarget.dataset.action;
    const that = this;
    if (action === 'lock') {
      wx.showModal({
        title: '锁定对账单 ' + id,
        content: '锁定后对账数量计入已对账，不可撤销。是否继续？',
        success: function (res) {
          if (!res.confirm) return;
          that.runRecon(id, action, '');
        }
      });
    } else if (action === 'confirm') {
      wx.showModal({
        title: '确认对账单 ' + id,
        content: '确认金额与数量无误？确认后等待运营管理部锁定。',
        success: function (res) {
          if (!res.confirm) return;
          that.runRecon(id, action, '');
        }
      });
    } else {
      wx.showModal({
        title: '提出差异',
        editable: true,
        placeholderText: '请填写差异原因（2-300字）',
        success: function (res) {
          if (!res.confirm) return;
          that.runRecon(id, action, res.content);
        }
      });
    }
  },

  runRecon(id, action, note) {
    try {
      const state = store.loadState();
      domain.reconAction(state, this.data.me, { reconId: id, action: action, note: note });
      store.saveState(state);
      wx.showToast({ title: '操作成功', icon: 'success' });
      this.refresh();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  goIdentity() {
    wx.navigateTo({ url: '/pages/identity/identity' });
  }
});
