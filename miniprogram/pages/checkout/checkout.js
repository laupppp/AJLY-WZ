const share = require('../../utils/share');
const store = require('../../utils/store');
const session = require('../../utils/session');
const domain = require('../../utils/domain');
const perm = require('../../utils/perm');
const fmt = require('../../utils/format');
const { CATALOG, STORES } = require('../../data/catalog');

const PRODUCT_MAP = {};
CATALOG.forEach(function (p) { PRODUCT_MAP[p.id] = p; });

function pad(n) { return n < 10 ? '0' + n : '' + n; }

Page({
  onShareAppMessage: share.handler,
  data: {
    mode: 'store',
    me: null,
    items: [],
    totalText: '0.00',
    quote: null,
    quoteItems: [],
    // 门店表单
    storeName: '',
    address: '',
    receiver: '',
    purpose: '门店日常运营',
    due: '',
    note: '',
    multiContract: false,
    splitByContract: true,
    // 部门表单
    deptName: '',
    destDraftType: 'office',
    destViews: [],
    stores: STORES,
    submitting: false
  },

  onLoad(query) {
    const input = wx.getStorageSync('anju_checkout_input');
    if (!input || !input.items || !input.items.length) {
      wx.showToast({ title: '没有待结算商品', icon: 'none' });
      setTimeout(function () { wx.navigateBack(); }, 900);
      return;
    }
    this.input = input;
    const mode = (query && query.mode) || input.mode || 'store';
    const me = session.current();
    // 结算数据属于下单时的身份，切换身份后不应继续用别人的购物车
    if (input.ownerId && me && input.ownerId !== me.id) {
      wx.showToast({ title: '身份已切换，请重新选择商品', icon: 'none' });
      setTimeout(function () { wx.navigateBack(); }, 900);
      return;
    }

    const catMap = domain.catalogMapOf(store.loadState());
    const items = input.items.map(function (line) {
      const p = catMap[line.id] || PRODUCT_MAP[line.id];
      return {
        id: line.id,
        name: p ? p.name : line.id,
        spec: p ? p.spec : '',
        unit: p ? p.unit : '个',
        price: p ? p.price : 0,
        supplier: p ? (p.supplier || '') : '',
        qty: line.qty
      };
    });

    const supMap = {};
    items.forEach(function (x) { if (x.supplier) supMap[x.supplier] = 1; });
    const multiContract = Object.keys(supMap).length > 1;

    const amountCents = items.reduce(function (sum, x) { return sum + Math.round(x.price * 100) * x.qty; }, 0);

    if (mode === 'department') {
      const dests = [{
        type: 'office',
        name: '公司总部',
        address: '公司总部 · 前台',
        receiver: me.name,
        lines: items.map(function (x) { return { id: x.id, qty: x.qty }; })
      }];
      this.setData({
        mode: mode,
        me: me,
        items: items,
        deptName: me.department,
        totalText: fmt.money2(amountCents / 100),
        dests: dests
      });
      this.refreshDestViews();
    } else {
      const today = new Date();
      const due = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate() + 7);
      this.setData({
        mode: 'store',
        me: me,
        items: items,
        storeName: input.contextName,
        address: input.contextName + ' 前台',
        receiver: (me && me.name) || '门店收货人',
        due: due,
        totalText: fmt.money2(amountCents / 100),
        dests: [],
        multiContract: multiContract
      });
      this.simulate();
    }
  },

  /* ---------- 门店试算 ---------- */
  simulate() {
    const state = store.loadState();
    try {
      const quote = domain.computeQuote(state, {
        store: this.data.storeName,
        items: this.data.items.map(function (x) { return { id: x.id, qty: x.qty }; })
      });
      const quoteItems = (quote.budgetItems || []).map(function (r) {
        return {
          key: r.key,
          name: r.name,
          totalText: fmt.money(r.total),
          usableText: fmt.money(r.usable),
          overText: fmt.money(r.over),
          over: r.over > 0,
          pct: r.budget > 0 ? Math.min(100, Math.round(r.total / r.budget * 100)) : 0
        };
      });
      this.setData({ quote: quote, quoteItems: quoteItems, totalText: fmt.money2(quote.total) });
    } catch (e) {
      this.setData({ quote: null, quoteItems: [] });
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  onField(e) {
    const key = e.currentTarget.dataset.key;
    const patch = {};
    patch[key] = e.detail.value;
    this.setData(patch);
  },

  onDue(e) {
    this.setData({ due: e.detail.value });
  },

  toggleSplitContract(e) {
    this.setData({ splitByContract: !!e.detail.value });
  },

  /* ---------- 部门配送地点 ---------- */
  refreshDestViews() {
    const items = this.data.items;
    const dests = this.data.dests || [];
    const views = dests.map(function (d, di) {
      let totalCents = 0;
      const rows = items.map(function (it) {
        let other = 0;
        dests.forEach(function (x, i) {
          if (i === di) return;
          const line = x.lines.filter(function (l) { return l.id === it.id; })[0];
          if (line) other += line.qty;
        });
        const own = d.lines.filter(function (l) { return l.id === it.id; })[0];
        const qty = own ? own.qty : 0;
        totalCents += Math.round(it.price * 100) * qty;
        return { id: it.id, name: it.name, unit: it.unit, qty: qty, cap: it.qty - other };
      });
      return {
        key: di + ':' + (d.type || '') + ':' + (d.name || ''),
        index: di,
        type: d.type,
        name: d.name,
        address: d.address,
        receiver: d.receiver,
        rows: rows,
        totalText: fmt.money2(totalCents / 100)
      };
    });
    this.setData({ destViews: views });
  },

  onDestField(e) {
    const index = Number(e.currentTarget.dataset.index);
    const key = e.currentTarget.dataset.key;
    const dests = this.data.dests;
    dests[index][key] = e.detail.value;
    this.setData({ dests: dests });
    this.refreshDestViews();
  },

  addStoreDest(e) {
    const index = Number(e.detail.value);
    const name = STORES[index];
    const dests = this.data.dests || [];
    if (dests.some(function (d) { return d.type === 'store' && d.name === name; })) {
      wx.showToast({ title: '该门店已添加', icon: 'none' });
      return;
    }
    if (dests.length >= 20) {
      wx.showToast({ title: '最多 20 个配送地点', icon: 'none' });
      return;
    }
    dests.push({ type: 'store', name: name, address: name + ' · 前台（演示）', receiver: '门店授权收货人', lines: [] });
    this.setData({ dests: dests });
    this.refreshDestViews();
  },

  addOfficeDest() {
    const dests = this.data.dests || [];
    if (dests.some(function (d) { return d.type === 'office'; })) {
      wx.showToast({ title: '总部配送点已存在', icon: 'none' });
      return;
    }
    dests.unshift({ type: 'office', name: '公司总部', address: '公司总部 · 前台（演示）', receiver: this.data.me.name, lines: [] });
    this.setData({ dests: dests });
    this.refreshDestViews();
  },

  removeDest(e) {
    const index = Number(e.currentTarget.dataset.index);
    const dests = this.data.dests;
    if (dests.length <= 1) {
      wx.showToast({ title: '至少保留一个配送地点', icon: 'none' });
      return;
    }
    dests.splice(index, 1);
    this.setData({ dests: dests });
    this.refreshDestViews();
  },

  changeAlloc(e) {
    const di = Number(e.currentTarget.dataset.dest);
    const id = e.currentTarget.dataset.id;
    const delta = Number(e.currentTarget.dataset.delta);
    const dests = this.data.dests;
    const dest = dests[di];
    const item = this.data.items.filter(function (x) { return x.id === id; })[0];
    let other = 0;
    dests.forEach(function (x, i) {
      if (i === di) return;
      const line = x.lines.filter(function (l) { return l.id === id; })[0];
      if (line) other += line.qty;
    });
    let line = dest.lines.filter(function (l) { return l.id === id; })[0];
    const current = line ? line.qty : 0;
    const next = current + delta;
    if (next < 0) return;
    if (next > item.qty - other) {
      wx.showToast({ title: '超出可分配数量', icon: 'none' });
      return;
    }
    if (!line) {
      line = { id: id, qty: 0 };
      dest.lines.push(line);
    }
    line.qty = next;
    if (next === 0) dest.lines = dest.lines.filter(function (l) { return l.qty > 0; });
    this.setData({ dests: dests });
    this.refreshDestViews();
  },

  /* ---------- 提交 ---------- */
  submit() {
    if (this.data.submitting) return;
    if (this.data.mode === 'store') this.submitStore();
    else this.submitDepartment();
  },

  submitStore() {
    const me = this.data.me;
    if (!me || me.role !== 'store') {
      wx.showToast({ title: '请切换为门店店长身份', icon: 'none' });
      return;
    }
    if (!this.data.address || !this.data.receiver) {
      wx.showToast({ title: '请填写收货地址与收货人', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      const state = store.loadState();
      const result = domain.createStoreOrder(state, me, {
        store: this.data.storeName,
        items: this.data.items.map(function (x) { return { id: x.id, qty: x.qty }; }),
        splitByContract: this.data.splitByContract,
        details: {
          address: this.data.address,
          receiver: this.data.receiver,
          purpose: this.data.purpose,
          due: this.data.due,
          note: this.data.note
        }
      });
      store.saveState(state);
      store.clearCart();
      wx.removeStorageSync('anju_checkout_input');
      const created = (result.orders && result.orders.length) ? result.orders : [result.order];
      const order = created[0];
      const nextText = created.length > 1
        ? '已按框架合同自动拆分为 ' + created.length + ' 笔独立订单（' + created.map(function (o) { return o.id; }).join('、') + '）'
        : (order.status === 'supplier' ? '已直接发送供应商待接单'
          : order.status === 'budget-region' ? '超出预算，进入战区预算审批'
            : '进入' + fmt.statusLabel(order.status));
      wx.showModal({
        title: '提交成功',
        content: created.length > 1
          ? nextText + '。'
          : ('订单 ' + order.id + '，合计 ¥' + fmt.money(order.total) + '。\n' + nextText + '。'),
        showCancel: false,
        success: function () {
          wx.reLaunch({ url: '/pages/orders/orders' });
        }
      });
    } catch (e) {
      this.setData({ submitting: false });
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  submitDepartment() {
    const me = this.data.me;
    if (!me || !perm.isDepartmentFlow(me)) {
      wx.showToast({ title: '请切换为职能部门或运营管理部身份', icon: 'none' });
      return;
    }
    const dests = this.data.dests || [];
    for (let i = 0; i < dests.length; i++) {
      const d = dests[i];
      if (!d.address || !d.receiver) {
        wx.showToast({ title: '请填写「' + d.name + '」的地址与收货人', icon: 'none' });
        return;
      }
      if (!d.lines.length) {
        wx.showToast({ title: '「' + d.name + '」还没有分配商品', icon: 'none' });
        return;
      }
    }
    // 全部商品必须分配完毕
    const short = [];
    this.data.items.forEach(function (it) {
      let sum = 0;
      dests.forEach(function (d) {
        d.lines.forEach(function (l) { if (l.id === it.id) sum += l.qty; });
      });
      if (sum !== it.qty) short.push(it.name + '（未分配 ' + (it.qty - sum) + '）');
    });
    if (short.length) {
      wx.showModal({ title: '商品未分配完', content: short.join('、'), showCancel: false });
      return;
    }

    this.setData({ submitting: true });
    try {
      const state = store.loadState();
      const result = domain.createDepartmentOrders(state, me, {
        purpose: this.data.purpose,
        note: this.data.note,
        destinations: dests.map(function (d) {
          return {
            type: d.type, name: d.name, address: d.address, receiver: d.receiver,
            items: d.lines.map(function (l) { return { id: l.id, qty: l.qty }; })
          };
        })
      });
      store.saveState(state);
      store.clearCart();
      wx.removeStorageSync('anju_checkout_input');
      wx.showModal({
        title: me.role === 'central' ? '自采单已提交' : '部门采购已提交',
        content: '批次 ' + result.groupId + '\n共 ' + result.orders.length + ' 个配送子订单，合计 ¥' + fmt.money(result.total) + '，' +
          (me.role === 'central' ? '自采无需再确认，已直接发送供应商待接单。' : '待运营管理部统一确认。'),
        showCancel: false,
        success: function () {
          wx.reLaunch({ url: '/pages/orders/orders' });
        }
      });
    } catch (e) {
      this.setData({ submitting: false });
      wx.showToast({ title: e.message, icon: 'none' });
    }
  }
});
