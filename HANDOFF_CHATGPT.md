# 交接说明：把 H5 交给 ChatGPT 继续改

> 这份文档有两个读者：
> **人**看第 0 节（怎么把东西给 ChatGPT）；
> **AI** 看第 1–9 节（项目是什么、哪些不能碰、怎么改、怎么验）。
> 第 10 节是可以直接复制粘贴的开场提示词。

---

## 0. 给操作的人：三种给法，按需求选

| 方式 | 适合 | 需要准备 | 局限 |
| --- | --- | --- | --- |
| **A. ChatGPT 项目（Projects）** | 长期迭代、想让它记住项目背景 | 把 `anju-h5-chatgpt.zip` 解压后逐个把关键文件拖进 Project 的「Files」，或直接上传 zip（Plus/Pro 支持压缩包） | 它看不到你本地改动，每轮要把改后的文件内容再贴回去 |
| **B. GitHub + Codex / GitHub 连接** | 想让它直接改仓库、开 PR | 先把项目推到 GitHub，在 ChatGPT 里连上仓库 | 需要仓库；改动要在 PR 里 review |
| **C. 单文件对话** | 只改一两个页面 / 调样式 | 上传 `h5/standalone.html`（459 KB，全部代码在一个文件里） | 单文件太大时容易截断，适合「改一处、问一处」 |

**推荐组合：A 建背景 + C 干小活。** 先把 zip 里的文件丢进 Project 让它读一遍，之后每次只贴要改的那个文件（比如 `js/pages/orders.js`），让它输出完整文件，你回贴到本地。

### 千万注意（否则一定出错）

1. **`h5/js/biz.js` 是构建产物，153 KB，绝对不要让它手改。** 那是从小程序 `miniprogram/utils` + `miniprogram/data` 打包来的，手改会在下次构建时被覆盖。
2. **ChatGPT 网页版不能跑 `node`。** 所以：改「业务规则」（状态机、金额、预算、权限）→ 让它改 `miniprogram/utils/*.js`，你本地跑 `npm run h5:build`；改「界面」→ 直接改 `h5/js/pages/*.js`、`h5/css/app.css`，不需要构建。
3. 每轮对话结束，把改后的文件**整份**存回本地，然后跑一次第 8 节的验证。

### 本地常用命令

```bash
npm run h5:serve        # http://127.0.0.1:8899/index.html
npm run h5:build        # 重建 h5/js/biz.js（改了 miniprogram 才需要）
npm run h5:check        # 检查 biz.js 是否过期（过期退出码 1）
npm run h5:standalone   # 重新生成单文件版 h5/standalone.html
```

演示身份直达：`http://127.0.0.1:8899/index.html?as=TEST-STORE-A#/home`
（`TEST-STORE-A/B` 店长、`TEST-REGION-A/B` 战区、`TEST-CENTRAL` 中台、`TEST-DEPT-01` 职能部门、`TEST-SUPPLIER-1/2` 供应商）

---

## 1. 项目是什么

「安居乐寓」内部物资采购系统的 **H5 版**（挂企业微信自建应用用）。纯静态：无框架、无 npm 依赖、无打包步骤，浏览器直接跑。

- 业务链路：门店/部门下单 → **战区审核** → （超预算时）运营管理部预算核定 → 金额分级审批 → 供应商接单发货 → 门店收货验收 → **结算金额门店与供应商共同确认** → 统一对账 → 锁定。
- 数据全在 `localStorage`（前缀 `anju_h5_`），是**演示态**；正式上线要接后端，接口契约见 `h5/README.md` 第 5 节。
- 业务规则不是 H5 自己写的：`h5/js/biz.js` 由小程序同一套纯逻辑模块打包而来，两端共用一份口径。

---

## 2. 目录与文件职责

