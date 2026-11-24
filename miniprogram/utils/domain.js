// 业务规则层：由 V1.24 server.js 移植（试算、分级审批、部门采购、接单、配送、验收、对账、SLA）
// 所有函数在传入的 state 上原地修改，校验失败抛出 Error，文案与网页版保持一致。
const { CATALOG, STORES, CATEGORY_ORDER, zoneOf } = require('../data/catalog');
const { SLA_HOURS, STAFF, SUPPLIERS } = require('../data/seed');
const BUDGET = require('../data/budget');
const { APPROVAL_DEFAULT, APPROVAL_LIMITS, CONTRACTS_DEFAULT } = require('../data/rules');
const fmt = require('./format');

const CATALOG_BY_ID = {};
CATALOG.forEach(function (p) { CATALOG_BY_ID[p.id] = p; });

const APPROVAL_STATUS = ['order-review', 'budget-region', 'budget-central', 'amount-approval', 'dept-approval'];
const INSTALL_REQUIRED = ['AD-013', 'AD-023', 'AD-054', 'AD-056', 'AD-057', 'AD-058', 'AD-059', 'AD-060', 'AD-061', 'AD-062', 'AD-063'];
const SHIPPING_METHODS = {
  express: '快递配送',
  lalamove: '同城货运（货拉拉等）',
  runner: '同城跑腿',
  self: '供应商自行配送'
};

function cents(n) { return Math.round(Number(n) * 100); }
function uid() {
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* ------------------- 动态物资目录 / 供应商 / 合同 / 审批规则（中台操作台） -------------------
 * 基础数据来自 data/catalog.js 与 data/rules.js；运营管理部在中台操作台做的增删改
 * 存放在 state.catalogCustom / state.contracts / state.approvalConfig，两端实时生效。
 */
function syncCatalogCache(list) {
  Object.keys(CATALOG_BY_ID).forEach(function (k) { delete CATALOG_BY_ID[k]; });
  list.forEach(function (p) { CATALOG_BY_ID[p.id] = p; });
}

function catalogStateOf(state) {
  if (!state) return { added: [], updated: {}, deleted: {} };
  if (!state.catalogCustom || typeof state.catalogCustom !== 'object') {
    state.catalogCustom = { added: [], updated: {}, deleted: {} };
  }
  const c = state.catalogCustom;
  if (!Array.isArray(c.added)) c.added = [];
  if (!c.updated || typeof c.updated !== 'object') c.updated = {};
  if (!c.deleted || typeof c.deleted !== 'object') c.deleted = {};
  return c;
}

function normalizeScope(item) {
  return item && (item.purchaseScope === 'central' || item.centralOnly === true) ? 'central' : 'all';
}

function canActorBuyItem(item, session) {
  if (!item) return false;
  if (normalizeScope(item) === 'central') {
    return !!(session && session.role === 'central');
  }
  return true;
}

// 当前生效的完整物资清单（含中台新增/编辑，默认不含已删除；includeDeleted=true 时保留并标 deleted:true；传 buyer 时按采购权限过滤）
function catalogOf(state, opts) {
  const c = catalogStateOf(state);
  const includeDeleted = opts && opts.includeDeleted;
  const activeOnly = opts && opts.activeOnly;
  const buyer = opts && opts.buyer;
  const out = [];
  const seen = {};

  CATALOG.forEach(function (base) {
    seen[base.id] = 1;
    const isDel = !!c.deleted[base.id];
    if (isDel && !includeDeleted) return;
    const patch = c.updated[base.id] || {};
    const merged = Object.assign({}, base, patch, {
      id: base.id,
      enabled: patch.enabled === undefined ? (base.enabled !== false) : !!patch.enabled,
      deleted: isDel,
      isCustom: false,
      isModified: Object.keys(patch).length > 0
    });
    merged.purchaseScope = normalizeScope(merged);
    merged.centralOnly = merged.purchaseScope === 'central';
    if (activeOnly && (!merged.enabled || merged.deleted)) return;
    if (buyer && !canActorBuyItem(merged, buyer)) return;
    out.push(merged);
  });

  (c.added || []).forEach(function (raw) {
    if (!raw || !raw.id || seen[raw.id]) return;
    seen[raw.id] = 1;
    const isDel = !!c.deleted[raw.id];
    if (isDel && !includeDeleted) return;
    const patch = c.updated[raw.id] || {};
    const merged = Object.assign({}, raw, patch, {
      id: raw.id,
      enabled: patch.enabled === undefined ? (raw.enabled !== false) : !!patch.enabled,
      deleted: isDel,
      isCustom: true,
      isModified: Object.keys(patch).length > 0
    });
    merged.purchaseScope = normalizeScope(merged);
    merged.centralOnly = merged.purchaseScope === 'central';
    if (activeOnly && (!merged.enabled || merged.deleted)) return;
    if (buyer && !canActorBuyItem(merged, buyer)) return;
    out.push(merged);
  });

  if (!includeDeleted && !activeOnly && !buyer) syncCatalogCache(out);
  return out;
}

function catalogMapOf(state) {
  const list = catalogOf(state);
  const map = {};
  list.forEach(function (p) { map[p.id] = p; });
  return map;
}

function suppliersOf(state) {
  const set = {};
  (SUPPLIERS || []).forEach(function (s) { if (s) set[s] = 1; });
  catalogOf(state, { includeDeleted: true }).forEach(function (p) { if (p.supplier) set[p.supplier] = 1; });
  ((state && state.contracts) || CONTRACTS_DEFAULT).forEach(function (c) { if (c && c.supplier) set[c.supplier] = 1; });
  return Object.keys(set);
}

// 新增或编辑物资（中台）
function saveCatalogItem(state, session, payload) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可维护物资目录');
  const p = payload || {};
  const c = catalogStateOf(state);
  const all = catalogOf(state, { includeDeleted: true });
  const byId = {};
  all.forEach(function (x) { byId[x.id] = x; });

  const LEGACY_CAT_MAP = {
    '活动及社群物资': '社群活动物资',
    '奖品礼品': '客诉维护物资',
    '日常运营耗材': '客诉维护物资',
    '员工物资': '客诉维护物资',
    '宣传印刷物料': '印刷品物料'
  };
  const name = String(p.name || '').trim();
  if (!name || name.length > 60) throw new Error('请填写1至60字的物资名称');
  const rawCat = String(p.category || '').trim();
  const category = LEGACY_CAT_MAP[rawCat] || rawCat;
  if (CATEGORY_ORDER.indexOf(category) < 0) throw new Error('请选择有效的物资大类');
  const unit = String(p.unit || '').trim() || '个';
  if (unit.length > 16) throw new Error('计量单位不超过16字');
  const spec = String(p.spec || '').trim().slice(0, 120);
  const supplier = String(p.supplier || '').trim();
  if (!supplier || supplier.length > 60) throw new Error('请填写或选择供应商');
  const price = round2(Number(p.price));
  if (!isFinite(price) || price <= 0 || price > 1000000) throw new Error('单价需在 0.01 到 1,000,000 元之间');
  const note = String(p.note || '').trim().slice(0, 200);
  const budgetItem = p.budgetItem && BUDGET.NAME[p.budgetItem] ? p.budgetItem : '';
  const enabled = p.enabled === undefined ? true : !!p.enabled;
  const purchaseScope = (p.purchaseScope === 'central' || p.centralOnly === true) ? 'central' : 'all';
  const centralOnly = purchaseScope === 'central';

  let id = String(p.id || '').trim().toUpperCase();
  const isEdit = !!p.isEdit;
  const now = new Date().toISOString();

  if (isEdit) {
    if (!id || !byId[id]) throw new Error('找不到要修改的物资：' + id);
    delete c.deleted[id];
    c.updated[id] = {
      name: name, category: category, spec: spec, unit: unit,
      price: price, supplier: supplier, note: note,
      budgetItem: budgetItem || '',
      purchaseScope: purchaseScope,
      centralOnly: centralOnly,
      enabled: enabled,
      updatedAt: now,
      updatedBy: session.id
    };
    const next = catalogOf(state);
    const saved = next.filter(function (x) { return x.id === id; })[0];
    return {
      item: saved,
      created: false,
      audit: {
        orderId: id, kind: 'catalog', stage: 'catalog-edit', decision: '修改物资',
        role: '运营管理部（' + session.id + '）', from: '', to: '',
        note: name + '（' + category + '，¥' + fmt.money(price) + '/' + unit + (centralOnly ? '，仅中台采购' : '') + '）',
        at: now
      }
    };
  }

  if (!id) {
    const prefix = category === '印刷品物料' ? 'AD' : 'WZ';
    let maxNum = 0;
    all.forEach(function (x) {
      const m = String(x.id || '').match(new RegExp('^' + prefix + '-(\\d+)$'));
      if (m && Number(m[1]) > maxNum) maxNum = Number(m[1]);
    });
    id = prefix + '-' + String(maxNum + 1).padStart(3, '0');
  } else if (!/^[A-Z0-9_-]{2,24}$/.test(id)) {
    throw new Error('物资编号仅支持大写字母、数字、下划线或连字符（2-24位）');
  }
  if (byId[id] && !c.deleted[id]) throw new Error('物资编号已存在：' + id);

  delete c.deleted[id];
  delete c.updated[id];
  const item = {
    id: id, name: name, spec: spec, unit: unit, price: price,
    supplier: supplier, category: category, note: note,
    budgetItem: budgetItem || '',
    purchaseScope: purchaseScope,
    centralOnly: centralOnly,
    enabled: enabled, demoOnly: false,
    createdAt: now, createdBy: session.id
  };
  c.added = c.added.filter(function (x) { return x.id !== id; });
  c.added.unshift(item);
  catalogOf(state);
  return {
    item: Object.assign({ isCustom: true, enabled: enabled }, item),
    created: true,
    audit: {
      orderId: id, kind: 'catalog', stage: 'catalog-add', decision: '新增物资',
      role: '运营管理部（' + session.id + '）', from: '', to: '',
      note: name + '（' + category + '，¥' + fmt.money(price) + '/' + unit + (centralOnly ? '，仅中台采购' : '') + '）',
      at: now
    }
  };
}

// 采购权限范围切换（仅运营管理部可设置：'central' 仅中台采购 / 'all' 门店及各部门均可自行下单）
function setCatalogItemScope(state, session, payload) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可设置物资采购权限');
  const p = payload || {};
  const map = catalogMapOf(state);
  const c = catalogStateOf(state);
  const ids = Array.isArray(p.ids) && p.ids.length ? p.ids : [String(p.id || '').trim()];
  if (!ids[0]) throw new Error('请选择要设置的物资');
  const now = new Date().toISOString();
  const changed = [];
  let lastScope = 'all';

  ids.forEach(function (id) {
    const cur = map[id];
    if (!cur) throw new Error('找不到物资：' + id);
    const nextScope = p.purchaseScope === 'central' || p.purchaseScope === 'all'
      ? p.purchaseScope
      : (normalizeScope(cur) === 'central' ? 'all' : 'central');
    lastScope = nextScope;
    c.updated[id] = Object.assign({}, c.updated[id] || {}, {
      purchaseScope: nextScope,
      centralOnly: nextScope === 'central',
      updatedAt: now,
      updatedBy: session.id
    });
    changed.push(cur.name + '（' + id + '）');
  });

  catalogOf(state);
  return {
    id: ids[0],
    ids: ids,
    name: changed.length === 1 ? map[ids[0]].name : (changed.length + ' 项物资'),
    purchaseScope: lastScope,
    centralOnly: lastScope === 'central',
    audit: {
      orderId: ids.length === 1 ? ids[0] : '',
      kind: 'catalog',
      stage: 'catalog-scope',
      decision: lastScope === 'central' ? '设为仅中台采购' : '开放全员下单',
      role: '运营管理部（' + session.id + '）',
      from: '', to: '',
      note: changed.slice(0, 5).join('、') + (changed.length > 5 ? ' 等' + changed.length + '项' : ''),
      at: now
    }
  };
}

// 上下架切换
function toggleCatalogItem(state, session, payload) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可上下架物资');
  const id = String((payload && payload.id) || '').trim();
  const map = catalogMapOf(state);
  const cur = map[id];
  if (!cur) throw new Error('找不到物资：' + id);
  const c = catalogStateOf(state);
  const nextEnabled = payload.enabled === undefined ? !cur.enabled : !!payload.enabled;
  const now = new Date().toISOString();
  c.updated[id] = Object.assign({}, c.updated[id] || {}, {
    enabled: nextEnabled,
    updatedAt: now,
    updatedBy: session.id
  });
  catalogOf(state);
  return {
    id: id,
    name: cur.name,
    enabled: nextEnabled,
    audit: {
      orderId: id, kind: 'catalog', stage: 'catalog-toggle', decision: nextEnabled ? '上架物资' : '下架物资',
      role: '运营管理部（' + session.id + '）', from: '', to: '',
      note: cur.name + '（' + id + '）',
      at: now
    }
  };
}

// 删除物资：若有未完结订单引用该物资，禁止直接删除（建议先下架）；历史已完成单不受影响
function deleteCatalogItem(state, session, id) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可删除物资');
  const targetId = String(id || '').trim();
  const all = catalogOf(state, { includeDeleted: true });
  const item = all.filter(function (x) { return x.id === targetId && !x.deleted; })[0];
  if (!item) throw new Error('物资不存在或已删除');

  const activeOrder = (state.orders || []).filter(function (o) {
    if (['done', 'cancelled', 'rejected'].indexOf(o.status) >= 0) return false;
    return (o.items || []).some(function (x) { return x.id === targetId; });
  })[0];
  if (activeOrder) {
    throw new Error('在途订单 ' + activeOrder.id + ' 包含该物资，请先设为「下架」或等订单完结后再删除');
  }

  const now = new Date().toISOString();
  const c = catalogStateOf(state);
  c.deleted[targetId] = { at: now, by: session.id, name: item.name };
  catalogOf(state);
  return {
    id: targetId,
    name: item.name,
    audit: {
      orderId: targetId, kind: 'catalog', stage: 'catalog-delete', decision: '删除物资',
      role: '运营管理部（' + session.id + '）', from: '', to: '',
      note: item.name + '（' + targetId + '）',
      at: now
    }
  };
}

// 恢复已删除物资
function restoreCatalogItem(state, session, id) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可恢复物资');
  const targetId = String(id || '').trim();
  const c = catalogStateOf(state);
  if (!c.deleted[targetId]) throw new Error('该物资未被删除');
  delete c.deleted[targetId];
  const list = catalogOf(state);
  const item = list.filter(function (x) { return x.id === targetId; })[0];
  const now = new Date().toISOString();
  const itemName = (item && item.name) || targetId;
  return {
    id: targetId,
    name: itemName,
    audit: {
      orderId: targetId, kind: 'catalog', stage: 'catalog-restore', decision: '恢复物资',
      role: '运营管理部（' + session.id + '）', from: '', to: '',
      note: itemName + '（' + targetId + '）',
      at: now
    }
  };
}

/* ------------------- 门店审批规则配置 ------------------- */
function approvalConfigOf(state) {
  const raw = (state && state.approvalConfig) || {};
  const autoMax = isFinite(Number(raw.autoMax)) ? round2(Number(raw.autoMax)) : APPROVAL_DEFAULT.autoMax;
  const regionMax = isFinite(Number(raw.regionMax)) ? round2(Number(raw.regionMax)) : APPROVAL_DEFAULT.regionMax;
  const splitDays = isFinite(Number(raw.splitDays)) ? Math.round(Number(raw.splitDays)) : APPROVAL_DEFAULT.splitDays;
  return {
    autoMax: autoMax,
    regionMax: Math.max(autoMax, regionMax),
    splitGuard: raw.splitGuard === undefined ? APPROVAL_DEFAULT.splitGuard : !!raw.splitGuard,
    splitDays: Math.max(1, Math.min(31, splitDays)),
    autoSkipReview: raw.autoSkipReview === undefined ? APPROVAL_DEFAULT.autoSkipReview : !!raw.autoSkipReview
  };
}

