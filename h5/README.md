# 安居乐寓物资采购管理系统 · H5 版（企业微信自建应用形态）

一套纯静态 H5，把小程序版的全部业务逻辑（门店下单 / 分级审批 / 部门采购 / 供应商接单发货 / 验收 / 对账 / 超时预警）跑在浏览器里，
目标是直接挂到企业微信「自建应用」的工作台里使用：员工点开即免登，供应商用单独的通讯录账号登录、只看得到自己的单。

业务规则不是重写的：`js/biz.js` 由小程序同一套纯逻辑模块（`miniprogram/utils/domain.js`、`perm.js`、`format.js`、
`data/catalog.js`、`data/seed.js`、`data/subcats.js`、`data/budget.js`）打包而来。改小程序规则、重跑一次构建，H5 自动跟随，不会出现两套口径。
**哪些会跟随、哪些需要手工同步，见第 3 节。**

---

## 1. 本地跑起来

任选一种（必须用 HTTP 打开，`file://` 下模块加载会受限）：

```bash
cd h5
python3 -m http.server 8899      # 然后访问 http://127.0.0.1:8899/index.html
# 或在仓库根目录
npm run h5:serve
```

首次打开是身份选择页（演示环境），选一个角色就能走完整流程。

### 演示身份直达

URL 加 `?as=<账号ID>` 可跳过选择页，方便演示与自测：

| 账号 ID | 角色 | 能做什么 |
| --- | --- | --- |
| `TEST-STORE-A` / `TEST-STORE-B` | 门店店长 | 下单、草稿、验收、撤销 |
| `TEST-REGION-A` / `TEST-REGION-B` | 战区负责人 | 本战区 500–2000 元审批 |
| `TEST-CENTRAL` | 运营管理部（中台） | 预算核定、部门批次确认、对账 |
| `TEST-DEPT-09` | 职能部门采购员 | 部门采购（统一由运营管理部确认） |
| `TEST-SUPPLIER-1` / `TEST-SUPPLIER-2` | 供应商 | 接单、登记发货、对账确认 |

例：`http://127.0.0.1:8899/index.html?as=TEST-SUPPLIER-1#/supplier`

---

## 2. 目录结构

```
h5/
├── index.html          单页壳：SVG 图标 sprite、侧栏/顶栏/底栏、脚本装配
├── css/app.css         全部样式（设计令牌 + 移动优先，≥900px 走桌面布局，桌面段放在文末）
├── build-biz.js        构建脚本：把小程序纯逻辑模块打包成 js/biz.js（支持 --watch / --check）
└── js/
    ├── config.js       运行配置（品牌、存储前缀、企业微信参数）—— 要改配置只改这里
    ├── biz.js          构建产物（勿手改）：BIZ.fmt/catalog/seed/subcats/budget/domain/perm
    ├── store.js        浏览器端持久化（购物车、草稿、审计、验收凭证、演示数据）
    ├── session.js      身份层：演示身份 + 企业微信免登适配
    ├── ui.js           通用 UI：toast / sheet / confirm / 状态胶囊 / 图片压缩 / 时间格式
    ├── app.js          路由（#/route/param?query）、渲染、导航徽标、App.mutate 保存
    └── pages/          15 个页面：login home catalog checkout orders order-detail
                        approvals supplier accept reports profile drafts budget guide settle
```

---

## 3. 小程序改了，H5 会跟着变吗？

**一句话：业务规则会自动跟随（重跑构建即可），界面和交互不会。**

### 会自动跟随（改完跑一次构建）

| 小程序文件 | H5 里的体现 |
| --- | --- |
| `utils/domain.js` | 状态机、金额分级、预算核定、缺口追加/调剂、验收、对账、超时判定 |
| `utils/perm.js` | 角色能力矩阵、底部 tab、可见订单范围 |
| `utils/format.js` | 金额、状态文案、时间格式 |
| `data/catalog.js` | 商品清单、价格、供应商、单位 |
| `data/subcats.js` | 二级分类归类规则（下单页左侧目录） |
| `data/seed.js` | 种子订单、演示账号、部门列表、供应商、SLA 时长 |
| `data/budget.js` | 费用科目（社群费/客户维护费/营销费）、房间数与系数、商品大类→科目的归类规则 |

```bash
npm run h5:build      # 重建 h5/js/biz.js（约 133 KB）
npm run h5:watch      # 开发时开着，改小程序 utils/ 或 data/ 下任何文件自动重建
npm run h5:check      # 检查产物是否已过期（过期退出码 1，适合接 CI / 发布前卡一道）
```

`--check` 用源文件内容指纹对比，不看时间戳：内容没变就不算过期；改完忘记重建会直接报
「h5/js/biz.js 已过期……H5 跑的仍是旧规则」。

