/* 安居乐寓物资采购 · 共享试用服务端
 *
 * 一台 Windows 电脑即可运行，不需要公司服务器、不需要域名、不需要装数据库软件。
 * 用法：
 *   node server/app.js                # 启动（默认 127.0.0.1:3010）
 *   node server/app.js backup         # 在线备份 SQLite
 *   AJLY_PORT=3010 AJLY_HOST=127.0.0.1 node server/app.js
 *
 * 设计要点：
 *  1. 同源托管 h5/ 静态文件，浏览器访问 http://<地址>:3010/ 即为完整 H5，API 在 /api/*
 *  2. 业务规则直接 require miniprogram/utils/domain.js，与前端 biz.js 同源，不重复实现
 *  3. 前端把「动作名 + 参数」发过来，服务端用令牌对应的真实身份重放，权限由服务端判定
 *  4. 全站只有一份 state，存在仓库外的 SQLite，带 revision 乐观锁与每日备份
 *  5. /js/config.js 会被动态改写，自动把前端切到 remote 模式（同一份代码，Pages 上仍是 demo）
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const domain = require('../miniprogram/utils/domain');
const { SEED_STATE } = require('../miniprogram/data/seed');
const { CONTRACTS_DEFAULT } = require('../miniprogram/data/rules');
const identity = require('./identity');

const ROOT = path.resolve(__dirname, '..');
const H5 = path.join(ROOT, 'h5');
const DATA = path.resolve(process.env.AJLY_DATA || path.join(ROOT, '..', 'ajly-shared-data'));
fs.mkdirSync(DATA, { recursive: true });

const DB = new DatabaseSync(path.join(DATA, 'shared.sqlite'));
DB.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS shared_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    body TEXT NOT NULL CHECK(json_valid(body))
  ) STRICT;
`);

const KEEP_DEMO = process.env.AJLY_KEEP_DEMO === '1';
const initial = Object.assign({}, SEED_STATE, {
  orders: KEEP_DEMO ? (SEED_STATE.orders || []) : [],
  recons: KEEP_DEMO ? (SEED_STATE.recons || []) : [],
  seq: 0,
  schema: 3,
  revision: 1,
  updatedAt: new Date().toISOString(),
  serverAudit: []
});
DB.prepare('INSERT OR IGNORE INTO shared_state VALUES (1, ?)').run(JSON.stringify(initial));

const load = () => JSON.parse(DB.prepare('SELECT body FROM shared_state WHERE id = 1').get().body);
const save = (s) => DB.prepare('UPDATE shared_state SET body = ? WHERE id = 1').run(JSON.stringify(s));

/* ---------- 身份 / 授权分离（账号与权限各自独立维护） ---------- */
const CONTRACT_SUPPLIER = {};
(CONTRACTS_DEFAULT || []).forEach(function (c) {
  if (c && c.id && c.supplier) CONTRACT_SUPPLIER[c.id] = c.supplier;
});
const IDX = identity.buildIndex(DATA, { contractSupplier: CONTRACT_SUPPLIER });
const BY_ID = IDX.BY_ID;
const ACTORS = IDX.ACTORS;
const TOKEN_BY_ID = IDX.TOKEN_BY_ID;
const USERS = IDX.USERS;
const loginFails = new Map();

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}
identity.writeAccountSheet(DATA, IDX);

/* ---------- 只允许重放的动作 ----------
 * 白名单里的调用一旦抛错就整体回滚（多半是权限不足或业务规则拦截）；
 * 白名单外的调用多为读函数，照样执行但出错忽略，避免误伤。
 * 前端录制以 state 为首参的所有调用，服务端按 (state, actor, ...args) 重放。
 */