function saveApprovalConfig(state, session, payload) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可调整审批规则');
  const p = payload || {};
  const cur = approvalConfigOf(state);
  const autoMax = p.autoMax === undefined ? cur.autoMax : round2(Number(p.autoMax));
  const regionMax = p.regionMax === undefined ? cur.regionMax : round2(Number(p.regionMax));
  const splitDays = p.splitDays === undefined ? cur.splitDays : Math.round(Number(p.splitDays));
  if (!isFinite(autoMax) || autoMax < APPROVAL_LIMITS.autoMax[0] || autoMax > APPROVAL_LIMITS.autoMax[1]) {
    throw new Error('小额上限需在 ' + APPROVAL_LIMITS.autoMax[0] + ' 到 ' + APPROVAL_LIMITS.autoMax[1] + ' 元之间');
  }
  if (!isFinite(regionMax) || regionMax < autoMax || regionMax > APPROVAL_LIMITS.regionMax[1]) {
    throw new Error('战区终审上限需不小于小额上限，且不超过 ' + APPROVAL_LIMITS.regionMax[1] + ' 元');
  }
  if (!isFinite(splitDays) || splitDays < APPROVAL_LIMITS.splitDays[0] || splitDays > APPROVAL_LIMITS.splitDays[1]) {
    throw new Error('防拆单统计天数需在 1 到 31 天之间');
  }
  state.approvalConfig = {
    autoMax: autoMax,
    regionMax: regionMax,
    splitGuard: p.splitGuard === undefined ? cur.splitGuard : !!p.splitGuard,
    splitDays: splitDays,
    autoSkipReview: p.autoSkipReview === undefined ? cur.autoSkipReview : !!p.autoSkipReview
  };
  const now = new Date().toISOString();
  return {
    config: state.approvalConfig,
    audit: {
      orderId: '', kind: 'rules', stage: 'rules-save', decision: '更新审批规则',
      role: '运营管理部（' + session.id + '）', from: '', to: '',
      note: '小额≤¥' + fmt.money(autoMax) + '，战区终审≤¥' + fmt.money(regionMax) +
        (state.approvalConfig.splitGuard ? '，防拆单' + splitDays + '天' : '，关闭防拆单') +
        (state.approvalConfig.autoSkipReview ? '，小额免审直发' : ''),
      at: now
    }
  };
}

// 某门店近 N 天已提交的有效订单累计金额（分）——用于防拆单定档（支持按同费用科目过滤且排除已中台审批大单）
function recentStoreCents(state, store, days, excludeId, budgetKeys) {
  const windowMs = (days || APPROVAL_DEFAULT.splitDays) * 86400000;
  const now = Date.now();
  const keys = Array.isArray(budgetKeys) && budgetKeys.length ? budgetKeys : null;
  let sum = 0;
  (state.orders || []).forEach(function (o) {
    if (!o || o.id === excludeId) return;
    if (o.purchaseType === 'department' || o.store !== store) return;
    if (['rejected', 'cancelled'].indexOf(o.status) >= 0) return;
    if (o.tier === 'central') return;
    const ts = parseTime(o.createdAt || o.created);
    if (!isNaN(ts) && now - ts > windowMs) return;
    if (keys) {
      const sp = splitOrder(o);
      keys.forEach(function (k) {
        if (sp[k]) sum += cents(sp[k].total);
      });
    } else {
      sum += cents(o.total || 0);
    }
  });
  return sum;
}

/* ------------------- 供应商合同总额上限（职能部门采购） -------------------
 * 规则：职能部门不设部门预算，但每个供应商签有年度/框架合同总额上限；
 *       所有有效采购单（已结算按结算金额、未结算按下单金额）累计不得超过该供应商合同总额。
 */
function contractsOf(state) {
  if (!state) return CONTRACTS_DEFAULT.slice();
  if (!Array.isArray(state.contracts) || !state.contracts.length) {
    state.contracts = JSON.parse(JSON.stringify(CONTRACTS_DEFAULT));
  }
  return state.contracts;
}

// 订单在各供应商上的有效金额（分）：若已双方确认结算，按确认值或分供应商明细计算；否则按订单明细金额
function supplierOrderCents(order, supplier) {
  if (!order || ['rejected', 'cancelled'].indexOf(order.status) >= 0) return 0;
  const items = (order.items || []).filter(function (x) { return x.supplier === supplier; });
  if (!items.length) return 0;
  const rawCents = items.reduce(function (s, x) {
    return s + cents(Number(x.price || 0) * Number(x.qty || 0));
  }, 0);
  const settle = order.settlement;
  if (settle && settle.status === 'confirmed' && isFinite(Number(settle.amount))) {
    if (settle.bySupplier && isFinite(Number(settle.bySupplier[supplier]))) {
      return cents(settle.bySupplier[supplier]);
    }
    const orderRaw = (order.items || []).reduce(function (s, x) {
      return s + cents(Number(x.price || 0) * Number(x.qty || 0));
    }, 0);
    if (orderRaw > 0) return Math.round(cents(settle.amount) * (rawCents / orderRaw));
  }
  return rawCents;
}

function contractSummary(state, excludeOrderId) {
  const list = contractsOf(state);
  return list.map(function (c) {
    const capCents = cents(c.total || 0);
    let deptUsed = 0;
    let storeUsed = 0;
    (state.orders || []).forEach(function (o) {
      if (!o || o.id === excludeOrderId || ['rejected', 'cancelled'].indexOf(o.status) >= 0) return;
      const amt = supplierOrderCents(o, c.supplier);
      if (!amt) return;
      if (o.purchaseType === 'department') deptUsed += amt;
      else storeUsed += amt;
    });
    const usedCents = deptUsed + storeUsed;
    const remainCents = Math.max(0, capCents - usedCents);
    return {
      id: c.id,
      supplier: c.supplier,
      name: c.name || (c.supplier + '框架合同'),
      total: round2(capCents / 100),
      deptUsed: round2(deptUsed / 100),
      storeUsed: round2(storeUsed / 100),
      used: round2(usedCents / 100),
      remaining: round2(remainCents / 100),
      usedPct: capCents > 0 ? Math.min(100, Math.round(usedCents / capCents * 100)) : 0,
      start: c.start || '',
      end: c.end || '',
      note: c.note || ''
    };
  });
}

function saveContract(state, session, payload) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可维护合同上限');
  const p = payload || {};
  const list = contractsOf(state);
  const supplier = String(p.supplier || '').trim();
  if (!supplier) throw new Error('请选择或填写供应商名称');
  const name = String(p.name || '').trim() || (supplier + '采购合同');
  const total = round2(Number(p.total));
  if (!isFinite(total) || total <= 0 || total > 100000000) throw new Error('合同总额需在 0.01 到 1 亿元之间');
  let id = String(p.id || '').trim();
  const now = new Date().toISOString();
  const existing = list.filter(function (c) { return (id && c.id === id) || c.supplier === supplier; })[0];
  if (existing) {
    existing.supplier = supplier;
    existing.name = name;
    existing.total = total;
    existing.start = String(p.start || existing.start || '').slice(0, 20);
    existing.end = String(p.end || existing.end || '').slice(0, 20);
    existing.note = String(p.note !== undefined ? p.note : (existing.note || '')).slice(0, 120);
    return {
      contract: existing,
      created: false,
      audit: {
        orderId: existing.id, kind: 'contract', stage: 'contract-edit', decision: '调整合同上限',
        role: '运营管理部（' + session.id + '）', from: '', to: '',
        note: supplier + '（总额 ¥' + fmt.money(total) + '）',
        at: now
      }
    };
  }
  if (!id) id = 'HT-' + new Date().getFullYear() + '-' + String(list.length + 1).padStart(3, '0');
  const row = {
    id: id, supplier: supplier, name: name, total: total,
    start: String(p.start || '').slice(0, 20),
    end: String(p.end || '').slice(0, 20),
    note: String(p.note || '').slice(0, 120)
  };
  list.push(row);
  return {
    contract: row,
    created: true,
    audit: {
      orderId: row.id, kind: 'contract', stage: 'contract-add', decision: '新增供应商合同',
      role: '运营管理部（' + session.id + '）', from: '', to: '',
      note: supplier + '（总额 ¥' + fmt.money(total) + '）',
      at: now
    }
  };
}


/* ------------------- 费用预算（门店 × 科目） -------------------
 * 额度 = 房间数 × 科目系数（中台可按门店改系数或直接定额），再叠加手工增减：
 *   adjust>0  机动预算池追加 / 其他门店调剂进来
 *   adjust<0  调出给其他门店
 * 订单按商品归类到科目，一张单可以跨科目，各自占用对应额度。
 */
function budgetCfg(state) {
  if (!state.budgetConfig) state.budgetConfig = {};
  return BUDGET.normalize(state.budgetConfig);
}

function flexCentsOf(state) {
  return cents(Number(state.flex === undefined ? 20000 : state.flex));
}

// 订单在各科目上的金额：{ key: { total, accepted } }（元）
// 若订单已双方确认结算（settlement.status === 'confirmed'），按最终结算金额同比例分摊到各科目，释放折让部分的预算占用
function splitOrder(order) {
  const out = {};
  BUDGET.KEYS.forEach(function (k) { out[k] = { total: 0, accepted: 0 }; });
  if (!order) return out;
  (order.items || []).forEach(function (x) {
    const p = CATALOG_BY_ID[x.id];
    const k = BUDGET.itemOf(x.budgetItem ? x : (p || x));
    // 订单行通常带 price；历史数据缺失时回退到目录价，避免金额算成 0
    const price = Number(x.price !== undefined ? x.price : (p && p.price) || 0);
    const total = price * Number(x.qty || 0);
    const accepted = Math.min(total, price * Number(x.accepted || 0));
    if (!out[k]) out[k] = { total: 0, accepted: 0 };
    out[k].total = round2(out[k].total + total);
    out[k].accepted = round2(out[k].accepted + accepted);
  });
  const settle = order.settlement;
  if (settle && settle.status === 'confirmed' && isFinite(Number(settle.amount))) {
    if (settle.bySupplier && typeof settle.bySupplier === 'object') {
      const supRaw = {};
      const nextOut = {};
      BUDGET.KEYS.forEach(function (k) { nextOut[k] = { total: 0, accepted: 0 }; });
      (order.items || []).forEach(function (x) {
        const p = CATALOG_BY_ID[x.id];
        const price = Number(x.price !== undefined ? x.price : (p && p.price) || 0);
        const raw = price * Number(x.qty || 0);
        const sup = x.supplier || '_';
        supRaw[sup] = (supRaw[sup] || 0) + raw;
      });
      (order.items || []).forEach(function (x) {
        const p = CATALOG_BY_ID[x.id];
        const k = BUDGET.itemOf(x.budgetItem ? x : (p || x));
        const price = Number(x.price !== undefined ? x.price : (p && p.price) || 0);
        const raw = price * Number(x.qty || 0);
        const sup = x.supplier || '_';
        const supSettled = isFinite(Number(settle.bySupplier[sup])) ? Number(settle.bySupplier[sup]) : supRaw[sup];
        const scaled = supRaw[sup] > 0 ? round2(raw * (supSettled / supRaw[sup])) : 0;
        if (!nextOut[k]) nextOut[k] = { total: 0, accepted: 0 };
        nextOut[k].total = round2(nextOut[k].total + scaled);
        nextOut[k].accepted = round2(nextOut[k].accepted + scaled);
      });
      return nextOut;
    }
    const rawSum = BUDGET.KEYS.reduce(function (s, k) { return s + out[k].total; }, 0);
    if (rawSum > 0) {
      const ratio = Number(settle.amount) / rawSum;
      BUDGET.KEYS.forEach(function (k) {
        const scaled = round2(out[k].total * ratio);
        out[k].total = scaled;
        out[k].accepted = scaled;
      });
    }
  }
  return out;
}

// 是否占用门店额度：部门采购走部门预算、不计入门店；驳回/撤销/待核定不占
function occupiesStore(order) {
  if (!order) return false;
  if (order.purchaseType === 'department') return false;
  if (['rejected', 'cancelled'].indexOf(order.status) >= 0) return false;
  if (order.overPending) return false;
  return true;
}

// 某门店某科目的占用情况（分）
function storeItemCents(state, store, key, excludeId) {
  const cfg = budgetCfg(state);
  const budget = cents(BUDGET.budgetOf(cfg, store, key));
  const baseUsed = cents(BUDGET.baseUsedOf(cfg, store, key));
  let reserved = 0;
  (state.orders || []).forEach(function (o) {
    if (o.id === excludeId || o.store !== store || !occupiesStore(o)) return;
    reserved += cents(splitOrder(o)[key].total);
  });
  return {
    budget: budget,
    baseUsed: baseUsed,
    reserved: reserved,
    usable: Math.max(0, budget - baseUsed - reserved)
  };
}

// 门店可用额度（分）。传 key 只算该科目，不传为该店三科目合计
function storeUsableCents(state, store, excludeId, key) {
  if (key) return storeItemCents(state, store, key, excludeId).usable;
  return BUDGET.KEYS.reduce(function (s, k) {
    return s + storeItemCents(state, store, k, excludeId).usable;
  }, 0);
}

// 预算追加回收：撤销 / 关闭 / 驳回已追加预算的订单时，把追加额度退回机动预算
function revertBudgetTransfer(state, order) {
  if (!order || !order.budgetApplied) return 0;
  const cfg = budgetCfg(state);
  const amounts = {};
  if (order.budgetTransferByItem && typeof order.budgetTransferByItem === 'object') {
    BUDGET.KEYS.forEach(function (k) {
      amounts[k] = Number(order.budgetTransferByItem[k] || 0);
    });
  } else {
    // 老数据没有科目明细：按订单金额分摊退回
    const split = splitOrder(order);
    const total = BUDGET.KEYS.reduce(function (s, k) { return s + split[k].total; }, 0);
    const whole = Number(order.budgetTransfer || 0);
    BUDGET.KEYS.forEach(function (k) {
      amounts[k] = total > 0 ? round2(whole * split[k].total / total) : 0;
    });
  }
  let reverted = 0;
  BUDGET.KEYS.forEach(function (k) {
    const amt = cents(amounts[k] || 0);
    if (!amt) return;
    cfg.adjust[order.store] = cfg.adjust[order.store] || {};
    cfg.adjust[order.store][k] = round2((cfg.adjust[order.store][k] || 0) - amt / 100);
    reverted += amt;
  });
  if (reverted > 0) state.flex = round2((flexCentsOf(state) + reverted) / 100);
  order.budgetApplied = false;
  order.budgetTransfer = 0;
  order.budgetTransferByItem = null;
  return round2(reverted / 100);
}

/* ------------------- 预算缺口 / 机动预算调整 ------------------- */
// 预算核定节点用：这笔单在每个科目各缺多少、机动池够不够、单笔最多能核定多少
function budgetGap(state, order) {
  const cfg = budgetCfg(state);
  const flex = flexCentsOf(state);
  const split = splitOrder(order);
  const rows = BUDGET.KEYS.map(function (key) {
    const amount = cents(split[key].total);
    const info = storeItemCents(state, order.store, key, order.id);
    const needed = Math.max(0, amount - info.usable);
    return {
      key: key,
      name: BUDGET.NAME[key],
      short: BUDGET.SHORT[key],
      budget: round2(info.budget / 100),
      baseUsed: round2(info.baseUsed / 100),
      usable: round2(info.usable / 100),
      total: round2(amount / 100),
      needed: round2(needed / 100),
      over: needed > 0
    };
  }).filter(function (r) { return r.total > 0; });

  const sum = function (f) {
    return rows.reduce(function (s, r) { return s + cents(r[f]); }, 0);
  };
  const totalCents = sum('total');
  const usableCents = sum('usable');
  const neededCents = sum('needed');
  const short = Math.max(0, neededCents - flex);

  return {
    store: order.store,
    rows: rows,
    flex: round2(flex / 100),
    // 整单口径（页面与审计按这些字段显示）
    budget: round2(rows.reduce(function (s, r) { return s + r.budget; }, 0)),
    baseUsed: round2(rows.reduce(function (s, r) { return s + r.baseUsed; }, 0)),
    usable: round2(usableCents / 100),
    total: round2(totalCents / 100),
    needed: round2(neededCents / 100),
    short: round2(short / 100),
    maxSupport: round2((usableCents + flex) / 100),
    ok: neededCents <= flex,
    mix: rows.length > 1
  };
}

// 按缺口把机动预算拨到对应门店的对应科目，记录在订单上便于撤销时退回
function applyGapBudget(state, order, gap) {
  const cfg = budgetCfg(state);
  const byItem = {};
  let totalCents = 0;
  (gap.rows || []).forEach(function (r) {
    const amt = cents(r.needed);
    if (amt <= 0) return;
    cfg.adjust[order.store] = cfg.adjust[order.store] || {};
    cfg.adjust[order.store][r.key] = round2((cfg.adjust[order.store][r.key] || 0) + amt / 100);
    byItem[r.key] = round2(amt / 100);
    totalCents += amt;
  });
  state.flex = round2((flexCentsOf(state) - totalCents) / 100);
  order.budgetApplied = true;
  order.budgetTransfer = round2(totalCents / 100);
  order.budgetTransferByItem = byItem;
  return round2(totalCents / 100);
}

// 机动（预留）预算追加：预算核定被卡住时唯一的出口，由运营管理部操作并留痕
function adjustFlex(state, session, amount, reason) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可调整机动预算');
  const add = cents(Number(amount));
  if (!isFinite(add) || add <= 0) throw new Error('追加金额需大于 0');
  if (add > 50000000) throw new Error('单次追加不超过 50 万元');
  const before = flexCentsOf(state);
  state.flex = round2((before + add) / 100);
  return { amount: round2(add / 100), before: round2(before / 100), after: state.flex, reason: String(reason || '').slice(0, 100) };
}

