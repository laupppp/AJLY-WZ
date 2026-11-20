const session = require('../../utils/session');
const perm = require('../../utils/perm');

Component({
  properties: {
    active: { type: String, value: 'home' }
  },
  data: {
    tabs: [],
    activeKey: 'home'
  },
  lifetimes: {
    attached() {
      this.sync();
    }
  },
  pageLifetimes: {
    show() {
      this.sync();
    }
  },
  methods: {
    sync() {
      const tabs = perm.tabs(session.current());
      let activeKey = this.properties.active;
      // 页面路径优先，避免同一页面在不同角色下高亮错位
      const stack = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const route = stack.length ? '/' + stack[stack.length - 1].route : '';
      const hit = tabs.filter(function (t) { return t.url.split('?')[0] === route; })[0];
      if (hit) activeKey = hit.key;
      this.setData({ tabs: tabs, activeKey: activeKey });
    },
    onTap(e) {
      const item = e.currentTarget.dataset.item;
      if (!item || item.key === this.data.activeKey) return;
      wx.reLaunch({ url: item.url });
    }
  }
});
