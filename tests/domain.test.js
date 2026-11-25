const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../miniprogram/utils/domain');
const { SEED_STATE } = require('../miniprogram/data/seed');

const clone = (v) => JSON.parse(JSON.stringify(v));

const S = { id: 'TEST-STORE-A', name: '测试店长 A', role: 'store', zone: '第一战区', stores: ['安居瑞龙苑店', '萃云阁店'] };
const R = { id: 'TEST-REGION-A', name: '第一战区负责人', role: 'region', zone: '第一战区', stores: [] };
const C = { id: 'TEST-CENTRAL', name: '运营管理部（中台）', role: 'central', department: '运营管理部', zone: null, stores: [] };
const D = { id: 'TEST-DEPT-01', name: '职能部门采购员', role: 'department', department: '人力资源部', zone: null, stores: [] };
const SUP1 = { id: 'TEST-SUPPLIER-1', name: '运营物资供应商（演示）', role: 'supplier', supplier: '运营物资供应商（演示）' };
const SUP2 = { id: 'TEST-SUPPLIER-2', name: '广告印刷供应商（待确认）', role: 'supplier', supplier: '广告印刷供应商（待确认）' };

function approveToSupplier(st, order) {
  if (order.status === 'order-review') {
    domain.approveOrder(st, R, { orderId: order.id, stage: 'order-review', pass: true });
  }
  if (order.status === 'budget-central') {
    domain.approveOrder(st, C, { orderId: order.id, stage: 'budget-central', pass: true });
  }
  if (order.status === 'amount-approval') {
    const actor = order.tier === 'region' ? R : C;
    domain.approveOrder(st, actor, { orderId: order.id, stage: 'amount-approval', pass: true });
  }
  assert.equal(order.status, 'supplier');
}

function shipAll(st, order, sup) {
  domain.supplierAck(st, sup, { orderId: order.id, action: 'confirm' });
  const lines = order.items.filter((x) => x.supplier === sup.supplier).map((x) => ({ id: x.id, qty: x.qty }));
  domain.supplierDeliver(st, sup, { orderId: order.id, lines, shipping: { method: 'self', contact: '司机' } });
  return lines;
}

test('1. 关闭订单后禁止接单、撤回拒单或发货，且保留原状态审计', () => {
  const st = clone(SEED_STATE);
  // SQ-0010 在种子数据中处于 preparing 状态
  const res = domain.closeOrder(st, C, { orderId: 'SQ-0010', reason: '供应商产能不足取消' });
  assert.equal(res.order.status, 'cancelled');
  assert.equal(res.audit.from, 'preparing');

  assert.throws(() => domain.supplierDeliver(st, SUP2, {
    orderId: 'SQ-0010',
    lines: [{ id: 'AD-006', qty: 1 }],
    shipping: { method: 'self', contact: 'x' }
  }), /不允许登记发货/);

  assert.throws(() => domain.supplierAck(st, SUP2, {
    orderId: 'SQ-0010',
    action: 'confirm'
  }), /不允许接单/);

  assert.throws(() => domain.reopenSupplierAck(st, SUP2, {
    orderId: 'SQ-0010'
  }), /不允许撤回拒单/);
});

test('2. 多供应商订单结算须所有供应商各自确认后方进入待对账', () => {
  const st = clone(SEED_STATE);
  const { order } = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 1 }, { id: 'AD-006', qty: 1 }],
    details: { address: '萃云阁店收货区', receiver: '店长' }
  });
  approveToSupplier(st, order);

  [SUP1, SUP2].forEach((sup) => {
    const lines = shipAll(st, order, sup);
    domain.acceptDelivery(st, S, {
      orderId: order.id, supplier: sup.supplier, batchNo: 1,
      result: 'pass', lines, photoPath: 'demo.jpg', specChecked: true
    });
  });
  assert.equal(order.status, 'settle-pending');

  domain.submitSettlement(st, S, { orderId: order.id, amount: 150, reason: '双方协商折让测试' });
  assert.equal(order.status, 'settle-supplier');

  // 仅 SUP1 确认时不能提前变成 accepted，且 SUP2 仍应看到该待确认结算
  const r1 = domain.settleAction(st, SUP1, { orderId: order.id, action: 'confirm' });
  assert.equal(r1.allConfirmed, false);
  assert.equal(order.status, 'settle-supplier');
  assert.equal(domain.pendingSettleOrders(st, SUP1).some((x) => x.id === order.id), false);
  assert.equal(domain.pendingSettleOrders(st, SUP2).some((x) => x.id === order.id), true);

  // SUP2 确认后进入 accepted
  const r2 = domain.settleAction(st, SUP2, { orderId: order.id, action: 'confirm' });
  assert.equal(r2.allConfirmed, true);
  assert.equal(order.status, 'accepted');
  assert.equal(order.settlement.status, 'confirmed');
});

