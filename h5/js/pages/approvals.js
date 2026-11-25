/* 待办审批：预算核定缺口处理、金额审批、部门批次统一确认 */
(function (Views) {
  function gapText(order, state) {
    if (order.status !== 'budget-central') return '';
    const g = BIZ.domain.budgetGap(state, order);
    if (g.needed <= 0) return '';
    if (g.ok) {
      return '<div class="ap-budget">需从机动池追加 <b>¥' + UI.money(g.needed) + '</b>，机动池余额 ¥' + UI.money(g.flex) + '，足够核定</div>';
    }
    return '<div class="ap-budget bad">需追加 <b>¥' + UI.money(g.needed) + '</b> · 机动池仅 ¥' + UI.money(g.flex) +
      ' · 还差 <b>¥' + UI.money(g.short) + '</b>（单笔可核定上限 ¥' + UI.money(g.maxSupport) + '）</div>';
  }

  Views.approvals = function (root, r, ctx) {
    const domain = BIZ.domain;
    const me = ctx.me;
    const state = ctx.state;

    if (!BIZ.perm.can(me, 'approve')) {
      root.innerHTML = UI.empty('🔐', '当前身份无审批权限', '审批由战区负责人与运营管理部处理');
      return;
    }

    const list = domain.pendingApprovals(state, me);
    const single = list.filter(function (o) { return o.status !== 'dept-approval'; });
    const deptGroups = {};
    list.filter(function (o) { return o.status === 'dept-approval'; }).forEach(function (o) {
      const key = o.groupId || o.id;
      if (!deptGroups[key]) deptGroups[key] = [];
      deptGroups[key].push(o);
    });

    const gapByOrder = {};
    single.forEach(function (o) {
      if (o.status === 'budget-central' || o.overPending) gapByOrder[o.id] = domain.budgetGap(state, o);
    });

    const batchEligible = single.filter(function (o) { return !o.overPending; });
    const ac = domain.approvalConfigOf(state);
    const expanded = {};

    function orderItemsDetailHtml(o) {
      return '<div class="ap-detail" style="display:' + (expanded[o.id] ? 'block' : 'none') + '">' +
        '<div class="tiny muted mb4">全部商品明细（共 ' + (o.items || []).length + ' 项）</div>' +
        (o.items || []).map(function (x) {
          const lineAmt = Math.round(Number(x.price || 0) * Number(x.qty || 0) * 100) / 100;
          return '<div class="item-line"><span class="nm">' + UI.esc(x.name) +
            '<small>' + UI.esc(x.spec || '规格以合同为准') + ' · ' + UI.esc(x.supplier || '') + '</small></span>' +
            '<span class="qty">¥' + UI.money(x.price) + '×' + x.qty + '</span>' +
            '<span class="amt">¥' + UI.money(lineAmt) + '</span></div>';
        }).join('') +
        '<div class="divider"></div>' +
        '<div class="tiny muted">收货人：' + UI.esc(o.receiver || '-') + ' · 期望到货：' + UI.esc(o.due || '待确认') + '</div>' +
        '<div class="tiny muted mt4">收货地址：' + UI.esc(o.address || '-') + '</div>' +
        '<div class="tiny muted mt4">采购用途：' + UI.esc(o.purpose || '-') + (o.note ? ' · 备注：' + UI.esc(o.note) : '') + '</div>' +
        '<div class="mt8"><a class="tbl-link tiny" href="#/order/' + UI.esc(o.id) + '">打开完整订单详情页 ›</a></div>' +
      '</div>';
    }

    function orderCard(o) {
      const g = gapByOrder[o.id];
      const split = domain.splitOrder(o);
      const splitTagsHtml = BIZ.budget.KEYS.filter(function (k) { return split[k] && split[k].total > 0; }).map(function (k) {
        const usable = Math.round(domain.storeUsableCents(state, o.store, o.id, k) / 100);
        return UI.budgetPill(k, BIZ.budget.SHORT[k] + ' ¥' + UI.money(split[k].total) + '（余 ¥' + UI.money(usable) + '）');
      }).join(' ');
      const itemCount = (o.items || []).length;
      const isOpen = !!expanded[o.id];

      return '<div class="card card-pad" style="margin-bottom:9px" data-order="' + UI.esc(o.id) + '">' +
        '<div class="between"><a class="order-id tbl-link" href="#/order/' + UI.esc(o.id) + '">' + UI.esc(o.id) + ' ›</a>' + UI.statusPill(o.status) + '</div>' +
        '<div class="order-meta">' + UI.esc(o.purchaseType === 'department' ? ('部门采购 · ' + o.department) : o.store) +
          ' · ' + UI.esc(o.manager || '') + ' · ' + UI.esc(BIZ.fmt.shortTime(o.createdAt)) + '</div>' +
        '<div class="order-items">' + UI.esc((o.items || []).slice(0, 3).map(function (x) { return x.name + '×' + x.qty; }).join('、')) +
          (itemCount > 3 ? ' 等 ' + itemCount + ' 项' : '') + '</div>' +
        '<div class="mt4"><button class="btn-inline" type="button" data-toggle-detail="' + UI.esc(o.id) + '" data-label="查看全部 ' + itemCount + ' 项明细">' +
          (isOpen ? '收起明细 ▴' : ('查看全部 ' + itemCount + ' 项明细 ▾')) + '</button></div>' +
        orderItemsDetailHtml(o) +
        (splitTagsHtml ? '<div class="tag-line mt4">' + splitTagsHtml + '</div>' : '') +
        (o.overReason ? '<div class="tiny mt4" style="color:var(--warn)">超预算说明：' + UI.esc(o.overReason) + '</div>' : '') +
        '<div class="between mt8"><span class="pill line">' + UI.esc(BIZ.fmt.TIER_LABEL[o.tier] || '') +
          (o.splitUpgraded ? ' · 累计防拆单' : '') + '</span>' +
          '<span class="order-amt">¥' + UI.money(o.total) + '</span></div>' +
        (g && g.needed > 0
          ? (g.ok
              ? '<div class="ap-budget">需从机动池追加 <b>¥' + UI.money(g.needed) + '</b>，余额 ¥' + UI.money(g.flex) + '（一步完成核定与金额审批）</div>'
              : '<div class="ap-budget bad">需追加 <b>¥' + UI.money(g.needed) + '</b> · 机动池 ¥' + UI.money(g.flex) +
                ' · 还差 <b>¥' + UI.money(g.short) + '</b></div>')
          : '') +
        '<div class="btn-group" style="margin-top:12px">' +
          '<button class="btn ghost sm" data-reject="' + UI.esc(o.id) + '">驳回</button>' +
          '<button class="btn ghost sm" data-adjust="' + UI.esc(o.id) + '">微调数量</button>' +
          '<button class="btn primary sm" data-pass="' + UI.esc(o.id) + '">通过</button>' +
        '</div>' +
      '</div>';
    }

    function groupCard(groupId, orders) {
      const total = orders.reduce(function (s, o) { return s + Number(o.total || 0); }, 0);
      const isOpen = !!expanded[groupId];
      const detailHtml = '<div class="ap-detail" style="display:' + (isOpen ? 'block' : 'none') + '">' +
        orders.map(function (o) {
          return '<div class="rec-block" style="margin-bottom:6px">' +
            '<div class="between"><a class="strong tbl-link" href="#/order/' + UI.esc(o.id) + '">' + UI.esc(o.id) + ' · ' + UI.esc(o.store) + ' ›</a>' +
              '<span class="money">¥' + UI.money(o.total) + '</span></div>' +
            '<div class="tiny muted mt4">收货人：' + UI.esc(o.receiver || '-') + ' · 地址：' + UI.esc(o.address || '-') + '</div>' +
            (o.items || []).map(function (x) {
              return '<div class="item-line"><span class="nm">' + UI.esc(x.name) +
                '<small>' + UI.esc(x.spec || '') + ' · ' + UI.esc(x.supplier || '') + '</small></span>' +
                '<span class="qty">×' + x.qty + '</span>' +
                '<span class="amt">¥' + UI.money(Number(x.price || 0) * Number(x.qty || 0)) + '</span></div>';
            }).join('') +
          '</div>';
        }).join('') +
      '</div>';

      return '<div class="card card-pad" style="margin-bottom:9px" data-group="' + UI.esc(groupId) + '">' +
        '<div class="between"><span class="order-id">' + UI.esc(groupId) + '</span>' +
          '<span class="pill warn">待统一确认</span></div>' +
        '<div class="order-meta">部门采购 · ' + UI.esc(orders[0].department || '') + ' · ' + UI.esc(orders[0].manager || '') + '</div>' +
        '<div class="order-items">' + UI.esc(orders.map(function (o) { return o.store; }).join('、')) + '</div>' +
        '<div class="mt4"><button class="btn-inline" type="button" data-toggle-detail="' + UI.esc(groupId) + '" data-label="查看 ' + orders.length + ' 个配送点完整明细">' +
          (isOpen ? '收起明细 ▴' : ('查看 ' + orders.length + ' 个配送点完整明细 ▾')) + '</button></div>' +
        detailHtml +
        '<div class="between mt8"><span class="tiny muted">' + orders.length + ' 个配送点</span>' +
          '<span class="order-amt">¥' + UI.money(total) + '</span></div>' +
        '<div class="btn-group" style="margin-top:12px">' +
          '<button class="btn ghost sm" data-group-reject="' + UI.esc(groupId) + '">整批驳回</button>' +
          '<button class="btn primary sm" data-group-pass="' + UI.esc(groupId) + '">整批确认</button>' +
        '</div>' +
      '</div>';
    }

    const totalCount = list.length;

    root.innerHTML =
      '<div class="between" style="margin-bottom:10px">' +
        '<div><div class="section-title">待我审批</div>' +
        '<div class="tiny muted mt4">' + UI.esc(BIZ.perm.roleMeta(me.role).duty) + '</div></div>' +
        '<div class="row" style="gap:6px">' +
          (batchEligible.length > 1
            ? '<button class="btn soft sm" id="btn-batch-pass">一键通过预算内（' + batchEligible.length + '）</button>'
            : '') +
          '<span class="pill ' + (totalCount ? 'warn' : 'good') + '">' + totalCount + ' 单待处理</span>' +
        '</div>' +
      '</div>' +
      (totalCount
        ? Object.keys(deptGroups).map(function (gid) { return groupCard(gid, deptGroups[gid]); }).join('') +
          single.sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); }).map(orderCard).join('')
        : UI.empty('✅', '没有待审批事项', '订单提交后会按金额与预算规则自动流转到这里')) +
      '<div class="note-box mt16">审批规则（优化后）：预算内 ≤¥' + UI.money(ac.autoMax) + ' 战区一步审核直发，¥' +
        UI.money(ac.autoMax) + '–' + UI.money(ac.regionMax) + ' 战区一步终审（合规+金额合并，免二次点击），>¥' +
        UI.money(ac.regionMax) + ' 战区审核后报中台金额审批；超出可用预算的订单由战区审核后转中台一步完成「预算核定 + 金额审批」。' +
        (me.role === 'central' ? ' <a href="#/console?tab=rules" style="color:var(--brand);font-weight:600">去中台操作台调整阈值 →</a>' : '') +
      '</div>';

    function decide(orderId, pass, extra) {
      const order = state.orders.filter(function (o) { return o.id === orderId; })[0];
      if (!order) return false;
      const opts = extra || {};
      try {
        App.mutate(function (st, ses) {
          return BIZ.domain.approveOrder(st, ses, {
            orderId: orderId,
            stage: order.status,
            pass: pass,
            note: opts.note || '',
            requireReason: !!opts.requireReason,
            adjustQuantities: opts.adjustQuantities
          });
        });
        UI.toast(pass ? '已通过，流转至下一节点' : '已驳回', pass ? 'good' : '');
        App.reload();
        return true;
      } catch (e) {
        if (e.code === 'FLEX_SHORT') {
          openGap(order, e.gap);
        } else {
          UI.toast(e.message, 'error', 2800);
        }
        return false;
      }
    }

    function openRejectSheet(orderId) {
      const order = state.orders.filter(function (o) { return o.id === orderId; })[0];
      if (!order) return;
      UI.sheet({
        title: '驳回订单 ' + order.id,
        sub: UI.esc(order.store) + ' · ¥' + UI.money(order.total) + '（驳回后释放预算占用并留痕）',
        body: '<div class="field"><div class="label">驳回原因<span class="req">*</span></div>' +
          '<textarea class="textarea" id="rj-note" maxlength="160" placeholder="请填写至少 2 个字的驳回原因，便于门店修改后重提"></textarea></div>',
        actions: [
          { label: '取消', cls: 'ghost' },
          { label: '确认驳回', cls: 'danger-solid', onClick: function (_close, bodyEl) {
              const reason = bodyEl.querySelector('#rj-note').value.trim();
              if (reason.length < 2) {
                UI.toast('请填写至少 2 个字的驳回原因', 'error');
                return false;
              }
              return decide(orderId, false, { note: reason, requireReason: true });
            } }
        ]
      });
    }

    function openAdjustSheet(orderId) {
      const order = state.orders.filter(function (o) { return o.id === orderId; })[0];
      if (!order) return;
      const body = '<div class="note-box mb12">可在审批通过前直接下调或修改各项商品数量（无需整单驳回重下），系统将自动重算订单金额与预算占用。</div>' +
        (order.items || []).map(function (it) {
          return '<div class="between" style="padding:8px 0;border-bottom:1px solid var(--line)">' +
            '<div><div class="strong">' + UI.esc(it.name) + '</div>' +
              '<div class="tiny muted">¥' + UI.money(it.price) + ' / ' + UI.esc(it.unit || '件') + ' · 原申购 ' + it.qty + '</div></div>' +
            '<input class="input" type="number" min="1" max="9999" data-adj-id="' + UI.esc(it.id) + '" value="' + it.qty + '" style="width:86px;text-align:center">' +
          '</div>';
        }).join('') +
        '<div class="field mt12"><div class="label">审批意见（选填）</div>' +
          '<input class="input" id="adj-note" maxlength="120" placeholder="例如：按实际活动规模核减数量"></div>';

      UI.sheet({
        title: '微调数量并通过 · ' + order.id,
        sub: UI.esc(order.store) + ' · 原金额 ¥' + UI.money(order.total),
        body: body,
        actions: [
          { label: '取消', cls: 'ghost' },
          { label: '保存并通过', cls: 'primary', onClick: function (_close, bodyEl) {
              const map = {};
              bodyEl.querySelectorAll('[data-adj-id]').forEach(function (inp) {
                map[inp.dataset.adjId] = Number(inp.value);
              });
              const note = bodyEl.querySelector('#adj-note').value.trim();
              return decide(orderId, true, { adjustQuantities: map, note: note });
            } }
        ]
      });
    }

    function openGap(order, gap) {
      const shortRows = (gap.rows || []).filter(function (r) { return r.over; })
        .sort(function (a, b) { return b.needed - a.needed; });
      let key = shortRows[0] ? shortRows[0].key : '';
      let from = '';

      function candidatesFor(k) {
        return BIZ.domain.budgetSummary(state, { role: 'central', stores: [] })
          .filter(function (b) { return b.store !== order.store; })
          .map(function (b) {
            const it = (b.items || []).filter(function (x) { return x.key === k; })[0];
            return { store: b.store, free: it ? it.available : 0 };
          })
          .filter(function (c) { return c.free > 0; })
          .sort(function (a, b) { return b.free - a.free; })
          .slice(0, 6);
      }

      const itemRows = shortRows.map(function (r) {
        return '<div class="gap-row"><span class="k">' + UI.esc(r.name) + '</span>' +
          '<span class="v">¥' + UI.money(r.total) + '<span class="tiny muted"> · 可用 ¥' + UI.money(r.usable) +
          ' · 缺 ¥' + UI.money(r.needed) + '</span></span></div>';
      }).join('');

      const chips = shortRows.length > 1
        ? '<div class="gap-chips" id="g-chips">' + shortRows.map(function (r) {
            return '<button class="chip' + (r.key === key ? ' on' : '') + '" data-key="' + r.key + '">' +
              UI.esc(r.name) + ' · 缺 ¥' + UI.money(r.needed) + '</button>';
          }).join('') + '</div>'
        : '';

      const body =
        '<div class="gap-hero"><div class="t">机动预算不足，还差 ¥' + UI.money(gap.short) + '</div>' +
          '<div class="s">这笔单需要从机动池追加 ¥' + UI.money(gap.needed) + '，但余额只有 ¥' + UI.money(gap.flex) +
          '。下面任一方式补足后会自动完成核定。</div></div>' +

        '<div class="gap-rows">' +
          '<div class="gap-row"><span class="k">订单金额</span><span class="v">¥' + UI.money(gap.total) + '</span></div>' +
          itemRows +
          '<div class="gap-row"><span class="k">机动池余额</span><span class="v">¥' + UI.money(gap.flex) + '</span></div>' +
          '<div class="gap-row bad"><span class="k">仍缺</span><span class="v">¥' + UI.money(gap.short) + '</span></div>' +
        '</div>' +

        '<div class="gap-method">' +
          '<h4>方式一 · 追加机动预算</h4>' +
          '<p>增加公司预留额度，按科目缺口自动分配到对应费用项。真实场景应经预算负责人审批。</p>' +
          '<div class="bd"><div class="inline-input"><span class="c">¥</span>' +
            '<input id="g-amount" type="number" min="0" step="0.01" value="' + gap.short + '"></div>' +
            '<input class="input mt8" id="g-reason" maxlength="60" placeholder="用途说明，例如：门店开业活动专项（选填）">' +
            '<button class="btn soft block mt8" id="g-flex">追加 ¥<span id="g-amt-label">' + UI.money(gap.short) + '</span> 并核定</button>' +
          '</div>' +
        '</div>' +

        '<div class="gap-method">' +
          '<h4>方式二 · 从其他门店调剂同科目额度</h4>' +
          '<p>不增加公司总预算，把其他门店该科目的闲置额度划给本店，治理上更稳妥。</p>' +
          chips +
          '<div class="bd" id="g-move-wrap"></div>' +
        '</div>' +

        '<div class="note-box">单笔最多可核定 ¥' + UI.money(gap.maxSupport) + '（门店可用 + 机动池）。若两种方式都补不上，建议驳回，让门店按上限拆单或转专项采购。</div>';

      const s = UI.sheet({
        title: '预算核定缺口',
        sub: UI.esc(order.id) + ' · ' + UI.esc(order.store) + ' · 订单 ¥' + UI.money(order.total),
        body: body,
        actions: [
          { label: '稍后处理', cls: 'ghost' },
          { label: '驳回订单', cls: 'danger', onClick: function () { decide(order.id, false); } }
        ],
        mount: function (bodyEl) {
          const wrap = bodyEl.querySelector('#g-move-wrap');

          function renderMove() {
            const cands = candidatesFor(key);
            if (!from || !cands.some(function (c) { return c.store === from; })) {
              from = cands.length ? cands[0].store : '';
            }
            const need = (shortRows.filter(function (r) { return r.key === key; })[0] || {}).needed || gap.short;
            wrap.innerHTML = cands.length
              ? cands.map(function (c) {
                  return '<button class="store-pick' + (c.store === from ? ' on' : '') + '" data-from="' + UI.esc(c.store) + '">' +
                    '<span>' + UI.esc(c.store) + '</span>' +
                    '<span class="r">可调 ¥' + UI.money(c.free) + '</span></button>';
                }).join('') +
                '<div class="inline-input mt8"><span class="c">¥</span>' +
                  '<input id="g-move" type="number" min="0" step="0.01" value="' + Math.min(need, cands[0].free) + '"></div>' +
                '<button class="btn soft block mt8" id="g-transfer">调剂到 ' + UI.esc(order.store) + ' 并核定</button>'
              : '<div class="tiny muted">其他门店该科目当前没有可调结余，只能用方式一或驳回后让门店拆单。</div>';

            wrap.onclick = function (e) {
              const pick = e.target.closest('[data-from]');
              if (pick) {
                from = pick.dataset.from;
                wrap.querySelectorAll('[data-from]').forEach(function (x) {
                  x.classList.toggle('on', x.dataset.from === from);
                });
                return;
              }
              const btn = e.target.closest('#g-transfer');
              if (!btn) return;
              const amount = Number(wrap.querySelector('#g-move').value);
              if (!from) { UI.toast('请选择调出门店', 'error'); return; }
              try {
                App.mutate(function (st, ses) {
                  const res = BIZ.domain.transferStoreBudget(st, ses, from, order.store, amount, key);
                  Store.appendAudit([{
                    orderId: order.id, kind: 'budget', stage: 'budget-central', decision: '门店额度调剂',
                    role: '运营管理部（' + ses.id + '）', from: '', to: '',
                    note: res.from + ' → ' + res.to + '「' + res.item + '」¥' + UI.money(res.amount),
                    at: new Date().toISOString()
                  }]);
                  return BIZ.domain.approveOrder(st, ses, { orderId: order.id, stage: order.status, pass: true });
                });
                s.close();
                UI.toast('已调剂额度并完成核定', 'good');
                App.reload();
              } catch (err) {
                UI.toast(err.message, 'error', 2800);
              }
            };
          }

          const chipsEl = bodyEl.querySelector('#g-chips');
          if (chipsEl) {
            chipsEl.addEventListener('click', function (e) {
              const chip = e.target.closest('[data-key]');
              if (!chip) return;
              key = chip.dataset.key;
              chipsEl.querySelectorAll('[data-key]').forEach(function (x) {
                x.classList.toggle('on', x.dataset.key === key);
              });
              renderMove();
            });
          }

          renderMove();

          const amountInput = bodyEl.querySelector('#g-amount');
          amountInput.addEventListener('input', function () {
            bodyEl.querySelector('#g-amt-label').textContent = UI.money(Number(amountInput.value || 0));
          });

          bodyEl.querySelector('#g-flex').onclick = function () {
            const amount = Number(amountInput.value);
            const reason = bodyEl.querySelector('#g-reason').value.trim();
            try {
              App.mutate(function (st, ses) {
                const adj = BIZ.domain.adjustFlex(st, ses, amount, reason);
                Store.appendAudit([{
                  orderId: order.id, kind: 'budget', stage: 'budget-central', decision: '追加机动预算',
                  role: '运营管理部（' + ses.id + '）', from: '', to: '',
                  note: '机动池 ¥' + UI.money(adj.before) + ' → ¥' + UI.money(adj.after) + (reason ? '；用途：' + reason : ''),
                  at: new Date().toISOString()
                }]);
                return BIZ.domain.approveOrder(st, ses, { orderId: order.id, stage: order.status, pass: true });
              });
              s.close();
              UI.toast('已追加预算并完成核定', 'good');
              App.reload();
            } catch (err) {
              UI.toast(err.message, 'error', 2800);
            }
          };
        }
      });
    }

    root.addEventListener('click', function (e) {
      const toggleBtn = e.target.closest('[data-toggle-detail]');
      if (toggleBtn) {
        const key = toggleBtn.dataset.toggleDetail;
        expanded[key] = !expanded[key];
        const card = toggleBtn.closest('.card');
        const panel = card && card.querySelector('.ap-detail');
        if (panel) panel.style.display = expanded[key] ? 'block' : 'none';
        toggleBtn.textContent = expanded[key] ? '收起明细 ▴' : ((toggleBtn.dataset.label || '查看明细') + ' ▾');
        return;
      }

      if (e.target.closest('#btn-batch-pass')) {
        UI.confirm({
          title: '一键通过 ' + batchEligible.length + ' 笔预算内订单？',
          sub: '仅处理当前名下未超预算的待审订单（超预算核定单保留单独处理）。',
          okText: '确认批量通过'
        }).then(function (ok) {
          if (!ok) return;
          try {
            const res = App.mutate(function (st, ses) {
              return BIZ.domain.batchApproveOrders(st, ses, {
                orderIds: batchEligible.map(function (o) { return o.id; })
              });
            });
            UI.toast('已批量通过 ' + res.count + ' 笔订单', 'good');
            App.reload();
          } catch (err) {
            UI.toast(err.message, 'error', 2800);
          }
        });
        return;
      }

      const pass = e.target.closest('[data-pass]');
      if (pass) { decide(pass.dataset.pass, true); return; }

      const adjust = e.target.closest('[data-adjust]');
      if (adjust) { openAdjustSheet(adjust.dataset.adjust); return; }

      const reject = e.target.closest('[data-reject]');
      if (reject) {
        openRejectSheet(reject.dataset.reject);
        return;
      }

      const gp = e.target.closest('[data-group-pass]');
      if (gp) {
        groupDecide(gp.dataset.groupPass, true);
        return;
      }

      const gr = e.target.closest('[data-group-reject]');
      if (gr) {
        UI.confirm({
          title: '整批驳回部门采购？',
          sub: '该批次下所有配送点都会变为已驳回。',
          okText: '整批驳回', danger: true
        }).then(function (ok) { if (ok) groupDecide(gr.dataset.groupReject, false); });
      }
    });

    function groupDecide(groupId, pass) {
      try {
        App.mutate(function (st, ses) {
          return BIZ.domain.approveDepartmentGroup(st, ses, groupId, pass);
        });
        UI.toast(pass ? '批次已确认，已发送供应商' : '批次已驳回', pass ? 'good' : '');
        App.reload();
      } catch (e) {
        UI.toast(e.message, 'error', 2800);
      }
    }
  };
})(window.Views);
