/* 安居乐寓采购 · 企业微信扫码登录（经 IT 中转服务）
 *
 * 中转服务把企微侧的可信域名 / 可信 IP / 应用密钥都托管了，本站只需：
 *   1. /login/wecom          生成 state、写 cookie、跳中转扫码入口
 *   2. /api/auth/wecom/callback  校验 state、用密钥换身份、匹配账号、签发本站令牌
 *
 * 密钥放在仓库外的数据目录（wecom-client-secret.txt），不进 git。
 * 通讯录接口需要 IT 给接入 ID 开 directory:read 权限。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RELAY = process.env.AJLY_WECOM_RELAY || 'https://ajly-dify.szajly.com/admin/api/wecom';
const CLIENT_ID = process.env.AJLY_WECOM_CLIENT_ID || 'wx-info-sdk';
const REDIRECT_URI = process.env.AJLY_WECOM_REDIRECT || 'https://purchase.szajly.com/api/auth/wecom/callback';
const STATE_COOKIE = '__Host-ajly-wecom-state';
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const CODE_RE = /^[A-Za-z0-9_-]{32,128}$/;

function loadSecret(DATA) {
  const p = path.join(DATA, 'wecom-client-secret.txt');
  try { return fs.readFileSync(p, 'utf8').trim(); }
  catch (e) { return ''; }
}

function configured(DATA) { return !!loadSecret(DATA); }

function newState() {
  // 32 字节 base64url → 43 字符，落在中转要求的 16~128 区间
  return crypto.randomBytes(32).toString('base64url');
}

function stateCookie(value, maxAge) {
  const parts = [
    STATE_COOKIE + '=' + value,
    'Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax',
    'Max-Age=' + (maxAge == null ? 300 : maxAge)
  ];
  return parts.join('; ');
}

function clearStateCookie() { return stateCookie('', 0); }

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const items = raw.split(';');
  for (let i = 0; i < items.length; i++) {
    const kv = items[i].trim();
    const pos = kv.indexOf('=');
    if (pos < 0) continue;
    if (kv.slice(0, pos) === name) {
      try { return decodeURIComponent(kv.slice(pos + 1)); }
      catch (e) { return kv.slice(pos + 1); }
    }
  }
  return '';
}

function loginUrl(state) {
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state: state
  });
  return RELAY + '/auth/login?' + q.toString();
}

function headers(secret) {
  return {
    'X-Wecom-Client-Id': CLIENT_ID,
    'X-Wecom-Client-Secret': secret,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

async function relayGet(endpoint, secret) {
  const r = await fetch(RELAY + endpoint, { headers: headers(secret), redirect: 'manual' });
  if (!r.ok) {
    const text = (await r.text().catch(function () { return ''; })).slice(0, 200);
    throw new Error('中转返回 ' + r.status + (text ? '：' + text : ''));
  }
  return r.json();
}

/* 用登录码换企微身份：{ corp_id, user: { userid, name, department, status } } */
async function exchange(code, secret) {
  const r = await fetch(RELAY + '/auth/exchange', {
    method: 'POST',
    headers: headers(secret),
    body: JSON.stringify({ code: code }),
    redirect: 'manual'
  });
  if (!r.ok) {
    const text = (await r.text().catch(function () { return ''; })).slice(0, 200);
    const err = new Error(r.status === 401 ? '接入密钥无效或无权限' : '兑换身份失败（' + r.status + '）' + (text ? '：' + text : ''));
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  const corpId = data && data.corp_id;
  const user = data && data.user;
  const userid = user && user.userid;
  if (typeof corpId !== 'string' || !corpId || typeof userid !== 'string' || !userid) {
    throw new Error('身份返回格式异常');
  }
  return { corp_id: corpId, user: user };
}

/* 通讯录：需要 directory:read 权限 */
async function departments(secret) {
  return relayGet('/departments', secret);
}
async function departmentMembers(deptId, secret) {
  return relayGet('/departments/' + encodeURIComponent(deptId) + '/members?recursive=true', secret);
}
async function member(userid, secret) {
  return relayGet('/members/' + encodeURIComponent(userid), secret);
}

/* 按真实 userid 匹配账号：
 *   校正后：accounts.json 的 wecom_userid === 企微 userid
 *   校正前：内部 id 暂代 userid，用 id === userid 兜底
 * 返回账号 id 或 null。
 */
function matchAccount(index, identityInfo) {
  const userid = String((identityInfo.user && identityInfo.user.userid) || '');
  if (!userid) return null;
  const accounts = index.accounts || {};
  const keys = Object.keys(accounts);
  let hit = keys.filter(function (id) {
    return accounts[id].wecom_userid === userid && accounts[id].userid_verified === true;
  });
  if (hit.length === 1) return hit[0];
  hit = keys.filter(function (id) { return accounts[id].wecom_userid === userid; });
  if (hit.length === 1) return hit[0];
  hit = keys.filter(function (id) { return id === userid; });
  if (hit.length === 1) return hit[0];
  return null;
}

function normName(s) { return String(s || '').replace(/[\s·•（）()\-_]/g, '').toLowerCase(); }

/* 姓名兜底匹配：企微通讯录可见范围没覆盖门店时使用。
 * 只在姓名唯一时返回账号 id；重名返回 []，未找到返回 null。
 */
function matchByName(index, identityInfo) {
  const name = normName(identityInfo && identityInfo.user && identityInfo.user.name);
  if (!name) return null;
  const accounts = index.accounts || {};
  const hit = Object.keys(accounts).filter(function (id) { return normName(accounts[id].name) === name; });
  if (hit.length === 1) return hit[0];
  if (hit.length > 1) return [];
  return null;
}

module.exports = {
  RELAY: RELAY,
  CLIENT_ID: CLIENT_ID,
  REDIRECT_URI: REDIRECT_URI,
  STATE_COOKIE: STATE_COOKIE,
  STATE_RE: STATE_RE,
  CODE_RE: CODE_RE,
  configured: configured,
  loadSecret: loadSecret,
  newState: newState,
  stateCookie: stateCookie,
  clearStateCookie: clearStateCookie,
  readCookie: readCookie,
  loginUrl: loginUrl,
  exchange: exchange,
  departments: departments,
  departmentMembers: departmentMembers,
  member: member,
  matchAccount: matchAccount,
  matchByName: matchByName,
  normName: normName
};