test('3. 部分验收且未完成结算确认的订单不得纳入对账', () => {
  const st = clone(SEED_STATE);
  const { order } = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 2 }],
    details: { address: '萃云阁店', receiver: '店长' }
  });
  approveToSupplier(st, order);
  domain.supplierAck(st, SUP1, { orderId: order.id, action: 'confirm' });
  domain.supplierDeliver(st, SUP1, {
    orderId: order.id, lines: [{ id: 'OP-001', qty: 1 }],
    shipping: { method: 'self', contact: '司机' }
  });
  domain.acceptDelivery(st, S, {
    orderId: order.id, supplier: SUP1.supplier, batchNo: 1,
    result: 'pass', lines: [{ id: 'OP-001', qty: 1 }], photoPath: 'demo.jpg', specChecked: true
  });
  assert.equal(order.status, 'partial');

  assert.throws(() => domain.createReconciliation(st, C, {
    supplier: SUP1.supplier, period: '2026-11'
  }), /没有待对账/);
});

test('4. 短收结案：按实收数量结案释放预算，并完成结算与对账锁定', () => {
  const st = clone(SEED_STATE);
  const before = domain.storeUsableCents(st, '萃云阁店', null, 'customer') / 100;
  const { order } = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 2 }], // ¥250
    details: { address: '萃云阁店', receiver: '店长' }
  });
  approveToSupplier(st, order);
  shipAll(st, order, SUP1);
  domain.acceptDelivery(st, S, {
    orderId: order.id, supplier: SUP1.supplier, batchNo: 1,
    result: 'pass', lines: [{ id: 'OP-001', qty: 1 }], photoPath: 'demo.jpg', specChecked: true
  });
  assert.equal(order.status, 'partial');
  assert.equal(before - domain.storeUsableCents(st, '萃云阁店', null, 'customer') / 100, 250);

  // 短收结案（少收 1 件不再补发）
  domain.finalizeShortDelivery(st, S, { orderId: order.id, reason: '剩余1件运输破损不再补发' });
  assert.equal(order.status, 'settle-pending');
  assert.equal(order.total, 125);
  assert.equal(order.items[0].qty, 1);
  assert.equal(before - domain.storeUsableCents(st, '萃云阁店', null, 'customer') / 100, 125);

  domain.submitSettlement(st, S, { orderId: order.id, amount: 125, reason: '' });
  domain.settleAction(st, SUP1, { orderId: order.id, action: 'confirm' });
  assert.equal(order.status, 'accepted');

  const { recon } = domain.createReconciliation(st, C, { supplier: SUP1.supplier, period: '2026-11' });
  domain.reconAction(st, SUP1, { reconId: recon.id, action: 'confirm' });
  domain.reconAction(st, C, { reconId: recon.id, action: 'lock' });
  assert.equal(order.status, 'done');
});

test('5. 结算确认存在折让时，预算实际扣减按最终结算金额而非订单原价', () => {
  const st = clone(SEED_STATE);
  const before = domain.storeUsableCents(st, '萃云阁店', null, 'customer') / 100;
  const { order } = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 2 }], // ¥250
    details: { address: '萃云阁店', receiver: '店长' }
  });
  approveToSupplier(st, order);
  const lines = shipAll(st, order, SUP1);
  domain.acceptDelivery(st, S, {
    orderId: order.id, supplier: SUP1.supplier, batchNo: 1,
    result: 'pass', lines, photoPath: 'demo.jpg', specChecked: true
  });
  domain.submitSettlement(st, S, { orderId: order.id, amount: 50, reason: '外包装严重破损折让200元' });
  domain.settleAction(st, SUP1, { orderId: order.id, action: 'confirm' });
  const after = domain.storeUsableCents(st, '萃云阁店', null, 'customer') / 100;
  assert.equal(Math.round((before - after) * 100) / 100, 50);
});

