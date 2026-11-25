/* 身份层：演示身份切换 + 企业微信身份接入适配
 *
 * 正式接入后：企业微信打开 → 带 code → 后端 jscode2session/user/get →
 * 返回 { id, name, role, stores, zone, department, supplier } → Session.current() 口径不变，
 * 页面代码不用改。演示模式仍可在「我的」里切换身份。
 */
(function (global) {
  const seed = global.BIZ.seed;
  const K = (global.APP_CONFIG && APP_CONFIG.prefix || 'anju_h5_') + 'identity';
  const K_PROFILE = (global.APP_CONFIG && APP_CONFIG.prefix || 'anju_h5_') + 'profile';
  const DEFAULT_ID = 'TEST-STORE-A';

  const DEPARTMENT_DEMO = {
    id: 'TEST-DEPT-01',
    name: '职能部门采购员',
    short: '职能部门',
    role: 'department',
    department: '人力资源部',
    zone: null,
    stores: [],
    desc: '演示通用身份（企业微信接入后按通讯录部门识别）'
  };

  let external = null;
  let wecomError = '';
  let wecomChecked = false;

  function supplierProfiles() {
    return seed.SUPPLIERS.map(function (name, i) {
      return {
        id: 'TEST-SUPPLIER-' + (i + 1),
        name: name,
        short: name,
        role: 'supplier',
        supplier: name,
        zone: null,
        stores: [],
        desc: '外部供应商账号 · 仅接单 / 发货 / 对账确认'
      };
    });
  }

  function all() {
    const staff = seed.STAFF.map(function (x) {
      const p = Object.assign({ short: x.name }, x);
      if (p.role === 'central' && !p.department) p.department = '运营管理部';
      return p;
    });
    return staff.concat([DEPARTMENT_DEMO], supplierProfiles());
  }

  function findById(id) {
    const list = all();
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    if (/^TEST-DEPT-\d+$/.test(String(id || ''))) return DEPARTMENT_DEMO;
    return null;
  }

  function storedId() {
    try { return localStorage.getItem(K) || ''; } catch (e) { return ''; }
  }

  function current() {
    if (external) return external;
    return findById(storedId()) || findById(DEFAULT_ID);
  }

  function switchTo(id) {
    const p = findById(id);
    if (!p) throw new Error('身份不存在');
    if (external) {
      // 企业微信身份下不允许前端切角色（生产语义），但仍允许回演示环境
      throw new Error('当前为企业微信登录，身份由组织架构决定');
    }
    try { localStorage.setItem(K, id); } catch (e) { /* ignore */ }
    return p;
  }

  function grouped() {
    const list = all();
    return [
      { key: 'store', title: '门店店长', note: '下单 / 验收 / 撤销', items: list.filter(function (x) { return x.role === 'store'; }) },
      { key: 'region', title: '战区负责人', note: '本战区审批', items: list.filter(function (x) { return x.role === 'region'; }) },
      { key: 'central', title: '运营管理部（中台）', note: '预算核定 / 对账', items: list.filter(function (x) { return x.role === 'central'; }) },
      { key: 'department', title: '职能部门', note: '部门采购', items: list.filter(function (x) { return x.role === 'department'; }) },
      { key: 'supplier', title: '供应商', note: '接单 / 发货', items: list.filter(function (x) { return x.role === 'supplier'; }) }
    ];
  }

  function scopeOf(me) {
    if (!me) return '';
    if (me.role === 'store') return (me.stores || []).join(' / ');
    if (me.role === 'region') return me.zone + ' · 下属门店';
    if (me.role === 'central') return '全公司 · 预算与对账';
    if (me.role === 'department') return (me.department || '') + ' · 部门采购';
    if (me.role === 'supplier') return '外部供应商 · ' + me.supplier;
    return '';
  }

  function avatarOf(me) {
    if (!me) return '?';
    if (me.role === 'supplier') return '供';
    if (me.role === 'central') return '中';
    if (me.role === 'department') return '部';
    if (me.role === 'region') return '战';
    return (me.name || '店').slice(0, 1);
  }

  function normalize(raw) {
    if (!raw || !raw.role) return null;
    const valid = ['store', 'region', 'central', 'department', 'supplier'];
    if (valid.indexOf(raw.role) < 0) return null;
    return {
      id: String(raw.id || raw.userid || 'WX-USER'),
      name: String(raw.name || raw.userid || '企业成员'),
      short: String(raw.short || raw.name || ''),
      role: raw.role,
      zone: raw.zone || null,
      stores: Array.isArray(raw.stores) ? raw.stores : [],
      department: raw.department || null,
      supplier: raw.supplier || null,
      desc: raw.desc || '企业微信身份',
      fromWecom: true
    };
  }

  // 企业微信免登：应用主页带 code 打开时，交给后端换身份
  function bootstrap() {
    const cfg = (global.APP_CONFIG && APP_CONFIG.wecom) || {};
    const params = new URLSearchParams(location.search);
    const code = params.get('code');

    if (!cfg.enabled) {
      wecomChecked = true;
      return Promise.resolve(null);
    }

    if (code && cfg.apiBase) {
      wecomChecked = true;
      const url = cfg.apiBase + (cfg.entryPath || '/auth/wecom') + '?code=' + encodeURIComponent(code);
      return fetch(url, { credentials: 'include' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          const p = normalize(data && (data.profile || data.user));
          if (!p) throw new Error((data && data.message) || '后端未返回可用身份');
          external = p;
          try { localStorage.setItem(K_PROFILE, JSON.stringify(p)); } catch (e) { /* ignore */ }
          return p;
        })
        .catch(function (err) {
          wecomError = err.message || '企业微信身份换取失败';
          return null;
        });
    }

    // 同一会话内刷新：沿用上次换到的身份
    try {
      const saved = JSON.parse(localStorage.getItem(K_PROFILE) || 'null');
      if (saved && saved.role) external = saved;
    } catch (e) { /* ignore */ }
    wecomChecked = true;
    return Promise.resolve(external);
  }

  function wecomState() {
    const cfg = (global.APP_CONFIG && APP_CONFIG.wecom) || {};
    if (!cfg.enabled) return { state: 'off', text: '未启用（演示模式）' };
    if (external) return { state: 'on', text: '已通过企业微信识别：' + external.name };
    if (wecomError) return { state: 'error', text: wecomError };
    return { state: 'wait', text: wecomChecked ? '已启用，等待企业微信授权' : '检测中' };
  }

  // 共享模式：身份由服务端按访问令牌下发，前端不能自行切换角色
  function setExternal(p) {
    external = normalize(p) || p || null;
    if (external) {
      try { localStorage.setItem(K_PROFILE, JSON.stringify(external)); } catch (e) { /* ignore */ }
    }
    return external;
  }

  function logout() {
    external = null;
    wecomError = '';
    try {
      localStorage.removeItem(K_PROFILE);
      localStorage.removeItem(K);
    } catch (e) { /* ignore */ }
  }

  global.Session = {
    all: all,
    findById: findById,
    current: current,
    switchTo: switchTo,
    setExternal: setExternal,
    grouped: grouped,
    scopeOf: scopeOf,
    avatarOf: avatarOf,
    bootstrap: bootstrap,
    wecomState: wecomState,
    logout: logout,
    isExternal: function () { return !!external; }
  };
})(window);
