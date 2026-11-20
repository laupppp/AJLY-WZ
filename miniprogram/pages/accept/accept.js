const share = require('../../utils/share');
const store = require('../../utils/store');
const session = require('../../utils/session');
const domain = require('../../utils/domain');
const perm = require('../../utils/perm');
const fmt = require('../../utils/format');

// 验收权限口径统一由业务层提供，避免首页/验收页判断不一致
function canAcceptOrder(order, me) {
  return domain.canAcceptOrder(order, me);
}

Page({
  onShareAppMessage: share.handler,
  data: {
    me: null,
    denied: false,
    mode: 'list',
    orderList: [],
    orderId: '',
    order: null,
    supplierOptions: [],
    supplierIndex: 0,
    batchOptions: [],
    batchIndex: 0,
    items: [],
    needInstall: false,
    result: 'pass',
    specChecked: false,
    installChecked: false,
    note: '',
    photoPath: '',
    photoUnavailable: false,
    allowNoPhoto: false,
    submitting: false
  },

  onLoad(query) {
    this.presetId = (query && query.orderId) || '';
  },

  onShow() {
    const me = session.current();
    if (!perm.can(me, 'accept')) {
      this.setData({ me: me, denied: true, mode: 'list', orderList: [] });
      return;
    }
    this.setData({ me: me, denied: false });
    if (this.presetId) {
      const id = this.presetId;
      this.presetId = '';
      this.openOrder(id);
    } else {
      this.loadList();
    }
  },

  loadList() {
    const state = store.loadState();
    const me = session.current();
    const list = domain.visibleOrders(state, me).filter(function (o) {
      return ['delivered', 'partial', 'delivering'].indexOf(o.status) >= 0 && canAcceptOrder(o, me);
    }).map(function (o) {
      const pendingBatches = this.countPendingBatches(o, me);
      return {
        id: o.id,
        store: o.purchaseType === 'department' ? (o.department + ' → ' + o.store) : o.store,
        statusLabel: o.status === 'delivering' ? '在途待验收' : fmt.statusLabel(o.status),
        statusCls: fmt.statusCls(o.status),
        totalText: fmt.money(o.total),
        itemCount: (o.items || []).length,
        pending: pendingBatches,
        canAccept: pendingBatches > 0
      };
    }.bind(this)).filter(function (x) { return x.pending > 0; });

    this.setData({ mode: 'list', orderList: list, orderId: '' });
  },

  countPendingBatches(order, me) {
    let count = 0;
    Object.keys(order.supplierRecords || {}).forEach(function (name) {
      const rec = order.supplierRecords[name];
      (rec.deliveries || []).forEach(function (d) {
        try {
          const avail = domain.batchAvailability(order, name, d.batchNo);
          const any = Object.keys(avail.remaining).some(function (k) { return avail.remaining[k] > 0; });
          if (any) count += 1;
        } catch (e) { /* ignore */ }
      });
    });
    return count;
  },

  openOrder(id) {
    const state = store.loadState();
    const me = session.current();
    const order = (state.orders || []).filter(function (o) { return o.id === id; })[0];
    if (!order) {
      wx.showToast({ title: '订单不存在', icon: 'none' });
      this.loadList();
      return;
    }
    if (!canAcceptOrder(order, me)) {
      wx.showToast({ title: '该订单不在你的验收范围内', icon: 'none' });
      this.loadList();
      return;
    }

    const supplierOptions = [];
    Object.keys(order.supplierRecords || {}).forEach(function (name) {
      const rec = order.supplierRecords[name];
      if (rec.deliveries && rec.deliveries.length) {
        const batches = [];
        rec.deliveries.forEach(function (d) {
          batches.push({ batchNo: d.batchNo, label: '第 ' + d.batchNo + ' 批 · ' + (d.lines || []).length + ' 项 · ' + fmt.shortTime(d.at) });
        });
        supplierOptions.push({ name: name, batches: batches });
      }
    });

    if (!supplierOptions.length) {
      wx.showToast({ title: '该订单暂无配送批次', icon: 'none' });
      this.loadList();
      return;
    }

    this.setData({
      mode: 'form',
      orderId: id,
      order: {
        id: order.id,
        store: order.purchaseType === 'department' ? (order.department + ' → ' + order.store) : order.store,
        statusLabel: fmt.statusLabel(order.status),
        statusCls: fmt.statusCls(order.status),
        totalText: fmt.money(order.total),
        address: order.address,
        receiver: order.receiver
      },
      supplierOptions: supplierOptions,
      supplierIndex: 0,
      batchIndex: 0,
      batchOptions: supplierOptions[0].batches,
      result: 'pass',
      specChecked: false,
      installChecked: false,
      note: '',
      photoPath: '',
      photoUnavailable: false,
      allowNoPhoto: false
    });
    this.loadBatch();
  },

  loadBatch() {
    const state = store.loadState();
    const orderId = this.data.orderId;
    const order = (state.orders || []).filter(function (o) { return o.id === orderId; })[0];
    if (!order) return;
    const sp = this.data.supplierOptions[this.data.supplierIndex];
    const batch = sp.batches[this.data.batchIndex];
    if (!batch) return;

    let avail;
    try {
      avail = domain.batchAvailability(order, sp.name, batch.batchNo);
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      return;
    }

    const items = [];
    let needInstall = false;
    Object.keys(avail.remaining).forEach(function (id) {
      const remaining = avail.remaining[id];
      if (remaining <= 0) return;
      const item = order.items.filter(function (x) { return x.id === id; })[0];
      if (!item) return;
      if (domain.INSTALL_REQUIRED.indexOf(id) >= 0) needInstall = true;
      items.push({
        id: id,
        name: item.name,
        spec: item.spec || '',
        unit: item.unit || '',
        remaining: remaining,
        thisQty: remaining
      });
    });

    this.setData({ items: items, needInstall: needInstall, supplierName: sp.name, batchLabel: batch.label });
  },

  onSupplier(e) {
    const index = Number(e.detail.value);
    this.setData({
      supplierIndex: index,
      batchIndex: 0,
      batchOptions: this.data.supplierOptions[index].batches
    });
    this.loadBatch();
  },

  onBatch(e) {
    this.setData({ batchIndex: Number(e.detail.value) });
    this.loadBatch();
  },

  onQty(e) {
    const id = e.currentTarget.dataset.id;
    const delta = Number(e.currentTarget.dataset.delta);
    const items = this.data.items;
    const item = items.filter(function (x) { return x.id === id; })[0];
    if (!item) return;
    const next = item.thisQty + delta;
    if (next < 0 || next > item.remaining) {
      wx.showToast({ title: '数量需在 0 到 ' + item.remaining + ' 之间', icon: 'none' });
      return;
    }
    item.thisQty = next;
    this.setData({ items: items });
  },

  setResult(e) {
    this.setData({ result: e.currentTarget.dataset.value });
  },

  toggleSpec() {
    this.setData({ specChecked: !this.data.specChecked });
  },

  toggleInstall() {
    this.setData({ installChecked: !this.data.installChecked });
  },

  onNote(e) {
    this.setData({ note: e.detail.value });
  },

  choosePhoto() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: function (res) {
        const temp = res.tempFiles[0].tempFilePath;
        wx.compressImage({
          src: temp,
          quality: 60,
          success: function (r) { that.setData({ photoPath: r.tempFilePath }); },
          fail: function () { that.setData({ photoPath: temp }); }
        });
      },
      fail: function (err) {
        const msg = (err && (err.errMsg || err.message)) || '';
        if (msg.indexOf('cancel') >= 0) return;
        that.setData({ photoUnavailable: true });
        if (msg.indexOf('auth deny') >= 0 || msg.indexOf('authorize') >= 0) {
          wx.showModal({
            title: '没有相机/相册权限',
            content: '可在微信设置里允许访问后重新拍摄；演示阶段也可以先不附照片，直接登记验收结果。',
            confirmText: '去设置',
            cancelText: '暂不设置',
            success: function (r) { if (r.confirm) wx.openSetting({}); }
          });
          return;
        }
        wx.showToast({ title: '没能获取照片，可重试或先不附照片', icon: 'none' });
      }
    });
  },

  previewPhoto() {
    if (!this.data.photoPath) return;
    wx.previewImage({ urls: [this.data.photoPath] });
  },

  removePhoto() {
    this.setData({ photoPath: '' });
  },

  back() {
    this.loadList();
  },

  submit() {
    if (this.data.submitting) return;
    const sp = this.data.supplierOptions[this.data.supplierIndex];
    const batch = sp && sp.batches[this.data.batchIndex];
    if (!sp || !batch) {
      wx.showToast({ title: '请选择配送批次', icon: 'none' });
      return;
    }
    if (!this.data.photoPath && !this.data.allowNoPhoto) {
      if (this.data.photoUnavailable) {
        const that = this;
        wx.showModal({
          title: '本次未附验收照片',
          content: '当前环境没能获得相机或相册授权。演示阶段可以先不附照片直接登记，正式小程序配置隐私授权后照片留证正常使用。',
          confirmText: '继续登记',
          cancelText: '再试一次',
          success: function (r) {
            if (!r.confirm) return;
            that.setData({ allowNoPhoto: true });
            that.submit();
          }
        });
        return;
      }
      wx.showToast({ title: '请拍摄或上传现场验收照片', icon: 'none' });
      return;
    }
    const lines = this.data.items
      .filter(function (x) { return x.thisQty > 0; })
      .map(function (x) { return { id: x.id, qty: x.thisQty }; });
    if (this.data.result === 'pass' && !lines.length) {
      wx.showToast({ title: '请填写本次合格数量', icon: 'none' });
      return;
    }
    if (this.data.result === 'issue' && this.data.note.trim().length < 4) {
      wx.showToast({ title: '请填写至少4个字的异常情况', icon: 'none' });
      return;
    }
    if (this.data.result === 'pass' && !this.data.specChecked) {
      wx.showToast({ title: '请先勾选已核对规格、数量及外观', icon: 'none' });
      return;
    }
    if (this.data.result === 'pass' && this.data.needInstall && !this.data.installChecked) {
      wx.showToast({ title: '请确认安装类物料的完工效果', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const savedPhoto = store.savePhoto(this.data.photoPath);
      const state = store.loadState();
      const result = domain.acceptDelivery(state, this.data.me, {
        orderId: this.data.orderId,
        supplier: sp.name,
        batchNo: batch.batchNo,
        result: this.data.result,
        lines: this.data.result === 'pass' ? lines : [],
        note: this.data.note,
        specChecked: this.data.specChecked,
        installChecked: this.data.installChecked,
        photoPath: savedPhoto,
        allowNoPhoto: this.data.allowNoPhoto === true
      });
      store.saveState(state);
      store.addEvidence(result.evidence);
      store.appendAudit([result.audit]);

      // 全部验收完成 → 直接引导去填写结算金额，避免门店不知道下一步在哪
      const settleReady = result.order.status === 'settle-pending';
      const orderId = this.data.orderId;
      wx.showModal({
        title: this.data.result === 'pass'
          ? (settleReady ? '验收完成，待确认结算' : '验收合格') : '异常已上报',
        content: this.data.result === 'pass'
          ? (this.data.photoPath ? '已登记本次验收数量并留存现场照片。' : '已登记本次验收数量（本次未附照片）。') +
            (settleReady
              ? '全部物资已验收，下一步请填写实际结算金额，供应商确认后才能进入统一对账。'
              : '订单状态：' + fmt.statusLabel(result.order.status) + '。')
          : '异常情况已记录' + (this.data.photoPath ? '并留证' : '（本次未附照片）') + '，等待运营管理部协调供应商处理。',
        showCancel: false,
        success: function () {
          if (settleReady) {
            wx.redirectTo({ url: '/pages/settle/settle?id=' + orderId });
          } else {
            wx.reLaunch({ url: '/pages/accept/accept' });
          }
        }
      });
    } catch (e) {
      this.setData({ submitting: false });
      wx.showToast({ title: e.message, icon: 'none' });
    }
  }
});
