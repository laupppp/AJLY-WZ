/* 我的：身份、权限、企业微信接入说明、演示工具 */
(function (Views) {
  Views.profile = function (root, r, ctx) {
    const me = ctx.me;
    const meta = BIZ.perm.roleMeta(me.role);
    const caps = BIZ.perm.caps(me.role);
    const wecom = Session.wecomState();
    const usage = Store.usage();
    const demoOn = Store.isDemo();
    const cfg = APP_CONFIG.wecom;

    const CAP_LABEL = {
      'order.create': '采购下单',
      'order.view': '订单查看',
      'accept': '收货验收',
      'draft': '存草稿',
      'stats': '统计看板',
      'approve': '审批',
      'recon': '生成/锁定对账',
      'supply': '接单与发货',
      'recon.confirm': '对账确认',
      'settle.submit': '确认结算金额',
      'settle.confirm': '确认结算金额',
      'budget.config': '门店预算设置',
      'catalog.manage': '中台物资/规则管理'
    };

    root.innerHTML =
      '<div class="card card-pad">' +
        '<div class="row">' +
          '<div class="side-logo" style="background:linear-gradient(145deg,#1b4064,#2f74b3);width:52px;height:52px;border-radius:15px;font-size:21px;border:0">' + UI.esc(Session.avatarOf(me)) + '</div>' +
          '<div class="grow" style="min-width:0">' +
            '<div class="strong" style="font-size:17px">' + UI.esc(me.name) + '</div>' +
            '<div class="small muted mt4">' + UI.esc(meta.label) + ' · ' + UI.esc(meta.duty) + '</div>' +
          '</div>' +
          (Session.isExternal() ? '<span class="pill good">企业微信</span>' : '<span class="pill line">演示身份</span>') +
        '</div>' +
        '<div class="divider"></div>' +
        '<div class="kv"><span class="k">数据范围</span><span class="v">' + UI.esc(Session.scopeOf(me)) + '</span></div>' +
        '<div class="kv"><span class="k">账号 ID</span><span class="v mono">' + UI.esc(me.id) + '</span></div>' +
        (me.role === 'supplier'
          ? '<div class="kv"><span class="k">账号类型</span><span class="v">外部供应商 · 仅开放接单、发货、对账确认，看不到其他供应商与门店预算</span></div>'
          : '') +
        '<div class="tag-line">' + caps.map(function (c) {
          return '<span class="mini-tag">' + UI.esc(CAP_LABEL[c] || c) + '</span>';
        }).join('') + '</div>' +
      '</div>' +

      (me.role === 'central'
        ? '<div class="card card-pad mt12">' +
            '<a class="tbl-link" href="#/console" style="display:flex;align-items:center;justify-content:space-between">' +
              '<span><span class="section-title">中台操作台</span>' +
              '<span class="tiny muted" style="display:block;margin-top:4px">物资增删改、供应商合同上限与审批规则配置</span></span>' +
              UI.icon('right', 'sm') + '</a>' +
          '</div>'
        : '') +

      '<div class="card card-pad mt12">' +
        '<a class="tbl-link" href="#/guide" style="display:flex;align-items:center;justify-content:space-between">' +
          '<span><span class="section-title">采购说明</span>' +
          '<span class="tiny muted" style="display:block;margin-top:4px">流程、审批分级、预算规则与结算口径</span></span>' +
          UI.icon('right', 'sm') + '</a>' +
      '</div>' +

      '<div class="card card-pad mt12">' +
        '<div class="between mb8"><span class="section-title">企业微信接入</span>' +
          '<span class="pill ' + (wecom.state === 'on' ? 'good' : wecom.state === 'error' ? 'bad' : wecom.state === 'off' ? 'gray' : 'info') + '">' +
          (wecom.state === 'on' ? '已连接' : wecom.state === 'off' ? '未启用' : wecom.state === 'error' ? '异常' : '待授权') + '</span></div>' +
        '<div class="small muted" style="line-height:1.6">' + UI.esc(wecom.text) + '</div>' +
        '<div class="divider"></div>' +
        '<div class="pref-list">' +
          '<div class="pref-item"><span class="n">1</span><div><div class="t">企业微信后台创建自建应用</div>' +
            '<div class="d">拿到 CorpID、AgentId、Secret；配置应用主页为本页地址，并设置可见范围。</div></div></div>' +
          '<div class="pref-item"><span class="n">2</span><div><div class="t">配置可信域名与 HTTPS</div>' +
            '<div class="d">域名需 ICP 备案且与企业主体一致，上传校验文件；企业微信内置浏览器要求公网可访问。</div></div></div>' +
          '<div class="pref-item"><span class="n">3</span><div><div class="t">后端实现免登接口</div>' +
            '<div class="d">code → getuserinfo 拿 UserId → user/get 拿部门/职务/isleader → 映射成门店店长/战区/中台/部门角色 → 签发 token。</div></div></div>' +
          '<div class="pref-item"><span class="n">4</span><div><div class="t">供应商单独开账号</div>' +
            '<div class="d">为每家供应商建一个企业微信成员账号（或上下游联系人），应用可见范围只勾选他们，账号只进「供应商工作台」，看不到内部订单与预算。</div></div></div>' +
          '<div class="pref-item"><span class="n">5</span><div><div class="t">待办推送</div>' +
            '<div class="d">用应用消息 message/send 按 userid 推送「有单待审批 / 已超时」，无需用户逐次授权订阅。</div></div></div>' +
        '</div>' +
        '<div class="note-box mt12">当前配置：CorpID ' + (cfg.corpid ? UI.esc(cfg.corpid) : '<b>未填写</b>') +
          ' · AgentId ' + (cfg.agentId ? UI.esc(cfg.agentId) : '<b>未填写</b>') +
          ' · 接口 ' + (cfg.apiBase ? UI.esc(cfg.apiBase) : '<b>未填写</b>') +
          '<br>填好 <span class="mono">h5/js/config.js</span> 并把 <span class="mono">wecom.enabled</span> 改为 true，即切换为真实身份。</div>' +
      '</div>' +

      '<div class="card card-pad mt12">' +
        '<div class="section-title mb8">演示工具</div>' +
        (demoOn
          ? '<a class="btn ghost block" href="#/login" style="margin-bottom:8px">' + UI.icon('user', 'sm') + '切换演示身份</a>'
          : '<div class="note-box mb8">演示模式已关闭：首页不再显示身份切换入口，适合对外演示。</div>') +
        '<div class="between" style="padding:10px 0;border-top:1px solid var(--line-2)">' +
          '<div><div class="small">演示模式</div><div class="tiny muted">关闭后隐藏演示痕迹</div></div>' +
          '<button class="btn sm ' + (demoOn ? 'soft' : 'ghost') + '" id="demo-toggle">' + (demoOn ? '已开启' : '已关闭') + '</button>' +
        '</div>' +
        '<div class="between" style="padding:10px 0;border-top:1px solid var(--line-2)">' +
          '<div><div class="small">本地数据占用</div><div class="tiny muted">订单、草稿、验收照片</div></div>' +
          '<span class="small mono">' + usage.kb + ' KB</span>' +
        '</div>' +
        '<button class="btn danger block mt8" id="reset">重置演示数据</button>' +
        '<div class="tiny muted" style="text-align:center;margin-top:8px">重置会清空本机订单、草稿与照片，恢复为初始 12 笔演示订单</div>' +
      '</div>' +

      (typeof Remote !== 'undefined' && Remote.enabled
        ? '<div class="card card-pad mt12">' +
            '<div class="section-title mb8">账号</div>' +
            '<div class="tiny muted" style="margin-bottom:10px">当前身份：' + UI.esc(me.name) + '（' + UI.esc(me.id) + '）</div>' +
            '<button class="btn ghost block" id="remote-logout">退出登录 / 切换账号</button>' +
          '</div>'
        : '') +

      '<div class="card card-pad mt12">' +
        '<div class="section-title mb8">关于</div>' +
        '<div class="kv"><span class="k">系统</span><span class="v">' + UI.esc(APP_CONFIG.brand) + '</span></div>' +
        '<div class="kv"><span class="k">版本</span><span class="v">' + UI.esc(APP_CONFIG.version) + ' · H5</span></div>' +
        '<div class="kv"><span class="k">业务规则</span><span class="v">与小程序版共用同一套 domain / perm 代码</span></div>' +
        '<div class="note-box mt8">所有数据均为虚构演示数据，仅保存在当前浏览器。换设备或清缓存后会恢复初始状态。</div>' +
      '</div>';

    root.querySelector('#demo-toggle').onclick = function () {
      const next = !Store.isDemo();
      Store.setDemo(next);
      UI.toast(next ? '演示模式已开启' : '演示模式已关闭', 'good');
      App.reload();
    };

    root.querySelector('#reset').onclick = function () {
      UI.confirm({
        title: '重置演示数据？',
        sub: '本机所有订单进度、草稿和验收照片会被清空，恢复到初始 12 笔订单。',
        okText: '确认重置', danger: true
      }).then(function (ok) {
        if (!ok) return;
        Store.resetState();
        UI.toast('已恢复初始演示数据', 'good');
        App.go('/home');
      });
    };

    const logoutBtn = root.querySelector('#remote-logout');
    if (logoutBtn) {
      logoutBtn.onclick = function () {
        UI.confirm({
          title: '退出登录？',
          sub: '退出后可以用其他账号密码或令牌重新进入，数据不会丢失。',
          okText: '退出'
        }).then(function (ok) {
          if (ok && typeof Remote !== 'undefined' && Remote.logout) Remote.logout();
        });
      };
    }
  };
})(window.Views);
