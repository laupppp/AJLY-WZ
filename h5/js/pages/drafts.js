/* 草稿箱 */
(function (Views) {
  Views.drafts = function (root, r, ctx) {
    const me = ctx.me;

    function render() {
      const list = Store.listDrafts(me.id);
      root.innerHTML =
        '<div class="between" style="margin-bottom:10px">' +
          '<div><div class="section-title">草稿箱</div><div class="tiny muted mt4">存下来的清单不会占用预算，随时可继续编辑</div></div>' +
          '<span class="pill line">' + list.length + ' 份</span>' +
        '</div>' +
        (list.length
          ? list.map(function (d) {
              return '<div class="card card-pad" style="margin-bottom:9px">' +
                '<div class="between"><span class="strong">' + (d.count || 0) + ' 种商品</span>' +
                  '<span class="tiny muted">' + UI.esc(BIZ.fmt.fullTime(d.updatedAt)) + '</span></div>' +
                '<div class="order-meta">' + UI.esc(d.store || '') + (d.details && d.details.purpose ? ' · ' + UI.esc(d.details.purpose) : '') + '</div>' +
                '<div class="between mt8"><span class="money">¥' + UI.money2(d.amount) + '</span>' +
                  '<span class="btn-group" style="flex:0 0 auto">' +
                    '<button class="btn ghost xs" data-del="' + UI.esc(d.id) + '">删除</button>' +
                    '<button class="btn primary xs" data-restore="' + UI.esc(d.id) + '">继续编辑</button>' +
                  '</span></div>' +
              '</div>';
            }).join('')
          : UI.empty('🗂', '还没有草稿', '在结算页点「存草稿」会保存到这里')) +
        '<div style="text-align:center;margin-top:8px"><a class="btn ghost" href="#/catalog" style="width:170px">去选商品</a></div>';

      root.querySelectorAll('[data-restore]').forEach(function (btn) {
        btn.onclick = function () {
          const d = Store.listDrafts(me.id).filter(function (x) { return x.id === btn.dataset.restore; })[0];
          if (!d) return;
          Store.saveCart(me.id, { lines: Object.assign({}, d.lines), store: d.store || '' });
          App.go('/checkout');
        };
      });

      root.querySelectorAll('[data-del]').forEach(function (btn) {
        btn.onclick = function () {
          UI.confirm({ title: '删除这份草稿？', okText: '删除', danger: true }).then(function (ok) {
            if (!ok) return;
            Store.deleteDraft(btn.dataset.del, me.id);
            UI.toast('已删除');
            render();
          });
        };
      });
    }

    render();
  };
})(window.Views);
