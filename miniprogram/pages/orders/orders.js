const share = require('../../utils/share');
const store = require('../../utils/store');
const session = require('../../utils/session');
const domain = require('../../utils/domain');
const perm = require('../../utils/perm');
const fmt = require('../../utils/format');

const FILTERS = [
  { key: 'all', label: '全部', statuses: null },
  { key: 'pending', label: '待审批', statuses: ['order-review', 'budget-region', 'budget-central', 'amount-approval', 'dept-approval'] },
  { key: 'wait', label: '待接单', statuses: ['supplier'] },
  { key: 'ready', label: '备货中', statuses: ['preparing'] },
  { key: 'ship', label: '配送中', statuses: ['delivering', 'delivered', 'partial'] },
  { key: 'settle', label: '结算中', statuses: ['settle-pending', 'settle-supplier', 'settle-disputed'] },
  { key: 'accept', label: '已验收', statuses: ['accepted', 'done'] },
  { key: 'closed', label: '已关闭', statuses: ['cancelled', 'rejected'] }
];

// 供应商只看履约相关状态，避免出现"待审批"这类与自己无关的筛选项
const SUPPLIER_FILTERS = [
  { key: 'all', label: '全部', statuses: null },
  { key: 'wait', label: '待接单', statuses: ['supplier'] },
  { key: 'ready', label: '备货中', statuses: ['preparing'] },
  { key: 'ship', label: '配送中', statuses: ['delivering', 'delivered', 'partial'] },
  { key: 'settle', label: '结算确认', statuses: ['settle-pending', 'settle-supplier', 'settle-disputed'] },
  { key: 'accept', label: '已验收', statuses: ['accepted', 'done'] },
  { key: 'closed', label: '已关闭', statuses: ['cancelled', 'rejected'] }
];

