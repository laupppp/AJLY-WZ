// 预算设置（仅运营管理部）：按门店维护 房间数 / 科目系数 / 直接定额
const share = require('../../utils/share');
const store = require('../../utils/store');
const session = require('../../utils/session');
const domain = require('../../utils/domain');
const perm = require('../../utils/perm');
const fmt = require('../../utils/format');
const BUDGET = require('../../data/budget');
const { STORES } = require('../../data/catalog');

Page({
  onShareAppMessage: share.handler,
  data: {
    me: null,
    keyword: '',
    flexText: '0',
    list: [],
    visible: [],
    limit: 12,
    editing: '',
    form: { rooms: '', items: [] }
  },

  onShow() {
    const me = session.current();
    if (!perm.guard(me, 'budget.config')) return;
    this.setData({ me: me });
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh();
    wx.stopPullDownRefresh();
  },

  refresh() {
    const state = store.loadState();
    const summary = domain.budgetSummary(state, this.data.me);
    const usedOf = {};
    summary.forEach(function (r) { usedOf[r.store] = r; });

    const kw = String(this.data.keyword || '').trim();
    const list = STORES.filter(function (s) {
      return !kw || s.indexOf(kw) >= 0;
    }).map(function (s) {
      const cfg = domain.budgetConfigOf(state, s);
      const used = usedOf[s];
      return {
        store: s,
        rooms: cfg.rooms,
        totalText: fmt.money(cfg.total),
        usedText: used ? fmt.money(used.used) : '0',
        pct: used ? used.usedPct : 0,
        items: cfg.items.map(function (it) {
          return {
            key: it.key,
            name: it.name,
            budgetText: fmt.money(it.budget),
            coef: it.coef,
            basis: it.basis,
            basisText: it.basis === 'override' ? '直接定额' : it.coef + ' 元/间'
          };
        })
      };
    });

    this.allList = list;
    this.setData({
      list: list,
      visible: list.slice(0, this.data.limit),
      flexText: fmt.money(state.flex)
    });
  },

  more() {
    const limit = this.data.limit + 20;
    this.setData({ limit: limit, visible: (this.allList || []).slice(0, limit) });
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value });
    this.refresh();
  },

  toggle(e) {
    const name = e.currentTarget.dataset.store;
    if (this.data.editing === name) {
      this.setData({ editing: '', form: { rooms: '', items: [] } });
      return;
    }
    const state = store.loadState();
    const cfg = domain.budgetConfigOf(state, name);
    this.setData({
      editing: name,
      form: {
        rooms: String(cfg.rooms),
        items: cfg.items.map(function (it) {
          return {
            key: it.key,
            name: it.name,
            coef: String(it.coef),
            override: it.override === null ? '' : String(it.override),
            budgetText: fmt.money(it.budget),
            adjustText: it.adjust ? fmt.money(it.adjust) : ''
          };
        })
      }
    });
  },

  onForm(e) {
    const key = String(e.currentTarget.dataset.key || '');
    const val = e.detail.value;
    if (key === 'rooms') {
      this.setData({ 'form.rooms': val });
      return;
    }
    const m = key.match(/^(coef|override)-(.+)$/);
    if (!m) return;
    const idx = this.data.form.items.findIndex(function (x) { return x.key === m[2]; });
    if (idx < 0) return;
    this.setData({ ['form.items[' + idx + '].' + m[1]]: val });
  },

  // 恢复默认：清掉门店系数覆盖与直接定额，回到「房间数 × 全局系数」
  resetStore(e) {
    const name = e.currentTarget.dataset.store || this.data.editing;
    const that = this;
    wx.showModal({
      title: '恢复默认预算',
      content: '将清除「' + name + '」的科目系数覆盖与直接定额，改为按房间数 × 默认系数计算。机动池追加/调剂不影响。',
      confirmText: '恢复',
      success: function (res) {
        if (!res.confirm) return;
        try {
          const state = store.loadState();
          const payload = { store: name, coef: {}, override: {} };
          BUDGET.KEYS.forEach(function (k) {
            payload.coef[k] = null;
            payload.override[k] = null;
          });
          domain.saveBudgetConfig(state, that.data.me, payload);
          store.saveState(state);
          wx.showToast({ title: '已恢复默认', icon: 'none' });
          that.setData({ editing: '' });
          that.refresh();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '恢复失败', icon: 'none' });
        }
      }
    });
  },

  save(e) {
    const name = e.currentTarget.dataset.store || this.data.editing;
    const form = this.data.form;
    const payload = { store: name, rooms: Number(form.rooms), coef: {}, override: {} };
    form.items.forEach(function (it) {
      const coef = String(it.coef === undefined ? '' : it.coef).trim();
      const ov = String(it.override === undefined ? '' : it.override).trim();
      payload.coef[it.key] = coef === '' ? null : Number(coef);
      payload.override[it.key] = ov === '' ? null : Number(ov);
    });
    try {
      const state = store.loadState();
      const res = domain.saveBudgetConfig(state, this.data.me, payload);
      store.saveState(state);
      store.appendAudit([{
        orderId: '',
        kind: 'budget',
        stage: 'budget-config',
        decision: '调整门店预算',
        role: '运营管理部（' + this.data.me.id + '，模拟）',
        from: '', to: '',
        note: name + '：' + res.changed.join('，'),
        at: new Date().toISOString()
      }]);
      wx.showToast({ title: '已保存', icon: 'success' });
      const cfg = domain.budgetConfigOf(store.loadState(), name);
      this.setData({
        form: {
          rooms: String(cfg.rooms),
          items: cfg.items.map(function (it) {
            return {
              key: it.key,
              name: it.name,
              coef: String(it.coef),
              override: it.override === null ? '' : String(it.override),
              budgetText: fmt.money(it.budget),
              adjustText: it.adjust ? fmt.money(it.adjust) : ''
            };
          })
        }
      });
      this.refresh();
    } catch (err) {
      wx.showModal({ title: '保存失败', content: (err && err.message) || '请检查输入', showCancel: false });
    }
  }
});
