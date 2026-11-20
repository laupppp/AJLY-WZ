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
      if (o.status === 'budget-central') gapByOrder[o.id] = domain.budgetGap(state, o);
    });

    function orderCard(o) {
      const g = gapByOrder[o.id];
      return '<div class="card card-pad" style="margin-bottom:9px" data-order="' + UI.esc(o.id) + '">' +
        '<div class="between"><span class="order-id">' + UI.esc(o.id) + '</span>' + UI.statusPill(o.status) + '</div>' +
        '<div class="order-meta">' + UI.esc(o.purchaseType === 'department' ? ('部门采购 · ' + o.department) : o.store) +
          ' · ' + UI.esc(o.manager || '') + ' · ' + UI.esc(BIZ.fmt.shortTime(o.createdAt)) + '</div>' +
        '<div class="order-items">' + UI.esc((o.items || []).slice(0, 3).map(function (x) { return x.name + '×' + x.qty; }).join('、')) +
          ((o.items || []).length > 3 ? ' 等 ' + o.items.length + ' 项' : '') + '</div>' +
        '<div class="between mt8"><span class="pill line">' + UI.esc(BIZ.fmt.TIER_LABEL[o.tier] || '') + '</span>' +
          '<span class="order-amt">¥' + UI.money(o.total) + '</span></div>' +
        (g && g.needed > 0
          ? (g.ok
              ? '<div class="ap-budget">需从机动池追加 <b>¥' + UI.money(g.needed) + '</b>，余额 ¥' + UI.money(g.flex) + '</div>'
              : '<div class="ap-budget bad">需追加 <b>¥' + UI.money(g.needed) + '</b> · 机动池 ¥' + UI.money(g.flex) +
                ' · 还差 <b>¥' + UI.money(g.short) + '</b></div>')
          : '') +
        '<div class="btn-group" style="margin-top:12px">' +
          '<button class="btn ghost sm" data-reject="' + UI.esc(o.id) + '">驳回</button>' +
          '<button class="btn primary sm" data-pass="' + UI.esc(o.id) + '">通过</button>' +
        '</div>' +
      '</div>';
    }

    function groupCard(groupId, orders) {
      const total = orders.reduce(function (s, o) { return s + Number(o.total || 0); }, 0);
      return '<div class="card card-pad" style="margin-bottom:9px" data-group="' + UI.esc(groupId) + '">' +
        '<div class="between"><span class="order-id">' + UI.esc(groupId) + '</span>' +
          '<span class="pill warn">待统一确认</span></div>' +
        '<div class="order-meta">部门采购 · ' + UI.esc(orders[0].department || '') + ' · ' + UI.esc(orders[0].manager || '') + '</div>' +
        '<div class="order-items">' + UI.esc(orders.map(function (o) { return o.store; }).join('、')) + '</div>' +
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
        '<span class="pill ' + (totalCount ? 'warn' : 'good') + '">' + totalCount + ' 单待处理</span>' +
      '</div>' +
      (totalCount
        ? Object.keys(deptGroups).map(function (gid) { return groupCard(gid, deptGroups[gid]); }).join('') +
          single.sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); }).map(orderCard).join('')
        : UI.empty('✅', '没有待审批事项', '订单提交后会按金额与预算规则自动流转到这里')) +
      '<div class="note-box mt16">审批规则：超出可用预算 → 战区预算追加 → 运营管理部核定（必要时从机动池追加或门店间调剂）；500 元以内免审批，500-2000 元战区审批，2000 元以上中台审批。</div>';

    function decide(orderId, pass) {
      const order = state.orders.filter(function (o) { return o.id === orderId; })[0];
      if (!order) return;
      try {
        App.mutate(function (st, ses) {
          return BIZ.domain.approveOrder(st, ses, { orderId: orderId, stage: order.status, pass: pass });
        });
        UI.toast(pass ? '已通过，流转至下一节点' : '已驳回', pass ? 'good' : '');
        App.reload();
      } catch (e) {
        if (e.code === 'FLEX_SHORT') {
          openGap(order, e.gap);
        } else {
          UI.toast(e.message, 'error', 2800);
        }
      }
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
      const pass = e.target.closest('[data-pass]');
      if (pass) { decide(pass.dataset.pass, true); return; }

      const reject = e.target.closest('[data-reject]');
      if (reject) {
        UI.confirm({
          title: '驳回这笔订单？',
          sub: '驳回后释放预算占用，门店需要重新调整后提交。',
          okText: '确认驳回', danger: true
        }).then(function (ok) { if (ok) decide(reject.dataset.reject, false); });
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
