/* 浏览器本地存储层：与小程序 utils/store.js 同结构，接后端时只需替换这一层 */
(function (global) {
  const P = (global.APP_CONFIG && APP_CONFIG.prefix) || 'anju_h5_';
  const K = {
    state: P + 'state',
    identity: P + 'identity',
    cart: P + 'cart',
    drafts: P + 'drafts',
    audit: P + 'audit',
    evidence: P + 'evidence',
    demo: P + 'demo',
    profile: P + 'profile'
  };

  // 种子结构版本：与小程序 SCHEMA 对齐，结构变化时自增会重建演示数据
  const SCHEMA = 3;   // 3：预算改为「门店 × 费用科目」（budgetConfig）
  const clone = function (v) { return JSON.parse(JSON.stringify(v)); };

  function read(key, dft) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : dft;
    } catch (e) {
      return dft;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      const err = new Error('本地存储空间不足，请到「我的」清理演示数据后重试');
      err.code = 'QUOTA';
      throw err;
    }
  }

  function ensureState() {
    let state = read(K.state, null);
    if (!state || !Array.isArray(state.orders) || state.schema !== SCHEMA) {
      state = clone(global.BIZ.seed.SEED_STATE);
      state.schema = SCHEMA;
      state.revision = 1;
      write(K.state, state);
    }
    return state;
  }

  function saveState(state) {
    state.revision = (state.revision || 0) + 1;
    state.updatedAt = new Date().toISOString();
    write(K.state, state);
    return state;
  }

  function resetState() {
    [K.state, K.drafts, K.audit, K.evidence, K.cart].forEach(function (key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    });
    return ensureState();
  }

  /* ------------- 购物车 ------------- */
  function loadCart(uid) {
    const all = read(K.cart, {}) || {};
    return all[uid] || { lines: {}, store: '', updatedAt: '' };
  }

  function saveCart(uid, cart) {
    const all = read(K.cart, {}) || {};
    all[uid] = Object.assign({ updatedAt: new Date().toISOString() }, cart);
    write(K.cart, all);
  }

  function clearCart(uid) {
    const all = read(K.cart, {}) || {};
    delete all[uid];
    write(K.cart, all);
  }

  /* ------------- 草稿 ------------- */
  function listDrafts(uid) {
    return (read(K.drafts, []) || [])
      .filter(function (x) { return x.actorId === uid; })
      .sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
  }

  function saveDraft(draft) {
    const rows = read(K.drafts, []) || [];
    const i = rows.findIndex(function (x) { return x.id === draft.id; });
    if (i >= 0) rows[i] = draft; else rows.unshift(draft);
    const mine = rows.filter(function (x) { return x.actorId === draft.actorId; });
    if (mine.length > 40) {
      const drop = mine.sort(function (a, b) { return a.updatedAt < b.updatedAt ? -1 : 1; })[0];
      write(K.drafts, rows.filter(function (x) { return x.id !== drop.id; }));
    } else {
      write(K.drafts, rows);
    }
    return draft;
  }

  function deleteDraft(id, uid) {
    write(K.drafts, (read(K.drafts, []) || []).filter(function (x) {
      return !(x.id === id && x.actorId === uid);
    }));
  }

  /* ------------- 审批/操作流水 ------------- */
  function appendAudit(rows) {
    if (!rows || !rows.length) return;
    const list = (read(K.audit, []) || []).concat(rows).slice(0, 600);
    write(K.audit, list);
  }

  function listAudit(orderId) {
    const list = read(K.audit, []) || [];
    return orderId ? list.filter(function (x) { return x.orderId === orderId; }) : list;
  }

  /* ------------- 验收照片（压缩后的 dataURL） ------------- */
  function addEvidence(row) {
    const list = read(K.evidence, []) || [];
    list.unshift(row);
    write(K.evidence, list.slice(0, 12));
  }

  function listEvidence(orderId) {
    return (read(K.evidence, []) || []).filter(function (x) { return x.orderId === orderId; });
  }

  /* ------------- 演示模式 ------------- */
  function isDemo() {
    const v = read(K.demo, 'on');
    return v === 'on' || v === true;
  }

  function setDemo(on) { write(K.demo, on ? 'on' : 'off'); }

  /* ------------- 概览 / 清理 ------------- */
  function usage() {
    let bytes = 0;
    Object.keys(localStorage).forEach(function (key) {
      if (key.indexOf(P) !== 0) return;
      bytes += (localStorage.getItem(key) || '').length;
    });
    return { bytes: bytes, kb: Math.round(bytes / 1024) };
  }

  global.Store = {
    KEYS: K,
    ensureState: ensureState,
    loadState: ensureState,
    saveState: saveState,
    resetState: resetState,
    loadCart: loadCart,
    saveCart: saveCart,
    clearCart: clearCart,
    listDrafts: listDrafts,
    saveDraft: saveDraft,
    deleteDraft: deleteDraft,
    appendAudit: appendAudit,
    listAudit: listAudit,
    addEvidence: addEvidence,
    listEvidence: listEvidence,
    isDemo: isDemo,
    setDemo: setDemo,
    usage: usage
  };
})(window);
