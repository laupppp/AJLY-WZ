/* 门店费用预算设置（中台）：房间数 × 科目系数，可为单店直接定额 */
(function (Views) {
  Views.budget = function (root, r, ctx) {
    const domain = BIZ.domain;
    const perm = BIZ.perm;
    const BUDGET = BIZ.budget;
    const me = ctx.me;

    if (!perm.can(me, 'budget.config')) {
      root.innerHTML = UI.empty('🔒', '当前身份无预算设置权限', '仅运营管理部（中台）可调整门店费用预算');
      return;
    }

    let state = ctx.state;
    const sync = function () { state = Store.loadState(); };

    let keyword = '';
    let limit = 12;
    let editing = '';
    let form = null;

    function rows() {
      const summary = domain.budgetSummary(state, me);
      const usedOf = {};
      summary.forEach(function (x) { usedOf[x.store] = x; });
      const kw = keyword.trim();
      return BIZ.catalog.STORES.filter(function (s) {
        return !kw || s.indexOf(kw) >= 0;
      }).map(function (s) {
        const cfg = domain.budgetConfigOf(state, s);
        const used = usedOf[s];
        return {
          store: s,
          rooms: cfg.rooms,
          total: cfg.total,
          used: used ? used.used : 0,
          pct: used ? used.usedPct : 0,
          items: cfg.items
        };
      });
    }

    function storeCard(row) {
      const isEdit = editing === row.store;
      const tone = row.pct >= 90 ? 'bad' : row.pct >= 70 ? 'warn' : '';
      const itemLines = row.items.map(function (it) {
        return '<div class="bitem">' +
          '<span class="bitem-name">' + UI.esc(it.name) + '</span>' +
          '<span class="bitem-basis">' + (it.basis === 'override' ? '直接定额' : it.coef + ' 元/间') + '</span>' +
          '<span class="bitem-amt num">¥' + UI.money(it.budget) + '</span>' +
        '</div>';
      }).join('');

      let editor = '';
      if (isEdit && form) {
        editor = '<div class="bedit">' +
          '<div class="field"><div class="label">管理房间数</div>' +
            '<input class="input" type="number" min="1" id="f-rooms" value="' + form.rooms + '"></div>' +
          form.items.map(function (fi, i) {
            return '<div class="bedit-item">' +
              '<div class="between"><span class="strong small">' + UI.esc(fi.name) + '</span>' +
                '<span class="tiny muted">当前 ¥' + UI.money(fi.budget) + (fi.adjust ? '（含追加 ' + UI.money(fi.adjust) + '）' : '') + '</span></div>' +
              '<div class="field-row mt8">' +
                '<div class="field" style="margin:0"><div class="label">系数（元/间）</div>' +
                  '<input class="input" type="number" min="0" step="0.01" data-coef="' + i + '" value="' + fi.coef + '"></div>' +
                '<div class="field" style="margin:0"><div class="label">直接定额（留空按公式）</div>' +
                  '<input class="input" type="number" min="0" step="1" data-ov="' + i + '" value="' + (fi.override === null ? '' : fi.override) + '"></div>' +
              '</div>' +
            '</div>';
          }).join('') +
          '<div class="btn-group mt12">' +
            '<button class="btn ghost sm" data-reset="' + UI.esc(row.store) + '">恢复默认</button>' +
            '<button class="btn primary sm" data-save="' + UI.esc(row.store) + '">保存</button>' +
          '</div>' +
          '<div class="tiny muted mt8">保存后立即生效：下单试算、预算核定缺口、看板统计都按新额度计算，历史订单不追溯。</div>' +
        '</div>';
      }

      return '<div class="card card-pad store-card" data-store="' + UI.esc(row.store) + '">' +
        '<div class="between">' +
          '<div class="grow"><div class="strong">' + UI.esc(row.store) + '</div>' +
            '<div class="tiny muted mt4">' + row.rooms + ' 间房 · 已用 ¥' + UI.money(row.used) + '（' + row.pct + '%）</div></div>' +
          '<div style="text-align:right;flex:0 0 auto">' +
            '<div class="num strong">¥' + UI.money(row.total) + '</div>' +
            '<button class="btn ghost xs mt4" data-edit="' + UI.esc(row.store) + '">' + (isEdit ? '收起' : '调整') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="bar mt8" style="height:4px"><i class="' + tone + '" style="width:' + Math.min(100, row.pct) + '%"></i></div>' +
        '<div class="bitems">' + itemLines + '</div>' +
        editor +
      '</div>';
    }

    function render() {
      const list = rows();
      const shown = list.slice(0, limit);
      root.innerHTML =
        '<div class="between" style="margin-bottom:10px">' +
          '<div><div class="section-title">门店费用预算</div>' +
            '<div class="tiny muted mt4">额度 = 管理房间数 × 科目系数，可对单店直接定额；机动池余额 ¥' + UI.money(state.flex) + '</div></div>' +
          '<span class="pill line">' + list.length + ' 家门店</span>' +
        '</div>' +
        '<div class="card card-pad" style="padding:12px 14px">' +
          '<div class="field" style="margin:0"><div class="label">搜索门店</div>' +
            '<input class="input" id="b-kw" placeholder="输入门店名称，如 福海和平店" value="' + UI.esc(keyword) + '"></div>' +
        '</div>' +
        '<div class="bstore-list">' + shown.map(storeCard).join('') + '</div>' +
        (shown.length < list.length
          ? '<div style="text-align:center;margin-top:10px"><button class="btn ghost" id="b-more" style="width:210px">显示更多（' + shown.length + '/' + list.length + '）</button></div>'
          : '') +
        '<div class="note-box mt12">三项费用均按「管理房间数 × 系数」计提，默认 1000 间房 × 10 元/间 = 每科目 ¥10,000。' +
          '机动池追加与门店间调剂不计入基数，在「统一对账 → 预算占用」中查看明细。</div>';

      const kwInput = root.querySelector('#b-kw');
      kwInput.addEventListener('input', UI.debounce(function () {
        keyword = kwInput.value;
        limit = 12;
        render();
        const again = root.querySelector('#b-kw');
        again.focus();
        again.setSelectionRange(keyword.length, keyword.length);
      }, 220));

      const more = root.querySelector('#b-more');
      if (more) more.onclick = function () { limit += 20; render(); };

      root.querySelectorAll('[data-edit]').forEach(function (btn) {
        btn.onclick = function () {
          const name = btn.dataset.edit;
          if (editing === name) { editing = ''; form = null; render(); return; }
          const cfg = domain.budgetConfigOf(state, name);
          editing = name;
          form = {
            rooms: String(cfg.rooms),
            items: cfg.items.map(function (it) {
              return {
                key: it.key, name: it.name, coef: it.coef,
                override: it.override === null ? '' : it.override,
                budget: it.budget, adjust: it.adjust
              };
            })
          };
          render();
          const card = root.querySelector('[data-store="' + name + '"]');
          if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        };
      });

      root.querySelectorAll('[data-coef],[data-ov]').forEach(function (input) {
        input.addEventListener('input', function () {
          if (!form) return;
          const idx = Number(input.dataset.coef !== undefined ? input.dataset.coef : input.dataset.ov);
          const item = form.items[idx];
          if (!item) return;
          if (input.dataset.coef !== undefined) item.coef = input.value;
          else item.override = input.value;
        });
      });

      const roomsInput = root.querySelector('#f-rooms');
      if (roomsInput) roomsInput.addEventListener('input', function () { if (form) form.rooms = roomsInput.value; });

      root.querySelectorAll('[data-save]').forEach(function (btn) {
        btn.onclick = function () {
          const name = btn.dataset.save;
          if (!form) return;
          const payload = { store: name, rooms: Number(form.rooms), coef: {}, override: {} };
          form.items.forEach(function (it) {
            const c = String(it.coef).trim();
            const o = String(it.override).trim();
            payload.coef[it.key] = c === '' ? null : Number(c);
            payload.override[it.key] = o === '' ? null : Number(o);
          });
          try {
            let changed = [];
            App.mutate(function (st, ses) {
              const res = BIZ.domain.saveBudgetConfig(st, ses, payload);
              changed = res.changed;
              Store.appendAudit([{
                orderId: '', kind: 'budget', stage: 'budget-config', decision: '调整门店预算',
                role: '运营管理部（' + ses.id + '）', from: '', to: '',
                note: name + '：' + changed.join('，'), at: new Date().toISOString()
              }]);
            });
            sync();
            UI.toast('已保存：' + changed.join('，'), 'good', 2600);
            const cfg = domain.budgetConfigOf(state, name);
            form = {
              rooms: String(cfg.rooms),
              items: cfg.items.map(function (it) {
                return {
                  key: it.key, name: it.name, coef: it.coef,
                  override: it.override === null ? '' : it.override,
                  budget: it.budget, adjust: it.adjust
                };
              })
            };
            render();
          } catch (err) {
            UI.toast(err.message, 'error', 3000);
          }
        };
      });

      root.querySelectorAll('[data-reset]').forEach(function (btn) {
        btn.onclick = function () {
          const name = btn.dataset.reset;
          UI.confirm({
            title: '恢复默认预算？',
            sub: '清除「' + name + '」的科目系数覆盖与直接定额，改回房间数 × 默认系数（机动池追加/调剂不受影响）。',
            okText: '恢复默认'
          }).then(function (ok) {
            if (!ok) return;
            const payload = { store: name, coef: {}, override: {} };
            BIZ.budget.KEYS.forEach(function (k) {
              payload.coef[k] = null;
              payload.override[k] = null;
            });
            try {
              App.mutate(function (st, ses) { BIZ.domain.saveBudgetConfig(st, ses, payload); });
              sync();
              UI.toast('已恢复默认');
              const cfg = domain.budgetConfigOf(state, name);
              form = {
                rooms: String(cfg.rooms),
                items: cfg.items.map(function (it) {
                  return {
                    key: it.key, name: it.name, coef: it.coef,
                    override: it.override === null ? '' : it.override,
                    budget: it.budget, adjust: it.adjust
                  };
                })
              };
              render();
            } catch (err) {
              UI.toast(err.message, 'error', 3000);
            }
          });
        };
      });
    }

    render();
  };
})(window.Views);
