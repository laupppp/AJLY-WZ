const share = require('../../utils/share');
const { CATALOG, CATEGORY_META } = require('../../data/catalog');
const subcats = require('../../data/subcats');
const store = require('../../utils/store');
const session = require('../../utils/session');
const domain = require('../../utils/domain');
const perm = require('../../utils/perm');
const fmt = require('../../utils/format');

// 二级分类索引：商品 → 细分目录，以及左侧竖排导航树
const SUBS = subcats.build(CATALOG);

const PRODUCTS = CATALOG.map(function (p) {
  const sub = SUBS.byId[p.id];
  return {
    id: p.id,
    name: p.name,
    spec: p.spec,
    unit: p.unit,
    price: p.price,
    priceText: fmt.money2(p.price),
    supplier: p.supplier,
    category: p.category,
    sub: sub ? sub.key : '',
    subLabel: sub ? sub.label : '',
    demoOnly: p.demoOnly,
    icon: (CATEGORY_META[p.category] || { icon: '📦' }).icon,
    key: (p.name + ' ' + p.spec + ' ' + p.supplier + ' ' + p.id).toLowerCase()
  };
});

const PRODUCT_MAP = {};
PRODUCTS.forEach(function (p) { PRODUCT_MAP[p.id] = p; });

// 左侧栏宽度只有 176rpx，大类用 4 字短名，完整名称显示在右侧列表标题
const TOP_SHORT = {
  '奖品礼品': '奖品礼品',
  '活动及社群物资': '活动社群',
  '日常运营耗材': '日常耗材',
  '宣传印刷物料': '宣传印刷',
  '员工物资': '员工物资'
};

// 左侧导航：全部 + 5 个大类，每个大类带二级分类（只有 1 个二级的不再展开）
const NAV = [{
  key: 'all',
  label: '全部物资',
  short: '全部物资',
  count: PRODUCTS.length,
  subs: []
}].concat(SUBS.nav.map(function (c) {
  return {
    key: c.key,
    label: c.label,
    short: TOP_SHORT[c.label] || c.label,
    count: c.count,
    subs: c.subs.length > 1 ? c.subs.map(function (s) {
      return { key: s.key, label: s.label, short: s.short, count: s.count };
    }) : []
  };
}));