test('6. 门店审批去重：500-2000元战区一步终审，超预算中台一步核定，超上限下单拦截', () => {
  const st = clone(SEED_STATE);
  // (a) <= 500：战区一步审核直发
  const small = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 2 }], // ¥250
    details: { address: 'a', receiver: 'b' }
  }).order;
  assert.equal(small.tier, 'auto');
  domain.approveOrder(st, R, { orderId: small.id, stage: 'order-review', pass: true });
  assert.equal(small.status, 'supplier');

  // 清理同店累计以免影响后续单笔测试
  st.orders = [];

  // (b) 500-2000：战区一步终审（不再进 amount-approval）
  const mid = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 6 }], // ¥750
    details: { address: 'a', receiver: 'b' }
  }).order;
  assert.equal(mid.tier, 'region');
  domain.approveOrder(st, R, { orderId: mid.id, stage: 'order-review', pass: true });
  assert.equal(mid.status, 'supplier');

  st.orders = [];

  // (c) > 2000（预算内）：战区审核 -> 中台金额审批 -> 供应商
  const big = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 17 }], // ¥2125
    details: { address: 'a', receiver: 'b' }
  }).order;
  assert.equal(big.tier, 'central');
  domain.approveOrder(st, R, { orderId: big.id, stage: 'order-review', pass: true });
  assert.equal(big.status, 'amount-approval');
  domain.approveOrder(st, C, { orderId: big.id, stage: 'amount-approval', pass: true });
  assert.equal(big.status, 'supplier');

  st.orders = [];

  // (d) 超预算但在机动池可核定上限内：战区审核 -> 中台一步核定兼金额审批 -> 供应商
  const over = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 80 }], // ¥10000，超 9400 可用 ¥600 <= flex ¥20000
    details: { address: 'a', receiver: 'b', overReason: '周年庆活动批量采购礼品' }
  }).order;
  assert.equal(over.overPending, true);
  domain.approveOrder(st, R, { orderId: over.id, stage: 'order-review', pass: true });
  assert.equal(over.status, 'budget-central');
  domain.approveOrder(st, C, { orderId: over.id, stage: 'budget-central', pass: true });
  assert.equal(over.status, 'supplier');
  assert.equal(over.centralApproved, true);

  // (e) 超出「门店可用 + 机动池」可核定上限：下单直接拦截
  const qHard = domain.computeQuote(st, { store: '萃云阁店', items: [{ id: 'OP-001', qty: 300 }] });
  assert.equal(qHard.hardOver, true);
  assert.throws(() => domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 300 }],
    details: { address: 'a', receiver: 'b', overReason: '超额采购尝试' }
  }), /可核定上限/);
});

test('7. 小额免战区审核开关（autoSkipReview）生效', () => {
  const st = clone(SEED_STATE);
  st.orders = [];
  const resCfg = domain.saveApprovalConfig(st, C, { autoSkipReview: true });
  assert.ok(resCfg.audit && resCfg.audit.kind === 'rules');

  const { order } = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 1 }], // ¥125 <= 500
    details: { address: 'a', receiver: 'b' }
  });
  assert.equal(order.status, 'supplier');
  assert.equal(order.regionApproved, true);
});

test('8. 防拆单累计定档：同门店同科目连续小额单触发升级，跨科目与关闭开关不误升', () => {
  const st = clone(SEED_STATE);
  st.orders = [];

  // 第 1 单：customer 科目 ¥375 -> auto
  const o1 = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 3 }],
    details: { address: 'a', receiver: 'b' }
  }).order;
  assert.equal(o1.tier, 'auto');

  // 第 2 单：同门店同科目 ¥250 -> 累计 ¥625 > 500 -> 升级为 region
  const q2 = domain.computeQuote(st, { store: '萃云阁店', items: [{ id: 'OP-001', qty: 2 }] });
  assert.equal(q2.splitUpgraded, true);
  assert.equal(q2.tier, 'region');

  // 第 3 单：同门店不同科目（marketing：AD-006 ¥90）-> 该科目累计仅 ¥90 -> 不误升
  const qOtherCat = domain.computeQuote(st, { store: '萃云阁店', items: [{ id: 'AD-006', qty: 2 }] });
  assert.equal(qOtherCat.splitUpgraded, false);
  assert.equal(qOtherCat.tier, 'auto');

  // 关闭防拆单后，恢复按单笔金额定档
  domain.saveApprovalConfig(st, C, { splitGuard: false });
  const qOff = domain.computeQuote(st, { store: '萃云阁店', items: [{ id: 'OP-001', qty: 2 }] });
  assert.equal(qOff.splitUpgraded, false);
  assert.equal(qOff.tier, 'auto');
});

