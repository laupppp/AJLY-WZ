/* 安居乐寓采购 · 身份 / 授权分离层
 *
 * 设计要点：
 *  1. accounts.json 只管「是谁」：内部稳定 id、企微 userid（可校正）、用户名密码、状态
 *  2. grants.json 只管「能看什么」：角色、维度（stores/zone/contracts/department）、范围值、有效期、原因
 *  3. 同一账号可有多条授权，合成 profile 时按维度合并；过期授权自动失效
 *  4. 合成的 profile 形状与旧版完全一致，domain.js / 前端一行不用改
 *
 * 人员变动（代管、轮岗、休假）只改 grants.json，不动账号、不动密码、不用重发清单。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROLE_ORDER = ['central', 'department', 'region', 'store', 'supplier'];

function randomPassword() {
  let out = '';
  for (let i = 0; i < 8; i++) out += PASSWORD_CHARS[crypto.randomInt(PASSWORD_CHARS.length)];
  return out;
}
function randomToken() { return crypto.randomBytes(24).toString('hex'); }
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}
function makeAccount(base, existing) {
  const salt = (existing && existing.salt) || crypto.randomBytes(16).toString('hex');
  const password = (existing && existing.password) || randomPassword();
  return Object.assign({}, base, {
    salt: salt,
    password: password,
    hash: hashPassword(password, salt),
    token: (existing && existing.token) || randomToken()
  });
}

/* ---------- 导入花名册（幂等：已存在的人保留密码与令牌） ---------- */
function buildFromRoster(roster, DATA, contractSupplier) {
  const accounts = {};
  const grants = [];
  const now = new Date().toISOString();

  (roster.people || []).forEach(function (p) {
    const id = String(p.id || '').trim();
    if (!id) return;
    const username = id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = Object.keys(accounts).find(function (k) { return k.toLowerCase() === username; }) || id;
    const old = accounts[key];
    accounts[key] = makeAccount({
      id: key,
      name: p.name,
      wecom_userid: p.wecom_userid || id,
      userid_verified: !!p.userid_verified,
      username: username,
      active: p.status !== '休假' && p.status !== '离职',
      status: p.status || '在职',
      dept: p.dept || '',
      note: p.note || ''
    }, old);

    let value = (p.value || []).slice();
    if (p.dimension === 'contracts') {
      value = value.filter(function (c) { return !!contractSupplier[c]; });
    }
    grants.push({
      id: 'G-' + crypto.randomBytes(4).toString('hex'),
      account: key,
      role: p.role,
      dimension: p.dimension,
      value: value,
      zone: p.zone || '',
      from: '',
      to: '',
      reason: '本职',
      active: true,
      createdAt: now
    });
  });

  fs.writeFileSync(path.join(DATA, 'accounts.json'), JSON.stringify(accounts, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(DATA, 'grants.json'), JSON.stringify(grants, null, 2), { mode: 0o600 });
  return { accounts: accounts, grants: grants };
}

function ensureData(DATA, rosterPath, contractSupplier) {
  const accPath = path.join(DATA, 'accounts.json');
  const graPath = path.join(DATA, 'grants.json');
  if (!fs.existsSync(accPath) && fs.existsSync(rosterPath)) {
    const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
    return buildFromRoster(roster, DATA, contractSupplier);
  }
  return {
    accounts: fs.existsSync(accPath) ? JSON.parse(fs.readFileSync(accPath, 'utf8')) : {},
    grants: fs.existsSync(graPath) ? JSON.parse(fs.readFileSync(graPath, 'utf8')) : []
  };
}

function activeGrant(g, today) {
  if (g.active === false) return false;
  const d = String(today || new Date().toISOString().slice(0, 10));
  if (g.from && d < g.from) return false;
  if (g.to && d > g.to) return false;
  return true;
}

/* 把账号 + 多条有效授权合成旧版 profile 形状 */
function composeProfile(account, grants, contractSupplier, today) {
  if (!account || account.active === false) return null;
  const mine = grants.filter(function (g) {
    return g.account === account.id && activeGrant(g, today);
  });
  if (!mine.length) return null;
  const role = mine.slice().sort(function (a, b) {
    return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
  })[0].role;

  const stores = [];
  const contracts = [];
  let zone = account.zone || '';
  let department = '';
  let supplier = '';

  mine.forEach(function (g) {
    if (g.zone) zone = g.zone;
    (g.value || []).forEach(function (v) {
      if (g.dimension === 'stores' && stores.indexOf(v) < 0) stores.push(v);
      if (g.dimension === 'contracts') {
        if (contracts.indexOf(v) < 0) contracts.push(v);
        const s = contractSupplier[v];
        if (s && !supplier) supplier = s;
      }
      if (g.dimension === 'department') department = v;
    });
    if (g.role === 'central' && !department) department = '运营管理部';
  });

  return {
    id: account.id,
    name: account.name,
    short: account.name,
    role: role,
    zone: zone || null,
    stores: stores,
    department: department || null,
    supplier: supplier,
    contracts: contracts,
    fromWecom: true,
    wecom_userid: account.wecom_userid || account.id,
    status: account.status || '在职'
  };
}

function buildIndex(DATA, options) {
  const o = options || {};
  // 花名册含真实姓名与企微账号，存仓库外的数据目录，不进 git
  const rosterPath = path.join(DATA, 'roster-source.json');
  const data = ensureData(DATA, rosterPath, o.contractSupplier || {});
  const accounts = data.accounts;
  const grants = data.grants;
  const today = o.today || new Date().toISOString().slice(0, 10);

  const BY_ID = new Map();
  const ACTORS = new Map();
  const TOKEN_BY_ID = new Map();
  const USERS = {};
  const accountById = new Map();

  Object.keys(accounts).forEach(function (id) {
    const a = accounts[id];
    accountById.set(id, a);
    const p = composeProfile(a, grants, o.contractSupplier || {}, today);
    if (p) {
      BY_ID.set(id, p);
      ACTORS.set('Bearer ' + a.token, p);
    }
    TOKEN_BY_ID.set(id, a.token);
    const username = String(a.username || id).toLowerCase();
    USERS[username] = a;
  });

  return {
    accounts: accounts,
    grants: grants,
    BY_ID: BY_ID,
    ACTORS: ACTORS,
    TOKEN_BY_ID: TOKEN_BY_ID,
    USERS: USERS,
    accountById: accountById,
    composeProfile: function (id) {
      return composeProfile(accounts[id], grants, o.contractSupplier || {}, today);
    },
    refreshToken: function (id) {
      const a = accounts[id];
      if (!a) return null;
      a.token = randomToken();
      fs.writeFileSync(path.join(DATA, 'accounts.json'), JSON.stringify(accounts, null, 2), { mode: 0o600 });
      return a.token;
    }
  };
}

function writeAccountSheet(DATA, index) {
  const lines = [
    '安居乐寓物资采购 · 试点账号（用户名 + 密码）',
    '生成时间：' + new Date().toLocaleString('zh-CN'),
    '请把「姓名 + 用户名 + 密码」单独发给对应人员，不要把本文件发到群里。',
    '门店用手机浏览器打开系统地址，用用户名 + 密码登录；token 仍可作为备用方式。',
    '休假/停用账号不可登录；代管授权到期自动失效，只需改 grants.json，不动账号。',
    ''
  ];
  Object.keys(index.accounts).forEach(function (id) {
    const a = index.accounts[id];
    const p = index.BY_ID.get(id);
    lines.push(a.name + '　[' + (p ? p.role : '无有效授权') + ']　id=' + id + (a.active === false ? '　【' + a.status + '·不可登录】' : ''));
    lines.push('  用户名: ' + a.username);
    lines.push('  密码: ' + (a.password || '（见首次生成记录）'));
    lines.push('  token（备用）: ' + (a.token || ''));
    if (a.wecom_userid && a.wecom_userid !== id) lines.push('  企微 userid: ' + a.wecom_userid + (a.userid_verified ? '' : '（待校正）'));
    if (p) {
      if (p.role === 'store') lines.push('  可下单门店: ' + (p.stores || []).join('、'));
      if (p.role === 'region') lines.push('  审批战区: ' + (p.zone || ''));
      if (p.role === 'supplier') lines.push('  对应合同: ' + (p.contracts || []).join('、') + '（供应商：' + p.supplier + '）');
    }
    if (a.note) lines.push('  备注: ' + a.note);
    lines.push('');
  });
  fs.writeFileSync(path.join(DATA, 'accounts.txt'), lines.join('\n'), { mode: 0o600 });
}

module.exports = {
  buildIndex: buildIndex,
  writeAccountSheet: writeAccountSheet,
  activeGrant: activeGrant
};
