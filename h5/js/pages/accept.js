/* 收货验收：按配送批次验收、拍照留证、异常反馈 */
(function (Views) {
  const SHIP = BIZ.domain.SHIPPING_METHODS;

  function orderById(state, id) {
    return state.orders.filter(function (o) { return o.id === id; })[0];
  }

  Views.accept = function (root, r, ctx) {
    const domain = BIZ.domain;
    const me = ctx.me;
    const state = ctx.state;

    if (r.params[0]) {
      renderForm(root, r, ctx);
      return;
    }

    const list = domain.pendingAcceptOrders(state, me);
    const groups = [];

    list.forEach(function (order) {
      Object.keys(order.supplierRecords || {}).forEach(function (supplier) {
        const rec = order.supplierRecords[supplier];
        (rec.deliveries || []).forEach(function (d) {
          let avail;
          try { avail = domain.batchAvailability(order, supplier, d.batchNo); } catch (e) { return; }
          const total = Object.keys(avail.remaining).reduce(function (s, k) { return s + avail.remaining[k]; }, 0);
          if (total > 0) groups.push({ order: order, supplier: supplier, delivery: d, remaining: avail.remaining, total: total });
        });
      });
    });

    if (!groups.length) {
      root.innerHTML = UI.empty('📷', '没有待验收的批次', '供应商发货后，这里会出现待验收记录');
      return;
    }

    root.innerHTML =
      '<div class="between" style="margin-bottom:10px">' +
        '<div><div class="section-title">待验收</div><div class="tiny muted mt4">按配送批次逐批验收，支持部分验收</div></div>' +
        '<span class="pill warn">' + groups.length + ' 个批次</span>' +
      '</div>' +
      groups.map(function (g) {
        const sp = g.delivery.shipping || {};
        return '<a class="card card-pad" style="margin-bottom:9px;display:block" href="#/accept/' + UI.esc(g.order.id) +
          '?supplier=' + encodeURIComponent(g.supplier) + '&batch=' + g.delivery.batchNo + '">' +
          '<div class="between"><span class="order-id">' + UI.esc(g.order.id) + '</span>' +
            '<span class="pill info">第 ' + g.delivery.batchNo + ' 批 · 待验收</span></div>' +
          '<div class="order-meta">' + UI.esc(g.order.store) + ' · ' + UI.esc(g.supplier) + '</div>' +
          '<div class="order-items">' + (g.delivery.lines || []).map(function (l) {
            return l.name + '×' + l.qty;
          }).join('、') + '</div>' +
          '<div class="order-foot">' +
            '<span class="tiny muted">' + UI.esc(SHIP[sp.method] || '') + (sp.trackingNo ? ' · ' + UI.esc(sp.trackingNo) : '') + '</span>' +
            '<span class="pill good" style="margin-left:auto">待验收 ' + g.total + ' 件</span>' +
          '</div>' +
        '</a>';
      }).join('');
  };

  function renderForm(root, r, ctx) {
    const domain = BIZ.domain;
    const me = ctx.me;
    const state = ctx.state;
    const order = orderById(state, r.params[0]);

    if (!order) {
      root.innerHTML = UI.empty('🔒', '订单不存在', '');
      return;
    }
    if (!domain.canAcceptOrder(order, me)) {
      root.innerHTML = UI.empty('🔒', '当前身份不能验收这笔订单', '门店单由收货门店验收，总部配送由采购部门验收');
      return;
    }

    const supplier = r.query.supplier || Object.keys(order.supplierRecords || {})[0];
    const rec = (order.supplierRecords || {})[supplier];
    if (!rec) {
      root.innerHTML = UI.empty('🚚', '找不到该供应商的配送记录', '');
      return;
    }
    const deliveries = rec.deliveries || [];
    if (!deliveries.length) {
      root.innerHTML = UI.empty('🚚', '该供应商还没有发货记录', '');
      return;
    }

    let batchNo = Number(r.query.batch || deliveries[deliveries.length - 1].batchNo);
    let delivery = deliveries.filter(function (d) { return d.batchNo === batchNo; })[0] || deliveries[deliveries.length - 1];
    batchNo = delivery.batchNo;

    let avail = domain.batchAvailability(order, supplier, batchNo);
    let photo = '';
    let result = 'pass';

    function render() {
      const sp = delivery.shipping || {};
      const lines = Object.keys(avail.remaining).filter(function (id) {
        return avail.remaining[id] > 0;
      }).map(function (id) {
        return { item: order.items.filter(function (x) { return x.id === id; })[0], left: avail.remaining[id] };
      }).filter(function (x) { return x.item; });

      const needInstall = lines.some(function (x) { return BIZ.domain.INSTALL_REQUIRED.indexOf(x.item.id) >= 0; });

      root.innerHTML =
        '<div class="card card-pad">' +
          '<div class="between"><span class="order-id">' + UI.esc(order.id) + ' · 第 ' + batchNo + ' 批</span>' +
            UI.statusPill(order.status) + '</div>' +
          '<div class="order-meta">' + UI.esc(order.store) + ' · ' + UI.esc(supplier) + '</div>' +
          '<div class="divider"></div>' +
          '<div class="kv"><span class="k">配送方式</span><span class="v">' + UI.esc(SHIP[sp.method] || '-') +
            (sp.carrier ? ' · ' + UI.esc(sp.carrier) : '') + (sp.trackingNo ? ' · ' + UI.esc(sp.trackingNo) : '') + '</span></div>' +
          '<div class="kv"><span class="k">预计到达</span><span class="v">' + UI.esc(UI.dateTimeText(sp.estimatedAt) || '未填写') + '</span></div>' +
          '<div class="kv"><span class="k">收货地址</span><span class="v">' + UI.esc(order.address) + '</span></div>' +
          (deliveries.length > 1
            ? '<div class="field mt8"><div class="label">切换批次</div><select class="select" id="a-batch">' +
                deliveries.map(function (d) {
                  return '<option value="' + d.batchNo + '"' + (d.batchNo === batchNo ? ' selected' : '') + '>第 ' + d.batchNo + ' 批 · ' + BIZ.fmt.fullTime(d.at) + '</option>';
                }).join('') + '</select></div>'
            : '') +
        '</div>' +

        '<div class="card card-pad mt12">' +
          '<div class="label">验收结果</div>' +
          '<div class="radio-cards">' +
            '<label class="radio-card' + (result === 'pass' ? ' on' : '') + '" data-res="pass">' +
              '<span class="rd"></span><span class="grow"><span>验收合格</span><span class="d">规格、数量、外观与订单一致</span></span></label>' +
            '<label class="radio-card' + (result === 'issue' ? ' on' : '') + '" data-res="issue">' +
              '<span class="rd"></span><span class="grow"><span>异常反馈</span><span class="d">缺件、破损、规格不符等</span></span></label>' +
          '</div>' +
        '</div>' +

        '<div class="card card-pad mt12">' +
          '<div class="section-title mb8">本次验收数量</div>' +
          '<div class="ship-lines">' + lines.map(function (x) {
            return '<div class="ship-line"><span class="nm">' + UI.esc(x.item.name) +
              '<small>本批可验收 ' + x.left + ' / 共 ' + x.item.qty + '</small></span>' +
              '<input type="number" min="0" max="' + x.left + '" value="' + x.left + '" data-acc="' + UI.esc(x.item.id) + '"' + (result === 'issue' ? ' disabled' : '') + '>' +
              '<span class="u">' + UI.esc(x.item.unit || '件') + '</span></div>';
          }).join('') + '</div>' +
          '<div class="tiny muted mt8">部分到货时把数量改小，剩余数量等下一批验收。</div>' +
        '</div>' +

        '<div class="card card-pad mt12">' +
          '<div class="section-title mb8">现场留证</div>' +
          '<div class="photo-pick">' +
            (photo
              ? '<img class="photo-prev" src="' + photo + '" id="photo-prev">'
              : '<button class="photo-btn" id="photo-btn">' + UI.icon('camera') + '<span>拍照/上传</span></button>') +
            '<div class="photo-hint">验收照片用于对账争议留证。<br>演示环境会压缩后保存在本机。</div>' +
            '<input type="file" accept="image/*" capture="environment" id="photo-file" style="display:none">' +
          '</div>' +
          '<label class="check"><input type="checkbox" id="chk-spec" checked>已核对规格、数量及外观' + (result === 'issue' ? '（异常时可不勾选）' : '') + '</label>' +
          (needInstall
            ? '<label class="check"><input type="checkbox" id="chk-install">安装类物料已确认安装位置、牢固程度及完工效果</label>'
            : '') +
          '<div class="field mt8"><div class="label">备注</div>' +
            '<textarea class="textarea" id="a-note" maxlength="300" placeholder="' + (result === 'issue' ? '请描述异常情况（至少 4 个字）' : '选填') + '">' + UI.esc(formNote) + '</textarea></div>' +
        '</div>' +

        '<div class="actionbar">' +
          '<button class="btn ghost" id="btn-back-list">返回列表</button>' +
          '<button class="btn primary" id="btn-submit" style="flex:1.4">' + (result === 'pass' ? '确认验收' : '提交异常') + '</button>' +
        '</div>' +
        '<div class="action-spacer"></div>';

      const sel = root.querySelector('#a-batch');
      if (sel) sel.onchange = function () {
        batchNo = Number(sel.value);
        delivery = deliveries.filter(function (d) { return d.batchNo === batchNo; })[0];
        avail = domain.batchAvailability(order, supplier, batchNo);
        formNote = root.querySelector('#a-note') ? root.querySelector('#a-note').value : '';
        render();
      };

      root.querySelectorAll('[data-res]').forEach(function (el) {
        el.addEventListener('click', function () {
          result = el.dataset.res;
          formNote = root.querySelector('#a-note') ? root.querySelector('#a-note').value : '';
          render();
        });
      });

      const photoBtn = root.querySelector('#photo-btn');
      const file = root.querySelector('#photo-file');
      if (photoBtn) photoBtn.onclick = function () { file.click(); };
      if (file) file.onchange = function () {
        const f = file.files && file.files[0];
        if (!f) return;
        UI.compressImage(f, 900, 0.72).then(function (data) {
          photo = data;
          render();
        }).catch(function (e) { UI.toast(e.message, 'error'); });
      };

      const prev = root.querySelector('#photo-prev');
      if (prev) prev.onclick = function () {
        UI.sheet({
          title: '验收照片',
          body: '<img src="' + photo + '" style="width:100%;border-radius:12px">',
          actions: [{ label: '重新拍摄', cls: 'ghost', onClick: function () { photo = ''; render(); } }]
        });
      };

      root.querySelector('#btn-back-list').onclick = function () { App.go('/accept'); };
      root.querySelector('#btn-submit').onclick = function () { submit(); };
    }

    let formNote = '';

    function submit() {
      const note = root.querySelector('#a-note') ? root.querySelector('#a-note').value.trim() : '';
      const specChecked = root.querySelector('#chk-spec') ? root.querySelector('#chk-spec').checked : false;
      const installChecked = root.querySelector('#chk-install') ? root.querySelector('#chk-install').checked : false;

      if (result === 'pass' && !specChecked) { UI.toast('请先确认规格、数量及外观已核对', 'error'); return; }
      if (result === 'issue' && note.length < 4) { UI.toast('请填写至少 4 个字的异常情况', 'error'); return; }

      const lines = [];
      root.querySelectorAll('[data-acc]').forEach(function (input) {
        const qty = Number(input.value);
        if (qty > 0) lines.push({ id: input.dataset.acc, qty: qty });
      });
      if (result === 'pass' && !lines.length) { UI.toast('请填写至少一项合格数量', 'error'); return; }

      const evidenceId = 'EV-' + Date.now().toString(36);

      const doSubmit = function (allowNoPhoto) {
        try {
          const res = App.mutate(function (st, ses) {
            return BIZ.domain.acceptDelivery(st, ses, {
              orderId: order.id,
              supplier: supplier,
              batchNo: batchNo,
              result: result,
              lines: lines,
              specChecked: specChecked,
              installChecked: installChecked,
              prove: true,
              evidenceId: evidenceId,
              photoPath: photo ? ('evidence:' + evidenceId) : '',
              allowNoPhoto: allowNoPhoto,
              note: note
            });
          });
          Store.addEvidence(Object.assign({}, res.evidence, { filePath: photo }));
          // 全部验收完成 → 直接引导去填写结算金额，避免门店不知道下一步在哪
          const settleReady = res.order && res.order.status === 'settle-pending';
          if (result === 'pass' && settleReady) {
            UI.toast('验收完成，请确认结算金额', 'good', 2400);
            App.go('/settle/' + order.id);
          } else {
            UI.toast(result === 'pass' ? '验收完成' : '异常已反馈', result === 'pass' ? 'good' : '');
            App.go('/order/' + order.id);
          }
        } catch (e) {
          UI.toast(e.message, 'error', 2800);
        }
      };

      if (!photo) {
        UI.confirm({
          title: '没有验收照片',
          sub: '现场留证是默认要求。演示环境若无法调用相机，可以选择无照片验收（会标记为演示无照片）。',
          okText: '无照片验收'
        }).then(function (ok) { if (ok) doSubmit(true); });
      } else {
        doSubmit(false);
      }
    }

    render();
  }
})(window.Views);