构建器还会**自动收集依赖**：你在 `domain.js` 里新 `require('./xxx')` 一个纯逻辑模块，不用回来改 `build-biz.js`，
它会被自动打进包里；如果那个模块里有 `wx.*` 调用，构建会直接失败并告诉你是哪个文件——因为浏览器没有 `wx` 对象，
这种情况需要先把它拆成「纯逻辑 + 平台适配」两层（`utils/store.js`、`utils/session.js`、`utils/share.js` 就是平台相关的，永远不打包）。

### 不会跟随（要手工同步）

| 小程序 | H5 | 说明 |
| --- | --- | --- |
| `pages/*/*.wxml` `.wxss` `.js` | `h5/js/pages/*.js` + `css/app.css` | 页面是重写的（wxml → 模板字符串、wxss → CSS、Page → `Views.xxx(root, r, ctx)`） |
| `app.json` 的 tabBar / 路由 | `h5/js/app.js` 的 `NAV` / `TAB_OF` | 新增页面要在这里补一条 |
| `utils/store.js`（`wx.*Storage`） | `h5/js/store.js`（`localStorage`） | 语义一致，实现不同 |
| `utils/session.js`（微信登录态） | `h5/js/session.js`（演示身份 + 企业微信免登） | 契约都是 `{id,name,role,stores,zone,department,supplier}` |
| `utils/share.js`、`components/tabbar` | 无 | 小程序专有 |

**新增一个页面时，H5 侧要动三处**：`js/pages/xxx.js` 写视图 → `index.html` 加一行 `<script>` → `js/app.js` 注册路由与导航。
如果你改的是「同一页里的字段/文案」，只要它取自 `BIZ.domain`（订单字段、状态、金额），基本不用改 H5。

### 推荐习惯

1. 改小程序业务逻辑时，终端常开 `npm run h5:watch`（或至少改完手动 `h5:build`）。
2. 发布前跑 `npm run h5:check`，把「小程序已上线、H5 还是旧规则」这种事故拦在前面。

---

## 4. 数据与状态

- 全部数据存 `localStorage`，前缀 `anju_h5_`（小程序用 `anju_*`，互不干扰）。
- 结构版本号 `SCHEMA=3`；种子结构变更时改这个号，打开会自动重建演示数据。
- 订单流程口径：门店单提交后先「待战区审核」，通过后按预算/金额分级审批 → 供应商接单发货 → 验收；
  验收完成后进入「结算金额共同确认」（门店填报、供应商确认，异议会退回门店重提），双方确认后回到
  「结算已确认待对账」，最后由运营管理部在「统一对账」生成对账单并锁定。
- 「我的 → 演示工具」可切身份、看本地占用、一键重置数据。
- 这是**演示态**：多人协作、并发、服务端校验都还没有，正式上线必须接后端（见第 6 节）。

### 费用预算（门店 × 科目）

每个门店按三个费用科目分别记账：**社群费 / 客户维护费 / 营销费**，额度 = 管理房间数 × 科目系数
（当前每店 1000 间房、系数 10 元/间 → 每科目 ¥10,000、每店 ¥30,000）。订单按商品大类自动归科目，
一张单可跨科目分别占用额度；额度不足时由中台从机动池按科目追加或门店间同科目调剂。
运营管理部可在「预算设置」（侧栏或首页快捷入口）直接改房间数、单店系数、单项直接定额。

完整口径（含商品归类表、缺口处理、权限边界）见根目录 `README_费用预算.txt`。

---

## 5. 接入企业微信自建应用

### 5.1 企业微信后台

1. 应用管理 → 创建应用（自建），拿到 **AgentId** 与 **Secret**；在企业信息页拿到 **CorpID**。
2. 应用主页地址填：`https://<你的域名>/h5/index.html`（企业微信会在 URL 上追加 `?code=...`）。
3. 「网页授权及 JS-SDK」里登记**可信域名**：域名须已备案（ICP），并在域名根目录放企业微信给的校验文件。
4. 可见范围：先勾选全部使用部门；**供应商账号单独建一个部门（如「外部-运营物资供应商」），只把供应商应用可见范围勾给它**，
   内部员工看不到供应商账号，供应商也进不来内部页面（同一份前端，靠后端下发的 role 区分）。
5. 需要待办推送时，用应用 Secret 换 `access_token` 调 `message/send`（应用消息），把审批/接单提醒发到对应成员。

### 5.2 前端开关

只改 `js/config.js`：

```js
wecom: {
  enabled: true,                          // 打开后不再走演示身份选择
  corpid: 'ww********',
  agentId: '1000012',
  apiBase: 'https://purchase.example.com/api',
  entryPath: '/auth/wecom'
}
```

