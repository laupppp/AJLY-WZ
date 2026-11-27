/* 企微通讯录同步：拉取真实 userid 与部门，按姓名匹配账号库
 *
 * 用法（在仓库根目录 D:\AJLY-WZ 下）：
 *   node server/sync-wecom-directory.js            # 只读预览，不写文件
 *   node server/sync-wecom-directory.js --apply    # 确认无误后写入
 *   AJLY_DATA=E:\somewhere node server/sync-wecom-directory.js --apply
 *
 * 需要 IT 给接入 ID 开通 directory:read 权限。
 * 只更新 wecom_userid / userid_verified / wecom_department，不改密码、不改令牌、不改授权。
 */
const fs = require('node:fs');
const path = require('node:path');
const wecom = require('./wecom');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.resolve(process.env.AJLY_DATA || path.join(ROOT, '..', 'ajly-shared-data'));
const APPLY = process.argv.indexOf('--apply') >= 0;

function norm(s) { return String(s || '').replace(/[\s·•（）()\-_]/g, '').toLowerCase(); }

function loadMembers(flat) {
  return wecom.departments(flat).then(function (d) {
    const list = Array.isArray(d) ? d : (d.departments || d.data || []);
    console.log('部门数：' + list.length);
    const deptMap = {};
    list.forEach(function (x) { deptMap[String(x.id)] = x.name || ''; });
    fs.writeFileSync(path.join(DATA, 'wecom-departments.json'), JSON.stringify(deptMap, null, 2), { mode: 0o600 });

    const seen = new Set();
    const members = [];
    return list.reduce(function (chain, dept) {
      return chain.then(function () {
        return wecom.departmentMembers(dept.id, flat).then(function (r) {
          const arr = Array.isArray(r) ? r : (r.members || r.userlist || r.data || []);
          arr.forEach(function (m) {
            const uid = String((m && (m.userid || m.user_id)) || '');
            if (!uid || seen.has(uid)) return;
            seen.add(uid);
            members.push({ userid: uid, name: String(m.name || ''), department: m.department || [], status: m.status });
          });
        }).catch(function (e) {
          console.log('  警告：部门 ' + dept.id + ' 读取失败：' + e.message);
        });
      });
    }, Promise.resolve()).then(function () { return members; });
  });
}

async function main() {
  const secret = wecom.loadSecret(DATA);
  if (!secret) throw new Error('缺少密钥：' + path.join(DATA, 'wecom-client-secret.txt'));
  console.log('中转服务：' + wecom.RELAY);

  const members = await loadMembers(secret);
  console.log('成员数：' + members.length);
  fs.writeFileSync(path.join(DATA, 'wecom-members.json'), JSON.stringify(members, null, 2), { mode: 0o600 });

  const accPath = path.join(DATA, 'accounts.json');
  const accounts = JSON.parse(fs.readFileSync(accPath, 'utf8'));
  const byName = {};
  members.forEach(function (m) {
    const key = norm(m.name);
    if (!key) return;
    (byName[key] = byName[key] || []).push(m);
  });

  const report = [];
  let changed = 0;
  Object.keys(accounts).forEach(function (id) {
    const a = accounts[id];
    const candidates = byName[norm(a.name)] || [];
    if (candidates.length !== 1) {
      report.push({ name: a.name, id: id, result: candidates.length ? '姓名重名，需人工确认' : '通讯录未找到同名', candidates: candidates.map(function (m) { return m.userid; }) });
      return;
    }
    const m = candidates[0];
    const same = a.wecom_userid === m.userid && a.userid_verified === true;
    report.push({ name: a.name, id: id, result: same ? '已一致' : '校正：' + a.wecom_userid + ' → ' + m.userid, userid: m.userid });
    if (!same) {
      a.wecom_userid = m.userid;
      a.userid_verified = true;
      a.wecom_department = m.department;
      changed++;
    }
  });

  const need = report.filter(function (r) { return r.result !== '已一致'; });
  console.log('\n匹配结果：' + report.length + ' 人，需处理 ' + need.length + ' 人');
  need.slice(0, 80).forEach(function (r) { console.log('  ' + r.name + ' [' + r.id + '] ' + r.result); });

  if (!APPLY) {
    console.log('\n预览模式，未写入。确认无误后加 --apply 执行。');
    return;
  }
  fs.writeFileSync(accPath, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  console.log('\n已写入 ' + changed + ' 人的 userid 校正。需重启服务生效。');
}

main().catch(function (e) { console.error('同步失败：' + e.message); process.exitCode = 1; });