test('9. 审批驳回必填原因、微调数量重算及预算内批量通过', () => {
  const st = clone(SEED_STATE);
  st.orders = [];

  // 1) 驳回必填原因 + 留存 rejectReason
  const o1 = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 3 }], // ¥375
    details: { address: 'a', receiver: 'b' }
  }).order;
  assert.throws(() => domain.approveOrder(st, R, {
    orderId: o1.id, stage: 'order-review', pass: false, requireReason: true, note: '无'
  }), /驳回原因/);
  domain.approveOrder(st, R, {
    orderId: o1.id, stage: 'order-review', pass: false, requireReason: true, note: '库存尚充足暂缓采购'
  });
  assert.equal(o1.status, 'rejected');
  assert.equal(o1.rejectReason, '库存尚充足暂缓采购');

  // 2) 审批时微调数量
  const o2 = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 3 }],
    details: { address: 'a', receiver: 'b' }
  }).order;
  domain.approveOrder(st, R, {
    orderId: o2.id, stage: 'order-review', pass: true,
    adjustQuantities: { 'OP-001': 1 }, note: '减为1个'
  });
  assert.equal(o2.items[0].qty, 1);
  assert.equal(o2.total, 125);
  assert.equal(o2.status, 'supplier');

  // 3) 预算内批量通过，跳过超预算订单
  const inBudget = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 1 }],
    details: { address: 'a', receiver: 'b' }
  }).order;
  const overBudget = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 80 }],
    details: { address: 'a', receiver: 'b', overReason: '超额备用' }
  }).order;
  const batchRes = domain.batchApproveOrders(st, R, {});
  assert.equal(batchRes.count, 1);
  assert.equal(inBudget.status, 'supplier');
  assert.equal(overBudget.status, 'order-review');
});

test('10. 职能部门与中台自采不设预算，但受供应商合同总额上限管控', () => {
  const st = clone(SEED_STATE);
  // HT-2026-001 合同总额 ¥300,000；尝试下单 OP-001 × 2500（¥312,500）应被拦截
  assert.throws(() => domain.createDepartmentOrders(st, D, {
    destinations: [{
      type: 'office', name: '公司总部', address: '总部前台', receiver: '行政',
      items: [{ id: 'OP-001', qty: 2500 }]
    }]
  }), /合同总额上限/);

  // 中台自采同样受合同总额上限约束
  assert.throws(() => domain.createDepartmentOrders(st, C, {
    destinations: [{
      type: 'office', name: '公司总部', address: '总部前台', receiver: '中台',
      items: [{ id: 'OP-001', qty: 2500 }]
    }]
  }), /合同总额上限/);

  // 中台调高合同总额后即可正常提交
  const ctRes = domain.saveContract(st, C, {
    id: 'HT-2026-001', supplier: '运营物资供应商（演示）', total: 400000
  });
  assert.ok(ctRes.audit && ctRes.audit.kind === 'contract');
  const deptRes = domain.createDepartmentOrders(st, D, {
    destinations: [{
      type: 'office', name: '公司总部', address: '总部前台', receiver: '行政',
      items: [{ id: 'OP-001', qty: 2500 }]
    }]
  });
  assert.equal(deptRes.orders[0].status, 'dept-approval');
});