打开后：页面带 `?code=` 打开 → 前端请求 `GET {apiBase}{entryPath}?code=xxx` → 后端返回身份 → `Session.current()` 口径不变，
**页面代码一行都不用改**；同一会话内刷新会复用 `localStorage` 里缓存的身份。

### 5.3 后端契约（需要你们后端实现）

```
GET /api/auth/wecom?code=<企业微信回调 code>

200 {
  "profile": {
    "id": "zhangsan",              // 企业微信 userid
    "name": "张三",
    "role": "store",               // store | region | central | department | supplier
    "zone": "第一战区",             // region 必填
    "stores": ["安居瑞龙苑店"],      // store 必填（可多店）
    "department": "人力资源部",      // department 必填
    "supplier": "运营物资供应商（演示）" // supplier 必填
  }
}
4xx { "message": "不在授权范围" }     // 前端会把 message 显示在「我的 → 企业微信接入」里
```

后端要做三件事：

1. `code` 换 `access_token` 再调 `user/getuserinfo` 拿 userid（企业微信接口，Secret 只放后端）。
2. 按 userid 查组织架构 → 映射成上面的 role/范围（建议直接在后台维护一张「成员 → 角色/门店/战区/部门/供应商」表）。
3. **权限在服务端兜底**：前端 `perm.js` 只负责隐藏入口，任何写接口都要按 role 再校验一次（供应商不能看到别家订单、
   门店不能看别的门店预算、金额分级审批不能跳级）。

---

## 6. 从演示态到正式态

当前 H5 是「能跑的演示版」：数据在本机、审批是前端推进状态机。正式上线前按这个顺序替换：

| 现在 | 替换为 |
| --- | --- |
| `Store.load*/save*`（localStorage） | REST/接口网关：`GET/POST /api/orders`、`/api/cart`、`/api/drafts` … |
| `App.mutate(st, me)` 本地推进状态 | 服务端状态机 + 事务（预算占用、批次、验收数量要原子扣减） |
| 本机审计/凭证 | 服务端审计表 + 对象存储（验收照片、发货凭证） |
| 演示身份选择页 | 企业微信免登（第 5 节） |

好处是替换面很窄：页面只依赖 `Store`、`Session`、`App.mutate` 三个入口，业务判定都在 `BIZ.domain`/`BIZ.perm` 里。

---

## 7. 界面

- 移动优先，390px 起；≥900px 自动切桌面布局（左侧固定导航 + 双列列表 + 下单页双列商品）。
- 底部 tab 按角色变：店长「首页/采购下单/我的订单/我的」，中台「首页/待办审批/统计看板/统一对账」，
  供应商「首页/供应商工作台/我的」，职能部门「首页/采购下单/我的订单/我的」。
- 固定操作条（提交/通过/接单）在移动端吸底，桌面端落到内容底部右对齐。
- 样式约定：`@media (min-width: 900px)` 的桌面段**统一放 `app.css` 末尾**——中间追加基础样式会用同优先级盖掉它。

### 开发辅助文件（不必部署）

- `_fixture.html`：注入一笔 ¥30,270 的订单（充电宝×200 + 保温杯×85）停在中台核定，用来演示「机动预算不足 → 追加/调剂」；
  加 `?s=supplier` 则改成供应商待接单并直达供应商工作台。
- `probe.html` / `shot.html`：无头浏览器截图与尺寸探针，仅本地自测用。

---

## 8. 自测清单（已跑通）

- 6 演示身份 × 21 路由，在 390px 与 1280px 两个视口各跑一遍（共 252 次检查），无脚本异常、无横向溢出、无空视图、无弹层残留。
- 主链路（含新流程）：门店下单 → **战区审核（order-review）** → 按金额/预算分级 → 供应商接单 → 登记发货（顺丰单号）→
  门店拍照验收（可部分验收）→ **结算金额共同确认**（门店填报、有差异必填原因 → 供应商确认 / 提出异议退回重提）→ 待对账 → 生成对账单 → 锁定。
- 页面改动专项：分类栏再点收起（含「收起」入口）、订单筛选横排（单行横向滚动）、看板「战区金额」页签、
  「我的」采购说明入口（guide 页）、首页「待填写结算 / 待确认结算」待办、供应商工作台「结算确认」页签（每单只归一个页签）。
- 超时：审批 4h / 供应商 4h，超时标黄、再超时标红，首页与列表都有提示。
- 构建：`h5:build` / `h5:watch` / `h5:check` 三条命令均验证（改源文件后 `--check` 退出码 1，重建后恢复一致）。
- 回归脚本（本地，不入库）：`/tmp/h5-sweep.js`（全路由扫描）、`/tmp/h5-flow.js`（结算全流程 32 项断言）、
  `/tmp/h5-ui.js`（本轮 UI 改动 11 项断言）。
