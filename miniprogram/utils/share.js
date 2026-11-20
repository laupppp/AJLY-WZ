// 统一的转发配置：所有页面共用同一套品牌文案，转发一律回到首页
// 避免对方点开卡片落在需要订单号的详情页而白屏
const TITLE = '安居乐寓物资采购管理系统';
const PATH = '/pages/index/index';

function handler() {
  return { title: TITLE, path: PATH };
}

module.exports = { TITLE, PATH, handler };
