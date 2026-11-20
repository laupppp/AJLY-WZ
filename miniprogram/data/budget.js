// 费用科目与预算基数：门店某项费用额度 = 门店房间数 × 科目系数（可被中台按门店覆盖或直接定额）
// 纯逻辑，无 wx.* 依赖，小程序与 H5 共用。
const round2 = function (n) { return Math.round(Number(n || 0) * 100) / 100; };

// 三项费用科目。coef 为默认系数（元/间房/年）
const ITEMS = [
  {
    key: 'community', name: '社群费', short: '社群', coef: 10, tone: 'blue',
    desc: '社群运营、活动物资、便民与氛围物资'
  },
  {
    key: 'customer', name: '客户维护费', short: '维护', coef: 10, tone: 'teal',
    desc: '客户维护礼品、门店日常服务耗材'
  },
  {
    key: 'marketing', name: '营销费', short: '营销', coef: 10, tone: 'violet',
    desc: '宣传印刷、标识标牌、展示与喷绘安装'
  }
];
const KEYS = ITEMS.map(function (i) { return i.key; });

const NAME = {};
const SHORT = {};
const COEF_DEFAULT = {};
const DESC = {};
const TONE = {};
ITEMS.forEach(function (i) {
  NAME[i.key] = i.name;
  SHORT[i.key] = i.short;
  COEF_DEFAULT[i.key] = i.coef;
  DESC[i.key] = i.desc;
  TONE[i.key] = i.tone;
});

const DEFAULT_ROOMS = 1000;   // 每个门店管理的房间数（演示统一 1000）
const DEFAULT_BASE_USED = { community: 800, customer: 600, marketing: 400 }; // 期初已用（历史结转）

// 商品大类 → 费用科目。目录里单个商品可用 product.budgetItem 覆盖
const CATEGORY_MAP = {
  '活动及社群物资': 'community',
  '奖品礼品': 'customer',
  '日常运营耗材': 'customer',
  '宣传印刷物料': 'marketing',
  '员工物资': 'customer'
};
const FALLBACK = 'customer';

// 接受商品（含 category / budgetItem）或订单行，返回科目 key
function itemOf(thing) {
  if (!thing) return FALLBACK;
  if (thing.budgetItem && NAME[thing.budgetItem]) return thing.budgetItem;
  const cat = thing.category || '';
  return CATEGORY_MAP[cat] || FALLBACK;
}

function itemName(key) { return NAME[key] || key; }

// 补齐配置结构，兼容旧数据（老版本只有 storeBudgets）
function normalize(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  if (!c.rooms || typeof c.rooms !== 'object') c.rooms = {};
  if (!c.coef || typeof c.coef !== 'object') c.coef = {};
  if (!c.storeCoef || typeof c.storeCoef !== 'object') c.storeCoef = {};
  if (!c.override || typeof c.override !== 'object') c.override = {};
  if (!c.baseUsed || typeof c.baseUsed !== 'object') c.baseUsed = {};
  if (!c.adjust || typeof c.adjust !== 'object') c.adjust = {};
  if (c.flex === undefined) c.flex = 20000; // 机动预算池（元），跨门店共享
  KEYS.forEach(function (k) {
    if (typeof c.coef[k] !== 'number') c.coef[k] = COEF_DEFAULT[k];
  });
  return c;
}

function roomsOf(cfg, store) {
  const n = cfg && cfg.rooms ? Number(cfg.rooms[store]) : NaN;
  return isFinite(n) && n > 0 ? n : DEFAULT_ROOMS;
}

// 门店科目系数：门店覆盖优先，其次全局
function coefOf(cfg, store, key) {
  const sc = cfg && cfg.storeCoef ? cfg.storeCoef[store] : null;
  if (sc && typeof sc[key] === 'number' && isFinite(sc[key])) return sc[key];
  const g = cfg && cfg.coef ? Number(cfg.coef[key]) : NaN;
  return isFinite(g) ? g : COEF_DEFAULT[key];
}

function overrideOf(cfg, store, key) {
  const row = cfg && cfg.override ? cfg.override[store] : null;
  if (!row || row[key] === undefined || row[key] === null || row[key] === '') return null;
  const n = Number(row[key]);
  return isFinite(n) && n >= 0 ? round2(n) : null;
}

function adjustOf(cfg, store, key) {
  const row = cfg && cfg.adjust ? cfg.adjust[store] : null;
  const n = row ? Number(row[key]) : 0;
  return isFinite(n) ? round2(n) : 0;
}

// 额度基数（元）：中台直接定额优先，否则 房间数 × 科目系数
function budgetBaseOf(cfg, store, key) {
  const ov = overrideOf(cfg, store, key);
  return ov === null ? round2(roomsOf(cfg, store) * coefOf(cfg, store, key)) : ov;
}

// 某门店某科目额度（元）= 基数 + 手工增减（机动池追加、门店间调剂、撤销回退）
function budgetOf(cfg, store, key) {
  return round2(budgetBaseOf(cfg, store, key) + adjustOf(cfg, store, key));
}

// 额度的来源：'override' 表示中台直接定额，'formula' 表示房间数 × 系数
function basisOf(cfg, store, key) {
  return overrideOf(cfg, store, key) === null ? 'formula' : 'override';
}

function baseUsedOf(cfg, store, key) {
  const row = cfg && cfg.baseUsed ? cfg.baseUsed[store] : null;
  const n = row && row[key] !== undefined ? Number(row[key]) : DEFAULT_BASE_USED[key];
  return isFinite(n) ? round2(n) : 0;
}

// 门店三项合计额度（元）
function storeBudgetOf(cfg, store) {
  return round2(KEYS.reduce(function (s, k) { return s + budgetOf(cfg, store, k); }, 0));
}

module.exports = {
  ITEMS: ITEMS, KEYS: KEYS,
  NAME: NAME, SHORT: SHORT, DESC: DESC, TONE: TONE,
  COEF_DEFAULT: COEF_DEFAULT, DEFAULT_ROOMS: DEFAULT_ROOMS, DEFAULT_BASE_USED: DEFAULT_BASE_USED,
  CATEGORY_MAP: CATEGORY_MAP, FALLBACK: FALLBACK,
  itemOf: itemOf, itemName: itemName,
  normalize: normalize,
  roomsOf: roomsOf, coefOf: coefOf, overrideOf: overrideOf, adjustOf: adjustOf,
  budgetBaseOf: budgetBaseOf, budgetOf: budgetOf, basisOf: basisOf,
  baseUsedOf: baseUsedOf, storeBudgetOf: storeBudgetOf
};
