/* 供应商工作台（外部账号）：接单 / 拒单 / 分批发货 */
(function (Views) {
  const SHIP = BIZ.domain.SHIPPING_METHODS;

  Views.supplier = function (root, r, ctx) {
    const domain = BIZ.domain;
    const me = ctx.me;
    const state = ctx.state;
    const supplier = me.supplier;

    if (me.role !== 'supplier') {
      root.innerHTML = UI.empty('🔐', '仅供应商账号可进入', '门店与内部角色请使用「采购下单 / 订单」等功能');
      return;
    }

    let tab = r.query.tab || 'pending';

    function mine() {
      return domain.visibleOrders(state, me).filter(function (o) {
        const rec = (o.supplierRecords || {})[supplier];
        // 已取消 / 已拒单不进供应商工作台，与小程序口径一致
        return rec && ['cancelled', 'rejected'].indexOf(o.status) < 0;
      }).sort(function (a, b) {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
    }

    // 每单只归一个页签：之前按 key 各自判断会「一单命中多个页签」，
    // 导致顶部数字与列表条数不符（如结算确认显示 9 单却只有 1 单）
    function classify(o) {
      const rec = o.supplierRecords[supplier] || {};
      // 验收完成后分项记录已是 accepted，但结算金额仍需双方确认，
      // 因此优先按订单状态分流到「结算确认」，不能简单归入「已完成」
      if (['settle-pending', 'settle-supplier', 'settle-disputed'].indexOf(o.status) >= 0) return 'settle';
      if (rec.status === 'pending') return 'pending';
      if (rec.status === 'issue') return 'issue';
      if (['accepted', 'delivered'].indexOf(rec.status) >= 0) return 'done';
      if (rec.status === 'shipping') return 'shipping';
      if (rec.status === 'confirmed') {
        return (rec.deliveries && rec.deliveries.length) ? 'shipping' : 'toship';
      }
      return 'pending';
    }

    function bucket(key) {
      return mine().filter(function (o) { return classify(o) === key; });
    }

    const TABS = [
      { key: 'pending', label: '待接单' },
      { key: 'issue', label: '异常' },
      { key: 'toship', label: '待发货' },
      { key: 'shipping', label: '配送中' },
      { key: 'settle', label: '结算确认' },
      { key: 'done', label: '已完成' }
    ];

    function myItems(o) {
      return (o.items || []).filter(function (x) { return x.supplier === supplier; });
    }

    function remaining(x) {
      return Math.max(0, Number(x.qty || 0) - Number(x.deliveredQty || 0));
    }

    function card(o) {
      const rec = o.supplierRecords[supplier];
      const items = myItems(o);
      const amount = items.reduce(function (s, x) { return s + Number(x.price || 0) * Number(x.qty || 0); }, 0);
      const toShip = items.reduce(function (s, x) { return s + remaining(x); }, 0);
      // 结算阶段以订单状态为准，避免"验收完就显示已完成"的误导
      const inSettle = ['settle-pending', 'settle-supplier', 'settle-disputed', 'accepted'].indexOf(o.status) >= 0;
      const pill = inSettle ? UI.statusPill(o.status) : UI.supplierPill(rec.status);
      return '<div class="card card-pad" style="margin-bottom:9px">' +
        '<div class="between"><span class="order-id">' + UI.esc(o.id) + '</span>' + pill + '</div>' +
        '<div class="order-meta">' + UI.esc(o.store || '') + ' · ' + UI.esc(o.receiver || '') + ' · ' + UI.esc(o.address || '') + '</div>' +
        items.slice(0, 4).map(function (x) {
          return '<div class="sup-item"><span>' + UI.esc(x.name) + '</span>' +
            '<span class="q">×' + x.qty + (remaining(x) > 0 && remaining(x) < x.qty ? '（待发 ' + remaining(x) + '）' : '') + '</span></div>';
        }).join('') +
        ((items.length > 4) ? '<div class="tiny muted">等 ' + items.length + ' 项</div>' : '') +
        (rec.issue ? '<div class="alert mt8">' + UI.icon('alert', 'sm') + '<span>' + UI.esc(rec.issue) + '</span></div>' : '') +
        '<div class="between" style="margin-top:10px;padding-top:9px;border-top:1px dashed var(--line-2)">' +
          '<span class="tiny muted">期望到货 ' + UI.esc(o.due || '待确认') + ' · 我的金额</span>' +
          '<span class="order-amt">¥' + UI.money(amount) + '</span></div>' +
        '<div class="btn-group" style="margin-top:10px">' +
          '<button class="btn ghost sm" data-view="' + UI.esc(o.id) + '">详情</button>' +
          (rec.status === 'pending'
            ? '<button class="btn danger sm" data-issue="' + UI.esc(o.id) + '">无法接单</button>' +
              '<button class="btn primary sm" data-ack="' + UI.esc(o.id) + '">确认接单</button>'
            : '') +
          (rec.status === 'issue'
            ? '<button class="btn soft sm" data-reopen="' + UI.esc(o.id) + '">撤回拒单</button>'
            : '') +
          (rec.status === 'confirmed' && toShip > 0
            ? '<button class="btn primary sm" data-ship="' + UI.esc(o.id) + '">登记发货</button>'
            : '') +
          (rec.status === 'shipping'
            ? '<button class="btn soft sm" data-view="' + UI.esc(o.id) + '">查看物流</button>'
            : '') +
          (o.status === 'settle-supplier'
            ? '<button class="btn primary sm" data-settle="' + UI.esc(o.id) + '">确认结算金额</button>'
            : o.status === 'accepted' || o.status === 'done'
              ? '<button class="btn ghost sm" data-settle="' + UI.esc(o.id) + '">查看结算</button>'
              : '') +
        '</div>' +
      '</div>';
    }

    function render() {
      const counts = {};
      TABS.forEach(function (t) { counts[t.key] = bucket(t.key).length; });

      root.innerHTML =
        '<div class="between" style="margin-bottom:10px">' +
          '<div><div class="section-title">' + UI.esc(supplier) + '</div>' +
          '<div class="tiny muted mt4">外部供应商账号 · 仅可接单、发货与对账确认</div></div>' +
          '<span class="pill amber">' + counts.pending + ' 单待接</span>' +
        '</div>' +
        '<div class="tab-seg" id="sup-tabs">' + TABS.map(function (t) {
          return '<button data-t="' + t.key + '" class="' + (tab === t.key ? 'on' : '') + '">' +
            t.label + (counts[t.key] ? ' ' + counts[t.key] : '') + '</button>';
        }).join('') + '</div>' +
        '<div id="sup-list"></div>' +
        '<div class="note-box mt16">发货请按实际交付数量登记，可分多批。订单在门店验收后才会进入「已完结」，发货本身只推进到「配送中」。</div>';

      const list = bucket(tab);
      root.querySelector('#sup-list').innerHTML = list.length
        ? list.map(card).join('')
        : UI.empty('🚚', '该分类暂无订单', tab === 'pending' ? '新订单会实时出现在这里' : '');

      root.querySelector('#sup-tabs').addEventListener('click', function (e) {
        const btn = e.target.closest('[data-t]');
        if (!btn) return;
        tab = btn.dataset.t;
        render();
      });
    }

    function find(id) {
      return state.orders.filter(function (o) { return o.id === id; })[0];
    }

    function ack(orderId) {
      try {
        App.mutate(function (st, ses) {
          return BIZ.domain.supplierAck(st, ses, { orderId: orderId, action: 'confirm' });
        });
        UI.toast('已确认接单，请及时备货发货', 'good');
        App.go('/supplier?tab=toship');
      } catch (e) { UI.toast(e.message, 'error', 2800); }
    }

    function reject(orderId) {
      const s = UI.sheet({
        title: '反馈无法接单',
        sub: '请说明原因，采购方会看到并处理。',
        body: '<div class="field"><div class="label">原因<span class="req">*</span></div>' +
          '<textarea class="textarea" id="issue-reason" maxlength="300" placeholder="例如：该商品暂时缺货，预计 3 天后到货"></textarea></div>',
        actions: [
          { label: '取消', cls: 'ghost' },
          { label: '提交', cls: 'primary', onClick: function (close, body) {
              const reason = body.querySelector('#issue-reason').value.trim();
              try {
                App.mutate(function (st, ses) {
                  return BIZ.domain.supplierAck(st, ses, { orderId: orderId, action: 'issue', reason: reason });
                });
                UI.toast('已反馈采购方', '');
                App.reload();
              } catch (e) { UI.toast(e.message, 'error', 2800); return false; }
            } }
        ]
      });
    }

    function reopen(orderId) {
      try {
        App.mutate(function (st, ses) {
          return BIZ.domain.reopenSupplierAck(st, ses, { orderId: orderId });
        });
        UI.toast('已撤回拒单，可重新确认接单', 'good');
        App.reload();
      } catch (e) { UI.toast(e.message, 'error', 2800); }
    }

    function ship(orderId) {
      const order = find(orderId);
      if (!order) return;
      const items = myItems(order).filter(function (x) { return remaining(x) > 0; });
      let method = 'express';

      function shippingFields() {
        if (method === 'express') {
          return '<div class="field-row"><div class="field"><div class="label">快递公司<span class="req">*</span></div>' +
            '<input class="input" id="s-carrier" maxlength="30" placeholder="顺丰 / 京东 / 德邦"></div>' +
            '<div class="field"><div class="label">运单号<span class="req">*</span></div>' +
            '<input class="input" id="s-track" maxlength="40" placeholder="至少 4 位"></div></div>';
        }
        if (method === 'lalamove' || method === 'runner') {
          return '<div class="field"><div class="label">平台订单号<span class="req">*</span></div>' +
            '<input class="input" id="s-track" maxlength="40" placeholder="平台订单号 / 取货码"></div>' +
            '<div class="field"><div class="label">联系人</div>' +
            '<input class="input" id="s-contact" maxlength="30" placeholder="司机 / 骑手联系电话（选填）"></div>';
        }
        return '<div class="field"><div class="label">配送安排 / 联系人<span class="req">*</span></div>' +
          '<input class="input" id="s-contact" maxlength="30" placeholder="例如：自有车辆，张师傅 138xxxx"></div>';
      }

      const body =
        '<div class="note-box mb12">' + UI.esc(order.store) + ' · ' + UI.esc(order.receiver) + ' · ' + UI.esc(order.address) + '</div>' +
        '<div class="field"><div class="label">配送方式<span class="req">*</span></div>' +
          '<div class="radio-cards" id="s-methods">' + Object.keys(SHIP).map(function (k) {
            return '<label class="radio-card' + (k === method ? ' on' : '') + '" data-m="' + k + '">' +
              '<span class="rd"></span><span class="grow"><span>' + UI.esc(SHIP[k]) + '</span>' +
              '<span class="d">' + (k === 'express' ? '需填写快递公司与运单号' : k === 'lalamove' ? '货拉拉等同城货运，需平台单号' : k === 'runner' ? '闪送/跑腿，需平台单号' : '自行安排车辆配送') + '</span></span></label>';
          }).join('') + '</div></div>' +
        '<div id="s-ship-fields">' + shippingFields() + '</div>' +
        '<div class="field"><div class="label">预计到达</div>' +
          '<input class="input" id="s-eta" type="date" min="' + UI.todayStr() + '"></div>' +
        '<div class="field"><div class="label">本次交付商品<span class="req">*</span></div>' +
          '<div class="ship-lines">' + items.map(function (x) {
            return '<div class="ship-line"><span class="nm">' + UI.esc(x.name) +
              '<small>待交付 ' + remaining(x) + ' / 共 ' + x.qty + '</small></span>' +
              '<input type="number" min="0" max="' + remaining(x) + '" value="' + remaining(x) + '" data-line="' + UI.esc(x.id) + '">' +
              '<span class="u">' + UI.esc(x.unit || '件') + '</span></div>';
          }).join('') + '</div></div>' +
        '<div class="field"><div class="label">发货备注</div>' +
          '<textarea class="textarea" id="s-note" maxlength="120" placeholder="选填，例如：分两箱发出"></textarea></div>' +
        '<div class="note-box">发货后订单进入「配送中」，门店验收后才会完结。</div>';

      const s = UI.sheet({
        title: '登记发货',
        sub: UI.esc(order.id) + ' · ' + UI.esc(order.store),
        body: body,
        actions: [
          { label: '取消', cls: 'ghost' },
          { label: '确认发货', cls: 'primary', onClick: function (close, bodyEl) {
              const lines = [];
              bodyEl.querySelectorAll('[data-line]').forEach(function (input) {
                const qty = Number(input.value);
                if (qty > 0) lines.push({ id: input.dataset.line, qty: qty });
              });
              const shipping = {
                method: method,
                carrier: (bodyEl.querySelector('#s-carrier') || {}).value || '',
                trackingNo: (bodyEl.querySelector('#s-track') || {}).value || '',
                contact: (bodyEl.querySelector('#s-contact') || {}).value || '',
                estimatedAt: (bodyEl.querySelector('#s-eta') || {}).value || ''
              };
              try {
                const res = App.mutate(function (st, ses) {
                  return BIZ.domain.supplierDeliver(st, ses, {
                    orderId: order.id, lines: lines, shipping: shipping,
                    note: (bodyEl.querySelector('#s-note') || {}).value || ''
                  });
                });
                UI.toast('第 ' + res.batchNo + ' 批已登记，订单进入配送中', 'good', 2400);
                App.go('/supplier?tab=shipping');
              } catch (e) {
                UI.toast(e.message, 'error', 2800);
                return false;
              }
            } }
        ],
        mount: function (bodyEl) {
          bodyEl.querySelector('#s-methods').addEventListener('click', function (e) {
            const card = e.target.closest('[data-m]');
            if (!card) return;
            method = card.dataset.m;
            bodyEl.querySelectorAll('[data-m]').forEach(function (x) {
              x.classList.toggle('on', x.dataset.m === method);
            });
            const fields = bodyEl.querySelector('#s-ship-fields');
            fields.innerHTML = shippingFields();
            fields.querySelectorAll('input').forEach(function (i) {
              if (i.type === 'number' || i.type === 'date') return;
            });
          });
        }
      });
    }

    render();

    root.addEventListener('click', function (e) {
      const v = e.target.closest('[data-view]');
      if (v) { App.go('/order/' + v.dataset.view); return; }

      const a = e.target.closest('[data-ack]');
      if (a) {
        UI.confirm({
          title: '确认接单？',
          sub: '接单后请按承诺时间备货，并登记配送信息。',
          okText: '确认接单'
        }).then(function (ok) { if (ok) ack(a.dataset.ack); });
        return;
      }

      const i = e.target.closest('[data-issue]');
      if (i) { reject(i.dataset.issue); return; }

      const re = e.target.closest('[data-reopen]');
      if (re) {
        UI.confirm({ title: '撤回拒单？', sub: '撤回后订单会恢复为待接单，可重新确认。', okText: '确认撤回' })
          .then(function (ok) { if (ok) reopen(re.dataset.reopen); });
        return;
      }

      const sh = e.target.closest('[data-ship]');
      if (sh) { ship(sh.dataset.ship); return; }

      // 结算金额共同确认：供应商确认 / 查看结算明细
      const se = e.target.closest('[data-settle]');
      if (se) { App.go('/settle/' + se.dataset.settle); }
    });
  };
})(window.Views);
