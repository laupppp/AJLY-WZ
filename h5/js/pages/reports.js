/* 统计看板与统一对账 */
(function (Views) {
  const RECON_STATUS = {
    'supplier-pending': { label: '待供应商确认', cls: 'warn' },
    'supplier-confirmed': { label: '已确认待锁定', cls: 'info' },
    'locked': { label: '已锁定', cls: 'good' },
    'disputed': { label: '有差异', cls: 'bad' }
  };

  Views.reports = function (root, r, ctx) {
    const domain = BIZ.domain;
    const me = ctx.me;
    const state = ctx.state;

    const budgets = domain.budgetSummary(state, me);
    const report = domain.reportSummary(state);
    const depts = me.role === 'central' ? domain.departmentSummary(state) : [];

    const tabs = [];
    if (budgets.length) tabs.push({ key: 'budget', label: '预算占用' });
    if (me.role !== 'supplier') tabs.push({ key: 'zone', label: '战区金额' });
    if (me.role === 'central') tabs.push({ key: 'dept', label: '部门' });
    tabs.push({ key: 'supplier', label: '供应商' });
    if (me.role === 'central' || me.role === 'supplier') tabs.push({ key: 'recon', label: '对账' });

    let tab = r.query.tab && tabs.some(function (t) { return t.key === r.query.tab; }) ? r.query.tab : tabs[0].key;
    if (me.role === 'supplier' && r.query.tab !== 'supplier') tab = r.query.tab === 'recon' ? 'recon' : tabs[0].key;

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
        const budget = itemTotal(i, 'budget');
        const used = itemTotal(i, 'used');
        const pct = budget > 0 ? Math.min(100, Math.round(used / budget * 100)) : 0;
        const tone = pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : '';
        return '<div class="bcat">' +
          '<div class="bcat-name">' + UI.esc(name) + '</div>' +
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
        a.orders += 1;
        a.stores[o.store] = 1;
        a.requested += Number(o.total || 0);
        (o.items || []).forEach(function (line) {
          const price = Number(line.price || 0);
          a.accepted += Number(line.accepted || 0) * price;
          a.reconciled += Number(line.reconciled || 0) * price;
        });
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
                BIZ.seed.SUPPLIERS.map(function (s) { return '<option>' + UI.esc(s) + '</option>'; }).join('') +
              '</select></div>' +
              '<div class="field"><div class="label">对账周期</div>' +
                '<input class="input" id="rc-period" value="' + (new Date().getFullYear()) + '-' + ('0' + (new Date().getMonth() + 1)).slice(-2) + '"></div>' +
            '</div>' +
            '<button class="btn soft block" id="rc-create">按已验收数量生成</button>' +
            '<div class="tiny muted mt8">口径：仅统计已验收、尚未对账的数量。</div>' +
          '</div>'
        : '') +
      '<div class="card card-pad">' +
        '<div class="between mb8"><span class="section-title">对账单</span>' +
          '<span class="tiny muted">' + recons.length + ' 张</span></div>' +
        (recons.length
          ? recons.map(function (rec) {
              const st = RECON_STATUS[rec.status] || { label: rec.status, cls: 'gray' };
              return '<div class="rec-block">' +
                '<div class="between"><span class="strong">' + UI.esc(rec.id) + ' · ' + UI.esc(rec.supplier) + '</span>' +
                  '<span class="pill ' + st.cls + '">' + st.label + '</span></div>' +
                '<div class="tiny muted mt4">周期 ' + UI.esc(rec.period) + ' · ' + rec.lines.length + ' 条明细 · ' +
                  UI.esc(BIZ.fmt.fullTime(rec.createdAt)) + '</div>' +
                '<div class="between mt8"><span class="money">¥' + UI.money(rec.total) + '</span>' +
                  (me.role === 'supplier' && rec.status === 'supplier-pending'
                    ? '<span class="btn-group"><button class="btn ghost xs" data-dispute="' + UI.esc(rec.id) + '">有差异</button>' +
                      '<button class="btn primary xs" data-confirm="' + UI.esc(rec.id) + '">确认</button></span>'
                    : me.role === 'central' && rec.status === 'supplier-confirmed'
                      ? '<button class="btn primary xs" data-lock="' + UI.esc(rec.id) + '">锁定对账单</button>'
                      : '') +
                '</div>' +
                (rec.disputeNote ? '<div class="tiny" style="color:var(--bad);margin-top:6px">差异说明：' + UI.esc(rec.disputeNote) + '</div>' : '') +
              '</div>';
            }).join('')
          : UI.empty('🧾', '还没有对账单', canCreate ? '选择供应商后生成第一张' : '等待运营管理部发起')) +
      '</div>';
    }

    function renderBody() {
      const host = root.querySelector('#report-body');
      if (tab === 'budget') host.innerHTML = budgetTable();
      else if (tab === 'zone') host.innerHTML = zoneTable() + deptTable();
      else if (tab === 'dept') host.innerHTML = deptTable() || UI.empty('🏢', '暂无部门采购数据', '');
      else if (tab === 'supplier') host.innerHTML = supplierTable();
      else host.innerHTML = reconPanel();

      root.querySelectorAll('#tabs button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.t === tab);
      });

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
      }
    });
  };
})(window.Views);
