const share = require('../../utils/share');
const store = require('../../utils/store');
const session = require('../../utils/session');
const domain = require('../../utils/domain');
const fmt = require('../../utils/format');

// 各页签的空态文案：说明"为什么这里是空的、下一步做什么"
const EMPTY_TEXT = {
  pending: '当前没有待接单的订单。刚切换身份或刚重置数据时，下拉刷新一次即可。',
  toship: '已接单的订单会进入这里，登记配送方式与运单号后发出。',
  shipping: '已发出、等待收货验收的订单会显示在这里。',
  settle: '验收完成后，门店提交结算金额、需要你确认或提出异议的订单会显示在这里。',
  done: '已确认结算并进入对账的订单会显示在这里。',
  issue: '暂无拒单记录。'
};

Page({
  onShareAppMessage: share.handler,
  data: {
    me: null,
    isSupplier: false,
    tabs: [],
    active: 'pending',
    orders: [],
    stats: {},
    emptyHint: EMPTY_TEXT.pending
  },

  onLoad(query) {
    this.focusId = (query && query.orderId) || '';
  },

  onShow() {
    this.refresh();
    if (this.focusId) {
      const target = this.data.orders.filter(function (o) { return o.id === this.focusId; }.bind(this))[0];
      this.focusId = '';
      if (target && target.canShip) wx.navigateTo({ url: '/pages/ship/ship?orderId=' + target.id });
    }
  },

  onPullDownRefresh() {
    this.refresh();
    wx.stopPullDownRefresh();
  },

  refresh() {
    const state = store.loadState();
    const me = session.current();
    const isSupplier = me.role === 'supplier';

    let orders = [];
    let tabs = [];
    let stats = {};
    let activeKey = this.data.active || 'pending';
    let totalMine = 0;

    if (isSupplier) {
      const mine = domain.visibleOrders(state, me).filter(function (o) {
        const r = (o.supplierRecords || {})[me.supplier];
        return r && ['cancelled', 'rejected'].indexOf(o.status) < 0;
      });
      totalMine = mine.length;

      const classify = function (o) {
        // 验收完成后分项记录已是 accepted，但结算金额仍需双方确认，
        // 因此优先按订单状态分流到「结算确认」，不能简单归入「已完成」
        if (['settle-pending', 'settle-supplier', 'settle-disputed'].indexOf(o.status) >= 0) return 'settle';
        const r = o.supplierRecords[me.supplier];
        if (r.status === 'pending') return 'pending';
        if (r.status === 'issue') return 'issue';
        if (['accepted', 'delivered'].indexOf(r.status) >= 0) return 'done';
        if (r.status === 'shipping') return 'shipping';
        if (r.status === 'confirmed') {
          const hasDelivery = r.deliveries && r.deliveries.length;
          return hasDelivery ? 'shipping' : 'toship';
        }
        return 'pending';
      };

      const buckets = { pending: [], toship: [], shipping: [], settle: [], done: [], issue: [] };
      mine.forEach(function (o) { buckets[classify(o)].push(o); });

      tabs = [
        { key: 'pending', label: '待接单', count: buckets.pending.length },
        { key: 'toship', label: '待发货', count: buckets.toship.length },
        { key: 'shipping', label: '配送中', count: buckets.shipping.length },
        { key: 'settle', label: '结算确认', count: buckets.settle.length },
        { key: 'done', label: '已完成', count: buckets.done.length }
      ];
      // 有拒单时才出现该页签，避免空页签干扰
      if (buckets.issue.length) {
        tabs.push({ key: 'issue', label: '已拒单', count: buckets.issue.length });
      }

      stats = {
        pending: buckets.pending.length,
        toship: buckets.toship.length,
        amountText: fmt.money(buckets.done.reduce(function (sum, o) {
          return sum + (o.items || []).filter(function (x) { return x.supplier === me.supplier; })
            .reduce(function (s, x) { return s + x.price * Number(x.accepted || 0); }, 0);
        }, 0))
      };

      // 页签会随数据变化增减（如"已拒单"），记录里的 active 可能已不存在，
      // 若不纠正会出现"顶部显示 6 单待接单、列表却空白、按钮也没有"的情况
      if (!tabs.some(function (t) { return t.key === activeKey; })) activeKey = 'pending';
      const current = buckets[activeKey] || [];
      const slaRows = domain.slaEntries(state).filter(function (s) {
        return s.kind === 'supplier' && s.owner === me.supplier;
      });

      orders = current.map(function (o) {
        const r = o.supplierRecords[me.supplier];
        const own = (o.items || []).filter(function (x) { return x.supplier === me.supplier; });
        const amount = own.reduce(function (sum, x) { return sum + x.price * x.qty; }, 0);
        const delivered = own.reduce(function (sum, x) { return sum + Number(x.deliveredQty || 0); }, 0);
        const totalQty = own.reduce(function (sum, x) { return sum + x.qty; }, 0);
        const sla = slaRows.filter(function (s) { return s.orderId === o.id; })[0];
        const lastDelivery = r.deliveries && r.deliveries.length ? r.deliveries[r.deliveries.length - 1] : null;
        const batches = r.deliveries ? r.deliveries.length : 0;
        // 发货后是「配送中」；结算阶段按订单状态显示，避免"验收完就写已完成"的误导
        const inSettle = ['settle-pending', 'settle-supplier', 'settle-disputed'].indexOf(o.status) >= 0;
        const statusText = inSettle ? fmt.statusLabel(o.status)
          : r.status === 'pending' ? '待接单'
            : r.status === 'issue' ? '已拒单'
              : r.status === 'confirmed' ? (batches ? '分批配送中' : '待发货')
                : r.status === 'shipping' ? '配送中'
                  : r.status === 'accepted' ? '已完成'
                    : r.status === 'delivered' ? '已送达待验收'
                      : '异常';
        const statusCls = inSettle ? fmt.statusCls(o.status)
          : r.status === 'pending' ? 'warn'
            : r.status === 'issue' ? 'bad'
              : (r.status === 'accepted' || r.status === 'delivered') ? 'good'
                : 'info';

        return {
          id: o.id,
          store: o.purchaseType === 'department' ? (o.department + ' → ' + o.store) : o.store,
          amountText: fmt.money(amount),
          itemsText: own.slice(0, 2).map(function (x) { return x.name + '×' + x.qty; }).join('、') + (own.length > 2 ? ' 等' + own.length + '项' : ''),
          progressText: '已交付 ' + delivered + '/' + totalQty,
          statusText: statusText,
          cls: statusCls,
          slaText: sla && sla.level !== 'normal' ? '已等待 ' + fmt.hoursText(sla.hours) + (sla.level === 'overdue' ? '（已超时）' : '（临近超时）') : '',
          slaLevel: sla ? sla.level : 'normal',
          canAck: r.status === 'pending',
          canShip: r.status === 'confirmed',
          canReopen: r.status === 'issue',
          canSettle: o.status === 'settle-supplier',
          issueText: r.status === 'issue' ? String(r.issue || '') : '',
          lastTracking: lastDelivery && lastDelivery.shipping ? lastDelivery.shipping.trackingNo : '',
          batchCount: r.deliveries ? r.deliveries.length : 0
        };
      });
    }

    this.setData({
      me: me,
      isSupplier: isSupplier,
      active: activeKey,
      tabs: isSupplier ? tabs : [],
      orders: orders,
      stats: stats,
      emptyHint: !isSupplier
        ? ''
        : (totalMine === 0
          ? '当前身份「' + me.supplier + '」名下暂无订单。若刚切换身份，请下拉刷新；若数据异常，可在「我的 - 重置演示数据」恢复初始订单。'
          : (EMPTY_TEXT[activeKey] || '该状态下暂无订单'))
    });
  },

  onTab(e) {
    this.setData({ active: e.currentTarget.dataset.key });
    this.refresh();
  },

  ack(e) {
    const id = e.currentTarget.dataset.id;
    const action = e.currentTarget.dataset.action;
    const that = this;
    if (action === 'confirm') {
      wx.showModal({
        title: '确认接单',
        content: '确认承接 ' + id + ' 的供货？',
        success: function (res) {
          if (!res.confirm) return;
          that.runAck(id, action, '');
        }
      });
    } else {
      wx.showModal({
        title: '无法接单',
        editable: true,
        placeholderText: '请填写原因（2-300字）',
        success: function (res) {
          if (!res.confirm) return;
          that.runAck(id, action, res.content);
        }
      });
    }
  },

  runAck(id, action, reason) {
    // 身份以当前会话为准，避免页面停留过久时用到过期的 data.me
    const me = session.current();
    if (!me || me.role !== 'supplier') {
      wx.showModal({
        title: '无法接单',
        content: '当前身份不是供应商。请在「我的」切换为供应商身份后再操作。',
        showCancel: false
      });
      return;
    }
    try {
      const state = store.loadState();
      const result = domain.supplierAck(state, me, { orderId: id, action: action, reason: reason });
      store.saveState(state);
      store.appendAudit([result.audit]);
      wx.showToast({ title: action === 'confirm' ? '已接单' : '已反馈', icon: 'success' });
      this.refresh();
    } catch (err) {
      // 用弹窗而不是一闪而过的 toast，确保看得到失败原因
      wx.showModal({
        title: action === 'confirm' ? '接单失败' : '反馈失败',
        content: (err && err.message ? err.message : '操作失败') +
          '\n\n若数据异常，可在「我的 - 重置演示数据」恢复初始订单后重试。',
        showCancel: false
      });
      this.refresh();
    }
  },

  // 撤回拒单：误操作或情况变化后可恢复为待接单，避免订单卡死
  reopen(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    wx.showModal({
      title: '撤回拒单',
      content: '撤回后该订单会重新回到待接单，可以再次确认接单。',
      confirmText: '撤回',
      success: function (res) {
        if (!res.confirm) return;
        try {
          const state = store.loadState();
          const result = domain.reopenSupplierAck(state, session.current(), { orderId: id });
          store.saveState(state);
          store.appendAudit([result.audit]);
          wx.showToast({ title: '已撤回，可重新接单', icon: 'success' });
          that.setData({ active: 'pending' });
          that.refresh();
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      }
    });
  },

  ship(e) {
    wx.navigateTo({ url: '/pages/ship/ship?orderId=' + e.currentTarget.dataset.id });
  },

  goSettle(e) {
    wx.navigateTo({ url: '/pages/settle/settle?id=' + e.currentTarget.dataset.id });
  },

  copyText(e) {
    const text = String(e.currentTarget.dataset.text || '');
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: function () { wx.showToast({ title: '已复制 ' + text, icon: 'none' }); }
    });
  },

  gotoDetail(e) {
    wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + e.currentTarget.dataset.id });
  },

  goIdentity() {
    wx.navigateTo({ url: '/pages/identity/identity?switch=1' });
  }
});
