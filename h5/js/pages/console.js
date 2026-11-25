/* 中台操作台（仅运营管理部）：物资增删改与上下架、供应商合同总额上限、门店审批规则配置 */
(function (Views) {
  Views.console = function (root, r, ctx) {
    const domain = BIZ.domain;
    const perm = BIZ.perm;
    const BUDGET = BIZ.budget;
    const me = ctx.me;

    if (!perm.can(me, 'catalog.manage')) {
      root.innerHTML = UI.empty('🔒', '仅运营管理部（中台）可进入操作台', '物资维护、合同上限与审批规则仅对运营管理部开放');
      return;
    }

    let state = ctx.state;
    const sync = function () { state = Store.loadState(); };

    let tab = ['catalog', 'contracts', 'rules'].indexOf(r.query.tab) >= 0 ? r.query.tab : 'catalog';
    let filter = 'all';
    let keyword = '';
    let shown = 30;

    function render() {
      sync();
      const tabsHtml =
        '<div class="tab-seg" id="con-tabs">' +
          '<button data-tab="catalog"' + (tab === 'catalog' ? ' class="on"' : '') + '>物资目录管理</button>' +
          '<button data-tab="contracts"' + (tab === 'contracts' ? ' class="on"' : '') + '>供应商合同上限</button>' +
          '<button data-tab="rules"' + (tab === 'rules' ? ' class="on"' : '') + '>审批规则配置</button>' +
        '</div>';

      let bodyHtml = '';
      if (tab === 'catalog') bodyHtml = renderCatalog();
      else if (tab === 'contracts') bodyHtml = renderContracts();
      else bodyHtml = renderRules();

      root.innerHTML = tabsHtml + bodyHtml;

      if (tab === 'catalog') {
        const qEl = root.querySelector('#con-q');
        const boxEl = root.querySelector('#con-search');
        if (qEl) {
          qEl.value = keyword;
          if (keyword && boxEl) boxEl.classList.add('has');
          qEl.addEventListener('input', UI.debounce(function () {
            keyword = qEl.value;
            shown = 30;
            renderCatalogListOnly();
          }, 180));
        }
      }
    }

    function catalogStats() {
      const all = domain.catalogOf(state, { includeDeleted: true });
      const live = all.filter(function (p) { return !p.deleted; });
      const active = live.filter(function (p) { return p.enabled !== false; });
      const off = live.filter(function (p) { return p.enabled === false; });
      const centralOnly = live.filter(function (p) { return p.purchaseScope === 'central'; });
      const deleted = all.filter(function (p) { return !!p.deleted; });
      const custom = live.filter(function (p) { return p.isCustom || p.isModified; });
      return { all: all, live: live, active: active, off: off, centralOnly: centralOnly, deleted: deleted, custom: custom };
    }

    function filterCatalog(stInfo) {
      let base;
      if (filter === 'deleted') base = stInfo.deleted;
      else if (filter === 'off') base = stInfo.off;
      else if (filter === 'central') base = stInfo.centralOnly;
      else if (filter === 'all') base = stInfo.live;
      else base = stInfo.live.filter(function (p) { return p.category === filter; });

      const kw = keyword.trim().toLowerCase();
      if (kw) {
        base = base.filter(function (p) {
          const hay = (p.id + ' ' + p.name + ' ' + (p.spec || '') + ' ' + (p.supplier || '')).toLowerCase();
          return hay.indexOf(kw) >= 0;
        });
      }
      return base;
    }

    function catalogItemHtml(p) {
      const bKey = UI.budgetKeyOf(p);
      const isCentralOnly = p.purchaseScope === 'central';
      const statusPill = p.deleted
        ? '<span class="pill bad">已删除</span>'
        : (p.enabled === false ? '<span class="pill warn">已下架</span>' : '<span class="pill good">在售</span>');
      const scopePill = !p.deleted
        ? (isCentralOnly ? '<span class="pill violet">仅中台采</span>' : '<span class="pill line">全员可采</span>')
        : '';
      const sourcePill = p.isCustom
        ? '<span class="pill info">新增</span>'
        : (p.isModified ? '<span class="pill dark">已修改</span>' : '');

      return '<div class="card card-pad con-item">' +
        '<div class="con-head">' +
          '<div class="prod-ico tone-' + bKey + '" style="width:36px;height:36px">' + UI.catIcon(bKey) + '</div>' +
          '<div class="grow" style="min-width:0">' +
            '<div class="row" style="gap:6px;flex-wrap:wrap">' +
              '<span class="strong">' + UI.esc(p.name) + '</span>' +
              '<span class="tiny muted mono">' + UI.esc(p.id) + '</span>' +
            '</div>' +
            '<div class="tiny muted mt4">' + UI.esc(p.category) + '</div>' +
          '</div>' +
          '<div class="con-tags">' + statusPill + scopePill + sourcePill + '</div>' +
        '</div>' +
        (p.spec ? '<div class="tiny muted mt8">规格：' + UI.esc(p.spec) + '</div>' : '') +
        '<div class="tiny muted mt4">供应商：' + UI.esc(p.supplier || '未指定') +
          (p.note ? ' · ' + UI.esc(p.note) : '') + '</div>' +
        '<div class="con-foot">' +
          '<div><span class="money" style="font-size:16px">¥' + UI.money2(p.price) + '</span>' +
            '<span class="tiny muted"> / ' + UI.esc(p.unit || '个') + '</span></div>' +
          '<div class="row" style="gap:6px;flex-wrap:wrap">' +
            (p.deleted
              ? '<button class="btn soft xs" data-cat-restore="' + UI.esc(p.id) + '">恢复上架</button>'
              : '<button class="btn ' + (isCentralOnly ? 'soft' : 'ghost') + ' xs" data-cat-scope="' + UI.esc(p.id) + '">' +
                  (isCentralOnly ? '开放全员采' : '设为仅中台采') + '</button>' +
                '<button class="btn ghost xs" data-cat-edit="' + UI.esc(p.id) + '">编辑</button>' +
                '<button class="btn ' + (p.enabled === false ? 'soft' : 'ghost') + ' xs" data-cat-toggle="' + UI.esc(p.id) + '">' +
                  (p.enabled === false ? '上架' : '下架') + '</button>' +
                '<button class="btn danger xs" data-cat-del="' + UI.esc(p.id) + '">删除</button>') +
          '</div>' +
        '</div>' +
      '</div>';
    }

    function renderCatalogListOnly() {
      const stInfo = catalogStats();
      const list = filterCatalog(stInfo);
      const slice = list.slice(0, shown);
      const host = root.querySelector('#con-list');
      const moreHost = root.querySelector('#con-more');
      const boxEl = root.querySelector('#con-search');
      if (boxEl) boxEl.classList.toggle('has', !!keyword);
      if (!host) return;
      host.innerHTML = slice.length
        ? slice.map(catalogItemHtml).join('')
        : UI.empty('📦', '没有匹配的物资', '可修改关键词或点右上角「＋ 新增物资」');
      if (moreHost) {
        moreHost.innerHTML = list.length > shown
          ? '<button class="more" id="con-btn-more">加载更多（还有 ' + (list.length - shown) + ' 项）</button>'
          : (list.length ? '<div class="tiny muted" style="text-align:center;padding:8px 0">共 ' + list.length + ' 项物资</div>' : '');
      }
    }

    function renderCatalog() {
      const stInfo = catalogStats();
      const list = filterCatalog(stInfo);
      const slice = list.slice(0, shown);

      const catChips = BIZ.catalog.CATEGORY_ORDER.map(function (cat) {
        const cnt = stInfo.live.filter(function (p) { return p.category === cat; }).length;
        return '<button class="chip' + (filter === cat ? ' on' : '') + '" data-cat-filter="' + UI.esc(cat) + '">' +
          UI.esc(cat) + '<span class="n">' + cnt + '</span></button>';
      }).join('');

      return '<div class="stat-grid">' +
          '<div class="stat"><div class="k">当前在售</div><div class="v num">' + stInfo.active.length + '</div><div class="d">共 ' + stInfo.live.length + ' 项（含下架）</div></div>' +
          '<div class="stat"><div class="k">仅中台采</div><div class="v num">' + stInfo.centralOnly.length + '</div><div class="d">门店与部门不可自采</div></div>' +
          '<div class="stat"><div class="k">已下架</div><div class="v num">' + stInfo.off.length + '</div><div class="d">暂不可新下单</div></div>' +
          '<div class="stat"><div class="k">中台维护</div><div class="v num">' + stInfo.custom.length + '</div><div class="d">已新增/修改</div></div>' +
        '</div>' +

        '<div class="between wrap mt12" style="gap:8px">' +
          '<div class="search grow" id="con-search" style="margin-top:0;min-width:200px">' + UI.icon('search') +
            '<input id="con-q" type="search" placeholder="搜索物资名称 / 编号 / 规格 / 供应商" autocomplete="off">' +
            '<button class="clear" id="con-q-clear" type="button">' + UI.icon('close', 'sm') + '</button>' +
          '</div>' +
          '<div class="row" style="gap:6px">' +
            '<button class="btn ghost sm" id="con-export">导出目录</button>' +
            '<button class="btn primary sm" id="con-add">＋ 新增物资</button>' +
          '</div>' +
        '</div>' +

        '<div class="chips mt8">' +
          '<button class="chip' + (filter === 'all' ? ' on' : '') + '" data-cat-filter="all">全部<span class="n">' + stInfo.live.length + '</span></button>' +
          catChips +
          '<button class="chip' + (filter === 'central' ? ' on' : '') + '" data-cat-filter="central">仅中台采<span class="n">' + stInfo.centralOnly.length + '</span></button>' +
          '<button class="chip' + (filter === 'off' ? ' on' : '') + '" data-cat-filter="off">已下架<span class="n">' + stInfo.off.length + '</span></button>' +
          '<button class="chip' + (filter === 'deleted' ? ' on' : '') + '" data-cat-filter="deleted">已删除<span class="n">' + stInfo.deleted.length + '</span></button>' +
        '</div>' +

        '<div class="con-list" id="con-list">' +
          (slice.length
            ? slice.map(catalogItemHtml).join('')
            : UI.empty('📦', '没有匹配的物资', '可修改关键词或点「＋ 新增物资」')) +
        '</div>' +
        '<div id="con-more">' +
          (list.length > shown
            ? '<button class="more" id="con-btn-more">加载更多（还有 ' + (list.length - shown) + ' 项）</button>'
            : (list.length ? '<div class="tiny muted" style="text-align:center;padding:8px 0">共 ' + list.length + ' 项物资</div>' : '')) +
        '</div>' +
        '<div class="note-box mt12">说明：中台新增、编辑、下架或删除物资后，采购下单页实时生效；已被在途订单引用的物资不可直接删除，请先「下架」避免影响履约与对账。</div>';
    }

    function openItemModal(existing) {
      const isEdit = !!existing;
      const sups = domain.suppliersOf(state);
      const curSup = existing ? (existing.supplier || '') : (sups[0] || '');
      const hasSup = sups.indexOf(curSup) >= 0;
      let curScope = existing && existing.purchaseScope === 'central' ? 'central' : 'all';

      const body =
        '<div class="field-row">' +
          '<div class="field"><div class="label">物资编号' + (isEdit ? '' : '（选填）') + '</div>' +
            '<input class="input mono" id="m-id" maxlength="24" value="' + UI.esc(existing ? existing.id : '') + '"' +
              (isEdit ? ' readonly style="background:#f5f8fc;color:var(--muted)"' : ' placeholder="留空自动生成 WZ-xxx"') + '></div>' +
          '<div class="field"><div class="label">计量单位<span class="req">*</span></div>' +
            '<input class="input" id="m-unit" maxlength="16" value="' + UI.esc(existing ? (existing.unit || '个') : '个') + '" placeholder="个 / 箱 / 张"></div>' +
        '</div>' +
        '<div class="field"><div class="label">物资名称<span class="req">*</span></div>' +
          '<input class="input" id="m-name" maxlength="60" value="' + UI.esc(existing ? existing.name : '') + '" placeholder="例如：A4 打印纸 80g"></div>' +
        '<div class="field-row">' +
          '<div class="field"><div class="label">所属大类（决定合同与预算项）<span class="req">*</span></div>' +
            '<select class="select" id="m-cat">' +
              BIZ.catalog.CATEGORY_ORDER.map(function (c) {
                const meta = BIZ.catalog.CATEGORY_META[c] || {};
                return '<option value="' + UI.esc(c) + '"' + (existing && existing.category === c ? ' selected' : '') + '>' +
                  UI.esc(c) + (meta.budgetName ? '（' + UI.esc(meta.budgetName) + '）' : '') + '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="field"><div class="label">单价（元）<span class="req">*</span></div>' +
            '<input class="input" id="m-price" type="number" min="0.01" step="0.01" value="' + (existing ? existing.price : '') + '" placeholder="0.00"></div>' +
        '</div>' +
        '<div class="field"><div class="label">采购权限范围<span class="req">*</span></div>' +
          '<div class="radio-cards" id="m-scope-cards">' +
            '<label class="radio-card' + (curScope === 'all' ? ' on' : '') + '" data-scope="all">' +
              '<span class="rd"></span><span class="grow"><span>门店与部门均可自行下单（默认）</span>' +
              '<span class="d">门店店长、各职能部门及运营管理部均可选购</span></span></label>' +
            '<label class="radio-card' + (curScope === 'central' ? ' on' : '') + '" data-scope="central">' +
              '<span class="rd"></span><span class="grow"><span>仅运营管理部（中台）集中采购</span>' +
              '<span class="d">隐藏对门店与普通职能部门的下单入口，仅中台自采可用</span></span></label>' +
          '</div>' +
        '</div>' +
        '<div class="field"><div class="label">对应费用科目（默认跟随大类）</div>' +
          '<select class="select" id="m-budget">' +
            '<option value="">按大类自动归属（推荐）</option>' +
            BUDGET.ITEMS.map(function (it) {
              return '<option value="' + UI.esc(it.key) + '"' + (existing && existing.budgetItem === it.key ? ' selected' : '') + '>' + UI.esc(it.name) + ' · ' + UI.esc(it.desc) + '</option>';
            }).join('') +
          '</select></div>' +
        '<div class="field"><div class="label">规格型号</div>' +
          '<input class="input" id="m-spec" maxlength="120" value="' + UI.esc(existing ? (existing.spec || '') : '') + '" placeholder="材质 / 尺寸 / 包装规格"></div>' +
        '<div class="field"><div class="label">供应商<span class="req">*</span></div>' +
          '<select class="select" id="m-sup">' +
            sups.map(function (s) {
              return '<option value="' + UI.esc(s) + '"' + (hasSup && curSup === s ? ' selected' : '') + '>' + UI.esc(s) + '</option>';
            }).join('') +
            '<option value="__custom__"' + (!hasSup && curSup ? ' selected' : '') + '>＋ 自定义新供应商</option>' +
          '</select>' +
          '<input class="input mt8" id="m-sup-custom" maxlength="60" value="' + UI.esc(!hasSup ? curSup : '') + '" placeholder="输入新供应商全称" style="display:' + (!hasSup && curSup ? 'block' : 'none') + '">' +
        '</div>' +
        '<div class="field"><div class="label">备注说明</div>' +
          '<input class="input" id="m-note" maxlength="200" value="' + UI.esc(existing ? (existing.note || '') : '') + '" placeholder="适用场景、最小起订或安装说明"></div>' +
        '<label class="check"><input type="checkbox" id="m-enabled"' + (!existing || existing.enabled !== false ? ' checked' : '') + '><span>立即上架（允许对应权限角色下单）</span></label>';

      UI.sheet({
        title: isEdit ? ('编辑物资 · ' + existing.id) : '新增物资',
        sub: isEdit ? '修改后将立即同步至采购下单页，已下单历史单据保留原快照。' : '新增后符合权限的采购人员即可在目录中搜索并下单。',
        body: body,
        actions: [
          { label: '取消', cls: 'ghost' },
          { label: isEdit ? '保存修改' : '确认新增', cls: 'primary', onClick: function (_close, bodyEl) {
              const supSel = bodyEl.querySelector('#m-sup').value;
              const supplier = supSel === '__custom__' ? bodyEl.querySelector('#m-sup-custom').value.trim() : supSel;
              try {
                App.mutate(function (st, ses) {
                  return domain.saveCatalogItem(st, ses, {
                    isEdit: isEdit,
                    id: bodyEl.querySelector('#m-id').value.trim(),
                    name: bodyEl.querySelector('#m-name').value.trim(),
                    category: bodyEl.querySelector('#m-cat').value,
                    purchaseScope: curScope,
                    budgetItem: bodyEl.querySelector('#m-budget').value,
                    unit: bodyEl.querySelector('#m-unit').value.trim(),
                    price: Number(bodyEl.querySelector('#m-price').value),
                    spec: bodyEl.querySelector('#m-spec').value.trim(),
                    supplier: supplier,
                    note: bodyEl.querySelector('#m-note').value.trim(),
                    enabled: bodyEl.querySelector('#m-enabled').checked
                  });
                });
                UI.toast(isEdit ? '物资信息已更新' : '已新增物资', 'good');
                render();
              } catch (err) {
                UI.toast(err.message, 'error', 2800);
                return false;
              }
            } }
        ],
        mount: function (bodyEl) {
          const scopeWrap = bodyEl.querySelector('#m-scope-cards');
          if (scopeWrap) {
            scopeWrap.addEventListener('click', function (ev) {
              const cardEl = ev.target.closest('[data-scope]');
              if (!cardEl) return;
              curScope = cardEl.dataset.scope;
              scopeWrap.querySelectorAll('[data-scope]').forEach(function (x) {
                x.classList.toggle('on', x.dataset.scope === curScope);
              });
            });
          }
          const catSel = bodyEl.querySelector('#m-cat');
          const supSel = bodyEl.querySelector('#m-sup');
          const customInp = bodyEl.querySelector('#m-sup-custom');
          if (!isEdit && catSel) {
            catSel.addEventListener('change', function () {
              const wantedSup = catSel.value === '印刷品物料' ? '广告印刷供应商（待确认）' : '运营物资供应商（演示）';
              if (sups.indexOf(wantedSup) >= 0) {
                supSel.value = wantedSup;
                customInp.style.display = 'none';
              }
            });
          }
          supSel.addEventListener('change', function () {
            customInp.style.display = supSel.value === '__custom__' ? 'block' : 'none';
            if (supSel.value === '__custom__') customInp.focus();
          });
        }
      });
    }

    function openExportModal() {
      const custom = state.catalogCustom || { added: [], updated: {}, deleted: {} };
      const activeList = domain.catalogOf(state, { activeOnly: true });
      const customText = JSON.stringify(custom, null, 2);
      const fullText = JSON.stringify(activeList, null, 2);

      UI.sheet({
        title: '导出物资目录',
        sub: '演示态改动保存在本机浏览器中；上线前可复制 JSON 导入后端数据库或同步到 miniprogram/data/catalog.js。',
        body:
          '<div class="kv"><span class="k">在售物资</span><span class="v num">' + activeList.length + ' 项</span></div>' +
          '<div class="kv"><span class="k">中台改动</span><span class="v num">新增 ' + (custom.added || []).length + ' · 修改 ' + Object.keys(custom.updated || {}).length + ' · 删除 ' + Object.keys(custom.deleted || {}).length + '</span></div>' +
          '<div class="label mt8">中台增量改动预览</div>' +
          '<pre class="json-box">' + UI.esc(customText) + '</pre>',
        actions: [
          { label: '关闭', cls: 'ghost' },
          { label: '复制改动', cls: 'soft', onClick: function () { UI.copy(customText); return false; } },
          { label: '复制全量', cls: 'primary', onClick: function () { UI.copy(fullText); return false; } }
        ]
      });
    }

    function renderContracts() {
      const list = domain.contractSummary(state);
      return '<div class="note-box mb12">职能部门采购不设部门预算，但所有有效订单累计金额不得超过对应供应商框架合同总额（已双方确认结算的单据按结算金额入账）。</div>' +
        '<div class="between mb12"><div class="section-title">供应商框架合同（' + list.length + ' 份）</div>' +
          '<button class="btn primary sm" id="con-add-contract">＋ 新增合同</button></div>' +
        list.map(function (c) {
          const tone = c.usedPct >= 90 ? 'bad' : c.usedPct >= 70 ? 'warn' : '';
          return '<div class="card card-pad" style="margin-bottom:10px">' +
            '<div class="between"><span class="strong">' + UI.esc(c.name) + '</span>' +
              '<span class="pill line mono">' + UI.esc(c.id) + '</span></div>' +
            '<div class="tiny muted mt4">供应商：' + UI.esc(c.supplier) +
              (c.start || c.end ? ' · 有效期 ' + UI.esc(c.start || '不限') + ' ~ ' + UI.esc(c.end || '不限') : '') + '</div>' +
            '<div class="bar mt8"><i class="' + tone + '" style="width:' + c.usedPct + '%"></i></div>' +
            '<div class="between mt8 tiny muted">' +
              '<span>已占用 ¥' + UI.money(c.used) + '（门店 ¥' + UI.money(c.storeUsed) + ' + 部门 ¥' + UI.money(c.deptUsed) + '）</span>' +
              '<span>' + c.usedPct + '%</span>' +
            '</div>' +
            '<div class="between mt8" style="padding-top:8px;border-top:1px dashed var(--line-2)">' +
              '<div class="tiny">合同总额 <b class="money">¥' + UI.money(c.total) + '</b> · 剩余 <b class="money ' + (c.remaining <= 0 ? 'red' : 'green') + '">¥' + UI.money(c.remaining) + '</b></div>' +
              '<button class="btn ghost xs" data-contract-edit="' + UI.esc(c.id) + '">调整合同</button>' +
            '</div>' +
          '</div>';
        }).join('');
    }

    function openContractModal(existing) {
      const sups = domain.suppliersOf(state);
      const curSup = existing ? existing.supplier : (sups[0] || '');
      const hasSup = sups.indexOf(curSup) >= 0;

      const body =
        '<div class="field"><div class="label">供应商<span class="req">*</span></div>' +
          '<select class="select" id="ct-sup"' + (existing ? ' disabled' : '') + '>' +
            sups.map(function (s) {
              return '<option value="' + UI.esc(s) + '"' + (hasSup && curSup === s ? ' selected' : '') + '>' + UI.esc(s) + '</option>';
            }).join('') +
            '<option value="__custom__"' + (!hasSup && curSup ? ' selected' : '') + '>＋ 自定义新供应商</option>' +
          '</select>' +
          '<input class="input mt8" id="ct-sup-custom" maxlength="60" value="' + UI.esc(!hasSup ? curSup : '') + '" placeholder="输入新供应商名称" style="display:' + (!hasSup && curSup ? 'block' : 'none') + '">' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><div class="label">合同编号</div>' +
            '<input class="input mono" id="ct-id" maxlength="30" value="' + UI.esc(existing ? existing.id : '') + '" placeholder="留空自动生成"></div>' +
          '<div class="field"><div class="label">合同总额（元）<span class="req">*</span></div>' +
            '<input class="input" id="ct-total" type="number" min="0.01" step="0.01" value="' + (existing ? existing.total : '') + '" placeholder="例如：300000"></div>' +
        '</div>' +
        '<div class="field"><div class="label">合同名称</div>' +
          '<input class="input" id="ct-name" maxlength="60" value="' + UI.esc(existing ? existing.name : '') + '" placeholder="例如：2026 年度框架采购合同"></div>' +
        '<div class="field-row">' +
          '<div class="field"><div class="label">生效日期</div>' +
            '<input class="input" id="ct-start" type="date" value="' + UI.esc(existing ? existing.start : '') + '"></div>' +
          '<div class="field"><div class="label">到期日期</div>' +
            '<input class="input" id="ct-end" type="date" value="' + UI.esc(existing ? existing.end : '') + '"></div>' +
        '</div>' +
        '<div class="field"><div class="label">备注</div>' +
          '<input class="input" id="ct-note" maxlength="120" value="' + UI.esc(existing ? existing.note : '') + '" placeholder="选填"></div>';

      UI.sheet({
        title: existing ? ('调整合同 · ' + existing.supplier) : '新增供应商合同',
        sub: '职能部门下单时将实时校验累计占用是否超过该合同总额。',
        body: body,
        actions: [
          { label: '取消', cls: 'ghost' },
          { label: '保存合同', cls: 'primary', onClick: function (_close, bodyEl) {
              const supSel = bodyEl.querySelector('#ct-sup').value;
              const supplier = existing ? existing.supplier : (supSel === '__custom__' ? bodyEl.querySelector('#ct-sup-custom').value.trim() : supSel);
              try {
                App.mutate(function (st, ses) {
                  return domain.saveContract(st, ses, {
                    id: bodyEl.querySelector('#ct-id').value.trim(),
                    supplier: supplier,
                    name: bodyEl.querySelector('#ct-name').value.trim(),
                    total: Number(bodyEl.querySelector('#ct-total').value),
                    start: bodyEl.querySelector('#ct-start').value,
                    end: bodyEl.querySelector('#ct-end').value,
                    note: bodyEl.querySelector('#ct-note').value.trim()
                  });
                });
                UI.toast('合同上限已保存', 'good');
                render();
              } catch (err) {
                UI.toast(err.message, 'error', 2800);
                return false;
              }
            } }
        ],
        mount: function (bodyEl) {
          const supSel = bodyEl.querySelector('#ct-sup');
          const customInp = bodyEl.querySelector('#ct-sup-custom');
          supSel.addEventListener('change', function () {
            customInp.style.display = supSel.value === '__custom__' ? 'block' : 'none';
          });
        }
      });
    }

    function renderRules() {
      const ac = domain.approvalConfigOf(state);
      return '<div class="card card-pad">' +
          '<div class="section-title mb8">门店下单审批阈值</div>' +
          '<div class="small muted mb12">调整后对后续新提交的门店订单立即生效，审批去重（战区一步终审、中台核定一步完成）始终启用。</div>' +
          '<div class="field-row">' +
            '<div class="field"><div class="label">小额免金额审批上限（元）</div>' +
              '<input class="input" id="r-auto" type="number" min="0" step="1" value="' + ac.autoMax + '"></div>' +
            '<div class="field"><div class="label">战区一步终审上限（元）</div>' +
              '<input class="input" id="r-region" type="number" min="1" step="1" value="' + ac.regionMax + '"></div>' +
          '</div>' +
          '<div class="switch-row">' +
            '<div><div class="strong small">近 N 天同门店同科目累计防拆单</div>' +
              '<div class="tiny muted">防止门店连续拆成多笔小额单绕过上级审批</div></div>' +
            '<input type="checkbox" id="r-split-guard"' + (ac.splitGuard ? ' checked' : '') + ' style="width:18px;height:18px;accent-color:var(--brand-2)">' +
          '</div>' +
          '<div class="field mt8"><div class="label">防拆单累计统计窗口（天，1–31）</div>' +
            '<input class="input" id="r-split-days" type="number" min="1" max="31" step="1" value="' + ac.splitDays + '"></div>' +
          '<div class="switch-row">' +
            '<div><div class="strong small">小额预算内免战区审核直发供应商</div>' +
              '<div class="tiny muted">开启后，预算内且 ≤ 小额上限的订单提交即直发供应商（战区仅事后抽查，谨慎开启）</div></div>' +
            '<input type="checkbox" id="r-auto-skip"' + (ac.autoSkipReview ? ' checked' : '') + ' style="width:18px;height:18px;accent-color:var(--brand-2)">' +
          '</div>' +
          '<button class="btn primary block mt12" id="r-save">保存审批规则</button>' +
        '</div>' +

        '<div class="card card-pad mt12">' +
          '<div class="section-title mb8">中台常用运维</div>' +
          '<div class="btn-group">' +
            '<a class="btn ghost sm" href="#/budget">门店预算设置（房间数×系数）</a>' +
            '<a class="btn ghost sm" href="#/reports?tab=recon">统一对账与锁定</a>' +
          '</div>' +
        '</div>';
    }

    root.addEventListener('click', function (e) {
      const tabBtn = e.target.closest('#con-tabs [data-tab]');
      if (tabBtn) {
        tab = tabBtn.dataset.tab;
        shown = 30;
        render();
        return;
      }

      if (e.target.closest('#con-q-clear')) {
        keyword = '';
        const qEl = root.querySelector('#con-q');
        if (qEl) { qEl.value = ''; qEl.focus(); }
        renderCatalogListOnly();
        return;
      }

      const fBtn = e.target.closest('[data-cat-filter]');
      if (fBtn) {
        filter = fBtn.dataset.catFilter;
        shown = 30;
        render();
        return;
      }

      if (e.target.closest('#con-btn-more')) {
        shown += 30;
        renderCatalogListOnly();
        return;
      }

      if (e.target.closest('#con-add')) { openItemModal(null); return; }
      if (e.target.closest('#con-export')) { openExportModal(); return; }

      const editBtn = e.target.closest('[data-cat-edit]');
      if (editBtn) {
        const item = domain.catalogMapOf(state)[editBtn.dataset.catEdit];
        if (item) openItemModal(item);
        return;
      }

      const scopeBtn = e.target.closest('[data-cat-scope]');
      if (scopeBtn) {
        try {
          const res = App.mutate(function (st, ses) {
            return domain.setCatalogItemScope(st, ses, { id: scopeBtn.dataset.catScope });
          });
          UI.toast(res.name + (res.centralOnly ? ' 已设为仅中台采购' : ' 已开放全员下单'), 'good');
          render();
        } catch (err) { UI.toast(err.message, 'error', 2800); }
        return;
      }

      const toggleBtn = e.target.closest('[data-cat-toggle]');
      if (toggleBtn) {
        try {
          const res = App.mutate(function (st, ses) {
            return domain.toggleCatalogItem(st, ses, { id: toggleBtn.dataset.catToggle });
          });
          UI.toast(res.name + (res.enabled ? ' 已上架' : ' 已下架'), 'good');
          render();
        } catch (err) { UI.toast(err.message, 'error', 2800); }
        return;
      }

      const delBtn = e.target.closest('[data-cat-del]');
      if (delBtn) {
        const id = delBtn.dataset.catDel;
        const item = domain.catalogMapOf(state)[id];
        if (!item) return;
        UI.confirm({
          title: '删除物资「' + item.name + '」？',
          sub: '删除后目录中不再显示；若有在途订单引用该物资，系统将阻止删除并提示先下架。',
          okText: '确认删除',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          try {
            App.mutate(function (st, ses) { return domain.deleteCatalogItem(st, ses, id); });
            UI.toast('已删除，可在「已删除」筛选中恢复', 'good');
            render();
          } catch (err) { UI.toast(err.message, 'error', 3200); }
        });
        return;
      }

      const restoreBtn = e.target.closest('[data-cat-restore]');
      if (restoreBtn) {
        try {
          const res = App.mutate(function (st, ses) {
            return domain.restoreCatalogItem(st, ses, restoreBtn.dataset.catRestore);
          });
          UI.toast('已恢复「' + res.name + '」', 'good');
          render();
        } catch (err) { UI.toast(err.message, 'error', 2800); }
        return;
      }

      if (e.target.closest('#con-add-contract')) { openContractModal(null); return; }

      const ctBtn = e.target.closest('[data-contract-edit]');
      if (ctBtn) {
        const c = domain.contractSummary(state).filter(function (x) { return x.id === ctBtn.dataset.contractEdit; })[0];
        if (c) openContractModal(c);
        return;
      }

      if (e.target.closest('#r-save')) {
        try {
          App.mutate(function (st, ses) {
            return domain.saveApprovalConfig(st, ses, {
              autoMax: Number(root.querySelector('#r-auto').value),
              regionMax: Number(root.querySelector('#r-region').value),
              splitGuard: root.querySelector('#r-split-guard').checked,
              splitDays: Number(root.querySelector('#r-split-days').value),
              autoSkipReview: root.querySelector('#r-auto-skip').checked
            });
          });
          UI.toast('审批规则已保存并即时生效', 'good');
          render();
        } catch (err) { UI.toast(err.message, 'error', 2800); }
      }
    });

    render();
  };
})(window.Views);
