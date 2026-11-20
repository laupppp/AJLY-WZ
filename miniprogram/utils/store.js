// 本地持久化层：订单状态、草稿、审批/验收/配送流水、验收照片文件
// 说明：小程序本地存储实现，全部演示数据（虚构）。后续接入云数据库时只需替换本文件。
const { SEED_STATE } = require('../data/seed');

const KEYS = {
  state: 'anju_state_v124',
  drafts: 'anju_drafts_v124',
  audit: 'anju_audit_v124',
  evidence: 'anju_evidence_v124',
  identity: 'anju_identity_v124',
  cart: 'anju_cart_v124'
};

const clone = function (value) { return JSON.parse(JSON.stringify(value)); };
// 演示数据结构版本：种子结构变化（如新增 supplierRecords）时自增，
// 旧缓存会自动重建，避免出现"看不到订单 / 接不了单"这类由历史缓存引起的异常。
const SCHEMA = 3;   // 3：预算改为「门店 × 费用科目」结构（budgetConfig）
// 履约状态口径版本：3 起「发货」只推进到配送中（供应商记录 shipping），
// 全部接单未发货为 preparing（备货中）。与 SCHEMA 分离，老数据只做一次状态修正，不重建。
const FLOW_SCHEMA = 3;

function migrateFlow(state) {
  if (state.flowSchema === FLOW_SCHEMA) return state;
  let changed = false;
  (state.orders || []).forEach(function (o) {
    const recs = o.supplierRecords || {};
    const keys = Object.keys(recs);
    let recChanged = false;
    keys.forEach(function (key) {
      const r = recs[key];
      if (!r || r.status !== 'delivered') return;
      const own = (o.items || []).filter(function (x) { return x.supplier === key; });
      const allAccepted = own.length > 0 && own.every(function (x) { return Number(x.accepted || 0) === x.qty; });
      // 旧数据把"已发货"写成 delivered，但货还没验收完 → 退回配送中
      if (!allAccepted) {
        r.status = 'shipping';
        r.delivered = false;
        recChanged = true;
      }
    });
    const terminal = ['accepted', 'partial', 'done', 'cancelled', 'rejected'].indexOf(o.status) >= 0;
    if (!terminal && keys.length) {
      const anyShipped = keys.some(function (k) {
        const r = recs[k];
        return r && (r.delivered || ['shipping', 'accepted'].indexOf(r.status) >= 0 || (r.deliveries && r.deliveries.length));
      });
      const waiting = keys.some(function (k) { return recs[k] && ['pending', 'issue'].indexOf(recs[k].status) >= 0; });
      const next = anyShipped ? 'delivering' : (waiting ? 'supplier' : 'preparing');
      if (['supplier', 'preparing', 'delivering', 'delivered'].indexOf(o.status) >= 0 && o.status !== next) {
        o.status = next;
        recChanged = true;
      }
    }
    if (recChanged) changed = true;
  });
  state.flowSchema = FLOW_SCHEMA;
  if (changed) {
    try { wx.setStorageSync(KEYS.state, state); } catch (e) { /* 空间不足时下次再迁 */ }
  }
  return state;
}

function ensureState() {
  let state = null;
  try { state = wx.getStorageSync(KEYS.state); } catch (e) { state = null; }
  if (!state || !Array.isArray(state.orders) || state.schema !== SCHEMA) {
    state = clone(SEED_STATE);
    state.revision = 1;
    state.schema = SCHEMA;
    state.flowSchema = FLOW_SCHEMA;
    wx.setStorageSync(KEYS.state, state);
    return state;
  }
  return migrateFlow(state);
}

function loadState() { return ensureState(); }

function saveState(state) {
  state.revision = (state.revision || 0) + 1;
  state.updatedAt = new Date().toISOString();
  try {
    wx.setStorageSync(KEYS.state, state);
  } catch (e) {
    throw new Error('本地存储空间不足，请到「统计看板」清理历史验收照片后重试');
  }
  return state;
}

