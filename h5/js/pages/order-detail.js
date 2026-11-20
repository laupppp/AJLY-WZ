/* 订单详情：进度、商品、供应商履约、验收记录、审批留痕与可执行动作 */
(function (Views) {
  const SHIP = BIZ.domain.SHIPPING_METHODS;

  function findOrder(state, me, id) {
    return BIZ.domain.visibleOrders(state, me).filter(function (o) { return o.id === id; })[0];
  }

  function supplierStatus(status) {
    return UI.supplierStatusText(status);
  }

  Views.order = function (root, r, ctx) {
    const domain = BIZ.domain;
    const me = ctx.me;
    const state = ctx.state;
    const id = r.params[0];
    const order = findOrder(state, me, id);

    if (!order) {
      root.innerHTML = UI.empty('🔒', '订单不存在或无权查看', '请确认订单号，或切换为对应门店/部门身份');
      return;
    }

    const pendingApprovals = domain.pendingApprovals(state, me).some(function (o) { return o.id === order.id; });
    const canAccept = domain.canAcceptOrder(order, me) &&
      ['delivering', 'delivered', 'partial'].indexOf(order.status) >= 0 &&
      (order.items || []).some(function (x) { return Number(x.deliveredQty || 0) > Number(x.accepted || 0); });
    // 门店单先经战区审核，该阶段也应允许提交人撤销（与小程序一致）
    const canCancel = (me.role === 'store' || me.role === 'department') &&
      order.submittedBy === me.id &&
      ['order-review', 'budget-region', 'budget-central', 'amount-approval', 'supplier', 'dept-approval'].indexOf(order.status) >= 0;
    const canClose = me.role === 'central' && ['supplier', 'preparing'].indexOf(order.status) >= 0;
    const canSupply = me.role === 'supplier' && !!(order.supplierRecords || {})[me.supplier];
    const canReorder = BIZ.perm.can(me, 'order.create');
    const mySub = me.role === 'supplier' && (order.items || []).some(function (x) { return x.supplier === me.supplier; });
    // 结算共同确认入口：门店填金额、供应商确认/异议
    const canSettle = !!domain.settleActorOf(order, me) &&
      ['settle-pending', 'settle-disputed'].indexOf(order.status) >= 0;
    const canSettleConfirm = me.role === 'supplier' && order.status === 'settle-supplier' && mySub;
    const settleText = order.status === 'settle-pending' ? '待门店确认结算金额'
      : order.status === 'settle-supplier' ? '待供应商确认结算金额'
        : order.status === 'settle-disputed' ? '供应商提出异议，待门店重提'
          : order.status === 'accepted' ? '结算金额已双方确认，待统一对账' : '';
    const S = order.settlement || null;
    const settleStatusText = S ? ({
      'pending-store': '待门店提交', 'pending-supplier': '待供应商确认',
      confirmed: '双方已确认', disputed: '供应商已提异议'
    }[S.status] || '待门店提交') : '';

    const steps = UI.stepsOf(order);
    const sla = domain.slaForOrder(state, order.id);
    const audits = Store.listAudit(order.id).slice().sort(function (a, b) {
      return String(a.at || '').localeCompare(String(b.at || ''));
    });

    const records = Object.keys(order.supplierRecords || {}).map(function (name) {
      return { name: name, rec: order.supplierRecords[name] };
    });

    const acceptances = (order.acceptances || []).slice().reverse();
    const issues = (order.acceptanceIssues || []).slice().reverse();

    function itemTags(x) {
      let html = '';
      if (Number(x.accepted || 0) > 0) html += '<span class="item-tag">已验收 ' + x.accepted + '</span>';
      if (Number(x.reconciled || 0) > 0) html += '<span class="item-tag">已对账 ' + x.reconciled + '</span>';
      if (Number(x.deliveredQty || 0) > 0 && Number(x.deliveredQty) < x.qty) html += '<span class="item-tag">已发 ' + x.deliveredQty + '</span>';
      return html;
    }

    const heroMeta = [
      order.purchaseType === 'department' ? ('部门 · ' + (order.department || '')) : order.store,
      '提交人 ' + (order.manager || ''),
      BIZ.fmt.fullTime(order.createdAt) || order.created,
      '档位 ' + (BIZ.fmt.TIER_LABEL[order.tier] || '')
    ];

    root.innerHTML =
      '<div class="detail-hero">' +
        '<div class="st">' + UI.icon('box', 'sm') + UI.statusPill(order.status) +
          (sla ? '<span style="color:rgba(255,255,255,.8);font-size:11px">' + BIZ.fmt.hoursText(sla.hours) + (sla.level === 'overdue' ? ' 已超时' : ' 未处理') + '</span>' : '') +
        '</div>' +
        '<div class="id">' + UI.esc(order.id) +
          '<button class="icon-btn plain" id="copy-id" style="color:#fff;width:26px;height:26px;vertical-align:2px" title="复制单号">' + UI.icon('copy', 'xs') + '</button>' +
        '</div>' +
        '<div class="amt">¥' + UI.money(order.total) + '<small>含 ' + (order.items || []).length + ' 种商品</small></div>' +
        '<div class="meta">' + heroMeta.map(function (t) { return '<span>' + UI.esc(t) + '</span>'; }).join('') + '</div>' +
        '<div class="steps">' + steps.map(function (s) {
          return '<div class="step' + (s.done ? ' done' : '') + (s.active ? ' active' : '') + '"><i></i><span>' + s.label + '</span></div>';
        }).join('') + '</div>' +
      '</div>' +

      (order.status === 'cancelled' && order.closeReason
        ? '<div class="alert mt12">' + UI.icon('alert', 'sm') + '<span>' + UI.esc(order.closeReason) + '</span></div>'
        : '') +

      '<div class="card card-pad mt12">' +
        '<div class="section-title mb8">单据信息</div>' +
        '<div class="kv"><span class="k">收货地点</span><span class="v">' + UI.esc(order.store || '') + '</span></div>' +
        '<div class="kv"><span class="k">收货人</span><span class="v">' + UI.esc(order.receiver || '') + '</span></div>' +
        '<div class="kv"><span class="k">地址</span><span class="v">' + UI.esc(order.address || '') + '</span></div>' +
        '<div class="kv"><span class="k">用途</span><span class="v">' + UI.esc(order.purpose || '') + '</span></div>' +
        '<div class="kv"><span class="k">期望到货</span><span class="v">' + UI.esc(order.due || '待供应商确认') + '</span></div>' +
        (order.note ? '<div class="kv"><span class="k">备注</span><span class="v">' + UI.esc(order.note) + '</span></div>' : '') +
        (order.budgetApplied && order.budgetTransfer
          ? '<div class="kv"><span class="k">追加预算</span><span class="v">¥' + UI.money(order.budgetTransfer) + '（从机动池核定）</span></div>'
          : '') +
        (order.groupId
          ? '<div class="kv"><span class="k">采购批次</span><span class="v mono">' + UI.esc(order.groupId) + '</span></div>'
          : '') +
      '</div>' +

      '<div class="card card-pad mt12">' +
        '<div class="between mb8"><span class="section-title">商品明细</span>' +
          '<span class="tiny muted">' + (order.items || []).length + ' 种</span></div>' +
        (order.items || []).map(function (x) {
          return '<div class="item-line"><span class="nm">' + UI.esc(x.name) + itemTags(x) +
            '<small>' + UI.esc(x.spec || '') + ' · ' + UI.esc(x.supplier || '') + '</small></span>' +
            '<span class="qty">×' + x.qty + '</span>' +
            '<span class="amt">¥' + UI.money(Number(x.price || 0) * Number(x.qty || 0)) + '</span></div>';
        }).join('') +
        '<div class="divider"></div>' +
        '<div class="between"><span class="small muted">合计</span><span class="money" style="font-size:17px">¥' + UI.money(order.total) + '</span></div>' +
      '</div>' +

      '<div class="card card-pad mt12">' +
        '<div class="section-title mb8">供应商履约</div>' +
        records.map(function (x) {
          const rec = x.rec;
          const deliveries = rec.deliveries || [];
          return '<div class="rec-block">' +
            '<div class="rec-head">' + UI.icon('truck', 'sm') + '<span class="rec-name">' + UI.esc(x.name) + '</span>' +
              UI.supplierPill(rec.status) + '</div>' +
            (rec.issue ? '<div class="tiny" style="color:var(--bad);margin-top:6px">拒单原因：' + UI.esc(rec.issue) + '</div>' : '') +
            (deliveries.length
              ? deliveries.map(function (d) {
                  const sp = d.shipping || {};
                  return '<div class="rec-del">' +
                    '<div class="between"><span class="strong">第 ' + d.batchNo + ' 批</span>' +
                      '<span class="tiny muted">' + UI.esc(BIZ.fmt.fullTime(d.at)) + '</span></div>' +
                    '<div class="tiny muted mt4">' + UI.esc(SHIP[sp.method] || sp.method || '') +
                      (sp.carrier ? ' · ' + UI.esc(sp.carrier) : '') +
                      (sp.trackingNo ? ' · 单号 ' + UI.esc(sp.trackingNo) : '') + '</div>' +
                    '<div class="tiny muted">' + (sp.contact ? '联系人 ' + UI.esc(sp.contact) + ' · ' : '') +
                      (sp.estimatedAt ? '预计 ' + UI.esc(UI.dateTimeText(sp.estimatedAt)) : '') + '</div>' +
                    '<div class="tiny" style="margin-top:4px">' + d.lines.map(function (l) {
                      return UI.esc(l.name) + ' ×' + l.qty;
                    }).join('、') + '</div>' +
                  '</div>';
                }).join('')
              : '<div class="tiny muted" style="margin-top:6px">' + (rec.status === 'pending' ? '等待供应商接单' : rec.status === 'issue' ? '供应商反馈无法接单' : '尚未登记配送') + '</div>') +
          '</div>';
        }).join('') +
      '</div>' +

      (acceptances.length || issues.length
        ? '<div class="card card-pad mt12">' +
            '<div class="section-title mb8">验收记录</div>' +
            acceptances.map(function (a) {
              return '<div class="rec-block"><div class="between"><span class="strong">第 ' + a.batchNo + ' 批 · 验收合格</span>' +
                '<span class="tiny muted">' + UI.esc(BIZ.fmt.fullTime(a.at)) + '</span></div>' +
                '<div class="tiny muted mt4">' + UI.esc(a.byName || a.by || '') + (a.note ? ' · ' + UI.esc(a.note) : '') + '</div>' +
                '<div class="tiny mt4">' + (a.lines || []).map(function (l) { return UI.esc(l.name) + ' ×' + l.qty; }).join('、') + '</div>' +
                (a.noPhoto ? '<div class="tiny" style="color:var(--warn);margin-top:4px">演示环境无照片留证</div>' : '') +
              '</div>';
            }).join('') +
            issues.map(function (a) {
              return '<div class="rec-block" style="border-color:#f6d9d4;background:#fffaf9">' +
                '<div class="between"><span class="strong" style="color:var(--bad)">第 ' + a.batchNo + ' 批 · 异常反馈</span>' +
                '<span class="tiny muted">' + UI.esc(BIZ.fmt.fullTime(a.at)) + '</span></div>' +
                '<div class="tiny mt4">' + UI.esc(a.note || '') + '</div></div>';
            }).join('') +
          '</div>'
        : '') +

      // 结算金额共同确认：验收完成后由门店填报、供应商确认，双方一致才进入对账
      ((S || settleText)
        ? '<div class="card card-pad mt12">' +
            '<div class="between mb8"><span class="section-title">结算金额</span>' +
              '<span class="pill ' + (S && S.status === 'confirmed' ? 'good' : 'warn') + '">' + UI.esc(S ? settleStatusText : settleText) + '</span></div>' +
            (S
              ? '<div class="kv"><span class="k">结算金额</span><span class="v money">¥' + UI.money(S.amount) + '</span></div>' +
                '<div class="kv"><span class="k">实收核算</span><span class="v num">¥' + UI.money(S.itemsAmount) + '</span></div>' +
                (Math.abs(Number(S.diff || 0)) > 0.004
                  ? '<div class="kv"><span class="k">差异</span><span class="v">' + (Number(S.diff) < 0 ? '少结' : '多结') + ' ¥' + UI.money(Math.abs(Number(S.diff))) + '</span></div>' : '') +
                (S.reason ? '<div class="kv"><span class="k">差异原因</span><span class="v">' + UI.esc(S.reason) + '</span></div>' : '') +
                '<div class="kv"><span class="k">提交人</span><span class="v">' + UI.esc(S.byName || '') +
                  (S.submittedAt ? ' · ' + UI.esc(BIZ.fmt.fullTime(S.submittedAt)) : '') + '</span></div>' +
                (S.confirmedAt ? '<div class="kv"><span class="k">供应商确认</span><span class="v">' + UI.esc(BIZ.fmt.fullTime(S.confirmedAt)) + '</span></div>' : '') +
                (S.disputes || []).map(function (d) {
                  return '<div class="rec-block" style="border-color:#f6d9d4;background:#fffaf9">' +
                    '<div class="between"><span class="strong" style="color:var(--bad)">供应商异议 · ' + UI.esc(d.supplier || d.by || '') + '</span>' +
                    '<span class="tiny muted">' + UI.esc(BIZ.fmt.fullTime(d.at)) + '</span></div>' +
                    '<div class="tiny mt4">' + UI.esc(d.reason || '') + '</div></div>';
                }).join('')
              : '<div class="tiny muted">验收完成后由门店填写实际结算金额，供应商在自己的账号确认，双方一致后进入统一对账。</div>') +
          '</div>'
        : '') +

      '<div class="card card-pad mt12">' +
        '<div class="section-title mb12">流转记录</div>' +
        (audits.length
          ? '<div class="timeline">' + audits.map(function (a) {
              const bad = /驳回|撤销|关闭|无法接单|异常/.test(a.decision || '');
              return '<div class="tl-item' + (bad ? ' bad' : ' on') + '">' +
                '<div class="tl-t">' + UI.esc(a.decision || '') + '</div>' +
                '<div class="tl-d">' + UI.esc(a.role || '') + (a.note ? ' · ' + UI.esc(a.note) : '') + '</div>' +
                '<div class="tl-time">' + UI.esc(BIZ.fmt.fullTime(a.at)) + '</div></div>';
            }).join('') + '</div>'
          : '<div class="timeline">' +
              '<div class="tl-item on"><div class="tl-t">提交订单</div>' +
                '<div class="tl-d">' + UI.esc(order.manager || '') + ' · ' + UI.esc(order.purpose || '') + '</div>' +
                '<div class="tl-time">' + UI.esc(BIZ.fmt.fullTime(order.createdAt)) + '</div></div>' +
              (order.supplierSentAt
                ? '<div class="tl-item on"><div class="tl-t">已发送供应商</div>' +
                    '<div class="tl-time">' + UI.esc(BIZ.fmt.fullTime(order.supplierSentAt)) + '</div></div>'
                : '') +
            '</div>') +
      '</div>' +

      '<div class="actionbar">' +
        (canReorder ? '<button class="btn ghost" id="btn-reorder">再次下单</button>' : '') +
        (canCancel ? '<button class="btn danger" id="btn-cancel">撤销</button>' : '') +
        (canClose ? '<button class="btn danger" id="btn-close">关闭订单</button>' : '') +
        (pendingApprovals ? '<button class="btn primary" id="btn-approve">去审批</button>' : '') +
        (canAccept ? '<button class="btn primary" id="btn-accept">去验收</button>' : '') +
        (canSettle || canSettleConfirm ? '<button class="btn primary" id="btn-settle">' + (canSettleConfirm ? '确认结算金额' : '填写结算金额') + '</button>' : '') +
        (canSupply && ['supplier', 'preparing'].indexOf(order.status) >= 0 ? '<button class="btn primary" id="btn-supply">去处理</button>' : '') +
        (!canReorder && !canCancel && !canClose && !pendingApprovals && !canAccept && !canSupply && !canSettle && !canSettleConfirm
          ? '<button class="btn ghost" style="flex:1" onclick="history.back()">返回</button>'
          : '') +
      '</div>' +
      '<div class="action-spacer"></div>';

    const copyBtn = root.querySelector('#copy-id');
    if (copyBtn) copyBtn.onclick = function () { UI.copy(order.id); };

    const reorder = root.querySelector('#btn-reorder');
    if (reorder) reorder.onclick = function () {
      const cart = Store.loadCart(me.id);
      cart.lines = cart.lines || {};
      (order.items || []).forEach(function (x) {
        if (!BIZ.domain.CATALOG_BY_ID[x.id]) return;
        cart.lines[x.id] = Math.min(9999, (cart.lines[x.id] || 0) + Number(x.qty || 0));
      });
      if (order.purchaseType !== 'department') cart.store = order.store;
      Store.saveCart(me.id, cart);
      UI.toast('已加入清单，可调整数量后提交', 'good');
      App.go('/catalog');
    };

    const cancel = root.querySelector('#btn-cancel');
    if (cancel) cancel.onclick = function () {
      UI.confirm({
        title: '撤销这笔订单？',
        sub: '撤销后占用金额会释放，若已追加预算会退回机动池。',
        okText: '确认撤销',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        try {
          App.mutate(function (st, ses) { return BIZ.domain.cancelOrder(st, ses, order.id); });
          UI.toast('已撤销', 'good');
          App.reload();
        } catch (e) { UI.toast(e.message, 'error', 2600); }
      });
    };

    const close = root.querySelector('#btn-close');
    if (close) close.onclick = function () {
      const s = UI.sheet({
        title: '关闭停滞订单',
        sub: '适用于供应商长期未接单、或接单后一直未发货。关闭后释放预算占用并留痕。',
        body: '<div class="field"><div class="label">关闭原因</div>' +
          '<textarea class="textarea" id="close-reason" maxlength="120" placeholder="例如：供应商无法供货，已电话确认"></textarea></div>',
        actions: [
          { label: '取消', cls: 'ghost' },
          { label: '确认关闭', cls: 'danger-solid', onClick: function (done, body) {
              const reason = body.querySelector('#close-reason').value.trim();
              try {
                App.mutate(function (st, ses) {
                  return BIZ.domain.closeOrder(st, ses, { orderId: order.id, reason: reason });
                });
                UI.toast('订单已关闭', 'good');
                App.reload();
              } catch (e) { UI.toast(e.message, 'error', 2600); return false; }
            } }
        ]
      });
    };

    const approve = root.querySelector('#btn-approve');
    if (approve) approve.onclick = function () { App.go('/approvals'); };

    const accept = root.querySelector('#btn-accept');
    if (accept) accept.onclick = function () { App.go('/accept/' + order.id); };

    const supply = root.querySelector('#btn-supply');
    if (supply) supply.onclick = function () { App.go('/supplier'); };

    const settle = root.querySelector('#btn-settle');
    if (settle) settle.onclick = function () { App.go('/settle/' + order.id); };
  };
})(window.Views);
