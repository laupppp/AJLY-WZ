/* 采购下单：左侧竖排两级目录 + 右侧商品列表 + 购物车（实时读取中台操作台维护的物资清单） */
(function (Views) {
  const TOP_SHORT = {
    '社群活动物资': '社群活动',
    '客诉维护物资': '客诉物资',
    '印刷品物料': '印刷物料',
    '社区活动服务': '活动服务'
  };

  function buildCatalogIndex(state, me) {
    const rawList = BIZ.domain.catalogOf(state, { activeOnly: true, buyer: me });
    const PRODUCTS = rawList.map(function (p) {
      return {
        id: p.id,
        name: p.name,
        spec: p.spec,
        unit: p.unit,
        price: p.price,
        supplier: p.supplier,
        category: p.category,
        budgetItem: p.budgetItem || '',
        purchaseScope: p.purchaseScope || 'all',
        isCustom: !!p.isCustom,
        serviceType: p.serviceType || '',
        serviceGroup: p.serviceGroup || '',
        projectCode: p.projectCode || '',
        participants: p.participants || '',
        deliveryRequirement: p.deliveryRequirement || '',
        note: p.note || '',
        icon: (BIZ.catalog.CATEGORY_META[p.category] || { icon: '📦' }).icon,
        key: (p.name + ' ' + (p.spec || '') + ' ' + (p.supplier || '') + ' ' + p.id).toLowerCase()
      };
    });
    const PMAP = {};
    PRODUCTS.forEach(function (p) { PMAP[p.id] = p; });
    const INDEX = BIZ.subcats.build(rawList);
    const byId = {};
    INDEX.nav.forEach(function (c) {
      c.subs.forEach(function (s) { byId[s.key] = s; });
    });
    const NAV = {
      list: [{
        key: 'all', label: '全部物资', short: '全部', count: PRODUCTS.length, subs: []
      }].concat(INDEX.nav.map(function (c) {
        return {
          key: c.key,
          label: c.label,
          short: TOP_SHORT[c.label] || c.label,
          count: c.count,
          subs: c.subs.length > 1 ? c.subs.map(function (s) {
            return { key: s.key, label: s.label, short: s.short, count: s.count };
          }) : []
        };
      })),
      subs: byId
    };
    const SUB_IDS = {};
    INDEX.nav.forEach(function (c) {
      c.subs.forEach(function (s) {
        const map = {};
        s.ids.forEach(function (id) { map[id] = 1; });
        SUB_IDS[s.key] = map;
      });
    });
    return { PRODUCTS: PRODUCTS, PMAP: PMAP, NAV: NAV, SUB_IDS: SUB_IDS };
  }

  Views.catalog = function (root, r, ctx) {
    const domain = BIZ.domain;
    const perm = BIZ.perm;
    const me = ctx.me;
    const state = ctx.state;
    const canBuy = perm.can(me, 'order.create');
    const isDept = perm.isDepartmentFlow(me);
    const catIdx = buildCatalogIndex(state, me);
    const PRODUCTS = catIdx.PRODUCTS;
    const PMAP = catIdx.PMAP;
    const NAV = catIdx.NAV;
    const SUB_IDS = catIdx.SUB_IDS;

    if (!canBuy) {
      root.innerHTML = UI.empty('🔒', '当前身份无下单权限', '战区负责人与供应商不在采购下单范围内');
      return;
    }

    if (me.role === 'central') {
      App.topAction('<a class="btn ghost sm" href="#/console">物资管理</a>');
    }

    let cart = Store.loadCart(me.id);
    cart.lines = cart.lines || {};
    // 清理已下架/不存在的商品
    Object.keys(cart.lines).forEach(function (id) {
      if (!PMAP[id] || !cart.lines[id]) delete cart.lines[id];
    });

    // 从草稿箱 / 订单详情跳回时按 URL 参数切到对应门店，否则购物车会被上下文过滤掉
    let storeName = cart.store || (me.role === 'store' ? (me.stores || [])[0] : (me.department || ''));
    if (me.role === 'store' && r.query.store) {
      const wanted = decodeURIComponent(r.query.store);
      if ((me.stores || []).indexOf(wanted) >= 0) storeName = wanted;
    }
    if (me.role === 'store' && (me.stores || []).indexOf(storeName) < 0) storeName = me.stores[0];
    cart.store = storeName;

    const view = { cat: 'all', sub: '', keyword: '', shown: 40, open: true, variants: {} };
    // 与小程序一致：带 category / sub 参数进页面时自动定位并展开对应目录
    if (r.query.category && NAV.list.some(function (c) { return c.key === r.query.category; })) {
      view.cat = r.query.category;
      view.open = true;
    }
    if (r.query.sub && NAV.subs[r.query.sub]) {
      const parent = NAV.list.filter(function (c) {
        return c.subs.some(function (s) { return s.key === r.query.sub; });
      })[0];
      if (parent) { view.cat = parent.key; view.sub = r.query.sub; view.open = true; }
    }

    function persist() {
      cart.store = storeName;
      Store.saveCart(me.id, cart);
      renderCart();
    }

    function lines() {
      return Object.keys(cart.lines).map(function (id) {
        return { id: id, qty: cart.lines[id], product: PMAP[id] };
      }).filter(function (x) { return x.product && x.qty > 0; });
    }

    function totals() {
      const ls = lines();
      return {
        count: ls.length,
        qty: ls.reduce(function (s, x) { return s + x.qty; }, 0),
        amount: ls.reduce(function (s, x) { return s + x.qty * x.product.price; }, 0)
      };
    }

    function filtered() {
      const kw = view.keyword.trim().toLowerCase();
      if (kw) {
        return PRODUCTS.filter(function (p) { return p.key.indexOf(kw) >= 0; });
      }
      if (view.sub && SUB_IDS[view.sub]) {
        const ids = SUB_IDS[view.sub];
        return PRODUCTS.filter(function (p) { return ids[p.id]; });
      }
      if (view.cat !== 'all') return PRODUCTS.filter(function (p) { return p.category === view.cat; });
      return PRODUCTS;
    }

    // 同一活动项目的不同人数档位，合并成一张商品卡片。
    // 实际下单仍使用独立 SKU，因此订单、价格、草稿、验收和对账无需改造。
    function displayProducts() {
      const products = filtered();
      const groups = {};
      const display = [];
      products.forEach(function (p) {
        if (p.category === '社区活动服务' && p.serviceType === 'activity' && p.projectCode) {
          const key = p.projectCode;
          if (!groups[key]) {
            groups[key] = { key: key, variants: [], product: null };
            display.push(groups[key]);
          }
          groups[key].variants.push(p);
        } else {
          display.push({ key: p.id, variants: [p], product: p });
        }
      });
      display.forEach(function (entry) {
        if (entry.product) return;
        entry.variants.sort(function (a, b) {
          return (parseInt(a.participants, 10) || 0) - (parseInt(b.participants, 10) || 0);
        });
        const selected = view.variants[entry.key];
        entry.product = entry.variants.filter(function (p) { return p.id === selected; })[0] ||
          entry.variants.filter(function (p) { return (cart.lines[p.id] || 0) > 0; })[0] || entry.variants[0];
      });
      return display;
    }

    root.innerHTML =
      '<div class="cat-page">' +
        '<div class="cat-top">' +
          '<div class="ctx-line">' +
            '<div class="ctx-left">' +
              '<div class="ctx-k">' + (isDept ? '采购部门' : '收货门店') + '</div>' +
              '<div class="ctx-v" id="ctx-v"></div>' +
            '</div>' +
            '<div class="ctx-sum"><b id="ctx-amt">¥0</b><span id="ctx-qty">未选商品</span></div>' +
          '</div>' +
          '<div class="cat-budget" id="cat-budget"></div>' +
          '<div class="search" id="search"><svg class="ic"><use href="#i-search"/></svg>' +
            '<input id="q" type="search" placeholder="搜索商品名称 / 规格 / 供应商" autocomplete="off">' +
            '<button class="clear" id="q-clear"><svg class="ic sm"><use href="#i-close"/></svg></button>' +
          '</div>' +
          '<div class="cat-head"><span class="t" id="cat-title">全部物资 <span id="cat-count"></span></span>' +
            '<span class="c" id="cat-sub"></span></div>' +
        '</div>' +
        '<div class="cat-body">' +
          '<aside class="rail" id="rail"></aside>' +
          '<section class="goods">' +
            '<div class="plist" id="plist"></div>' +
            '<div id="more"></div>' +
          '</section>' +
        '</div>' +
      '</div>' +
      '<div class="cartbar" id="cartbar">' +
        '<div class="sum"><div class="k" id="cart-k">购物车</div><div class="v" id="cart-v">¥0.00</div></div>' +
        '<button class="btn ghost" id="cart-open">清单</button>' +
        '<button class="btn primary" id="cart-go">去结算</button>' +
      '</div>';

    const ctxV = root.querySelector('#ctx-v');

    function renderCtx() {
      if (isDept) {
        ctxV.innerHTML = UI.esc(storeName || me.department || '') + '<span class="pill violet" style="margin-left:6px">部门采购</span>';
      } else if ((me.stores || []).length > 1) {
        ctxV.innerHTML = '<select class="select" id="store-pick" style="height:34px;min-height:34px;padding:0 28px 0 10px;font-size:13.5px;font-weight:600;width:auto;border-radius:9px">' +
          me.stores.map(function (s) {
            return '<option value="' + UI.esc(s) + '"' + (s === storeName ? ' selected' : '') + '>' + UI.esc(s) + '</option>';
          }).join('') + '</select>';
        const pick = ctxV.querySelector('#store-pick');
        if (pick) pick.onchange = function () { storeName = pick.value; persist(); };
      } else {
        ctxV.innerHTML = UI.esc(storeName || '未分配门店');
      }
    }

    function renderRail() {
      const rail = root.querySelector('#rail');
      rail.innerHTML = NAV.list.map(function (c) {
        if (c.key === 'all') {
          return '<div class="rail-cat' + (view.cat === 'all' && !view.keyword ? ' on' : '') + '" data-cat="all">' +
            '<span>全部物资</span><span class="n">' + c.count + '</span></div>';
        }
        // 再点同一大类收起二级目录（列表仍停在该大类）：view.open 必须真正参与渲染
        const open = view.cat === c.key && view.open;
        const on = view.cat === c.key && !view.sub;
        const tone = UI.budgetKeyOf(c.label);
        return '<div class="rail-cat tone-' + tone + (on ? ' on' : '') + (open ? ' open' : '') + '" data-cat="' + UI.esc(c.key) + '"' +
          (c.subs.length ? ' title="再点一次可收起二级目录"' : '') + '>' +
          '<span>' + UI.esc(c.short) + '</span>' +
          (c.subs.length ? UI.icon('right') : '<span class="n">' + c.count + '</span>') +
        '</div>' +
        (open ? c.subs.map(function (s) {
          return '<div class="rail-sub compact' + (view.sub === s.key ? ' on' : '') + '" data-sub="' + UI.esc(s.key) + '">' +
            '<span>' + UI.esc(s.short) + '</span><span class="n">' + s.count + '</span></div>';
        }).join('') + '<div class="rail-fold" data-fold="' + UI.esc(c.key) + '">收起 ⌃</div>' : '');
      }).join('') + '<div class="rail-pad"></div>';
    }

    function renderList() {
      const list = displayProducts();
      const shown = Math.min(view.shown, list.length);
      const slice = list.slice(0, shown);

      let title = '全部物资', sub = '';
      if (view.keyword) {
        title = '搜索结果';
        sub = '“' + view.keyword.trim() + '”';
      } else if (view.sub && NAV.subs[view.sub]) {
        const s = NAV.subs[view.sub];
        const parent = NAV.list.filter(function (c) {
          return c.subs.some(function (x) { return x.key === s.key; });
        })[0];
        const meta = parent && BIZ.catalog.CATEGORY_META[parent.key];
        title = s.label;
        sub = meta ? (meta.contract + ' · ' + meta.budgetName) : (parent ? parent.label : '');
      } else if (view.cat !== 'all') {
        const c = NAV.list.filter(function (x) { return x.key === view.cat; })[0];
        const meta = BIZ.catalog.CATEGORY_META[view.cat];
        title = c ? c.label : '全部物资';
        sub = meta ? (meta.contract + ' · ' + meta.budgetName) : '';
      } else {
        sub = '运营物资、印刷物料与社区活动服务，共4大类';
      }

      root.querySelector('#cat-title').firstChild.nodeValue = title + ' ';
      root.querySelector('#cat-count').textContent = '· 共 ' + list.length + ' 项' + (list.some(function (entry) { return entry.variants.length > 1; }) ? '活动/服务' : '');
      root.querySelector('#cat-sub').textContent = sub;

      const host = root.querySelector('#plist');
      if (!slice.length) {
        host.innerHTML = UI.empty('🔍', '没有匹配的商品', '换个关键词，或点左侧其他分类');
      } else {
        host.innerHTML = slice.map(function (entry) {
          const p = entry.product;
          const isTiered = entry.variants.length > 1;
          const qty = cart.lines[p.id] || 0;
          const bKey = UI.budgetKeyOf(p);
          const scopeBadge = (me.role === 'central' && p.purchaseScope === 'central')
            ? '<span class="pill violet" style="margin-left:auto">仅中台采</span>'
            : '';
          return '<div class="prod" data-id="' + UI.esc(p.id) + '">' +
            '<div class="prod-ico tone-' + bKey + '">' + UI.catIcon(bKey) + '</div>' +
            '<div class="prod-main">' +
              '<div class="prod-name">' + UI.esc(p.name) + '</div>' +
              '<div class="prod-spec">' + UI.esc(p.spec || '') +
                (p.supplier ? '<span class="prod-sup"> · ' + UI.esc(p.supplier) + '</span>' : '') + '</div>' +
              (isTiered ? '<div class="activity-tier" style="margin:8px 0 6px">' +
                '<label class="tiny muted" for="tier-' + UI.esc(entry.key) + '">参与人数档位（选择后自动更新价格）</label>' +
                '<select class="select" style="width:100%;max-width:300px;margin-top:4px;min-height:36px" id="tier-' + UI.esc(entry.key) + '" data-activity-tier="' + UI.esc(entry.key) + '">' +
                entry.variants.map(function (v) {
                  return '<option value="' + UI.esc(v.id) + '"' + (v.id === p.id ? ' selected' : '') + '>' +
                    UI.esc(v.participants || v.spec) + ' — ¥' + UI.money2(v.price) + ' / ' + UI.esc(v.unit || '场') + '</option>';
                }).join('') + '</select></div>' : '') +
              '<div class="prod-foot"><span class="prod-price">¥' + UI.money2(p.price) + '</span>' +
                '<span class="prod-unit">/ ' + UI.esc(p.unit || '件') + '</span>' +
                (p.category === '社区活动服务' ? '<span class="tiny muted" style="margin-left:6px">预算指导价·非合同价</span>' : '') +
                scopeBadge + '</div>' +
              (p.category === '社区活动服务' ? '<div><button class="btn ghost xs" style="margin-top:5px" data-service-detail="' + UI.esc(p.id) + '">查看执行方案</button></div>' : '') +
            '</div>' +
            '<div class="prod-act">' +
              (qty
                ? '<div class="stepper"><button class="step-btn" data-minus="' + UI.esc(p.id) + '">' + UI.icon('minus') + '</button>' +
                  '<span class="step-qty">' + qty + '</span>' +
                  '<button class="step-btn" data-plus="' + UI.esc(p.id) + '">' + UI.icon('plus') + '</button></div>'
                : '<button class="step-btn add" data-plus="' + UI.esc(p.id) + '">' + UI.icon('plus') + '</button>') +
            '</div>' +
          '</div>';
        }).join('');
      }

      const more = root.querySelector('#more');
      if (list.length > shown) {
        more.innerHTML = '<button class="more" id="btn-more">加载更多（还有 ' + (list.length - shown) + ' 项）</button>';
        root.querySelector('#btn-more').onclick = function () {
          view.shown += 40;
          renderList();
        };
      } else {
        more.innerHTML = list.length > 40 ? '<div class="tiny muted" style="text-align:center;padding:10px 0 4px">已显示全部 ' + list.length + ' 项</div>' : '';
      }
    }

    function renderBudgetBar() {
      const host = root.querySelector('#cat-budget');
      if (!host) return;
      const ls = lines();

      if (isDept) {
        const dq = ls.length
          ? domain.computeDepartmentQuote(state, ls.map(function (x) { return { id: x.id, qty: x.qty }; }))
          : null;
        const rows = (dq && dq.contractRows && dq.contractRows.length)
          ? dq.contractRows
          : domain.contractSummary(state).map(function (c) {
              return { supplier: c.supplier, total: c.total, used: c.used, remaining: c.remaining, apply: 0, over: 0, overCap: false };
            });
        if (!rows.length) { host.innerHTML = ''; return; }
        host.innerHTML = '<div class="cb-grid" style="grid-template-columns:repeat(' + Math.min(3, rows.length) + ',minmax(0,1fr))">' +
          rows.slice(0, 3).map(function (r) {
            const total = Number(r.total || 0);
            const usedAll = Number(r.used || 0) + Number(r.apply || 0);
            const pct = total > 0 ? Math.min(100, Math.round(usedAll / total * 100)) : 0;
            const tone = r.overCap ? 'bad' : (pct >= 75 ? 'warn' : '');
            const remain = Math.round((Number(r.remaining || 0) - Number(r.apply || 0)) * 100) / 100;
            const shortName = String(r.supplier || '').replace(/[（(].*[)）]/g, '');
            const cTone = String(r.supplier || '').indexOf('印刷') >= 0 ? 'marketing' : 'community';
            return '<div class="cb-item tone-' + cTone + (r.overCap ? ' bad' : '') + '">' +
              '<div class="cb-top"><span>' + UI.esc(shortName) + '</span>' +
                (r.apply > 0 ? '<b class="num">+¥' + UI.money(r.apply) + '</b>' : '<span class="muted">合同</span>') + '</div>' +
              '<div class="bar" style="height:4px;margin-top:4px"><i class="' + (tone || ('tone-' + cTone)) + '" style="width:' + pct + '%"></i></div>' +
              '<div class="cb-sub">' + (r.overCap ? ('超 ¥' + UI.money(r.over)) : ('余 ¥' + UI.money(Math.max(0, remain)))) + '</div>' +
            '</div>';
          }).join('') + '</div>';
        return;
      }

      if (!storeName) { host.innerHTML = ''; return; }
      const rows = domain.storeBudgetRows(state, storeName);
      const cartByKey = {};
      ls.forEach(function (x) {
        const k = BIZ.budget.itemOf(x.product);
        cartByKey[k] = Math.round(((cartByKey[k] || 0) + x.qty * x.product.price) * 100) / 100;
      });
      host.innerHTML = '<div class="cb-grid">' + rows.map(function (row) {
        const add = cartByKey[row.key] || 0;
        const afterUsed = row.used + add;
        const pct = row.budget > 0 ? Math.min(100, Math.round(afterUsed / row.budget * 100)) : 0;
        const over = Math.round((add - row.available) * 100) / 100;
        const isOver = over > 0;
        const tone = isOver ? 'bad' : (pct >= 75 ? 'warn' : '');
        const left = Math.round((row.available - add) * 100) / 100;
        return '<div class="cb-item tone-' + row.key + (isOver ? ' bad' : '') + '">' +
          '<div class="cb-top"><span>' + UI.esc(row.short || row.name) + '</span>' +
            (add > 0 ? '<b class="num">+¥' + UI.money(add) + '</b>' : '<span class="muted">可用</span>') + '</div>' +
          '<div class="bar" style="height:4px;margin-top:4px"><i class="' + (tone || ('tone-' + row.key)) + '" style="width:' + pct + '%"></i></div>' +
          '<div class="cb-sub">' + (isOver ? ('超 ¥' + UI.money(over)) : ('余 ¥' + UI.money(Math.max(0, left)))) + '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    function renderCart() {
      const t = totals();
      const bar = root.querySelector('#cartbar');
      bar.classList.toggle('on', t.qty > 0);
      root.querySelector('#ctx-amt').textContent = '¥' + UI.money2(t.amount);
      root.querySelector('#ctx-qty').textContent = t.qty ? t.qty + ' 件 · ' + t.count + ' 种' : '未选商品';
      root.querySelector('#cart-v').textContent = '¥' + UI.money2(t.amount);
      root.querySelector('#cart-k').textContent = t.count + ' 种 / ' + t.qty + ' 件';
      renderBudgetBar();
      // 同步列表中的数量显示
      const rows = root.querySelectorAll('.prod[data-id]');
      rows.forEach(function (row) {
        const id = row.dataset.id;
        const qty = cart.lines[id] || 0;
        const act = row.querySelector('.prod-act');
        if (!act) return;
        const has = act.querySelector('.stepper');
        if (qty && !has) {
          act.innerHTML = '<div class="stepper"><button class="step-btn" data-minus="' + id + '">' + UI.icon('minus') + '</button>' +
            '<span class="step-qty">' + qty + '</span>' +
            '<button class="step-btn" data-plus="' + id + '">' + UI.icon('plus') + '</button></div>';
        } else if (!qty && has) {
          act.innerHTML = '<button class="step-btn add" data-plus="' + id + '">' + UI.icon('plus') + '</button>';
        } else if (has) {
          act.querySelector('.step-qty').textContent = qty;
        }
      });
    }

    function changeQty(id, delta) {
      const p = PMAP[id];
      if (!p) return;
      const next = (cart.lines[id] || 0) + delta;
      if (next <= 0) delete cart.lines[id];
      else if (next > 9999) { UI.toast('单个商品最多 9999 件', 'error'); return; }
      else cart.lines[id] = next;
      persist();
      const counter = root.querySelector('#cat-count');
      if (counter) { /* 数量变化不影响条目数 */ }
    }

    function openCart() {
      if (!totals().qty) return;

      function bodyHtml() {
        const ls = lines();
        const t = totals();
        return '<div class="note-box mb12">' + (isDept ? '部门采购' : '收货门店') + '：<b>' + UI.esc(storeName) + '</b> · 共 ' + t.count + ' 种 ' + t.qty + ' 件</div>' +
          '<div class="ship-lines">' + ls.map(function (x) {
            return '<div class="ship-line"><span class="nm">' + UI.esc(x.product.name) +
              '<small>¥' + UI.money2(x.product.price) + ' / ' + UI.esc(x.product.unit || '件') + '</small></span>' +
              '<button class="step-btn" data-sheet-minus="' + UI.esc(x.id) + '">' + UI.icon('minus') + '</button>' +
              '<span class="step-qty">' + x.qty + '</span>' +
              '<button class="step-btn" data-sheet-plus="' + UI.esc(x.id) + '">' + UI.icon('plus') + '</button></div>';
          }).join('') + '</div>';
      }

      const s = UI.sheet({
        title: '采购清单',
        sub: '合计 ¥' + UI.money2(totals().amount),
        body: bodyHtml(),
        actions: [
          { label: '清空清单', cls: 'danger', onClick: function () {
              cart.lines = {};
              persist();
              return true;
            } },
          { label: '去结算', cls: 'primary', onClick: function () { App.go('/checkout'); } }
        ],
        mount: function (bodyEl) {
          bodyEl.addEventListener('click', function (e) {
            const plus = e.target.closest('[data-sheet-plus]');
            const minus = e.target.closest('[data-sheet-minus]');
            if (!plus && !minus) return;
            const id = plus ? plus.dataset.sheetPlus : minus.dataset.sheetMinus;
            changeQty(id, plus ? 1 : -1);
            if (!totals().qty) { s.close(); return; }
            bodyEl.innerHTML = bodyHtml();
            s.setSub('合计 ¥' + UI.money2(totals().amount));
          });
        }
      });
    }

    // 人数档位只改变当前展示的 SKU，不擅自改动已经加入购物车的其他档位。
    root.addEventListener('change', function (e) {
      const picker = e.target.closest('[data-activity-tier]');
      if (!picker) return;
      const selected = PMAP[picker.value];
      if (!selected || selected.serviceType !== 'activity' || selected.projectCode !== picker.dataset.activityTier) return;
      view.variants[picker.dataset.activityTier] = selected.id;
      renderList();
      renderCart();
    });

    // --- 交互 ---
    root.addEventListener('click', function (e) {
      const cat = e.target.closest('[data-cat]');
      if (cat) {
        const key = cat.dataset.cat;
        if (view.cat === key) {
          view.open = !view.open;
        } else {
          view.cat = key;
          view.open = true;
        }
        view.sub = '';
        view.keyword = '';
        view.shown = 40;
        const q = root.querySelector('#q');
        if (q) { q.value = ''; root.querySelector('#search').classList.remove('has'); }
        renderRail(); renderList();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const fold = e.target.closest('[data-fold]');
      if (fold) {
        view.cat = fold.dataset.fold;
        view.open = false;
        view.sub = '';
        view.shown = 40;
        renderRail(); renderList();
        return;
      }

      const sub = e.target.closest('[data-sub]');
      if (sub) {
        view.sub = sub.dataset.sub === view.sub ? '' : sub.dataset.sub;
        view.keyword = '';
        view.shown = 40;
        renderRail(); renderList();
        return;
      }

      const detail = e.target.closest('[data-service-detail]');
      if (detail) {
        const p = PMAP[detail.dataset.serviceDetail];
        if (!p) return;
        UI.sheet({
          title: p.name,
          sub: p.spec + ' · ¥' + UI.money2(p.price) + '/' + p.unit,
          body: '<div class="note-box mb12">预算指导价，非中标或合同成交价；活动整包与配套项目须避免重复计费。</div>' +
            '<div class="small" style="white-space:pre-wrap;line-height:1.75">' + UI.esc(p.deliveryRequirement || '具体实施内容以采购合同约定为准') + '</div>' +
            (p.note ? '<div class="note-box mt12">' + UI.esc(p.note) + '</div>' : ''),
          actions: [{label:'关闭',cls:'primary'}]
        });
        return;
      }

      const plus = e.target.closest('[data-plus]');
      if (plus) {
        changeQty(plus.dataset.plus, 1);
        return;
      }

      const minus = e.target.closest('[data-minus]');
      if (minus) {
        changeQty(minus.dataset.minus, -1);
      }
    });

    const input = root.querySelector('#q');
    const search = root.querySelector('#search');
    input.addEventListener('input', UI.debounce(function () {
      view.keyword = input.value;
      view.shown = 40;
      search.classList.toggle('has', !!input.value);
      renderRail();
      renderList();
    }, 180));

    root.querySelector('#q-clear').onclick = function () {
      input.value = '';
      view.keyword = '';
      search.classList.remove('has');
      renderRail(); renderList();
      input.focus();
    };

    root.querySelector('#cart-open').onclick = openCart;
    root.querySelector('#cart-go').onclick = function () {
      if (!totals().qty) { UI.toast('请先选择商品', 'error'); return; }
      App.go('/checkout');
    };

    renderCtx();
    renderRail();
    renderList();
    renderCart();
  };
})(window.Views);
