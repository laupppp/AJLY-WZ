const share = require('../../utils/share');
const session = require('../../utils/session');
const store = require('../../utils/store');
const domain = require('../../utils/domain');
const perm = require('../../utils/perm');
const fmt = require('../../utils/format');

Page({
  onShareAppMessage: share.handler,
  data: {
    mode: 'profile',
    me: null,
    avatarText: '',
    roleText: '',
    duty: '',
    scopeText: '',
    brief: [],
    stats: [],
    entries: [],
    groups: [],
    demoMode: true,
    version: 'V1.24 · 演示版'
  },

  onLoad(query) {
    this.switchAfter = !!(query && query.switch);
  },

  onShow() {
    this.refresh();
    if (this.switchAfter) {
      this.switchAfter = false;
      this.openSwitch();
    }
  },

  refresh() {
    const me = session.current();
    const state = store.loadState();
    const meta = perm.roleMeta(me.role);
    const orders = domain.visibleOrders(state, me);

    const stats = [
      { num: String(orders.length), label: me.role === 'supplier' ? '相关订单' : '可见订单' },
      { num: String(domain.actionCount(state, me)), label: '待我处理' }
    ];
    if (perm.can(me, 'draft')) {
      stats.push({ num: String(store.listDrafts(me.id).length), label: '采购草稿' });
    }

    this.setData({
      me: me,
      avatarText: me.role === 'central' ? '中' : me.role === 'supplier' ? '供' : me.role === 'department' ? '部' : me.role === 'region' ? '战' : '店',
      roleText: meta.label,
      duty: meta.duty,
      scopeText: this.scopeOf(me),
      brief: meta.brief,
      stats: stats,
      entries: this.buildEntries(me),
      demoMode: store.isDemoMode()
    });
  },

  scopeOf(me) {
    if (me.role === 'store') return (me.stores || []).join(' / ');
    if (me.role === 'department') return '职能部门 · ' + (me.department || '未分配');
    if (me.role === 'central') return '全公司 · 11 个职能部门';
    if (me.role === 'region') return me.zone + ' · 全部门店';
    if (me.role === 'supplier') return me.supplier;
    return '';
  },

  buildEntries(me) {
    const list = [];
    if (perm.can(me, 'order.create')) list.push({ key: 'catalog', icon: '🛒', label: '采购下单', sub: '选择物资并提交审批', url: '/pages/catalog/catalog' });
    list.push({ key: 'orders', icon: '📋', label: '我的订单', sub: '查看进度与流程留痕', url: '/pages/orders/orders' });
    if (perm.can(me, 'accept')) list.push({ key: 'accept', icon: '📷', label: '收货验收', sub: '按批次验收并拍照留证', url: '/pages/accept/accept' });
    if (perm.can(me, 'draft')) list.push({ key: 'drafts', icon: '🗂', label: '草稿箱', sub: '继续填写未提交的采购', url: '/pages/drafts/drafts' });
    if (perm.can(me, 'approve')) list.push({ key: 'approve', icon: '✅', label: '待办审批', sub: me.role === 'region' ? '战区订单审核、预算与金额审批' : '预算核定、部门确认', url: '/pages/approvals/approvals' });
    if (me.role === 'supplier') list.push({ key: 'supplier', icon: '🚚', label: '供应商工作台', sub: '接单、发货与运单登记', url: '/pages/supplier/supplier' });
    list.push({ key: 'reports', icon: '📊', label: me.role === 'supplier' ? '对账确认' : '统计看板', sub: me.role === 'supplier' ? '核对每月供货金额' : '金额漏斗与结构分析', url: '/pages/reports/reports' });
    list.push({ key: 'guide', icon: '📖', label: '采购说明', sub: '流程、审批分级与结算口径', url: '/pages/guide/guide' });
    return list;
  },

  go(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.navigateTo({ url: url });
  },

  openSwitch() {
    const me = this.data.me;
    const groups = session.grouped().map(function (g) {
      return {
        title: g.title,
        desc: g.desc,
        items: g.items.map(function (x) {
          const meta = perm.roleMeta(x.role);
          return {
            id: x.id,
            name: x.name,
            short: x.short || x.name,
            duty: meta.duty,
            active: x.id === me.id
          };
        })
      };
    });
    this.setData({ mode: 'switch', groups: groups });
  },

  closeSwitch() {
    this.setData({ mode: 'profile' });
  },

  // 演示模式关掉后，界面只保留业务入口，对外演示更接近正式版
  toggleDemo(e) {
    const on = !!e.detail.value;
    store.setDemoMode(on);
    this.setData({ demoMode: on });
    wx.showToast({
      title: on ? '已显示演示入口' : '已隐藏演示入口',
      icon: 'none'
    });
  },

  switchTo(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.me.id) {
      this.closeSwitch();
      return;
    }
    try {
      const profile = session.switchTo(id);
      wx.showToast({ title: '已切换为' + (profile.short || profile.name), icon: 'none' });
      setTimeout(function () {
        wx.reLaunch({ url: '/pages/index/index' });
      }, 500);
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  resetDemo() {
    const that = this;
    wx.showModal({
      title: '重置演示数据',
      content: '将清空本机新增的订单、草稿、审批与验收记录，恢复到 V1.24 初始演示数据。此操作不可撤销。',
      confirmColor: '#c0392b',
      success: function (res) {
        if (!res.confirm) return;
        store.resetState();
        wx.showToast({ title: '已恢复初始数据', icon: 'success' });
        that.refresh();
      }
    });
  },

  showAbout() {
    wx.showModal({
      title: '关于演示版',
      content: '安居乐寓物资采购管理系统 V1.24 演示版。\n\n全部商品价格、预算、员工与供应商均为虚构测试数据；审批与结算不产生真实业务效力。\n\n订单与验收记录保存在本机小程序存储中。',
      showCancel: false
    });
  }
});
