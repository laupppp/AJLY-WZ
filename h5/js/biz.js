/* 自动生成，请勿直接修改。
 * 来源：miniprogram/{utils,data}/*.js（纯逻辑模块）
 * 重新生成：node h5/build-biz.js
 * 生成时间：2026-11-20T08:14:22.286Z
 * 模块：data/budget, data/catalog, data/seed, data/subcats, utils/domain, utils/format, utils/perm
 * 源文件指纹：4969e855771e168e
 */
(function (global) {
  var defs = {};
  var cache = {};
  function __def(id, fn) { defs[id] = fn; }

  function resolve(from, spec) {
    if (spec.charAt(0) !== '.') return spec;
    var base = from.split('/');
    base.pop();
    spec.split('/').forEach(function (seg) {
      if (!seg || seg === '.') return;
      if (seg === '..') base.pop();
      else base.push(seg);
    });
    return base.join('/');
  }

  function load(id) {
    if (cache[id]) return cache[id].exports;
    var fn = defs[id];
    if (!fn) throw new Error('模块未打包：' + id);
    var mod = { exports: {} };
    cache[id] = mod;
    fn(mod, mod.exports, function (spec) { return load(resolve(id, spec)); });
    return mod.exports;
  }

__def("data/budget", function (module, exports, require) {
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

});

__def("data/catalog", function (module, exports, require) {
// 商品目录（由 V1.24 前端与 catalog-demo.json 生成，全部为演示数据，非合同价）
const CATALOG=[{"id":"OP-001","name":"充电宝","spec":"20000毫安、快充、AH双线","unit":"个","price":125,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-002","name":"暖手宝","spec":"PVC材质/绒布、可充电款","unit":"个","price":61,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-003","name":"保温杯","spec":"500ml、316不锈钢、刻字","unit":"个","price":62,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-004","name":"晴雨伞","spec":"十二骨、三折叠 、晴雨两用","unit":"个","price":44,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-005","name":"运动健身包","spec":"50L、干湿分离、独立鞋仓、尼龙防泼水","unit":"个","price":78,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-006","name":"数据线","spec":"三合一快充、1.5m、编织线身、锌合金接头","unit":"条","price":32,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-007","name":"颈枕","spec":"记忆棉、U型护颈、可拆洗外套、含收纳袋","unit":"个","price":35,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-008","name":"午睡毯","spec":"法兰绒、120×150cm、可机洗、防静电","unit":"条","price":55,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-009","name":"冰丝袖套","spec":"UPF50+、冰丝凉感、一对装、多色可选","unit":"对","price":37,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-010","name":"护眼台灯","spec":"国AA级照度、无频闪、三档色温、触控调光","unit":"个","price":113,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-011","name":"蓝牙音箱","spec":"IPX5防水、蓝牙5.3、续航12h、重低音振膜","unit":"个","price":223,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-012","name":"毛巾礼盒","spec":"纯棉新疆棉、3条装、34×75cm、礼盒精装","unit":"盒","price":40,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-013","name":"收纳箱","spec":"45L、加厚塑料透明、带万向滑轮、卡扣翻盖","unit":"个","price":50,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-014","name":"吹风机","spec":"1800W、负离子护发、恒温NTC、六档风速、低噪设计","unit":"个","price":112,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-015","name":"手机支架","spec":"折叠伸缩、桌面/床头两用、防滑硅胶垫","unit":"个","price":13,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-016","name":"体脂秤","spec":"蓝牙APP、多指标（体重/体脂/肌肉量）、钢化玻璃、LED隐藏屏","unit":"个","price":267,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-018","name":"冰箱贴","spec":"强力磁吸、3D立体浮雕创意款（5个/套）、直径3.5cm、主题套装","unit":"套","price":14,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-019","name":"速干毛巾","spec":"超细纤维、双面加厚、30×80cm、吸水速干、带挂环","unit":"条","price":14,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-020","name":"瑜伽垫","spec":"TPE材质、加厚6mm、双面防滑纹、183×61cm、含背带+绑带","unit":"条","price":65,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-021","name":"运动水壶","spec":"Tritan材质、700ml、一键弹盖吸嘴、防漏锁扣、宽口易清洗","unit":"个","price":45,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-022","name":"运动腰包","spec":"防水尼龙、大屏手机仓（6.8寸）、夜光反光条、隐形耳机孔","unit":"个","price":50,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-023","name":"沙发护腰靠枕","spec":"记忆棉+凝胶层、人体工学曲面、45×32×58cm、透气网布外套","unit":"个","price":68,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-024","name":"陶瓷餐具套餐","spec":"6件套（汤勺/味碟/碗/盘/马克杯）、釉下彩、微波炉&洗碗机适用","unit":"套","price":105,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-025","name":"电子手表","spec":"带电子屏、支持心血氧监测、防水、磁吸充电","unit":"个","price":309,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-026","name":"智能手环","spec":"AMOLED屏、心率血氧睡眠监测、50米防水、14天续航","unit":"个","price":256,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-027","name":"蓝牙耳机","spec":"半入耳式、IPX4及以上防水防尘、降噪","unit":"对","price":140,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-028","name":"电动牙刷","spec":"声波震动、三档模式、感应充电、IPX7防水","unit":"个","price":137,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-029","name":"电煮锅","spec":"304不锈钢内胆、1.6L、两档功率（300/600W）、不粘煎盘盖","unit":"个","price":96,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-030","name":"便携手持小风扇","spec":"5档强风、1200mAh大电池（续航8h）、折叠支架、数显屏","unit":"个","price":26,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"活动奖品、培训类奖品","installation":""},{"id":"OP-031","name":"电动车挡风被-夏款","spec":"春秋薄款、防晒涂层、防雨绸面料、反光条、通用电瓶车","unit":"个","price":34,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"培训类奖品","installation":""},{"id":"OP-032","name":"电动车挡风被-冬款","spec":"冬季加厚（仿兔毛内层）、防泼水、加宽护肩护把、可拆洗","unit":"个","price":52,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"培训类奖品","installation":""},{"id":"OP-033","name":"腰靠","spec":"办公室用、记忆棉、聚酯纤维外套材质","unit":"个","price":65,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"培训类奖品","installation":""},{"id":"OP-034","name":"恒温壶/养生壶","spec":"1.5L、智能多段恒温（40/60/80/100℃）、高硼硅玻璃、防干烧","unit":"个","price":125,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"培训类奖品","installation":""},{"id":"OP-035","name":"床上用品四件套","spec":"100%纯棉、1.5m床（被套200×230cm）","unit":"套","price":160,"supplier":"运营物资供应商（演示）","category":"奖品礼品","demoOnly":false,"note":"培训类奖品","installation":""},{"id":"OP-036","name":"垃圾袋","spec":"绳式、黑色、45*50cm*100只","unit":"包","price":9,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"便民/活动后勤（活动物料）","installation":""},{"id":"OP-037","name":"一次性雨衣","spec":"一次性雨衣 加厚PEVA 成人 全身 含帽 均码","unit":"个","price":8,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"便民/应急（活动物料）","installation":""},{"id":"OP-038","name":"螺丝刀套装","spec":"螺丝刀套装 多功能 26合1 铬钒钢 磁吸头","unit":"套","price":38,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"便民服务（活动物料）","installation":""},{"id":"OP-039","name":"指甲刀套装","spec":"指甲刀套装 不锈钢 8件套 皮质包","unit":"套","price":59,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"便民服务（活动物料）","installation":""},{"id":"OP-040","name":"插线板","spec":"插线板 3位5孔 1.8m 防雷防过载 新国标","unit":"个","price":40,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"便民物资（活动物料）","installation":""},{"id":"OP-041","name":"衣架","spec":"衣架 10支装 塑料 防滑 加厚","unit":"套","price":5.58,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"便民物资（活动物料）","installation":""},{"id":"OP-042","name":"针线包","spec":"针线包 便携 12色线 含剪刀/顶针","unit":"套","price":16,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"便民物资（活动物料）","installation":""},{"id":"OP-043","name":"跳绳","spec":"PVC计数跳绳 2.8m 电子计数表头 轴承顺滑 长短可调 成人/儿童通用","unit":"个","price":27,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"运动打卡（活动物料）","installation":""},{"id":"OP-044","name":"毽子","spec":"鹅毛毽 手工缝制 橡胶底座 高约20cm 标准比赛款","unit":"个","price":6,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"传统运动（活动物料）","installation":""},{"id":"OP-045","name":"羽毛球拍","spec":"碳素纤维羽毛球拍 对拍已穿线 进攻型 约85g/支 含拍套","unit":"支","price":119,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"运动竞技（活动物料）","installation":""},{"id":"OP-046","name":"羽毛球","spec":"鹅毛羽毛球 比赛级 12只/筒","unit":"筒","price":77,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"运动竞技（活动物料）","installation":""},{"id":"OP-047","name":"乒乓球拍","spec":"乒乓球拍 双面反胶 横直两用 含套胶 成品拍","unit":"支","price":85,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"运动竞技（活动物料）","installation":""},{"id":"OP-048","name":"乒乓球","spec":"乒乓球 三星 赛璐珞/ABS 一盒6只","unit":"盒","price":22,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"运动竞技（活动物料）","installation":""},{"id":"OP-049","name":"篮球","spec":"篮球 7号标准 丁基内胆 PU耐磨 室内外通用","unit":"个","price":117,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"运动竞技（活动物料）","installation":""},{"id":"OP-050","name":"桌游套装","spec":"桌游套装 防水卡牌 含狼人杀/UNO/剧本杀等 10款混装","unit":"套","price":109,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"青年社交（活动物料）","installation":""},{"id":"OP-051","name":"扑克牌","spec":"扑克牌 防水PVC塑料 标准54张 含2张鬼牌","unit":"套","price":9,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"棋牌活动（活动物料）","installation":""},{"id":"OP-052","name":"象棋","spec":"象棋 磁吸折叠棋盘 实木棋子 40mm 含收纳","unit":"套","price":52,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"棋牌活动（活动物料）","installation":""},{"id":"OP-053","name":"围棋","spec":"围棋 磁性便携折叠棋盘 19路 含云子棋子 361子","unit":"套","price":70,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"棋牌活动（活动物料）","installation":""},{"id":"OP-054","name":"五子棋","spec":"五子棋 磁性便携 含棋子 可折叠棋盘","unit":"套","price":33,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"棋牌活动（活动物料）","installation":""},{"id":"OP-055","name":"魔方","spec":"魔方 三阶速拧 磁力定位 比赛级 含底座","unit":"个","price":22,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"益智挑战（活动物料）","installation":""},{"id":"OP-056","name":"乐高积木","spec":"积木 基础颗粒 中盒 500+件 兼容乐高","unit":"套","price":37,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"亲子搭建（活动物料）","installation":""},{"id":"OP-057","name":"儿童绘本","spec":"儿童绘本 A4精装全彩 分龄绘本套装 10册/套","unit":"套","price":36,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"亲子阅读（活动物料）","installation":""},{"id":"OP-058","name":"马克笔","spec":"马克笔 24色双头 酒精性 可叠色 含笔袋","unit":"套","price":25,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"绘画活动（活动物料）","installation":""},{"id":"OP-059","name":"水彩颜料","spec":"水彩颜料 12色固体套装 含画笔/笔洗 便携","unit":"套","price":19,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"绘画活动（活动物料）","installation":""},{"id":"OP-060","name":"素描纸","spec":"素描纸 A3 100张/包 180g 双面可用","unit":"包","price":31,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"绘画（活动物料）","installation":""},{"id":"OP-061","name":"彩色卡纸","spec":"彩色卡纸 A4 100张/包 120g 十色混装","unit":"包","price":13,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"手工（活动物料）","installation":""},{"id":"OP-062","name":"安全剪刀","spec":"安全剪刀 圆头儿童 不锈钢刀刃 手工专用 2把/组","unit":"把","price":8,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"手工（活动物料）","installation":""},{"id":"OP-063","name":"固体胶","spec":"固体胶 PVP 大容量 21g/支 速干","unit":"支","price":3,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"手工粘贴（活动物料）","installation":""},{"id":"OP-064","name":"折纸材料包","spec":"折纸材料包 15cm 100张 多色 含教程","unit":"包","price":5,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"手工折纸（活动物料）","installation":""},{"id":"OP-065","name":"超轻黏土","spec":"超轻黏土 24色 无毒 不粘手 可晾干 500g/套","unit":"套","price":34,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"亲子手工（活动物料）","installation":""},{"id":"OP-066","name":"圆形气球","spec":"圆形气球 100只/包 混色 加厚乳胶 可充气 5/10/12寸","unit":"包","price":24,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"装饰/游戏（活动物料）","installation":""},{"id":"OP-067","name":"抽奖箱","spec":"抽奖箱 亚克力透明 双格 含100小球 30x30x30cm","unit":"套","price":67.79,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"互动抽奖（活动物料）","installation":""},{"id":"OP-068","name":"幸运转盘","spec":"幸运转盘 60cm 指针可书写 含支架","unit":"个","price":64,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"互动抽奖（活动物料）","installation":""},{"id":"OP-069","name":"计分牌","spec":"计分牌 翻分牌 0-99 双面 便携","unit":"个","price":19,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"竞技活动（活动物料）","installation":""},{"id":"OP-070","name":"秒表","spec":"秒表 电子 100组记忆 防水 含挂绳","unit":"个","price":69,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"竞技计时（活动物料）","installation":""},{"id":"OP-071","name":"口哨","spec":"口哨 不锈钢裁判哨 含珠 高分贝 含挂绳","unit":"个","price":10,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"裁判/组织（活动物料）","installation":""},{"id":"OP-072","name":"号码布","spec":"号码布 1-50号 防水 含别针 每套50张","unit":"套","price":78,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"比赛分组（活动物料）","installation":""},{"id":"OP-073","name":"团队袖标","spec":"团队袖标 10条/包 红蓝分队 魔术贴 成人通用","unit":"包","price":36,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"团队分组（活动物料）","installation":""},{"id":"OP-074","name":"眼罩","spec":"眼罩 冰丝遮光 松紧可调节 成人通用","unit":"个","price":14,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"互动游戏（活动物料）","installation":""},{"id":"OP-075","name":"绑腿带","spec":"绑腿带 魔术贴宽绑带 双人三足 含护腿垫","unit":"个","price":6,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"团队协作游戏（活动物料）","installation":""},{"id":"OP-076","name":"趾压板","spec":"趾压板 EVA拼接 防滑 指压 含收纳袋","unit":"个","price":41,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"互动挑战（活动物料）","installation":""},{"id":"OP-077","name":"钓鱼玩具","spec":"钓鱼玩具 磁吸 儿童 含竿2支/鱼10条","unit":"套","price":40,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"亲子游戏（活动物料）","installation":""},{"id":"OP-078","name":"沙包","spec":"沙包 棉布 五谷填充 100g/个 3个/套","unit":"套","price":11,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"传统游戏（活动物料）","installation":""},{"id":"OP-079","name":"套圈玩具","spec":"套圈玩具 塑料圈 10只 含立柱5根 可折叠","unit":"套","price":26,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"互动游戏（活动物料）","installation":""},{"id":"OP-080","name":"飞行棋","spec":"飞行棋 防水棋盘 经典款 含棋子/骰子","unit":"套","price":34,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"亲子/益智（活动物料）","installation":""},{"id":"OP-081","name":"跳棋","spec":"跳棋 玻璃珠 防水收纳盒 含棋盘","unit":"套","price":16,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"亲子/益智（活动物料）","installation":""},{"id":"OP-082","name":"阿瓦隆","spec":"阿瓦隆 防水卡牌 标准版 含角色牌/规则说明书","unit":"套","price":61,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"阵营推理（活动物料）","installation":""},{"id":"OP-083","name":"UNO","spec":"UNO纸牌 防水 108张 标准版 含说明书","unit":"套","price":10,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"亲子互动（活动物料）","installation":""},{"id":"OP-084","name":"狼人杀卡牌","spec":"狼人杀卡牌 防水 含身份牌/法官手册 标准版","unit":"套","price":8,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"推理社交（活动物料）","installation":""},{"id":"OP-085","name":"三国杀","spec":"三国杀 防水卡牌 标准版 含武将牌/身份牌 暗金豪华版","unit":"套","price":51,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"策略卡牌（活动物料）","installation":""},{"id":"OP-086","name":"谁是卧底","spec":"谁是卧底 防水卡牌 含词库 500词 标准版","unit":"套","price":19,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"语言推理（活动物料）","installation":""},{"id":"OP-087","name":"大富翁桌游","spec":"大富翁 防水棋盘 含骰子/道具卡 标准版","unit":"套","price":68,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"财商模拟（活动物料）","installation":""},{"id":"OP-088","name":"德国心脏病","spec":"德国心脏病 防水卡牌 含铃铛 标准版","unit":"套","price":44,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"反应力游戏（活动物料）","installation":""},{"id":"OP-089","name":"达芬奇密码","spec":"达芬奇密码 防水卡牌 木质数字牌 标准版","unit":"套","price":42,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"逻辑推理（活动物料）","installation":""},{"id":"OP-090","name":"行动代号","spec":"行动代号 防水卡牌 双人版 含图卡/词卡","unit":"套","price":42,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"词语联想（活动物料）","installation":""},{"id":"OP-091","name":"矮人矿工","spec":"矮人矿工 防水卡牌 身份推理 标准版","unit":"套","price":51,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"身份推理（活动物料）","installation":""},{"id":"OP-092","name":"真心话大冒险","spec":"真心话大冒险 防水卡牌 成人版 100张","unit":"套","price":19,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"破冰互动（活动物料）","installation":""},{"id":"OP-093","name":"害你在心口难开","spec":"害你在心口难开 防水卡牌 爆笑互动 100张","unit":"套","price":24,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"爆笑互动（活动物料）","installation":""},{"id":"OP-094","name":"妙语说书人","spec":"妙语说书人 防水卡牌 含图卡84张 正版","unit":"套","price":76,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"创意表达（活动物料）","installation":""},{"id":"OP-095","name":"卡坦岛","spec":"卡坦岛 桌游 基础版 正版 含版图/资源卡，基础版红盒/海洋版蓝盒","unit":"套","price":157,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"策略桌游（活动物料）","installation":""},{"id":"OP-096","name":"呼啦圈","spec":"呼啦圈 加厚PVC 90cm 可拆卸 可调重量","unit":"个","price":37,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"运动健身（活动物料）","installation":""},{"id":"OP-097","name":"拔河绳","spec":"拔河绳 尼龙编织 30m 直径3cm 含防滑握把","unit":"条","price":224,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"团队竞技（活动物料）","installation":""},{"id":"OP-098","name":"接力棒","spec":"接力棒 铝合金 塑胶握把 标准田径款 4支/套","unit":"套","price":9,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"田径运动（活动物料）","installation":""},{"id":"OP-099","name":"弹力球","spec":"弹力球 橡胶 直径6cm 高弹 3个/组","unit":"组","price":8,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"亲子游戏（活动物料）","installation":""},{"id":"OP-100","name":"泡沫棒","spec":"泡沫棒 EVA 加长款 60cm 安全软质","unit":"根","price":1.5,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"趣味对抗（活动物料）","installation":""},{"id":"OP-101","name":"障碍锥桶","spec":"障碍锥桶 PVC 50cm 反光条 可叠放 含底座","unit":"个","price":20,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"体能挑战（活动物料）","installation":""},{"id":"OP-102","name":"投壶套装","spec":"投壶套装 木质壶1+箭10支 传统款 含收纳","unit":"套","price":46,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"传统游戏（活动物料）","installation":""},{"id":"OP-103","name":"磁吸飞镖盘","spec":"磁吸飞镖盘 双面磁性 含飞镖6支 40cm","unit":"套","price":32,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"竞技游戏（活动物料）","installation":""},{"id":"OP-104","name":"桌面冰壶","spec":"桌面冰壶 迷你套装 含壶石8/赛道 可玩","unit":"套","price":69,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"趣味竞技（活动物料）","installation":""},{"id":"OP-105","name":"保龄球套装","spec":"保龄球套装 塑料球+瓶10 可立 便携款","unit":"套","price":57,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"趣味运动（活动物料）","installation":""},{"id":"OP-106","name":"泡泡机","spec":"泡泡机 电动自动出泡 大容量 含泡泡液","unit":"个","price":33,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"氛围互动（活动物料）","installation":""},{"id":"OP-107","name":"风筝","spec":"风筝 加厚尼龙 三角款 含线轮 1.2m","unit":"套","price":13,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"户外运动（活动物料）","installation":""},{"id":"OP-108","name":"陀螺","spec":"陀螺 木质传统 拉绳启动 直径8cm","unit":"个","price":13,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"传统游戏（活动物料）","installation":""},{"id":"OP-109","name":"荧光棒","spec":"荧光棒 发光儿童款 多色 100支/包","unit":"包","price":50,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"夜间活动（活动物料）","installation":""},{"id":"OP-110","name":"腰旗橄榄球套装","spec":"腰旗橄榄球套装 腰旗6条+软球1+规则卡 团队款","unit":"套","price":89,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"团队运动（活动物料）","installation":""},{"id":"OP-111","name":"滑板","spec":"滑板 枫木双翘 入门级 含护具套装 8寸","unit":"套","price":76,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"潮流运动（活动物料）","installation":""},{"id":"OP-112","name":"瑜伽球","spec":"瑜伽球 65cm 加厚防爆 含气筒/收纳袋","unit":"个","price":39,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"运动健身（活动物料）","installation":""},{"id":"OP-113","name":"握力器","spec":"握力器 可调节 计数 不锈钢 5-60kg","unit":"个","price":21,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"健身互动（活动物料）","installation":""},{"id":"OP-114","name":"腕力球","spec":"腕力球 自启动 陀螺仪 含防甩绳","unit":"个","price":35,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"健身互动（活动物料）","installation":""},{"id":"OP-115","name":"电子飞镖靶","spec":"电子飞镖靶 磁性软头 含镖6支 自动计分","unit":"套","price":86,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"竞技游戏（活动物料）","installation":""},{"id":"OP-116","name":"桌面足球","spec":"桌面足球 台式对战 含小球2 台面型","unit":"套","price":77,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"趣味竞技（活动物料）","installation":""},{"id":"OP-117","name":"沙壶球","spec":"沙壶球 桌面 含球杆2+壶球 木质","unit":"套","price":105,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"趣味竞技（活动物料）","installation":""},{"id":"OP-118","name":"平衡板","spec":"平衡板 木质 平衡训练 防滑 承重120kg","unit":"个","price":60,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"运动健身（活动物料）","installation":""},{"id":"OP-120","name":"拉力器","spec":"拉力器 弹力绳 多档阻力 含握把","unit":"个","price":29,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"健身互动（活动物料）","installation":""},{"id":"OP-121","name":"弹力圈","spec":"弹力圈 乳胶 多档阻力 3条/套","unit":"套","price":33,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"健身互动（活动物料）","installation":""},{"id":"OP-122","name":"旱地冰壶套装","spec":"旱地冰壶套装 仿真冰道 含壶石8 可折叠","unit":"套","price":176,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"趣味竞技（活动物料）","installation":""},{"id":"OP-125","name":"拼图","spec":"拼图 1000片 风景/名画 精装 含图纸","unit":"盒","price":31,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"益智挑战（活动物料）","installation":""},{"id":"OP-126","name":"叠叠高","spec":"叠叠高 实木54块 精装 含骰子","unit":"套","price":43,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"益智挑战（活动物料）","installation":""},{"id":"OP-127","name":"便携麻将","spec":"便携麻将 树脂 折叠棋盘 含骰子 旅行款 144张","unit":"副","price":108,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"棋牌活动（活动物料）","installation":""},{"id":"OP-128","name":"孔明锁","spec":"孔明锁 木质鲁班锁 六根 益智 含解法图","unit":"个","price":35,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"益智挑战（活动物料）","installation":""},{"id":"OP-129","name":"九连环","spec":"九连环 金属 传统益智 含解法图","unit":"个","price":33,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"益智挑战（活动物料）","installation":""},{"id":"OP-130","name":"华容道","spec":"4阶华容道 滑块 木质 经典款 含说明","unit":"个","price":44.2,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"益智挑战（活动物料）","installation":""},{"id":"OP-131","name":"大话骰盅","spec":"大话骰盅 树脂 5骰+骰盅 含杯","unit":"套","price":5,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"桌游互动（活动物料）","installation":""},{"id":"OP-132","name":"你画我猜卡","spec":"你画我猜卡 防水词卡 200张 双面 含笔板","unit":"套","price":60,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"破冰互动（活动物料）","installation":""},{"id":"OP-133","name":"猜歌名卡","spec":"猜歌名卡 防水曲目卡 蓝牙播放 含音箱（100张）","unit":"套","price":41,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"音乐互动（活动物料）","installation":""},{"id":"OP-134","name":"词语接龙卡","spec":"词语接龙卡 防水词库卡 200张","unit":"套","price":32,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"语言游戏（活动物料）","installation":""},{"id":"OP-135","name":"多米诺骨牌","spec":"多米诺骨牌 木质 1000片 含摆推器","unit":"套","price":120,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"益智挑战（活动物料）","installation":""},{"id":"OP-136","name":"磁力片","spec":"磁力片 100片 益智拼搭 含卡片 兼容款","unit":"套","price":72,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"亲子搭建（活动物料）","installation":""},{"id":"OP-137","name":"3D立体拼图","spec":"3D立体拼图 纸质建筑模型 含胶水 尺寸30cm+","unit":"套","price":68.875,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"亲子手工（活动物料）","installation":""},{"id":"OP-138","name":"数字油画","spec":"数字油画 40x50cm 含画笔/颜料/画框","unit":"套","price":31,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"绘画活动（活动物料）","installation":""},{"id":"OP-139","name":"沙画套装","spec":"沙画套装 彩色沙 10色 含画框3幅","unit":"套","price":87.12,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"亲子手工（活动物料）","installation":""},{"id":"OP-140","name":"羊毛毡材料包","spec":"羊毛毡材料包 基础戳戳乐 含针/垫 10款","unit":"套","price":35,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"手工DIY（活动物料）","installation":""},{"id":"OP-141","name":"钻石画","spec":"钻石画 满钻 30x40cm 含点钻笔/胶盘","unit":"套","price":36,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"手工DIY（活动物料）","installation":""},{"id":"OP-142","name":"儿童显微镜","spec":"儿童显微镜 100-1200倍 含标本片 便携","unit":"个","price":56,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"科学探索（活动物料）","installation":""},{"id":"OP-143","name":"儿童望远镜","spec":"儿童望远镜 8x21 橡胶目镜 防摔","unit":"个","price":110,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"户外探索（活动物料）","installation":""},{"id":"OP-144","name":"发光地球仪","spec":"发光地球仪 LED触控 中英双语 直径25cm","unit":"个","price":183,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"科普教育（活动物料）","installation":""},{"id":"OP-145","name":"STEM科学实验套装","spec":"STEM科学实验套装 物理化学 安全材料 30+实验","unit":"套","price":133,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"科学探索（活动物料）","installation":""},{"id":"OP-146","name":"蒙眼贴鼻子套装","spec":"蒙眼贴鼻子套装 加厚纸板 含眼罩+鼻子贴 90cm","unit":"套","price":31,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"互动游戏（活动物料）","installation":""},{"id":"OP-148","name":"桌面抓娃娃机","spec":"桌面抓娃娃机 迷你电动 含公仔10 充电款","unit":"个","price":120,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"趣味互动（活动物料）","installation":""},{"id":"OP-149","name":"解压捏捏乐","spec":"解压捏捏乐 TPR慢回弹 多造型 12个/盒","unit":"盒","price":44,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"解压互动（活动物料）","installation":""},{"id":"OP-150","name":"指尖陀螺","spec":"指尖陀螺 金属 轴承 减压 含指套","unit":"个","price":17,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"解压互动（活动物料）","installation":""},{"id":"OP-152","name":"糖果类（含口香糖）","spec":"硬糖/棒棒糖/棉花糖/口香糖 混合口味 袋装（500g/袋）","unit":"袋","price":24,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"茶歇零食（活动物料）","installation":""},{"id":"OP-153","name":"巧克力/能量食品","spec":"巧克力/能量棒 独立包装 混装（500g/袋）","unit":"袋","price":27,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"茶歇零食（活动物料）","installation":""},{"id":"OP-154","name":"饼干/糕点","spec":"夹心饼干/派/苏打饼干/沙琪玛 多口味混装（约20小包）500g/袋","unit":"袋","price":19,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"茶歇零食（活动物料）","installation":""},{"id":"OP-155","name":"膨化食品","spec":"薯片/米饼/爆米花 多味混装（5~6g/包）50包/袋","unit":"袋","price":27,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"茶歇零食（活动物料）","installation":""},{"id":"OP-156","name":"坚果炒货","spec":"瓜子/每日坚果 独立小包（20g*12包）/袋","unit":"袋","price":36,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"茶歇零食（活动物料）","installation":""},{"id":"OP-157","name":"蜜饯果干","spec":"话梅 九制/西梅/雪梅 多口味散装 500g/袋","unit":"袋","price":26,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"茶歇零食（活动物料）","installation":""},{"id":"OP-158","name":"海苔","spec":"海苔 原味/芝麻/坚果 多味混装（1.5g/包）24包/袋","unit":"袋","price":33,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"茶歇零食（活动物料）","installation":""},{"id":"OP-159","name":"辣条","spec":"辣条 大面筋/亲嘴烧/小面筋 混装 1000g/袋","unit":"袋","price":34,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"茶歇零食（活动物料）","installation":""},{"id":"OP-160","name":"果冻","spec":"吸吸果冻 混合口味 30支/箱","unit":"支","price":16,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"儿童零食（活动物料）","installation":""},{"id":"OP-161","name":"零食大礼包","spec":"综合混装 1000g/箱","unit":"箱","price":89,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"茶歇零食（活动物料）","installation":""},{"id":"OP-162","name":"碳酸饮料（可乐）","spec":"可乐 330ml罐装 经典/无糖 混装","unit":"罐","price":3,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"活动饮品（活动物料）","installation":""},{"id":"OP-163","name":"气泡水","spec":"气泡水 480ml瓶装 白桃/青瓜/白草莓 混装","unit":"瓶","price":4.5,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"活动饮品（活动物料）","installation":""},{"id":"OP-164","name":"茶饮料","spec":"柠檬茶/红茶/无糖茶 瓶装 混装","unit":"瓶","price":5,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"活动饮品（活动物料）","installation":""},{"id":"OP-165","name":"凉茶","spec":"凉茶 310ml罐装","unit":"罐","price":3,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"活动饮品（活动物料）","installation":""},{"id":"OP-166","name":"椰子饮品","spec":"植物蛋白椰汁 245ml罐装","unit":"罐","price":5,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"活动饮品（活动物料）","installation":""},{"id":"OP-167","name":"乳饮料","spec":"复原乳/调制乳 盒装","unit":"盒","price":2.5,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"儿童活动饮品（活动物料）","installation":""},{"id":"OP-168","name":"饮用水","spec":"天然水 550ml×24瓶/箱","unit":"瓶","price":1.5,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"活动用水（活动物料）","installation":""},{"id":"OP-169","name":"功能/运动饮料","spec":"能量/电解质/运动饮料 罐装瓶装 混装","unit":"瓶","price":5,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"能量补给（活动物料）","installation":""},{"id":"OP-170","name":"毛绒公仔","spec":"中号 软体 多款","unit":"个","price":42,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"亲子互动（活动物料）","installation":""},{"id":"OP-173","name":"热缩片材料包","spec":"透明热缩片 含画笔/烤箱纸 DIY","unit":"套","price":105,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"手工DIY（活动物料）","installation":""},{"id":"OP-175","name":"蜡烛DIY套件","spec":"果冻蜡/香薰蜡 含模具","unit":"套","price":49,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"手工DIY（活动物料）","installation":""},{"id":"OP-176","name":"干花材料包","spec":"压花/干花 书签制作","unit":"套","price":43,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"手工DIY（活动物料）","installation":""},{"id":"OP-177","name":"剪纸材料包","spec":"红色宣纸 含图样/剪刀","unit":"套","price":25,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"传统手工（活动物料）","installation":""},{"id":"OP-178","name":"衍纸材料包","spec":"彩色纸条 含卷纸笔","unit":"套","price":20,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"手工DIY（活动物料）","installation":""},{"id":"OP-179","name":"不织布材料包","spec":"贴画/挂件 含针线","unit":"套","price":57,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"手工DIY（活动物料）","installation":""},{"id":"OP-180","name":"手账材料包","spec":"贴纸/胶带/印章 混装","unit":"套","price":21,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"手工DIY（活动物料）","installation":""},{"id":"OP-181","name":"木质拼装","spec":"拼装小车/模型 木工DIY","unit":"套","price":18,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"手工DIY（活动物料）","installation":""},{"id":"OP-182","name":"扎染材料包","spec":"染料/白布/皮筋 传统","unit":"套","price":44,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"传统手工（活动物料）","installation":""},{"id":"OP-183","name":"军棋","spec":"磁性 折叠棋盘 实木棋子","unit":"副","price":40,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"棋牌活动（活动物料）","installation":""},{"id":"OP-184","name":"国际象棋","spec":"磁性 折叠 实木","unit":"副","price":41,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"棋牌活动（活动物料）","installation":""},{"id":"OP-185","name":"数独","spec":"磁性 便携 含题卡","unit":"套","price":50,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"益智挑战（活动物料）","installation":""},{"id":"OP-186","name":"七巧板","spec":"木质 经典 益智","unit":"套","price":8,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"益智挑战（活动物料）","installation":""},{"id":"OP-187","name":"汉诺塔","spec":"木质 益智 含解法","unit":"套","price":40,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"益智挑战（活动物料）","installation":""},{"id":"OP-188","name":"金字塔魔方","spec":"四阶 磁力 比赛级","unit":"个","price":45,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"益智挑战（活动物料）","installation":""},{"id":"OP-189","name":"桥牌","spec":"标准版 含计分卡","unit":"副","price":19,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"棋牌活动（活动物料）","installation":""},{"id":"OP-190","name":"无线话筒","spec":"便携 扩音 UHF 双麦","unit":"套","price":117,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"活动音响（活动物料）","installation":""},{"id":"OP-191","name":"书法套装","spec":"文房四宝 毛笔/墨/砚/水写布","unit":"套","price":40,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"才艺文化（活动物料）","installation":""},{"id":"OP-192","name":"宣纸","spec":"生宣 四尺 一刀100张","unit":"刀","price":24,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"才艺文化（活动物料）","installation":""},{"id":"OP-193","name":"彩旗/三角旗","spec":"10m 成串 多色","unit":"串","price":8,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"节日氛围（活动物料）","installation":""},{"id":"OP-194","name":"拉花/彩带","spec":"装饰 多色 成卷 90m/卷","unit":"卷","price":18,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"节日氛围（活动物料）","installation":""},{"id":"OP-196","name":"拍照道具","spec":"相框/眼镜/ins牌 打卡","unit":"套","price":25,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"拍照打卡（活动物料）","installation":""},{"id":"OP-197","name":"LED灯串","spec":"10m 电池款 暖光 防水","unit":"串","price":24,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"氛围布置（活动物料）","installation":""},{"id":"OP-198","name":"一次性纸杯","spec":"加厚 中号 100只/包","unit":"包","price":22,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"活动后勤（活动物料）","installation":""},{"id":"OP-199","name":"折叠椅","spec":"户外 铝合金 便携 承重150kg","unit":"把","price":87,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"户外露营（活动物料）","installation":""},{"id":"OP-200","name":"折叠桌","spec":"铝合金 便携 120cm","unit":"张","price":117,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"户外露营（活动物料）","installation":""},{"id":"OP-201","name":"野餐垫","spec":"加厚 防潮 2m×2m","unit":"张","price":46,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"户外露营（活动物料）","installation":""},{"id":"OP-202","name":"天幕/遮阳棚","spec":"3m×3m 防晒防雨","unit":"顶","price":110,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"户外露营（活动物料）","installation":""},{"id":"OP-203","name":"一次性桌布","spec":"加厚 大号 防水\n适配长120*宽60cm长桌 10只/包","unit":"包","price":13,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"活动后勤（活动物料）","installation":""},{"id":"OP-204","name":"帆布袋","spec":"活动定制 棉麻 手提\n宽约35cm高约38cm","unit":"个","price":18,"supplier":"运营物资供应商（演示）","category":"活动及社群物资","demoOnly":false,"note":"活动伴手（活动物料）","installation":""},{"id":"OP-205","name":"活性炭包","spec":"6kg装、高效除甲醛除异味、可晾晒重复使用","unit":"盒","price":47,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"租户居住体验提升","installation":""},{"id":"OP-206","name":"杀虫剂喷雾","spec":"500ml、无香型、广谱杀虫（蟑螂/蚂蚁/蚊蝇）","unit":"瓶","price":20,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"租户居住体验提升","installation":""},{"id":"OP-207","name":"杀蟑饵剂","spec":"8个装、连锁灭蟑、胶饵诱杀、长效防潮","unit":"包","price":23,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"租户居住体验提升","installation":""},{"id":"OP-208","name":"地漏过滤网","spec":"50片装、一次性粘贴式、细密网格防堵","unit":"包","price":8,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"租户居住体验提升","installation":""},{"id":"OP-209","name":"桌椅静音脚套保护套","spec":"16个装、方圆通用款、加厚硅胶/毛毡材质、防滑耐磨、静音防刮、适用桌椅沙发脚","unit":"份","price":7,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"租户居住体验提升。可以隔音，提供给上下楼或隔壁因噪音投诉的租户","installation":""},{"id":"OP-210","name":"挡水条","spec":"20mm厚*30mm宽*1米长、加厚实心橡胶/PVC、可裁剪、防霉防滑、免打孔安装","unit":"份","price":12.8,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"卫生间狭小，水流容易外溢，挡水条可以加在卫生间门口挡水","installation":""},{"id":"OP-211","name":"公寓的防撞条","spec":"L型二代加厚款、米色15mm厚、4米/卷、免贴胶自粘","unit":"份","price":14,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"安全防护提示","installation":""},{"id":"OP-212","name":"吸音棉","spec":"110型、2cm厚×1米宽、自粘式、环保阻燃、隔音降噪","unit":"份","price":19,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"隔音处理","installation":""},{"id":"OP-213","name":"雪糕筒","spec":"高650mm、宽310mm、橡胶/塑料材质、带反光条","unit":"个","price":19,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"临时隔离或警示","installation":""},{"id":"OP-214","name":"防摔蚊帐","spec":"1.5m床适用（150×200cm）、全包围防摔、U型拉链门","unit":"份","price":191,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"租户居住体验提升","installation":""},{"id":"OP-215","name":"沙发布","spec":"180*260cm、四季通用、A类面料、可机洗","unit":"条","price":80,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"租户居住体验提升。用于退租后的轻微破损沙发遮盖","installation":""},{"id":"OP-216","name":"空调挡板","spec":"挂机通用、无孔一体式安装、可调节风向、防直吹","unit":"件","price":27,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"客房装饰或功能性用品","installation":""},{"id":"OP-217","name":"折叠平板手推车","spec":"90×60cm、承重900斤、折叠便携","unit":"台","price":179,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"租户居住体验提升","installation":""},{"id":"OP-218","name":"应急药品箱","spec":"急救包套装（含全套常用药品及器械）、家用医疗标准配置，12种急救用品组合","unit":"个","price":77,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"安全应急","installation":""},{"id":"OP-219","name":"钥匙箱","spec":"24位铝合金钥匙箱、带锁壁挂式、透明视窗","unit":"个","price":50,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"钥匙管理","installation":""},{"id":"OP-220","name":"入户地垫","spec":"深灰色、120×240cm、PVC/橡胶底防滑、耐磨除尘","unit":"份","price":232,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"公共区域清洁","installation":""},{"id":"OP-221","name":"除胶剂","spec":"强力去胶通用型、除不干胶/标签残胶、开荒保洁专用，450ml","unit":"瓶","price":17.7,"supplier":"运营物资供应商（演示）","category":"日常运营耗材","demoOnly":false,"note":"清洁维护","installation":""},{"id":"AD-001","name":"户外喷绘布","spec":"530g/㎡ 户外喷绘布（“530”为克重），720dpi 高清喷绘","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-002","name":"灯箱画面","spec":"高清软膜灯箱布，1440dpi（布基灯箱片，不含型材/光源）","unit":"㎡","price":180,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-003","name":"刀刮布","spec":"户外防水刀刮布，1440dpi","unit":"㎡","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-004","name":"网格布","spec":"户外网格喷绘布","unit":"㎡","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-005","name":"室内写真背胶","spec":"高清写真背胶，1440dpi","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-006","name":"户外写真背胶","spec":"户外防水写真背胶，1440dpi","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-007","name":"可移车贴","spec":"户外可移车贴，1440dpi","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-008","name":"单透贴","spec":"单向透视贴，1440dpi","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-009","name":"透明贴","spec":"PET透明膜彩印（基材PET，厚度0.1–0.15mm）","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-010","name":"磨砂玻璃贴","spec":"磨砂膜刻绘","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-011","name":"专用防滑地贴","spec":"地面专用防滑耐磨地贴膜＋UV彩印，适用于室内平整地面","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-012","name":"UV软膜","spec":"UV写真软膜，1440dpi（软膜基材，不含型材/光源）","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-013","name":"自动扶梯侧板广告贴","spec":"户外耐磨可移除PVC广告膜＋高清写真覆保护膜（建议注明标准尺寸区间，如高×宽）","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"含常规现场安装"},{"id":"AD-014","name":"KT板写真展板","spec":"5mm KT板＋单面写真","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-015","name":"PVC写真标牌","spec":"5mm PVC发泡板＋单面写真","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-016","name":"PVC双面指示牌","spec":"5mm PVC板＋双面写真","unit":"㎡","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-017","name":"UV直喷PVC板","spec":"5mm PVC板UV平板喷印","unit":"㎡","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-018","name":"亚克力标牌","spec":"5mm亚克力板UV直喷（明确工艺，取消“或贴画”）","unit":"㎡","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-019","name":"房源招租展示牌","spec":"5mm PVC发泡板＋高清写真，60×90cm","unit":"块","price":90,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-020","name":"易拉宝","spec":"80×200cm，铝合金架＋写真画面","unit":"套","price":90,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-021","name":"丽屏展架","spec":"80×180cm，铝合金立式展示框，含PP写真画面","unit":"套","price":90,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-022","name":"人字板（A字展架）","spec":"60×90cm，铝合金折叠架＋双面5mm PVC广告画面","unit":"套","price":90,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-023","name":"拉网展架","spec":"3×2.3m，金属架＋写真画面","unit":"套","price":90,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"含常规现场安装"},{"id":"AD-024","name":"立式展示牌","spec":"A3，画面＋支架","unit":"个","price":90,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-025","name":"桌面台卡","spec":"A4，透明台卡","unit":"个","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-026","name":"条幅横幅","spec":"常规红布/喷绘横幅","unit":"米","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-027","name":"吊旗","spec":"写真画面＋上下杆，约1.5×0.6m","unit":"套","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-028","name":"电梯地毯","spec":"5mm（±0.5）阻燃耐磨圈绒毯面＋防滑底背，四周包边，按轿厢尺寸裁切（典型轿厢1.4×1.4–1.6×1.6m，需注明）","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-029","name":"宣传单页","spec":"A4，128g铜版纸，双面彩印","unit":"张","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-030","name":"DM折页","spec":"A4，157g铜版纸，双面彩印、折页","unit":"份","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-031","name":"宣传折页手册","spec":"成品尺寸10×21cm（展开尺寸另注），157g铜版纸，6折页双面彩印","unit":"份","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-032","name":"不干胶贴纸","spec":"不干胶彩印（建议按㎡计价；或注明常用尺寸如10×10cm、最大尺寸A3）","unit":"张","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-033","name":"纸质宣传吊牌","spec":"28×13cm，240g铜版纸彩印","unit":"张","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-034","name":"POP展示卡","spec":"62.5×42.8cm，300g铜版纸彩印","unit":"张","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-035","name":"纸质海报","spec":"A2，200g铜版纸，单面彩印","unit":"张","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-036","name":"房源信息展示卡","spec":"A5，250g铜版纸，双面彩印","unit":"张","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-037","name":"租客服务联系卡","spec":"90×54mm，300g铜版纸，双面彩印（企业微信二维码位）","unit":"张","price":15,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-038","name":"入住指引卡","spec":"A5，200g铜版纸，双面彩印","unit":"张","price":15,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-039","name":"邀请函/贺卡","spec":"A5，250g铜版纸，双面彩印、压痕对折","unit":"张","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-040","name":"证书/聘书（含封套）","spec":"A4，绒面证书封套＋200g内页彩印","unit":"套","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-041","name":"手提宣传袋","spec":"250g白卡纸，四色印刷，30×40×8cm","unit":"个","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-042","name":"员工工卡","spec":"标准IC卡尺寸85.6×54mm，0.76mm白色PVC卡，双面彩色印刷（姓名、照片等）","unit":"张","price":15,"supplier":"广告印刷供应商（待确认）","category":"员工物资","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-043","name":"工卡挂绳","spec":"15mm涤纶织带，双面热转印品牌标识，安全脱扣","unit":"套","price":15,"supplier":"广告印刷供应商（待确认）","category":"员工物资","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-044","name":"锦旗","spec":"80×120cm，绒布（明确材质，去掉“或棉布”），印制文字及流苏","unit":"条","price":65,"supplier":"广告印刷供应商（待确认）","category":"活动及社群物资","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-045","name":"活动抽奖箱","spec":"35×35×35cm，5mm PVC板彩色裱画，顶部投入口","unit":"个","price":65,"supplier":"广告印刷供应商（待确认）","category":"活动及社群物资","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-046","name":"活动抽奖转盘","spec":"直径60cm（±2），金属支架＋PVC印刷转盘","unit":"套","price":65,"supplier":"广告印刷供应商（待确认）","category":"活动及社群物资","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-047","name":"金属奖牌","spec":"直径约6cm，合金材质，定制图文，含挂带","unit":"个","price":65,"supplier":"广告印刷供应商（待确认）","category":"活动及社群物资","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-048","name":"奖杯","spec":"高度25cm（±1），树脂/水晶组合奖杯，含刻字牌","unit":"个","price":65,"supplier":"广告印刷供应商（待确认）","category":"活动及社群物资","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-049","name":"活动侧旗/刀旗","spec":"50×180cm，经编涤纶旗帜布双面热转印（注明布料），含3m金属立杆及底座","unit":"套","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-050","name":"活动折叠帐篷","spec":"3×3m，铝合金骨架＋防水牛津布顶棚，品牌单色印制","unit":"套","price":90,"supplier":"广告印刷供应商（待确认）","category":"活动及社群物资","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-051","name":"活动桌布","spec":"180×140cm（±2），涤纶布（注明克重如210g）热转印品牌标识","unit":"块","price":35,"supplier":"广告印刷供应商（待确认）","category":"活动及社群物资","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-052","name":"桁架租赁（含搭拆）","spec":"铝合金桁架背景架（含搭拆），按套/米计价，避免与序号63–65安装服务重复","unit":"㎡","price":120,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"含现场搭建及拆除"},{"id":"AD-053","name":"定制纸巾盒","spec":"18×12×9.5cm、ABS盒体＋木纹饰面顶盖、正面印制品牌LOGO","unit":"个","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-054","name":"卡布灯箱（含光源）","spec":"铝型材6–8cm箱体、LED光源（注明色温/防水等级）＋UV软膜画面（整箱含光源）","unit":"㎡","price":180,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"含常规现场安装"},{"id":"AD-055","name":"桌面海报展示架","spec":"A4，透明亚克力插页式台牌，3mm厚","unit":"个","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"仅送货上门，不含安装"},{"id":"AD-056","name":"室内挂画框","spec":"A2，铝合金边框＋透明保护面板，壁挂式","unit":"套","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"含常规现场安装"},{"id":"AD-057","name":"壁挂式公告栏","spec":"铝合金边框＋磁性展示背板＋透明保护面板，90×120cm（±2）","unit":"套","price":180,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"含常规现场安装"},{"id":"AD-058","name":"车库悬挂式导向吊牌","spec":"3mm铝塑板双面UV画面＋金属吊挂件（建议标注标准尺寸如90×120cm，单位与56/58统一）","unit":"㎡","price":180,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"含常规现场安装"},{"id":"AD-059","name":"温馨提示牌","spec":"3mm PVC板＋UV彩印，20×30cm","unit":"块","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"含常规现场安装"},{"id":"AD-060","name":"车库反光导视牌","spec":"1.5mm铝板＋工程级反光膜，40×60cm（±2）","unit":"块","price":35,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"含常规现场安装"},{"id":"AD-061","name":"不锈钢标识牌","spec":"30×20cm，1mm拉丝不锈钢蚀刻填色","unit":"块","price":180,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"含常规现场安装"},{"id":"AD-062","name":"门店品牌发光字","spec":"304不锈钢围边＋亚克力面板＋LED光源（注明色温/防水等级），字高30cm（±2，或给范围20–40cm）","unit":"字","price":180,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"含常规现场安装"},{"id":"AD-063","name":"车库反光贴","spec":"工程级反光膜，UV打印、模切（建议注明常用宽度如10/15cm或按㎡）","unit":"㎡","price":45,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":"含常规现场安装"},{"id":"AD-064","name":"普通安装","spec":"平面物料常规现场张贴及安装","unit":"㎡","price":120,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":""},{"id":"AD-065","name":"高空作业设备","spec":"吊车/升降平台租赁","unit":"天","price":120,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":""},{"id":"AD-066","name":"高空安装人工","spec":"具备高空资质的安装人员","unit":"人/天","price":120,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":""},{"id":"AD-067","name":"现场拆除/维护","spec":"原有广告物料拆除、修复","unit":"㎡","price":120,"supplier":"广告印刷供应商（待确认）","category":"宣传印刷物料","demoOnly":true,"note":"","installation":""}];
const STORES=["安居瑞龙苑店","萃云阁店","大浪元芬店","凤凰红坳公园店","荟智苑店","龙华弓村清湖店","民治白石龙店","民治红山店","青年人才｜华章新筑","青年人才|鸣鹿苑南苑","青年人才|颐瑞府","青年人才|颐樾府店","青年人才|阅山境花园","石岩罗租桥头岭店","石岩罗租上新店","石岩罗租社区店","石岩罗租中新店","石岩应人石店","中海寰宇时代店","福厦里店","福永村店","福永福围广生店","福永福围西街店","福永怀德店","福永马山小区店","福永兴围店","机场东店","新桥洪田店","航城宝罗店","航城鹤洲南店","青年人才|产业基地","青年人才|电力花园","青年人才|高新花园","青年人才|鸿栖台","青年人才|科技生态园","青年人才|龙海家园","青年人才|瑞樾府","青年人才|未来之光","深圳湾科技生态园店","未来之光店","西乡流塘店","西乡麻布店","西乡永丰店","新安翻身店","未来之光店7月15后","航城鹤洲东店","福海和平店","福海桥头店","福海塘尾东店","福海塘尾西店","福海新和东店","福海新和西店","机场北店","明汇府店","沙井后亭店","松岗东方店","青年人才|学府朗园","地勘大院店","华强北二店","华强北一店","莲花景田店","岭舍店","梅林店","上沙龙秋店","上沙沙嘴店","上沙塘晏店","石厦新洲店","青年人才|梅山苑二期","青年人才|深康村","坂田岗头店","坂田马蹄山店","布吉大芬店","瀚龙苑店","黄贝岭店","锦龙苑店","精茂花园店","莲塘仙湖店","坪山大万新村店","青年人才|鹏瑞尚府","深南广场店","笋岗店","禧龙苑店","远洋新干线店","招商开元店","青年人才|深南广场店","青年人才|静安府","御龙苑店","青年人才|禧龙苑店","青年人才|招商开元店","青年人才|华章新筑","青年人才|宝龙嘉园"];
const CATEGORY_ORDER=['奖品礼品','活动及社群物资','日常运营耗材','宣传印刷物料','员工物资'];
const CATEGORY_META={
  '奖品礼品':{icon:'🏆',desc:'奖杯、奖牌、锦旗与抽奖物资'},
  '活动及社群物资':{icon:'🎉',desc:'门店活动、社群互动与现场布置'},
  '日常运营耗材':{icon:'🧰',desc:'保洁维护、维修与便民耗材'},
  '宣传印刷物料':{icon:'🖨️',desc:'海报、展架、公告栏、导视标识'},
  '员工物资':{icon:'🪪',desc:'工卡、挂绳与员工形象物料'}
};
const STORE_ZONES={'安居瑞龙苑店':'第一战区','萃云阁店':'第一战区','福海和平店':'第二战区','福海桥头店':'第二战区'};
const zoneOf=(store)=>STORE_ZONES[store]||'';
module.exports={CATALOG,STORES,CATEGORY_ORDER,CATEGORY_META,STORE_ZONES,zoneOf};

});

__def("data/seed", function (module, exports, require) {
// 演示初始数据：由 data/purchase-demo.sqlite 导出（全部为虚构测试数据）
const SEED_STATE={"budget":5000,"flex":20000,"baseUsed":1800,"orders":[{"store":"安居瑞龙苑店","zone":"第一战区","manager":"测试店长 A（管理2店）","id":"SQ-0012","items":[{"id":"AD-048","name":"奖杯","price":65,"supplier":"广告印刷供应商（待确认）","priceType":"原清单未提供价格；系统仅为流程测试设置的虚构演示价（非合同价）","enabled":true,"contractRef":"","expiresOn":"","configNote":"","demoOnly":true,"qty":2,"accepted":0,"reconciled":0}],"total":130,"tier":"auto","overPending":false,"overAmount":0,"regionApproved":false,"centralApproved":false,"budgetApproved":true,"status":"supplier","purpose":"门店日常运营","address":"门店收货地址待完善（模拟）","receiver":"门店授权收货人","due":"待供应商确认","note":"","created":"2026/11/18 16:16:28","createdAt":"2026-11-18T08:16:28.535Z","supplierSentAt":"2026-11-18T08:16:28.535Z","stageStartedAt":"2026-11-18T08:16:28.535Z","supplierRecords":{"广告印刷供应商（待确认）":{"status":"pending","delivered":false}},"budgetApplied":false,"quoteSource":"backend-atomic-demo-v1.10","submittedBy":"TEST-STORE-A"},{"id":"SQ-0011","purchaseType":"department","department":"人力资源部","groupId":"DP-20261118034037-11","receivingType":"office","store":"公司总部","zone":"总部","manager":"部门测试采购员：人力资源部","submittedBy":"TEST-DEPT-09","items":[{"id":"AD-057","name":"壁挂式公告栏","price":180,"supplier":"广告印刷供应商（待确认）","priceType":"原清单未提供价格；系统仅为流程测试设置的虚构演示价（非合同价）","enabled":true,"contractRef":"","expiresOn":"","configNote":"","demoOnly":true,"qty":3,"accepted":0,"reconciled":0,"deliveredQty":3},{"id":"AD-020","name":"易拉宝","price":90,"supplier":"广告印刷供应商（待确认）","priceType":"原清单未提供价格；系统仅为流程测试设置的虚构演示价（非合同价）","enabled":true,"contractRef":"","expiresOn":"","configNote":"","demoOnly":true,"qty":1,"accepted":0,"reconciled":0,"deliveredQty":1}],"total":630,"tier":"department","overPending":false,"overAmount":0,"regionApproved":false,"centralApproved":true,"budgetApproved":true,"status":"delivering","purpose":"部门日常运营物资采购","address":"测试收货地址待完善","receiver":"部门收货人（测试）","due":"待供应商确认","note":"","created":"2026/11/18 11:40:37","supplierRecords":{"广告印刷供应商（待确认）":{"status":"shipping","delivered":false,"confirmedAt":"2026-11-18T03:41:09.437Z","confirmedBy":"TEST-SUPPLIER-AUTO-2","deliveries":[{"batchNo":1,"lines":[{"id":"AD-057","name":"壁挂式公告栏","qty":3},{"id":"AD-020","name":"易拉宝","qty":1}],"note":"1","shipping":{"method":"self","carrier":"","trackingNo":"","contact":"1","vehicleNo":"","estimatedAt":""},"at":"2026-11-18T03:41:25.107Z","by":"TEST-SUPPLIER-AUTO-2"}],"shippedAt":"2026-11-18T03:41:25.107Z"}},"budgetApplied":false,"quoteSource":"department-demo-v1.23","confirmedAt":"2026-11-18T03:40:53.415Z"},{"store":"安居瑞龙苑店","zone":"第一战区","manager":"测试店长 A（管理2店）","id":"SQ-0010","items":[{"id":"AD-006","name":"户外写真背胶","price":45,"supplier":"广告印刷供应商（待确认）","priceType":"原清单未提供价格；系统仅为流程测试设置的虚构演示价（非合同价）","enabled":true,"contractRef":"","expiresOn":"","configNote":"","demoOnly":true,"qty":1,"accepted":0,"reconciled":0}],"total":45,"tier":"auto","overPending":false,"overAmount":0,"regionApproved":false,"centralApproved":false,"budgetApproved":true,"status":"preparing","purpose":"门店日常运营","address":"门店收货地址待完善（模拟）","receiver":"门店授权收货人","due":"待供应商确认","note":"","created":"2026/11/18 01:27:27","supplierRecords":{"广告印刷供应商（待确认）":{"status":"confirmed","delivered":false,"confirmedAt":"2026-11-18T02:41:17.037Z","confirmedBy":"TEST-SUPPLIER-AUTO-2"}},"budgetApplied":false,"quoteSource":"backend-atomic-demo-v1.10","submittedBy":"TEST-STORE-A"},{"store":"福海和平店","zone":"第二战区","manager":"测试店长 B（管理2店）","id":"SQ-0009","items":[{"id":"OP-011","name":"蓝牙音箱","price":223,"supplier":"运营物资供应商（演示）","enabled":true,"contractRef":"","expiresOn":"","configNote":"","demoOnly":false,"qty":2,"accepted":0,"reconciled":0,"deliveredQty":1}],"total":446,"tier":"auto","overPending":false,"overAmount":0,"regionApproved":false,"centralApproved":false,"budgetApproved":true,"status":"delivering","purpose":"门店日常运营","address":"门店收货地址待完善（模拟）","receiver":"门店授权收货人","due":"待供应商确认","note":"","created":"2026/11/18 01:26:09","supplierRecords":{"运营物资供应商（演示）":{"status":"confirmed","delivered":false,"confirmedAt":"2026-11-17T17:51:07.795Z","confirmedBy":"TEST-SUPPLIER","deliveries":[{"batchNo":1,"lines":[{"id":"OP-011","name":"蓝牙音箱","qty":1}],"note":"模拟分批送达","at":"2026-11-17T17:51:45.129Z","by":"TEST-SUPPLIER"}]}},"budgetApplied":false,"quoteSource":"backend-atomic-demo-v1.10","submittedBy":"TEST-STORE-B"},{"store":"安居瑞龙苑店","zone":"第一战区","manager":"测试店长 A（管理2店）","id":"SQ-0008","items":[{"id":"OP-014","name":"吹风机","price":112,"supplier":"运营物资供应商（演示）","enabled":true,"contractRef":"","expiresOn":"","configNote":"","demoOnly":false,"qty":2,"accepted":0,"reconciled":0,"deliveredQty":2}],"total":224,"tier":"auto","overPending":false,"overAmount":0,"regionApproved":false,"centralApproved":false,"budgetApproved":true,"status":"delivering","purpose":"门店日常运营","address":"门店收货地址待完善（模拟）","receiver":"门店授权收货人","due":"待供应商确认","note":"","created":"2026/11/18 01:25:53","supplierRecords":{"运营物资供应商（演示）":{"status":"shipping","delivered":false,"confirmedAt":"2026-11-18T02:50:17.040Z","confirmedBy":"TEST-SUPPLIER","deliveries":[{"batchNo":1,"lines":[{"id":"OP-014","name":"吹风机","qty":2}],"note":"","shipping":{"method":"express","carrier":"圆通速递","trackingNo":"sf202020200202","contact":"","vehicleNo":"","estimatedAt":"2026-11-18T10:50"},"at":"2026-11-18T02:50:57.652Z","by":"TEST-SUPPLIER"}],"shippedAt":"2026-11-18T02:50:57.652Z"}},"budgetApplied":false,"quoteSource":"backend-atomic-demo-v1.10","submittedBy":"TEST-STORE-A"},{"store":"安居瑞龙苑店","zone":"第一战区","manager":"测试店长 A（管理2店）","id":"SQ-0007","items":[{"id":"OP-003","name":"保温杯","price":62,"supplier":"运营物资供应商（演示）","enabled":true,"contractRef":"","expiresOn":"","configNote":"","qty":1,"accepted":0,"reconciled":0}],"total":62,"tier":"auto","overPending":false,"overAmount":0,"regionApproved":false,"centralApproved":false,"budgetApproved":true,"status":"supplier","purpose":"门店日常运营","address":"门店收货地址待完善（模拟）","receiver":"门店授权收货人","due":"待供应商确认","note":"","created":"2026/11/18 01:20:01","supplierRecords":{"运营物资供应商（演示）":{"status":"pending","delivered":false}},"budgetApplied":false,"quoteSource":"backend-atomic-demo-v1.10","submittedBy":"TEST-STORE-A"},{"store":"安居瑞龙苑店","zone":"第一战区","manager":"测试店长 A（管理2店）","id":"SQ-0006","items":[{"id":"OP-003","name":"保温杯","price":62,"supplier":"运营物资供应商（演示）","enabled":true,"contractRef":"","expiresOn":"","configNote":"","qty":2,"accepted":0,"reconciled":0}],"total":124,"tier":"auto","overPending":false,"overAmount":0,"regionApproved":false,"centralApproved":false,"budgetApproved":true,"status":"supplier","purpose":"门店日常运营","address":"门店收货地址待完善（模拟）","receiver":"门店授权收货人","due":"待供应商确认","note":"","created":"2026/11/18 01:17:11","supplierRecords":{"运营物资供应商（演示）":{"status":"pending","delivered":false}},"budgetApplied":false,"quoteSource":"backend-atomic-demo-v1.10","submittedBy":"TEST-STORE-A"},{"store":"安居瑞龙苑店","zone":"第一战区","manager":"测试店长 A（管理2店）","id":"SQ-0005","items":[{"id":"OP-001","name":"充电宝","price":125,"supplier":"运营物资供应商（演示）","enabled":true,"contractRef":"","expiresOn":"","configNote":"","qty":1,"accepted":0,"reconciled":0}],"total":125,"tier":"auto","overPending":false,"overAmount":0,"regionApproved":false,"centralApproved":false,"budgetApproved":true,"status":"supplier","purpose":"门店日常运营","address":"门店收货地址待完善（模拟）","receiver":"门店授权收货人","due":"待供应商确认","note":"","created":"2026/11/18 01:16:40","supplierRecords":{"运营物资供应商（演示）":{"status":"pending","delivered":false}},"budgetApplied":false,"quoteSource":"backend-atomic-demo-v1.10","submittedBy":"TEST-STORE-A"},{"store":"安居瑞龙苑店","zone":"第一战区","manager":"测试店长 A（管理2店）","id":"SQ-0004","items":[{"id":"OP-205","name":"活性炭包","price":47,"supplier":"运营物资供应商（演示）","qty":3,"accepted":0,"reconciled":0}],"total":141,"tier":"auto","overPending":false,"overAmount":0,"regionApproved":false,"centralApproved":false,"budgetApproved":true,"status":"cancelled","purpose":"门店日常运营","address":"门店收货地址待完善（模拟）","receiver":"门店授权收货人","due":"待供应商确认","note":"","created":"2026/11/18 00:24:20","supplierRecords":{"运营物资供应商（演示）":{"status":"pending","delivered":false}},"budgetApplied":false,"quoteSource":"backend-atomic-demo-v1.10","submittedBy":"TEST-STORE-A","cancelledBy":"TEST-STORE-A","cancelledAt":"2026-11-17T16:24:28.316Z"},{"store":"安居瑞龙苑店","zone":"第一战区","manager":"测试店长","id":"SQ-0003","items":[{"id":"OP-002","name":"暖手宝","category":"奖品类","spec":"PVC材质/绒布、可充电款","unit":"个","price":61,"priceType":"年度估算单价（非合同价）","supplier":"运营物资供应商（演示）","source":"年度运营物资采购估算清单","icon":"▦","note":"活动奖品、培训类奖品","minOrder":500,"qty":1,"accepted":0,"reconciled":0},{"id":"OP-004","name":"晴雨伞","category":"奖品类","spec":"十二骨、三折叠 、晴雨两用","unit":"个","price":44,"priceType":"年度估算单价（非合同价）","supplier":"运营物资供应商（演示）","source":"年度运营物资采购估算清单","icon":"▦","note":"活动奖品、培训类奖品","minOrder":500,"qty":1,"accepted":0,"reconciled":0},{"id":"OP-003","name":"保温杯","category":"奖品类","spec":"500ml、316不锈钢、刻字","unit":"个","price":62,"priceType":"年度估算单价（非合同价）","supplier":"运营物资供应商（演示）","source":"年度运营物资采购估算清单","icon":"▦","note":"活动奖品、培训类奖品","minOrder":500,"qty":2,"accepted":0,"reconciled":0},{"id":"OP-007","name":"颈枕","category":"奖品类","spec":"记忆棉、U型护颈、可拆洗外套、含收纳袋","unit":"个","price":35,"priceType":"年度估算单价（非合同价）","supplier":"运营物资供应商（演示）","source":"年度运营物资采购估算清单","icon":"▦","note":"活动奖品、培训类奖品","minOrder":500,"qty":4,"accepted":0,"reconciled":0},{"id":"OP-008","name":"午睡毯","category":"奖品类","spec":"法兰绒、120×150cm、可机洗、防静电","unit":"条","price":55,"priceType":"年度估算单价（非合同价）","supplier":"运营物资供应商（演示）","source":"年度运营物资采购估算清单","icon":"▦","note":"活动奖品、培训类奖品","minOrder":500,"qty":7,"accepted":0,"reconciled":0}],"total":754,"tier":"region","overPending":false,"overAmount":0,"regionApproved":false,"centralApproved":false,"budgetApproved":true,"status":"supplier","purpose":"门店日常运营","address":"门店收货地址待完善（模拟）","receiver":"门店授权收货人","due":"待供应商确认","note":"","created":"2026/11/18 00:05:43","supplierRecords":{"运营物资供应商（演示）":{"status":"pending","delivered":false}},"budgetApplied":false,"quoteSource":"local-backend-v1.6"},{"store":"安居瑞龙苑店","zone":"第一战区","manager":"测试店长","id":"SQ-0002","items":[{"id":"OP-001","name":"充电宝","category":"奖品类","spec":"20000毫安、快充、AH双线","unit":"个","price":125,"priceType":"年度估算单价（非合同价）","supplier":"运营物资供应商（演示）","source":"年度运营物资采购估算清单","icon":"▦","note":"活动奖品、培训类奖品","minOrder":500,"qty":6,"accepted":0,"reconciled":0}],"total":750,"tier":"region","overPending":false,"overAmount":0,"regionApproved":false,"centralApproved":false,"budgetApproved":true,"status":"supplier","purpose":"门店日常运营","address":"门店收货地址待完善（模拟）","receiver":"门店授权收货人","due":"待供应商确认","note":"","created":"2026/11/17 23:54:46","supplierRecords":{"运营物资供应商（演示）":{"status":"pending","delivered":false}},"budgetApplied":false,"quoteSource":"local-backend-v1.6"},{"store":"安居瑞龙苑店","zone":"第一战区","manager":"杨理韶","id":"SQ-0001","items":[{"id":"OP-001","name":"充电宝","category":"奖品类","spec":"20000毫安、快充、AH双线","unit":"个","price":125,"priceType":"年度估算单价（非合同价）","supplier":"运营物资供应商（演示）","source":"年度运营物资采购估算清单","icon":"▦","note":"活动奖品、培训类奖品","minOrder":500,"qty":2,"accepted":0,"reconciled":0}],"total":250,"tier":"auto","overPending":false,"overAmount":0,"regionApproved":false,"centralApproved":false,"budgetApproved":true,"status":"supplier","purpose":"门店日常运营","address":"门店收货地址待完善（模拟）","receiver":"门店授权收货人","due":"待供应商确认","note":"","created":"2026/11/17 23:49:27","supplierRecords":{"运营物资供应商（演示）":{"status":"pending","delivered":false}},"budgetApplied":false}],"recons":[],"seq":12,"budgetConfig":{"rooms":{"安居瑞龙苑店":1000,"萃云阁店":1000,"福海和平店":1000,"福海桥头店":1000},"coef":{"community":10,"customer":10,"marketing":10},"storeCoef":{},"override":{},"baseUsed":{"安居瑞龙苑店":{"community":800,"customer":600,"marketing":400},"萃云阁店":{"community":800,"customer":600,"marketing":400},"福海和平店":{"community":800,"customer":600,"marketing":400},"福海桥头店":{"community":800,"customer":600,"marketing":400}},"adjust":{}},"revision":1};
const STAFF=[{"id":"TEST-STORE-A","name":"测试店长 A","role":"store","zone":"第一战区","stores":["安居瑞龙苑店","萃云阁店"],"desc":"管理 2 家门店"},{"id":"TEST-STORE-B","name":"测试店长 B","role":"store","zone":"第二战区","stores":["福海和平店","福海桥头店"],"desc":"管理 2 家门店"},{"id":"TEST-REGION-A","name":"第一战区负责人","role":"region","zone":"第一战区","stores":[],"desc":"审批本战区预算与金额"},{"id":"TEST-REGION-B","name":"第二战区负责人","role":"region","zone":"第二战区","stores":[],"desc":"审批本战区预算与金额"},{"id":"TEST-CENTRAL","name":"运营管理部（中台）","role":"central","zone":null,"stores":[],"desc":"预算核定、部门确认、对账"}];
const DEPARTMENTS=["运营管理部","市场运营部","产品研发部","成本采购部","经营发展部","财务管理部","质量安全部","信息技术部","人力资源部","党群工作部（综合管理部）","纪检监察部"];
const SUPPLIERS=["运营物资供应商（演示）","广告印刷供应商（待确认）"];
const SLA_HOURS={approval:4,supplier:4};
module.exports={SEED_STATE,STAFF,DEPARTMENTS,SUPPLIERS,SLA_HOURS};

});

__def("data/subcats", function (module, exports, require) {
// 二级分类（细分目录）：给下单页左侧竖排导航用
// 归类规则：先按 EXPLICIT 精确名称匹配，再按 GROUPS.keywords 顺序命中，最后落到该大类 default 组
// 说明：商品目录来自 V1.24 演示数据，没有二级分类字段，这里用关键词语义归类，新增商品时补关键词即可

const CAT_KEY = {
  '奖品礼品': 'prize',
  '活动及社群物资': 'act',
  '日常运营耗材': 'daily',
  '宣传印刷物料': 'print',
  '员工物资': 'staff'
};

// 每个大类的分组定义（顺序即左侧栏展示顺序，最后一组为兜底组）
const GROUPS = [
  // 奖品礼品
  { cat: '奖品礼品', key: 'digital', label: '数码小电', short: '数码小电',
    keywords: ['充电宝', '数据线', '音箱', '手机支架', '体脂秤', '手表', '手环', '耳机', '电动牙刷', '台灯', '风扇', '电煮锅', '养生壶', '恒温壶'] },
  { cat: '奖品礼品', key: 'sport', label: '运动户外', short: '运动户外',
    keywords: ['健身包', '瑜伽垫', '水壶', '腰包', '袖套', '速干毛巾'] },
  { cat: '奖品礼品', key: 'home', label: '家居日用', short: '家居日用', keywords: [] },

  // 活动及社群物资
  { cat: '活动及社群物资', key: 'snack', label: '零食茶歇', short: '零食茶歇',
    keywords: ['糖果', '巧克力', '饼干', '膨化', '坚果', '蜜饯', '海苔', '辣条', '果冻', '零食'] },
  { cat: '活动及社群物资', key: 'drink', label: '饮料饮用水', short: '饮料饮水',
    keywords: ['饮料', '气泡水', '凉茶', '椰子', '乳饮料', '饮用水', '可乐'] },
  { cat: '活动及社群物资', key: 'honor', label: '奖品伴手', short: '奖品伴手',
    keywords: ['锦旗', '奖牌', '奖杯', '公仔', '帆布袋'] },
  { cat: '活动及社群物资', key: 'sport', label: '运动竞技', short: '运动竞技',
    keywords: ['跳绳', '毽子', '羽毛球', '乒乓球', '篮球', '呼啦圈', '拔河', '接力棒', '弹力球', '泡沫棒', '锥桶', '投壶', '飞镖', '冰壶', '保龄球', '橄榄球', '滑板', '瑜伽球', '握力器', '腕力球', '桌面足球', '沙壶球', '平衡板', '拉力器', '弹力圈', '计分牌', '秒表', '口哨', '号码布', '袖标', '眼罩', '绑腿带', '趾压板', '钓鱼玩具', '沙包', '套圈'] },
  { cat: '活动及社群物资', key: 'board', label: '桌游棋牌', short: '桌游棋牌',
    keywords: ['桌游', '扑克', '象棋', '围棋', '五子棋', '飞行棋', '跳棋', '阿瓦隆', 'UNO', '狼人杀', '三国杀', '谁是卧底', '大富翁', '德国心脏病', '达芬奇', '行动代号', '矮人矿工', '真心话', '害你在心口难开', '妙语说书人', '卡坦岛', '军棋', '数独', '七巧板', '汉诺塔', '桥牌', '麻将', '叠叠高', '孔明锁', '九连环', '华容道', '骰盅', '你画我猜', '猜歌名', '词语接龙', '多米诺'] },
  { cat: '活动及社群物资', key: 'diy', label: '益智手工', short: '益智手工',
    keywords: ['积木', '拼图', '磁力片', '油画', '沙画', '羊毛毡', '钻石画', '热缩片', '蜡烛', '干花', '剪纸', '衍纸', '不织布', '手账', '木质拼装', '扎染', '马克笔', '水彩', '素描纸', '卡纸', '剪刀', '固体胶', '折纸', '黏土', '绘本', '显微镜', '望远镜', '地球仪', 'STEM', '捏捏乐', '指尖陀螺', '抓娃娃机', '贴鼻子', '书法', '宣纸', '魔方'] },
  { cat: '活动及社群物资', key: 'decor', label: '氛围布置', short: '氛围布置',
    keywords: ['气球', '彩旗', '拉花', '拍照道具', '灯串', '泡泡机', '风筝', '陀螺', '荧光棒', '抽奖', '转盘', '折叠椅', '折叠桌', '野餐垫', '天幕', '桌布', '帐篷', '话筒', '音响'] },
  { cat: '活动及社群物资', key: 'daily', label: '便民物品', short: '便民物品',
    keywords: ['雨衣', '指甲刀', '衣架', '针线包'] },

  // 日常运营耗材
  { cat: '日常运营耗材', key: 'clean', label: '清洁日用', short: '清洁日用',
    keywords: ['垃圾袋', '纸杯', '地漏', '沙发布', '地垫', '除胶剂', '蚊帐'] },
  { cat: '日常运营耗材', key: 'tool', label: '维修工具', short: '维修工具',
    keywords: ['螺丝刀', '插线板', '脚套', '挡水条', '空调挡板', '手推车'] },
  { cat: '日常运营耗材', key: 'pest', label: '除虫除味', short: '除虫除味',
    keywords: ['活性炭', '杀虫剂', '杀蟑'] },
  { cat: '日常运营耗材', key: 'safety', label: '安全防护', short: '安全防护', keywords: [] },

  // 宣传印刷物料
  { cat: '宣传印刷物料', key: 'paper', label: '纸品印刷', short: '纸品印刷',
    keywords: ['单页', '折页', '不干胶', '吊牌', '海报', 'POP', '展示卡', '联系卡', '指引卡', '邀请函', '贺卡', '证书', '聘书', '宣传袋', '纸巾盒'] },
  { cat: '宣传印刷物料', key: 'sign', label: '标识标牌', short: '标识标牌',
    keywords: ['KT板', 'PVC', '亚克力', '指示牌', '展示牌', '台卡', '提示牌', '导视', '发光字', '挂画框', '公告栏', '灯箱', '不锈钢'] },
  { cat: '宣传印刷物料', key: 'stand', label: '展示器材', short: '展示器材',
    keywords: ['易拉宝', '展架', '人字板', '条幅', '横幅', '吊旗', '侧旗', '刀旗', '桁架'] },
  { cat: '宣传印刷物料', key: 'film', label: '喷绘贴膜', short: '喷绘贴膜',
    keywords: ['喷绘', '刀刮布', '网格布', '背胶', '车贴', '单透', '透明贴', '玻璃贴', '地贴', '软膜', '广告贴', '反光贴', '地毯'] },
  { cat: '宣传印刷物料', key: 'service', label: '安装服务', short: '安装服务',
    keywords: ['安装', '作业', '拆除', '维护'] },

  // 员工物资
  { cat: '员工物资', key: 'card', label: '工卡证件', short: '工卡证件', keywords: [] }
];

// 精确名单优先（关键词容易误判的商品在这里钉死）
const EXPLICIT = {
  // 灯箱画面是喷绘输出，不是标牌
  '灯箱画面': 'film',
  // 展会吊牌是标牌类，纸质的走纸品
  '车库悬挂式导向吊牌': 'sign',
  // 印刷地垫按喷绘算
  '电梯地毯': 'film',
  // 带“海报”字样但实际是展示架
  '桌面海报展示架': 'stand',
  // 立式展示牌是展架类
  '立式展示牌': 'stand'
};

function groupOf(cat, product) {
  const name = product.name || '';
  const own = GROUPS.filter(function (g) { return g.cat === cat; });
  const pin = EXPLICIT[name];
  if (pin) {
    const hit = own.filter(function (g) { return g.key === pin; })[0];
    if (hit) return hit;
  }
  for (let i = 0; i < own.length; i++) {
    const g = own[i];
    for (let j = 0; j < g.keywords.length; j++) {
      if (name.indexOf(g.keywords[j]) >= 0) return g;
    }
  }
  // 兜底：没有关键词的最后一组
  return own.filter(function (g) { return !g.keywords.length; })[0] || own[own.length - 1];
}

// 生成二级分类索引：byId（商品 → 二级分类）+ nav（左侧导航树）
function build(catalog) {
  const byId = {};
  const buckets = {};
  catalog.forEach(function (p) {
    const g = groupOf(p.category, p);
    if (!g) return;
    const subKey = (CAT_KEY[p.category] || p.category) + '.' + g.key;
    byId[p.id] = { key: subKey, label: g.label, cat: p.category };
    if (!buckets[subKey]) buckets[subKey] = [];
    buckets[subKey].push(p.id);
  });

  const nav = [];
  Object.keys(CAT_KEY).forEach(function (cat) {
    const catKey = CAT_KEY[cat];
    const subs = GROUPS.filter(function (g) { return g.cat === cat; }).map(function (g) {
      const subKey = catKey + '.' + g.key;
      const ids = buckets[subKey] || [];
      return {
        key: subKey,
        label: g.label,
        short: g.short || g.label,
        count: ids.length,
        ids: ids
      };
    }).filter(function (s) { return s.count > 0; });
    const count = subs.reduce(function (s, x) { return s + x.count; }, 0);
    nav.push({ key: cat, label: cat, short: cat, count: count, subs: subs });
  });

  return { byId: byId, nav: nav };
}

module.exports = { build: build, CAT_KEY: CAT_KEY, GROUPS: GROUPS };

});

__def("utils/domain", function (module, exports, require) {
// 业务规则层：由 V1.24 server.js 移植（试算、分级审批、部门采购、接单、配送、验收、对账、SLA）
// 所有函数在传入的 state 上原地修改，校验失败抛出 Error，文案与网页版保持一致。
const { CATALOG, STORES, zoneOf } = require('../data/catalog');
const { SLA_HOURS, STAFF } = require('../data/seed');
const BUDGET = require('../data/budget');
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
function splitOrder(order) {
  const out = {};
  BUDGET.KEYS.forEach(function (k) { out[k] = { total: 0, accepted: 0 }; });
  if (!order) return out;
  (order.items || []).forEach(function (x) {
    const p = CATALOG_BY_ID[x.id];
    const k = BUDGET.itemOf(p || x);
    // 订单行通常带 price；历史数据缺失时回退到目录价，避免金额算成 0
    const price = Number(x.price !== undefined ? x.price : (p && p.price) || 0);
    const total = price * Number(x.qty || 0);
    const accepted = Math.min(total, price * Number(x.accepted || 0));
    if (!out[k]) out[k] = { total: 0, accepted: 0 };
    out[k].total = round2(out[k].total + total);
    out[k].accepted = round2(out[k].accepted + accepted);
  });
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
  let totalCents = 0;
  const confirmed = [];
  const seen = {};
  input.items.forEach(function (line) {
    if (!line || !line.id || !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 9999) {
      throw new Error('物料数量必须为1至9999的整数');
    }
    if (seen[line.id]) throw new Error('商品重复，请在一行填写数量');
    seen[line.id] = 1;
    const item = CATALOG_BY_ID[line.id];
    if (!item) throw new Error('商品未找到：' + line.id);
    if (typeof item.price !== 'number' || !isFinite(item.price) || item.price < 0) {
      throw new Error('商品尚无合同价，暂不能下单：' + item.name);
    }
    const unitCents = cents(item.price);
    totalCents += unitCents * line.qty;
    confirmed.push({ id: item.id, name: item.name, qty: line.qty, unitPrice: unitCents / 100, amount: unitCents * line.qty / 100 });
  });
  if (totalCents <= 0 || totalCents > 1000000000) throw new Error('试算金额超出演示范围');

  // 按费用科目拆分这笔单：每个科目各自比对可用额度
  const cfg = budgetCfg(state);
  const split = {};
  BUDGET.KEYS.forEach(function (k) { split[k] = { total: 0, usable: 0, over: 0 }; });
  confirmed.forEach(function (line) {
    const k = BUDGET.itemOf(CATALOG_BY_ID[line.id]);
    split[k].total = round2(split[k].total + line.amount);
  });
  const budgetRows = BUDGET.KEYS.filter(function (k) {
    return split[k].total > 0;
  }).map(function (k) {
    const usable = round2(storeUsableCents(state, input.store, null, k) / 100);
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
  // 机动（预留）池能补的上限：超预算是从这里划额度，超出即核不出来，下单端就该提醒拆单
  const flexCents = flexCentsOf(state);
  const maxSupportCents = availableCents + flexCents;
  const hardOver = totalCents > maxSupportCents;
  const tier = totalCents <= 50000 ? 'auto' : totalCents <= 200000 ? 'region' : 'central';
  return {
    total: totalCents / 100,
    available: availableCents / 100,
    availableAll: round2(BUDGET.KEYS.reduce(function (s, k) {
      return s + storeUsableCents(state, input.store, null, k) / 100;
    }, 0)),
    budgetItems: budgetRows,
    overAmount: overAmountCents / 100,
    overBudget: overAmountCents > 0,
    flexLeft: flexCents / 100,
    maxSupport: maxSupportCents / 100,
    hardOver: hardOver,
    tier: tier,
    tierLabel: fmt.TIER_LABEL[tier],
    nextStep: 'order-review',
    items: confirmed,
    pathText: hardOver
      ? '超出可用预算，且超过「科目额度 + 机动池」可核定上限，需拆分下单或转专项采购'
      : overAmountCents > 0
        ? '提交后先由战区审核；超出科目额度，审核通过后转运营管理部核定预算'
        : tier === 'auto'
          ? '提交后先由战区审核，通过即发送供应商（500元以内免金额审批）'
          : tier === 'region'
            ? '提交后先由战区审核，再走战区金额审批（500-2000元）'
            : '提交后先由战区审核，再报运营管理部金额审批（2000元以上）'
  };
}

/* ------------------------- 门店下单 ------------------------- */
function createStoreOrder(state, session, input) {
  if (!session || session.role !== 'store') throw new Error('请先切换为门店店长身份');
  if (!session.stores || session.stores.indexOf(input.store) < 0) throw new Error('该测试店长无此门店权限');
  const details = input.details || {};
  const address = String(details.address || '').trim();
  const receiver = String(details.receiver || '').trim();
  if (!address || !receiver || address.length > 180 || receiver.length > 80) throw new Error('请检查收货地址和联系人');
  const purpose = String(details.purpose || '门店日常运营').slice(0, 80);
  const note = String(details.note || '').slice(0, 500);
  const due = String(details.due || '').slice(0, 80) || '待供应商确认';

  const quote = computeQuote(state, input);
  const number = Math.max.apply(null, [Number(state.seq) || 0].concat(state.orders.map(function (o) {
    const m = String(o.id || '').match(/^SQ-(\d+)$/);
    return m ? Number(m[1]) : 0;
  }))) + 1;
  const id = 'SQ-' + String(number).padStart(4, '0');

  const items = quote.items.map(function (line) {
    const p = CATALOG_BY_ID[line.id];
    return {
      id: p.id, name: p.name, spec: p.spec, unit: p.unit, price: line.unitPrice,
      supplier: p.supplier, category: p.category, demoOnly: p.demoOnly,
      qty: line.qty, accepted: 0, reconciled: 0
    };
  });
  const supplierRecords = {};
  items.forEach(function (p) {
    supplierRecords[p.supplier] = { status: 'pending', delivered: false };
  });

  const now = new Date().toISOString();
  const order = {
    id: id,
    purchaseType: 'store',
    store: input.store,
    zone: zoneOf(input.store) || session.zone || '',
    manager: session.name,
    submittedBy: session.id,
    items: items,
    total: quote.total,
    tier: quote.tier,
    overPending: quote.overBudget,
    overAmount: quote.overAmount,
    regionApproved: false,
    centralApproved: false,
    budgetApproved: !quote.overBudget,
    // 门店单统一先经战区审核：额度/合规由战区把关，通过后再按金额分级
    status: 'order-review',
    purpose: purpose,
    address: address,
    receiver: receiver,
    due: due,
    note: note,
    created: fmt.nowText(),
    createdAt: now,
    supplierSentAt: null,
    stageStartedAt: now,
    supplierRecords: supplierRecords,
    budgetApplied: false,
    quoteSource: 'miniprogram-v1.24'
  };
  state.orders.unshift(order);
  state.seq = number;
  return { order: order, quote: quote };
}

/* ------------------------- 职能部门采购 ------------------------- */
function createDepartmentOrders(state, session, input) {
  if (!session || ['department', 'central'].indexOf(session.role) < 0 || !session.department) {
    throw new Error('请切换为职能部门或运营管理部身份');
  }
  if (!input || !Array.isArray(input.destinations) || input.destinations.length < 1 || input.destinations.length > 20) {
    throw new Error('请选择1至20个配送地点');
  }
  const note = String(input.note || '').trim().slice(0, 300);
  const purpose = String(input.purpose || '部门日常采购').slice(0, 80);
  const seenDest = {};
  const validated = [];
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
      const p = CATALOG_BY_ID[raw.id];
      if (!p || typeof p.price !== 'number' || p.price <= 0) throw new Error('所选商品暂不可采购');
      const unit = cents(p.price);
      sum += unit * raw.qty;
      lines.push({
        id: p.id, name: p.name, spec: p.spec, unit: p.unit, price: unit / 100,
        supplier: p.supplier, category: p.category, demoOnly: p.demoOnly,
        qty: raw.qty, accepted: 0, reconciled: 0
      });
    });
    grandCents += sum;
    validated.push({ type: dest.type, name: name, address: address, receiver: receiver, items: lines, total: sum / 100 });
  });
  if (grandCents <= 0 || grandCents > 1000000000) throw new Error('金额超出演示范围');

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
      quoteSource: 'department-miniprogram-v1.24'
    });
  });

  state.orders = generated.concat(state.orders);
  state.seq = seq;
  return { groupId: groupId, orders: generated, total: grandCents / 100 };
}

