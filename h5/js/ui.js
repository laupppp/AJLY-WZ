/* 通用 UI 工具：模板转义、状态标签、弹层、提示、图片压缩 */
(function (global) {
  const fmt = global.BIZ.fmt;

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function money(value) { return fmt.money(value); }
  function money2(value) { return fmt.money2(value); }

  function icon(name, cls) {
    return '<svg class="ic ' + (cls || '') + '"><use href="#i-' + name + '"/></svg>';
  }

  function toast(message, type, ms) {
    const host = document.getElementById('toast-host');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity .2s';
      setTimeout(function () { el.remove(); }, 220);
    }, ms || 2200);
  }

  let openSheet = null;

  function sheet(opts) {
    const host = document.getElementById('sheet-host');
    const mask = document.createElement('div');
    mask.className = 'mask';
    const actions = opts.actions || [];
    mask.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true">' +
        '<div class="sheet-head">' +
          '<div class="sheet-title">' + esc(opts.title || '') + '</div>' +
          (opts.sub ? '<div class="sheet-sub">' + opts.sub + '</div>' : '') +
        '</div>' +
        '<div class="sheet-body">' + (opts.body || '') + '</div>' +
        (actions.length ? '<div class="sheet-foot">' + actions.map(function (a, i) {
          return '<button class="btn ' + (a.cls || 'ghost') + '" data-act="' + i + '"' + (a.disabled ? ' disabled' : '') + '>' + esc(a.label) + '</button>';
        }).join('') + '</div>' : '') +
      '</div>';

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      mask.remove();
      if (openSheet === api) openSheet = null;
      document.body.style.overflow = '';
      if (opts.onClose) opts.onClose();
    }

    const api = {
      close: close,
      el: mask.querySelector('.sheet'),
      body: mask.querySelector('.sheet-body'),
      subEl: mask.querySelector('.sheet-sub'),
      setSub: function (text) { if (api.subEl) api.subEl.innerHTML = text; }
    };

    mask.addEventListener('click', function (e) {
      if (e.target === mask && opts.dismissible !== false) close();
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const action = actions[Number(btn.dataset.act)];
      if (!action || !action.onClick) { close(); return; }
      const result = action.onClick(close, api.body);
      if (result !== false) close();
    });

    host.appendChild(mask);
    document.body.style.overflow = 'hidden';
    openSheet = api;
    if (opts.mount) opts.mount(api.body, close);
    const first = api.body.querySelector('input, select, textarea');
    if (first && opts.autofocus !== false) setTimeout(function () { first.focus(); }, 120);
    return api;
  }

  function confirm(opts) {
    return new Promise(function (resolve) {
      let decided = false;
      sheet({
        title: opts.title || '请确认',
        sub: opts.sub,
        body: opts.body || '',
        dismissible: true,
        onClose: function () { if (!decided) { decided = true; resolve(false); } },
        actions: [
          { label: opts.cancelText || '取消', cls: 'ghost', onClick: function () { decided = true; resolve(false); } },
          { label: opts.okText || '确认', cls: opts.danger ? 'danger-solid' : 'primary', onClick: function () { decided = true; resolve(true); } }
        ]
      });
    });
  }

  function statusPill(status) {
    return '<span class="pill ' + fmt.statusCls(status) + '">' + esc(fmt.statusLabel(status)) + '</span>';
  }

  const SUPPLIER_STATUS = {
    pending: { label: '待接单', cls: 'warn' },
    confirmed: { label: '备货中', cls: 'info' },
    shipping: { label: '配送中', cls: 'info' },
    // 验收完成只代表「货已收」，结算金额仍需双方共同确认，不能标成已完成
    accepted: { label: '已验收', cls: 'good' },
    issue: { label: '无法接单', cls: 'bad' }
  };

  function supplierPill(status) {
    const s = SUPPLIER_STATUS[status] || { label: status || '未知', cls: 'gray' };
    return '<span class="pill ' + s.cls + '">' + esc(s.label) + '</span>';
  }

  function supplierStatusText(status) {
    return (SUPPLIER_STATUS[status] || { label: status || '未知' }).label;
  }

  function empty(ico, title, sub) {
    return '<div class="empty"><div class="ico">' + (ico || '📭') + '</div>' +
      '<div class="t">' + esc(title) + '</div>' +
      (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function timeText(iso) { return fmt.fullTime(iso); }
  // 预计到达可能是「2026-11-24」或完整 ISO，统一显示成可读文本
  function dateTimeText(value) {
    if (!value) return '';
    const v = String(value);
    return v.length > 10 ? fmt.fullTime(v) : v;
  }
  function shortTime(iso) { return fmt.shortTime(iso); }
  function fromNow(iso) { return fmt.fromNow(iso); }

  function copy(text) {
    const value = String(text || '');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(value).then(function () {
        toast('已复制：' + value, 'good', 1400);
      }).catch(function () { fallbackCopy(value); });
    } else {
      fallbackCopy(value);
    }
  }

  function fallbackCopy(value) {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.cssText = 'position:fixed;top:-999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制：' + value, 'good', 1400); }
    catch (e) { toast('复制失败，请手动选择', 'error'); }
    ta.remove();
  }

  function compressImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const img = new Image();
        img.onload = function () {
          const side = maxSide || 900;
          const scale = Math.min(1, side / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality || 0.72));
        };
        img.onerror = function () { reject(new Error('图片读取失败')); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('图片读取失败')); };
      reader.readAsDataURL(file);
    });
  }

  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait || 200);
    };
  }

  function todayStr() {
    const d = new Date();
    const p = function (n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // 订单进度：提交 → 战区审核/审批 → 待接单 → 配送 → 验收 → 结算确认 → 对账完成
  // V1.24+ 门店单先走 order-review，验收后进入 settle-*，结算确认后才回到 accepted 待对账
  function stepsOf(order) {
    const s = order.status;
    const closed = s === 'cancelled' || s === 'rejected';
    const approval = ['order-review', 'budget-region', 'budget-central', 'amount-approval', 'dept-approval'].indexOf(s) >= 0;
    const supply = ['supplier', 'preparing'].indexOf(s) >= 0;
    const ship = ['delivering', 'delivered', 'partial'].indexOf(s) >= 0;
    const settling = ['settle-pending', 'settle-supplier', 'settle-disputed'].indexOf(s) >= 0;
    const accepted = s === 'accepted';
    const done = s === 'done';
    const afterAccept = settling || accepted || done;
    return [
      { label: '已提交', done: true },
      { label: '审核审批', done: !approval && !closed, active: approval },
      { label: '待接单', done: supply || ship || afterAccept, active: supply },
      { label: '配送', done: ship || afterAccept, active: ship },
      { label: '验收', done: afterAccept, active: s === 'partial' || s === 'delivered' },
      { label: '结算', done: accepted || done, active: settling },
      { label: '完成', done: done }
    ];
  }

  function progressBar(steps) {
    return '<div class="bar" style="height:5px">' +
      '<i style="width:' + Math.round((steps.filter(function (x) { return x.done; }).length / steps.length) * 100) + '%"></i>' +
      '</div>';
  }

  global.UI = {
    esc: esc, money: money, money2: money2, icon: icon,
    toast: toast, sheet: sheet, confirm: confirm,
    statusPill: statusPill, supplierPill: supplierPill, supplierStatusText: supplierStatusText,
    empty: empty, timeText: timeText, dateTimeText: dateTimeText, shortTime: shortTime, fromNow: fromNow,
    copy: copy, compressImage: compressImage, debounce: debounce, todayStr: todayStr,
    stepsOf: stepsOf, progressBar: progressBar
  };
})(window);