// 门店间同科目调剂：把别家门店该科目的闲置额度划给当前门店，不增加公司总预算
function transferStoreBudget(state, session, fromStore, toStore, amount, key) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可调剂门店额度');
  if (!fromStore || !toStore) throw new Error('请选择调出与调入门店');
  if (fromStore === toStore) throw new Error('调出与调入不能是同一门店');
  if (!key || !BUDGET.NAME[key]) throw new Error('请选择费用科目');
  const move = cents(Number(amount));
  if (!isFinite(move) || move <= 0) throw new Error('调剂金额需大于 0');
  const free = storeUsableCents(state, fromStore, null, key);
  if (move > free) {
    throw new Error(fromStore + '「' + BUDGET.NAME[key] + '」可用结余仅 ¥' + fmt.money(free / 100));
  }
  const cfg = budgetCfg(state);
  cfg.adjust[fromStore] = cfg.adjust[fromStore] || {};
  cfg.adjust[toStore] = cfg.adjust[toStore] || {};
  cfg.adjust[fromStore][key] = round2((cfg.adjust[fromStore][key] || 0) - move / 100);
  cfg.adjust[toStore][key] = round2((cfg.adjust[toStore][key] || 0) + move / 100);
  return {
    amount: round2(move / 100),
    key: key,
    item: BUDGET.NAME[key],
    from: fromStore,
    to: toStore,
    fromFreeBefore: round2(free / 100)
  };
}

/* ------------------- 预算参数维护（中台） ------------------- */
// 改房间数 / 科目系数 / 直接定额。传 null 表示清除该项（回到公式或上级默认）
function saveBudgetConfig(state, session, payload) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可调整门店预算');
  const p = payload || {};
  const store = String(p.store || '');
  if (!store) throw new Error('请选择门店');
  const cfg = budgetCfg(state);
  const changed = [];

  if (p.rooms !== undefined) {
    const rooms = Number(p.rooms);
    if (!isFinite(rooms) || rooms <= 0 || rooms > 1000000) throw new Error('房间数需在 1 到 1000000 之间');
    cfg.rooms[store] = Math.round(rooms);
    changed.push('房间数=' + Math.round(rooms));
  }

  if (p.coef && typeof p.coef === 'object') {
    BUDGET.KEYS.forEach(function (k) {
      if (p.coef[k] === undefined) return;
      if (p.coef[k] === null || p.coef[k] === '') {
        if (cfg.storeCoef[store]) delete cfg.storeCoef[store][k];
        changed.push(BUDGET.NAME[k] + '系数=默认');
        return;
      }
      const v = Number(p.coef[k]);
      if (!isFinite(v) || v < 0 || v > 100000) throw new Error(BUDGET.NAME[k] + '系数需在 0 到 100000 之间');
      cfg.storeCoef[store] = cfg.storeCoef[store] || {};
      cfg.storeCoef[store][k] = round2(v);
      changed.push(BUDGET.NAME[k] + '系数=' + round2(v));
    });
  }

  if (p.override && typeof p.override === 'object') {
    BUDGET.KEYS.forEach(function (k) {
      if (p.override[k] === undefined) return;
      cfg.override[store] = cfg.override[store] || {};
      if (p.override[k] === null || p.override[k] === '') {
        delete cfg.override[store][k];
        changed.push(BUDGET.NAME[k] + '改回公式');
        return;
      }
      const v = Number(p.override[k]);
      if (!isFinite(v) || v < 0 || v > 100000000) throw new Error(BUDGET.NAME[k] + '定额需在 0 到 1 亿之间');
      cfg.override[store][k] = round2(v);
      changed.push(BUDGET.NAME[k] + '定额=¥' + fmt.money(round2(v)));
    });
  }

  if (!changed.length) throw new Error('没有需要保存的调整');
  return { store: store, changed: changed };
}

// 预算配置矩阵：某门店的 房间数 / 三科目 基数、系数、定额、追加、额度
function budgetConfigOf(state, store) {
  const cfg = budgetCfg(state);
  return {
    store: store,
    rooms: BUDGET.roomsOf(cfg, store),
    flex: round2(flexCentsOf(state) / 100),
    items: BUDGET.KEYS.map(function (k) {
      return {
        key: k,
        name: BUDGET.NAME[k],
        short: BUDGET.SHORT[k],
        coef: BUDGET.coefOf(cfg, store, k),
        coefDefault: BUDGET.COEF_DEFAULT[k],
        storeCoef: (cfg.storeCoef[store] || {})[k] === undefined ? null : cfg.storeCoef[store][k],
        override: BUDGET.overrideOf(cfg, store, k),
        basis: BUDGET.basisOf(cfg, store, k),
        base: BUDGET.budgetBaseOf(cfg, store, k),
        adjust: BUDGET.adjustOf(cfg, store, k),
        budget: BUDGET.budgetOf(cfg, store, k),
        baseUsed: BUDGET.baseUsedOf(cfg, store, k)
      };
    }),
    total: BUDGET.storeBudgetOf(cfg, store)
  };
}


/* ------------------------- 试算 ------------------------- */
function computeQuote(state, input) {
  if (!input || !input.store) throw new Error('请选择收货门店');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 80) {
    throw new Error('请选择1至80项物料');
  }
  const catMap = catalogMapOf(state);
  let totalCents = 0;
  const confirmed = [];
  const seen = {};
  input.items.forEach(function (line) {
    if (!line || !line.id || !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 9999) {
      throw new Error('物料数量必须为1至9999的整数');
    }
    if (seen[line.id]) throw new Error('商品重复，请在一行填写数量');
    seen[line.id] = 1;
    const item = catMap[line.id] || CATALOG_BY_ID[line.id];
    if (!item || item.deleted) throw new Error('商品未找到：' + line.id);
    if (item.enabled === false) throw new Error('商品已下架，暂不能下单：' + item.name);
    if (normalizeScope(item) === 'central') {
      throw new Error('「' + item.name + '」已设为仅运营管理部（中台）集中采购，门店不可自行下单');
    }
    if (typeof item.price !== 'number' || !isFinite(item.price) || item.price <= 0) {
      throw new Error('商品尚无合同价，暂不能下单：' + item.name);
    }
    const unitCents = cents(item.price);
    totalCents += unitCents * line.qty;
    confirmed.push({ id: item.id, name: item.name, qty: line.qty, unitPrice: unitCents / 100, amount: unitCents * line.qty / 100 });
  });
  if (totalCents <= 0 || totalCents > 1000000000) throw new Error('试算金额超出演示范围');

  // 按费用科目拆分这笔单：每个科目各自比对可用额度（额度 = 房间数 × 系数）
  const cfg = budgetCfg(state);
  const split = {};
  BUDGET.KEYS.forEach(function (k) { split[k] = { total: 0, usable: 0, over: 0 }; });
  confirmed.forEach(function (line) {
    const k = BUDGET.itemOf(catMap[line.id] || CATALOG_BY_ID[line.id]);
    split[k].total = round2(split[k].total + line.amount);
  });
  const budgetRows = BUDGET.KEYS.filter(function (k) {
    return split[k].total > 0;
  }).map(function (k) {
    const usable = round2(storeUsableCents(state, input.store, input.excludeId || null, k) / 100);
    const total = split[k].total;
    return {
      key: k,
      name: BUDGET.NAME[k],
      short: BUDGET.SHORT[k],
      budget: round2(BUDGET.budgetOf(cfg, input.store, k)),
      total: total,
      usable: usable,
      over: round2(Math.max(0, total - usable)),
      overBudget: total > usable
    };
  });
  const availableCents = cents(budgetRows.reduce(function (s, r) { return s + r.usable; }, 0));
  const overAmountCents = cents(budgetRows.reduce(function (s, r) { return s + r.over; }, 0));
  // 机动（预留）池能补的上限：超预算是从这里划额度，超出即核不出来，下单端直接拦截
  const flexCents = flexCentsOf(state);
  const maxSupportCents = availableCents + flexCents;
  const hardOver = overAmountCents > flexCents;

  // 审批定档：支持中台自定义阈值 + 近 N 天同店同科目累计防拆单
  const ac = approvalConfigOf(state);
  const autoMaxCents = cents(ac.autoMax);
  const regionMaxCents = cents(ac.regionMax);
  const activeKeys = budgetRows.map(function (r) { return r.key; });
  const recentCents = ac.splitGuard ? recentStoreCents(state, input.store, ac.splitDays, input.excludeId, activeKeys) : 0;
  const basisCents = ac.splitGuard ? (totalCents + recentCents) : totalCents;
  const rawTier = totalCents <= autoMaxCents ? 'auto' : totalCents <= regionMaxCents ? 'region' : 'central';
  const tier = basisCents <= autoMaxCents ? 'auto' : basisCents <= regionMaxCents ? 'region' : 'central';
  const splitUpgraded = ac.splitGuard && tier !== rawTier;
  const autoSkip = overAmountCents <= 0 && tier === 'auto' && ac.autoSkipReview;
  const nextStep = autoSkip ? 'supplier' : 'order-review';

  let pathText = '';
  if (hardOver) {
    pathText = '超出科目可用额度 ¥' + fmt.money(overAmountCents / 100) + '，且超过机动池上限（¥' + fmt.money(flexCents / 100) + '），无法提交，请拆分下单或联系运营管理部';
  } else if (overAmountCents > 0) {
    pathText = '提交后先由战区审核（需填写超预算理由），通过后由运营管理部一步完成预算核定与金额审批';
  } else if (autoSkip) {
    pathText = '预算内且 ≤¥' + fmt.money(ac.autoMax) + '（含近' + ac.splitDays + '天累计），免战区审核直接发送供应商';
  } else if (tier === 'auto') {
    pathText = '提交后由战区审核，通过即发送供应商（≤¥' + fmt.money(ac.autoMax) + ' 免金额审批）';
  } else if (tier === 'region') {
    pathText = '提交后由战区一步终审（合规 + ¥' + fmt.money(ac.autoMax) + '–' + fmt.money(ac.regionMax) + ' 金额合并审核），通过即发送供应商' +
      (splitUpgraded ? '（近' + ac.splitDays + '天累计 ¥' + fmt.money(basisCents / 100) + ' 触发防拆单升级）' : '');
  } else {
    pathText = '提交后先由战区审核，再报运营管理部金额审批（>¥' + fmt.money(ac.regionMax) + '）' +
      (splitUpgraded ? '（近' + ac.splitDays + '天累计 ¥' + fmt.money(basisCents / 100) + ' 触发防拆单升级）' : '');
  }

  return {
    total: totalCents / 100,
    available: availableCents / 100,
    availableAll: round2(BUDGET.KEYS.reduce(function (s, k) {
      return s + storeUsableCents(state, input.store, input.excludeId || null, k) / 100;
    }, 0)),
    budgetItems: budgetRows,
    overAmount: overAmountCents / 100,
    overBudget: overAmountCents > 0,
    flexLeft: flexCents / 100,
    maxSupport: maxSupportCents / 100,
    hardOver: hardOver,
    tier: tier,
    rawTier: rawTier,
    splitUpgraded: splitUpgraded,
    recentTotal: recentCents / 100,
    cumulativeTotal: basisCents / 100,
    splitDays: ac.splitDays,
    tierLabel: fmt.TIER_LABEL[tier],
    nextStep: nextStep,
    items: confirmed,
    pathText: pathText
  };
}

/* ------------------------- 门店下单 ------------------------- */
function createSingleStoreOrder(state, session, input, groupId) {
  const details = input.details || {};
  const address = String(details.address || '').trim();
  const receiver = String(details.receiver || '').trim();
  const purpose = String(details.purpose || '门店日常运营').slice(0, 80);
  const note = String(details.note || '').slice(0, 500);
  const overReason = String(details.overReason || input.overReason || '').trim().slice(0, 200);
  const due = String(details.due || '').slice(0, 80) || '待供应商确认';

  const quote = computeQuote(state, input);
  if (quote.hardOver) {
    throw new Error('超出门店科目可用额度与机动池可核定上限（最多可核定 ¥' + fmt.money(quote.maxSupport) + '），请缩减数量、拆分下单或联系运营管理部');
  }
  if (quote.overBudget && overReason && overReason.length < 4) {
    throw new Error('超预算原因至少填写 4 个字');
  }

  const catMap = catalogMapOf(state);
  const number = Math.max.apply(null, [Number(state.seq) || 0].concat(state.orders.map(function (o) {
    const m = String(o.id || '').match(/^SQ-(\d+)$/);
    return m ? Number(m[1]) : 0;
  }))) + 1;
  const id = 'SQ-' + String(number).padStart(4, '0');

  const items = quote.items.map(function (line) {
    const p = catMap[line.id] || CATALOG_BY_ID[line.id];
    return {
      id: p.id, name: p.name, spec: p.spec, unit: p.unit, price: line.unitPrice,
      supplier: p.supplier, category: p.category, budgetItem: p.budgetItem, demoOnly: p.demoOnly,
      qty: line.qty, accepted: 0, reconciled: 0
    };
  });
  const now = new Date().toISOString();
  const initStatus = quote.nextStep || 'order-review';
  const supplierRecords = {};
  items.forEach(function (p) {
    supplierRecords[p.supplier] = {
      status: 'pending',
      delivered: false,
      pendingSince: initStatus === 'supplier' ? now : null
    };
  });

  const order = {
    id: id,
    purchaseType: 'store',
    groupId: groupId || null,
    store: input.store,
    zone: zoneOf(input.store) || session.zone || '',
    manager: session.name,
    submittedBy: session.id,
    items: items,
    total: quote.total,
    tier: quote.tier,
    splitUpgraded: quote.splitUpgraded,
    overPending: quote.overBudget,
    overAmount: quote.overAmount,
    overReason: overReason,
    regionApproved: initStatus === 'supplier',
    centralApproved: false,
    budgetApproved: !quote.overBudget,
    status: initStatus,
    purpose: purpose,
    address: address,
    receiver: receiver,
    due: due,
    note: note,
    created: fmt.nowText(),
    createdAt: now,
    supplierSentAt: initStatus === 'supplier' ? now : null,
    stageStartedAt: now,
    supplierRecords: supplierRecords,
    budgetApplied: false,
    quoteSource: 'miniprogram-v1.26'
  };
  state.orders.unshift(order);
  state.seq = number;
  return { order: order, quote: quote };
}

function createStoreOrder(state, session, input) {
  if (!session || session.role !== 'store') throw new Error('请先切换为门店店长身份');
  if (!session.stores || session.stores.indexOf(input.store) < 0) throw new Error('该测试店长无此门店权限');
  const details = input.details || {};
  const address = String(details.address || '').trim();
  const receiver = String(details.receiver || '').trim();
  if (!address || !receiver || address.length > 180 || receiver.length > 80) throw new Error('请检查收货地址和联系人');

  const wholeQuote = computeQuote(state, input);
  if (wholeQuote.hardOver) {
    throw new Error('超出门店科目可用额度与机动池可核定上限（最多可核定 ¥' + fmt.money(wholeQuote.maxSupport) + '），请缩减数量、拆分下单或联系运营管理部');
  }
  const overReason = String(details.overReason || input.overReason || '').trim();
  if (wholeQuote.overBudget && overReason && overReason.length < 4) {
    throw new Error('超预算原因至少填写 4 个字');
  }

  if (input.splitByContract) {
    const catMap = catalogMapOf(state);
    const bySupplier = {};
    const supOrder = [];
    (input.items || []).forEach(function (line) {
      const p = catMap[line.id] || CATALOG_BY_ID[line.id];
      const sup = (p && p.supplier) || '其他供应商';
      if (!bySupplier[sup]) { bySupplier[sup] = []; supOrder.push(sup); }
      bySupplier[sup].push(line);
    });
    if (supOrder.length > 1) {
      const groupId = 'SG-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + ((Number(state.seq) || 0) + 1);
      const created = supOrder.map(function (sup) {
        return createSingleStoreOrder(state, session, Object.assign({}, input, { items: bySupplier[sup] }), groupId).order;
      });
      return { order: created[0], orders: created, quote: wholeQuote, splitByContract: true, groupId: groupId };
    }
  }

  const single = createSingleStoreOrder(state, session, input, null);
  return { order: single.order, orders: [single.order], quote: single.quote, splitByContract: false };
}

/* ------------------------- 职能部门采购（不设预算，受供应商合同总额上限约束） ------------------------- */
function checkContractCap(state, bySupplierCents) {
  const summaries = contractSummary(state);
  const bySup = {};
  summaries.forEach(function (c) { bySup[c.supplier] = c; });
  Object.keys(bySupplierCents).forEach(function (sup) {
    const needCents = bySupplierCents[sup];
    if (needCents <= 0) return;
    const contract = bySup[sup];
    if (!contract) return;
    const remainCents = cents(contract.remaining);
    if (needCents > remainCents) {
      throw new Error(
        '超出「' + sup + '」合同总额上限（合同总额 ¥' + fmt.money(contract.total) +
        '，剩余可用 ¥' + fmt.money(contract.remaining) +
        '，本次申请 ¥' + fmt.money(needCents / 100) + '）'
      );
    }
  });
}