test('11. 中台操作台物资增删改、上下架、在途保护与权限控制', () => {
  const st = clone(SEED_STATE);

  // 非中台角色全部拒绝
  [S, R, D, SUP1].forEach((actor) => {
    assert.throws(() => domain.saveCatalogItem(st, actor, {
      name: '非法新增', category: '日常运营耗材', price: 10, supplier: '运营物资供应商（演示）'
    }), /仅运营管理部/);
    assert.throws(() => domain.toggleCatalogItem(st, actor, { id: 'OP-001' }), /仅运营管理部/);
    assert.throws(() => domain.deleteCatalogItem(st, actor, 'OP-001'), /仅运营管理部/);
    assert.throws(() => domain.saveContract(st, actor, { supplier: 'x', total: 100 }), /仅运营管理部/);
    assert.throws(() => domain.saveApprovalConfig(st, actor, { autoMax: 600 }), /仅运营管理部/);
  });

  // 1) 新增物资（自动生成编号 + 返回审计）
  const added = domain.saveCatalogItem(st, C, {
    name: '定制门禁卡套',
    category: '员工物资',
    unit: '套',
    price: 18.5,
    spec: '硅胶防摔款',
    supplier: '运营物资供应商（演示）'
  });
  assert.equal(added.created, true);
  assert.match(added.item.id, /^WZ-\d{3,}$/);
  assert.equal(added.audit.decision, '新增物资');

  // 新物资立即可试算下单
  const newId = added.item.id;
  const q1 = domain.computeQuote(st, { store: '萃云阁店', items: [{ id: newId, qty: 2 }] });
  assert.equal(q1.total, 37);

  // 2) 编辑价格立即生效
  const edited = domain.saveCatalogItem(st, C, {
    isEdit: true,
    id: newId,
    name: '定制门禁卡套（升级版）',
    category: '员工物资',
    unit: '套',
    price: 20,
    spec: '加厚硅胶',
    supplier: '运营物资供应商（演示）'
  });
  assert.equal(edited.created, false);
  assert.equal(domain.computeQuote(st, { store: '萃云阁店', items: [{ id: newId, qty: 2 }] }).total, 40);

  // 3) 下架后不能下单，重新上架恢复
  const tOff = domain.toggleCatalogItem(st, C, { id: newId, enabled: false });
  assert.equal(tOff.enabled, false);
  assert.throws(() => domain.computeQuote(st, { store: '萃云阁店', items: [{ id: newId, qty: 1 }] }), /已下架/);
  domain.toggleCatalogItem(st, C, { id: newId, enabled: true });

  // 4) 有在途订单引用时禁止删除，订单撤销后允许删除并可恢复
  const { order } = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: newId, qty: 1 }],
    details: { address: 'a', receiver: 'b' }
  });
  assert.throws(() => domain.deleteCatalogItem(st, C, newId), /在途订单/);

  domain.cancelOrder(st, S, order.id);
  const delRes = domain.deleteCatalogItem(st, C, newId);
  assert.equal(delRes.audit.decision, '删除物资');
  assert.throws(() => domain.computeQuote(st, { store: '萃云阁店', items: [{ id: newId, qty: 1 }] }), /未找到/);

  const restRes = domain.restoreCatalogItem(st, C, newId);
  assert.equal(restRes.audit.decision, '恢复物资');
  assert.equal(domain.computeQuote(st, { store: '萃云阁店', items: [{ id: newId, qty: 1 }] }).total, 20);
});

test('12. 状态经 JSON 序列化落盘后，自定义物资/合同/审批规则与审计结构保持一致', () => {
  const st = clone(SEED_STATE);
  const addRes = domain.saveCatalogItem(st, C, {
    id: 'WZ-TEST-99',
    name: '临时活动立牌',
    category: '宣传印刷物料',
    budgetItem: 'community',
    unit: '块',
    price: 88,
    supplier: '广告印刷供应商（待确认）'
  });
  const editRes = domain.saveCatalogItem(st, C, {
    isEdit: true,
    id: 'WZ-TEST-99',
    name: '临时活动立牌',
    category: '宣传印刷物料',
    budgetItem: '', // 恢复按大类自动归属（营销费）
    unit: '块',
    price: 90,
    supplier: '广告印刷供应商（待确认）'
  });
  const togRes = domain.toggleCatalogItem(st, C, { id: 'WZ-TEST-99', enabled: false });
  assert.equal(togRes.audit.decision, '下架物资');
  domain.toggleCatalogItem(st, C, { id: 'WZ-TEST-99', enabled: true });

  [addRes.audit, editRes.audit, togRes.audit].forEach((a) => {
    assert.equal(a.kind, 'catalog');
    assert.ok(a.stage && a.decision && a.role && a.note && a.at);
  });

  // 模拟 localStorage JSON.stringify -> JSON.parse
  const persisted = clone(st);
  const q = domain.computeQuote(persisted, { store: '萃云阁店', items: [{ id: 'WZ-TEST-99', qty: 1 }] });
  assert.equal(q.total, 90);
  // 清除 budgetItem 后应按大类「印刷品物料」回落到 marketing（营销预算）
  assert.equal(q.budgetItems[0].key, 'marketing');
});

test('13. 物资三类加社区活动服务独立目录，并正确对应预算科目', () => {
  const { CATALOG, CATEGORY_ORDER } = require('../miniprogram/data/catalog');
  const BUDGET = require('../miniprogram/data/budget');
  assert.deepEqual(CATEGORY_ORDER, ['社群活动物资', '客诉维护物资', '印刷品物料', '社区活动服务']);
  assert.equal(CATALOG.length, 278 + 223 + 112);

  const expectedBudget = {
    '社群活动物资': 'community',
    '客诉维护物资': 'customer',
    '印刷品物料': 'marketing',
    '社区活动服务': 'community'
  };
  CATALOG.forEach((p) => {
    assert.ok(CATEGORY_ORDER.indexOf(p.category) >= 0, '未归入有效采购大类: ' + p.id + ' ' + p.category);
    assert.equal(BUDGET.itemOf(p), expectedBudget[p.category], '预算科目不匹配: ' + p.id);
    if (p.category === '印刷品物料') {
      assert.equal(p.supplier, '广告印刷供应商（待确认）');
    } else if (p.category === '社区活动服务') {
      assert.equal(p.supplier, '社区活动策划服务商（待确认）');
      assert.equal(p.demoOnly, true);
    } else {
      assert.equal(p.supplier, '运营物资供应商（演示）');
    }
  });
});

