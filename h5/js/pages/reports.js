/* 统计看板与统一对账 */
(function (Views) {
  const RECON_STATUS = {
    'supplier-pending': { label: '待供应商确认', cls: 'warn' },
    'supplier-confirmed': { label: '已确认待锁定', cls: 'info' },
    'locked': { label: '已锁定', cls: 'good' },
    'disputed': { label: '有差异', cls: 'bad' },
    'voided': { label: '已作废', cls: 'gray' }
  };

  Views.reports = function (root, r, ctx) {
    const domain = BIZ.domain;
    const me = ctx.me;
    let state = ctx.state;
    let budgets = domain.budgetSummary(state, me);
    let report = domain.reportSummary(state);
    let depts = me.role === 'central' ? domain.departmentSummary(state) : [];

    function refreshData() {
      state = Store.loadState();
      budgets = domain.budgetSummary(state, me);
      report = domain.reportSummary(state);
      depts = me.role === 'central' ? domain.departmentSummary(state) : [];
    }

    const tabs = [];
    if (budgets.length) tabs.push({ key: 'budget', label: '预算占用' });
    if (me.role === 'central' || me.role === 'region') tabs.push({ key: 'contract', label: '合同与预算' });
    if (me.role !== 'supplier') tabs.push({ key: 'zone', label: '战区金额' });
    if (me.role === 'central') tabs.push({ key: 'dept', label: '部门' });
    tabs.push({ key: 'supplier', label: '供应商' });
    if (me.role === 'central' || me.role === 'supplier') tabs.push({ key: 'recon', label: '对账' });

    let tab = r.query.tab && tabs.some(function (t) { return t.key === r.query.tab; }) ? r.query.tab : tabs[0].key;
    if (me.role === 'supplier' && r.query.tab !== 'supplier') tab = r.query.tab === 'recon' ? 'recon' : tabs[0].key;
    const openRecons = {};

    function budgetTable() {
      if (!budgets.length) return UI.empty('📊', '当前身份无预算视图', '');
      const keys = (budgets[0].items || []).map(function (i) { return i.key; });
      const names = (budgets[0].items || []).map(function (i) { return i.name; });
      const itemTotal = function (idx, f) {
        return budgets.reduce(function (s, b) {
          const it = (b.items || [])[idx];
          return s + (it ? it[f] : 0);
        }, 0);
      };
      const cards = names.map(function (name, i) {
        const key = keys[i];
        const budget = itemTotal(i, 'budget');
        const used = itemTotal(i, 'used');
        const pct = budget > 0 ? Math.min(100, Math.round(used / budget * 100)) : 0;
        const tone = pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : ('tone-' + key);
        return '<div class="bcat">' +
          '<div class="bcat-name">' + UI.budgetPill(key, name) + '</div>' +
          '<div class="bcat-amt">¥' + UI.money(used) + '</div>' +
          '<div class="bcat-sub">/ ¥' + UI.money(budget) + ' · ' + pct + '%</div>' +
          '<div class="bar" style="height:4px"><i class="' + tone + '" style="width:' + pct + '%"></i></div>' +
        '</div>';
      }).join('');

      const rows = budgets.map(function (b) {
        const tone = b.usedPct >= 90 ? 'bad' : b.usedPct >= 70 ? 'warn' : '';
        const cells = keys.map(function (k) {
          const it = (b.items || []).filter(function (x) { return x.key === k; })[0] || { used: 0, budget: 0, usedPct: 0 };
          const t = it.usedPct >= 90 ? 'bad' : it.usedPct >= 70 ? 'warn' : '';
          return '<td class="r"><span class="mono">' + UI.money(it.used) + '</span>' +
            '<div class="tiny muted">/ ' + UI.money(it.budget) + ' · ' + it.usedPct + '%</div>' +
            '<div class="bar" style="height:3px;margin-top:3px"><i class="' + t + '" style="width:' + it.usedPct + '%"></i></div></td>';
        }).join('');
        return '<tr><td><span class="strong">' + UI.esc(b.store) + '</span><div class="tiny muted">' +
            b.rooms + ' 间房 · ' + UI.esc(b.zone) + '</div></td>' + cells +
          '<td class="r strong">' + UI.money(b.used) + '<div class="tiny muted">/ ' + UI.money(b.budget) + '</div></td>' +
          '<td class="r">' + UI.money(b.available) + '</td>' +
          '<td><div class="bar" style="height:5px"><i class="' + tone + '" style="width:' + b.usedPct + '%"></i></div>' +
            '<div class="tiny muted" style="text-align:right">' + b.usedPct + '%</div></td></tr>';
      }).join('');

      const totalCells = keys.map(function (k, i) {
        return '<td class="r">' + UI.money(itemTotal(i, 'used')) + '<div class="tiny muted">/ ' + UI.money(itemTotal(i, 'budget')) + '</div></td>';
      }).join('');

      return '<div class="card card-pad">' +
        '<div class="between mb8"><span class="section-title">门店费用预算</span>' +
          (me.role === 'central'
            ? '<a class="pill" href="#/budget">调整预算参数</a>'
            : '<span class="tiny muted">' + budgets.length + ' 家门店</span>') + '</div>' +
        '<div class="bcat-row">' + cards + '</div>' +
        '<div class="table-scroll"><table class="tbl"><thead><tr>' +
          '<th>门店</th>' + names.map(function (n) { return '<th class="r">' + UI.esc(n) + '</th>'; }).join('') +
          '<th class="r">合计</th><th class="r">可用</th><th style="width:76px">占用率</th>' +
        '</tr></thead><tbody>' + rows +
        '<tr class="tot"><td>合计</td>' + totalCells +
          '<td class="r">' + UI.money(budgets.reduce(function (s, b) { return s + b.used; }, 0)) + '</td>' +
          '<td class="r">' + UI.money(budgets.reduce(function (s, b) { return s + b.available; }, 0)) + '</td><td></td></tr>' +
        '</tbody></table></div>' +
        '<div class="note-box mt12">额度 = 管理房间数 × 科目系数（当前每店 ' + budgets[0].rooms +
          ' 间房、每科目 10 元/间）；机动池追加与门店间调剂计入「已核定额度」，不影响基数。</div>' +
      '</div>';
    }

    function contractTable() {
      const cb = domain.contractBudgetReport(state);
      const contractCards = (cb.contracts || []).map(function (c) {
        const isPrint = String(c.supplier || '').indexOf('印刷') >= 0;
        const cTone = isPrint ? 'marketing' : 'community';
        const pctTone = c.usedPct >= 90 ? 'bad' : c.usedPct >= 75 ? 'warn' : ('tone-' + cTone);
        return '<div class="zone-box">' +
          '<div class="between"><span class="strong">' + UI.esc(c.id) + '</span>' +
            '<span class="pill tone-' + cTone + '">' + UI.esc(String(c.supplier || '').replace(/[（(].*[)）]/g, '')) + '</span></div>' +
          '<div class="tiny muted mt4">' + UI.esc(c.name) + '</div>' +
          '<div class="zb-amt">¥' + UI.money(c.used) + ' <small class="tiny muted" style="font-weight:500">/ ¥' + UI.money(c.total) + '</small></div>' +
          '<div class="bar" style="height:5px;margin-top:6px"><i class="' + pctTone + '" style="width:' + c.usedPct + '%"></i></div>' +
          '<div class="zb-sub mt4">门店 ¥' + UI.money(c.storeUsed) + ' · 部门 ¥' + UI.money(c.deptUsed) + ' · 余 ¥' + UI.money(c.remaining) + '</div>' +
          '<div class="zb-sub">已验收结算 ¥' + UI.money(c.accepted) + ' · 已锁定对账 ¥' + UI.money(c.reconciled) + '</div>' +
        '</div>';
      }).join('');

      const rows = (cb.budgetItems || []).map(function (b) {
        return '<tr>' +
          '<td>' + UI.budgetPill(b.key, b.name) + '<div class="tiny muted mt4">' + UI.esc(b.contract) + '</div></td>' +
          '<td class="r">' + UI.money(b.storeBudget) + '</td>' +
          '<td class="r">' + UI.money(b.baseUsed) + '</td>' +
          '<td class="r">' + UI.money(b.storeInTransit) + '</td>' +
          '<td class="r">' + UI.money(b.storeAccepted) + '</td>' +
          '<td class="r">' + UI.money(b.deptRequested) + '</td>' +
          '<td class="r strong">' + UI.money(b.totalUsed) + '</td>' +
          '<td class="r">' + UI.money(b.storeAvailable) + '</td>' +
        '</tr>';
      }).join('');

      const sumF = function (f) { return (cb.budgetItems || []).reduce(function (s, x) { return s + Number(x[f] || 0); }, 0); };

      return '<div class="card card-pad mb12">' +
          '<div class="between mb8"><span class="section-title">框架合同执行总览</span>' +
            (me.role === 'central' ? '<a class="pill" href="#/console?tab=contracts">中台维护合同 →</a>' : '') + '</div>' +
          '<div class="zone-card" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">' + contractCards + '</div>' +
        '</div>' +
        '<div class="card card-pad">' +
          '<div class="between mb8">' +
            '<div><span class="section-title">合同 × 三大预算科目财务核算</span>' +
            '<div class="tiny muted mt4">所有已验收与已对账金额均已按双方确认结算价（含折让）自动对齐</div></div>' +
            '<button class="btn ghost xs" id="btn-export-cb">' + UI.icon('download', 'xs') + ' 导出CSV</button>' +
          '</div>' +
          '<div class="table-scroll"><table class="tbl"><thead><tr>' +
            '<th>预算科目 / 对应合同</th><th class="r">门店核定额度</th><th class="r">期初已用</th><th class="r">在途占用</th>' +
            '<th class="r">门店已结算</th><th class="r">部门采购</th><th class="r">累计占用</th><th class="r">门店可用</th>' +
          '</tr></thead><tbody>' + rows +
          '<tr class="tot"><td>合计</td>' +
            '<td class="r">' + UI.money(sumF('storeBudget')) + '</td>' +
            '<td class="r">' + UI.money(sumF('baseUsed')) + '</td>' +
            '<td class="r">' + UI.money(sumF('storeInTransit')) + '</td>' +
            '<td class="r">' + UI.money(sumF('storeAccepted')) + '</td>' +
            '<td class="r">' + UI.money(sumF('deptRequested')) + '</td>' +
            '<td class="r">' + UI.money(sumF('totalUsed')) + '</td>' +
            '<td class="r">' + UI.money(sumF('storeAvailable')) + '</td>' +
          '</tr>' +
          '</tbody></table></div>' +
          '<div class="note-box mt12">财务核对提示：若存在结算折让，系统按双方共同确认后的实付结算额扣减门店预算、合同额度及报表已对账合计。</div>' +
        '</div>';
    }

    // 战区金额：门店单按战区汇总（部门采购在「部门」页单独看），并叠加该战区预算占用
    function zoneTable() {
      const orders = domain.visibleOrders(state, me);
      const agg = {};
      orders.forEach(function (o) {
        if (o.purchaseType === 'department') return;
        if (['rejected', 'cancelled'].indexOf(o.status) >= 0) return;
        const key = o.zone || '未归属战区';
        if (!agg[key]) agg[key] = { key: key, orders: 0, requested: 0, accepted: 0, reconciled: 0, stores: {} };
        const a = agg[key];
        const eff = domain.effectiveOrderAmounts(o);
        a.orders += 1;
        a.stores[o.store] = 1;
        a.requested += eff.requested;
        a.accepted += eff.accepted;
        a.reconciled += eff.reconciled;
      });
      const budgetByZone = {};
      budgets.forEach(function (b) {
        if (!b.zone) return;
        if (!budgetByZone[b.zone]) budgetByZone[b.zone] = { budget: 0, used: 0, stores: 0 };
        budgetByZone[b.zone].budget += Number(b.budget || 0);
        budgetByZone[b.zone].used += Number(b.used || 0);
        budgetByZone[b.zone].stores += 1;
      });
      const zones = Object.keys(agg).map(function (k) {
        const a = agg[k];
        const b = budgetByZone[k] || { budget: 0, used: 0, stores: 0 };
        return {
          key: k, stores: b.stores || Object.keys(a.stores).length, orders: a.orders,
          requested: a.requested, accepted: a.accepted, reconciled: a.reconciled,
          pending: Math.max(0, a.requested - a.accepted),
          rate: a.requested > 0 ? Math.round(a.accepted / a.requested * 100) : 0,
          budget: b.budget, usedBudget: b.used,
          usedPct: b.budget > 0 ? Math.min(100, Math.round(b.used / b.budget * 100)) : 0
        };
      }).sort(function (x, y) { return y.requested - x.requested; });
      const sum = function (f) { return zones.reduce(function (s, z) { return s + z[f]; }, 0); };
      const tone = function (pct) { return pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : ''; };

      return '<div class="card card-pad">' +
        '<div class="between mb8"><span class="section-title">战区金额</span>' +
          '<span class="tiny muted">' + zones.length + ' 个战区 · ' + sum('stores') + ' 家门店 · ' + sum('orders') + ' 笔门店单</span></div>' +
        '<div class="zone-card mb12">' + zones.map(function (z) {
          return '<div class="zone-box"><div class="zb-name">' + UI.esc(z.key) + '</div>' +
            '<div class="zb-amt">¥' + UI.money(z.requested) + '</div>' +
            '<div class="zb-sub">' + z.stores + ' 家门店 · ' + z.orders + ' 单 · 已验收 ' + z.rate + '%</div>' +
            '<div class="bar" style="height:4px;margin-top:6px"><i class="' + tone(z.usedPct) + '" style="width:' + z.usedPct + '%"></i></div>' +
            '<div class="zb-sub">预算占用 ' + z.usedPct + '%（¥' + UI.money(z.usedBudget) + ' / ¥' + UI.money(z.budget) + '）</div>' +
          '</div>';
        }).join('') + '</div>' +
        '<div class="table-scroll"><table class="tbl"><thead><tr>' +
          '<th>战区</th><th class="r">门店</th><th class="r">订单</th><th class="r">申请</th>' +
          '<th class="r">已验收</th><th class="r">待验收</th><th class="r">已对账</th>' +
        '</tr></thead><tbody>' +
        zones.map(function (z) {
          return '<tr><td><span class="strong">' + UI.esc(z.key) + '</span></td>' +
            '<td class="r">' + z.stores + '</td><td class="r">' + z.orders + '</td>' +
            '<td class="r">' + UI.money(z.requested) + '</td><td class="r">' + UI.money(z.accepted) + '</td>' +
            '<td class="r">' + UI.money(z.pending) + '</td><td class="r">' + UI.money(z.reconciled) + '</td></tr>';
        }).join('') +
        '<tr class="tot"><td>合计</td><td class="r">' + sum('stores') + '</td><td class="r">' + sum('orders') + '</td>' +
          '<td class="r">' + UI.money(sum('requested')) + '</td><td class="r">' + UI.money(sum('accepted')) + '</td>' +
          '<td class="r">' + UI.money(sum('pending')) + '</td><td class="r">' + UI.money(sum('reconciled')) + '</td></tr>' +
        '</tbody></table></div>' +
        '<div class="note-box mt12">门店单按收货门店所属战区汇总；部门采购单在「部门」页单独统计，不计入战区金额。预算占用按各门店三科目额度合计计算。</div>' +
      '</div>';
    }

    function deptTable() {
      if (!depts.length) return '';
      return '<div class="card card-pad mt12">' +
        '<div class="section-title mb8">部门采购统计</div>' +
        '<div class="table-scroll"><table class="tbl"><thead><tr>' +
          '<th>部门</th><th class="r">批次</th><th class="r">申请</th><th class="r">已验收</th><th class="r">已对账</th>' +
        '</tr></thead><tbody>' +
        depts.filter(function (d) { return d.orders > 0; }).map(function (d) {
          return '<tr><td>' + UI.esc(d.department) + '</td><td class="r">' + d.orders + '</td>' +
            '<td class="r">' + UI.money(d.requested) + '</td><td class="r">' + UI.money(d.accepted) + '</td>' +
            '<td class="r">' + UI.money(d.reconciled) + '</td></tr>';
        }).join('') +
        '</tbody></table></div></div>';
    }

    function supplierTable() {
      return '<div class="card card-pad">' +
        '<div class="section-title mb8">供应商金额统计</div>' +
        (report.bySupplier.length
          ? '<div class="table-scroll"><table class="tbl"><thead><tr>' +
              '<th>供应商</th><th class="r">订单</th><th class="r">申请</th><th class="r">已验收</th><th class="r">已对账</th>' +
            '</tr></thead><tbody>' +
            report.bySupplier.map(function (s) {
              return '<tr><td>' + UI.esc(s.key) + '</td><td class="r">' + s.orders + '</td>' +
                '<td class="r">' + UI.money(s.requested) + '</td><td class="r">' + UI.money(s.accepted) + '</td>' +
                '<td class="r">' + UI.money(s.reconciled) + '</td></tr>';
            }).join('') +
            '</tbody></table></div>'
          : UI.empty('🧾', '暂无供应商数据', '')) +
      '</div>';
    }

    function reconPanel() {
      const recons = (state.recons || []).filter(function (x) {
        return me.role !== 'supplier' || x.supplier === me.supplier;
      });
      const canCreate = me.role === 'central';

      return (canCreate
        ? '<div class="card card-pad mb12">' +
            '<div class="section-title mb8">生成对账单</div>' +
            '<div class="field-row">' +
              '<div class="field"><div class="label">供应商</div><select class="select" id="rc-supplier">' +
                domain.suppliersOf(state).map(function (s) { return '<option>' + UI.esc(s) + '</option>'; }).join('') +
              '</select></div>' +
              '<div class="field"><div class="label">对账周期</div>' +
                '<input class="input" id="rc-period" value="' + (new Date().getFullYear()) + '-' + ('0' + (new Date().getMonth() + 1)).slice(-2) + '"></div>' +
            '</div>' +
            '<button class="btn soft block" id="rc-create">按已验收数量生成</button>' +
            '<div class="tiny muted mt8">口径：仅统计双方已确认结算、尚未对账的实收明细。</div>' +
          '</div>'
        : '') +
      '<div class="card card-pad">' +
        '<div class="between mb8"><span class="section-title">对账单</span>' +
          '<span class="tiny muted">' + recons.length + ' 张</span></div>' +
        (recons.length
          ? recons.map(function (rec) {
              const st = RECON_STATUS[rec.status] || { label: rec.status, cls: 'gray' };
              const isOpen = !!openRecons[rec.id];
              const orderSet = {};
              (rec.lines || []).forEach(function (l) { if (l.order) orderSet[l.order] = 1; });
              const detailRows = (rec.lines || []).map(function (l) {
                return '<div class="item-line">' +
                  '<span class="nm">' +
                    '<a class="tbl-link mono" href="#/order/' + UI.esc(l.order) + '">' + UI.esc(l.order) + '</a> · ' +
                    UI.esc(l.name) +
                    (l.adjust ? ' <span class="pill violet">结算差异调整</span>' : '') +
                    '<small>' + UI.esc(l.store || '') +
                      (l.adjust ? (l.reason ? ' · ' + UI.esc(l.reason) : ' · 差额平账') : (' · 单价 ¥' + UI.money(l.price))) +
                    '</small>' +
                  '</span>' +
                  '<span class="qty">' + (l.adjust ? '调整' : ('×' + l.n)) + '</span>' +
                  '<span class="amt">¥' + UI.money(l.amount) + '</span>' +
                '</div>';
              }).join('');

              return '<div class="rec-block" data-recon-id="' + UI.esc(rec.id) + '">' +
                '<div class="print-only-head">' +
                  '<div class="p-title">安居乐寓物资采购对账结算单</div>' +
                  '<div class="p-sub">对账单号：' + UI.esc(rec.id) + ' · 供应商：' + UI.esc(rec.supplier) +
                    ' · 周期：' + UI.esc(rec.period) + ' · 打印日期：' + UI.todayStr() + '</div>' +
                '</div>' +
                '<div class="between"><span class="strong">' + UI.esc(rec.id) + ' · ' + UI.esc(rec.supplier) +
                  (rec.round > 1 ? ' <span class="tiny muted">第' + rec.round + '轮</span>' : '') + '</span>' +
                  '<span class="pill ' + st.cls + '">' + st.label + '</span></div>' +
                '<div class="tiny muted mt4">周期 ' + UI.esc(rec.period) + ' · ' + rec.lines.length + ' 条明细 · ' +
                  UI.esc(BIZ.fmt.fullTime(rec.createdAt)) + '</div>' +
                '<div class="between mt8 wrap"><span class="money">¥' + UI.money(rec.total) + '</span>' +
                  '<div class="row wrap" style="gap:6px">' +
                    '<button class="btn-inline" type="button" data-recon-toggle="' + UI.esc(rec.id) + '" data-label="查看 ' + rec.lines.length + ' 条明细">' +
                      (isOpen ? '收起明细 ▴' : ('查看 ' + rec.lines.length + ' 条明细 ▾')) + '</button>' +
                    (rec.status !== 'voided'
                      ? '<button class="btn ghost xs" data-export-recon="' + UI.esc(rec.id) + '">' + UI.icon('download', 'xs') + ' CSV</button>' +
                        '<button class="btn ghost xs" data-print-recon="' + UI.esc(rec.id) + '">' + UI.icon('print', 'xs') + ' 打印</button>'
                      : '') +
                    (me.role === 'supplier' && rec.status === 'supplier-pending'
                      ? '<span class="btn-group"><button class="btn ghost xs" data-dispute="' + UI.esc(rec.id) + '">有差异</button>' +
                        '<button class="btn primary xs" data-confirm="' + UI.esc(rec.id) + '">确认</button></span>'
                      : me.role === 'central' && rec.status === 'supplier-confirmed'
                        ? '<button class="btn primary xs" data-lock="' + UI.esc(rec.id) + '">锁定对账单</button>'
                        : me.role === 'central' && rec.status === 'disputed'
                          ? '<button class="btn soft xs" data-reopen-recon="' + UI.esc(rec.id) + '">核对重发</button>' +
                            '<button class="btn danger xs" data-void-recon="' + UI.esc(rec.id) + '">作废</button>'
                          : '') +
                  '</div>' +
                '</div>' +
                '<div class="ap-detail" style="display:' + (isOpen ? 'block' : 'none') + '">' +
                  detailRows +
                  '<div class="between tiny muted mt8" style="padding-top:6px;border-top:1px dashed var(--line-2)">' +
                    '<span>涉及 ' + Object.keys(orderSet).length + ' 笔订单</span>' +
                    '<span class="strong" style="color:var(--ink)">合计 ¥' + UI.money(rec.total) + '</span>' +
                  '</div>' +
                  '<div class="print-only-sign">' +
                    '<div class="sbox">甲方确认（运营管理部签章）</div>' +
                    '<div class="sbox">乙方确认（供应商签章）</div>' +
                    '<div class="sbox">财务复核 / 日期</div>' +
                  '</div>' +
                '</div>' +
                (rec.disputeNote ? '<div class="tiny" style="color:var(--bad);margin-top:6px">差异说明：' + UI.esc(rec.disputeNote) + '</div>' : '') +
                (rec.voidReason ? '<div class="tiny muted mt4">作废原因：' + UI.esc(rec.voidReason) + '</div>' : '') +
              '</div>';
            }).join('')
          : UI.empty('🧾', '还没有对账单', canCreate ? '选择供应商后生成第一张' : '等待运营管理部发起')) +
      '</div>';
    }

    function renderBody() {
      refreshData();
      const host = root.querySelector('#report-body');
      if (tab === 'budget') host.innerHTML = budgetTable();
      else if (tab === 'contract') host.innerHTML = contractTable();
      else if (tab === 'zone') host.innerHTML = zoneTable() + deptTable();
      else if (tab === 'dept') host.innerHTML = deptTable() || UI.empty('🏢', '暂无部门采购数据', '');
      else if (tab === 'supplier') host.innerHTML = supplierTable();
      else host.innerHTML = reconPanel();

      root.querySelectorAll('#tabs button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.t === tab);
      });

      if (tab === 'contract') {
        const expBtn = host.querySelector('#btn-export-cb');
        if (expBtn) expBtn.onclick = function () {
          const cb = domain.contractBudgetReport(state);
          UI.exportCSV(
            '安居乐寓合同预算核算_' + UI.todayStr() + '.csv',
            ['预算科目', '对应框架合同', '门店核定额度', '期初已用', '门店在途', '门店已结算', '门店已对账', '部门采购占用', '累计占用', '门店可用结余'],
            (cb.budgetItems || []).map(function (b) {
              return [b.name, b.contract, b.storeBudget, b.baseUsed, b.storeInTransit, b.storeAccepted, b.storeReconciled, b.deptRequested, b.totalUsed, b.storeAvailable];
            })
          );
        };
      }

      if (tab === 'recon') {
        const create = host.querySelector('#rc-create');
        if (create) create.onclick = function () {
          const supplier = host.querySelector('#rc-supplier').value;
          const period = host.querySelector('#rc-period').value.trim();
          try {
            const res = App.mutate(function (st, ses) {
              return BIZ.domain.createReconciliation(st, ses, { supplier: supplier, period: period });
            });
            UI.toast('已生成 ' + res.recon.id + '，¥' + UI.money(res.recon.total), 'good', 2600);
            renderBody();
          } catch (e) { UI.toast(e.message, 'error', 2800); }
        };
      }
    }

    root.innerHTML =
      '<div class="tab-seg" id="tabs">' + tabs.map(function (t) {
        return '<button data-t="' + t.key + '" class="' + (tab === t.key ? 'on' : '') + '">' + t.label + '</button>';
      }).join('') + '</div>' +
      '<div id="report-body"></div>';

    root.querySelector('#tabs').addEventListener('click', function (e) {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      tab = b.dataset.t;
      renderBody();
    });

    renderBody();

    root.addEventListener('click', function (e) {
      const toggleBtn = e.target.closest('[data-recon-toggle]');
      if (toggleBtn) {
        const id = toggleBtn.dataset.reconToggle;
        openRecons[id] = !openRecons[id];
        const block = toggleBtn.closest('.rec-block');
        const panel = block && block.querySelector('.ap-detail');
        if (panel) panel.style.display = openRecons[id] ? 'block' : 'none';
        toggleBtn.textContent = openRecons[id] ? '收起明细 ▴' : ((toggleBtn.dataset.label || '查看明细') + ' ▾');
        return;
      }

      const confirmBtn = e.target.closest('[data-confirm]');
      if (confirmBtn) {
        try {
          App.mutate(function (st, ses) {
            return BIZ.domain.reconAction(st, ses, { reconId: confirmBtn.dataset.confirm, action: 'confirm' });
          });
          UI.toast('已确认对账单', 'good');
          renderBody();
        } catch (err) { UI.toast(err.message, 'error', 2600); }
        return;
      }

      const lockBtn = e.target.closest('[data-lock]');
      if (lockBtn) {
        UI.confirm({ title: '锁定这张对账单？', sub: '锁定后金额进入已对账，订单可完结。', okText: '确认锁定' })
          .then(function (ok) {
            if (!ok) return;
            try {
              App.mutate(function (st, ses) {
                return BIZ.domain.reconAction(st, ses, { reconId: lockBtn.dataset.lock, action: 'lock' });
              });
              UI.toast('已锁定', 'good');
              renderBody();
            } catch (err) { UI.toast(err.message, 'error', 2600); }
          });
        return;
      }

      const disputeBtn = e.target.closest('[data-dispute]');
      if (disputeBtn) {
        UI.sheet({
          title: '反馈对账差异',
          sub: '请说明差异原因，运营管理部会核查。',
          body: '<div class="field"><div class="label">差异说明<span class="req">*</span></div>' +
            '<textarea class="textarea" id="d-note" maxlength="300" placeholder="例如：SQ-0003 少计 2 件"></textarea></div>',
          actions: [
            { label: '取消', cls: 'ghost' },
            { label: '提交', cls: 'primary', onClick: function (close, body) {
                const note = body.querySelector('#d-note').value.trim();
                try {
                  App.mutate(function (st, ses) {
                    return BIZ.domain.reconAction(st, ses, { reconId: disputeBtn.dataset.dispute, action: 'dispute', note: note });
                  });
                  UI.toast('已提交差异说明', 'good');
                  renderBody();
                } catch (err) { UI.toast(err.message, 'error', 2600); return false; }
              } }
          ]
        });
        return;
      }

      const reopenBtn = e.target.closest('[data-reopen-recon]');
      if (reopenBtn) {
        const rid = reopenBtn.dataset.reopenRecon;
        UI.confirm({
          title: '重新发起对账单 ' + rid + '？',
          sub: '将按最新确认的结算金额刷新明细，并重新推送给供应商确认。',
          okText: '刷新并重发'
        }).then(function (ok) {
          if (!ok) return;
          try {
            const res = App.mutate(function (st, ses) {
              return BIZ.domain.reconAction(st, ses, { reconId: rid, action: 'reopen' });
            });
            UI.toast('已重发 ' + rid + '，¥' + UI.money(res.recon.total), 'good', 2400);
            renderBody();
          } catch (err) { UI.toast(err.message, 'error', 2800); }
        });
        return;
      }

      const voidBtn = e.target.closest('[data-void-recon]');
      if (voidBtn) {
        const rid = voidBtn.dataset.voidRecon;
        UI.sheet({
          title: '作废对账单 ' + rid,
          sub: '作废后该对账单将不再占用列表，对应已结算订单可按新周期重新对账。',
          body: '<div class="field"><div class="label">作废原因</div>' +
            '<input class="input" id="v-note" maxlength="120" placeholder="例如：已调整结算金额，重新建单"></div>',
          actions: [
            { label: '取消', cls: 'ghost' },
            { label: '确认作废', cls: 'danger-solid', onClick: function (_c, body) {
                const note = body.querySelector('#v-note').value.trim();
                try {
                  App.mutate(function (st, ses) {
                    return BIZ.domain.reconAction(st, ses, { reconId: rid, action: 'void', note: note });
                  });
                  UI.toast('已作废 ' + rid, 'good');
                  renderBody();
                } catch (err) { UI.toast(err.message, 'error', 2600); return false; }
              } }
          ]
        });
        return;
      }

      const expBtn = e.target.closest('[data-export-recon]');
      if (expBtn) {
        refreshData();
        const rid = expBtn.dataset.exportRecon;
        const rec = (state.recons || []).filter(function (x) { return x.id === rid; })[0];
        if (!rec) return;
        UI.exportCSV(
          rec.id + '_' + String(rec.supplier || '').replace(/[（(].*[)）]/g, '') + '.csv',
          ['对账单号', '供应商', '周期', '订单号', '收货门店', '物资名称', '数量', '单价', '金额', '备注'],
          (rec.lines || []).map(function (l) {
            return [rec.id, rec.supplier, rec.period, l.order, l.store || '', l.name, l.adjust ? '调整' : l.n, l.price || 0, l.amount, l.reason || ''];
          })
        );
        return;
      }

      const prtBtn = e.target.closest('[data-print-recon]');
      if (prtBtn) {
        const rid = prtBtn.dataset.printRecon;
        openRecons[rid] = true;
        const block = prtBtn.closest('.rec-block');
        const panel = block && block.querySelector('.ap-detail');
        if (panel) panel.style.display = 'block';
        if (block) block.classList.add('print-focus');
        document.body.classList.add('printing-recon');
        setTimeout(function () {
          window.print();
          document.body.classList.remove('printing-recon');
          if (block) block.classList.remove('print-focus');
        }, 80);
      }
    });
  };
})(window.Views);