function computeDepartmentQuote(state, items) {
  const catMap = catalogMapOf(state);
  const bySupplier = {};
  let totalCents = 0;
  (items || []).forEach(function (raw) {
    const p = catMap[raw.id] || CATALOG_BY_ID[raw.id];
    if (!p || p.deleted || p.enabled === false) return;
    const amt = cents(p.price) * Number(raw.qty || 0);
    totalCents += amt;
    bySupplier[p.supplier] = (bySupplier[p.supplier] || 0) + amt;
  });
  const summaries = contractSummary(state);
  const contractRows = summaries.filter(function (c) { return bySupplier[c.supplier] > 0; }).map(function (c) {
    const apply = round2((bySupplier[c.supplier] || 0) / 100);
    const over = round2(Math.max(0, apply - c.remaining));
    return {
      id: c.id,
      supplier: c.supplier,
      name: c.name,
      total: c.total,
      used: c.used,
      remaining: c.remaining,
      apply: apply,
      over: over,
      overCap: over > 0
    };
  });
  const overCap = contractRows.some(function (r) { return r.overCap; });
  return {
    total: round2(totalCents / 100),
    contractRows: contractRows,
    overCap: overCap
  };
}

function createDepartmentOrders(state, session, input) {
  if (!session || ['department', 'central'].indexOf(session.role) < 0 || !session.department) {
    throw new Error('请切换为职能部门或运营管理部身份');
  }
  if (!input || !Array.isArray(input.destinations) || input.destinations.length < 1 || input.destinations.length > 20) {
    throw new Error('请选择1至20个配送地点');
  }
  const catMap = catalogMapOf(state);
  const note = String(input.note || '').trim().slice(0, 300);
  const purpose = String(input.purpose || '部门日常采购').slice(0, 80);
  const seenDest = {};
  const validated = [];
  const bySupplierCents = {};
  let grandCents = 0;

  input.destinations.forEach(function (dest) {
    if (!dest || ['store', 'office'].indexOf(dest.type) < 0) throw new Error('配送地点类型无效');
    const name = String(dest.name || '').trim();
    const address = String(dest.address || '').trim();
    const receiver = String(dest.receiver || '').trim();
    if (dest.type === 'store' && STORES.indexOf(name) < 0) throw new Error('请从门店清单选择配送门店');
    if (dest.type === 'office' && name !== '公司总部') throw new Error('办公收货地请选择公司总部');
    if (!address || address.length > 180 || !receiver || receiver.length > 80) throw new Error('请填写收货地址和收货人');
    const key = dest.type + ':' + name;
    if (seenDest[key]) throw new Error('同一配送地点请合并填写');
    seenDest[key] = 1;
    if (!Array.isArray(dest.items) || dest.items.length < 1 || dest.items.length > 80) throw new Error('每个配送地点至少选择一种商品');
    const seenItems = {};
    const lines = [];
    let sum = 0;
    dest.items.forEach(function (raw) {
      if (!raw || !raw.id || !Number.isSafeInteger(raw.qty) || raw.qty < 1 || raw.qty > 9999) throw new Error('数量须为1至9999的整数');
      if (seenItems[raw.id]) throw new Error('同一地点商品重复');
      seenItems[raw.id] = 1;
      const p = catMap[raw.id] || CATALOG_BY_ID[raw.id];
      if (!p || p.deleted || p.enabled === false || typeof p.price !== 'number' || p.price <= 0) {
        throw new Error('所选商品已下架或暂不可采购');
      }
      if (session.role !== 'central' && normalizeScope(p) === 'central') {
        throw new Error('「' + p.name + '」已设为仅运营管理部（中台）集中采购，请由运营管理部统一下单');
      }
      const unit = cents(p.price);
      const lineCents = unit * raw.qty;
      sum += lineCents;
      bySupplierCents[p.supplier] = (bySupplierCents[p.supplier] || 0) + lineCents;
      lines.push({
        id: p.id, name: p.name, spec: p.spec, unit: p.unit, price: unit / 100,
        supplier: p.supplier, category: p.category, budgetItem: p.budgetItem, demoOnly: p.demoOnly,
        qty: raw.qty, accepted: 0, reconciled: 0
      });
    });
    grandCents += sum;
    validated.push({ type: dest.type, name: name, address: address, receiver: receiver, items: lines, total: sum / 100 });
  });
  if (grandCents <= 0 || grandCents > 1000000000) throw new Error('金额超出演示范围');

  // 职能部门不设预算，但总费用不得超过所涉供应商合同总额
  checkContractCap(state, bySupplierCents);

  let seq = Math.max.apply(null, [Number(state.seq) || 0].concat(state.orders.map(function (o) {
    const m = String(o.id || '').match(/^SQ-(\d+)$/);
    return m ? Number(m[1]) : 0;
  })));
  const groupId = 'DP-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + (seq + 1);
  const now = new Date().toISOString();
  const generated = [];
  // 运营管理部自采不需要"自己确认自己"：提交后直接发送供应商；部门单仍需中台统一确认
  const selfPurchase = session.role === 'central';

  validated.forEach(function (dst) {
    const id = 'SQ-' + String(++seq).padStart(4, '0');
    const supplierRecords = {};
    dst.items.forEach(function (p) {
      supplierRecords[p.supplier] = { status: 'pending', delivered: false, pendingSince: selfPurchase ? now : null };
    });
    generated.push({
      id: id,
      purchaseType: 'department',
      department: session.department,
      groupId: groupId,
      receivingType: dst.type,
      store: dst.name,
      zone: dst.type === 'store' ? (zoneOf(dst.name) || '') : '总部',
      manager: session.name,
      submittedBy: session.id,
      items: dst.items,
      total: dst.total,
      tier: 'department',
      overPending: false,
      overAmount: 0,
      regionApproved: false,
      centralApproved: selfPurchase,
      budgetApproved: true,
      status: selfPurchase ? 'supplier' : 'dept-approval',
      purpose: purpose,
      address: dst.address,
      receiver: dst.receiver,
      due: '待供应商确认',
      note: note,
      created: fmt.nowText(),
      createdAt: now,
      stageStartedAt: now,
      supplierSentAt: selfPurchase ? now : null,
      supplierRecords: supplierRecords,
      budgetApplied: false,
      quoteSource: 'department-miniprogram-v1.25'
    });
  });

  state.orders = generated.concat(state.orders);
  state.seq = seq;
  return { groupId: groupId, orders: generated, total: grandCents / 100 };
}

function approveDepartmentGroup(state, session, groupId, pass, noteText) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可确认部门采购');
  if (!/^DP-[0-9]{14}-[0-9]{1,10}$/.test(String(groupId || ''))) throw new Error('采购批次编号无效');
  const orders = (state.orders || []).filter(function (o) {
    return o.groupId === groupId && o.purchaseType === 'department';
  });
  if (!orders.length) throw new Error('找不到部门采购批次');
  if (orders.some(function (o) { return o.status !== 'dept-approval'; })) throw new Error('批次已处理，请刷新');
  const remark = String(noteText || '').trim().slice(0, 200);
  if (!pass && remark && remark.length < 2) throw new Error('请填写驳回原因');
  const now = new Date().toISOString();
  const audits = [];
  orders.forEach(function (o) {
    o.status = pass ? 'supplier' : 'rejected';
    o.centralApproved = !!pass;
    o.confirmedAt = now;
    o.stageStartedAt = now;
    if (!pass && remark) o.rejectReason = remark;
    if (pass) {
      o.supplierSentAt = now;
      Object.keys(o.supplierRecords || {}).forEach(function (k) { o.supplierRecords[k].pendingSince = now; });
    }
    audits.push({
      orderId: o.id, kind: 'approval', stage: 'dept-approval', decision: pass ? '确认采购' : '驳回',
      role: '运营管理部（' + session.id + '，模拟）', from: 'dept-approval', to: o.status,
      note: '部门采购批次 ' + groupId + (remark ? '；说明：' + remark : ''), at: now
    });
  });
  return { count: orders.length, status: pass ? 'supplier' : 'rejected', audits: audits };
}

/* ------------------------- 审批（优化后：去重合并 + 驳回原因 + 数量微调 + 批量通过） -------------------------
 * 关键优化：
 * 1. 预算内 500–2000 元门店单：战区在 order-review 一步终审（合规 + 金额合并），不再二次进入 amount-approval 让同一人点两遍；
 * 2. 超预算门店单：战区审核通过 → 运营管理部在 budget-central 一步完成「预算核定 + 金额审批」，不再二次进入 amount-approval；
 * 3. 支持审批时微调商品数量（payload.adjustQuantities: { itemId: newQty }），以及填写审批/驳回意见（payload.note）。
 */
function permissionFor(stage, order) {
  if (stage === 'order-review' || stage === 'budget-region') return 'region';
  if (stage === 'amount-approval') return order.tier === 'region' ? 'region' : 'central';
  return 'central';
}

function applyApprovalQtyAdjust(state, order, adjustMap) {
  if (!adjustMap || typeof adjustMap !== 'object') return [];
  const changes = [];
  (order.items || []).forEach(function (item) {
    if (adjustMap[item.id] === undefined) return;
    const nextQty = Number(adjustMap[item.id]);
    if (!Number.isSafeInteger(nextQty) || nextQty < 1 || nextQty > 9999) {
      throw new Error(item.name + ' 调整后的数量须为 1 至 9999 的整数');
    }
    if (nextQty !== item.qty) {
      changes.push(item.name + ' ' + item.qty + '→' + nextQty);
      item.qty = nextQty;
    }
  });
  if (!changes.length) return [];
  let sumCents = 0;
  (order.items || []).forEach(function (item) {
    sumCents += cents(item.price) * Number(item.qty || 0);
  });
  order.total = round2(sumCents / 100);
  // 重算预算超额与档位
  const ac = approvalConfigOf(state);
  const split = splitOrder(order);
  let overCents = 0;
  BUDGET.KEYS.forEach(function (k) {
    if (split[k].total <= 0) return;
    const usable = storeUsableCents(state, order.store, order.id, k);
    overCents += Math.max(0, cents(split[k].total) - usable);
  });
  order.overAmount = round2(overCents / 100);
  order.overPending = overCents > 0 && !order.budgetApproved;
  const activeKeys = BUDGET.KEYS.filter(function (k) { return split[k].total > 0; });
  const recentCents = ac.splitGuard ? recentStoreCents(state, order.store, ac.splitDays, order.id, activeKeys) : 0;
  const basisCents = sumCents + recentCents;
  order.tier = basisCents <= cents(ac.autoMax) ? 'auto' : basisCents <= cents(ac.regionMax) ? 'region' : 'central';
  return changes;
}

function approveOrder(state, session, payload) {
  const orderId = String(payload.orderId || '');
  const stage = payload.stage;
  if (!/^SQ-[0-9]{4,10}$/.test(orderId)) throw new Error('无效的订单编号');
  if (['order-review', 'budget-region', 'budget-central', 'amount-approval'].indexOf(stage) < 0) throw new Error('无效的审批阶段');
  if (typeof payload.pass !== 'boolean') throw new Error('审批决定无效');
  const order = (state.orders || []).filter(function (o) { return o.id === orderId; })[0];
  if (!order) throw new Error('订单不存在，请刷新');
  if (order.status !== stage) throw new Error('订单状态已变化，请刷新后重试');
  const permitted = permissionFor(stage, order);
  if (!session || session.role !== permitted) {
    throw new Error('当前身份无权审核此节点：需要' + (permitted === 'region' ? '战区负责人' : '运营管理部'));
  }
  if (permitted === 'region' && order.zone !== session.zone) throw new Error('当前身份仅可审批' + session.zone + '的订单');

  const remark = String(payload.note || payload.reason || '').trim().slice(0, 200);
  if (!payload.pass && payload.requireReason && remark.length < 2) {
    throw new Error('请填写至少2个字的驳回原因');
  }

  const original = order.status;
  let who = ({
    'order-review': '战区负责人',
    'budget-region': '战区负责人',
    'budget-central': '运营预算管理员'
  })[stage] || (order.tier === 'region' ? '战区审批人' : '中台审批人');
  who = who + '（' + session.id + '，模拟）';
  let note = '';

  const qtyChanges = payload.pass ? applyApprovalQtyAdjust(state, order, payload.adjustQuantities) : [];
  const ac = approvalConfigOf(state);

  if (!payload.pass) {
    // 若此前已核定追加预算（金额审批阶段被驳回），额度要退回机动预算
    const reverted = revertBudgetTransfer(state, order);
    order.status = 'rejected';
    order.overPending = false;
    if (remark) order.rejectReason = remark;
    note = (remark ? '驳回原因：' + remark + '；' : '审批驳回；') +
      '演示环境不会发送供应商' + (reverted ? '；退回追加预算 ' + reverted.toFixed(2) + ' 元' : '');
  } else if (stage === 'order-review') {
    order.regionApproved = true;
    if (order.overPending) {
      // 战区同意采购，但额度不够：转运营管理部一步核定（追加机动池 / 门店间调剂 + 金额终审）
      order.status = 'budget-central';
      note = '战区审核通过；超出科目额度，转运营管理部核定预算';
    } else if (order.tier === 'auto') {
      order.status = 'supplier';
      note = '战区审核通过；≤¥' + fmt.money(ac.autoMax) + ' 免金额审批，直接发送供应商';
    } else if (order.tier === 'region') {
      // 优化：500–2000 元预算内订单由战区一步终审（合规 + 金额合并），免去同一人二次点击
      order.status = 'supplier';
      note = '战区一步终审通过（含 ¥' + fmt.money(ac.autoMax) + '–' + fmt.money(ac.regionMax) + ' 金额审批），已发送供应商';
    } else {
      order.status = 'amount-approval';
      note = '战区审核通过；>¥' + fmt.money(ac.regionMax) + '，转运营管理部金额审批';
    }
  } else if (stage === 'budget-region') {
    order.regionApproved = true;
    order.status = 'budget-central';
    note = '预算追加：战区审核通过，转运营管理部核定';
  } else if (stage === 'budget-central') {
    const gap = budgetGap(state, order);
    if (!gap.ok) {
      // 不抛裸文案：把缺口算清楚交给页面，让审批人能追加机动预算 / 调剂门店额度 / 让门店拆单
      const err = new Error('机动预算不足，还差 ¥' + fmt.money(gap.short) + '（单笔最多可核定 ¥' + fmt.money(gap.maxSupport) + '）');
      err.code = 'FLEX_SHORT';
      err.gap = gap;
      err.orderId = order.id;
      throw err;
    }
    const added = applyGapBudget(state, order, gap);
    order.budgetApproved = true;
    order.overPending = false;
    order.centralApproved = true;
    order.budgetSplit = (function () {
      const s = splitOrder(order);
      const out = {};
      BUDGET.KEYS.forEach(function (k) {
        if (s[k].total > 0) out[k] = s[k].total;
      });
      return out;
    })();
    // 优化：运营管理部既是预算核定人也是最高金额审批人，一步完成核定并直发供应商
    order.status = 'supplier';
    note = (added > 0 ? '追加预算（模拟）：' + fmt.money(added) + '元；' : '额度内核定；') +
      '中台一步完成预算核定与金额审批，待供应商接单';
  } else if (stage === 'amount-approval') {
    order.centralApproved = order.tier === 'central' || order.centralApproved;
    order.status = 'supplier';
    note = order.tier === 'region' ? '战区金额审批通过' : '中台金额审批通过';
  }

  if (qtyChanges.length) note = '调整数量（' + qtyChanges.join('、') + '）；' + note;
  if (payload.pass && remark) note = note + '；审批意见：' + remark;

  const now = new Date().toISOString();
  if (order.status !== original) {
    order.stageStartedAt = now;
    if (order.status === 'supplier') {
      order.supplierSentAt = now;
      Object.keys(order.supplierRecords || {}).forEach(function (k) {
        if (order.supplierRecords[k].status === 'pending') order.supplierRecords[k].pendingSince = now;
      });
    }
  }
  return {
    order: order,
    audit: {
      orderId: order.id, kind: 'approval', stage: stage, decision: payload.pass ? '通过' : '驳回',
      role: who, from: original, to: order.status, note: note, at: now
    }
  };
}

// 批量通过当前审批人名下所有「预算内（无缺口）」待审门店单
function batchApproveOrders(state, session, payload) {
  if (!session || ['region', 'central'].indexOf(session.role) < 0) {
    throw new Error('当前身份无批量审批权限');
  }
  const p = payload || {};
  const ids = Array.isArray(p.orderIds) && p.orderIds.length
    ? p.orderIds
    : pendingApprovals(state, session)
        .filter(function (o) { return o.status !== 'dept-approval' && !o.overPending; })
        .map(function (o) { return o.id; });
  if (!ids.length) throw new Error('没有符合批量通过条件的预算内待审订单');
  const audits = [];
  const orders = [];
  ids.forEach(function (id) {
    const o = (state.orders || []).filter(function (x) { return x.id === id; })[0];
    if (!o || o.status === 'dept-approval' || o.overPending) return;
    const res = approveOrder(state, session, {
      orderId: o.id,
      stage: o.status,
      pass: true,
      note: p.note || '批量审批通过'
    });
    orders.push(res.order);
    audits.push(res.audit);
  });
  if (!orders.length) throw new Error('没有可批量通过的订单');
  return { count: orders.length, orders: orders, audits: audits };
}