function approveDepartmentGroup(state, session, groupId, pass) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可确认部门采购');
  if (!/^DP-[0-9]{14}-[0-9]{1,10}$/.test(String(groupId || ''))) throw new Error('采购批次编号无效');
  const orders = (state.orders || []).filter(function (o) {
    return o.groupId === groupId && o.purchaseType === 'department';
  });
  if (!orders.length) throw new Error('找不到部门采购批次');
  if (orders.some(function (o) { return o.status !== 'dept-approval'; })) throw new Error('批次已处理，请刷新');
  const now = new Date().toISOString();
  const audits = [];
  orders.forEach(function (o) {
    o.status = pass ? 'supplier' : 'rejected';
    o.centralApproved = !!pass;
    o.confirmedAt = now;
    o.stageStartedAt = now;
    if (pass) {
      o.supplierSentAt = now;
      Object.keys(o.supplierRecords || {}).forEach(function (k) { o.supplierRecords[k].pendingSince = now; });
    }
    audits.push({
      orderId: o.id, kind: 'approval', stage: 'dept-approval', decision: pass ? '确认采购' : '驳回',
      role: '运营管理部（' + session.id + '，模拟）', from: 'dept-approval', to: o.status,
      note: '部门采购批次 ' + groupId, at: now
    });
  });
  return { count: orders.length, status: pass ? 'supplier' : 'rejected', audits: audits };
}