test('14. 跨合同混单按合同自动拆单，且不拆单场景支持分供应商独立结算金额对账', () => {
  const st = clone(SEED_STATE);
  st.orders = [];

  // 1) splitByContract: true 自动按两份框架合同拆成 2 笔独立单
  const splitRes = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    splitByContract: true,
    items: [{ id: 'OP-001', qty: 1 }, { id: 'AD-006', qty: 2 }], // SUP1 ¥125, SUP2 ¥90
    details: { address: '萃云阁店收货区', receiver: '店长' }
  });
  assert.equal(splitRes.splitByContract, true);
  assert.equal(splitRes.orders.length, 2);
  assert.ok(splitRes.groupId && splitRes.groupId.startsWith('SG-'));
  assert.notEqual(splitRes.orders[0].id, splitRes.orders[1].id);
  assert.equal(splitRes.orders[0].items.every((x) => x.supplier === SUP1.supplier), true);
  assert.equal(splitRes.orders[1].items.every((x) => x.supplier === SUP2.supplier), true);

  // 2) 未开启拆单时的混合订单，支持按供应商分别填写结算金额（bySupplier）
  st.orders = [];
  const mixed = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 2 }, { id: 'AD-006', qty: 2 }], // SUP1 ¥250, SUP2 ¥90
    details: { address: '萃云阁店', receiver: '店长' }
  }).order;
  approveToSupplier(st, mixed);
  [SUP1, SUP2].forEach((sup) => {
    const ls = shipAll(st, mixed, sup);
    domain.acceptDelivery(st, S, {
      orderId: mixed.id, supplier: sup.supplier, batchNo: 1,
      result: 'pass', lines: ls, photoPath: 'demo.jpg', specChecked: true
    });
  });

  // SUP1 发生 50 元折让（实结 200），SUP2 全额（90），不串摊给 SUP2
  domain.submitSettlement(st, S, {
    orderId: mixed.id,
    bySupplier: { [SUP1.supplier]: 200, [SUP2.supplier]: 90 },
    reason: '运营物资破损折让50元'
  });
  assert.equal(mixed.settlement.amount, 290);
  domain.settleAction(st, SUP1, { orderId: mixed.id, action: 'confirm' });
  domain.settleAction(st, SUP2, { orderId: mixed.id, action: 'confirm' });

  const rc1 = domain.createReconciliation(st, C, { supplier: SUP1.supplier, period: '2026-11' }).recon;
  const rc2 = domain.createReconciliation(st, C, { supplier: SUP2.supplier, period: '2026-11' }).recon;
  assert.equal(rc1.total, 200);
  assert.equal(rc2.total, 90);
});

test('15. 对账单有差异（disputed）后可核对重发（reopen）或作废（void）形成闭环', () => {
  const st = clone(SEED_STATE);
  st.orders = [];
  const { order } = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 2 }], // ¥250
    details: { address: '萃云阁店', receiver: '店长' }
  });
  approveToSupplier(st, order);
  const ls = shipAll(st, order, SUP1);
  domain.acceptDelivery(st, S, {
    orderId: order.id, supplier: SUP1.supplier, batchNo: 1,
    result: 'pass', lines: ls, photoPath: 'demo.jpg', specChecked: true
  });
  domain.submitSettlement(st, S, { orderId: order.id, amount: 250, reason: '' });
  domain.settleAction(st, SUP1, { orderId: order.id, action: 'confirm' });

  const { recon } = domain.createReconciliation(st, C, { supplier: SUP1.supplier, period: '2026-11' });
  domain.reconAction(st, SUP1, { reconId: recon.id, action: 'dispute', note: '期初账目核对有差异' });
  assert.equal(recon.status, 'disputed');
  assert.equal(order.items[0].reconPending, 0);

  // 非中台禁止 reopen/void
  assert.throws(() => domain.reconAction(st, SUP1, { reconId: recon.id, action: 'reopen' }), /仅运营管理部/);

  // 中台重新发起对账单，恢复 pending 与 reconPending
  domain.reconAction(st, C, { reconId: recon.id, action: 'reopen' });
  assert.equal(recon.status, 'supplier-pending');
  assert.equal(recon.round, 2);
  assert.equal(order.items[0].reconPending, 2);

  // 若需要作废，也允许作废并释放 reconPending
  domain.reconAction(st, C, { reconId: recon.id, action: 'void', note: '并入下月统一结算' });
  assert.equal(recon.status, 'voided');
  assert.equal(order.items[0].reconPending, 0);
});