Page({
  onShareAppMessage: share.handler,
  data: {
    me: null,
    filters: [],
    active: 'all',
    orders: [],
    draftCount: 0,
    slaOnly: false,
    keyword: ''
  },

  onLoad(query) {
    this.setData({
      active: 'all',
      slaOnly: !!(query && query.filter === 'sla')
    });
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh();
    wx.stopPullDownRefresh();
  },

  refresh() {
    const state = store.loadState();
    const me = session.current();
    const all = domain.visibleOrders(state, me);
    const slaRows = domain.slaEntries(state);
    const defs = me.role === 'supplier' ? SUPPLIER_FILTERS : FILTERS;

    const counts = {};
    defs.forEach(function (f) {
      counts[f.key] = f.statuses ? all.filter(function (o) { return f.statuses.indexOf(o.status) >= 0; }).length : all.length;
    });

    const filters = defs.map(function (f) {
      return { key: f.key, label: f.label, count: counts[f.key] };
    });

    let active = this.data.active;
    if (!defs.some(function (f) { return f.key === active; })) active = 'all';
    const target = defs.filter(function (f) { return f.key === active; })[0] || defs[0];

    let rows = all;
    if (target.statuses) rows = rows.filter(function (o) { return target.statuses.indexOf(o.status) >= 0; });

    if (this.data.slaOnly) {
      rows = rows.filter(function (o) {
        return slaRows.some(function (s) { return s.orderId === o.id && s.level !== 'normal'; });
      });
    }

    const keyword = (this.data.keyword || '').trim().toLowerCase();
    if (keyword) {
      rows = rows.filter(function (o) {
        return (o.id + ' ' + o.store + ' ' + (o.department || '')).toLowerCase().indexOf(keyword) >= 0;
      });
    }

    const cards = rows.map(function (o) {
      // 结算/待对账阶段以订单状态为准：供应商侧的分项记录此时已 accepted，
      // 若仍显示「已完成」会误导供应商不去确认结算金额
      const inSettle = me.role === 'supplier' &&
        ['settle-pending', 'settle-supplier', 'settle-disputed', 'accepted'].indexOf(o.status) >= 0;
      const sla = slaRows.filter(function (s) { return s.orderId === o.id; })
        .sort(function (a, b) { return b.hours - a.hours; })[0];
      const names = (o.items || []).slice(0, 2).map(function (x) { return x.name + '×' + x.qty; }).join('、');
      const more = (o.items || []).length > 2 ? ' 等' + (o.items || []).length + '项' : '';
      const sub = o.supplierRecords && me.role === 'supplier' ? o.supplierRecords[me.supplier] : null;
      const issueOwner = Object.keys(o.supplierRecords || {}).filter(function (k) {
        return o.supplierRecords[k] && o.supplierRecords[k].status === 'issue';
      })[0];

      return {
        id: o.id,
        statusLabel: inSettle ? fmt.statusLabel(o.status) : (sub
          ? (sub.status === 'pending' ? '待我接单'
            : sub.status === 'confirmed' ? (sub.deliveries && sub.deliveries.length ? '分批配送中' : '待发货')
              : sub.status === 'shipping' ? '配送中'
                : sub.status === 'accepted' ? '已完成'
                  : sub.status === 'issue' ? '已拒单'
                    : fmt.statusLabel(o.status))
          : fmt.statusLabel(o.status)),
        statusCls: inSettle ? fmt.statusCls(o.status) : (sub && sub.status === 'pending' ? 'warn'
          : sub && (sub.status === 'accepted') ? 'good'
            : sub && sub.status === 'issue' ? 'bad'
              : fmt.statusCls(o.status)),
        store: o.store,
        owner: o.purchaseType === 'department' ? (o.department + ' · ' + o.store) : o.store,
        totalText: fmt.money(o.total),
        itemText: names + more,
        created: o.created,
        slaText: sla && sla.level !== 'normal'
          ? (sla.kind === 'approval' ? '审批' : '接单') + '已等待 ' + fmt.hoursText(sla.hours) + (sla.level === 'overdue' ? '（已超时）' : '（临近超时）')
          : '',
        slaLevel: sla ? sla.level : 'normal',
        isDept: o.purchaseType === 'department',
        issueText: issueOwner ? (issueOwner + '：' + String(o.supplierRecords[issueOwner].issue || '无法接单')) : '',
        canCancel: perm.can(me, 'order.view') && o.submittedBy === me.id &&
          (me.role === 'store'
            ? ['order-review', 'budget-region', 'budget-central', 'amount-approval'].indexOf(o.status) >= 0
            : o.status === 'dept-approval'),
        canReorder: perm.can(me, 'order.create')
      };
    });

    this.setData({
      me: me,
      active: active,
      filters: filters,
      orders: cards,
      listTitle: me.role === 'central' ? '全公司订单' : me.role === 'region' ? '战区订单' : me.role === 'department' ? '部门订单' : '我的订单',
      emptyText: me.role === 'supplier' ? '暂无与您相关的订单' : '当前条件下没有订单',
      draftCount: perm.can(me, 'draft') ? store.listDrafts(me.id).length : 0
    });
    wx.setNavigationBarTitle({ title: this.data.listTitle });
  },

  onFilter(e) {
    this.setData({ active: e.currentTarget.dataset.key, slaOnly: false });
    this.refresh();
  },

  clearSla() {
    this.setData({ slaOnly: false });
    this.refresh();
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value });
    this.refresh();
  },

  gotoDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + id });
  },

  cancel(e) {
    const id = e.currentTarget.dataset.id;
    const me = this.data.me;
    const that = this;
    wx.showModal({
      title: '撤销订单 ' + id,
      content: '仅未进入履约的订单可撤销，撤销后占用预算自动释放。是否继续？',
      confirmColor: '#c0392b',
      success: function (res) {
        if (!res.confirm) return;
        try {
          const state = store.loadState();
          const result = domain.cancelOrder(state, me, id);
          store.saveState(state);
          store.appendAudit([result.audit]);
          wx.showToast({ title: '已撤销', icon: 'success' });
          that.refresh();
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      }
    });
  },

  reorder(e) {
    const id = e.currentTarget.dataset.id;
    const state = store.loadState();
    const order = state.orders.filter(function (o) { return o.id === id; })[0];
    if (!order) return;
    const me = this.data.me;
    const items = {};
    (order.items || []).forEach(function (x) { items[x.id] = x.qty; });
    const context = order.purchaseType === 'department' ? me.department : order.store;
    store.saveCart({ ownerId: me.id, context: context, items: items, updatedAt: new Date().toISOString() });
    wx.showToast({ title: '已加入购物车，按最新价校验', icon: 'none', duration: 1600 });
    setTimeout(function () {
      wx.reLaunch({ url: '/pages/catalog/catalog' });
    }, 700);
  },

  goDrafts() {
    wx.navigateTo({ url: '/pages/drafts/drafts' });
  },

  goIdentity() {
    wx.navigateTo({ url: '/pages/identity/identity' });
  }
});
