/* 结算页：收货信息 + 后台试算 + 提交（门店单 / 部门单） */
(function (Views) {
  Views.checkout = function (root, r, ctx) {
    const domain = BIZ.domain;
    const perm = BIZ.perm;
    const me = ctx.me;
    const state = ctx.state;
    const isDept = perm.isDepartmentFlow(me);

    const cart = Store.loadCart(me.id);
    const items = Object.keys(cart.lines || {}).filter(function (id) {
      return cart.lines[id] > 0 && BIZ.domain.CATALOG_BY_ID[id];
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
      note: ''
    };

    function quoteOf() {
      if (isDept) {
        const total = items.reduce(function (s, x) {
          return s + BIZ.domain.CATALOG_BY_ID[x.id].price * x.qty;
        }, 0);
        return {
          total: Math.round(total * 100) / 100,
          overBudget: false,
          tierLabel: '部门采购',
          pathText: me.role === 'central' ? '运营管理部自采，提交后直接发送供应商' : '部门采购，提交后由运营管理部统一确认',
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
      if (!q || q.error) {
        host.innerHTML = '<div class="small" style="color:var(--bad)">' + UI.esc(q ? q.error : '试算失败') + '</div>';
        return;
      }
      const lines = items.map(function (x) {
        const p = BIZ.domain.CATALOG_BY_ID[x.id];
        return '<div class="item-line"><span class="nm">' + UI.esc(p.name) +
          '<small>' + UI.esc(p.spec || '') + '</small></span>' +
          '<span class="qty">×' + x.qty + '</span>' +
          '<span class="amt">¥' + UI.money(p.price * x.qty) + '</span></div>';
      }).join('');

      const catRows = (!isDept && q.budgetItems && q.budgetItems.length)
        ? '<div class="cat-split">' + q.budgetItems.map(function (r) {
            const pct = r.budget > 0 ? Math.min(100, Math.round(r.total / r.budget * 100)) : 0;
            return '<div class="cat-line">' +
              '<div class="between"><span class="cat-name">' + UI.esc(r.name) + '</span>' +
                '<span class="cat-amt' + (r.overBudget ? ' red' : '') + '">¥' + UI.money(r.total) + '</span></div>' +
              '<div class="bar" style="height:4px"><i class="' + (r.overBudget ? 'bad' : '') + '" style="width:' + Math.min(100, pct) + '%"></i></div>' +
              '<div class="tiny muted mt4">该科目可用 ¥' + UI.money(r.usable) +
                (r.overBudget ? ' · 超 ¥' + UI.money(r.over) : '') + '</div>' +
            '</div>';
          }).join('') + '</div>'
        : '';

      host.innerHTML =
        '<div class="between" style="margin-bottom:4px"><span class="section-title">商品明细</span>' +
          '<span class="tiny muted">' + items.length + ' 种 / ' + items.reduce(function (s, x) { return s + x.qty; }, 0) + ' 件</span></div>' +
        lines +
        catRows +
        '<div class="divider"></div>' +
        '<div class="kv"><span class="k">订单金额</span><span class="v num money" style="font-size:18px">¥' + UI.money(q.total) + '</span></div>' +
        (!isDept
          ? '<div class="kv"><span class="k">科目可用额度</span><span class="v num">¥' + UI.money(q.available) + '</span></div>' +
            '<div class="kv"><span class="k">可核定上限</span><span class="v num">¥' + UI.money(q.maxSupport) + '<span class="tiny muted">（门店额度 + 机动池）</span></span></div>' +
            (q.overBudget
              ? '<div class="kv"><span class="k" style="color:var(--bad)">超出可用</span><span class="v num money red">¥' + UI.money(q.overAmount) + '</span></div>'
              : '')
          : '') +
        '<div class="kv"><span class="k">审批路径</span><span class="v">' +
          '<span class="pill ' + (q.overBudget && q.hardOver ? 'bad' : q.overBudget ? 'warn' : 'info') + '">' + UI.esc(q.tierLabel) + '</span>' +
          '<div class="tiny muted mt4">' + UI.esc(q.pathText) + '</div></span></div>' +
        (q.hardOver
          ? '<div class="alert mt8">' + UI.icon('alert', 'sm') + '<span>超过单笔可核定上限，建议拆分下单或转专项采购</span></div>'
          : '');
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
      return {
        receiver: root.querySelector('#f-receiver').value.trim(),
        address: root.querySelector('#f-address').value.trim(),
        purpose: root.querySelector('#f-purpose').value.trim() || '门店日常运营',
        due: root.querySelector('#f-due').value || '',
        note: root.querySelector('#f-note').value.trim()
      };
    }

    function validate(f) {
      if (!f.receiver) return '请填写收货人';
      if (f.receiver.length > 20) return '收货人姓名过长';
      if (!f.address) return '请填写收货地址';
      if (f.address.length > 80) return '地址过长，请精简';
      if (f.due && f.due < UI.todayStr()) return '期望到货日期不能早于今天';
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
              items: items
            });
          });
          Store.clearCart(me.id);
          Store.appendAudit([{
            orderId: res.order.id, kind: 'submit', stage: 'submit', decision: '提交订单',
            role: me.name, from: '', to: res.order.status,
            note: '门店采购 ' + items.length + ' 项，金额 ¥' + UI.money(res.order.total), at: new Date().toISOString()
          }]);
          UI.toast('已提交，金额 ¥' + UI.money(res.order.total), 'good');
          App.go('/order/' + res.order.id);
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
          return s + BIZ.domain.CATALOG_BY_ID[x.id].price * x.qty;
        }, 0),
        count: items.length,
        updatedAt: now
      };
      Store.saveDraft(draft);
      UI.toast('已存入草稿箱', 'good');
    };
  };
})(window.Views);
