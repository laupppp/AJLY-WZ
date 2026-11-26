/* 共享模式桥接层
 *
 * 放在 biz.js 之后、页面脚本之前加载：把 BIZ.domain 包一层代理，页面顶部
 * `const domain = BIZ.domain` 拿到的就是代理。App.mutate 执行业务动作时，
 * 代理把「以 state 为首参的调用」录成 {name, args}，交给服务端用真实身份重放。
 *
 * 于是：页面代码一行不改，数据却从「每人一份浏览器缓存」变成「服务端一份 SQLite」，
 * 权限判定也留在服务端（前端传的身份不被信任）。
 *
 * demo 模式（GitHub Pages / 双击 standalone.html）下本层完全不生效。
 */
(function (global) {
  const cfg = (global.APP_CONFIG && APP_CONFIG.remote) || {};
  const ENABLED = !!cfg.enabled;
  const API = cfg.apiBase || '';
  const PREFIX = (global.APP_CONFIG && APP_CONFIG.prefix) || 'anju_h5_';
  const TOKEN_KEY = PREFIX + 'token';

  let token = '';
  let recording = null;
  let busy = false;
  let profile = null;

  function toast(msg, kind) {
    if (global.UI && UI.toast) UI.toast(msg, kind || '', 3200);
    else console.log('[remote] ' + msg);
  }
  function auth() { return { Authorization: 'Bearer ' + token }; }
  function getToken(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function setToken(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch (e) { /* ignore */ } }

  /* ---------- 1. 录制代理 ---------- */
  if (ENABLED && global.BIZ && BIZ.domain) {
    const raw = BIZ.domain;
    const wrapped = new Map();
    BIZ.domain = new Proxy(raw, {
      get: function (target, key) {
        const value = target[key];
        if (typeof value !== 'function') return value;
        if (wrapped.has(key)) return wrapped.get(key);
        const proxyFn = function () {
          const args = [].slice.call(arguments);
          // 只录制以当前 state 为首参的调用；读函数同样录制，服务端会安全跳过
          if (recording && args[0] === recording.st) {
            recording.calls.push({ name: String(key), args: args.slice(2) });
          }
          return value.apply(target, args);
        };
        wrapped.set(key, proxyFn);
        return proxyFn;
      }
    });
  }

  function record(st, fn, me) {
    if (!ENABLED) return { result: fn(st, me), calls: [] };
    const prev = recording;
    recording = { st: st, calls: [] };
    try {
      return { result: fn(st, me), calls: recording.calls.slice() };
    } finally {
      recording = prev;
    }
  }

  /* ---------- 2. 服务端状态写入本地缓存 ---------- */
  function applyState(state) {
    if (!state) return;
    if (global.Store && Store.replaceState) Store.replaceState(state);
  }

  /* ---------- 3. 提交动作 ---------- */
  function commit(calls, beforeSnapshot) {
    if (!ENABLED || !calls || !calls.length) return;
    busy = true;
    const rev = (global.Store && Store.loadState().revision) || 0;
    return fetch(API + '/api/action', {
      method: 'POST',
      headers: Object.assign(auth(), { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ revision: rev - 1, calls: calls })
    }).then(function (r) {
      if (r.status === 401) throw new Error('访问令牌已失效，请重新登录');
      return r.json();
    }).then(function (data) {
      if (data.state) applyState(data.state);
      if (data.error) {
        toast(data.error, 'warn');
      }
      // 成功或拒绝后都用服务端权威 state 重绘，保证各端一致
      if (global.App && App.reload) App.reload();
    }).catch(function (err) {
      // 服务端不可达：撤销本次乐观修改，避免本地与服务端长期分叉
      try { applyState(JSON.parse(beforeSnapshot)); } catch (e) { /* ignore */ }
      toast('连不上服务端，本次操作已撤销：' + (err.message || '网络错误'), 'warn');
      if (global.App && App.reload) App.reload();
    }).then(function () { busy = false; });
  }

  /* ---------- 4. 拉取最新状态 ---------- */
  function pull(force) {
    if (!ENABLED || !token) return Promise.resolve(null);
    let url = API + '/api/state';
    if (!force) url += '?since=' + ((global.Store && Store.loadState().revision) || 0);
    return fetch(url, { headers: auth() })
      .then(function (r) {
        if (r.status === 401) throw new Error('访问令牌已失效');
        return r.json();
      })
      .then(function (data) {
        if (!data.state) return null;
        applyState(data.state);
        return data.state;
      });
  }

  /* ---------- 5. 登录遮罩 ---------- */
  function showLogin(message) {
    let mode = 'password';
    const host = document.createElement('div');
    host.id = 'remote-login';
    host.setAttribute('style', 'position:fixed;inset:0;z-index:99999;background:#f3f6fa;display:flex;align-items:center;justify-content:center;padding:20px;font:15px/1.6 system-ui,-apple-system,sans-serif;color:#17253a');

    function render(msg) {
      const fieldStyle = 'width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #9aaabc;border-radius:8px;font-size:15px;margin-bottom:12px';
      const fields = mode === 'password'
        ? '<input id="remote-user" type="text" placeholder="用户名" autocomplete="username" style="' + fieldStyle + '" />' +
          '<input id="remote-pass" type="password" placeholder="密码" autocomplete="current-password" style="' + fieldStyle + '" />'
        : '<input id="remote-token" type="password" placeholder="粘贴访问令牌" autocomplete="off" style="' + fieldStyle + '" />';
      host.innerHTML =
        '<div style="width:100%;max-width:420px;background:#fff;border:1px solid #dce4ee;border-radius:14px;padding:28px">' +
        '<div style="font-size:19px;font-weight:600;margin-bottom:6px">安居乐寓物资采购</div>' +
        '<div style="color:#66788f;font-size:13px;margin-bottom:20px">共享试用版 · ' +
          (mode === 'password' ? '请用管理员发的账号密码登录' : '请输入管理员发给你的访问令牌') + '</div>' +
        (msg ? '<div style="background:#fff3f3;color:#a32d2d;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:14px">' + String(msg).replace(/</g, '&lt;') + '</div>' : '') +
        fields +
        '<button id="remote-login-btn" style="width:100%;padding:11px;border:0;border-radius:8px;background:#164e87;color:#fff;font-size:15px;cursor:pointer">进入系统</button>' +
        '<div style="text-align:center;margin-top:12px"><a id="remote-mode-btn" href="javascript:;" style="color:#164e87;font-size:13px">' +
          (mode === 'password' ? '改用访问令牌登录' : '改用账号密码登录') + '</a></div>' +
        '<div style="color:#92a1b3;font-size:12px;margin-top:14px">身份由服务端判定，进入后不能自行切换角色。</div>' +
        '</div>';

      const btn = document.getElementById('remote-login-btn');
      const submit = function () {
        if (mode === 'token') {
          const input = document.getElementById('remote-token');
          const v = (input.value || '').trim().replace(/^Bearer\s+/i, '');
          if (!v) { input.focus(); return; }
          setToken(v);
          location.reload();
          return;
        }
        const u = document.getElementById('remote-user').value.trim();
        const p = document.getElementById('remote-pass').value;
        if (!u || !p) { render('请输入用户名和密码'); return; }
        btn.disabled = true;
        btn.textContent = '登录中...';
        fetch(API + '/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p })
        })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
          .then(function (res) {
            if (!res.ok) throw new Error(res.data.error || '登录失败');
            setToken(res.data.token);
            location.reload();
          })
          .catch(function (e) { render(e.message || '登录失败，请重试'); });
      };
      btn.onclick = submit;
      document.getElementById('remote-mode-btn').onclick = function () {
        mode = mode === 'password' ? 'token' : 'password';
        render('');
      };
      const first = document.getElementById(mode === 'password' ? 'remote-user' : 'remote-token');
      const last = document.getElementById(mode === 'password' ? 'remote-pass' : 'remote-token');
      if (last) last.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
      if (first) first.focus();
    }

    (document.body || document.documentElement).appendChild(host);
    render(message);
  }

  /* ---------- 6. 启动 ---------- */
  function ready() {
    if (!ENABLED) return Promise.resolve(null);

    // 支持一次性链接：?token=xxxx（管理员可直接把带令牌的链接发给门店）
    const fromUrl = new URLSearchParams(location.search).get('token');
    if (fromUrl) {
      setToken(fromUrl.trim().replace(/^Bearer\s+/i, ''));
      try {
        const u = new URL(location.href);
        u.searchParams.delete('token');
        history.replaceState(null, '', u.toString());
      } catch (e) { /* ignore */ }
    }
    token = getToken(TOKEN_KEY);
    if (!token) {
      showLogin('');
      return new Promise(function () { /* 登录成功后整页重载，这里刻意不 resolve */ });
    }

    return fetch(API + '/api/account', { headers: auth() })
      .then(function (r) {
        if (r.status === 401) throw new Error('访问令牌无效，请向管理员索取');
        return r.json();
      })
      .then(function (data) {
        profile = data.profile;
        if (global.Session && Session.setExternal) Session.setExternal(profile);
        return pull(true);
      })
      .then(function () {
        if (global.App && App.reload) App.reload();
        startPolling();
        return profile;
      })
      .catch(function (err) {
        setToken('');
        showLogin(err.message || '连不上服务端');
        return new Promise(function () { /* 同上 */ });
      });
  }

  function startPolling() {
    const ms = Number(cfg.pollMs || 4000);
    setInterval(function () {
      if (busy || document.hidden || profile == null) return;
      pull(false).then(function (state) {
        if (state && global.App && App.reload) {
          App.reload();
          toast('已同步到其他人的最新操作');
        }
      }).catch(function () { /* 离线时静默，不打扰使用 */ });
    }, ms);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || busy) return;
      pull(false).then(function (state) { if (state && global.App && App.reload) App.reload(); }).catch(function () {});
    });
  }

  global.Remote = {
    enabled: ENABLED,
    ready: ready,
    record: record,
    commit: commit,
    pull: pull,
    token: function () { return token; },
    logout: function () {
      setToken('');
      location.reload();
    }
  };
})(window);
