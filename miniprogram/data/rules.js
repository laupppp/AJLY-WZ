// 可由运营管理部在「中台操作台」维护的规则默认值（纯数据，H5 与小程序共用）
// 实际生效值存放在 state.approvalConfig / state.contracts，缺省时回落到这里。

// 门店下单审批规则
const APPROVAL_DEFAULT = {
  autoMax: 500,          // 小额上限（元）：≤ 此金额且在预算内的单可批量通过 / 可选免审直发
  regionMax: 2000,       // 战区终审上限（元）：超过即需运营管理部金额审批
  splitGuard: true,      // 防拆单：按「近 N 天同门店同科目累计金额」定档
  splitDays: 3,          // 防拆单统计窗口（天）
  autoSkipReview: false  // 小额且预算内的单是否免战区审核直接发送供应商（默认关闭）
};

const APPROVAL_LIMITS = {
  autoMax: [0, 100000],
  regionMax: [1, 1000000],
  splitDays: [1, 31]
};

// 职能部门采购不设预算，但按供应商合同总额封顶（含运营管理部自采）
// 演示数据：真实合同编号 / 金额请在中台操作台维护
const CONTRACTS_DEFAULT = [
  {
    id: 'HT-2026-001',
    supplier: '运营物资供应商（演示）',
    name: '2026 年度运营物资采购合同（客诉预算 / 社群活动预算）',
    total: 300000,
    start: '2026-01-01',
    end: '2026-12-31',
    note: ''
  },
  {
    id: 'HT-2026-002',
    supplier: '广告印刷供应商（待确认）',
    name: '2026 年度印刷品物料采购合同（营销预算）',
    total: 150000,
    start: '2026-01-01',
    end: '2026-12-31',
    note: ''
  }
];

module.exports = { APPROVAL_DEFAULT, APPROVAL_LIMITS, CONTRACTS_DEFAULT };
