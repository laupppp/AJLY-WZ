# AJLY-WZ 物资采购系统优化与中台操作台使用指南

本文档说明本次系统优化涵盖的**核心业务缺陷修复**、**门店下单审批流程重构**、**职能部门合同总额管控**以及**运营管理部「中台操作台」操作指南与数据结构**。

---

## 一、已修复的核心业务缺陷与存储改进

| # | 问题现象 | 修复方案 | 代码位置 |
|---|---|---|---|
| 1 | **已关闭/已完结订单被供应商发货"复活"** | `supplierDeliver`、`supplierAck`、`reopenSupplierAck` 统一增加白名单状态校验（仅 `supplier / preparing / delivering / partial` 允许操作）；`closeOrder` 审计记录原状态 `from` | [domain.js](file:///Users/pang/Antigravity/AJLY-WZ/miniprogram/utils/domain.js) |
| 2 | **多供应商订单任意一家即可确认整单结算** | `submitSettlement` 记录订单全部供应商 `suppliers`，`settleAction` 按供应商分别记录 `confirmedBySuppliers[supplier]`；仅当全部供应商确认后订单才进入 `accepted`；`pendingSettleOrders` 对已确认供应商隐藏待办 | [domain.js](file:///Users/pang/Antigravity/AJLY-WZ/miniprogram/utils/domain.js)、[settle.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/settle.js) |
| 3 | **部分验收未确认结算的订单直接进入对账** | `createReconciliation` 强制限定仅 `accepted` / `done` 且 `settlement.status === 'confirmed'` 的订单可纳入对账单 | [domain.js](file:///Users/pang/Antigravity/AJLY-WZ/miniprogram/utils/domain.js) |
| 4 | **部分验收后破损/短收无法继续推进导致订单卡死** | 新增 `finalizeShortDelivery`（短收结案）：门店/部门或中台在部分验收后填写原因，按已验收实收数量核销未到货部分，释放对应在途预算并进入 `settle-pending` | [domain.js](file:///Users/pang/Antigravity/AJLY-WZ/miniprogram/utils/domain.js)、[order-detail.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/order-detail.js) |
| 5 | **结算折让后门店预算仍按原订单价扣减** | `splitOrder` 在 `settlement.status === 'confirmed'` 时按确认后的最终结算金额等比例分摊到各费用科目，及时释放折让差额对应的预算占用 | [domain.js](file:///Users/pang/Antigravity/AJLY-WZ/miniprogram/utils/domain.js) |
| 6 | **审计日志保留最旧 600 条 / 验收照片仅留 12 张** | `Store.appendAudit` 改为新日志头插并保留最新 600 条；`Store.addEvidence` 保留上限提升至 36 张；中台操作台物资/合同/规则改动同步返回标准 `audit` 留痕 | [store.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/store.js)、[domain.js](file:///Users/pang/Antigravity/AJLY-WZ/miniprogram/utils/domain.js) |

---

## 二、门店下单审批流程优化对比

### 1. 流程变化对照

```
优化前：
门店下单（超可核定上限仍可提交）
  → 战区审核（所有单）
    ├─ 500-2000元 → 战区金额审批（同一人再点一次）
    ├─ 超预算 → 中台核定 → >2000元再进中台金额审批（中台点两次）
    └─ >2000元（预算内）→ 中台金额审批

优化后（每单最多两步）：
门店下单（试算超「科目可用 + 机动池」上限直接拦截；超预算需写原因）
  ├─ 预算内 & ≤500元 ──> 战区审核（可选中台开启免审直发）──> 供应商
  ├─ 预算内 & 500–2000元 ──> 战区一步终审（合规 + 金额合并）──> 供应商
  ├─ 预算内 & >2000元 ──> 战区审核 ──> 中台金额审批 ──> 供应商
  └─ 超预算（可核定上限内）──> 战区审核 ──> 中台一步核定预算并完成金额审批 ──> 供应商
```

### 2. 配套管控与效率改进

1. **下单拦截与超预算理由**：在 [checkout.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/checkout.js) 与 `createStoreOrder` 中拦截超出 `可用额度 + 机动池`（`hardOver`）的订单；超预算在上限内下单时，页面强制要求填写至少 4 个字的超预算说明。
2. **防拆单累计定档**：开启 `splitGuard`（默认开启，窗口 `splitDays = 3` 天，可在中台操作台调为 1–31 天）时，按「近 N 天同门店 + 同费用科目（排除已中台审批大单 `tier === 'central'`）累计金额 + 本单金额」参与定档，防止拆多笔小单绕过审批，且不同费用科目互不干扰。
3. **审批动作增强**：
   - **驳回必填原因**：审批台驳回弹窗要求至少填写 2 个字原因，记录在 `order.rejectReason` 并展示在订单详情顶部警示条。
   - **审批微调数量**：审批人可在「微调数量」弹层直接核减商品数量并保存通过，系统自动重算总价、预算占用与档位，免去整单驳回重下。
   - **预算内一键批量通过**：审批台对名下超过 1 笔的预算内待审单提供「一键通过预算内」，自动跳过超预算核定单。
   - **审批卡片信息直显**：卡片直接展示分科目申购额与余额、超预算说明与防拆单累计提示。

---

## 三、预算与合同上限口径

| 采购主体 | 费用约束口径 | 规则说明 |
|---|---|---|
| **门店采购** | **房间数 × 科目系数** | 分 `社群费`、`客户维护费`、`营销费` 三科目独立计算，含中台按门店覆盖系数/直接定额及调剂增减；已确认结算的订单按结算金额占用 |
| **职能部门 / 中台自采** | **不设部门预算，受供应商合同总额上限管控** | 默认配置文件位于 [rules.js](file:///Users/pang/Antigravity/AJLY-WZ/miniprogram/data/rules.js)（`CONTRACTS_DEFAULT`），下单时 `checkContractCap` 实时校验「该供应商全部有效订单累计（已结算按结算金额）+ 本单 ≤ 合同总额」，超出即拦截 |

---

## 四、中台操作台使用指南（`#/console`）

仅 **运营管理部（`central`）** 可进入，入口位于左侧导航栏「中台操作台」、首页快捷入口、采购下单页右上角「物资管理」按钮及「我的」页面。

### 1. 物资目录管理（`?tab=catalog`）

- **实时目录机制**：基础目录来自 [catalog.js](file:///Users/pang/Antigravity/AJLY-WZ/miniprogram/data/catalog.js)，运营管理部在中台操作台做的增、改、上下架、删、恢复及采购权限配置保存在 `state.catalogCustom`，下单页（[catalog.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/catalog.js)）、结算确认页与 `computeQuote` / `createDepartmentOrders` 实时读取最新生效目录。
- **采购权限范围管控（`purchaseScope`）**：支持在新增/编辑弹窗或卡片快捷按钮上设置物资为「门店与部门均可自行下单（`all`）」或「仅运营管理部（中台）集中采购（`central`）」。设为仅中台采购后，门店与普通职能部门下单目录自动隐藏，且后端校验（`computeQuote`、`createStoreOrder`、`createDepartmentOrders`）同步拦截非中台提交。
- **新增物资**：点「＋ 新增物资」，编号留空自动生成 `WZ-xxx`（宣传印刷物料生成 `AD-xxx`），可指定所属大类、对应费用科目（留空按大类自动归属）、单价、单位、规格与供应商（支持从现有列表选择或自定义新供应商）。
- **编辑与上下架**：支持修改名称/规格/价格/供应商/科目；临时停购可点「下架」，下架商品不再出现在下单目录且提交会被拒绝，历史订单详情照常显示。
- **删除与在途订单保护**：点「删除」前会校验是否存在未完结订单（非 `done` / `cancelled` / `rejected`）引用该物资；**若在途订单包含该物资，系统会阻止删除并提示先下架**。无在途引用的物资删除后可在「已删除」筛选下随时点「恢复上架」。
- **导出 JSON**：点「导出目录」可查看与一键复制「中台增量改动 JSON」或「完整在售目录 JSON」，方便同步回代码仓库或导入后端数据库。

### 2. 供应商合同上限（`?tab=contracts`）

- 查看每家供应商框架合同总额、门店与部门已占用明细、剩余可用额度及使用率进度条。
- 支持「＋ 新增合同」与「调整合同」，即时更新下单时的合同上限校验。

### 3. 审批规则配置（`?tab=rules`）

- 支持在线维护：
  - 小额免金额审批上限（默认 500 元）；
  - 战区一步终审上限（默认 2000 元）；
  - 防拆单累计开关与统计天数（默认开启、3 天，范围 1–31 天）；
  - 小额预算内免战区审核直发供应商开关（默认关闭）。
- 提供直达「门店预算设置（`#/budget`）」与「统一对账（`#/reports?tab=recon`）」的快捷入口。

---

## 五、变更清单与数据结构（接后端参考）

### 新增与主要修改文件

- [rules.js](file:///Users/pang/Antigravity/AJLY-WZ/miniprogram/data/rules.js) —— 默认审批阈值与供应商合同默认配置
- [domain.js](file:///Users/pang/Antigravity/AJLY-WZ/miniprogram/utils/domain.js) —— 状态机白名单、多供应商结算、短收结案、折让预算回写、防拆单分科目累计、合同上限校验、动态物资 CRUD
- [perm.js](file:///Users/pang/Antigravity/AJLY-WZ/miniprogram/utils/perm.js) / [format.js](file:///Users/pang/Antigravity/AJLY-WZ/miniprogram/utils/format.js) —— 权限 `catalog.manage`、中台操作台入口、状态文案同步
- [console.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/console.js) —— 中台操作台页面（物资管理 / 合同上限 / 审批规则）
- [catalog.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/catalog.js)、[checkout.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/checkout.js)、[approvals.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/approvals.js)、[order-detail.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/order-detail.js)、[settle.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/settle.js)、[home.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/home.js)、[profile.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/profile.js)、[guide.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/guide.js) —— H5 交互适配
- [index.html](file:///Users/pang/Antigravity/AJLY-WZ/h5/index.html)、[app.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/app.js)、[store.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/store.js)、[app.css](file:///Users/pang/Antigravity/AJLY-WZ/h5/css/app.css) —— 路由导航、日志/照片留存策略及样式
- [domain.test.js](file:///Users/pang/Antigravity/AJLY-WZ/tests/domain.test.js) —— 12 组业务逻辑自动化单元测试（接入 `npm test` 与 GitHub Actions [verify.yml](file:///Users/pang/Antigravity/AJLY-WZ/.github/workflows/verify.yml)）

### 新增状态字段（存于 `state`，接后端时对应独立表/配置接口）

```json
{
  "catalogCustom": {
    "added": [/* 新增物资对象数组 */],
    "updated": { "OP-001": { "price": 120, "enabled": true } },
    "deleted": { "AD-001": { "at": "...", "by": "TEST-CENTRAL", "name": "..." } }
  },
  "contracts": [
    { "id": "HT-2026-001", "supplier": "...", "name": "...", "total": 300000, "start": "2026-01-01", "end": "2026-12-31", "note": "" }
  ],
  "approvalConfig": {
    "autoMax": 500,
    "regionMax": 2000,
    "splitGuard": true,
    "splitDays": 3,
    "autoSkipReview": false
  }
}
```

---

## 六、本地构建与测试命令

```bash
npm run h5:build        # 修改 miniprogram/{utils,data} 后重建 h5/js/biz.js
npm run h5:standalone   # 重建单文件版 h5/standalone.html
npm run test:unit       # 仅运行业务逻辑单元测试（node --test tests/domain.test.js）
npm test                # 一键运行产物指纹校验 + standalone 校验 + 语法检查 + 单元测试
npm run h5:serve        # 启动本地 H5 服务：http://127.0.0.1:8899/index.html
```

---

## 七、全链路闭环与「安居乐寓」品牌 VI 升级

1. **三分类 × 双框架合同收敛**：
   - 门店下单去除「常买清单」，所有 278 项物资统一归入 **社群活动物资**（运营物资合同 · 社群活动预算）、**客诉维护物资**（运营物资合同 · 客诉预算）、**印刷品物料**（印刷品物料合同 · 营销预算）。
   - 跨合同下单支持在结算页勾选 **按合同自动拆单**（默认开启），提交后拆成各自独立合同订单，避免两家供应商结算折让串摊；对保留混单的历史/特殊订单也支持分供应商填报结算金额（`bySupplier`）。
2. **统计看板结算口径对齐 & 合同×预算核算总表**：
   - [domain.js](file:///Users/pang/Antigravity/AJLY-WZ/miniprogram/utils/domain.js) `reportSummary`、`departmentSummary` 及 [reports.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/pages/reports.js) `zoneTable` 均改为按确认后的实付结算金额（含折让）核算已验收与已对账金额，保证看板与对账单分毫不差。
   - 看板新增 **「合同与预算」** 页签（`contractBudgetReport`）并支持一键导出 Excel 兼容 CSV。
3. **对账差异闭环 & 验收异常反馈联动**：
   - `disputed` 差异对账单支持运营管理部「核对重发（`reopen`）」与「作废（`void`）」；支持导出单张对账单 CSV 与打印带甲乙方签章栏的标准化对账单（`@media print`）。
   - 门店提交「验收异常反馈」自动推入供应商工作台「异常」页签，供应商或采购方可通过 `resolveAcceptanceIssue` 登记补发/折让/结案处理方案。
4. **品牌 VI 视觉规范**：
   - 全系统接入「安居乐寓」官方徽标（[logo.png](file:///Users/pang/Antigravity/AJLY-WZ/h5/img/logo.png) 并内联至 [config.js](file:///Users/pang/Antigravity/AJLY-WZ/h5/js/config.js) 兼容单文件版）；
   - 建立三大预算科目全链路 VI 色彩锚点（社群活动 `#1c7ed6` / 客诉 `#0f766e` / 营销 `#5f3dc4`）与专属 SVG 矢量图标；
   - 顶部栏右侧增加当前身份/门店快速胶囊（演示模式点击可原地切换角色）。
