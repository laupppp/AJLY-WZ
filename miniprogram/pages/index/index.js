const share = require('../../utils/share');
const store = require('../../utils/store');
const session = require('../../utils/session');
const domain = require('../../utils/domain');
const perm = require('../../utils/perm');
const fmt = require('../../utils/format');

// 身份头像配色：浅底 + 深色字，放在深色头部上更干净
const TONE_BG = {
  store: '#e8f1fc',
  department: '#f0ebfa',
  central: '#e7eef8',
  region: '#e4f3ee',
  supplier: '#fdf1e0'
};
const TONE_FG = {
  store: '#1f5c97',
  department: '#6a4bb0',
  central: '#1e4e7e',
  region: '#17705c',
  supplier: '#96601a'
};

Page({
  onShareAppMessage: share.handler,
  data: {
    me: null,
    avatarText: '',
    roleText: '',
    roleTag: '',
    roleDuty: '',
    scopeText: '',
    dateText: '',
    quick: [],
    tasks: [],
    stats: [],
    alertText: '',
    alertLevel: '',
    budgetBar: null,
    demoMode: true,
    toneBg: TONE_BG.store,
    toneFg: TONE_FG.store
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
    const meta = perm.roleMeta(me.role);
    const orders = domain.visibleOrders(state, me);
    const sla = this.visibleSla(state, me);
    const overdue = sla.filter(function (x) { return x.level === 'overdue'; }).length;
    const warning = sla.filter(function (x) { return x.level === 'warning'; }).length;

    const badges = this.buildBadges(state, me, orders);

    const d = new Date();
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];

    this.setData({
      me: me,
      toneBg: TONE_BG[me.role] || TONE_BG.store,
      toneFg: TONE_FG[me.role] || TONE_FG.store,
      avatarText: this.avatarOf(me),
      roleText: meta.label,
      // 身份名里已含角色名时不再重复贴标签
      roleTag: String(me.name || '').indexOf(meta.label) >= 0 ? '' : meta.label,
      roleDuty: meta.duty,
      scopeText: this.scopeOf(me),
      dateText: (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + week,
      quick: perm.homeEntries(me).map(function (x) {
        x.badge = badges[x.key] || '';
        return x;
      }),
      tasks: this.buildTasks(state, me, orders, sla),
      stats: this.buildStats(state, me, orders, sla),
      alertText: overdue > 0
        ? (overdue + ' 单已超时' + (warning ? '，另有 ' + warning + ' 单临近超时' : ''))
        : (warning > 0 ? (warning + ' 单临近超时') : ''),
      alertLevel: overdue > 0 ? 'bad' : (warning > 0 ? 'warn' : ''),
      budgetBar: this.buildBudgetBar(state, me),
      demoMode: store.isDemoMode()
    });

    this.maybeOnboard(me);
  },

  // 首次打开给一条一次性的演示说明，避免对方点开卡片后不知道该做什么
  maybeOnboard(me) {
    if (this.onboarded) return;
    this.onboarded = true;
    let seen = '';
    try { seen = wx.getStorageSync('anju_onboard_v124'); } catch (e) { seen = ''; }
    if (seen || !store.isDemoMode()) return;
    try { wx.setStorageSync('anju_onboard_v124', '1'); } catch (e) {}
    wx.showModal({
      title: '演示版使用说明',
      content: '当前身份：' + perm.roleMeta(me.role).label + '。\n\n在「我的」里可以切换门店店长 / 战区负责人 / 运营管理部 / 职能部门 / 供应商，每个角色只看到自己的入口与数据。\n\n商品价格、预算、人员均为虚构演示数据。',
      showCancel: false,
      confirmText: '开始体验'
    });
  },

  avatarOf(me) {
    if (me.role === 'central') return '中';
    if (me.role === 'supplier') return '供';
    if (me.role === 'department') return '部';
    if (me.role === 'region') return '战';
    return '店';
  },

  scopeOf(me) {
    if (me.role === 'store') return (me.stores || []).join(' / ');
    if (me.role === 'department') return '职能部门 · ' + (me.department || '未分配');
    if (me.role === 'central') return '全公司 · 11 个职能部门';
    if (me.role === 'region') return me.zone;
    // 供应商身份名就是公司名，这里换成职责说明避免与标题重复
    if (me.role === 'supplier') return '接单 · 配送 · 对账确认';
    return '';
  },

  buildBadges(state, me, orders) {
    const badges = {};
    if (perm.can(me, 'approve')) {
      const n = domain.pendingApprovals(state, me).length;
      if (n) badges.approve = String(n);
    }
    if (perm.can(me, 'accept')) {
      const n = domain.pendingAcceptOrders(state, me).length;
      if (n) badges.accept = String(n);
    }
    if (perm.can(me, 'draft')) {
      const n = store.listDrafts(me.id).length;
      if (n) badges.drafts = String(n);
    }
    if (me.role === 'supplier') {
      const n = orders.filter(function (o) {
        const r = (o.supplierRecords || {})[me.supplier];
        return r && r.status === 'pending' && ['cancelled', 'rejected'].indexOf(o.status) < 0;
      }).length;
      if (n) badges.supply = String(n);
      const recon = (state.recons || []).filter(function (r) {
        return r.supplier === me.supplier && r.status === 'supplier-pending';
      }).length;
      if (recon) badges.recon = String(recon);
    }
    if (me.role === 'central') {
      const recon = (state.recons || []).filter(function (r) { return r.status === 'supplier-confirmed'; }).length;
      if (recon) badges.recon = String(recon);
    }
    return badges;
  },

  buildStats(state, me, orders, sla) {
    if (me.role === 'supplier') {
      const own = orders.filter(function (o) {
        const r = (o.supplierRecords || {})[me.supplier];
        return r && ['cancelled', 'rejected'].indexOf(o.status) < 0;
      });
      const pending = own.filter(function (o) {
        return o.supplierRecords[me.supplier].status === 'pending';
      }).length;
      const toship = own.filter(function (o) {
        return o.supplierRecords[me.supplier].status === 'confirmed';
      }).length;
      const amount = own.reduce(function (sum, o) {
        return sum + (o.items || []).filter(function (x) { return x.supplier === me.supplier; })
          .reduce(function (s, x) { return s + x.price * Number(x.accepted || 0); }, 0);
      }, 0);
      return [
        { num: String(pending), label: '待接单' },
        { num: String(toship), label: '待发货' },
        { num: '¥' + fmt.money(amount), label: '已验收金额' }
      ];
    }

    const summary = domain.reportSummary({ orders: orders });
    return [
      { num: '¥' + fmt.money(summary.totals.requested), label: '申请金额' },
      { num: '¥' + fmt.money(summary.totals.accepted), label: '已验收' },
      { num: String(domain.actionCount(state, me)), label: '待我处理' }
    ];
  },

  // 预算条：门店看本店额度，战区看本战区门店合计，中台看全公司占用
  buildBudgetBar(state, me) {
    const rows = domain.budgetSummary(state, me);
    if (!rows.length) return null;
    // 三个费用科目的占用（门店取本店，战区/中台取合计）
    const itemBars = function (list) {
      const first = (list[0] && list[0].items) || [];
      return first.map(function (base, i) {
        const budget = list.reduce(function (s, r) { return s + ((r.items[i] || {}).budget || 0); }, 0);
        const used = list.reduce(function (s, r) { return s + ((r.items[i] || {}).used || 0); }, 0);
        const pct = budget > 0 ? Math.min(100, Math.round(used / budget * 100)) : 0;
        return {
          key: base.key,
          name: base.name,
          pct: pct,
          level: pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'blue',
          usedText: fmt.money(used),
          budgetText: fmt.money(budget)
        };
      });
    };
    if (me.role === 'store') {
      // 以主店为首页展示口径，其他门店在看板里逐店查看
      const main = (me.stores || [])[0];
      const r = rows.filter(function (x) { return x.store === main; })[0] || rows[0];
      return {
        pct: r.usedPct,
        title: '预算 ¥' + fmt.money(r.budget) + ' · 可用 ¥' + fmt.money(r.available),
        sub: '已用 ¥' + fmt.money(r.used) + '（在途 ¥' + fmt.money(r.occupied) + ' · 已验收 ¥' + fmt.money(r.spent) + '）' +
          (rows.length > 1 ? ' · 共 ' + rows.length + ' 家门店' : ''),
        items: itemBars([r]),
        rooms: r.rooms,
        level: r.usedPct >= 90 ? 'bad' : r.usedPct >= 75 ? 'warn' : ''
      };
    }
    if (me.role === 'region') {
      let budget = 0;
      let used = 0;
      let occupied = 0;
      let spent = 0;
      rows.forEach(function (r) {
        budget += r.budget;
        used += r.used;
        occupied += r.occupied;
        spent += r.spent;
      });
      const pct = budget > 0 ? Math.round(used / budget * 100) : 0;
      return {
        pct: Math.min(100, pct),
        title: '战区额度 ¥' + fmt.money(budget) + ' · 已用 ' + pct + '%',
        sub: rows.length + ' 家门店 · 在途 ¥' + fmt.money(occupied) + ' · 已验收 ¥' + fmt.money(spent),
        items: itemBars(rows),
        level: pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : ''
      };
    }
    if (me.role === 'central') {
      let budget = 0;
      let used = 0;
      rows.forEach(function (r) { budget += r.budget; used += r.used; });
      const pct = budget > 0 ? Math.round(used / budget * 100) : 0;
      return {
        pct: Math.min(100, pct),
        title: '门店预算池 ¥' + fmt.money(budget) + ' · 占用 ' + pct + '%',
        sub: '机动（预留）预算余额 ¥' + fmt.money(state.flex) + ' · 已建档 ' + rows.length + ' 家门店',
        items: itemBars(rows),
        level: pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : ''
      };
    }
    return null;
  },

  visibleSla(state, me) {
    const rows = domain.slaEntries(state);
    return rows.filter(function (x) {
      if (me.role === 'supplier') return x.kind === 'supplier' && x.owner === me.supplier;
      if (me.role === 'department') return x.department === me.department;
      if (me.role === 'region') {
        const order = state.orders.filter(function (o) { return o.id === x.orderId; })[0];
        return !!order && order.zone === me.zone;
      }
      if (me.role === 'store') {
        const order = state.orders.filter(function (o) { return o.id === x.orderId; })[0];
        return !!order && me.stores.indexOf(order.store) >= 0;
      }
      return true;
    });
  },

  buildTasks(state, me, orders, sla) {
    const list = [];
    const slaRows = sla || this.visibleSla(state, me);

    // 超时单排在最前：给出可直达的处理入口，而不是只提示数量
    // 中台/战区只关心自己该审的节点，供应商接单超时只作为催办信息留在订单列表
    const ownApprovalOnly = me.role === 'central' || me.role === 'region';
    slaRows.filter(function (x) {
      return x.level === 'overdue' && (!ownApprovalOnly || x.kind === 'approval');
    })
      .sort(function (a, b) { return b.hours - a.hours; })
      .slice(0, 1)
      .forEach(function (x) {
        list.push({
          key: 'sla-' + x.orderId,
          title: '已超时 · ' + x.orderId,
          sub: x.owner + ' 已等待 ' + fmt.hoursText(x.hours) + ' · 限时 ' + x.limit + ' 小时',
          pill: x.kind === 'approval' ? '去审批' : '去处理',
          cls: 'bad',
          url: x.kind === 'approval'
            ? '/pages/approvals/approvals'
            : (me.role === 'supplier' ? '/pages/supplier/supplier' : '/pages/orders/orders?filter=sla')
        });
      });

    if (perm.can(me, 'accept')) {
      domain.pendingAcceptOrders(state, me).slice(0, 2).forEach(function (o) {
        list.push({
          key: o.id,
          title: '待验收 · ' + o.id,
          sub: (o.purchaseType === 'department' ? o.department + ' → ' : '') + o.store + ' · ¥' + fmt.money(o.total),
          pill: '去验收',
          cls: 'warn',
          url: '/pages/accept/accept?orderId=' + o.id
        });
      });
    }

    // 结算金额共同确认：门店/部门填写金额，供应商确认；与「待我处理」计数同源
    domain.pendingSettleOrders(state, me).slice(0, 2).forEach(function (o) {
      const applied = o.settlement && o.settlement.amount
        ? ' · 申报 ¥' + fmt.money(o.settlement.amount) : '';
      list.push({
        key: 'settle-' + o.id,
        title: (me.role === 'supplier' ? '待确认结算' : '待填写结算') + ' · ' + o.id,
        sub: (o.purchaseType === 'department' ? o.department + ' → ' : '') +
          o.store + ' · ¥' + fmt.money(o.total) + applied,
        pill: me.role === 'supplier' ? '去确认' : '去填写',
        cls: 'warn',
        url: '/pages/settle/settle?id=' + o.id
      });
    });

    if (perm.can(me, 'approve')) {
      domain.pendingApprovals(state, me).slice(0, 2).forEach(function (o) {
        list.push({
          key: o.id,
          title: fmt.statusLabel(o.status) + ' · ' + o.id,
          sub: (o.purchaseType === 'department' ? o.department : o.store) + ' · ¥' + fmt.money(o.total),
          pill: '去审批',
          cls: 'warn',
          url: '/pages/approvals/approvals'
        });
      });
    }

    if (me.role === 'supplier') {
      orders.filter(function (o) {
        const r = (o.supplierRecords || {})[me.supplier];
        return r && r.status === 'pending' && ['cancelled', 'rejected'].indexOf(o.status) < 0;
      }).slice(0, 2).forEach(function (o) {
        list.push({
          key: o.id,
          title: '待接单 · ' + o.id,
          sub: o.store + ' · ¥' + fmt.money(o.total),
          pill: '去接单',
          cls: 'warn',
          url: '/pages/supplier/supplier'
        });
      });
      orders.filter(function (o) {
        const r = (o.supplierRecords || {})[me.supplier];
        return r && r.status === 'confirmed';
      }).slice(0, 2).forEach(function (o) {
        list.push({
          key: o.id,
          title: '待发货 · ' + o.id,
          sub: '已接单，请登记配送方式与运单号',
          pill: '去发货',
          cls: 'info',
          url: '/pages/supplier/supplier'
        });
      });
    }

    if (perm.can(me, 'draft')) {
      const drafts = store.listDrafts(me.id);
      if (drafts.length) {
        list.push({
          key: 'drafts',
          title: drafts.length + ' 份采购草稿待提交',
          sub: '草稿不占预算，提交后才进入审批',
          pill: '继续填写',
          cls: 'gray',
          url: '/pages/drafts/drafts'
        });
      }
    }

    if (!list.length) {
      list.push({
        key: 'empty',
        title: '暂无待处理事项',
        sub: '从下方入口发起采购或查看订单',
        pill: '',
        cls: 'gray',
        url: ''
      });
    }
    return list.slice(0, 3);
  },

  go(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.navigateTo({ url: url });
  },

  goMe() {
    wx.navigateTo({ url: '/pages/identity/identity' });
  },

  goOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' });
  },

  goAlerts() {
    wx.navigateTo({ url: '/pages/orders/orders?filter=sla' });
  }
});
