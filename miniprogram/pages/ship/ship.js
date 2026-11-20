const share = require('../../utils/share');
const store = require('../../utils/store');
const session = require('../../utils/session');
const domain = require('../../utils/domain');

function todayText() {
  const d = new Date();
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  return d.getFullYear() + '-' + (mm < 10 ? '0' + mm : mm) + '-' + (dd < 10 ? '0' + dd : dd);
}

Page({
  onShareAppMessage: share.handler,
  data: {
    orderId: '',
    order: null,
    items: [],
    methods: [
      { key: 'express', label: '快递', desc: '填快递公司与运单号' },
      { key: 'lalamove', label: '同城货运', desc: '货拉拉等，填平台单号' },
      { key: 'runner', label: '同城跑腿', desc: '闪送等，填平台单号' },
      { key: 'self', label: '自行配送', desc: '填配送安排 / 联系人' }
    ],
    method: 'express',
    methodLabel: '快递',
    carrier: '',
    trackingNo: '',
    contact: '',
    estimatedAt: '',
    // 首帧就要有值：picker 的 start 若初始为空，部分机型会允许选到发货前的日期
    today: todayText(),
    note: '',
    batchNo: 1,
    totalQty: 0,
    filledText: '',
    typing: false,
    submitting: false
  },

  onLoad(query) {
    const orderId = (query && query.orderId) || '';
    this.setData({ orderId: orderId, today: todayText() });
    this.load(orderId);
  },

  load(orderId) {
    const state = store.loadState();
    const me = session.current();
    const order = (state.orders || []).filter(function (o) { return o.id === orderId; })[0];
    if (!order || me.role !== 'supplier') {
      wx.showToast({ title: '无法登记发货', icon: 'none' });
      return;
    }
    const sub = (order.supplierRecords || {})[me.supplier];
    const own = (order.items || []).filter(function (x) { return x.supplier === me.supplier; });
    const items = own.map(function (x) {
      const remaining = x.qty - Number(x.deliveredQty || 0);
      return {
        id: x.id,
        name: x.name,
        unit: x.unit || '',
        qty: x.qty,
        delivered: Number(x.deliveredQty || 0),
        remaining: remaining,
        thisQty: remaining
      };
    });
    const totalQty = items.reduce(function (sum, x) { return sum + x.thisQty; }, 0);

    this.setData({
      order: {
        id: order.id,
        store: order.purchaseType === 'department' ? (order.department + ' → ' + order.store) : order.store,
        address: order.address,
        receiver: order.receiver,
        due: order.due
      },
      items: items,
      totalQty: totalQty,
      batchNo: (sub && sub.deliveries ? sub.deliveries.length : 0) + 1,
      carrier: '',
      trackingNo: '',
      contact: '',
      estimatedAt: '',
      note: '',
      filledText: ''
    });
  },

  changeQty(e) {
    const id = e.currentTarget.dataset.id;
    const delta = Number(e.currentTarget.dataset.delta);
    const items = this.data.items;
    const item = items.filter(function (x) { return x.id === id; })[0];
    if (!item) return;
    const next = item.thisQty + delta;
    if (next < 0 || next > item.remaining) {
      wx.showToast({ title: '数量需在 0 到剩余可交付之间', icon: 'none' });
      return;
    }
    item.thisQty = next;
    this.setData({ items: items, totalQty: items.reduce(function (s, x) { return s + x.thisQty; }, 0) });
  },

  fillAll() {
    const items = this.data.items;
    items.forEach(function (x) { x.thisQty = x.remaining; });
    this.setData({ items: items, totalQty: items.reduce(function (s, x) { return s + x.thisQty; }, 0) });
  },

  pickMethod(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.method) return;
    // 切换方式时清掉与该方式无关的字段，避免把上一方式的快递公司/单号一起提交
    const patch = { method: key };
    if (key === 'self') { patch.carrier = ''; patch.trackingNo = ''; }
    else if (key === 'express') { patch.contact = ''; }
    else { patch.carrier = ''; patch.contact = ''; }
    this.setData(Object.assign(patch, this.summary(Object.assign({}, this.data, patch))));
  },

  // 已填写内容摘要：输入框被键盘/底部栏遮挡时，也能确认"填进去了什么"
  summary(view) {
    const method = view.method;
    const meta = this.data.methods.filter(function (x) { return x.key === method; })[0];
    const parts = [];
    if (method === 'express' && view.carrier) parts.push(view.carrier);
    if (method !== 'self' && view.trackingNo) parts.push('单号 ' + view.trackingNo);
    if (method === 'self' && view.contact) parts.push(view.contact);
    if (view.estimatedAt) parts.push(view.estimatedAt + ' 到达');
    return { methodLabel: meta ? meta.label : '', filledText: parts.join(' · ') };
  },

  onField(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const patch = {};
    patch[key] = e.detail.value;
    this.setData(Object.assign(patch, this.summary(Object.assign({}, this.data, patch))));
  },

  onFocus() { if (!this.data.typing) this.setData({ typing: true }); },
  onBlur() { if (this.data.typing) this.setData({ typing: false }); },

  onDate(e) {
    const value = e.detail.value;
    const today = this.data.today || todayText();
    // 预计到达不应早于发货当天，兜底拦住 picker 未生效的情况
    if (value < today) {
      wx.showToast({ title: '预计到达不能早于今天（' + today + '）', icon: 'none' });
      return;
    }
    this.setData(Object.assign({ estimatedAt: value }, this.summary(Object.assign({}, this.data, { estimatedAt: value }))));
  },

  clearDate() {
    this.setData(Object.assign({ estimatedAt: '' }, this.summary(Object.assign({}, this.data, { estimatedAt: '' }))));
  },

  submit() {
    if (this.data.submitting) return;
    const lines = this.data.items
      .filter(function (x) { return x.thisQty > 0; })
      .map(function (x) { return { id: x.id, qty: x.thisQty }; });
    if (!lines.length) {
      wx.showToast({ title: '请至少填写一个商品的本次交付数量', icon: 'none' });
      return;
    }
    // 页内先校验，提示更直接，不必等提交后才报错
    const method = this.data.method;
    const carrier = String(this.data.carrier || '').trim();
    const trackingNo = String(this.data.trackingNo || '').trim();
    const contact = String(this.data.contact || '').trim();
    if (method === 'express' && (!carrier || !trackingNo)) {
      wx.showToast({ title: '请填写快递公司与运单号', icon: 'none' });
      return;
    }
    if ((method === 'lalamove' || method === 'runner') && !trackingNo) {
      wx.showToast({ title: '请填写平台订单号', icon: 'none' });
      return;
    }
    if (method === 'self' && !contact) {
      wx.showToast({ title: '请填写配送安排或联系人', icon: 'none' });
      return;
    }
    if (trackingNo && !/^[0-9A-Za-z_-]{4,100}$/.test(trackingNo)) {
      wx.showToast({ title: '单号至少 4 位字母或数字', icon: 'none' });
      return;
    }
    if (this.data.estimatedAt && this.data.estimatedAt < (this.data.today || todayText())) {
      wx.showToast({ title: '预计到达不能早于发货当天', icon: 'none' });
      return;
    }

    this.setData({ submitting: true, typing: false });
    try {
      const state = store.loadState();
      const result = domain.supplierDeliver(state, session.current(), {
        orderId: this.data.orderId,
        lines: lines,
        note: this.data.note,
        shipping: {
          method: method,
          carrier: method === 'express' ? carrier : '',
          trackingNo: method === 'self' ? '' : trackingNo,
          contact: method === 'self' ? contact : '',
          estimatedAt: this.data.estimatedAt
        }
      });
      store.saveState(state);
      store.appendAudit([result.audit]);
      const msg = result.supplierComplete
        ? '第 ' + result.batchNo + ' 批已登记，货已全部发出，订单进入配送中，等待门店验收。'
        : '第 ' + result.batchNo + ' 批已登记，订单处于配送中，剩余商品可继续登记发货。';
      wx.showModal({
        title: '发货登记成功',
        content: msg,
        showCancel: false,
        success: function () {
          // 回到供应商工作台时直接停在「配送中」页签，避免停在已空的「待发货」造成误解
          if (typeof getCurrentPages === 'function') {
            const pages = getCurrentPages();
            const prev = pages.length > 1 ? pages[pages.length - 2] : null;
            if (prev && prev.route && prev.route.indexOf('pages/supplier/supplier') >= 0 && prev.setData) {
              prev.setData({ active: 'shipping' });
            }
          }
          wx.navigateBack();
        }
      });
    } catch (e) {
      this.setData({ submitting: false });
      wx.showModal({
        title: '登记发货失败',
        content: (e && e.message ? e.message : '操作失败') + '\n\n如仍无法提交，请退出本页重新进入再试。',
        showCancel: false
      });
    }
  }
});