/* ------------------------- 撤销 ------------------------- */
function cancelOrder(state, session, orderId) {
  if (!session || ['store', 'department', 'central'].indexOf(session.role) < 0) throw new Error('当前身份不能撤销订单');
  if (!/^SQ-[0-9]{4,10}$/.test(String(orderId || ''))) throw new Error('订单编号不正确');
  const order = (state.orders || []).filter(function (o) { return o.id === orderId; })[0];
  if (!order) throw new Error('找不到这笔订单，请刷新后重试');
  if (order.submittedBy && order.submittedBy !== session.id) throw new Error('只能撤销本人提交的测试订单');
  if (order.status === 'cancelled') throw new Error('订单已经撤销');

  if (session.role === 'store') {
    if (order.purchaseType === 'department') throw new Error('部门采购单请由提交部门撤销');
    if (session.stores.indexOf(order.store) < 0) throw new Error('无权撤销其他门店的订单');
  } else {
    if (order.purchaseType !== 'department' || order.department !== session.department) throw new Error('只能撤销本部门提交的采购单');
    if (order.status !== 'dept-approval') throw new Error('该采购单已由运营管理部确认，不能再撤销');
  }

  const allowed = session.role === 'store'
    ? ['order-review', 'budget-region', 'budget-central', 'amount-approval', 'supplier']
    : ['dept-approval'];
  if (allowed.indexOf(order.status) < 0) throw new Error('订单已进入履约流程，不能直接撤销，请联系运营管理部');
  if (order.status === 'supplier') {
    const blocking = Object.keys(order.supplierRecords || {}).some(function (k) {
      const r = order.supplierRecords[k];
      return r && (r.status !== 'pending' || r.delivered || r.issue);
    });
    if (blocking) throw new Error('供应商已接单或反馈异常，不能由门店直接撤销');
  }
  const released = !order.overPending ? Math.round(Number(order.total || 0) * 100) : 0;
  const from = order.status;
  const reverted = revertBudgetTransfer(state, order);
  order.status = 'cancelled';
  order.overPending = false;
  order.cancelledBy = session.id;
  order.cancelledAt = new Date().toISOString();
  return {
    order: order,
    audit: {
      orderId: order.id, kind: 'cancel', stage: 'cancel', decision: '撤销',
      role: session.name + '（' + session.id + '，模拟）', from: from, to: 'cancelled',
      note: '释放占用金额 ' + (released / 100).toFixed(2) + ' 元' +
        (reverted ? '；退回追加预算 ' + reverted.toFixed(2) + ' 元' : ''),
      at: new Date().toISOString()
    }
  };
}

/* ------------------------- 采购方关闭停滞订单 ------------------------- */
// 供应商反馈"无法接单"后若一直不撤回，订单会停在待接单并占着流程；
// 运营管理部可主动关闭，释放预算占用并留下审计痕迹。
function closeOrder(state, session, payload) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可关闭停滞订单');
  const orderId = String(payload.orderId || '');
  if (!/^SQ-[0-9]{4,10}$/.test(orderId)) throw new Error('订单编号不正确');
  const order = (state.orders || []).filter(function (o) { return o.id === orderId; })[0];
  if (!order) throw new Error('找不到这笔订单，请刷新后重试');
  // 允许关闭「待接单」与「已接单但从未发货」的停滞订单：
  // 后者以前没有任何角色能处理，订单会永久卡在备货中并占着预算。
  if (['supplier', 'preparing'].indexOf(order.status) < 0) throw new Error('仅未发货订单可关闭');
  const records = Object.keys(order.supplierRecords || {}).map(function (k) { return order.supplierRecords[k]; });
  if (!records.length) throw new Error('订单缺少供应商信息');
  const shipped = records.some(function (r) {
    return r && (r.delivered || ['shipping', 'accepted'].indexOf(r.status) >= 0 || (r.deliveries && r.deliveries.length));
  });
  if (shipped) throw new Error('供应商已发货，请走正常履约流程');
  const reason = String(payload.reason || '').trim().slice(0, 120);
  const released = !order.overPending ? Math.round(Number(order.total || 0) * 100) : 0;
  const reverted = revertBudgetTransfer(state, order);
  const from = order.status;
  order.status = 'cancelled';
  order.overPending = false;
  order.cancelledBy = session.id;
  order.cancelledAt = new Date().toISOString();
  order.closeReason = reason || '供应商无法接单，运营管理部关闭订单';
  return {
    order: order,
    released: released / 100,
    audit: {
      orderId: order.id, kind: 'cancel', stage: 'cancel', decision: '关闭订单',
      role: '运营管理部（' + session.id + '，模拟）', from: from, to: 'cancelled',
      note: order.closeReason + '；释放占用金额 ' + (released / 100).toFixed(2) + ' 元' +
        (reverted ? '；退回追加预算 ' + reverted.toFixed(2) + ' 元' : ''),
      at: order.cancelledAt
    }
  };
}

/* ------------------------- 供应商接单 ------------------------- */
// 供应商阶段的订单状态：有人发货即「配送中」；全部接单未发货为「备货中」；仍有人未接单为「待接单」。
// 注意发货动作不再直接把订单置为「已送达」——送达由门店验收环节体现。
function syncSupplierStage(order) {
  const recs = Object.keys(order.supplierRecords || {}).map(function (k) { return order.supplierRecords[k]; });
  if (!recs.length) return order.status;
  const shipped = recs.some(function (r) {
    return r && (r.status === 'shipping' || r.delivered || (r.deliveries && r.deliveries.length));
  });
  const waiting = recs.some(function (r) { return r && ['pending', 'issue'].indexOf(r.status) >= 0; });
  order.status = shipped ? 'delivering' : (waiting ? 'supplier' : 'preparing');
  return order.status;
}

function supplierAck(state, session, payload) {
  if (!session || session.role !== 'supplier' || !session.supplier) throw new Error('请切换为供应商身份');
  const order = (state.orders || []).filter(function (o) { return o.id === payload.orderId; })[0];
  if (!order) throw new Error('找不到订单，请刷新后重试');
  if (['supplier', 'preparing', 'delivering', 'partial'].indexOf(order.status) < 0) {
    throw new Error('当前订单状态（' + fmt.statusLabel(order.status) + '）不允许接单操作');
  }
  const sub = (order.supplierRecords || {})[session.supplier];
  if (!sub) throw new Error('订单不属于当前测试供应商');
  if (sub.status !== 'pending' || sub.delivered || sub.issue) throw new Error('该订单已处理，不能重复接单');
  const reason = String(payload.reason || '').trim();
  if (payload.action === 'issue' && (reason.length < 2 || reason.length > 300)) throw new Error('请填写2至300字的无法接单原因');
  const now = new Date().toISOString();
  const from = sub.status;
  if (payload.action === 'confirm') {
    sub.status = 'confirmed';
    sub.confirmedAt = now;
    sub.confirmedBy = session.id;
    syncSupplierStage(order);
    order.stageStartedAt = now;
  } else {
    sub.status = 'issue';
    sub.issue = reason;
    sub.issueAt = now;
  }
  return {
    order: order,
    audit: {
      orderId: order.id, kind: 'supplier-ack', stage: 'supplier', decision: payload.action === 'confirm' ? '确认接单' : '无法接单',
      role: session.supplier, from: from, to: sub.status,
      note: payload.action === 'issue' ? reason : '供应商确认接单（模拟）', at: now
    }
  };
}

/* ------------------------- 撤回拒单 ------------------------- */
// 供应商反馈"无法接单"后订单会停在待接单状态无人推进，
// 这里允许供应商自己撤回，恢复为 pending，避免订单卡死。
function reopenSupplierAck(state, session, payload) {
  if (!session || session.role !== 'supplier' || !session.supplier) throw new Error('请切换为供应商身份');
  const order = (state.orders || []).filter(function (o) { return o.id === payload.orderId; })[0];
  if (!order) throw new Error('找不到订单，请刷新后重试');
  if (['supplier', 'preparing', 'delivering', 'partial'].indexOf(order.status) < 0) {
    throw new Error('当前订单状态（' + fmt.statusLabel(order.status) + '）不允许撤回拒单');
  }
  const sub = (order.supplierRecords || {})[session.supplier];
  if (!sub) throw new Error('订单不属于当前测试供应商');
  if (sub.status !== 'issue') throw new Error('该订单当前没有待处理的拒单记录');
  if (sub.delivered) throw new Error('订单已发货，不能撤回拒单');

  const now = new Date().toISOString();
  const from = sub.status;
  sub.status = 'pending';
  const keepIssue = sub.issue || '';
  delete sub.issue;
  delete sub.issueAt;
  // 撤回后订单整体状态需要按其他供应商的进度重算，否则会停在「备货中/配送中」
  syncSupplierStage(order);
  order.stageStartedAt = now;

  return {
    order: order,
    audit: {
      orderId: order.id, kind: 'supplier-ack', stage: 'supplier', decision: '撤回拒单',
      role: session.supplier, from: from, to: 'pending',
      note: keepIssue ? ('原拒单原因：' + keepIssue) : '供应商撤回拒单', at: now
    }
  };
}

/* ------------------------- 分批发货 ------------------------- */
function supplierDeliver(state, session, payload) {
  if (!session || session.role !== 'supplier' || !session.supplier) throw new Error('请切换为供应商身份');
  const order = (state.orders || []).filter(function (o) { return o.id === payload.orderId; })[0];
  if (!order) throw new Error('找不到订单，请刷新后重试');
  if (['supplier', 'preparing', 'delivering', 'partial'].indexOf(order.status) < 0) {
    throw new Error('当前订单状态（' + fmt.statusLabel(order.status) + '）不允许登记发货');
  }
  const supplier = session.supplier;
  const sub = (order.supplierRecords || {})[supplier];
  if (!sub) throw new Error('该订单不属于当前模拟供应商');
  if (['confirmed', 'shipping'].indexOf(sub.status) < 0) throw new Error('请先确认接单，再登记配送');
  if (!Array.isArray(payload.lines) || !payload.lines.length) throw new Error('请选择本次交付的商品');

  const shipping = payload.shipping || {};
  if (SHIPPING_METHODS[shipping.method] === undefined) throw new Error('请选择有效的配送方式');
  const clean = function (value, max) {
    const v = String(value || '').trim();
    if (v.length > (max || 100)) throw new Error('配送信息长度超过限制');
    return v;
  };
  const carrier = clean(shipping.carrier, 60);
  const trackingNo = clean(shipping.trackingNo, 100);
  const contact = clean(shipping.contact, 80);
  const estimatedAt = clean(shipping.estimatedAt, 40);
  if (shipping.method === 'express' && (!carrier || !trackingNo)) throw new Error('快递配送必须填写快递公司和运单号');
  if ((shipping.method === 'lalamove' || shipping.method === 'runner') && !trackingNo) throw new Error('同城配送请填写平台订单号');
  if (shipping.method === 'self' && !contact) throw new Error('自行配送请填写配送安排或联系人');
  if (trackingNo && !/^[0-9A-Za-z_-]{4,100}$/.test(trackingNo)) throw new Error('单号只能使用字母、数字、下划线或连字符，至少4位');

  const ownLines = order.items.filter(function (x) { return x.supplier === supplier; });
  const byId = {};
  ownLines.forEach(function (x) { byId[x.id] = x; });
  const batch = [];
  const seen = {};
  payload.lines.forEach(function (line) {
    if (!line || !line.id || !Number.isSafeInteger(line.qty) || line.qty < 1) throw new Error('交付数量须为正整数');
    if (seen[line.id]) throw new Error('同一次交付不能重复填写商品');
    seen[line.id] = 1;
    const item = byId[line.id];
    if (!item) throw new Error('存在不属于本供应商的商品');
    const sent = Number(item.deliveredQty || 0);
    if (line.qty > item.qty - sent) throw new Error(item.name + ' 超过剩余待交付数量（剩余 ' + (item.qty - sent) + '）');
    batch.push({ id: item.id, name: item.name, qty: line.qty });
  });

  const now = new Date().toISOString();
  batch.forEach(function (line) { byId[line.id].deliveredQty = Number(byId[line.id].deliveredQty || 0) + line.qty; });
  const batchNo = (sub.deliveries && sub.deliveries.length ? sub.deliveries.length : 0) + 1;
  if (!Array.isArray(sub.deliveries)) sub.deliveries = [];
  const delivery = {
    batchNo: batchNo,
    lines: batch,
    note: String(payload.note || '').trim().slice(0, 300),
    shipping: { method: shipping.method, carrier: carrier, trackingNo: trackingNo, contact: contact, estimatedAt: estimatedAt },
    at: now
  };
  sub.deliveries.push(delivery);

  const supplierComplete = ownLines.every(function (x) { return Number(x.deliveredQty || 0) === x.qty; });
  if (supplierComplete) {
    // 全部商品已发出 → 配送中；不再标记为已送达，送达以门店验收为准
    sub.status = 'shipping';
    sub.shippedAt = now;
  }
  const allComplete = order.items.every(function (x) {
    const r = order.supplierRecords[x.supplier];
    return r && r.status === 'shipping' && Number(x.deliveredQty === undefined ? x.qty : x.deliveredQty) === x.qty;
  });
  // 发货只推进到「配送中」，订单完成要等门店验收
  order.status = 'delivering';
  order.stageStartedAt = now;
  return {
    order: order, batchNo: batchNo, supplierComplete: supplierComplete, allComplete: allComplete,
    audit: {
      orderId: order.id, kind: 'delivery', stage: 'delivery',
      decision: '第' + batchNo + '批交付',
      role: supplier, from: 'delivering', to: order.status,
      note: batch.map(function (x) { return x.name + '×' + x.qty; }).join('、') + '；' + SHIPPING_METHODS[shipping.method] + (trackingNo ? ' ' + trackingNo : ''),
      at: now
    }
  };
}

/* ------------------------- 验收入库 ------------------------- */
function batchAvailability(order, supplier, batchNo) {
  const rec = (order.supplierRecords || {})[supplier];
  if (!rec || !Array.isArray(rec.deliveries)) throw new Error('未找到配送记录');
  const batch = rec.deliveries.filter(function (d) { return d.batchNo === batchNo; })[0];
  if (!batch) throw new Error('配送批次不存在');
  const ownItems = (order.items || []).filter(function (x) { return x.supplier === supplier; });
  const remaining = {};
  ownItems.forEach(function (x) {
    const explicit = rec.deliveries.reduce(function (sum, d) {
      return sum + Number((d.acceptedByItem || {})[x.id] || 0);
    }, 0);
    let legacy = Math.max(0, Number(x.accepted || 0) - explicit);
    rec.deliveries.forEach(function (d) {
      const row = (d.lines || []).filter(function (l) { return l.id === x.id; })[0];
      if (!row) return;
      const accepted = Number((d.acceptedByItem || {})[x.id] || 0);
      const toAllocate = Math.min(legacy, Math.max(0, row.qty - accepted));
      if (d.batchNo === batchNo) remaining[x.id] = Math.max(0, row.qty - accepted - toAllocate);
      legacy -= toAllocate;
    });
  });
  return { batch: batch, remaining: remaining };
}