test('16. 门店验收异常反馈推送供应商工作台并由供应商登记处理方案闭环', () => {
  const st = clone(SEED_STATE);
  st.orders = [];
  const { order } = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 2 }],
    details: { address: '萃云阁店', receiver: '店长' }
  });
  approveToSupplier(st, order);
  shipAll(st, order, SUP1);

  domain.acceptDelivery(st, S, {
    orderId: order.id, supplier: SUP1.supplier, batchNo: 1,
    result: 'issue', note: '外箱进水破损1个，请补发', photoPath: 'issue.jpg'
  });
  assert.equal(domain.hasOpenAcceptanceIssue(order, SUP1.supplier), true);
  assert.equal(order.supplierRecords[SUP1.supplier].hasAcceptanceIssue, true);

  const res = domain.resolveAcceptanceIssue(st, SUP1, {
    orderId: order.id, plan: 'reship', reply: '已安排顺丰补发1个新充电宝'
  });
  assert.equal(res.issue.status, 'resolved');
  assert.equal(domain.hasOpenAcceptanceIssue(order, SUP1.supplier), false);
  assert.equal(order.supplierRecords[SUP1.supplier].hasAcceptanceIssue, false);
  assert.equal(res.audit.decision, '处理验收异常（安排补发）');
});

test('17. 统计看板（reportSummary / contractBudgetReport）与确认折让后的对账金额严格一致', () => {
  const st = clone(SEED_STATE);
  st.orders = [];
  const { order } = domain.createStoreOrder(st, S, {
    store: '萃云阁店',
    items: [{ id: 'OP-001', qty: 2 }], // ¥250 (客诉预算 / 运营物资合同)
    details: { address: '萃云阁店', receiver: '店长' }
  });
  approveToSupplier(st, order);
  const ls = shipAll(st, order, SUP1);
  domain.acceptDelivery(st, S, {
    orderId: order.id, supplier: SUP1.supplier, batchNo: 1,
    result: 'pass', lines: ls, photoPath: 'demo.jpg', specChecked: true
  });
  // 折让结算 180 元（原实收 250 元）
  domain.submitSettlement(st, S, { orderId: order.id, amount: 180, reason: '部分瑕疵协商折让70元' });
  domain.settleAction(st, SUP1, { orderId: order.id, action: 'confirm' });

  let rpt = domain.reportSummary(st);
  assert.equal(rpt.totals.requested, 250);
  assert.equal(rpt.totals.accepted, 180);
  assert.equal(rpt.totals.unreconciledAccepted, 180);

  const { recon } = domain.createReconciliation(st, C, { supplier: SUP1.supplier, period: '2026-11' });
  assert.equal(recon.total, 180);
  domain.reconAction(st, SUP1, { reconId: recon.id, action: 'confirm' });
  domain.reconAction(st, C, { reconId: recon.id, action: 'lock' });

  rpt = domain.reportSummary(st);
  assert.equal(rpt.totals.reconciled, 180);
  assert.equal(rpt.totals.unreconciledAccepted, 0);

  const cb = domain.contractBudgetReport(st);
  const cust = cb.budgetItems.find((x) => x.key === 'customer');
  assert.equal(cust.storeAccepted, 180);
  assert.equal(cust.storeReconciled, 180);
});

