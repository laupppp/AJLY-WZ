/* 结算页：收货信息 + 后台试算 + 提交（门店单 / 部门单） */
(function (Views) {
  Views.checkout = function (root, r, ctx) {
    const domain = BIZ.domain;
    const perm = BIZ.perm;
    const me = ctx.me;
    const state = ctx.state;
    const isDept = perm.isDepartmentFlow(me);

    const catMap = domain.catalogMapOf(state);
    const cart = Store.loadCart(me.id);
    const items = Object.keys(cart.lines || {}).filter(function (id) {
      const p = catMap[id];
      return cart.lines[id] > 0 && p && p.enabled !== false && !p.deleted && domain.canActorBuyItem(p, me);
    }).map(function (id) {
      return { id: id, qty: cart.lines[id] };
    });

    if (!items.length) {
      root.innerHTML = UI.empty('🛒', '清单是空的', '先到「采购下单」选择商品') +
        '<div style="text-align:center;margin-top:4px"><a class="btn primary" href="#/catalog" style="width:180px">去选商品</a></div>';
      return;
    }

    const zoneStores = Object.keys(BIZ.catalog.STORE_ZONES || {});
    const deptStores = zoneStores.length ? zoneStores : (me.stores || []);

    let destType = 'store';
    let destStore = isDept
      ? ((me.role === 'central' ? deptStores[0] : (me.stores || [])[0]) || deptStores[0] || '公司总部')
      : (cart.store || (me.stores || [])[0]);
    if (!isDept && (me.stores || []).indexOf(destStore) < 0) destStore = me.stores[0];

    const dftDate = (function () {
      const d = new Date();
      d.setDate(d.getDate() + 2);
      const p = function (n) { return n < 10 ? '0' + n : n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    })();

    const form = {
      receiver: me.name,
      address: isDept ? '公司总部收货区（演示地址）' : destStore + ' 收货区（演示地址）',
      purpose: isDept ? '部门日常采购' : '门店日常运营',
      due: dftDate,
      note: '',
      overReason: '',
      splitByContract: true
    };

    const distinctSuppliers = [];
    items.forEach(function (x) {
      const p = catMap[x.id] || BIZ.domain.CATALOG_BY_ID[x.id];
      if (p && p.supplier && distinctSuppliers.indexOf(p.supplier) < 0) distinctSuppliers.push(p.supplier);
    });
    const hasMultiContracts = !isDept && distinctSuppliers.length > 1;

    function quoteOf() {
      if (isDept) {
        const dq = domain.computeDepartmentQuote(state, items);
        return {
          total: dq.total,
          overBudget: dq.overCap,
          hardOver: dq.overCap,
          contractRows: dq.contractRows,
          tierLabel: '部门采购（合同上限）',
          pathText: dq.overCap
            ? '超出所选供应商框架合同剩余可用总额，请缩减数量或在中台操作台调整合同总额'
            : (me.role === 'central' ? '运营管理部自采（合同额度内），提交后直接发送供应商' : '部门采购（合同额度内），提交后由运营管理部统一确认'),
          maxSupport: null
        };
      }
      try {
        return domain.computeQuote(state, { store: destStore, items: items });
      } catch (e) {
        return { error: e.message };
      }
    }

    function renderQuote() {
      const q = quoteOf();
      const host = root.querySelector('#quote');
      const submitBtn = root.querySelector('#btn-submit');
      const overWrap = root.querySelector('#over-reason-wrap');
      if (!q || q.error) {
        host.innerHTML = '<div class="small" style="color:var(--bad)">' + UI.esc(q ? q.error : '试算失败') + '</div>';
        if (submitBtn) submitBtn.disabled = true;
        return;
      }
      if (submitBtn) {
        submitBtn.disabled = !!q.hardOver;
        submitBtn.textContent = q.hardOver ? (isDept ? '超出合同上限' : '超出可核定上限') : '提交订单';
      }
      if (overWrap) {
        overWrap.style.display = (!isDept && q.overBudget && !q.hardOver) ? 'block' : 'none';
      }

      const lines = items.map(function (x) {
        const p = catMap[x.id] || BIZ.domain.CATALOG_BY_ID[x.id];
        return '<div class="item-line"><span class="nm">' + UI.esc(p.name) +
          '<small>' + UI.esc(p.spec || '') + '</small></span>' +
          '<span class="qty">×' + x.qty + '</span>' +
          '<span class="amt">¥' + UI.money(p.price * x.qty) + '</span></div>';
      }).join('');

      const catRows = (!isDept && q.budgetItems && q.budgetItems.length)
        ? '<div class="cat-split">' + q.budgetItems.map(function (r) {
            const pct = r.budget > 0 ? Math.min(100, Math.round(r.total / r.budget * 100)) : 0;
            return '<div class="cat-line">' +
              '<div class="between"><span class="cat-name">' + UI.budgetPill(r.key, r.name) + '</span>' +
                '<span class="cat-amt' + (r.overBudget ? ' red' : '') + '">¥' + UI.money(r.total) + '</span></div>' +
              '<div class="bar" style="height:4px"><i class="' + (r.overBudget ? 'bad' : ('tone-' + r.key)) + '" style="width:' + Math.min(100, pct) + '%"></i></div>' +
              '<div class="tiny muted mt4">该科目可用 ¥' + UI.money(r.usable) +
                (r.overBudget ? ' · 超 ¥' + UI.money(r.over) : '') + '</div>' +
            '</div>';
          }).join('') + '</div>'
        : '';

      const contractRows = (isDept && q.contractRows && q.contractRows.length)
        ? '<div class="cat-split">' + q.contractRows.map(function (r) {
            const pct = r.total > 0 ? Math.min(100, Math.round((r.used + r.apply) / r.total * 100)) : 0;
            return '<div class="cat-line">' +
              '<div class="between"><span class="cat-name">' + UI.esc(r.supplier) + ' 合同额度</span>' +
                '<span class="cat-amt' + (r.overCap ? ' red' : '') + '">本次 ¥' + UI.money(r.apply) + '</span></div>' +
              '<div class="bar" style="height:4px"><i class="' + (r.overCap ? 'bad' : '') + '" style="width:' + pct + '%"></i></div>' +
              '<div class="tiny muted mt4">合同总额 ¥' + UI.money(r.total) + ' · 剩余可用 ¥' + UI.money(r.remaining) +
                (r.overCap ? ' · 超出上限 ¥' + UI.money(r.over) : '') + '</div>' +
            '</div>';
          }).join('') + '</div>'
        : '';

      host.innerHTML =
        '<div class="between" style="margin-bottom:4px"><span class="section-title">商品明细</span>' +
          '<span class="tiny muted">' + items.length + ' 种 / ' + items.reduce(function (s, x) { return s + x.qty; }, 0) + ' 件</span></div>' +
        lines +
        catRows +
        contractRows +
        '<div class="divider"></div>' +
        '<div class="kv"><span class="k">订单金额</span><span class="v num money" style="font-size:18px">¥' + UI.money(q.total) + '</span></div>' +
        (!isDept
          ? '<div class="kv"><span class="k">科目可用额度</span><span class="v num">¥' + UI.money(q.available) + '<span class="tiny muted">（房间数 × 科目系数）</span></span></div>' +
            '<div class="kv"><span class="k">可核定上限</span><span class="v num">¥' + UI.money(q.maxSupport) + '<span class="tiny muted">（门店额度 + 机动池）</span></span></div>' +
            (q.overBudget
              ? '<div class="kv"><span class="k" style="color:var(--bad)">超出可用</span><span class="v num money red">¥' + UI.money(q.overAmount) + '</span></div>'
              : '') +
            (q.splitUpgraded
              ? '<div class="kv"><span class="k">近' + q.splitDays + '天本店累计</span><span class="v num">¥' + UI.money(q.cumulativeTotal) + '<span class="tiny muted">（防拆单合并定档）</span></span></div>'
              : '')
          : '') +
        '<div class="kv"><span class="k">审批路径</span><span class="v">' +
          '<span class="pill ' + (q.hardOver ? 'bad' : q.overBudget ? 'warn' : 'info') + '">' + UI.esc(q.tierLabel) + '</span>' +
          '<div class="tiny muted mt4">' + UI.esc(q.pathText) + '</div></span></div>' +
        (q.hardOver
          ? '<div class="alert mt8">' + UI.icon('alert', 'sm') +
            '<span>' + (isDept ? '已超过供应商合同总额上限，无法直接提交，请缩减数量或由中台调整合同额度' : '超过「科目额度 + 机动池」可核定上限，无法提交，请拆分下单或转专项采购') + '</span></div>'
          : '') +
        (hasMultiContracts
          ? '<label class="check" style="margin-top:8px;padding-top:10px;border-top:1px dashed var(--line-2)">' +
              '<input type="checkbox" id="chk-split-contract"' + (form.splitByContract ? ' checked' : '') + '>' +
              '<span><b>按框架合同自动拆分为 ' + distinctSuppliers.length + ' 笔订单</b>' +
                '<span class="tiny muted" style="display:block;margin-top:2px">本单含 ' + UI.esc(distinctSuppliers.map(function (s) { return s.replace(/[（(].*[)）]/g, ''); }).join('、')) + '；拆单后各自审批、验货、结算与对账，互不串账</span></span>' +
            '</label>'
          : '');
      const chk = host.querySelector('#chk-split-contract');
      if (chk) chk.onchange = function () { form.splitByContract = !!chk.checked; };
    }

    const destOptions = isDept
      ? ['公司总部'].concat(deptStores)
      : (me.stores || []);

    root.innerHTML =
      '<div class="card card-pad">' +
        '<div class="section-title mb12">收货信息</div>' +
        (isDept
          ? '<div class="field"><div class="label">配送地点</div>' +
              '<div class="radio-cards">' +
                '<label class="radio-card' + (destType === 'store' ? ' on' : '') + '" data-dtype="store">' +
                  '<span class="rd"></span><span class="grow"><span>配送到门店</span><span class="d">门店收货并验收</span></span></label>' +
                '<label class="radio-card' + (destType === 'office' ? ' on' : '') + '" data-dtype="office">' +
                  '<span class="rd"></span><span class="grow"><span>配送到公司总部</span><span class="d">由采购部门验收</span></span></label>' +
              '</div></div>' +
            '<div class="field" id="dest-field"></div>'
          : '<div class="field"><div class="label">收货门店</div>' +
              '<select class="select" id="f-store">' + (me.stores || []).map(function (s) {
                return '<option' + (s === destStore ? ' selected' : '') + '>' + UI.esc(s) + '</option>';
              }).join('') + '</select></div>') +
        '<div class="field-row">' +
          '<div class="field"><div class="label">收货人<span class="req">*</span></div>' +
            '<input class="input" id="f-receiver" value="' + UI.esc(form.receiver) + '" maxlength="20"></div>' +
          '<div class="field"><div class="label">期望到货</div>' +
            '<input class="input" id="f-due" type="date" min="' + UI.todayStr() + '" value="' + form.due + '"></div>' +
        '</div>' +
        '<div class="field"><div class="label">收货地址<span class="req">*</span></div>' +
          '<input class="input" id="f-address" value="' + UI.esc(form.address) + '" maxlength="80" placeholder="楼栋 / 门牌 / 收货点"></div>' +
        '<div class="field"><div class="label">采购用途</div>' +
          '<input class="input" id="f-purpose" value="' + UI.esc(form.purpose) + '" maxlength="40"></div>' +
        '<div class="field"><div class="label">备注</div>' +
          '<textarea class="textarea" id="f-note" maxlength="200" placeholder="选填，例如活动时间、摆放要求"></textarea></div>' +
        '<div class="field" id="over-reason-wrap" style="display:none"><div class="label" style="color:var(--bad)">超预算说明<span class="req">*</span></div>' +
          '<textarea class="textarea" id="f-over-reason" maxlength="160" placeholder="本单超出科目可用额度，请填写至少4个字的超预算原因，供战区与运营管理部核定"></textarea></div>' +
      '</div>' +

      '<div class="card card-pad mt12" id="quote"></div>' +

      '<div class="actionbar">' +
        '<button class="btn ghost" id="btn-draft">存草稿</button>' +
        '<button class="btn primary" id="btn-submit" style="flex:1.6">提交订单</button>' +
      '</div>' +
      '<div class="action-spacer"></div>' +

      '<div class="tiny muted" style="text-align:center;padding:4px 0 12px">提交即按规则进入审批或直接发送供应商；演示数据仅保存在本机</div>';

    if (isDept) {
      const field = root.querySelector('#dest-field');
      function renderDest() {
        const opts = destType === 'office' ? ['公司总部'] : deptStores;
        if (destType === 'office') destStore = '公司总部';
        else if (opts.indexOf(destStore) < 0) destStore = opts[0];
        field.innerHTML = '<div class="label">' + (destType === 'office' ? '收货地点' : '收货门店') + '</div>' +
          '<select class="select" id="f-dest">' + opts.map(function (s) {
            return '<option' + (s === destStore ? ' selected' : '') + '>' + UI.esc(s) + '</option>';
          }).join('') + '</select>';
        field.querySelector('#f-dest').onchange = function (e) {
          destStore = e.target.value;
          form.address = destType === 'office' ? '公司总部收货区（演示地址）' : destStore + ' 收货区（演示地址）';
          root.querySelector('#f-address').value = form.address;
          renderQuote();
        };
      }
      renderDest();

      root.querySelectorAll('[data-dtype]').forEach(function (el) {
        el.addEventListener('click', function () {
          destType = el.dataset.dtype;
          root.querySelectorAll('[data-dtype]').forEach(function (x) {
            x.classList.toggle('on', x.dataset.dtype === destType);
          });
          renderDest();
          renderQuote();
        });
      });
    } else {
      const sel = root.querySelector('#f-store');
      sel.onchange = function () {
        destStore = sel.value;
        form.address = destStore + ' 收货区（演示地址）';
        root.querySelector('#f-address').value = form.address;
        renderQuote();
      };
    }

    root.querySelector('#f-due').min = UI.todayStr();
    renderQuote();

    function readForm() {
      const overEl = root.querySelector('#f-over-reason');
      return {
        receiver: root.querySelector('#f-receiver').value.trim(),
        address: root.querySelector('#f-address').value.trim(),
        purpose: root.querySelector('#f-purpose').value.trim() || '门店日常运营',
        due: root.querySelector('#f-due').value || '',
        note: root.querySelector('#f-note').value.trim(),
        overReason: overEl ? overEl.value.trim() : ''
      };
    }

    function validate(f) {
      if (!f.receiver) return '请填写收货人';
      if (f.receiver.length > 20) return '收货人姓名过长';
      if (!f.address) return '请填写收货地址';
      if (f.address.length > 80) return '地址过长，请精简';
      if (f.due && f.due < UI.todayStr()) return '期望到货日期不能早于今天';
      const q = quoteOf();
      if (q && q.hardOver) {
        return isDept ? '已超出供应商合同总额上限，无法提交' : '已超出门店科目可用额度与机动池可核定上限，请拆分下单';
      }
      if (!isDept && q && q.overBudget && (!f.overReason || f.overReason.length < 4)) {
        return '本单超出科目可用额度，请填写至少 4 个字的超预算说明';
      }
      return '';
    }

    root.querySelector('#btn-submit').onclick = function () {
      const f = readForm();
      const bad = validate(f);
      if (bad) { UI.toast(bad, 'error'); return; }

      const btn = root.querySelector('#btn-submit');
      btn.disabled = true;

      try {
        if (isDept) {
          const res = App.mutate(function (st, ses) {
            return BIZ.domain.createDepartmentOrders(st, ses, {
              purpose: f.purpose,
              note: f.note,
              destinations: [{
                type: destType,
                name: destType === 'office' ? '公司总部' : destStore,
                address: f.address,
                receiver: f.receiver,
                items: items
              }]
            });
          });
          Store.clearCart(me.id);
          UI.toast('已提交 ' + res.orders.length + ' 个配送点，共 ¥' + UI.money(res.total), 'good');
          App.go('/order/' + res.orders[0].id);
        } else {
          const res = App.mutate(function (st, ses) {
            return BIZ.domain.createStoreOrder(st, ses, {
              store: destStore,
              details: f,
              items: items,
              splitByContract: form.splitByContract
            });
          });
          Store.clearCart(me.id);
          const createdOrders = (res && res.orders && res.orders.length) ? res.orders : [res.order];
          const nowIso = new Date().toISOString();
          Store.appendAudit(createdOrders.map(function (o) {
            return {
              orderId: o.id, kind: 'submit', stage: 'submit', decision: '提交订单',
              role: me.name, from: '', to: o.status,
              note: '门店采购 ' + (o.items || []).length + ' 项，金额 ¥' + UI.money(o.total) + (res.splitByContract ? '（按合同拆单）' : ''),
              at: nowIso
            };
          }));
          if (createdOrders.length > 1) {
            UI.toast('已按合同拆分为 ' + createdOrders.length + ' 笔订单提交', 'good', 2400);
            App.go('/orders');
          } else {
            UI.toast('已提交，金额 ¥' + UI.money(createdOrders[0].total), 'good');
            App.go('/order/' + createdOrders[0].id);
          }
        }
      } catch (e) {
        btn.disabled = false;
        UI.toast(e.message, 'error', 2800);
      }
    };

    root.querySelector('#btn-draft').onclick = function () {
      const f = readForm();
      const now = new Date().toISOString();
      const draft = {
        id: 'DR-' + Date.now().toString(36),
        actorId: me.id,
        actorName: me.name,
        lines: Object.assign({}, cart.lines),
        store: destStore,
        destType: destType,
        details: f,
        amount: items.reduce(function (s, x) {
          const p = catMap[x.id] || BIZ.domain.CATALOG_BY_ID[x.id];
          return s + (p ? p.price : 0) * x.qty;
        }, 0),
        count: items.length,
        updatedAt: now
      };
      Store.saveDraft(draft);
      UI.toast('已存入草稿箱', 'good');
    };
  };
})(window.Views);
