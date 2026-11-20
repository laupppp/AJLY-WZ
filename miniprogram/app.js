const store = require('./utils/store');

App({
  globalData: {
    appName: '安居乐寓物资采购管理系统',
    version: 'V1.24 演示版',
    checkoutDraft: null
  },
  onLaunch() {
    store.ensureState();
  }
});