const MUTATIONS = new Set([
  'acceptDelivery', 'adjustFlex', 'approveDepartmentGroup', 'approveOrder',
  'batchApproveOrders', 'cancelOrder', 'closeOrder', 'createDepartmentOrders',
  'createReconciliation', 'createStoreOrder', 'deleteCatalogItem',
  'finalizeShortDelivery', 'reconAction', 'reopenSupplierAck',
  'resolveAcceptanceIssue', 'restoreCatalogItem', 'saveApprovalConfig',
  'saveBudgetConfig', 'saveCatalogItem', 'saveContract', 'setCatalogItemScope',
  'settleAction', 'submitSettlement', 'supplierAck', 'supplierDeliver',
  'toggleCatalogItem', 'transferStoreBudget'
]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, value, type) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error('请求不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(H5, '.' + rel);
  if (file !== H5 && !file.startsWith(H5 + path.sep)) return send(res, 403, { error: 'Forbidden' });
  let st;
  try { st = fs.statSync(file); } catch (e) { return send(res, 404, { error: 'Not found' }); }
  if (!st.isFile()) return send(res, 404, { error: 'Not found' });

  // 同一份代码：经服务端访问时自动开启共享模式，GitHub Pages / 本地双击仍是 demo
  if (rel === '/js/config.js') {
    const src = fs.readFileSync(file, 'utf8');
    const patched = src.replace('/*REMOTE_FLAG*/enabled: false', 'enabled: true');
    return send(res, 200, patched, MIME['.js']);
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(file).pipe(res);
}

function replay(body, actor) {
  const state = load();
  if (body.revision !== state.revision) {
    return { error: '数据已被其他人更新，已同步到最新，请重新操作', state: state };
  }
  if (!Array.isArray(body.calls) || body.calls.length > 30) {
    return { error: '动作列表不合法' };
  }
  const audits = [];
  const snapshot = state;
  try {
    body.calls.forEach(function (call) {
      const name = String((call && call.name) || '');
      if (!Object.prototype.hasOwnProperty.call(domain, name)) throw new Error('未知动作：' + name);
      const fn = domain[name];
      if (typeof fn !== 'function') return;
      const args = Array.isArray(call.args) ? call.args : [];
      const isWrite = MUTATIONS.has(name);
      let result;
      try {
        result = fn(state, actor, ...args);
      } catch (e) {
        if (isWrite) throw e;
        return; // 读函数参数形态不一致时忽略，不影响 state
      }
      if (result && result.audit) audits.push(result.audit);
      if (result && result.audits) audits.push(...result.audits);
    });
  } catch (e) {
    // 任何写动作失败都整体丢弃，不写库；返回未修改的权威 state 供前端回滚
    return { error: e.message || '动作被拒绝', state: snapshot };
  }
  state.serverAudit = (state.serverAudit || []).concat(audits).slice(-600);
  state.revision = (state.revision || 0) + 1;
  state.updatedAt = new Date().toISOString();
  save(state);
  return { state: state };
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/api/health') return send(res, 200, { ok: true, revision: load().revision });
  if (pathname === '/api/login' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 64 * 1024); }
    catch (e) { return send(res, 400, { error: '请求不是合法 JSON' }); }
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const now = Date.now();
    const key = (req.socket.remoteAddress || '') + ':' + username;
    const fails = (loginFails.get(key) || []).filter(function (t) { return now - t < 60000; });
    if (fails.length >= 5) {
      loginFails.set(key, fails);
      return send(res, 429, { error: '尝试次数过多，请 1 分钟后再试' });
    }
    const u = USERS[username];
    if (u && u.active === false) return send(res, 403, { error: '该账号已' + (u.status || '停用') + '，请联系管理员' });
    const ok = !!u && (function () {
      const a = Buffer.from(hashPassword(password, u.salt), 'hex');
      const b = Buffer.from(u.hash, 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    })();
    if (!ok) {
      fails.push(now);
      loginFails.set(key, fails);
      return send(res, 401, { error: '用户名或密码错误' });
    }
    loginFails.delete(key);
    const profile = BY_ID.get(u.id);
    const raw = TOKEN_BY_ID.get(u.id);
    if (!raw || !profile) return send(res, 403, { error: '该账号当前无有效授权，请联系管理员' });
    return send(res, 200, { token: raw, profile: profile });
  }
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const actor = ACTORS.get(req.headers.authorization || '');
  if (!actor) return send(res, 401, { error: '访问令牌无效，请重新登录' });

  if (pathname === '/api/account' && req.method === 'GET') {
    return send(res, 200, { profile: actor, revision: load().revision });
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    const state = load();
    const since = Number(url.searchParams.get('since') || 0);
    if (since && state.revision <= since) return send(res, 200, { unchanged: true, revision: state.revision });
    return send(res, 200, { state: state });
  }

  if (pathname === '/api/action' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 2 * 1024 * 1024); }
    catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, replay(body, actor));
  }

  return send(res, 404, { error: 'Unknown endpoint' });
}

async function main() {
  if (process.argv[2] === 'backup') {
    const dest = path.join(DATA, 'shared-backup-' + crypto.randomBytes(6).toString('hex') + '.sqlite');
    await backup(DB, dest);
    const copy = new DatabaseSync(dest, { readOnly: true });
    try {
      if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('备份校验失败');
    } finally { copy.close(); DB.close(); }
    console.log(dest);
    return;
  }
  const host = process.env.AJLY_HOST || '127.0.0.1';
  const port = Number(process.env.AJLY_PORT || 3010);
  const server = http.createServer(function (req, res) {
    handler(req, res).catch(function (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: '服务端内部错误' });
      else res.destroy();
    });
  });
  server.listen(port, host, function () {
    console.log('安居乐寓采购 · 共享试用服务端');
    console.log('  访问地址: http://' + host + ':' + port + '/');
    console.log('  数据目录: ' + DATA);
    console.log('  令牌清单: ' + path.join(DATA, 'accounts.txt') + '（请单独分发，勿公开）');
    console.log('  当前身份数: ' + ACTORS.size + '，订单数: ' + load().orders.length);
  });
}

if (require.main === module) main().catch(function (e) { console.error(e); process.exitCode = 1; });
module.exports = { main: main, replay: replay, load: load };
