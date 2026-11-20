const share = require('../../utils/share');
const store = require('../../utils/store');
const session = require('../../utils/session');
const domain = require('../../utils/domain');
const perm = require('../../utils/perm');
const fmt = require('../../utils/format');

Page({
  onShareAppMessage: share.handler,
  onPullDownRefresh() {
    if (typeof this.onShow === 'function') this.onShow();
    setTimeout(function () { wx.stopPullDownRefresh(); }, 300);
  },
  data: {
    me: null,
    allowed: false,
    items: [],
    logs: [],
    budgetText: '',
    // 预算核定卡住时的缺口弹层
    gap: null,
    gapCandidates: [],
    gapAmount: '',
    gapReason: ''
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const state = store.loadState();
    const me = session.current();
    const allowed = perm.can(me, 'approve');
    if (!allowed) {
      this.setData({ me: me, allowed: false, items: [], logs: [] });
      return;
    }

    const pending = domain.pendingApprovals(state, me);
    const slaRows = domain.slaEntries(state);
    const items = [];
    const batchMap = {};

    pending.forEach(function (o) {
      const sla = slaRows.filter(function (s) { return s.orderId === o.id; })
        .sort(function (a, b) { return b.hours - a.hours; })[0];
      const slaText = sla && sla.level !== 'normal'
        ? '已等待 ' + fmt.hoursText(sla.hours) + (sla.level === 'overdue' ? '（已超时）' : '（临近超时）')
        : '';

      if (o.purchaseType === 'department' && o.status === 'dept-approval') {
        if (!batchMap[o.groupId]) {
          batchMap[o.groupId] = {
            key: o.groupId,
            isBatch: true,
            groupId: o.groupId,
            title: '部门采购批次 ' + o.groupId,
            sub: o.department + ' · ' + 0 + ' 个子订单',
            amount: 0,
            slaText: slaText,
            slaLevel: sla ? sla.level : 'normal',
            stageText: o.department === '运营管理部' ? '本部门自采，确认后发送供应商' : '运营管理部统一确认'
          };
          items.push(batchMap[o.groupId]);
        }
        const row = batchMap[o.groupId];
        row.amount += Number(o.total || 0);
        row.count = (row.count || 0) + 1;
        row.sub = o.department + ' · ' + row.count + ' 个配送子订单';
      } else {
        const row = {
          key: o.id,
          isBatch: false,
          id: o.id,
          // 状态已由右侧标签表达，标题不再重复
          title: o.id,
          sub: (o.purchaseType === 'department' ? o.department + ' → ' : '') + o.store + ' · ' + (fmt.TIER_LABEL[o.tier] || ''),
          amount: Number(o.total || 0),
          slaText: slaText,
          slaLevel: sla ? sla.level : 'normal',
          stageText: fmt.statusLabel(o.status),
          overPending: !!o.overPending,
          overAmount: Number(o.overAmount || 0)
        };
        // 战区审核节点：提前说明通过后会去哪，避免审批人担心一次点过头
        if (o.status === 'order-review') {
          row.reviewHint = o.overPending
            ? '通过后转运营管理部核定预算（已超科目额度 ¥' + fmt.money(o.overAmount) + '）'
            : o.tier === 'auto'
              ? '通过后直接发送供应商（500 元以内免金额审批）'
              : o.tier === 'region'
                ? '通过后转战区金额审批（500-2000 元）'
                : '通过后转运营管理部金额审批（2000 元以上）';
        }
        // 预算核定节点：提前算清缺口，避免点"通过"才发现机动池不够
        if (o.status === 'budget-central') {
          const g = domain.budgetGap(state, o);
          row.budgetHint = g.ok
            ? '需追加额度 ¥' + fmt.money(g.needed) + '，机动池 ¥' + fmt.money(g.flex) + ' 可覆盖'
            : '需追加 ¥' + fmt.money(g.needed) + '，机动池仅 ¥' + fmt.money(g.flex) + '，还差 ¥' + fmt.money(g.short);
          row.budgetShort = !g.ok;
        }
        items.push(row);
      }
    });

    items.forEach(function (x) {
      x.amountText = fmt.money(x.amount);
      if (x.overPending) x.sub += ' · 超预算 ¥' + fmt.money(x.overAmount);
    });

    const logs = store.listAudit().filter(function (a) {
      return ['approval', 'cancel', 'budget'].indexOf(a.kind) >= 0;
    }).slice(0, 8).map(function (a) {
      return {
        key: a.orderId + a.at,
        title: a.orderId + ' · ' + a.decision,
        sub: fmt.fullTime(a.at) + ' · ' + a.role + (a.note ? ' · ' + a.note : '')
      };
    });

    this.setData({
      me: me,
      allowed: true,
      items: items,
      logs: logs,
      budgetText: me.role === 'central' ? ('机动预算余额 ¥' + fmt.money(state.flex)) : ''
    });
  },

  decide(e) {
    const pass = e.currentTarget.dataset.pass === '1';
    const key = e.currentTarget.dataset.key;
    const isBatch = e.currentTarget.dataset.batch === '1';
    const item = this.data.items.filter(function (x) { return x.key === key; })[0];
    if (!item) return;
    const that = this;

    wx.showModal({
      title: pass ? '确认通过' : '确认驳回',
      content: isBatch
        ? (item.title + '\n' + (pass ? '通过后该批次全部子订单发送供应商。' : '驳回后该批次全部子订单结束。'))
        : (item.title + '\n' + (pass ? '通过后流转至下一节点。' : '驳回后订单结束。')),
      confirmColor: pass ? '#2966a5' : '#c0392b',
      success: function (res) {
        if (!res.confirm) return;
        that.doDecide(key, pass, isBatch);
      }
    });
  },

  // 统一执行审批；预算核定遇机动池不足时不弹错误提示，改为打开缺口弹层给出解决路径
  doDecide(key, pass, isBatch, quiet) {
    try {
      const state = store.loadState();
      const me = this.data.me;
      if (isBatch) {
        const result = domain.approveDepartmentGroup(state, me, key, pass);
        store.saveState(state);
        store.appendAudit(result.audits);
        if (!quiet) wx.showToast({ title: pass ? '批次已确认' : '批次已驳回', icon: 'success' });
      } else {
        const raw = state.orders.filter(function (o) { return o.id === key; })[0];
        const result = domain.approveOrder(state, me, { orderId: key, stage: raw.status, pass: pass });
        store.saveState(state);
        store.appendAudit([result.audit]);
        if (!quiet) wx.showToast({ title: pass ? '已通过' : '已驳回', icon: 'success' });
      }
      this.refresh();
      return true;
    } catch (err) {
      if (err && err.code === 'FLEX_SHORT') {
        this.openGap(err.gap, key);
      } else {
        wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
        this.refresh();
      }
      return false;
    }
  },

  /* ---------- 预算缺口弹层 ---------- */
  // 某科目下哪些门店还有可调结余
  candidatesFor(storeName, key, limit) {
    const state = store.loadState();
    return domain.budgetSummary(state, this.data.me)
      .filter(function (r) { return r.store !== storeName; })
      .map(function (r) {
        const it = (r.items || []).filter(function (x) { return x.key === key; })[0];
        return { store: r.store, free: it ? it.available : 0 };
      })
      .filter(function (c) { return c.free > 0; })
      .sort(function (a, b) { return b.free - a.free; })
      .slice(0, limit || 4)
      .map(function (c) { return { store: c.store, free: c.free, freeText: fmt.money(c.free) }; });
  },

  openGap(gap, orderId) {
    const shortRows = (gap.rows || []).filter(function (r) { return r.over; })
      .sort(function (a, b) { return b.needed - a.needed; });
    const main = shortRows[0] || { key: '', name: '', needed: 0 };
    const items = shortRows.map(function (r) {
      return {
        key: r.key,
        name: r.name,
        total: r.total,
        needed: r.needed,
        totalText: fmt.money(r.total),
        usableText: fmt.money(r.usable),
        neededText: fmt.money(r.needed)
      };
    });

    this.setData({
      gap: {
        orderId: orderId,
        store: gap.store,
        total: gap.total,
        usable: gap.usable,
        needed: gap.needed,
        flex: gap.flex,
        short: gap.short,
        maxSupport: gap.maxSupport,
        totalText: fmt.money(gap.total),
        usableText: fmt.money(gap.usable),
        neededText: fmt.money(gap.needed),
        flexText: fmt.money(gap.flex),
        shortText: fmt.money(gap.short),
        maxText: fmt.money(gap.maxSupport),
        items: items,
        key: main.key,
        keyName: main.name,
        mix: items.length > 1
      },
      gapCandidates: main.key ? this.candidatesFor(gap.store, main.key) : [],
      gapAmount: (gap.short || 0).toFixed(2),
      gapReason: ''
    });
  },

  // 切换要调剂的科目
  pickGapItem(e) {
    const key = e.currentTarget.dataset.key;
    const gap = this.data.gap;
    if (!gap || !key || key === gap.key) return;
    const row = (gap.items || []).filter(function (r) { return r.key === key; })[0];
    this.setData({
      'gap.key': key,
      'gap.keyName': row ? row.name : '',
      gapCandidates: this.candidatesFor(gap.store, key)
    });
  },

  closeGap() {
    this.setData({ gap: null, gapCandidates: [], gapAmount: '', gapReason: '' });
  },

  onGapAmount(e) {
    this.setData({ gapAmount: e.detail.value });
  },

  onGapReason(e) {
    this.setData({ gapReason: e.detail.value });
  },

  // 追加机动预算后自动重试本次核定
  submitFlex() {
    const gap = this.data.gap;
    const me = this.data.me;
    if (!gap) return;
    try {
      const state = store.loadState();
      const adj = domain.adjustFlex(state, me, this.data.gapAmount, this.data.gapReason || '预算核定缺口追加');
      const order = state.orders.filter(function (o) { return o.id === gap.orderId; })[0];
      const after = order ? domain.budgetGap(state, order) : null;
      store.saveState(state);
      store.appendAudit([{
        orderId: gap.orderId,
        kind: 'budget',
        stage: 'budget-central',
        decision: '追加机动预算',
        role: '运营管理部（' + me.id + '，模拟）',
        from: '', to: '',
        note: '机动池 ¥' + fmt.money(adj.before) + ' → ¥' + fmt.money(adj.after) +
          (adj.reason ? '；用途：' + adj.reason : '') +
          (after && !after.ok ? '；仍缺 ¥' + fmt.money(after.short) : ''),
        at: new Date().toISOString()
      }]);
      this.setData({ gap: null, gapAmount: '', gapReason: '' });
      const done = this.doDecide(gap.orderId, true, false, true);
      wx.showToast({
        title: done ? '已追加 ¥' + fmt.money(adj.amount) + '，核定通过' : '已追加 ¥' + fmt.money(adj.amount),
        icon: 'none'
      });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '追加失败', icon: 'none' });
    }
  },

  // 从同科目结余最多的门店调剂，最多补到该科目"还差"的金额，不动机动池
  applyTransfer(e) {
    const from = e.currentTarget.dataset.store;
    const gap = this.data.gap;
    if (!gap) return;
    const target = (this.data.gapCandidates || []).filter(function (c) { return c.store === from; })[0];
    if (!target) return;
    const row = (gap.items || []).filter(function (r) { return r.key === gap.key; })[0];
    const need = row ? Math.max(0, Number(row.needed) || 0) : gap.short;
    const move = Math.min(target.free, need || gap.short);
    const me = this.data.me;
    if (move <= 0) return;
    try {
      const state = store.loadState();
      domain.transferStoreBudget(state, me, from, gap.store, move, gap.key);
      store.saveState(state);
      store.appendAudit([{
        orderId: gap.orderId,
        kind: 'budget',
        stage: 'budget-central',
        decision: '门店额度调剂',
        role: '运营管理部（' + me.id + '，模拟）',
        from: '', to: '',
        note: from + ' → ' + gap.store + '「' + gap.keyName + '」调剂额度 ¥' + fmt.money(move),
        at: new Date().toISOString()
      }]);
      const st2 = store.loadState();
      const order = st2.orders.filter(function (o) { return o.id === gap.orderId; })[0];
      const g2 = order ? domain.budgetGap(st2, order) : null;
      if (g2 && g2.ok) {
        this.setData({ gap: null, gapCandidates: [] });
        const done = this.doDecide(gap.orderId, true, false, true);
        wx.showToast({
          title: done ? '已调剂 ¥' + fmt.money(move) + '，核定通过' : '已调剂 ¥' + fmt.money(move),
          icon: 'none'
        });
      } else if (g2) {
        wx.showToast({ title: '已调剂 ¥' + fmt.money(move) + '，仍缺 ¥' + fmt.money(g2.short), icon: 'none' });
        this.openGap(g2, gap.orderId);
        this.setData({ gapReason: '' });
      }
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '调剂失败', icon: 'none' });
    }
  },

  // 机动池与门店结余都补不上时，退回门店拆单或转专项采购
  rejectFromGap() {
    const gap = this.data.gap;
    if (!gap) return;
    const that = this;
    wx.showModal({
      title: '驳回并要求门店调整',
      content: '当前「门店额度 + 机动池」单笔最多可核定 ¥' + gap.maxText + '。驳回后门店可拆成多笔重下，或由运营管理部按专项采购下单。',
      confirmText: '确认驳回',
      confirmColor: '#c0392b',
      success: function (res) {
        if (!res.confirm) return;
        that.setData({ gap: null, gapAmount: '', gapReason: '' });
        that.doDecide(gap.orderId, false, false);
      }
    });
  },

  gotoDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + id });
  },

  goIdentity() {
    wx.navigateTo({ url: '/pages/identity/identity?switch=1' });
  }
});
