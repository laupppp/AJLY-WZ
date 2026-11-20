/* 结算金额共同确认（与小程序 pages/settle 同步）
 * 门店/部门填实际结算金额，供应商确认或提出异议；确认后按结算金额进入统一对账。 */
(function (Views) {
  const SETTLE_TEXT = {
    'pending-store': '待门店提交',
    'pending-supplier': '待供应商确认',
    'confirmed': '双方已确认',
    'disputed': '供应商已提异议'
  };

  Views.settle = function (root, r, ctx) {
    const domain = BIZ.domain;
    const me = ctx.me;
    const id = r.params[0];

    function load() {
      const state = Store.loadState();
      const order = domain.visibleOrders(state, me).filter(function (o) { return o.id === id; })[0];
      return { state: state, order: order };
    }

    function render() {
      const got = load();
      const state = got.state;
      const order = got.order;

      if (!order) {
        root.innerHTML = UI.empty('🧾', '订单不存在或无权查看', '结算由收货门店与供应商共同确认');
        return;
      }

      const itemsAmount = domain.acceptedAmountOf(order);
      const isStoreSide = !!domain.settleActorOf(order, me);
      const isSupplierSide = me.role === 'supplier' && (order.items || []).some(function (x) {
        return x.supplier === me.supplier;
      });
      const editable = isStoreSide && ['settle-pending', 'settle-disputed'].indexOf(order.status) >= 0;

      const raw = order.settlement || {};
      const initialAmount = editable
        ? (raw.status === 'disputed' || raw.status === 'pending-supplier'
          ? Number(raw.amount || itemsAmount) : itemsAmount)
        : Number(raw.amount || itemsAmount);

      const lines = (order.items || []).map(function (x) {
        const n = Number(x.accepted || 0);
        return {
          name: x.name, spec: x.spec || '', unit: x.unit || '', supplier: x.supplier || '',
          qty: n, orderQty: Number(x.qty || 0),
          priceText: BIZ.fmt.money(x.price),
          amountText: BIZ.fmt.money(Math.round(n * Number(x.price || 0) * 100) / 100),
          partial: n < Number(x.qty || 0)
        };
      });

      const settle = order.settlement ? {
        status: order.settlement.status,
        statusText: SETTLE_TEXT[order.settlement.status] || '待门店提交',
        amountText: BIZ.fmt.money(order.settlement.amount),
        itemsAmountText: BIZ.fmt.money(order.settlement.itemsAmount),
        diff: Number(order.settlement.diff || 0),
        reason: order.settlement.reason || '',
        byName: order.settlement.byName || '',
        submittedAt: order.settlement.submittedAt ? BIZ.fmt.fullTime(order.settlement.submittedAt) : '',
        confirmedAt: order.settlement.confirmedAt ? BIZ.fmt.fullTime(order.settlement.confirmedAt) : '',
        round: order.settlement.round || 1,
        disputes: (order.settlement.disputes || []).map(function (d) {
          return { by: d.supplier || d.by, reason: d.reason, at: BIZ.fmt.fullTime(d.at) };
        })
      } : null;

      const owner = order.purchaseType === 'department'
        ? ('部门采购 · ' + (order.department || '') + ' → ' + (order.store || ''))
        : (order.store || '');
      const finishedAt = (order.acceptances && order.acceptances.length)
        ? BIZ.fmt.fullTime(order.acceptances[order.acceptances.length - 1].at) : '';

      root.innerHTML =
        '<div class="detail-hero">' +
          '<div class="st">' + UI.icon('bill', 'sm') + UI.statusPill(order.status) + '</div>' +
          '<div class="id">' + UI.esc(order.id) +
            '<button class="icon-btn plain" id="copy-id" style="color:#fff;width:26px;height:26px;vertical-align:2px" title="复制单号">' + UI.icon('copy', 'xs') + '</button></div>' +
          '<div class="amt">¥' + UI.money(order.total) + '<small>申请金额</small></div>' +
          '<div class="meta"><span>' + UI.esc(owner) + '</span>' +
            (order.purpose ? '<span>' + UI.esc(order.purpose) + '</span>' : '') +
            (finishedAt ? '<span>完成验收 ' + UI.esc(finishedAt) + '</span>' : '') + '</div>' +
        '</div>' +

        '<div class="note-box mt12">验收完成后需共同确认最终结算金额：门店按实际到货与折让填写，供应商在自己的账号确认。双方一致后该金额进入统一对账。</div>' +

        '<div class="card card-pad mt12">' +
          '<div class="section-title mb8">验收明细</div>' +
          '<div class="tiny muted" style="margin:-4px 0 10px">按实收数量核算</div>' +
          lines.map(function (l) {
            return '<div class="item-line"><span class="nm">' + UI.esc(l.name) +
              '<small>' + UI.esc(l.spec || '规格以合同为准') + ' · ' + UI.esc(l.supplier) + '</small></span>' +
              '<span class="qty">' + l.qty + ' / ' + l.orderQty + ' ' + UI.esc(l.unit) + '</span>' +
              '<span class="amt">¥' + UI.money(l.amountText) + '</span></div>' +
              '<div class="tiny muted" style="margin:-6px 0 8px">单价 ¥' + UI.money(l.priceText) + ' / ' + UI.esc(l.unit) + '</div>';
          }).join('') +
          '<div class="divider"></div>' +
          '<div class="between"><span class="small">实收核算金额</span>' +
            '<span class="money" style="font-size:17px">¥' + UI.money(itemsAmount) + '</span></div>' +
        '</div>' +

        (isStoreSide && editable
          ? '<div class="card card-pad mt12">' +
              '<div class="section-title mb8">填写结算金额</div>' +
              '<div class="small muted" style="margin:-4px 0 12px">与实收核算不一致时需说明原因</div>' +
              '<div class="inline-input big"><span class="c">¥</span>' +
                '<input id="st-amount" type="number" min="0" step="0.01" value="' + initialAmount + '" placeholder="0.00"></div>' +
              '<div class="diff-line ok" id="st-diff">与实收核算一致</div>' +
              '<div class="field mt8" id="st-reason-wrap" style="display:none">' +
                '<div class="label">差异原因<span class="req">*</span></div>' +
                '<input class="input" id="st-reason" maxlength="200" placeholder="如：到货破损 2 件退款、少发 1 箱折让（至少 4 个字）">' +
              '</div>' +
              '<button class="btn primary block mt12" id="st-submit">提交结算金额</button>' +
              '<div class="tiny muted mt8" id="st-hint" style="display:none">请填写至少 4 个字的差异原因后再提交</div>' +
            '</div>'
          : '') +

        (isSupplierSide && order.status === 'settle-supplier'
          ? '<div class="card card-pad mt12">' +
              '<div class="section-title mb8">门店提交的结算金额</div>' +
              '<div class="tiny muted" style="margin:-4px 0 10px">' + UI.esc(settle ? settle.statusText : '') + '</div>' +
              '<div class="between" style="padding:10px 0;border-top:1px solid var(--line-2);border-bottom:1px solid var(--line-2)">' +
                '<span class="small">结算金额</span><span class="money" style="font-size:19px">¥' + UI.money(settle ? settle.amountText : itemsAmount) + '</span></div>' +
              (settle && settle.reason ? '<div class="kv"><span class="k">差异原因</span><span class="v">' + UI.esc(settle.reason) + '</span></div>' : '') +
              '<div class="kv"><span class="k">门店</span><span class="v">' + UI.esc(settle ? settle.byName : '') + '</span></div>' +
              '<div class="kv"><span class="k">提交时间</span><span class="v">' + UI.esc(settle ? settle.submittedAt : '') + '</span></div>' +
              '<div class="btn-group mt12">' +
                '<button class="btn ghost" id="st-dispute-toggle">提出异议</button>' +
                '<button class="btn primary" id="st-confirm">确认金额</button>' +
              '</div>' +
              '<div class="field mt12" id="st-dispute-wrap" style="display:none">' +
                '<div class="label">异议说明<span class="req">*</span></div>' +
                '<input class="input" id="st-dispute-reason" maxlength="200" placeholder="如：折让金额过低，应为 115 元（至少 4 个字）">' +
                '<button class="btn ghost block mt8" id="st-dispute">提交异议，退回门店</button>' +
              '</div>' +
            '</div>'
          : '') +

        (settle
          ? '<div class="card card-pad mt12">' +
              '<div class="section-title mb8">结算记录</div>' +
              '<div class="tiny muted" style="margin:-4px 0 10px">第 ' + settle.round + ' 次提交 · ' + UI.esc(settle.statusText) + '</div>' +
              '<div class="kv"><span class="k">结算金额</span><span class="v money">¥' + UI.money(settle.amountText) + '</span></div>' +
              '<div class="kv"><span class="k">实收核算</span><span class="v num">¥' + UI.money(settle.itemsAmountText) + '</span></div>' +
              (Math.abs(settle.diff) > 0.004
                ? '<div class="kv"><span class="k">差异</span><span class="v">' + (settle.diff < 0 ? '少结' : '多结') + ' ¥' + UI.money(Math.abs(settle.diff)) + '</span></div>' : '') +
              (settle.reason ? '<div class="kv"><span class="k">差异原因</span><span class="v">' + UI.esc(settle.reason) + '</span></div>' : '') +
              '<div class="kv"><span class="k">门店提交</span><span class="v">' + UI.esc(settle.byName) + (settle.submittedAt ? ' · ' + UI.esc(settle.submittedAt) : '') + '</span></div>' +
              (settle.confirmedAt ? '<div class="kv"><span class="k">供应商确认</span><span class="v">' + UI.esc(settle.confirmedAt) + '</span></div>' : '') +
              settle.disputes.map(function (d) {
                return '<div class="rec-block" style="border-color:#f6d9d4;background:#fffaf9">' +
                  '<div class="between"><span class="strong" style="color:var(--bad)">供应商异议 · ' + UI.esc(d.by || '') + '</span>' +
                  '<span class="tiny muted">' + UI.esc(d.at) + '</span></div>' +
                  '<div class="tiny mt4">' + UI.esc(d.reason || '') + '</div></div>';
              }).join('') +
            '</div>'
          : '') +

        (!isStoreSide && !isSupplierSide
          ? '<div class="card card-pad mt12"><div class="small muted" style="text-align:center;padding:8px 0">' +
              '当前身份不能处理这笔结算<br><span class="tiny">结算由收货门店与供应商共同确认</span></div></div>'
          : '') +

        '<div class="card card-pad mt12"><a class="tbl-link" href="#/order/' + UI.esc(order.id) + '">查看订单详情 ›</a></div>' +
        '<div class="action-spacer"></div>';

      const copy = root.querySelector('#copy-id');
      if (copy) copy.onclick = function () { UI.copy(order.id); };

      // ---- 门店：金额输入与差异校验 ----
      const amountInput = root.querySelector('#st-amount');
      const reasonWrap = root.querySelector('#st-reason-wrap');
      const reasonInput = root.querySelector('#st-reason');
      const diffLine = root.querySelector('#st-diff');
      const hint = root.querySelector('#st-hint');

      function checkDiff() {
        if (!amountInput) return;
        const amount = Number(amountInput.value);
        const diff = isFinite(amount) ? Math.round((amount - itemsAmount) * 100) / 100 : 0;
        const hasDiff = Math.abs(diff) > 0.004;
        diffLine.className = 'diff-line ' + (hasDiff ? (diff < 0 ? 'bad' : 'warn') : 'ok');
        diffLine.textContent = hasDiff
          ? '与实收核算相差 ' + (diff < 0 ? '少结' : '多结') + ' ¥' + UI.money(Math.abs(diff))
          : '与实收核算一致';
        if (reasonWrap) reasonWrap.style.display = hasDiff ? '' : 'none';
        if (hint) hint.style.display = hasDiff && (reasonInput.value.trim().length < 4) ? '' : 'none';
        return { amount: amount, diff: diff, hasDiff: hasDiff };
      }

      if (amountInput) {
        amountInput.addEventListener('input', checkDiff);
        if (reasonInput) reasonInput.addEventListener('input', checkDiff);
        checkDiff();
      }

      const submit = root.querySelector('#st-submit');
      if (submit) submit.onclick = function () {
        const d = checkDiff();
        if (!d.amount || d.amount <= 0) { UI.toast('请填写结算金额', 'error'); return; }
        if (d.hasDiff && reasonInput.value.trim().length < 4) {
          UI.toast('请填写至少 4 个字的差异原因', 'error'); return;
        }
        UI.confirm({
          title: '提交结算金额',
          sub: '结算金额 ¥' + UI.money(d.amount) +
            (d.hasDiff ? '，与实收核算差 ¥' + UI.money(Math.abs(d.diff)) + '。提交后由供应商确认。' : '。提交后由供应商确认。'),
          okText: '确认提交'
        }).then(function (ok) {
          if (!ok) return;
          try {
            App.mutate(function (st, ses) {
              return domain.submitSettlement(st, ses, {
                orderId: order.id, amount: d.amount, reason: reasonInput ? reasonInput.value.trim() : ''
              });
            });
            UI.toast('已提交，待供应商确认', 'good');
            render();
          } catch (e) { UI.toast(e.message, 'error', 2800); }
        });
      };

      // ---- 供应商：确认 / 异议 ----
      const confirmBtn = root.querySelector('#st-confirm');
      if (confirmBtn) confirmBtn.onclick = function () {
        UI.confirm({
          title: '确认结算金额',
          sub: '确认后该笔订单进入统一对账，金额不再修改。',
          okText: '确认金额'
        }).then(function (ok) {
          if (!ok) return;
          doAction('confirm', '');
        });
      };

      const disputeToggle = root.querySelector('#st-dispute-toggle');
      const disputeWrap = root.querySelector('#st-dispute-wrap');
      if (disputeToggle) disputeToggle.onclick = function () {
        disputeWrap.style.display = disputeWrap.style.display === 'none' ? '' : 'none';
      };

      const disputeBtn = root.querySelector('#st-dispute');
      if (disputeBtn) disputeBtn.onclick = function () {
        const reason = root.querySelector('#st-dispute-reason').value.trim();
        if (reason.length < 4) { UI.toast('请填写至少 4 个字的异议说明', 'error'); return; }
        doAction('dispute', reason);
      };

      function doAction(action, reason) {
        try {
          App.mutate(function (st, ses) {
            return domain.settleAction(st, ses, { orderId: order.id, action: action, reason: reason });
          });
          UI.toast(action === 'confirm' ? '已确认，进入待对账' : '已提出异议，退回门店', 'good');
          render();
        } catch (e) { UI.toast(e.message, 'error', 2800); }
      }
    }

    render();
  };
})(window.Views);