function acceptDelivery(state, session, payload) {
  if (!session || ['store', 'department', 'central'].indexOf(session.role) < 0) throw new Error('请使用收货人身份验收');
  const order = (state.orders || []).filter(function (o) { return o.id === payload.orderId; })[0];
  if (!order) throw new Error('找不到订单');
  if (order.purchaseType === 'department') {
    if (order.receivingType === 'store') {
      if (session.role !== 'store' || session.stores.indexOf(order.store) < 0) throw new Error('请由目的门店的授权人员验收');
    } else if (session.department !== order.department) {
      throw new Error('请由采购部门授权人员验收总部配送');
    }
  } else if (session.role !== 'store' || session.stores.indexOf(order.store) < 0) {
    throw new Error('请由收货门店的授权人员验收');
  }
  if (['order-review', 'preparing', 'supplier', 'budget-region', 'budget-central', 'amount-approval', 'dept-approval', 'settle-pending', 'settle-supplier', 'settle-disputed', 'accepted', 'done', 'cancelled', 'rejected'].indexOf(order.status) >= 0) {
    throw new Error('订单尚未交付或已取消');
  }
  if (!payload.supplier) throw new Error('缺少供应商');
  if (!Number.isSafeInteger(payload.batchNo) || payload.batchNo < 1) throw new Error('请选择配送批次');
  if (['pass', 'issue'].indexOf(payload.result) < 0) throw new Error('请选择验收结果');
  // 照片留证为默认要求；仅当页面已确认当前环境无法调用相机/相册时，允许显式降级
  if (!payload.photoPath && payload.allowNoPhoto !== true) throw new Error('请拍摄或上传一张现场验收照片');
  const noPhoto = !payload.photoPath;
  const note = String(payload.note || '').trim();
  if (note.length > 300) throw new Error('备注不得超过300字');
  if (payload.result === 'pass' && payload.specChecked !== true) throw new Error('请先确认规格、数量及外观已核对');
  if (payload.result === 'issue' && note.length < 4) throw new Error('请填写至少4个字的异常情况');

  const avail = batchAvailability(order, payload.supplier, payload.batchNo);
  if (!Object.keys(avail.remaining).some(function (k) { return avail.remaining[k] > 0; })) throw new Error('该批次没有待验收数量');

  const byId = {};
  order.items.forEach(function (x) { byId[x.id] = x; });
  const confirmed = [];
  if (payload.result === 'pass') {
    if (!Array.isArray(payload.lines) || !payload.lines.length) throw new Error('请选择本次合格的商品及数量');
    const seen = {};
    payload.lines.forEach(function (line) {
      if (!line || !Number.isSafeInteger(line.qty) || line.qty < 1) throw new Error('合格数量须为正整数');
      if (seen[line.id]) throw new Error('商品不能重复');
      seen[line.id] = 1;
      const item = byId[line.id];
      if (!item || item.supplier !== payload.supplier) throw new Error('商品不属于所选配送批次');
      if (line.qty > (avail.remaining[line.id] || 0)) throw new Error(item.name + '：合格数量超过本批次待验收数量');
      confirmed.push({ id: item.id, name: item.name, qty: line.qty, supplier: item.supplier });
    });
  }
  const installationRequired = payload.result === 'pass' && confirmed.some(function (x) {
    return INSTALL_REQUIRED.indexOf(x.id) >= 0;
  });
  if (installationRequired && payload.installChecked !== true) throw new Error('安装类物料请确认安装位置、牢固程度及完工效果');

  const now = new Date().toISOString();
  const from = order.status;
  const evidenceId = payload.evidenceId || uid();
  if (payload.result === 'pass') {
    if (!avail.batch.acceptedByItem) avail.batch.acceptedByItem = {};
    confirmed.forEach(function (line) {
      byId[line.id].accepted = Number(byId[line.id].accepted || 0) + line.qty;
      avail.batch.acceptedByItem[line.id] = Number(avail.batch.acceptedByItem[line.id] || 0) + line.qty;
    });
    const complete = order.items.every(function (x) { return Number(x.accepted || 0) === x.qty; });
    // 全部验收完成即进入「结算金额确认」：门店填报 → 供应商确认 → 待对账
    order.status = complete ? 'settle-pending' : 'partial';
    if (complete) {
      order.settlement = order.settlement || {};
      order.settlement.status = 'pending-store';
      order.settlement.itemsAmount = acceptedAmountOf(order);
      order.settlement.readyAt = now;
    }
    // 验收即代表到货：该供应商全部验收完成后，供应商侧记录才进入「已完成」
    const subRec = (order.supplierRecords || {})[payload.supplier];
    if (subRec) {
      const ownItems = order.items.filter(function (x) { return x.supplier === payload.supplier; });
      const ownDone = ownItems.every(function (x) { return Number(x.accepted || 0) === x.qty; });
      subRec.delivered = true;
      subRec.arrivedAt = subRec.arrivedAt || now;
      if (ownDone) {
        subRec.status = 'accepted';
        subRec.acceptedAt = now;
      }
    }
    if (!Array.isArray(order.acceptances)) order.acceptances = [];
    order.acceptances.push({
      at: now, by: session.id, byName: session.name, supplier: payload.supplier,
      batchNo: payload.batchNo, note: note, lines: confirmed, result: 'pass',
      installationRequired: installationRequired, evidenceId: evidenceId, photoPath: payload.photoPath,
      noPhoto: noPhoto
    });
  } else {
    if (!Array.isArray(order.acceptanceIssues)) order.acceptanceIssues = [];
    order.acceptanceIssues.push({
      id: 'ISS-' + uid(), status: 'open',
      at: now, by: session.id, byName: session.name, supplier: payload.supplier,
      batchNo: payload.batchNo, note: note, result: 'issue', evidenceId: evidenceId, photoPath: payload.photoPath,
      noPhoto: noPhoto
    });
    const subRec = (order.supplierRecords || {})[payload.supplier];
    if (subRec) subRec.hasAcceptanceIssue = true;
  }
  order.stageStartedAt = now;
  return {
    order: order, evidenceId: evidenceId,
    evidence: {
      id: evidenceId, orderId: order.id, store: order.store, supplier: payload.supplier,
      batchNo: payload.batchNo, actor: session.id, result: payload.result,
      filePath: payload.photoPath, note: note, at: now, noPhoto: noPhoto
    },
    audit: {
      orderId: order.id, kind: 'accept', stage: 'accept',
      decision: payload.result === 'pass' ? '验收合格' : '异常反馈',
      role: session.name + '（' + session.id + '）', from: from, to: order.status,
      note: note || (payload.result === 'pass' ? '规格数量外观核对通过' : ''), at: now
    }
  };
}

function hasOpenAcceptanceIssue(order, supplier) {
  if (!order || !Array.isArray(order.acceptanceIssues)) return false;
  return order.acceptanceIssues.some(function (iss) {
    if (supplier && iss.supplier && iss.supplier !== supplier) return false;
    return iss.status === 'open' || (!iss.status && !iss.resolvedAt);
  });
}

function resolveAcceptanceIssue(state, session, payload) {
  const p = payload || {};
  const order = (state.orders || []).filter(function (o) { return o.id === p.orderId; })[0];
  if (!order) throw new Error('找不到订单');
  const isSup = session && session.role === 'supplier' && !!(order.supplierRecords || {})[session.supplier];
  const isCentral = session && session.role === 'central';
  const isReceiver = canAcceptOrder(order, session);
  if (!isSup && !isCentral && !isReceiver) throw new Error('无权处理该订单的验收异常');

  const plan = String(p.plan || 'reship');
  const PLAN_NAME = { reship: '安排补发', discount: '转结算折让', resolved: '协商结案' };
  if (!PLAN_NAME[plan]) throw new Error('请选择处理方案');
  const reply = String(p.reply || '').trim();
  if (reply.length < 2 || reply.length > 300) throw new Error('请填写 2 至 300 字的处理说明');

  const issues = order.acceptanceIssues || [];
  let target = null;
  if (p.issueId) target = issues.filter(function (x) { return x.id === p.issueId; })[0];
  if (!target) {
    const sup = isSup ? session.supplier : (p.supplier || '');
    target = issues.filter(function (x) {
      return (!sup || x.supplier === sup) && (x.status === 'open' || (!x.status && !x.resolvedAt));
    }).slice(-1)[0];
  }
  if (!target) throw new Error('未找到待处理的验收异常记录');
  if (isSup && target.supplier && target.supplier !== session.supplier) throw new Error('只能处理本供应商名下的异常记录');

  const now = new Date().toISOString();
  target.id = target.id || ('ISS-' + uid());
  target.status = 'resolved';
  target.plan = plan;
  target.planLabel = PLAN_NAME[plan];
  target.reply = reply;
  target.resolvedAt = now;
  target.resolvedBy = session.name || session.id;
  target.resolvedRole = session.role;

  const supName = target.supplier;
  if (supName && order.supplierRecords && order.supplierRecords[supName]) {
    order.supplierRecords[supName].hasAcceptanceIssue = hasOpenAcceptanceIssue(order, supName);
  }
  return {
    order: order,
    issue: target,
    audit: {
      orderId: order.id, kind: 'accept', stage: 'issue-resolve',
      decision: '处理验收异常（' + PLAN_NAME[plan] + '）',
      role: (isSup ? '供应商（' + session.supplier + '）' : session.name + '（' + session.id + '）'),
      from: order.status, to: order.status,
      note: '第' + (target.batchNo || 1) + '批异常：' + reply, at: now
    }
  };
}

/* ------------------------- 短收结案（部分到货不再补发时，按已验收数量结案进入结算） ------------------------- */
function finalizeShortDelivery(state, session, payload) {
  const order = (state.orders || []).filter(function (o) { return o.id === (payload && payload.orderId); })[0];
  if (!order) throw new Error('找不到订单');
  if (['partial', 'delivering', 'delivered'].indexOf(order.status) < 0) {
    throw new Error('仅部分验收或配送中的订单可办理短收结案');
  }
  const canAct = (session && session.role === 'central') || !!settleActorOf(order, session);
  if (!canAct) throw new Error('请由收货门店/部门或运营管理部办理短收结案');
  const totalAccepted = (order.items || []).reduce(function (s, x) { return s + Number(x.accepted || 0); }, 0);
  if (totalAccepted <= 0) throw new Error('尚未验收任何商品，若整单取消请走关闭订单');
  const reason = String((payload && payload.reason) || '').trim();
  if (reason.length < 4 || reason.length > 200) throw new Error('请填写4至200字的短收结案原因');

  const now = new Date().toISOString();
  const shortLines = [];
  let sumCents = 0;
  (order.items || []).forEach(function (x) {
    const acc = Number(x.accepted || 0);
    if (acc < x.qty) {
      shortLines.push(x.name + ' ' + x.qty + '→' + acc);
      x.originalQty = x.originalQty || x.qty;
      x.qty = acc;
      x.deliveredQty = acc;
    }
    sumCents += cents(x.price) * acc;
  });
  if (!shortLines.length) throw new Error('该订单已全部验收，无需短收结案');

  const from = order.status;
  order.total = round2(sumCents / 100);
  order.shortClosed = { at: now, by: session.id, byName: session.name, reason: reason, lines: shortLines };
  order.status = 'settle-pending';
  order.stageStartedAt = now;
  order.settlement = order.settlement || {};
  order.settlement.status = 'pending-store';
  order.settlement.itemsAmount = acceptedAmountOf(order);
  order.settlement.readyAt = now;

  Object.keys(order.supplierRecords || {}).forEach(function (sup) {
    const r = order.supplierRecords[sup];
    if (!r) return;
    r.delivered = true;
    r.status = 'accepted';
    r.acceptedAt = r.acceptedAt || now;
  });

  return {
    order: order,
    audit: {
      orderId: order.id, kind: 'accept', stage: 'short-close',
      decision: '短收结案',
      role: session.name + '（' + session.id + '）', from: from, to: order.status,
      note: '按实收数量结案（' + shortLines.join('、') + '）；原因：' + reason,
      at: now
    }
  };
}

/* ------------------------- 结算金额共同确认 ------------------------- */
// 按实收数量折算的应结金额（部分验收只算已收部分，未到货不计）
function acceptedAmountOf(order) {
  const total = (order.items || []).reduce(function (s, x) {
    return s + cents(Number(x.accepted || 0) * Number(x.price || 0));
  }, 0);
  return round2(total / 100);
}

function acceptedBySupplierOf(order) {
  const out = {};
  (order.items || []).forEach(function (x) {
    const sup = x.supplier || '未指定供应商';
    out[sup] = (out[sup] || 0) + cents(Number(x.accepted || 0) * Number(x.price || 0));
  });
  Object.keys(out).forEach(function (k) { out[k] = round2(out[k] / 100); });
  return out;
}

// 各供应商已确认的实际结算金额（元）；仅在 settlement.status === 'confirmed' 时返回映射
function settlementBySupplierOf(order) {
  const out = {};
  const settle = order && order.settlement;
  if (!settle || settle.status !== 'confirmed' || !isFinite(Number(settle.amount))) return out;
  const bySupRaw = acceptedBySupplierOf(order);
  const sups = Object.keys(bySupRaw);
  if (settle.bySupplier && typeof settle.bySupplier === 'object') {
    let covered = true;
    sups.forEach(function (s) {
      if (!isFinite(Number(settle.bySupplier[s]))) covered = false;
      else out[s] = round2(settle.bySupplier[s]);
    });
    if (covered && sups.length) return out;
  }
  const allAcceptedCents = cents(acceptedAmountOf(order));
  const targetCents = cents(settle.amount);
  let allocated = 0;
  sups.forEach(function (s, idx) {
    if (idx === sups.length - 1) {
      out[s] = round2((targetCents - allocated) / 100);
    } else {
      const share = allAcceptedCents > 0 ? Math.round(targetCents * (cents(bySupRaw[s]) / allAcceptedCents)) : 0;
      allocated += share;
      out[s] = round2(share / 100);
    }
  });
  return out;
}

// 谁能对这笔单发起结算：门店单看门店；部门单看收货方式（送门店由门店结，送总部由部门结）
function settleActorOf(order, session) {
  if (!session) return null;
  if (order.purchaseType === 'department') {
    if (order.receivingType === 'store') {
      return session.role === 'store' && session.stores.indexOf(order.store) >= 0 ? 'store' : null;
    }
    return session.department && session.department === order.department && session.role === 'department' ? 'department' : null;
  }
  return session.role === 'store' && session.stores.indexOf(order.store) >= 0 ? 'store' : null;
}

// 门店/部门发起：填实际结算金额（支持按整单 amount 或分供应商 bySupplier），允许与实收不同
function submitSettlement(state, session, payload) {
  const order = (state.orders || []).filter(function (o) { return o.id === payload.orderId; })[0];
  if (!order) throw new Error('找不到这笔订单，请刷新后重试');
  if (['settle-pending', 'settle-disputed'].indexOf(order.status) < 0) {
    throw new Error(order.status === 'settle-supplier' ? '结算金额已提交，等待供应商确认' : '订单尚未完成验收，暂不能结算');
  }
  const actor = settleActorOf(order, session);
  if (!actor) throw new Error('只有收货方可发起结算确认');

  const orderSuppliers = [];
  (order.items || []).forEach(function (x) {
    if (x.supplier && orderSuppliers.indexOf(x.supplier) < 0) orderSuppliers.push(x.supplier);
  });

  let bySupplier = null;
  let amount = 0;
  if (payload.bySupplier && typeof payload.bySupplier === 'object') {
    bySupplier = {};
    let sumCents = 0;
    orderSuppliers.forEach(function (sup) {
      const val = round2(Number(payload.bySupplier[sup]));
      if (!isFinite(val) || val <= 0) throw new Error('「' + sup + '」结算金额需大于 0');
      bySupplier[sup] = val;
      sumCents += cents(val);
    });
    amount = round2(sumCents / 100);
  } else {
    amount = round2(Number(payload.amount));
  }
  if (!isFinite(amount) || amount <= 0) throw new Error('结算金额需大于 0');
  const cap = cents(Number(order.total || 0)) / 100;
  if (cents(amount) > Math.round(cap * 100)) throw new Error('结算金额不能超过订单金额 ¥' + fmt.money(cap));

  const itemsAmount = acceptedAmountOf(order);
  const diff = round2(amount - itemsAmount);
  const reason = String(payload.reason || '').trim();
  if (Math.abs(cents(diff)) > 0 && reason.length < 4) {
    throw new Error('结算金额与实收核算不一致（差 ¥' + fmt.money(Math.abs(diff)) + '），请填写至少4个字的差异原因');
  }
  if (reason.length > 200) throw new Error('差异原因不得超过200字');

  const now = new Date().toISOString();
  const round = ((order.settlement && order.settlement.round) || 0) + 1;
  order.settlement = {
    status: 'pending-supplier',
    amount: amount,
    itemsAmount: itemsAmount,
    diff: diff,
    reason: reason,
    bySupplier: bySupplier,
    by: session.id,
    byName: session.name,
    byRole: actor,
    round: round,
    submittedAt: now,
    readyAt: (order.settlement && order.settlement.readyAt) || now,
    suppliers: orderSuppliers,
    confirmedBySuppliers: {},
    disputes: (order.settlement && order.settlement.disputes) || []
  };
  const from = order.status;
  order.status = 'settle-supplier';
  order.stageStartedAt = now;
  return {
    order: order,
    audit: {
      orderId: order.id, kind: 'settle', stage: 'settle-submit',
      decision: '提交结算金额',
      role: actor === 'store' ? '门店（' + session.id + '）' : '职能部门（' + session.id + '）',
      from: from, to: order.status,
      note: '结算 ¥' + fmt.money(amount) + (Math.abs(cents(diff)) > 0 ? '；与实收核算差 ¥' + fmt.money(diff) + '（' + reason + '）' : '；与实收核算一致'),
      at: now
    }
  };
}