function resetState() {
  wx.removeStorageSync(KEYS.state);
  wx.removeStorageSync(KEYS.drafts);
  wx.removeStorageSync(KEYS.audit);
  wx.removeStorageSync(KEYS.evidence);
  wx.removeStorageSync(KEYS.cart);
  return ensureState();
}

/* ---------------- 草稿 ---------------- */
function listDrafts(actorId) {
  const rows = wx.getStorageSync(KEYS.drafts) || [];
  return rows.filter(function (x) { return x.actorId === actorId; })
    .sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
}

function saveDraft(draft) {
  const rows = wx.getStorageSync(KEYS.drafts) || [];
  const index = rows.findIndex(function (x) { return x.id === draft.id; });
  if (index >= 0) rows[index] = draft; else rows.unshift(draft);
  // 单用户最多保留 40 条
  const mine = rows.filter(function (x) { return x.actorId === draft.actorId; });
  if (mine.length > 40) {
    const drop = mine.sort(function (a, b) { return a.updatedAt < b.updatedAt ? -1 : 1; })[0];
    const keep = rows.filter(function (x) { return x.id !== drop.id; });
    wx.setStorageSync(KEYS.drafts, keep);
  } else {
    wx.setStorageSync(KEYS.drafts, rows);
  }
  return draft;
}

function deleteDraft(id, actorId) {
  const rows = wx.getStorageSync(KEYS.drafts) || [];
  wx.setStorageSync(KEYS.drafts, rows.filter(function (x) { return !(x.id === id && x.actorId === actorId); }));
}

/* ---------------- 审计流水 ---------------- */
function appendAudit(rows) {
  const list = wx.getStorageSync(KEYS.audit) || [];
  const merged = rows.concat(list).slice(0, 400);
  wx.setStorageSync(KEYS.audit, merged);
}

function listAudit(orderId) {
  const list = wx.getStorageSync(KEYS.audit) || [];
  if (!orderId) return list;
  return list.filter(function (x) { return x.orderId === orderId; });
}

/* ---------------- 验收照片 ---------------- */
function savePhoto(tempFilePath) {
  const fs = wx.getFileSystemManager();
  try {
    const saved = fs.saveFileSync(tempFilePath);
    return saved;
  } catch (e) {
    return tempFilePath;
  }
}

function addEvidence(row) {
  const list = wx.getStorageSync(KEYS.evidence) || [];
  list.unshift(row);
  // 只保留最近 60 条照片记录，超出部分删除本地文件
  const removed = list.splice(60);
  removed.forEach(function (item) {
    if (item.filePath) { try { wx.getFileSystemManager().unlinkSync(item.filePath); } catch (e) {} }
  });
  wx.setStorageSync(KEYS.evidence, list);
}

function listEvidence(orderId) {
  const list = wx.getStorageSync(KEYS.evidence) || [];
  return list.filter(function (x) { return x.orderId === orderId; });
}

/* ---------------- 购物车草稿 ---------------- */
function saveCart(cart) { wx.setStorageSync(KEYS.cart, cart); }
function loadCart() { return wx.getStorageSync(KEYS.cart) || null; }
function clearCart() { wx.removeStorageSync(KEYS.cart); }

/* ---------------- 演示模式 ---------------- */
// 关闭后隐藏"切换身份/重置数据"等演示痕迹，方便对外演示时更接近真实产品
const DEMO_KEY = 'anju_demo_mode_v124';

function isDemoMode() {
  let value = '';
  try { value = wx.getStorageSync(DEMO_KEY); } catch (e) { value = ''; }
  return value === '' || value === true || value === 'on';
}

function setDemoMode(on) {
  wx.setStorageSync(DEMO_KEY, on ? 'on' : 'off');
}

module.exports = {
  KEYS, clone, ensureState, loadState, saveState, resetState,
  listDrafts, saveDraft, deleteDraft,
  appendAudit, listAudit,
  savePhoto, addEvidence, listEvidence,
  saveCart, loadCart, clearCart,
  isDemoMode, setDemoMode
};