```
h5/
├── index.html            单页壳：SVG 图标 sprite、侧栏/顶栏/底栏、脚本装配顺序
├── standalone.html       单文件产物（勿手改，由 build-standalone.js 生成）
├── css/app.css           全部样式；移动优先，@media (min-width:900px) 桌面段必须在【文件末尾】
├── build-biz.js          构建：miniprogram/{utils,data} → js/biz.js
├── build-standalone.js   构建：多文件 → standalone.html
└── js/
    ├── config.js         运行配置（品牌、存储前缀、企业微信参数）——改配置只改这里
    ├── biz.js            ★产物勿手改：BIZ.fmt / catalog / seed / subcats / budget / domain / perm
    ├── store.js          持久化：购物车、草稿、审计、验收凭证、演示数据、resetState
    ├── session.js        身份：演示身份切换 + 企业微信免登适配
    ├── ui.js             toast / sheet / confirm / 状态胶囊 / 图标 / 金额 / 图片压缩
    ├── app.js            路由（#/route/param?query）、渲染、导航徽标、App.mutate
    └── pages/            16 个页面，每个文件注册一个 Views.xxx(root, r, ctx)
```

页面文件一览（`Views.<name>`）：

| 文件 | 路由 | 作用 |
| --- | --- | --- |
| `login.js` | `#/login` | 演示身份选择 |
| `home.js` | `#/home` | 首页：统计卡、待办、预算占用、快捷入口 |
| `catalog.js` | `#/catalog` | 下单：左侧分类（点两次收起）、搜索、常买清单 |
| `checkout.js` | `#/checkout` | 确认订单、预算试算、合同校验、提交 |
| `orders.js` | `#/orders` | 订单列表 + 横向筛选（全部/待处理/配送中/结算中/待对账/已完成/已关闭） |
| `order-detail.js` | `#/order/:id` | 详情：进度、明细、验收记录、短收结案、结算卡、流转记录、操作条 |
| `approvals.js` | `#/approvals` | 审批台（战区审核 / 一步终审 / 预算核定 / 数量微调 / 批量通过） |
| `supplier.js` | `#/supplier` | 供应商工作台：待接单/异常/待发货/配送中/结算确认/已完成 |
| `accept.js` | `#/accept`、`#/accept/:id` | 收货验收（逐品合格数量、拍照留证） |
| `reports.js` | `#/reports?tab=budget\|zone\|dept\|supplier\|recon` | 统计看板 + 统一对账 |
| `profile.js` | `#/profile` | 我的：身份、中台操作台/采购说明入口、企业微信、演示工具 |
| `drafts.js` | `#/drafts` | 草稿箱 |
| `budget.js` | `#/budget` | 门店 × 费用科目的预算设置（中台） |
| `console.js` | `#/console?tab=catalog\|contracts\|rules` | 中台操作台：物资增删改/上下架、合同总额上限、审批规则配置 |
| `guide.js` | `#/guide` | 采购流程说明（静态内容） |
| `settle.js` | `#/settle/:id` | 结算金额共同确认（门店填报 / 多供应商分别确认或异议） |

---

## 3. 三条铁律

1. **`h5/js/biz.js` 是产物，不手改。** 要改业务规则，改 `miniprogram/utils/*.js` 或 `miniprogram/data/*.js`，然后 `npm run h5:build`。
2. **`@media (min-width: 900px)` 桌面段必须留在 `app.css` 文件末尾。** 往中间追加同优先级规则会把桌面布局盖掉。新样式一律插在桌面段**之前**。
3. **每次渲染都换掉 `#view` 节点**（`cloneNode(false)` + 重新 innerHTML）。页面里的事件监听直接绑在 `root` 上，不要往 `document` / `window` 上挂，否则切页面会重复触发。

---

## 4. 技术约束（写代码时必须遵守）

- **无框架、无构建、无 npm 依赖**。全部是 IIFE（`(function(global){...})(window)`）+ 全局对象；不要引入 React/Vue/TS/JSX，不要用 ES Module（`import`/`export`）。
- **页面输出是模板字符串拼 HTML**（不是虚拟 DOM），插入任何用户数据都要过 `UI.esc()`。
- **状态写入必须走 `App.mutate(fn)`**：它负责 `Store.loadState()` → 执行 `fn(state, me)` → 保存 → 刷导航。手写 `localStorage.setItem` 会漏掉 revision / 审计。
- **业务判定不要写进页面**。金额分级、预算占用、谁能审、能否验收、结算谁能填，全部在 `BIZ.domain` / `BIZ.perm` 里。页面只做展示与交互。
- 图标用 `UI.icon('名字','sm')`，可用名字见 `index.html` 里的 `<symbol id="i-xxx">`：home cart orders check chart truck user back right plus minus search close camera copy alert clock refresh box bill shop scan。
- CSS 用 `css/app.css` 里已有的设计令牌（`--line`、`--text`、`--muted`、`--brand`、`--good`、`--warn`、`--info`、`--line-2` 等），不要硬编码色值。
- 中文文案，数字金额统一走 `UI.money()` / `BIZ.fmt.money()`。

