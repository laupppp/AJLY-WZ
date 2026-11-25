// 角色权限与导航配置（演示版：身份为模拟切换，权限口径集中在本文件）
const CAPS = {
  store: ['order.create', 'order.view', 'accept', 'draft', 'stats', 'settle.submit'],
  department: ['order.create', 'order.view', 'accept', 'draft', 'stats', 'settle.submit'],
  central: ['order.create', 'order.view', 'accept', 'draft', 'stats', 'approve', 'recon', 'budget.config', 'catalog.manage'],
  region: ['order.view', 'approve', 'stats'],
  supplier: ['supply', 'order.view', 'stats', 'recon.confirm', 'settle.confirm']
};

const ROLE_META = {
  store: {
    label: '门店店长',
    tone: 'blue',
    duty: '本门店采购、验收与预算管控',
    brief: ['门店采购下单', '订单跟踪与撤销', '收货验收拍照', '结算金额确认', '本店金额看板']
  },
  department: {
    label: '职能部门采购员',
    tone: 'purple',
    duty: '本部门采购，由运营管理部统一确认',
    brief: ['部门采购下单', '按配送地点拆单', '总部/门店收货验收', '结算金额确认', '部门金额统计']
  },
  central: {
    label: '运营管理部',
    tone: 'navy',
    duty: '预算核定、物资维护、部门确认与统一对账',
    brief: ['中台操作台（物资增删改/合同上限/审批规则）', '中台自采下单', '预算核定与金额审批', '部门采购统一确认', '统一对账与锁定', '门店费用预算设置']
  },
  region: {
    label: '战区负责人',
    tone: 'teal',
    duty: '本战区订单审核、预算追加与金额审批',
    brief: ['战区订单审核', '战区预算追加审批', '战区金额审批', '战区金额看板']
  },
  supplier: {
    label: '供应商',
    tone: 'amber',
    duty: '接单、配送与对账确认',
    brief: ['确认接单 / 反馈无法接单', '选择配送方式并登记运单号', '分批发货', '结算金额确认', '对账单确认']
  }
};

// 自定义底部导航（按角色裁剪）
const TABS = {
  store: [
    { key: 'home', label: '首页', icon: '🏠', url: '/pages/index/index' },
    { key: 'catalog', label: '下单', icon: '🛒', url: '/pages/catalog/catalog' },
    { key: 'orders', label: '订单', icon: '📋', url: '/pages/orders/orders' },
    { key: 'me', label: '我的', icon: '👤', url: '/pages/identity/identity' }
  ],
  department: [
    { key: 'home', label: '首页', icon: '🏠', url: '/pages/index/index' },
    { key: 'catalog', label: '下单', icon: '🛒', url: '/pages/catalog/catalog' },
    { key: 'orders', label: '订单', icon: '📋', url: '/pages/orders/orders' },
    { key: 'me', label: '我的', icon: '👤', url: '/pages/identity/identity' }
  ],
  central: [
    { key: 'home', label: '首页', icon: '🏠', url: '/pages/index/index' },
    { key: 'catalog', label: '下单', icon: '🛒', url: '/pages/catalog/catalog' },
    { key: 'approve', label: '审批', icon: '✅', url: '/pages/approvals/approvals' },
    { key: 'reports', label: '看板', icon: '📊', url: '/pages/reports/reports' },
    { key: 'me', label: '我的', icon: '👤', url: '/pages/identity/identity' }
  ],
  region: [
    { key: 'home', label: '首页', icon: '🏠', url: '/pages/index/index' },
    { key: 'approve', label: '审批', icon: '✅', url: '/pages/approvals/approvals' },
    { key: 'orders', label: '订单', icon: '📋', url: '/pages/orders/orders' },
    { key: 'reports', label: '看板', icon: '📊', url: '/pages/reports/reports' },
    { key: 'me', label: '我的', icon: '👤', url: '/pages/identity/identity' }
  ],
  supplier: [
    { key: 'home', label: '首页', icon: '🏠', url: '/pages/index/index' },
    { key: 'supplier', label: '工作台', icon: '🚚', url: '/pages/supplier/supplier' },
    { key: 'reports', label: '对账', icon: '📊', url: '/pages/reports/reports' },
    { key: 'me', label: '我的', icon: '👤', url: '/pages/identity/identity' }
  ]
};

// 首页快捷入口（只保留该角色真正会用的）
const HOME_ENTRIES = {
  store: ['order', 'orders', 'accept', 'drafts'],
  department: ['order', 'orders', 'accept', 'drafts'],
  central: ['console', 'approve', 'budget', 'order'],
  region: ['approve', 'orders', 'reports'],
  supplier: ['supply', 'orders', 'recon']
};

const ENTRY_META = {
  order: { label: '采购下单', icon: '🛒', url: '/pages/catalog/catalog', tone: 'blue' },
  orders: { label: '我的订单', icon: '📋', url: '/pages/orders/orders', tone: 'navy' },
  accept: { label: '收货验收', icon: '📷', url: '/pages/accept/accept', tone: 'teal' },
  drafts: { label: '草稿箱', icon: '🗂', url: '/pages/drafts/drafts', tone: 'gray' },
  approve: { label: '待办审批', icon: '✅', url: '/pages/approvals/approvals', tone: 'amber' },
  recon: { label: '统一对账', icon: '🧾', url: '/pages/reports/reports?tab=recon', tone: 'violet' },
  budget: { label: '预算设置', icon: '💰', url: '/pages/budget/budget', tone: 'teal' },
  console: { label: '中台操作台', icon: '🛠️', url: '/pages/budget/budget', tone: 'navy' },
  reports: { label: '统计看板', icon: '📊', url: '/pages/reports/reports', tone: 'blue' },
  supply: { label: '供应商工作台', icon: '🚚', url: '/pages/supplier/supplier', tone: 'amber' }
};

function caps(role) {
  return CAPS[role] || [];
}

function can(me, cap) {
  if (!me || !me.role) return false;
  return caps(me.role).indexOf(cap) >= 0;
}

function roleMeta(role) {
  return ROLE_META[role] || ROLE_META.store;
}

function tabs(me) {
  return (TABS[(me && me.role) || 'store'] || TABS.store).slice();
}

function homeEntries(me) {
  const keys = HOME_ENTRIES[(me && me.role) || 'store'] || HOME_ENTRIES.store;
  return keys.map(function (key) {
    const meta = ENTRY_META[key];
    return { key: key, label: meta.label, icon: meta.icon, url: meta.url, tone: meta.tone || 'blue', badge: '' };
  });
}

// 下单上下文：门店用门店名，部门与中台用部门名
function purchaseContext(me) {
  if (!me) return '';
  if (me.role === 'store') return (me.stores || [])[0] || '';
  if (me.role === 'department' || me.role === 'central') return me.department || '';
  return '';
}

// 是否走"部门采购单"（多配送点、由运营管理部统一确认）
function isDepartmentFlow(me) {
  return !!me && (me.role === 'department' || me.role === 'central');
}

// 无权访问时的兜底提示
function guard(me, cap, redirectHome) {
  if (can(me, cap)) return true;
  const meta = roleMeta(me && me.role);
  wx.showModal({
    title: '当前身份无此权限',
    content: meta.label + '可使用：' + meta.brief.join('、') + '。',
    showCancel: false,
    success: function () {
      if (redirectHome !== false) wx.reLaunch({ url: '/pages/index/index' });
    }
  });
  return false;
}

module.exports = {
  CAPS, ROLE_META, TABS, ENTRY_META,
  caps, can, roleMeta, tabs, homeEntries, purchaseContext, isDepartmentFlow, guard
};
