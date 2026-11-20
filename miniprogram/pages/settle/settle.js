// 结算金额共同确认：门店/部门填实际结算金额，供应商确认或提出异议
const store = require('../../utils/store');
const session = require('../../utils/session');
const domain = require('../../utils/domain');
const perm = require('../../utils/perm');
const fmt = require('../../utils/format');
const share = require('../../utils/share');

Page({
  onShareAppMessage: share.handler,
  data: {
    me: null,
    order: null,
    lines: [],
    settlement: null,
    itemsAmount: 0,
    itemsAmountText: '0',
    amount: '',
    reason: '',
    diff: 0,
    diffText: '0',
    hasDiff: false,
    isStoreSide: false,
    isSupplierSide: false,
    disputeReason: '',
    showDispute: false,
    editable: false,
    canSubmit: false
  },

  onLoad(query) {
    this.orderId = (query && query.id) || '';
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const me = session.current();
    const state = store.loadState();
    const order = (state.orders || []).filter(function (o) { return o.id === this.orderId; })[0];
    if (!order) {
      this.setData({ me: me, order: null });
      return;
    }

    const itemsAmount = domain.acceptedAmountOf(order);
    const isStoreSide = !!domain.settleActorOf(order, me);
    const isSupplierSide = me.role === 'supplier' && (order.items || []).some(function (x) {
      return x.supplier === me.supplier;
    });
    const editable = isStoreSide && ['settle-pending', 'settle-disputed'].indexOf(order.status) >= 0;

    const raw = order.settlement || {};
    const amount = editable
      ? (raw.status === 'disputed' || raw.status === 'pending-supplier'
        ? Number(raw.amount || itemsAmount)
        : itemsAmount)
      : Number(raw.amount || itemsAmount);
    const diff = Math.round((amount - itemsAmount) * 100) / 100;

    const lines = (order.items || []).map(function (x) {
      const n = Number(x.accepted || 0);
      return {
        id: x.id,
        name: x.name,
        spec: x.spec || '',
        unit: x.unit || '',
        supplier: x.supplier,
        qty: n,
        orderQty: Number(x.qty || 0),
        priceText: fmt.money(x.price),
        amountText: fmt.money(Math.round(n * Number(x.price || 0) * 100) / 100),
        partial: n < Number(x.qty || 0)
      };
    });

    const settlement = order.settlement ? {
      status: order.settlement.status,
      statusText: order.settlement.status === 'pending-supplier' ? '待供应商确认'
        : order.settlement.status === 'confirmed' ? '双方已确认'
          : order.settlement.status === 'disputed' ? '供应商已提异议' : '待门店提交',
      amountText: fmt.money(order.settlement.amount),
      byName: order.settlement.byName || '',
      submittedAt: order.settlement.submittedAt ? fmt.fullTime(order.settlement.submittedAt) : '',
      confirmedAt: order.settlement.confirmedAt ? fmt.fullTime(order.settlement.confirmedAt) : '',
      reason: order.settlement.reason || '',
      round: order.settlement.round || 1,
      disputes: (order.settlement.disputes || []).map(function (d) {
        return { by: d.supplier || d.by, reason: d.reason, at: fmt.fullTime(d.at) };
      })
    } : null;

    this.setData({
      me: me,
      order: {
        id: order.id,
        status: order.status,
        statusLabel: fmt.statusLabel(order.status),
        statusCls: fmt.statusCls(order.status),
        totalText: fmt.money(order.total),
        owner: order.purchaseType === 'department' ? ('部门采购 · ' + order.department + ' → ' + order.store) : order.store,
        purpose: order.purpose || '',
        finishedAt: (order.acceptances && order.acceptances.length)
          ? fmt.fullTime(order.acceptances[order.acceptances.length - 1].at) : ''
      },
      lines: lines,
      settlement: settlement,
      itemsAmount: itemsAmount,
      itemsAmountText: fmt.money(itemsAmount),
      amount: String(amount),
      diff: diff,
      diffText: fmt.money(Math.abs(diff)),
      hasDiff: Math.abs(diff) > 0.004,
      isStoreSide: isStoreSide,
      isSupplierSide: isSupplierSide,
      editable: editable,
      canSubmit: editable && Number(amount) > 0 && (Math.abs(diff) <= 0.004 || (this.data.reason || '').trim().length >= 4)
    });
  },

  onAmount(e) {
    const v = String(e.detail.value || '');
    const amount = Number(v);
    const items = Number(this.data.itemsAmount);
    const diff = isFinite(amount) ? Math.round((amount - items) * 100) / 100 : 0;
    this.setData({
      amount: v,
      diff: diff,
      diffText: fmt.money(Math.abs(diff)),
      hasDiff: Math.abs(diff) > 0.004,
      canSubmit: !!v && amount > 0 && (Math.abs(diff) <= 0.004 || (this.data.reason || '').trim().length >= 4)
    });
  },

  onReason(e) {
    const reason = String(e.detail.value || '');
    const items = Number(this.data.itemsAmount);
    const amount = Number(this.data.amount);
    const diff = isFinite(amount) ? Math.round((amount - items) * 100) / 100 : 0;
    this.setData({
      reason: reason,
      canSubmit: !!this.data.amount && amount > 0 && (Math.abs(diff) <= 0.004 || reason.trim().length >= 4)
    });
  },

  onDisputeReason(e) {
    this.setData({ disputeReason: String(e.detail.value || '') });
  },

  toggleDispute() {
    this.setData({ showDispute: !this.data.showDispute });
  },

  // 门店 / 部门：提交结算金额
  submit() {
    const amount = Number(this.data.amount);
    if (!amount || amount <= 0) {
      wx.showToast({ title: '请填写结算金额', icon: 'none' });
      return;
    }
    const that = this;
    wx.showModal({
      title: '提交结算金额',
      content: '结算金额 ¥' + fmt.money(amount) +
        (this.data.hasDiff ? '\n与实收核算差 ¥' + this.data.diffText + '，将提交供应商确认。' : '\n提交后由供应商确认。'),
      confirmColor: '#2966a5',
      success: function (res) {
        if (!res.confirm) return;
        try {
          const state = store.loadState();
          const me = session.current();
          const result = domain.submitSettlement(state, me, {
            orderId: that.orderId, amount: amount, reason: that.data.reason
          });
          store.saveState(state);
          store.appendAudit([result.audit]);
          wx.showToast({ title: '已提交，待供应商确认', icon: 'success' });
          that.refresh();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '提交失败', icon: 'none' });
        }
      }
    });
  },

  // 供应商：确认结算金额
  confirm() {
    const that = this;
    wx.showModal({
      title: '确认结算金额',
      content: '确认后该笔订单进入统一对账，金额不再修改。',
      confirmColor: '#2966a5',
      success: function (res) {
        if (!res.confirm) return;
        that.doSettleAction('confirm', '');
      }
    });
  },

  // 供应商：提出异议
  dispute() {
    const reason = (this.data.disputeReason || '').trim();
    if (reason.length < 4) {
      wx.showToast({ title: '请填写至少4个字的异议说明', icon: 'none' });
      return;
    }
    this.doSettleAction('dispute', reason);
  },

  doSettleAction(action, reason) {
    try {
      const state = store.loadState();
      const me = session.current();
      const result = domain.settleAction(state, me, {
        orderId: this.orderId, action: action, reason: reason
      });
      store.saveState(state);
      store.appendAudit([result.audit]);
      this.setData({ showDispute: false, disputeReason: '' });
      wx.showToast({
        title: action === 'confirm' ? '已确认，进入待对账' : '已提出异议，退回门店',
        icon: 'none'
      });
      this.refresh();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    }
  },

  copyId() {
    wx.setClipboardData({ data: this.orderId });
  },

  goDetail() {
    wx.redirectTo({ url: '/pages/order-detail/order-detail?id=' + this.orderId });
  },

  back() {
    wx.navigateBack({
      fail: function () { wx.reLaunch({ url: '/pages/orders/orders' }); }
    });
  }
});
