/* 采购说明：流程口径、审批分级、预算规则、结算与对账（与小程序 pages/guide 同步） */
(function (Views) {
  const STEPS = [
    { n: 1, title: '门店 / 部门下单', desc: '选物资、填收货信息；超门店科目额度且在机动池上限内需写超预算说明，超出上限直接拦截；部门采购受供应商合同总额上限管控。' },
    { n: 2, title: '战区审核 / 一步终审', desc: '所有门店单先经战区审核（必要性、合规性）。预算内 500-2000 元由战区一步终审合并金额审批，免二次点击。' },
    { n: 3, title: '预算核定（仅超额度时）', desc: '超出门店科目额度时，由运营管理部一步完成机动预算追加（或门店间调剂）与金额审批，直接发往供应商。' },
    { n: 4, title: '金额审批（>2000元）', desc: '预算内 2000 元以上报运营管理部金额审批；支持近 N 天同门店同科目防拆单累计定档，审批时可微调数量或批量通过预算内订单。' },
    { n: 5, title: '供应商接单与发货', desc: '供应商确认接单、选择配送方式并登记运单号，支持分批次发货。' },
    { n: 6, title: '收货验收（含短收结案）', desc: '逐品填写合格数量并拍照留证；若部分破损且不再补货，可办理短收结案，释放未到货预算并转入结算。' },
    { n: 7, title: '结算金额共同确认', desc: '验收完成后门店填写实际结算金额，涉及的全部供应商各自确认后方生效；有退款或折让须写明原因，确认后按实结调整预算占用。' },
    { n: 8, title: '统一对账', desc: '仅已确认结算的订单进入统一对账；按供应商汇总生成对账单，供应商确认后由运营管理部锁定。' }
  ];
  const TIERS = [
    { range: '≤ 500 元', path: '战区审核 → 直接发送供应商', note: '免金额审批（可在中台操作台配置免审直发）' },
    { range: '500-2000 元', path: '战区一步终审 → 发送供应商', note: '合规与金额合并审批，不再二次点审' },
    { range: '> 2000 元', path: '战区审核 → 运营管理部金额审批', note: '超预算时在中台核定节点一步完成，不重复审批' },
    { range: '部门采购', path: '运营管理部统一确认（中台自采直发）', note: '不设部门预算，但受供应商合同总额上限控制' }
  ];
  const BUDGETS = [
    { name: '社群活动预算', scope: '运营物资合同 · 社群活动物资', sample: '社区活动、茶歇互动、氛围布置' },
    { name: '客诉预算', scope: '运营物资合同 · 客诉维护物资', sample: '客诉礼品、日常耗材、维修安全' },
    { name: '营销预算', scope: '印刷品物料合同 · 印刷品物料', sample: '海报、折页、展架、定制印刷' }
  ];
  const ROLES = [
    { name: '门店店长', duty: '下单、验收、短收结案、确认结算金额', limit: '仅本门店' },
    { name: '战区负责人', duty: '战区审核、500-2000元一步终审、战区看板', limit: '仅本战区' },
    { name: '运营管理部', duty: '中台操作台（物资增删改/合同/规则）、预算核定、大额审批、部门确认、统一对账', limit: '全公司' },
    { name: '职能部门', duty: '部门采购下单、验收、确认结算（受合同上限控制）', limit: '仅本部门' },
    { name: '供应商', duty: '接单、发货、确认结算与对账', limit: '仅本供应商订单' }
  ];
  const SLAS = [
    { name: '审批处理', hours: '24 小时', note: '战区审核 / 金额审批' },
    { name: '供应商接单', hours: '12 小时', note: '超时进入预警' },
    { name: '验收及时率', hours: '48 小时', note: '到货后尽快验收' }
  ];

  Views.guide = function (root) {
    root.innerHTML =
      '<div class="guide-hero">' +
        '<div class="gh-title">物资采购流程说明</div>' +
        '<div class="gh-sub">从下单到对账一共 8 步，门店单先审核、验收后双方确认结算金额。</div>' +
      '</div>' +

      '<div class="card card-pad">' +
        '<div class="section-title mb8">全流程</div>' +
        '<div class="small muted" style="margin:-4px 0 12px">按顺序推进，任一步驳回即结束</div>' +
        STEPS.map(function (s) {
          return '<div class="gstep"><span class="gn">' + s.n + '</span>' +
            '<span class="gcol"><span class="gt">' + UI.esc(s.title) + '</span>' +
            '<span class="gd">' + UI.esc(s.desc) + '</span></span></div>';
        }).join('') +
      '</div>' +

      '<div class="card card-pad mt12">' +
        '<div class="section-title mb8">审批分级</div>' +
        '<div class="small muted" style="margin:-4px 0 12px">按单笔金额自动判定</div>' +
        TIERS.map(function (t) {
          return '<div class="grow-row"><span class="gr">' + UI.esc(t.range) + '</span>' +
            '<span class="gcol"><span class="gt">' + UI.esc(t.path) + '</span>' +
            '<span class="gd">' + UI.esc(t.note) + '</span></span></div>';
        }).join('') +
      '</div>' +

      '<div class="card card-pad mt12">' +
        '<div class="section-title mb8">费用预算</div>' +
        '<div class="small muted" style="margin:-4px 0 12px">额度 = 管理房间数 × 科目系数</div>' +
        '<div class="gformula"><b>每店额度 = 房间数 × 系数</b>' +
          '<span>示例：1000 间房 × 10 元/间 = 每个科目 ¥10,000</span></div>' +
        BUDGETS.map(function (b) {
          return '<div class="grow-row"><span class="gcol"><span class="gt">' + UI.esc(b.name) + '</span>' +
            '<span class="gd">' + UI.esc(b.scope) + '</span></span>' +
            '<span class="gs">' + UI.esc(b.sample) + '</span></div>';
        }).join('') +
        '<div class="note-box mt12">订单按商品大类自动归科目，一张单跨科目时分别占用各自额度；额度不足需运营管理部核定后才能继续。</div>' +
      '</div>' +

      '<div class="card card-pad mt12">' +
        '<div class="section-title mb8">结算与对账</div>' +
        '<div class="small muted" style="margin:-4px 0 10px">金额以双方共同确认为准</div>' +
        '<p class="gp">验收完成后进入结算环节：<b>门店填写实际结算金额</b>，' +
          '<b>供应商在自己的账号确认</b>。因产品问题、少发或退款导致结算金额与申请金额不一致时，必须填写差异原因。</p>' +
        '<p class="gp">供应商提出异议的，退回门店重新核对并再次提交；双方确认一致后，该笔订单才进入统一对账。</p>' +
        '<p class="gp">对账按供应商汇总已确认的结算金额生成对账单，供应商确认后由运营管理部锁定，订单转为已完成。</p>' +
      '</div>' +

      '<div class="card card-pad mt12">' +
        '<div class="section-title mb8">角色权限</div>' +
        '<div class="small muted" style="margin:-4px 0 12px">按最小必要授权</div>' +
        ROLES.map(function (r) {
          return '<div class="grow-row"><span class="gcol"><span class="gt">' + UI.esc(r.name) + '</span>' +
            '<span class="gd">' + UI.esc(r.duty) + '</span></span>' +
            '<span class="gs">' + UI.esc(r.limit) + '</span></div>';
        }).join('') +
      '</div>' +

      '<div class="card card-pad mt12">' +
        '<div class="section-title mb8">时效要求</div>' +
        '<div class="small muted" style="margin:-4px 0 12px">超时会进入预警</div>' +
        SLAS.map(function (s) {
          return '<div class="grow-row"><span class="gcol"><span class="gt">' + UI.esc(s.name) + '</span>' +
            '<span class="gd">' + UI.esc(s.note) + '</span></span>' +
            '<span class="gs"><b>' + UI.esc(s.hours) + '</b></span></div>';
        }).join('') +
      '</div>' +

      '<div class="foot-note">演示版口径，实际执行以公司采购制度为准。</div>';
  };
})(window.Views);