---

## 5. 当前业务口径（最容易写错的地方）

### 订单状态机

```
下单 ──> order-review（待战区审核；开启小额免审时 ≤autoMax 预算内可直发 supplier）
          ├─ 未超预算 & ≤500 ─────> supplier（待供应商接单）
          ├─ 未超预算 & 500–2000 ─> supplier（战区一步终审合并金额审批）
          ├─ 未超预算 & >2000 ────> amount-approval（中台金额审批）
          └─ 超预算（在可核定上限内）──> budget-central（中台一步核定预算兼金额审批）──> supplier
supplier ──> preparing ──> delivering ──> （验收）
验收完成后：
  全部验收完 ──> settle-pending（待门店确认结算）
  部分验收 ────> partial（可等下一批，或通过 finalizeShortDelivery 短收结案至 settle-pending）
settle-pending ──填报金额──> settle-supplier（待涉及的全部供应商确认结算）
settle-supplier ──全员确认──> accepted（= 结算已确认，待对账，预算按结算额调整）
settle-supplier ──任一异议──> settle-disputed（门店重新填报）
accepted ──对账生成并锁定──> done
```

**三个必须记住的点：**

1. 供应商确认结算后，**订单状态是 `accepted`**（不是 `settle-confirmed`）。结算明细单独存在 `order.settlement.status`，取值为 `pending-store` / `pending-supplier` / `confirmed` / `disputed`。
2. `order.settlement` 结构：`{status, amount, itemsAmount, diff, reason, by, byName, byRole, round, submittedAt, readyAt, confirmedAt, confirmedBy, disputes[]}`。
3. 结算金额与「实收核算金额」（`domain.acceptedAmountOf(order)`）不一致时，**差异原因必填且至少 4 个字**；金额不能超过订单总额。

### 关键 API（都在 `BIZ.domain`，签名 `(state, session, payload)`）

| 方法 | 用途 |
| --- | --- |
| `acceptedAmountOf(order)` | 按已验收数量算出的实收金额 |
| `submitSettlement(state, me, {orderId, amount, reason})` | 门店/部门填报结算金额 → `settle-supplier` |
| `settleAction(state, me, {orderId, action:'confirm'\|'dispute', reason})` | 供应商确认 / 异议 |
| `settleActorOf(order, me)` | 谁能填这笔结算（'store' / 'department' / null） |
| `pendingSettleOrders(state, me)` | 「待填结算 / 待确认结算」列表 |
| `actionCount(state, me)` | 导航徽标与首页「待办」数（含审核、验收、结算） |
| `approveOrder(state, me, {orderId, stage, pass, note, ...})` | 审批（stage: order-review / budget-region / budget-central / amount-approval） |

### 预算

每个门店按三个费用科目分开记账：社群费 / 客户维护费 / 营销费。额度 = 房间数 × 科目系数（当前 1000 间 × 10 元 = 每科目 ¥10,000）。订单按商品大类自动归科目，一张单可跨科目占用；不够时由中台从机动池追加或门店间同科目调剂。

---

## 6. 改代码的常见配方

**加一个页面**
1. 新建 `js/pages/xxx.js`，写 `Views.xxx = function (root, r, ctx) { ... }`；
2. `index.html` 在 `app.js` 之前加 `<script src="js/pages/xxx.js"></script>`；
3. `js/app.js`：`NAV` 加一条（label / icon / hash）、`TAB_OF` 加 `xxx: '对应tab'`、`titleOf` 需要自定义标题就加一行；
4. 顶部 `npm run h5:standalone` 重新生成单文件版。

**加一个筛选 / 页签**：在页面顶部拼 `<div class="tab-seg">` 或 `<div class="chips">`，事件用 `e.target.closest('[data-t]')` 委托，改了筛选条件调 `render()` 或局部重绘函数。

**加业务规则**：改 `miniprogram/utils/domain.js`（或 `perm.js` / `data/*.js`）=》`npm run h5:build` =》H5 自动生效，页面不用动。

**改样式**：只改 `css/app.css`，新规则插在末尾桌面段之前；移动端 390px 优先，桌面 ≥900px。

---