Page({
  onShareAppMessage: share.handler,
  onPullDownRefresh() {
    if (typeof this.onShow === 'function') this.onShow();
    setTimeout(function () { wx.stopPullDownRefresh(); }, 300);
  },
  data: {
    me: null,
    canBuy: false,
    isStore: false,
    isDept: false,
    stores: [],
    storeIndex: 0,
    contextName: '',
    nav: NAV,
    activeCat: 'all',
    activeSub: '',
    // 与 activeCat 解耦：决定左侧二级目录是否展开，支持点击收起
    expandedCat: '',
    catLabel: '',
    subLabel: '',
    keyword: '',
    list: [],
    shown: 40,
    hasMore: false,
    totalCount: 0,
    listTitle: '全部物资',
    listSub: '',
    refreshing: false,
    goodsTop: '',
    cart: {},
    cartLines: [],
    cartCount: 0,
    cartAmount: '0.00',
    frequent: [],
    showCart: false,
    hint: ''
  },

  onLoad(query) {
    this.initialQuery = query || {};
  },

  onShow() {
    const me = session.current();
    const state = store.loadState();
    const canBuy = perm.can(me, 'order.create');
    const isDept = perm.isDepartmentFlow(me);

    let storeIndex = this.data.storeIndex;
    // 从草稿箱恢复时可能属于另一家门店，按 URL 参数切到对应门店，否则购物车会被上下文过滤掉
    if (me.role === 'store' && this.initialQuery && this.initialQuery.store) {
      const wanted = decodeURIComponent(this.initialQuery.store);
      const idx = (me.stores || []).indexOf(wanted);
      if (idx >= 0) storeIndex = idx;
      this.initialQuery.store = '';
    }
    if (me.role === 'store' && (storeIndex >= me.stores.length)) storeIndex = 0;

    const contextName = me.role === 'store' ? (me.stores[storeIndex] || '') : (me.department || '');

    const saved = store.loadCart();
    let cart = {};
    if (saved && saved.ownerId === me.id && saved.context === contextName) {
      cart = saved.items || {};
    }

    let hint = '';
    if (!canBuy) {
      hint = '当前身份为' + perm.roleMeta(me.role).label + '，不参与采购下单；可在「我的」切换身份体验。';
    } else if (me.role === 'central') {
      hint = '运营管理部自采：按配送地点拆分为子订单，提交后直接发送供应商接单。';
    } else if (me.role === 'department') {
      hint = '部门采购按配送地点拆分为子订单，提交后由运营管理部统一确认。';
    }

    this.setData({
      me: me,
      canBuy: canBuy,
      isStore: me.role === 'store',
      isDept: isDept,
      stores: me.role === 'store' ? me.stores : [],
      storeIndex: storeIndex,
      contextName: contextName,
      hint: hint
    });

    // 常买清单：按本人历史下单数量排序，一键加回购物车
    this.frequentSource = canBuy ? domain.frequentItems(state, me, 6) : [];

    const q = this.initialQuery || {};
    if (q.category) {
      const hit = NAV.filter(function (n) { return n.key === q.category; })[0];
      if (hit) this.setData({ activeCat: hit.key, activeSub: '', expandedCat: hit.key });
      q.category = '';
    }
    if (q.sub) {
      const catOfSub = NAV.filter(function (n) {
        return n.subs.some(function (s) { return s.key === q.sub; });
      })[0];
      if (catOfSub) this.setData({ activeCat: catOfSub.key, activeSub: q.sub, expandedCat: catOfSub.key });
      q.sub = '';
    }
    this.applyCart(cart, contextName);
    this.refreshList();
  },

  refreshList() {
    const cat = this.data.activeCat;
    const sub = this.data.activeSub;
    const keyword = (this.data.keyword || '').trim().toLowerCase();
    const cart = this.data.cart || {};

    // 记住二级分类名称，用于列表标题与面包屑
    let catLabel = '';
    let subLabel = '';
    NAV.forEach(function (n) {
      if (n.key !== cat) return;
      catLabel = n.label;
      n.subs.forEach(function (s) {
        if (s.key === sub) subLabel = s.label;
      });
    });

    const filtered = PRODUCTS.filter(function (p) {
      // 有关键词时全局搜索，避免“在某个二级分类里搜不到别的分类商品”
      if (!keyword) {
        if (sub && p.sub !== sub) return false;
        if (!sub && cat !== 'all' && p.category !== cat) return false;
      }
      if (keyword && p.key.indexOf(keyword) < 0) return false;
      return true;
    });
    const shown = Math.min(this.data.shown, filtered.length);
    this.setData({
      list: filtered.slice(0, shown).map(function (p) {
        return Object.assign({}, p, { qty: cart[p.id] || 0 });
      }),
      hasMore: filtered.length > shown,
      totalCount: filtered.length,
      catLabel: catLabel,
      subLabel: subLabel,
      listTitle: keyword ? '搜索结果' : (subLabel || catLabel || '全部物资'),
      listSub: keyword ? (catLabel ? '在' + catLabel + '内搜索' : '全部物资') : (subLabel ? catLabel : '')
    });
  },

  // 点大类：展开二级目录并筛选该大类；再点一次收起二级目录（列表仍停在该大类）
  onCat(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'all') {
      this.setData({ activeCat: 'all', activeSub: '', expandedCat: '', shown: 40 });
      this.refreshList();
      this.scrollGoodsTop();
      return;
    }
    if (key === this.data.expandedCat) {
      // 已展开 → 收起；子类筛选一并清空，回到该大类全部商品
      this.setData({ expandedCat: '', activeSub: '', activeCat: key, shown: 40 });
      this.refreshList();
      this.scrollGoodsTop();
      return;
    }
    this.setData({ activeCat: key, activeSub: '', expandedCat: key, shown: 40 });
    this.refreshList();
    this.scrollGoodsTop();
  },

  // 二级目录底部的「收起」
  onFold(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ expandedCat: '', activeSub: '', activeCat: key, shown: 40 });
    this.refreshList();
  },

  // 点二级分类：精确筛选
  onSub(e) {
    const cat = e.currentTarget.dataset.cat;
    const key = e.currentTarget.dataset.key;
    this.setData({ activeCat: cat, activeSub: key, shown: 40 });
    this.refreshList();
    this.scrollGoodsTop();
  },

  // 切换目录后回到列表顶部，避免停在上一屏的滚动位置
  scrollGoodsTop() {
    this.setData({ goodsTop: 'g-top' });
    const that = this;
    setTimeout(function () { that.setData({ goodsTop: '' }); }, 60);
  },

  onRefresherRefresh() {
    this.setData({ refreshing: true });
    const that = this;
    if (typeof this.onShow === 'function') this.onShow();
    setTimeout(function () { that.setData({ refreshing: false }); }, 320);
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value, shown: 40 });
    this.refreshList();
  },

  clearKeyword() {
    this.setData({ keyword: '', shown: 40 });
    this.refreshList();
  },

  loadMore() {
    if (!this.data.hasMore) return;
    this.setData({ shown: this.data.shown + 40 });
    this.refreshList();
  },

  // 滚动到接近底部自动续载，省掉找“加载更多”的滑动成本
  onGoodsBottom() {
    this.loadMore();
  },

  onStoreChange(e) {
    const index = Number(e.detail.value);
    const me = this.data.me;
    const contextName = me.stores[index];
    const saved = store.loadCart();
    const cart = (saved && saved.ownerId === me.id && saved.context === contextName) ? (saved.items || {}) : {};
    this.setData({ storeIndex: index, contextName: contextName });
    this.applyCart(cart, contextName);
    this.refreshList();
  },

  applyCart(cart, contextName) {
    const me = this.data.me;
    const context = contextName === undefined ? this.data.contextName : contextName;
    const lines = [];
    let count = 0;
    let amountCents = 0;
    Object.keys(cart).forEach(function (id) {
      const p = PRODUCT_MAP[id];
      const qty = cart[id];
      if (!p || !qty) return;
      count += qty;
      amountCents += Math.round(p.price * 100) * qty;
      lines.push({
        id: id,
        name: p.name,
        spec: p.spec,
        unit: p.unit,
        qty: qty,
        priceText: p.priceText,
        amountText: fmt.money2((Math.round(p.price * 100) * qty) / 100)
      });
    });
    this.setData({
      cart: cart,
      cartLines: lines,
      cartCount: count,
      cartAmount: fmt.money2(amountCents / 100),
      frequent: this.buildFrequent(cart),
      list: (this.data.list || []).map(function (p) {
        return Object.assign({}, p, { qty: cart[p.id] || 0 });
      })
    });
    if (me && this.data.canBuy) {
      store.saveCart({ ownerId: me.id, context: context, items: cart, updatedAt: new Date().toISOString() });
    }
  },

  buildFrequent(cart) {
    const src = this.frequentSource || [];
    const bag = cart || this.data.cart || {};
    return src.map(function (p) {
      return {
        id: p.id,
        name: p.name,
        spec: p.spec || '',
        unit: p.unit || '件',
        priceText: fmt.money2(p.price),
        times: p.times,
        qty: bag[p.id] || 0
      };
    });
  },

  addItem(e) {
    if (!this.data.canBuy) {
      wx.showToast({ title: '当前身份不可下单', icon: 'none' });
      return;
    }
    const id = e.currentTarget.dataset.id;
    const cart = Object.assign({}, this.data.cart);
    if ((cart[id] || 0) >= 9999) {
      wx.showToast({ title: '单行最多 9999', icon: 'none' });
      return;
    }
    cart[id] = (cart[id] || 0) + 1;
    this.applyCart(cart);
  },

  minusItem(e) {
    const id = e.currentTarget.dataset.id;
    const cart = Object.assign({}, this.data.cart);
    if (!cart[id]) return;
    cart[id] -= 1;
    if (cart[id] <= 0) delete cart[id];
    this.applyCart(cart);
  },

  // 点击数量直接输入，避免大数量要连点几十次
  editQty(e) {
    if (!this.data.canBuy) {
      wx.showToast({ title: '当前身份不可下单', icon: 'none' });
      return;
    }
    const id = e.currentTarget.dataset.id;
    const that = this;
    const current = this.data.cart[id] || 0;
    if (!current) return;
    wx.showModal({
      title: '修改数量',
      editable: true,
      placeholderText: '请输入数量',
      content: String(current),
      success: function (res) {
        if (!res.confirm) return;
        const raw = String(res.content === undefined ? '' : res.content).trim();
        if (!/^[0-9]+$/.test(raw)) {
          wx.showToast({ title: '请输入正整数', icon: 'none' });
          return;
        }
        const qty = parseInt(raw, 10);
        if (qty < 1) {
          wx.showToast({ title: '数量至少为 1', icon: 'none' });
          return;
        }
        if (qty > 9999) {
          wx.showToast({ title: '单行最多 9999', icon: 'none' });
          return;
        }
        const cart = Object.assign({}, that.data.cart);
        cart[id] = qty;
        that.applyCart(cart);
      }
    });
  },

  removeLine(e) {
    const id = e.currentTarget.dataset.id;
    const cart = Object.assign({}, this.data.cart);
    delete cart[id];
    this.applyCart(cart);
  },

  toggleCart() {
    if (!this.data.cartCount) {
      wx.showToast({ title: '还没有选择商品', icon: 'none' });
      return;
    }
    this.setData({ showCart: !this.data.showCart });
  },

  closeCart() {
    this.setData({ showCart: false });
  },

  clearCart() {
    const that = this;
    wx.showModal({
      title: '清空购物车',
      content: '将移除已选择的全部商品，是否继续？',
      success: function (res) {
        if (!res.confirm) return;
        that.applyCart({});
        that.setData({ showCart: false });
      }
    });
  },

  goCheckout() {
    if (!this.data.cartCount) {
      wx.showToast({ title: '请先选择商品', icon: 'none' });
      return;
    }
    if (!this.data.canBuy) {
      wx.showToast({ title: '当前身份不可下单', icon: 'none' });
      return;
    }
    const payload = {
      mode: this.data.isDept ? 'department' : 'store',
      ownerId: this.data.me.id,
      contextName: this.data.contextName,
      items: this.data.cartLines.map(function (x) { return { id: x.id, qty: x.qty }; })
    };
    wx.setStorageSync('anju_checkout_input', payload);
    this.setData({ showCart: false });
    wx.navigateTo({ url: '/pages/checkout/checkout?mode=' + payload.mode });
  },

  saveDraftNow() {
    if (!this.data.cartCount) {
      wx.showToast({ title: '购物车为空，无法保存草稿', icon: 'none' });
      return;
    }
    const me = this.data.me;
    const contextName = this.data.contextName;
    const drafts = store.listDrafts(me.id);
    const purchaseType = this.data.isDept ? 'department' : 'store';
    const existing = drafts.filter(function (d) {
      return d.purchaseType === purchaseType && d.contextName === contextName;
    })[0];
    const now = new Date().toISOString();
    const draft = {
      id: existing ? existing.id : 'drf-' + Date.now().toString(36),
      actorId: me.id,
      purchaseType: purchaseType,
      contextName: contextName,
      title: contextName + ' 采购草稿（' + this.data.cartCount + '件）',
      payload: { items: this.data.cartLines.map(function (x) { return { id: x.id, qty: x.qty }; }) },
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    store.saveDraft(draft);
    wx.showToast({ title: '草稿已保存', icon: 'success' });
  },

  goDrafts() {
    wx.navigateTo({ url: '/pages/drafts/drafts' });
  },

  goIdentity() {
    wx.navigateTo({ url: '/pages/identity/identity' });
  }
});