// 供应商确认或提出异议；多供应商订单需所有相关供应商全部确认后才进入待对账
function settleAction(state, session, payload) {
  if (!session || session.role !== 'supplier') throw new Error('请使用供应商身份确认结算');
  const order = (state.orders || []).filter(function (o) { return o.id === payload.orderId; })[0];
  if (!order) throw new Error('找不到这笔订单，请刷新后重试');
  if (order.status !== 'settle-supplier') {
    throw new Error(order.status === 'settle-disputed' ? '该单已提出异议，等待门店重新提交' : '该单当前没有待确认的结算金额');
  }
  const mine = (order.items || []).some(function (x) { return x.supplier === session.supplier; });
  if (!mine) throw new Error('这不是本供应商的订单');
  if (['confirm', 'dispute'].indexOf(payload.action) < 0) throw new Error('请选择确认或提出异议');

  const now = new Date().toISOString();
  const settle = order.settlement || {};
  const from = order.status;

  if (payload.action === 'confirm') {
    const orderSuppliers = [];
    (order.items || []).forEach(function (x) {
      if (x.supplier && orderSuppliers.indexOf(x.supplier) < 0) orderSuppliers.push(x.supplier);
    });
    if (!settle.confirmedBySuppliers || typeof settle.confirmedBySuppliers !== 'object') {
      settle.confirmedBySuppliers = {};
    }
    settle.confirmedBySuppliers[session.supplier] = { by: session.id, at: now };
    const rec = (order.supplierRecords || {})[session.supplier];
    if (rec) rec.settledAt = now;

    const allConfirmed = orderSuppliers.every(function (sup) {
      return !!settle.confirmedBySuppliers[sup];
    });
    if (allConfirmed) {
      settle.status = 'confirmed';
      settle.confirmedAt = now;
      settle.confirmedBy = session.id;
      order.status = 'accepted';
      order.stageStartedAt = now;
    }
    order.settlement = settle;
    return {
      order: order,
      allConfirmed: allConfirmed,
      audit: {
        orderId: order.id, kind: 'settle', stage: 'settle-confirm', decision: '供应商确认结算',
        role: '供应商（' + session.supplier + '）', from: from, to: order.status,
        note: '确认结算金额 ¥' + fmt.money(settle.amount) + (allConfirmed ? '' : '（等待其余供应商确认）'), at: now
      }
    };
  }

  const reason = String(payload.reason || '').trim();
  if (reason.length < 4) throw new Error('请填写至少4个字的异议说明');
  if (reason.length > 200) throw new Error('异议说明不得超过200字');
  settle.status = 'disputed';
  settle.disputes = settle.disputes || [];
  settle.disputes.push({ by: session.id, supplier: session.supplier, reason: reason, at: now });
  order.settlement = settle;
  order.status = 'settle-disputed';
  order.stageStartedAt = now;
  return {
    order: order,
    audit: {
      orderId: order.id, kind: 'settle', stage: 'settle-dispute', decision: '供应商提出异议',
      role: '供应商（' + session.supplier + '）', from: from, to: order.status,
      note: reason, at: now
    }
  };
}

/* ------------------------- 对账 ------------------------- */
function collectPendingReconLines(state, supplier) {
  const lines = [];
  state.orders.forEach(function (o) {
    // 只有已完成验收且结算金额经双方确认（状态为 accepted / done）的订单才可纳入对账
    if (['accepted', 'done'].indexOf(o.status) < 0) return;
    if (o.settlement && o.settlement.status !== 'confirmed') return;
    const own = [];
    (o.items || []).forEach(function (item) {
      if (item.supplier !== supplier) return;
      const pending = Number(item.accepted || 0) - Number(item.reconciled || 0) - Number(item.reconPending || 0);
      if (pending < 0) throw new Error('发现验收与对账数量异常，请先核查');
      if (pending > 0) {
        own.push({
          order: o.id, store: o.store, supplier: supplier, name: item.name, id: item.id,
          n: pending, price: item.price, amount: Math.round(pending * item.price * 100) / 100
        });
      }
    });
    if (!own.length) return;
    // 已共同确认的结算金额按确认值入账；优先取分供应商专属结算额
    const settleMap = settlementBySupplierOf(o);
    if (settleMap[supplier] !== undefined) {
      const lineSum = own.reduce(function (s, x) { return s + Math.round(x.amount * 100); }, 0) / 100;
      const target = settleMap[supplier];
      const gap = Math.round((target - lineSum) * 100) / 100;
      if (Math.round(gap * 100) !== 0) {
        own.push({
          order: o.id, store: o.store, supplier: supplier, name: '结算差异调整',
          id: '', n: 0, price: 0, amount: gap, adjust: true, reason: (o.settlement && o.settlement.reason) || ''
        });
      }
    }
    lines.push.apply(lines, own);
  });
  return lines;
}

function createReconciliation(state, session, payload) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可生成对账单');
  const supplier = String(payload.supplier || '').trim();
  const period = String(payload.period || '').trim();
  if (!supplier) throw new Error('请先选择一家供应商');
  if (!period || period.length > 80) throw new Error('请输入对账周期');
  const lines = collectPendingReconLines(state, supplier);
  if (!lines.length) throw new Error('该供应商没有待对账的已验收明细');
  const existing = (state.recons || []).map(function (r) {
    const m = String(r.id || '').match(/^DZ-(\d+)$/);
    return m ? Number(m[1]) : 0;
  });
  const num = Math.max.apply(null, [(state.recons || []).length].concat(existing)) + 1;
  const id = 'DZ-' + String(num).padStart(3, '0');
  const total = Math.round(lines.reduce(function (sum, x) { return sum + Math.round(x.amount * 100); }, 0)) / 100;
  const now = new Date().toISOString();
  const rec = { id: id, supplier: supplier, period: period, lines: lines, total: total, status: 'supplier-pending', round: 1, createdAt: now, createdBy: session.id };
  if (!Array.isArray(state.recons)) state.recons = [];
  state.recons.unshift(rec);
  lines.forEach(function (line) {
    if (!line.id) return; // 结算差异调整行不带数量，不占对账数量
    const order = state.orders.filter(function (o) { return o.id === line.order; })[0];
    const item = order.items.filter(function (x) { return x.id === line.id; })[0];
    item.reconPending = Number(item.reconPending || 0) + line.n;
  });
  return { recon: rec };
}

function reconAction(state, session, payload) {
  const id = String(payload.reconId || '');
  const action = String(payload.action || '');
  if (!/^DZ-[0-9]{3,10}$/.test(id)) throw new Error('对账单编号不正确');
  if (['confirm', 'dispute', 'lock', 'reopen', 'void'].indexOf(action) < 0) throw new Error('不支持的操作');
  const note = String(payload.note || '').trim();
  if (action === 'dispute' && (note.length < 2 || note.length > 300)) throw new Error('请输入2至300字的差异原因');
  const isCentralAct = ['lock', 'reopen', 'void'].indexOf(action) >= 0;
  if (isCentralAct && (!session || session.role !== 'central')) throw new Error('仅运营管理部可执行此对账操作');
  if (!isCentralAct && (!session || session.role !== 'supplier')) throw new Error('请使用供应商身份确认对账');

  const rec = (state.recons || []).filter(function (x) { return x.id === id; })[0];
  if (!rec) throw new Error('找不到对账单');
  if (!isCentralAct && rec.supplier !== session.supplier) throw new Error('不能处理其他供应商的对账单');
  if (action === 'lock' && rec.status !== 'supplier-confirmed') throw new Error('必须由供应商先确认对账单');
  if (!isCentralAct && rec.status !== 'supplier-pending') throw new Error('对账单当前不能重复确认或提出差异');
  if (action === 'reopen' && rec.status !== 'disputed') throw new Error('仅存在差异的对账单可重新发起');
  if (action === 'void' && ['disputed', 'supplier-pending'].indexOf(rec.status) < 0) throw new Error('仅未确认或有差异的对账单可作废');
  const now = new Date().toISOString();
  const prevStatus = rec.status;

  if (action === 'dispute') {
    rec.status = 'disputed';
    rec.disputedAt = now;
    rec.disputeNote = note;
    rec.lines.forEach(function (line) {
      if (!line.id) return; // 结算差异调整行不涉及数量
      const order = state.orders.filter(function (o) { return o.id === line.order; })[0];
      const item = order ? order.items.filter(function (x) { return x.id === line.id; })[0] : null;
      if (!item || Number(item.reconPending || 0) < line.n) throw new Error('对账暂占数据不一致');
      item.reconPending -= line.n;
    });
  } else if (action === 'void') {
    if (prevStatus === 'supplier-pending') {
      rec.lines.forEach(function (line) {
        if (!line.id) return;
        const order = state.orders.filter(function (o) { return o.id === line.order; })[0];
        const item = order ? order.items.filter(function (x) { return x.id === line.id; })[0] : null;
        if (item && Number(item.reconPending || 0) >= line.n) item.reconPending -= line.n;
      });
    }
    rec.status = 'voided';
    rec.voidedAt = now;
    rec.voidedBy = session.id;
    rec.voidReason = note || '核查差异后作废';
  } else if (action === 'reopen') {
    const freshLines = collectPendingReconLines(state, rec.supplier);
    if (!freshLines.length) throw new Error('该供应商当前没有可对账的明细，若不再对账请点击「作废」');
    if (rec.disputeNote) {
      rec.disputeHistory = rec.disputeHistory || [];
      rec.disputeHistory.push({ note: rec.disputeNote, at: rec.disputedAt, round: rec.round || 1 });
    }
    rec.lines = freshLines;
    rec.total = Math.round(freshLines.reduce(function (sum, x) { return sum + Math.round(x.amount * 100); }, 0)) / 100;
    rec.round = (rec.round || 1) + 1;
    rec.status = 'supplier-pending';
    rec.reopenedAt = now;
    rec.reopenedBy = session.id;
    rec.reopenNote = note || '核对调整后重发对账';
    rec.disputeNote = '';
    freshLines.forEach(function (line) {
      if (!line.id) return;
      const order = state.orders.filter(function (o) { return o.id === line.order; })[0];
      const item = order && order.items.filter(function (x) { return x.id === line.id; })[0];
      if (item) item.reconPending = Number(item.reconPending || 0) + line.n;
    });
  } else if (action === 'confirm') {
    rec.status = 'supplier-confirmed';
    rec.supplierConfirmedAt = now;
  } else {
    rec.status = 'locked';
    rec.lockedAt = now;
    rec.lockedBy = session.id;
    rec.lines.forEach(function (line) {
      if (!line.id) return; // 结算差异调整行不涉及数量
      const order = state.orders.filter(function (o) { return o.id === line.order; })[0];
      const item = order ? order.items.filter(function (x) { return x.id === line.id; })[0] : null;
      if (!item || Number(item.reconPending || 0) < line.n) throw new Error('对账暂占数量错误');
      item.reconPending -= line.n;
      item.reconciled = Number(item.reconciled || 0) + line.n;
    });
    state.orders.forEach(function (o) {
      if (o.status === 'accepted' && o.items.every(function (x) { return Number(x.reconciled || 0) === Number(x.accepted || 0); })) {
        o.status = 'done';
      }
    });
  }
  return { recon: rec };
}

/* ------------------------- SLA 预警 ------------------------- */
function parseTime(value) {
  if (!value) return NaN;
  const d = new Date(value).getTime();
  return isNaN(d) ? NaN : d;
}

function slaEntries(state) {
  const rows = [];
  (state.orders || []).forEach(function (o) {
    if (APPROVAL_STATUS.indexOf(o.status) >= 0) {
      const ts = parseTime(o.stageStartedAt || o.createdAt);
      if (!isNaN(ts)) {
        const hours = Math.max(0, (Date.now() - ts) / 3600000);
        rows.push({
          orderId: o.id, kind: 'approval', status: o.status,
          owner: o.status === 'order-review' ? '战区审核' : o.status === 'budget-region' ? '战区预算审批' : o.status === 'dept-approval' ? '运营管理部确认' : '运营管理部',
          department: o.department || null, store: o.store, hours: hours, limit: SLA_HOURS.approval,
          level: hours >= SLA_HOURS.approval ? 'overdue' : hours >= SLA_HOURS.approval * 0.75 ? 'warning' : 'normal'
        });
      }
    }
    const blocked = ['cancelled', 'rejected', 'order-review', 'dept-approval', 'budget-region', 'budget-central', 'amount-approval', 'settle-pending', 'settle-supplier', 'settle-disputed', 'accepted', 'done'];
    if (blocked.indexOf(o.status) < 0) {
      Object.keys(o.supplierRecords || {}).forEach(function (supplier) {
        const r = o.supplierRecords[supplier];
        if (!r || r.status !== 'pending') return;
        const ts = parseTime(r.pendingSince || o.supplierSentAt || o.confirmedAt || o.createdAt);
        if (isNaN(ts)) return;
        const hours = Math.max(0, (Date.now() - ts) / 3600000);
        rows.push({
          orderId: o.id, kind: 'supplier', status: 'supplier', owner: supplier,
          department: o.department || null, store: o.store, hours: hours, limit: SLA_HOURS.supplier,
          level: hours >= SLA_HOURS.supplier ? 'overdue' : hours >= SLA_HOURS.supplier * 0.75 ? 'warning' : 'normal'
        });
      });
    }
  });
  return rows;
}

function slaForOrder(state, orderId) {
  const rows = slaEntries(state).filter(function (x) { return x.orderId === orderId; });
  if (!rows.length) return null;
  return rows.sort(function (a, b) { return b.hours - a.hours; })[0];
}

/* ------------------------- 统计（对齐最终结算金额口径 + 合同×预算科目总表） ------------------------- */
// 按「已共同确认的最终结算金额」分摊每条明细的有效已验收与已对账金额（元），保证统计看板与对账单分毫不差
function effectiveOrderLineAmounts(order) {
  const items = order.items || [];
  const settleMap = settlementBySupplierOf(order);
  const bySup = {};
  items.forEach(function (line, idx) {
    const sup = line.supplier || '未指定供应商';
    if (!bySup[sup]) bySup[sup] = { rows: [], rawAccCents: 0, accUnits: 0, recUnits: 0 };
    const price = Number(line.price || 0);
    const accQty = Number(line.accepted || 0);
    const recQty = Number(line.reconciled || 0);
    const reqCents = cents(Number(line.qty || 0) * price);
    const accCents = cents(accQty * price);
    const recCents = cents(recQty * price);
    bySup[sup].rows.push({ idx: idx, line: line, sup: sup, reqCents: reqCents, accCents: accCents, recCents: recCents });
    bySup[sup].rawAccCents += accCents;
    bySup[sup].accUnits += accQty;
    bySup[sup].recUnits += recQty;
  });

  const result = new Array(items.length);
  Object.keys(bySup).forEach(function (sup) {
    const grp = bySup[sup];
    const hasSettled = settleMap[sup] !== undefined;
    const settledCents = hasSettled ? cents(settleMap[sup]) : grp.rawAccCents;
    const allRec = grp.accUnits > 0 && grp.recUnits === grp.accUnits;
    const targetRecCents = hasSettled
      ? (allRec ? settledCents : (grp.rawAccCents > 0 ? Math.round(settledCents * grp.rows.reduce(function (s, r) { return s + r.recCents; }, 0) / grp.rawAccCents) : 0))
      : grp.rows.reduce(function (s, r) { return s + r.recCents; }, 0);

    let accAlloc = 0;
    let recAlloc = 0;
    const activeAccRows = grp.rows.filter(function (r) { return r.accCents > 0; });
    const lastAccIdx = activeAccRows.length ? activeAccRows[activeAccRows.length - 1].idx : -1;
    const activeRecRows = grp.rows.filter(function (r) { return r.recCents > 0; });
    const lastRecIdx = activeRecRows.length ? activeRecRows[activeRecRows.length - 1].idx : -1;

    grp.rows.forEach(function (r) {
      const p = CATALOG_BY_ID[r.line.id];
      const key = BUDGET.itemOf(r.line.budgetItem ? r.line : (p || r.line));
      let effAcc = r.accCents;
      if (hasSettled) {
        if (r.idx === lastAccIdx) effAcc = Math.max(0, settledCents - accAlloc);
        else if (r.accCents > 0 && grp.rawAccCents > 0) {
          effAcc = Math.round(settledCents * (r.accCents / grp.rawAccCents));
          accAlloc += effAcc;
        } else effAcc = 0;
      }
      let effRec = r.recCents;
      if (hasSettled) {
        const sumRawRec = grp.rows.reduce(function (s, x) { return s + x.recCents; }, 0);
        if (r.idx === lastRecIdx) effRec = Math.max(0, targetRecCents - recAlloc);
        else if (r.recCents > 0 && sumRawRec > 0) {
          effRec = Math.round(targetRecCents * (r.recCents / sumRawRec));
          recAlloc += effRec;
        } else effRec = 0;
      }
      result[r.idx] = {
        supplier: sup,
        budgetKey: key,
        requested: round2(r.reqCents / 100),
        accepted: round2(effAcc / 100),
        reconciled: round2(effRec / 100)
      };
    });
  });
  return result;
}

function effectiveOrderAmounts(order) {
  const lines = effectiveOrderLineAmounts(order);
  let acc = 0, rec = 0;
  lines.forEach(function (l) {
    if (!l) return;
    acc += cents(l.accepted);
    rec += cents(l.reconciled);
  });
  return {
    requested: round2(Number(order.total || 0)),
    accepted: round2(acc / 100),
    reconciled: round2(rec / 100)
  };
}

