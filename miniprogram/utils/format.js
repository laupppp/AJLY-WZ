// 通用格式化与状态字典（口径与 V1.24 网页端一致）
const STATUS_MAP = {
  'order-review': { label: '待战区审核', cls: 'warn' },
  'budget-region': { label: '待战区预算审批', cls: 'warn' },
  'budget-central': { label: '待运营管理部核定预算', cls: 'warn' },
  'amount-approval': { label: '待金额审批', cls: 'warn' },
  'dept-approval': { label: '待运营管理部确认', cls: 'warn' },
  'supplier': { label: '待供应商接单', cls: 'info' },
  'preparing': { label: '备货中', cls: 'info' },
  'delivering': { label: '配送中', cls: 'teal' },
  'delivered': { label: '已送达待验收', cls: 'teal' },
  'partial': { label: '部分验收', cls: 'teal' },
  'settle-pending': { label: '待门店确认结算', cls: 'violet' },
  'settle-supplier': { label: '待供应商确认结算', cls: 'violet' },
  'settle-disputed': { label: '结算有差异待重提', cls: 'bad' },
  'accepted': { label: '结算已确认待对账', cls: 'dark' },
  'done': { label: '已完成', cls: 'good' },
  'rejected': { label: '已驳回', cls: 'bad' },
  'cancelled': { label: '已撤销', cls: 'gray' }
};

const FLOW_LABEL = {
  'order-review': '战区负责人审核订单',
  'budget-region': '战区预算追加审批',
  'budget-central': '运营管理部预算核定',
  'amount-approval': '采购金额审批',
  'dept-approval': '运营管理部确认部门采购',
  'supplier': '已发送供应商待接单',
  'preparing': '供应商备货中',
  'delivering': '供应商配送中',
  'delivered': '已送达',
  'partial': '部分验收',
  'settle-pending': '门店核对实际结算金额',
  'settle-supplier': '供应商确认结算金额',
  'settle-disputed': '供应商提出结算差异',
  'accepted': '结算金额已确认',
  'done': '对账完成',
  'rejected': '审批驳回',
  'cancelled': '订单撤销'
};

const ROLE_LABEL = {
  store: '门店店长',
  region: '战区负责人',
  central: '运营管理部',
  supplier: '供应商',
  department: '职能部门采购员'
};

// 所有门店单先经战区审核；金额分级决定审核之后是否再走中台金额审批（500-2000元战区一步终审）
const TIER_LABEL = {
  auto: '500元以内 · 战区一步审核直发',
  region: '500-2000元 · 战区一步终审（含金额）',
  central: '2000元以上 · 战区审核 + 中台金额审批',
  department: '部门采购 · 运管确认（合同总额上限）'
};

function statusLabel(status) {
  const item = STATUS_MAP[status];
  return item ? item.label : (status || '未知状态');
}

function statusCls(status) {
  const item = STATUS_MAP[status];
  return item ? item.cls : 'gray';
}

function money(value) {
  const n = Number(value || 0);
  const fixed = Math.round(n * 100) / 100;
  const parts = String(fixed).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function money2(value) {
  return Number(value || 0).toFixed(2);
}

function hoursText(hours) {
  if (hours < 1) return Math.max(1, Math.round(hours * 60)) + '分钟';
  if (hours < 24) return hours.toFixed(1) + '小时';
  return (hours / 24).toFixed(1) + '天';
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function nowText() {
  const d = new Date();
  return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function fullTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function shortTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function fromNow(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return mins + '分钟前';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + '小时前';
  return Math.floor(hours / 24) + '天前';
}

function phaseOf(order) {
  return FLOW_LABEL[order.status] || statusLabel(order.status);
}

module.exports = {
  STATUS_MAP, FLOW_LABEL, ROLE_LABEL, TIER_LABEL,
  statusLabel, statusCls, money, money2, hoursText, nowText, fullTime, shortTime, fromNow, phaseOf
};