test('18. 中台可设置物资仅中台采购（purchaseScope=central），并拦截门店与普通职能部门下单', () => {
  const st = clone(SEED_STATE);

  // 非中台角色禁止修改采购权限
  [S, R, D, SUP1].forEach((actor) => {
    assert.throws(() => domain.setCatalogItemScope(st, actor, { id: 'OP-001', purchaseScope: 'central' }), /仅运营管理部/);
  });

  // 中台将 OP-001 设为仅中台集中采购
  const scRes = domain.setCatalogItemScope(st, C, { id: 'OP-001', purchaseScope: 'central' });
  assert.equal(scRes.purchaseScope, 'central');
  assert.equal(scRes.audit.decision, '设为仅中台采购');

  // 1) 目录过滤：传 buyer 时，门店与普通部门不可见，中台可见
  assert.equal(domain.catalogOf(st, { activeOnly: true, buyer: S }).some((x) => x.id === 'OP-001'), false);
  assert.equal(domain.catalogOf(st, { activeOnly: true, buyer: D }).some((x) => x.id === 'OP-001'), false);
  assert.equal(domain.catalogOf(st, { activeOnly: true, buyer: C }).some((x) => x.id === 'OP-001'), true);

  // 2) 下单硬拦截：门店试算/下单被拒，普通部门被拒
  assert.throws(() => domain.computeQuote(st, { store: '萃云阁店', items: [{ id: 'OP-001', qty: 1 }] }), /仅运营管理部/);
  assert.throws(() => domain.createStoreOrder(st, S, {
    store: '萃云阁店', items: [{ id: 'OP-001', qty: 1 }], details: { address: 'a', receiver: 'b' }
  }), /仅运营管理部/);
  assert.throws(() => domain.createDepartmentOrders(st, D, {
    destinations: [{ type: 'office', name: '公司总部', address: '总部前台', receiver: '行政', items: [{ id: 'OP-001', qty: 1 }] }]
  }), /仅运营管理部/);

  // 3) 运营管理部（中台）自采可正常下单
  const cRes = domain.createDepartmentOrders(st, C, {
    destinations: [{ type: 'office', name: '公司总部', address: '总部前台', receiver: '中台', items: [{ id: 'OP-001', qty: 2 }] }]
  });
  assert.equal(cRes.orders.length, 1);
  assert.equal(cRes.orders[0].status, 'supplier');

  // 4) 中台也支持在新增物资时直接指定 purchaseScope='central'，且开放全员下单后门店恢复购买
  const addCentral = domain.saveCatalogItem(st, C, {
    name: '总部专采电视机', category: '客诉维护物资', price: 2499, unit: '台',
    supplier: '运营物资供应商（演示）', purchaseScope: 'central'
  });
  assert.equal(addCentral.item.purchaseScope, 'central');
  assert.throws(() => domain.computeQuote(st, { store: '萃云阁店', items: [{ id: addCentral.item.id, qty: 1 }] }), /仅运营管理部/);

  const openRes = domain.setCatalogItemScope(st, C, { id: 'OP-001', purchaseScope: 'all' });
  assert.equal(openRes.purchaseScope, 'all');
  assert.equal(domain.computeQuote(st, { store: '萃云阁店', items: [{ id: 'OP-001', qty: 1 }] }).total, 125);
});


test('19. 社区活动供应商按人数档位定价，现场执行无需物流单号且需收货方验收', () => {
  const { CATALOG } = require('../miniprogram/data/catalog');
  const subcats = require('../miniprogram/data/subcats');
  const variants = CATALOG.filter(x => x.projectCode === 'SQ001');
  assert.equal(variants.length, 2);
  assert.deepEqual(variants.map(x => x.price), [1500, 3000]);
  assert.equal(subcats.build(CATALOG).byId[variants[0].id].label, '社区主题活动');
  assert.equal(subcats.build(CATALOG).byId['ACT-DIY001-01'].label, 'DIY体验活动');
  assert.equal(subcats.build(CATALOG).byId['ACT-F-001'].label, '活动配套服务');
  const st = clone(SEED_STATE); st.orders = [];
  const { order } = domain.createStoreOrder(st, S, {
    store: '萃云阁店', items: [{id: variants[0].id, qty:1}],
    details: {receiver:'测试店长',address:'萃云阁店活动区',purpose:'新年活动',due:'2027-01-01'}
  });
  approveToSupplier(st, order);
  const sup = {id:'TEST-SUPPLIER-3',role:'supplier',supplier:'社区活动策划服务商（待确认）'};
  domain.supplierAck(st,sup,{orderId:order.id,action:'confirm'});
  const result = domain.supplierDeliver(st,sup,{
    orderId:order.id,lines:[{id:variants[0].id,qty:1}],shipping:{method:'onsite'}
  });
  assert.equal(result.order.items[0].deliveredQty,1);
  domain.acceptDelivery(st,S,{orderId:order.id,supplier:sup.supplier,batchNo:1,
    result:'pass', lines:[{id:variants[0].id,qty:1}],photoPath:'activity-photo.jpg',specChecked:true});
  assert.equal(order.items[0].accepted,1);
});