function reportSummary(state) {
  const valid = (state.orders || []).filter(function (o) { return ['rejected', 'cancelled'].indexOf(o.status) < 0; });
  const totals = { requests: (state.orders || []).length, activeOrders: valid.length, requested: 0, accepted: 0, reconciled: 0, unreconciledAccepted: 0 };
  const byZone = {};
  const bySupplier = {};
  function add(bucket, key, field, n) {
    if (!bucket[key]) bucket[key] = { key: key, orders: 0, requested: 0, accepted: 0, reconciled: 0 };
    bucket[key][field] += n;
  }
  valid.forEach(function (order) {
    const zone = order.purchaseType === 'department' ? ('部门采购·' + (order.zone || '总部')) : (order.zone || '未归属战区');
    add(byZone, zone, 'orders', 1);
    add(byZone, zone, 'requested', Number(order.total || 0));
    totals.requested += Number(order.total || 0);
    const seen = {};
    const effLines = effectiveOrderLineAmounts(order);
    (order.items || []).forEach(function (line, idx) {
      const eff = effLines[idx] || { supplier: line.supplier || '未指定供应商', requested: 0, accepted: 0, reconciled: 0 };
      const supplier = eff.supplier;
      if (!seen[supplier]) { add(bySupplier, supplier, 'orders', 1); seen[supplier] = 1; }
      add(bySupplier, supplier, 'requested', eff.requested);
      add(bySupplier, supplier, 'accepted', eff.accepted);
      add(bySupplier, supplier, 'reconciled', eff.reconciled);
      add(byZone, zone, 'accepted', eff.accepted);
      add(byZone, zone, 'reconciled', eff.reconciled);
      totals.accepted += eff.accepted;
      totals.reconciled += eff.reconciled;
    });
  });
  totals.unreconciledAccepted = Math.max(0, totals.accepted - totals.reconciled);
  Object.keys(totals).forEach(function (k) {
    if (!Number.isInteger(totals[k])) totals[k] = Math.round(totals[k] * 100) / 100;
  });
  return {
    totals: totals,
    byZone: Object.keys(byZone).map(function (k) {
      const r = byZone[k];
      return { key: r.key, orders: r.orders, requested: Math.round(r.requested * 100) / 100, accepted: Math.round(r.accepted * 100) / 100, reconciled: Math.round(r.reconciled * 100) / 100 };
    }),
    bySupplier: Object.keys(bySupplier).map(function (k) {
      const r = bySupplier[k];
      return { key: r.key, orders: r.orders, requested: Math.round(r.requested * 100) / 100, accepted: Math.round(r.accepted * 100) / 100, reconciled: Math.round(r.reconciled * 100) / 100 };
    })
  };
}

function departmentSummary(state) {
  const { DEPARTMENTS } = require('../data/seed');
  const rows = DEPARTMENTS.map(function (name) {
    return { department: name, orders: 0, requested: 0, accepted: 0, reconciled: 0 };
  });
  const index = {};
  rows.forEach(function (r) { index[r.department] = r; });
  (state.orders || []).forEach(function (o) {
    if (o.purchaseType !== 'department' || ['rejected', 'cancelled'].indexOf(o.status) >= 0) return;
    const row = index[o.department];
    if (!row) return;
    const eff = effectiveOrderAmounts(o);
    row.orders += 1;
    row.requested += eff.requested;
    row.accepted += eff.accepted;
    row.reconciled += eff.reconciled;
  });
  rows.forEach(function (r) {
    ['requested', 'accepted', 'reconciled'].forEach(function (k) { r[k] = Math.round(r[k] * 100) / 100; });
  });
  return rows;
}

// 2 份框架合同 × 3 大预算科目 财务核算汇总表
function contractBudgetReport(state) {
  const summaries = contractSummary(state);
  const storeRows = budgetSummary(state, { role: 'central', stores: [] });
  const effByContract = {};
  const effByBudget = {};
  BUDGET.KEYS.forEach(function (k) {
    effByBudget[k] = { storeAccepted: 0, storeReconciled: 0, deptRequested: 0, deptAccepted: 0, deptReconciled: 0 };
  });

  (state.orders || []).forEach(function (o) {
    if (['rejected', 'cancelled'].indexOf(o.status) >= 0) return;
    const effLines = effectiveOrderLineAmounts(o);
    (o.items || []).forEach(function (line, idx) {
      const eff = effLines[idx];
      if (!eff) return;
      const sup = eff.supplier;
      if (!effByContract[sup]) effByContract[sup] = { accepted: 0, reconciled: 0 };
      effByContract[sup].accepted += cents(eff.accepted);
      effByContract[sup].reconciled += cents(eff.reconciled);

      const b = effByBudget[eff.budgetKey];
      if (!b) return;
      if (o.purchaseType === 'department') {
        b.deptRequested += cents(eff.requested);
        b.deptAccepted += cents(eff.accepted);
        b.deptReconciled += cents(eff.reconciled);
      } else {
        b.storeAccepted += cents(eff.accepted);
        b.storeReconciled += cents(eff.reconciled);
      }
    });
  });

  const contracts = summaries.map(function (c) {
    const ec = effByContract[c.supplier] || { accepted: 0, reconciled: 0 };
    const accepted = round2(ec.accepted / 100);
    const reconciled = round2(ec.reconciled / 100);
    return Object.assign({}, c, {
      accepted: accepted,
      reconciled: reconciled,
      inTransit: round2(Math.max(0, c.used - accepted))
    });
  });

  const budgetItems = BUDGET.ITEMS.map(function (meta) {
    const key = meta.key;
    let storeBudget = 0, baseUsed = 0, storeOccupied = 0, storeSpent = 0, storeUsed = 0, storeAvailable = 0;
    storeRows.forEach(function (sr) {
      const it = (sr.items || []).filter(function (x) { return x.key === key; })[0];
      if (!it) return;
      storeBudget += cents(it.budget);
      baseUsed += cents(it.baseUsed);
      storeOccupied += cents(it.occupied);
      storeSpent += cents(it.spent);
      storeUsed += cents(it.used);
      storeAvailable += cents(it.available);
    });
    const b = effByBudget[key] || { storeAccepted: 0, storeReconciled: 0, deptRequested: 0, deptAccepted: 0, deptReconciled: 0 };
    const deptReq = round2(b.deptRequested / 100);
    return {
      key: key,
      name: meta.name,
      short: meta.short,
      contract: meta.contract,
      storeBudget: round2(storeBudget / 100),
      baseUsed: round2(baseUsed / 100),
      storeInTransit: round2(storeOccupied / 100),
      storeAccepted: round2(b.storeAccepted / 100),
      storeReconciled: round2(b.storeReconciled / 100),
      storeUsed: round2(storeUsed / 100),
      storeAvailable: round2(storeAvailable / 100),
      deptRequested: deptReq,
      deptAccepted: round2(b.deptAccepted / 100),
      deptReconciled: round2(b.deptReconciled / 100),
      totalUsed: round2((storeUsed + b.deptRequested) / 100)
    };
  });

  return { contracts: contracts, budgetItems: budgetItems };
}

/* ------------------------- 预算占用 ------------------------- */
function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

// 门店预算 = 各科目（额度 - 期初已用 - 在途占用 - 已验收）
function storeBudgetRows(state, store) {
  const cfg = budgetCfg(state);
  return BUDGET.KEYS.map(function (key) {
    const budget = BUDGET.budgetOf(cfg, store, key);
    const baseUsed = BUDGET.baseUsedOf(cfg, store, key);
    let occupied = 0; // 在途占用：已提交、尚未验收的部分
    let spent = 0;    // 已验收消耗：按验收数量折算，部分验收也能准确拆分
    (state.orders || []).forEach(function (o) {
      if (o.store !== store || !occupiesStore(o)) return;
      const s = splitOrder(o)[key];
      if (!s) return;
      spent = round2(spent + s.accepted);
      occupied = round2(occupied + Math.max(0, s.total - s.accepted));
    });
    const used = round2(baseUsed + occupied + spent);
    return {
      key: key,
      name: BUDGET.NAME[key],
      short: BUDGET.SHORT[key],
      budget: round2(budget),
      baseUsed: round2(baseUsed),
      occupied: occupied,
      spent: spent,
      used: used,
      available: round2(Math.max(0, budget - used)),
      usedPct: budget > 0 ? Math.min(100, Math.round(used / budget * 100)) : 0
    };
  });
}

function budgetSummary(state, session) {
  const cfg = budgetCfg(state);
  const keys = [];
  const push = function (s) { if (s && keys.indexOf(s) < 0) keys.push(s); };
  Object.keys(state.storeBudgets || {}).forEach(push);
  Object.keys((state.budgetConfig || {}).rooms || {}).forEach(push);
  Object.keys((state.budgetConfig || {}).override || {}).forEach(push);
  // 门店角色：管理范围内的门店
  if (session && session.role === 'store') (session.stores || []).forEach(push);
  // 战区角色：本战区所有门店（含尚未建台账的门店）
  if (session && session.role === 'region') {
    STAFF.forEach(function (x) {
      if (x.role !== 'store' || x.zone !== session.zone) return;
      (x.stores || []).forEach(push);
    });
    (state.orders || []).forEach(function (o) {
      if (o.purchaseType !== 'department' && zoneOf(o.store) === session.zone) push(o.store);
    });
  }
  // 中台口径：补全演示门店，避免"全公司"只剩几家建档店
  if (session && session.role === 'central') {
    STAFF.forEach(function (x) {
      if (x.role !== 'store') return;
      (x.stores || []).forEach(push);
    });
    (state.orders || []).forEach(function (o) {
      if (o.purchaseType !== 'department') push(o.store);
    });
  }
  const rows = keys.map(function (store) {
    const items = storeBudgetRows(state, store);
    const sum = function (f) { return round2(items.reduce(function (s, x) { return s + x[f]; }, 0)); };
    const budget = sum('budget');
    const used = sum('used');
    return {
      store: store,
      zone: zoneOf(store) || '',
      rooms: BUDGET.roomsOf(cfg, store),
      items: items,
      budget: budget,
      baseUsed: sum('baseUsed'),
      occupied: sum('occupied'),
      spent: sum('spent'),
      used: used,
      available: sum('available'),
      usedPct: budget > 0 ? Math.min(100, Math.round(used / budget * 100)) : 0
    };
  });
  if (session && session.role === 'store') {
    return rows.filter(function (r) { return (session.stores || []).indexOf(r.store) >= 0; });
  }
  if (session && session.role === 'region') {
    return rows.filter(function (r) { return r.zone === session.zone; })
      .sort(function (a, b) { return b.usedPct - a.usedPct; });
  }
  if (session && ['department', 'supplier'].indexOf(session.role) >= 0) return [];
  return rows.sort(function (a, b) { return b.usedPct - a.usedPct; });
}

/* ------------------------- 常用清单 ------------------------- */
// 按历史下单数量排序，为新单提供"一键复购"入口，不额外存储
function frequentItems(state, session, limit) {
  if (!session || ['store', 'department', 'central'].indexOf(session.role) < 0) return [];
  const catMap = catalogMapOf(state);
  const counts = {};
  (state.orders || []).forEach(function (o) {
    if (['rejected', 'cancelled'].indexOf(o.status) >= 0) return;
    const mine = session.role === 'store'
      ? (o.purchaseType !== 'department' && (session.stores || []).indexOf(o.store) >= 0)
      : (o.purchaseType === 'department' && o.department === session.department);
    if (!mine) return;
    (o.items || []).forEach(function (x) {
      const p = catMap[x.id];
      if (!p || p.deleted || p.enabled === false) return;
      counts[x.id] = (counts[x.id] || 0) + Number(x.qty || 0);
    });
  });
  return Object.keys(counts)
    .sort(function (a, b) { return counts[b] - counts[a]; })
    .slice(0, limit || 6)
    .map(function (id) {
      const p = catMap[id];
      return { id: id, name: p.name, spec: p.spec || '', unit: p.unit || '', price: p.price, times: counts[id] };
    });
}

/* ------------------------- 角色可见范围 ------------------------- */
function visibleOrders(state, session) {
  const orders = (state.orders || []).slice();
  if (!session) return [];
  if (session.role === 'store') {
    return orders.filter(function (o) { return session.stores.indexOf(o.store) >= 0; });
  }
  if (session.role === 'department') {
    return orders.filter(function (o) { return o.purchaseType === 'department' && o.department === session.department; });
  }
  if (session.role === 'region') {
    return orders.filter(function (o) { return o.zone === session.zone; });
  }
  if (session.role === 'supplier') {
    return orders.filter(function (o) {
      return Object.keys(o.supplierRecords || {}).indexOf(session.supplier) >= 0;
    });
  }
  return orders;
}

// 谁有权验收这笔单：门店验门店采购与送到本店的部门采购；部门/中台验总部配送
function canAcceptOrder(order, session) {
  if (!order || !session) return false;
  if (order.purchaseType === 'department') {
    if (order.receivingType === 'store') return session.role === 'store' && (session.stores || []).indexOf(order.store) >= 0;
    return !!session.department && session.department === order.department;
  }
  return session.role === 'store' && (session.stores || []).indexOf(order.store) >= 0;
}

// 待验收订单：与验收页口径一致（有权限 + 已发货 + 仍有未验收数量），
// 避免首页徽标把"送到门店的部门单"算给采购部门，点进去却是空列表
function pendingAcceptOrders(state, session) {
  if (!session || ['store', 'department', 'central'].indexOf(session.role) < 0) return [];
  return visibleOrders(state, session).filter(function (o) {
    if (['delivering', 'delivered', 'partial'].indexOf(o.status) < 0) return false;
    if (!canAcceptOrder(o, session)) return false;
    return (o.items || []).some(function (x) {
      return Number(x.deliveredQty || 0) > Number(x.accepted || 0);
    });
  });
}

function pendingApprovals(state, session) {
  if (!session) return [];
  const list = state.orders || [];
  if (session.role === 'central') {
    return list.filter(function (o) {
      return ['budget-central', 'amount-approval', 'dept-approval'].indexOf(o.status) >= 0 &&
        (o.status !== 'amount-approval' || o.tier !== 'region');
    });
  }
  if (session.role === 'region') {
    return list.filter(function (o) {
      if (o.zone !== session.zone) return false;
      return o.status === 'order-review' || o.status === 'budget-region' ||
        (o.status === 'amount-approval' && o.tier === 'region');
    });
  }
  return [];
}

// 待确认结算：门店/部门待提交金额，供应商待确认金额（多供应商订单仅展示尚未确认的供应商）
function pendingSettleOrders(state, session) {
  if (!session) return [];
  const list = visibleOrders(state, session);
  if (session.role === 'supplier') {
    return list.filter(function (o) {
      if (o.status !== 'settle-supplier') return false;
      const c = o.settlement && o.settlement.confirmedBySuppliers;
      return !(c && c[session.supplier]);
    });
  }
  return list.filter(function (o) {
    return ['settle-pending', 'settle-disputed'].indexOf(o.status) >= 0 && !!settleActorOf(o, session);
  });
}

function actionCount(state, session) {
  if (!session) return 0;
  if (session.role === 'central' || session.role === 'region') return pendingApprovals(state, session).length;
  if (session.role === 'supplier') {
    const ack = visibleOrders(state, session).filter(function (o) {
      const r = o.supplierRecords[session.supplier];
      return r && r.status === 'pending' && ['cancelled', 'rejected'].indexOf(o.status) < 0;
    }).length;
    return ack + pendingSettleOrders(state, session).length;
  }
  if (session.role === 'store' || session.role === 'department') {
    const accept = visibleOrders(state, session).filter(function (o) {
      return ['delivered', 'partial', 'delivering'].indexOf(o.status) >= 0;
    }).length;
    return accept + pendingSettleOrders(state, session).length;
  }
  return 0;
}

module.exports = {
  CATALOG_BY_ID, SHIPPING_METHODS, INSTALL_REQUIRED, STORES,
  catalogOf, catalogMapOf, suppliersOf, normalizeScope, canActorBuyItem, saveCatalogItem, toggleCatalogItem, setCatalogItemScope, deleteCatalogItem, restoreCatalogItem,
  approvalConfigOf, saveApprovalConfig, recentStoreCents,
  contractsOf, contractSummary, saveContract, computeDepartmentQuote,
  computeQuote, createStoreOrder, createDepartmentOrders, approveDepartmentGroup,
  approveOrder, batchApproveOrders, cancelOrder, closeOrder, supplierAck, reopenSupplierAck, supplierDeliver,
  batchAvailability, acceptDelivery, hasOpenAcceptanceIssue, resolveAcceptanceIssue, finalizeShortDelivery,
  acceptedAmountOf, acceptedBySupplierOf, settlementBySupplierOf, settleActorOf, submitSettlement, settleAction, pendingSettleOrders,
  createReconciliation, reconAction, slaEntries, slaForOrder, effectiveOrderAmounts, reportSummary, departmentSummary, contractBudgetReport,
  budgetSummary, budgetGap, adjustFlex, transferStoreBudget, storeUsableCents, frequentItems,
  saveBudgetConfig, budgetConfigOf, storeBudgetRows, splitOrder, applyGapBudget, revertBudgetTransfer,
  visibleOrders, pendingAcceptOrders, canAcceptOrder,
  pendingApprovals, actionCount, uid
};
