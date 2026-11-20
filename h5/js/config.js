/* 运行配置：换企业微信 AppID / 后端地址只需要改这里 */
window.APP_CONFIG = {
  brand: '安居乐寓物资采购管理系统',
  short: '物资采购',
  version: 'H5 1.0.0',
  // localStorage 前缀：小程序用 anju_*，H5 独立一份，互不干扰
  prefix: 'anju_h5_',

  // 企业微信自建应用配置。填写并部署后端后可关闭演示身份选择。
  wecom: {
    enabled: false,          // 置 true 后，带 code 打开会走后端换身份
    corpid: '',              // 企业 ID
    agentId: '',             // 自建应用 AgentId
    apiBase: '',             // 后端地址，例如 https://purchase.example.com/api
    entryPath: '/auth/wecom' // 后端换取身份的接口路径
  },

  // 演示环境提示
  demo: true
};
