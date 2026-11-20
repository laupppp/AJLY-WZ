const share = require('../../utils/share');
const store = require('../../utils/store');
const session = require('../../utils/session');
const domain = require('../../utils/domain');
const perm = require('../../utils/perm');
const fmt = require('../../utils/format');

Page({
  onShareAppMessage: share.handler,
  data: {
    id: '',
    me: null,
    order: null,
    items: [],
    timeline: [],
    suppliers: [],
    deliveries: [],
    accepts: [],
    photos: [],
    actions: {},
    slaText: '',
    slaLevel: ''
  },

  onLoad(query) {
    this.setData({ id: (query && query.id) || '' });
  },

  onShow() {
    this.refresh();
  },

  acceptable(order, me) {
    return domain.canAcceptOrder(order, me);
  },

  refresh() {
    const state = store.loadState();
    const me = session.current();
    const id = this.data.id;
    const order = (state.orders || []).filter(function (o) { return o.id === id; })[0];
    if (!order) {
      this.setData({ order: null });
      return;
    }
    const sla = domain.slaForOrder(state, id);

    const items = (order.items || []).map(function (x) {
      return {
        id: x.id,
        name: x.name,
        spec: x.spec || '',
        unit: x.unit || '',
        priceText: fmt.money2(x.price),
        qty: x.qty,
        amountText: fmt.money2(Math.round(x.price * 100) * x.qty / 100),
        accepted: Number(x.accepted || 0),
        reconciled: Number(x.reconciled || 0),
        pendingRecon: Number(x.reconPending || 0),
        supplier: x.supplier,
        deliveredQty: Number(x.deliveredQty || 0)
      };
    });

    const audits = store.listAudit(id).slice().reverse();
    const timeline = [{
      title: '提交采购申请',
      desc: order.created + ' · ' + order.manager,
      cls: 'done'
    }];
    audits.forEach(function (a) {
      timeline.push({
        title: a.decision + (a.stage === 'delivery' ? '' : ''),
        desc: fmt.fullTime(a.at) + ' · ' + a.role + (a.note ? ' · ' + a.note : ''),
        cls: a.decision === '驳回' || a.decision === '撤销' ? 'warn' : 'done'
      });
    });
    if (order.status === 'cancelled' && !audits.length) {
      timeline.push({ title: '订单撤销', desc: fmt.fullTime(order.cancelledAt), cls: 'warn' });
    }

    const deliveries = [];
    const suppliers = [];
    Object.keys(order.supplierRecords || {}).forEach(function (name) {
      const r = order.supplierRecords[name];
      const statusText = r.status === 'pending' ? '待接单'
        : r.status === 'confirmed' ? (r.deliveries && r.deliveries.length ? '分批配送中' : '备货中')
          : r.status === 'shipping' ? '配送中'
            : r.status === 'accepted' ? '已完成'
              : r.status === 'delivered' ? '已送达待验收'
                : r.status === 'issue' ? '无法接单' : r.status;
      suppliers.push({
        name: name,
        statusText: statusText,
        cls: r.status === 'pending' ? 'warn' : r.status === 'issue' ? 'bad' : (r.status === 'accepted' || r.status === 'delivered') ? 'good' : 'info',
        issue: r.issue || '',
        confirmedAt: r.confirmedAt ? fmt.fullTime(r.confirmedAt) : ''
      });
      (r.deliveries || []).forEach(function (d) {
        deliveries.push({
          supplier: name,
          batchNo: d.batchNo,
          methodText: domain.SHIPPING_METHODS[d.shipping.method] || d.shipping.method,
          carrier: d.shipping.carrier || '',
          trackingNo: d.shipping.trackingNo || '',
          contact: d.shipping.contact || '',
          estimatedAt: d.shipping.estimatedAt || '',
          at: fmt.fullTime(d.at),
          linesText: (d.lines || []).map(function (l) { return l.name + '×' + l.qty; }).join('、')
        });
      });
    });
    deliveries.sort(function (a, b) { return b.at < a.at ? -1 : 1; });

    const accepts = [];
    const photos = [];
    (order.acceptances || []).forEach(function (a) {
      accepts.push({
        at: fmt.fullTime(a.at),
        by: a.byName || a.by,
        supplier: a.supplier,
        batchNo: a.batchNo,
        result: '验收合格',
        cls: 'good',
        note: a.note || '',
        linesText: (a.lines || []).map(function (l) { return l.name + '×' + l.qty; }).join('、')
      });
      if (a.photoPath) photos.push(a.photoPath);
    });
    (order.acceptanceIssues || []).forEach(function (a) {
      accepts.push({
        at: fmt.fullTime(a.at),
        by: a.byName || a.by,
        supplier: a.supplier,
        batchNo: a.batchNo,
        result: '异常反馈',
        cls: 'bad',
        note: a.note || '',
        linesText: ''
      });
      if (a.photoPath) photos.push(a.photoPath);
    });
    accepts.sort(function (a, b) { return a.at < b.at ? 1 : -1; });

    const mySub = me.role === 'supplier' ? (order.supplierRecords || {})[me.supplier] : null;
    const canApprove = perm.can(me, 'approve') &&
      domain.pendingApprovals(state, me).some(function (o) { return o.id === id; });
    const records = Object.keys(order.supplierRecords || {}).map(function (k) { return order.supplierRecords[k]; });
    const stalled = ['supplier', 'preparing'].indexOf(order.status) >= 0 && records.length > 0 && records.every(function (r) {
      return r && !r.delivered && !(r.deliveries && r.deliveries.length) && ['pending', 'issue', 'confirmed'].indexOf(r.status) >= 0;
    });

    const actions = {
      canApprove: canApprove,
      approveStageText: canApprove ? fmt.statusLabel(order.status) : '',
      canAck: !!(mySub && mySub.status === 'pending' && ['cancelled', 'rejected'].indexOf(order.status) < 0 &&
        ['order-review', 'budget-region', 'budget-central', 'amount-approval', 'dept-approval'].indexOf(order.status) < 0),
      canDeliver: !!(mySub && mySub.status === 'confirmed'),
      canClose: me.role === 'central' && stalled,
      canAccept: this.acceptable(order, me) && ['delivering', 'delivered', 'partial'].indexOf(order.status) >= 0,
      canReorder: perm.can(me, 'order.create'),
      // 结算共同确认：门店/部门提交金额，供应商确认或提异议
      canSettle: !!domain.settleActorOf(order, me) && ['settle-pending', 'settle-disputed'].indexOf(order.status) >= 0,
      canSettleConfirm: me.role === 'supplier' && order.status === 'settle-supplier' && !!mySub,
      settleText: order.status === 'settle-pending' ? '门店确认结算金额'
        : order.status === 'settle-supplier' ? '待供应商确认结算'
          : order.status === 'settle-disputed' ? '供应商提出异议，待门店重提'
            : ''
    };

    const settle = order.settlement ? {
      status: order.settlement.status,
      amountText: fmt.money(order.settlement.amount),
      itemsAmountText: fmt.money(order.settlement.itemsAmount),
      diff: Number(order.settlement.diff || 0),
      diffText: fmt.money(Math.abs(Number(order.settlement.diff || 0))),
      hasDiff: Math.abs(Number(order.settlement.diff || 0)) > 0.004,
      reason: order.settlement.reason || '',
      byName: order.settlement.byName || '',
      submittedAt: order.settlement.submittedAt ? fmt.fullTime(order.settlement.submittedAt) : '',
      confirmedAt: order.settlement.confirmedAt ? fmt.fullTime(order.settlement.confirmedAt) : '',
      round: order.settlement.round || 1,
      disputes: (order.settlement.disputes || []).map(function (d) {
        return { by: d.supplier || d.by, reason: d.reason, at: fmt.fullTime(d.at) };
      }),
      statusText: order.settlement.status === 'pending-supplier' ? '待供应商确认'
        : order.settlement.status === 'confirmed' ? '双方已确认'
          : order.settlement.status === 'disputed' ? '供应商已提异议' : '待门店提交'
    } : null;

    this.setData({
      me: me,
      order: {
        id: order.id,
        statusLabel: fmt.statusLabel(order.status),
        statusCls: fmt.statusCls(order.status),
        totalText: fmt.money(order.total),
        ownerText: order.purchaseType === 'department' ? ('部门采购 · ' + order.department + ' → ' + order.store) : order.store,
        typeText: order.purchaseType === 'department' ? '职能部门采购（运营管理部确认）' : '门店采购',
        tierText: fmt.TIER_LABEL[order.tier] || '部门采购',
        manager: order.manager,
        created: order.created,
        address: order.address,
        receiver: order.receiver,
        purpose: order.purpose,
        due: order.due,
        note: order.note,
        zone: order.zone,
        groupId: order.groupId || '',
        overPending: !!order.overPending,
        overAmountText: fmt.money(order.overAmount || 0),
        budgetTransfer: order.budgetTransfer || 0,
        closeReason: order.closeReason || ''
      },
      items: items,
      timeline: timeline,
      suppliers: suppliers,
      deliveries: deliveries,
      accepts: accepts,
      photos: photos,
      actions: actions,
      settlement: settle,
      slaText: sla && sla.level !== 'normal'
        ? (sla.kind === 'approval' ? '审批' : '供应商接单') + '已等待 ' + fmt.hoursText(sla.hours) + '，限时 ' + sla.limit + ' 小时'
        : '',
      slaLevel: sla ? sla.level : 'normal'
    });
  },

  previewPhoto(e) {
    const path = e.currentTarget.dataset.path;
    wx.previewImage({ current: path, urls: this.data.photos });
  },

  // 一眼能看到的单号/运单号，点一下就能复制，方便电话或群里核对
  copyText(e) {
    const text = String(e.currentTarget.dataset.text || '');
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: function () { wx.showToast({ title: '已复制 ' + text, icon: 'none' }); }
    });
  },

  // 供应商长期不接单时，由运营管理部关闭并释放预算占用
  closeStalled() {
    const that = this;
    const order = this.data.order;
    wx.showModal({
      title: '关闭订单 ' + order.id,
      content: '供应商尚未接单。关闭后订单结束，占用金额自动释放，且不可恢复。可填写关闭原因（选填）。',
      editable: true,
      placeholderText: '如：供应商缺货，改为线下采购',
      confirmText: '关闭',
      confirmColor: '#c0392b',
      success: function (res) {
        if (!res.confirm) return;
        try {
          const state = store.loadState();
          const result = domain.closeOrder(state, that.data.me, { orderId: order.id, reason: res.content });
          store.saveState(state);
          store.appendAudit([result.audit]);
          wx.showToast({ title: '订单已关闭', icon: 'success' });
          that.refresh();
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      }
    });
  },

  approve(e) {
    const pass = e.currentTarget.dataset.pass === '1';
    const that = this;
    const me = this.data.me;
    const order = this.data.order;
    wx.showModal({
      title: pass ? '审批通过' : '审批驳回',
      content: (order.id + ' · ' + order.approveStageText || '') + (pass ? '\n通过后按流程流转到下一节点。' : '\n驳回后订单结束，不会发送供应商。'),
      confirmColor: pass ? '#2966a5' : '#c0392b',
      success: function (res) {
        if (!res.confirm) return;
        try {
          const state = store.loadState();
          const raw = state.orders.filter(function (o) { return o.id === order.id; })[0];
          const result = domain.approveOrder(state, me, { orderId: order.id, stage: raw.status, pass: pass });
          store.saveState(state);
          store.appendAudit([result.audit]);
          wx.showToast({ title: pass ? '已通过' : '已驳回', icon: 'success' });
          that.refresh();
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      }
    });
  },

  ack(e) {
    const action = e.currentTarget.dataset.action;
    const that = this;
    const me = this.data.me;
    const order = this.data.order;

    if (action === 'confirm') {
      wx.showModal({
        title: '确认接单',
        content: '确认承接 ' + order.id + ' 的供货？确认后需选择配送方式发出货物。',
        success: function (res) {
          if (!res.confirm) return;
          try {
            const state = store.loadState();
            const result = domain.supplierAck(state, me, { orderId: order.id, action: 'confirm' });
            store.saveState(state);
            store.appendAudit([result.audit]);
            wx.showToast({ title: '已接单', icon: 'success' });
            that.refresh();
          } catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
          }
        }
      });
    } else {
      wx.showModal({
        title: '无法接单',
        editable: true,
        placeholderText: '请填写无法接单原因（2-300字）',
        success: function (res) {
          if (!res.confirm) return;
          try {
            const state = store.loadState();
            const result = domain.supplierAck(state, me, { orderId: order.id, action: 'issue', reason: res.content });
            store.saveState(state);
            store.appendAudit([result.audit]);
            wx.showToast({ title: '已反馈', icon: 'success' });
            that.refresh();
          } catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
          }
        }
      });
    }
  },

  goDeliver() {
    wx.navigateTo({ url: '/pages/supplier/supplier?orderId=' + this.data.order.id });
  },

  goAccept() {
    wx.navigateTo({ url: '/pages/accept/accept?orderId=' + this.data.order.id });
  },

  goSettle() {
    wx.navigateTo({ url: '/pages/settle/settle?id=' + this.data.order.id });
  },

  reorder() {
    const state = store.loadState();
    const order = state.orders.filter(function (o) { return o.id === this.data.order.id; }.bind(this))[0];
    if (!order) return;
    const me = this.data.me;
    const items = {};
    (order.items || []).forEach(function (x) { items[x.id] = x.qty; });
    store.saveCart({
      ownerId: me.id,
      context: order.purchaseType === 'department' ? me.department : order.store,
      items: items,
      updatedAt: new Date().toISOString()
    });
    wx.showToast({ title: '已加入购物车', icon: 'none' });
    setTimeout(function () { wx.reLaunch({ url: '/pages/catalog/catalog' }); }, 700);
  }
});
