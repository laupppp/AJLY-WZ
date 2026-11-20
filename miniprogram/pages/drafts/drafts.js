const share = require('../../utils/share');
const store = require('../../utils/store');
const session = require('../../utils/session');
const perm = require('../../utils/perm');
const fmt = require('../../utils/format');

Page({
  onShareAppMessage: share.handler,
  data: {
    me: null,
    allowed: false,
    drafts: []
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const me = session.current();
    const allowed = perm.can(me, 'draft');
    const drafts = allowed ? store.listDrafts(me.id).map(function (d) {
      const items = (d.payload && d.payload.items) || [];
      const count = items.reduce(function (s, x) { return s + x.qty; }, 0);
      return {
        id: d.id,
        title: d.title,
        contextName: d.contextName,
        purchaseType: d.purchaseType,
        count: count,
        kind: items.length + ' 种 · ' + count + ' 件',
        updated: fmt.fromNow(d.updatedAt)
      };
    }) : [];
    this.setData({ me: me, allowed: allowed, drafts: drafts });
  },

  restore(e) {
    const id = e.currentTarget.dataset.id;
    const drafts = store.listDrafts(this.data.me.id);
    const draft = drafts.filter(function (d) { return d.id === id; })[0];
    if (!draft) return;
    const items = {};
    ((draft.payload && draft.payload.items) || []).forEach(function (x) { items[x.id] = x.qty; });
    store.saveCart({
      ownerId: this.data.me.id,
      context: draft.contextName,
      items: items,
      updatedAt: new Date().toISOString()
    });
    wx.showToast({ title: '已恢复到购物车', icon: 'none' });
    // 草稿可能属于该店长的另一家门店，带上门店参数恢复，避免购物车被上下文过滤成空
    const query = draft.purchaseType === 'store' && draft.contextName
      ? ('?store=' + encodeURIComponent(draft.contextName))
      : '';
    setTimeout(function () { wx.reLaunch({ url: '/pages/catalog/catalog' + query }); }, 600);
  },

  remove(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    wx.showModal({
      title: '删除草稿',
      content: '删除后不可恢复，是否继续？',
      success: function (res) {
        if (!res.confirm) return;
        store.deleteDraft(id, that.data.me.id);
        wx.showToast({ title: '已删除', icon: 'success' });
        that.refresh();
      }
    });
  },

  goCatalog() {
    wx.reLaunch({ url: '/pages/catalog/catalog' });
  },

  goIdentity() {
    wx.navigateTo({ url: '/pages/identity/identity?switch=1' });
  }
});