/* ------------------------- 审批 ------------------------- */
function permissionFor(stage, order) {
  if (stage === 'order-review' || stage === 'budget-region') return 'region';
  if (stage === 'amount-approval') return order.tier === 'region' ? 'region' : 'central';
  return 'central';
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

  const original = order.status;
  let who = ({
    'order-review': '战区负责人',
    'budget-region': '战区负责人',
    'budget-central': '运营预算管理员'
  })[stage] || (order.tier === 'region' ? '战区审批人' : '中台审批人');
  who = who + '（' + session.id + '，模拟）';
  let note = '';

  if (!payload.pass) {
    // 若此前已核定追加预算（金额审批阶段被驳回），额度要退回机动预算
    const reverted = revertBudgetTransfer(state, order);
    order.status = 'rejected';
    order.overPending = false;
    note = '审批驳回；演示环境不会发送供应商' + (reverted ? '；退回追加预算 ' + reverted.toFixed(2) + ' 元' : '');
  } else if (stage === 'order-review') {
    order.regionApproved = true;
    if (order.overPending) {
      // 战区同意采购，但额度不够：转运营管理部核定（追加机动池 / 门店间调剂）
      order.status = 'budget-central';
      note = '战区审核通过；超出科目额度，转运营管理部核定预算';
    } else if (order.tier === 'auto') {
      order.status = 'supplier';
      note = '战区审核通过；500元以内免金额审批，直接发送供应商';
    } else {
      order.status = 'amount-approval';
      note = order.tier === 'region'
        ? '战区审核通过；500-2000元，转战区金额审批'
        : '战区审核通过；2000元以上，转运营管理部金额审批';
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
    order.budgetSplit = (function () {
      const s = splitOrder(order);
      const out = {};
      BUDGET.KEYS.forEach(function (k) {
        if (s[k].total > 0) out[k] = s[k].total;
      });
      return out;
    })();
    order.status = order.tier === 'auto' ? 'supplier' : 'amount-approval';
    note = (added > 0 ? '追加预算（模拟）：' + fmt.money(added) + '元；' : '额度内核定；') +
      (order.status === 'supplier' ? '免金额审批，待供应商接单' : '继续采购金额审批');
  } else if (stage === 'amount-approval') {
    order.status = 'supplier';
    note = order.tier === 'region' ? '战区金额审批通过' : '中台金额审批通过';
  }

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
      role: '运营管理部（' + session.id + '，模拟）', from: 'supplier', to: 'cancelled',
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
  if (['order-review', 'cancelled', 'rejected', 'budget-region', 'budget-central', 'amount-approval', 'dept-approval'].indexOf(order.status) >= 0) {
    throw new Error('订单未正式发出，无法接单');
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
  if (['cancelled', 'rejected'].indexOf(order.status) >= 0) throw new Error('订单已关闭，无法撤回');
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
  const supplier = session.supplier;
  const sub = (order.supplierRecords || {})[supplier];
  if (!sub) throw new Error('该订单不属于当前模拟供应商');
  if (sub.status !== 'confirmed') throw new Error('请先确认接单，再登记配送');
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
      at: now, by: session.id, byName: session.name, supplier: payload.supplier,
      batchNo: payload.batchNo, note: note, result: 'issue', evidenceId: evidenceId, photoPath: payload.photoPath,
      noPhoto: noPhoto
    });
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

/* ------------------------- 结算金额共同确认 ------------------------- */
// 按实收数量折算的应结金额（部分验收只算已收部分，未到货不计）
function acceptedAmountOf(order) {
  const total = (order.items || []).reduce(function (s, x) {
    return s + cents(Number(x.accepted || 0) * Number(x.price || 0));
  }, 0);
  return round2(total / 100);
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

// 门店/部门发起：填实际结算金额，允许与「实收数量 × 单价」不同（少发、退款、质量问题折让）
function submitSettlement(state, session, payload) {
  const order = (state.orders || []).filter(function (o) { return o.id === payload.orderId; })[0];
  if (!order) throw new Error('找不到这笔订单，请刷新后重试');
  if (['settle-pending', 'settle-disputed'].indexOf(order.status) < 0) {
    throw new Error(order.status === 'settle-supplier' ? '结算金额已提交，等待供应商确认' : '订单尚未完成验收，暂不能结算');
  }
  const actor = settleActorOf(order, session);
  if (!actor) throw new Error('只有收货方可发起结算确认');

  const amount = round2(Number(payload.amount));
  if (!isFinite(amount) || amount <= 0) throw new Error('结算金额需大于 0');
  const cap = cents(Number(order.total || 0)) / 100;
  if (cents(amount) > Math.round(cap * 100) + 0) throw new Error('结算金额不能超过订单金额 ¥' + fmt.money(cap));

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
    by: session.id,
    byName: session.name,
    byRole: actor,
    round: round,
    submittedAt: now,
    readyAt: (order.settlement && order.settlement.readyAt) || now,
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

// 供应商确认或提出异议；异议退回门店重新核对，双方一致后才进入待对账
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
    settle.status = 'confirmed';
    settle.confirmedAt = now;
    settle.confirmedBy = session.id;
    order.settlement = settle;
    order.status = 'accepted';
    order.stageStartedAt = now;
    const rec = (order.supplierRecords || {})[session.supplier];
    if (rec) rec.settledAt = now;
    return {
      order: order,
      audit: {
        orderId: order.id, kind: 'settle', stage: 'settle-confirm', decision: '供应商确认结算',
        role: '供应商（' + session.supplier + '）', from: from, to: order.status,
        note: '确认结算金额 ¥' + fmt.money(settle.amount), at: now
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
function createReconciliation(state, session, payload) {
  if (!session || session.role !== 'central') throw new Error('仅运营管理部可生成对账单');
  const supplier = String(payload.supplier || '').trim();
  const period = String(payload.period || '').trim();
  if (!supplier) throw new Error('请先选择一家供应商');
  if (!period || period.length > 80) throw new Error('请输入对账周期');
  const lines = [];
  state.orders.forEach(function (o) {
    // 结算金额尚未经双方确认的订单，暂不纳入对账
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
    // 已共同确认的结算金额按确认值入账；与「实收 × 单价」的差额单列一行，保证对账合计 = 结算金额
    const settle = o.settlement && o.settlement.status === 'confirmed' ? o.settlement : null;
    if (settle) {
      const lineSum = own.reduce(function (s, x) { return s + Math.round(x.amount * 100); }, 0) / 100;
      // 一张单可能含多家供应商：按本供应商已验收金额占比分摊整单结算金额
      const allAccepted = acceptedAmountOf(o);
      const share = allAccepted > 0 ? Math.min(1, lineSum / allAccepted) : 1;
      const target = Math.round(settle.amount * share * 100) / 100;
      const gap = Math.round((target - lineSum) * 100) / 100;
      if (Math.round(gap * 100) !== 0) {
        own.push({
          order: o.id, store: o.store, supplier: supplier, name: '结算差异调整',
          id: '', n: 0, price: 0, amount: gap, adjust: true, reason: settle.reason || ''
        });
      }
    }
    lines.push.apply(lines, own);
  });
  if (!lines.length) throw new Error('该供应商没有待对账的已验收明细');
  const existing = (state.recons || []).map(function (r) {
    const m = String(r.id || '').match(/^DZ-(\d+)$/);
    return m ? Number(m[1]) : 0;
  });
  const num = Math.max.apply(null, [(state.recons || []).length].concat(existing)) + 1;
  const id = 'DZ-' + String(num).padStart(3, '0');
  const total = Math.round(lines.reduce(function (sum, x) { return sum + Math.round(x.amount * 100); }, 0)) / 100;
  const now = new Date().toISOString();
  const rec = { id: id, supplier: supplier, period: period, lines: lines, total: total, status: 'supplier-pending', createdAt: now, createdBy: session.id };
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
  if (['confirm', 'dispute', 'lock'].indexOf(action) < 0) throw new Error('不支持的操作');
  const note = String(payload.note || '').trim();
  if (action === 'dispute' && (note.length < 2 || note.length > 300)) throw new Error('请输入2至300字的差异原因');
  if (action === 'lock' && (!session || session.role !== 'central')) throw new Error('仅运营管理部可锁定对账单');
  if (action !== 'lock' && (!session || session.role !== 'supplier')) throw new Error('请使用供应商身份确认对账');

  const rec = (state.recons || []).filter(function (x) { return x.id === id; })[0];
  if (!rec) throw new Error('找不到对账单');
  if (action !== 'lock' && rec.supplier !== session.supplier) throw new Error('不能处理其他供应商的对账单');
  if (action === 'lock' && rec.status !== 'supplier-confirmed') throw new Error('必须由供应商先确认对账单');
  if (action !== 'lock' && rec.status !== 'supplier-pending') throw new Error('对账单当前不能重复确认或提出差异');
  const now = new Date().toISOString();

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

/* ------------------------- 统计 ------------------------- */
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
    (order.items || []).forEach(function (line) {
      const supplier = line.supplier || '未指定供应商';
      const price = Number(line.price || 0);
      const accepted = Number(line.accepted || 0) * price;
      const reconciled = Number(line.reconciled || 0) * price;
      if (!seen[supplier]) { add(bySupplier, supplier, 'orders', 1); seen[supplier] = 1; }
      add(bySupplier, supplier, 'requested', Number(line.qty || 0) * price);
      add(bySupplier, supplier, 'accepted', accepted);
      add(bySupplier, supplier, 'reconciled', reconciled);
      add(byZone, zone, 'accepted', accepted);
      add(byZone, zone, 'reconciled', reconciled);
      totals.accepted += accepted;
      totals.reconciled += reconciled;
    });
  });
  totals.unreconciledAccepted = Math.max(0, totals.accepted - totals.reconciled);
  Object.keys(totals).forEach(function (k) {
    if (!Number.isInteger(totals[k])) totals[k] = Math.round(totals[k] * 100) / 100;
  });
  ['byZone', 'bySupplier'].forEach(function () {});
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
    row.orders += 1;
    row.requested += Number(o.total || 0);
    (o.items || []).forEach(function (p) {
      row.accepted += Number(p.accepted || 0) * Number(p.price || 0);
      row.reconciled += Number(p.reconciled || 0) * Number(p.price || 0);
    });
  });
  rows.forEach(function (r) {
    ['requested', 'accepted', 'reconciled'].forEach(function (k) { r[k] = Math.round(r[k] * 100) / 100; });
  });
  return rows;
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
  const counts = {};
  (state.orders || []).forEach(function (o) {
    if (['rejected', 'cancelled'].indexOf(o.status) >= 0) return;
    const mine = session.role === 'store'
      ? (o.purchaseType !== 'department' && (session.stores || []).indexOf(o.store) >= 0)
      : (o.purchaseType === 'department' && o.department === session.department);
    if (!mine) return;
    (o.items || []).forEach(function (x) {
      if (!CATALOG_BY_ID[x.id]) return;
      counts[x.id] = (counts[x.id] || 0) + Number(x.qty || 0);
    });
  });
  return Object.keys(counts)
    .sort(function (a, b) { return counts[b] - counts[a]; })
    .slice(0, limit || 6)
    .map(function (id) {
      const p = CATALOG_BY_ID[id];
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

// 待确认结算：门店/部门待提交金额，供应商待确认金额
function pendingSettleOrders(state, session) {
  if (!session) return [];
  const list = visibleOrders(state, session);
  if (session.role === 'supplier') {
    return list.filter(function (o) { return o.status === 'settle-supplier'; });
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
  computeQuote, createStoreOrder, createDepartmentOrders, approveDepartmentGroup,
  approveOrder, cancelOrder, closeOrder, supplierAck, reopenSupplierAck, supplierDeliver, batchAvailability, acceptDelivery,
  acceptedAmountOf, settleActorOf, submitSettlement, settleAction, pendingSettleOrders,
  createReconciliation, reconAction, slaEntries, slaForOrder, reportSummary, departmentSummary,
  budgetSummary, budgetGap, adjustFlex, transferStoreBudget, storeUsableCents, frequentItems,
  saveBudgetConfig, budgetConfigOf, storeBudgetRows, splitOrder, applyGapBudget, revertBudgetTransfer,
  visibleOrders, pendingAcceptOrders, canAcceptOrder,
  pendingApprovals, actionCount, uid
};

});

__def("utils/format", function (module, exports, require) {
// 通用格式化与状态字典（口径与 V1.24 网页端一致）
const STATUS_MAP = {
  'order-review': { label: '待战区审核', cls: 'warn' },
  'budget-region': { label: '待战区预算审批', cls: 'warn' },
  'budget-central': { label: '待运营管理部核定预算', cls: 'warn' },
  'amount-approval': { label: '待金额审批', cls: 'warn' },
  'dept-approval': { label: '待运营管理部确认', cls: 'warn' },
  'supplier': { label: '待供应商接单', cls: 'warn' },
  'preparing': { label: '备货中', cls: 'warn' },
  'delivering': { label: '配送中', cls: 'info' },
  'delivered': { label: '已送达待验收', cls: 'info' },
  'partial': { label: '部分验收', cls: 'info' },
  'settle-pending': { label: '待门店确认结算', cls: 'warn' },
  'settle-supplier': { label: '待供应商确认结算', cls: 'info' },
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

// 所有门店单先经战区审核；金额分级决定审核之后是否再走金额审批
const TIER_LABEL = {
  auto: '500元以内 · 战区审核后直发',
  region: '500-2000元 · 战区审核（含金额）',
  central: '2000元以上 · 战区审核 + 中台金额审批',
  department: '部门采购 · 运管确认'
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

});

__def("utils/perm", function (module, exports, require) {
// 角色权限与导航配置（演示版：身份为模拟切换，权限口径集中在本文件）
const CAPS = {
  store: ['order.create', 'order.view', 'accept', 'draft', 'stats', 'settle.submit'],
  department: ['order.create', 'order.view', 'accept', 'draft', 'stats', 'settle.submit'],
  central: ['order.create', 'order.view', 'accept', 'draft', 'stats', 'approve', 'recon', 'budget.config'],
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
    duty: '预算核定、部门确认与统一对账',
    brief: ['中台自采下单', '预算核定与金额审批', '部门采购统一确认', '统一对账与锁定', '门店费用预算设置']
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
  central: ['order', 'approve', 'orders', 'budget'],
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

});

  global.BIZ = {
    load: load,
    budget: load('data/budget'),
    catalog: load('data/catalog'),
    seed: load('data/seed'),
    subcats: load('data/subcats'),
    domain: load('utils/domain'),
    fmt: load('utils/format'),
    perm: load('utils/perm')
  };
})(typeof window !== 'undefined' ? window : globalThis);
