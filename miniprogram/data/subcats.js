// 二级分类（细分目录）：给下单页左侧竖排导航用
// 以合同 × 预算项为基础归为 3 大类（社群活动物资 / 客诉维护物资 / 印刷品物料）

const CAT_KEY = {
  '社群活动物资': 'act',
  '客诉维护物资': 'cust',
  '印刷品物料': 'print'
};

// 每个大类的分组定义（顺序即左侧栏展示顺序，最后一组或空关键词组为兜底组）
const GROUPS = [
  // 社群活动物资（运营物资合同 · 社群活动预算）
  { cat: '社群活动物资', key: 'snack', label: '零食茶歇', short: '零食茶歇',
    keywords: ['糖果', '巧克力', '饼干', '膨化', '坚果', '蜜饯', '海苔', '辣条', '果冻', '零食'] },
  { cat: '社群活动物资', key: 'drink', label: '饮料饮用水', short: '饮料饮水',
    keywords: ['饮料', '气泡水', '凉茶', '椰子', '乳饮料', '饮用水', '可乐'] },
  { cat: '社群活动物资', key: 'sport', label: '运动竞技', short: '运动竞技',
    keywords: ['跳绳', '毽子', '羽毛球', '乒乓球', '篮球', '呼啦圈', '拔河', '接力棒', '弹力球', '泡沫棒', '锥桶', '投壶', '飞镖', '冰壶', '保龄球', '橄榄球', '滑板', '瑜伽球', '握力器', '腕力球', '桌面足球', '沙壶球', '平衡板', '拉力器', '弹力圈', '计分牌', '秒表', '口哨', '号码布', '袖标', '眼罩', '绑腿带', '趾压板', '钓鱼玩具', '沙包', '套圈'] },
  { cat: '社群活动物资', key: 'board', label: '桌游棋牌', short: '桌游棋牌',
    keywords: ['桌游', '扑克', '象棋', '围棋', '五子棋', '飞行棋', '跳棋', '阿瓦隆', 'UNO', '狼人杀', '三国杀', '谁是卧底', '大富翁', '德国心脏病', '达芬奇', '行动代号', '矮人矿工', '真心话', '害你在心口难开', '妙语说书人', '卡坦岛', '军棋', '数独', '七巧板', '汉诺塔', '桥牌', '麻将', '叠叠高', '孔明锁', '九连环', '华容道', '骰盅', '你画我猜', '猜歌名', '词语接龙', '多米诺'] },
  { cat: '社群活动物资', key: 'diy', label: '益智手工', short: '益智手工',
    keywords: ['积木', '拼图', '磁力片', '油画', '沙画', '羊毛毡', '钻石画', '热缩片', '蜡烛', '干花', '剪纸', '衍纸', '不织布', '手账', '木质拼装', '扎染', '马克笔', '水彩', '素描纸', '卡纸', '剪刀', '固体胶', '折纸', '黏土', '绘本', '显微镜', '望远镜', '地球仪', 'STEM', '捏捏乐', '指尖陀螺', '抓娃娃机', '贴鼻子', '书法', '宣纸', '魔方'] },
  { cat: '社群活动物资', key: 'decor', label: '氛围布置', short: '氛围布置',
    keywords: ['气球', '彩旗', '拉花', '拍照道具', '灯串', '泡泡机', '风筝', '陀螺', '荧光棒', '转盘', '折叠椅', '折叠桌', '野餐垫', '天幕', '话筒', '音响', '公仔', '帆布袋'] },
  { cat: '社群活动物资', key: 'daily', label: '便民物品', short: '便民物品', keywords: [] },

  // 客诉维护物资（运营物资合同 · 客诉预算）
  { cat: '客诉维护物资', key: 'digital', label: '数码小电', short: '数码小电',
    keywords: ['充电宝', '数据线', '音箱', '手机支架', '体脂秤', '手表', '手环', '耳机', '电动牙刷', '台灯', '风扇', '电煮锅', '养生壶', '恒温壶'] },
  { cat: '客诉维护物资', key: 'clean', label: '清洁耗材', short: '清洁耗材',
    keywords: ['垃圾袋', '纸杯', '地漏', '沙发布', '地垫', '除胶剂', '蚊帐'] },
  { cat: '客诉维护物资', key: 'tool', label: '维修与安全', short: '维修安全',
    keywords: ['螺丝刀', '插线板', '脚套', '挡水条', '空调挡板', '手推车', '安全', '防护', '手套', '口罩'] },
  { cat: '客诉维护物资', key: 'pest', label: '除虫除味', short: '除虫除味',
    keywords: ['活性炭', '杀虫剂', '杀蟑'] },
  { cat: '客诉维护物资', key: 'gift', label: '客诉日用礼', short: '客诉日用', keywords: [] },

  // 印刷品物料（印刷品物料合同 · 营销预算）
  { cat: '印刷品物料', key: 'paper', label: '纸品印刷', short: '纸品印刷',
    keywords: ['单页', '折页', '不干胶', '吊牌', '海报', 'POP', '展示卡', '联系卡', '指引卡', '邀请函', '贺卡', '证书', '聘书', '宣传袋', '纸巾盒'] },
  { cat: '印刷品物料', key: 'sign', label: '标识标牌', short: '标识标牌',
    keywords: ['KT板', 'PVC', '亚克力', '指示牌', '展示牌', '台卡', '提示牌', '导视', '发光字', '挂画框', '公告栏', '灯箱', '不锈钢'] },
  { cat: '印刷品物料', key: 'stand', label: '展示与定制', short: '展示定制',
    keywords: ['易拉宝', '展架', '人字板', '条幅', '横幅', '吊旗', '侧旗', '刀旗', '桁架', '工卡', '挂绳', '锦旗', '抽奖', '奖牌', '奖杯', '帐篷', '桌布'] },
  { cat: '印刷品物料', key: 'film', label: '喷绘贴膜', short: '喷绘贴膜',
    keywords: ['喷绘', '刀刮布', '网格布', '背胶', '车贴', '单透', '透明贴', '玻璃贴', '地贴', '软膜', '广告贴', '反光贴', '地毯'] },
  { cat: '印刷品物料', key: 'service', label: '安装服务', short: '安装服务', keywords: [] }
];

// 精确名单优先（关键词容易误判的商品在这里钉死）
const EXPLICIT = {
  '灯箱画面': 'film',
  '车库悬挂式导向吊牌': 'sign',
  '电梯地毯': 'film',
  '桌面海报展示架': 'stand',
  '立式展示牌': 'stand',
  '活动抽奖箱': 'stand',
  '活动抽奖转盘': 'stand',
  '活动折叠帐篷': 'stand',
  '活动桌布': 'stand'
};

function groupOf(cat, product) {
  const name = product.name || '';
  const own = GROUPS.filter(function (g) { return g.cat === cat; });
  if (!own.length) return null;
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
