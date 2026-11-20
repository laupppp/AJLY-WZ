// 模拟身份切换（仅演示用，不做真实登录与鉴权）
const { STAFF, SUPPLIERS } = require('../data/seed');

const KEY = 'anju_identity_v124';
const DEFAULT_ID = 'TEST-STORE-A';

// 职能部门演示身份只保留 1 个通用身份：
// 正式版接入企业微信后，由通讯录/组织架构直接识别部门，不再需要人工挑选 11 个身份。
const DEPARTMENT_DEMO = {
  id: 'TEST-DEPT-01',
  name: '职能部门采购员',
  short: '职能部门',
  role: 'department',
  department: '人力资源部',
  zone: null,
  stores: [],
  desc: '演示仅保留 1 个通用身份'
};

function departmentProfiles() {
  return [DEPARTMENT_DEMO];
}

function supplierProfiles() {
  return SUPPLIERS.map(function (name, index) {
    return {
      id: 'TEST-SUPPLIER-' + (index + 1),
      name: name,
      short: name,
      role: 'supplier',
      supplier: name,
      zone: null,
      stores: [],
      desc: '接单、选择配送方式、登记运单号'
    };
  });
}

function all() {
  const staff = STAFF.map(function (x) {
    const profile = Object.assign({ short: x.name }, x);
    // 运营管理部既是中台审批方，也是可以自采的部门
    if (profile.role === 'central' && !profile.department) profile.department = '运营管理部';
    return profile;
  });
  return staff.concat(departmentProfiles(), supplierProfiles());
}

function findById(id) {
  const list = all();
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  // 兼容旧身份：11 个部门身份已收敛为 1 个，历史选择自动落到通用身份
  if (/^TEST-DEPT-\d+$/.test(String(id || ''))) return DEPARTMENT_DEMO;
  return null;
}

function current() {
  let id = '';
  try { id = wx.getStorageSync(KEY) || ''; } catch (e) { id = ''; }
  return findById(id) || findById(DEFAULT_ID);
}

function switchTo(id) {
  const profile = findById(id);
  if (!profile) throw new Error('测试身份不存在');
  wx.setStorageSync(KEY, id);
  return profile;
}

function grouped() {
  const list = all();
  return [
    { title: '门店店长', desc: '提交门店采购、验收、撤销、再次下单', items: list.filter(function (x) { return x.role === 'store'; }) },
    { title: '战区负责人', desc: '审批本战区预算追加与采购金额', items: list.filter(function (x) { return x.role === 'region'; }) },
    { title: '运营管理部（中台）', desc: '预算核定、部门采购确认、统一对账', items: list.filter(function (x) { return x.role === 'central'; }) },
    { title: '职能部门', desc: '演示保留 1 个通用身份，采购由运营管理部统一确认', items: list.filter(function (x) { return x.role === 'department'; }) },
    { title: '供应商', desc: '接单、选择配送方式、登记运单号、分批发货', items: list.filter(function (x) { return x.role === 'supplier'; }) }
  ];
}

module.exports = { all, findById, current, switchTo, grouped };