## 7. 数据与存储

- 键前缀 `anju_h5_`：`state`（订单/预算/客户等）、`identity`（当前身份）、`cart`、`drafts`、`audit`、`evidence`、`demo`、`profile`。
- `SCHEMA = 3`（`js/store.js`）：种子结构变更时自增，旧缓存自动重建。
- 「我的 → 演示工具」可切身份、看占用、一键重置（`Store.resetState()`）。
- 演示身份 ID：`TEST-STORE-A/B`、`TEST-REGION-A/B`、`TEST-CENTRAL`、`TEST-DEPT-01`、`TEST-SUPPLIER-1/2`。

---

## 8. 改完怎么验证

```bash
npm test                          # 一键运行 biz.js 检查 + standalone 检查 + 语法检查 + 单元测试
npm run h5:check                  # 1. biz.js 没过期（改了 miniprogram 就必须过这关）
npm run h5:standalone             # 2. 单文件版能生成（顺带验证没有语法错误）
npm run h5:serve                  # 3. 起服务，人工点一遍
```

更多中台操作台、合同上限与审批优化口径见 [`docs/OPTIMIZATION_GUIDE.md`](docs/OPTIMIZATION_GUIDE.md)。

人工回归清单（每条都能在浏览器里手动走）：

1. 5 个角色各打开一次首页/工作台，控制台无报错、页面无横向滚动条。
2. 390px 与 1280px 两个宽度都看一遍（桌面端是左侧固定导航 + 双列）。
3. 门店下单 → 战区审核通过 → 供应商接单发货 → 门店验收 → 填结算 → 供应商确认 → 中台对账。
4. 切到供应商，确认「结算确认」页签只列结算中的单，已确认的落到「已完成」。

---

## 9. 已知坑（踩过的，别再踩）

1. `App.state()` 每次返回**新对象**。别写 `domain.xxx(App.state(), ...)` 之后再 `Store.saveState(App.state())` —— 变更会丢。先 `var st = App.state()` 存引用。
2. `location.hash` 赋同一个值**不触发** `hashchange`，页面会停在旧 DOM。改完数据要显式 `App.reload()`。
3. `ctx.state` 是进入页面那一刻的快照。页面内做长时间操作后要 `Store.loadState()` 重新取。
4. 供应商工作台的分桶必须「一单只归一档」（用单值 `classify(o)`），不要每个页签各自写判断条件，否则一单会同时出现在多个页签里，顶部数字对不上。
5. 结算阶段订单里各分项已是 `accepted`，但**不能用分项状态给用户显示「已完成」**，要看订单状态。
6. `guide.js` 里别用 `.grow` 当行容器 —— `app.css:158` 已把 `.grow` 定义为 `flex:1`，会破版。用 `.grow-row` / `.gcol`。
7. 改 `h5/js/pages/*.js` 后忘了跑 `standalone`，单文件版就是旧的 —— 对外演示前记得重生成。

---

## 10. 可直接复制的开场提示词

> 你是这个项目的前端负责人。项目在附件里：一个纯静态的企业内部物资采购 H5（无框架、无构建、无 npm 依赖，IIFE + 全局对象 + 模板字符串渲染）。先读 `HANDOFF_CHATGPT.md` 和 `h5/README.md`，再读你要改的那个页面文件。
>
> 请严格遵守：
> 1. `h5/js/biz.js` 是构建产物，**不要修改**。需要改业务规则时改 `miniprogram/utils/*.js` 或 `miniprogram/data/*.js`，并告诉我本地要跑 `npm run h5:build`。
> 2. `css/app.css` 里 `@media (min-width: 900px)` 桌面段必须保持文件末尾，新样式插在它之前。
> 3. 不引入任何依赖、不用 ES Module、不用 TS/JSX；页面输出用模板字符串，用户数据必须过 `UI.esc()`。
> 4. 状态写入走 `App.mutate(fn)`；业务判定放在 `BIZ.domain` / `BIZ.perm`，不要写进页面。
> 5. 移动优先（390px），再兼容 ≥900px 桌面布局。
>
> 输出要求：给出**完整文件内容**（不要只给片段或 diff），每个文件前面写明相对路径，例如 `h5/js/pages/orders.js`。改完列出你改了什么、影响了哪些页面、以及需要我在本地执行的命令。
>
> 我的需求是：<在这里写你要改什么>
