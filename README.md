# 安居乐寓物资采购管理系统

[![校验](https://github.com/laupppp/AJLY-WZ/actions/workflows/verify.yml/badge.svg)](https://github.com/laupppp/AJLY-WZ/actions/workflows/verify.yml)

主要安居乐寓各类物资管理，覆盖门店选品下单、内部审批、供应商接单配送、门店拍照验收，到后续对账结算的完整流程。同时也设置了各门店采购预算管理，以及战区总、中台等不同层级的审批和管控权限，后续可以实现物资采购全流程线上管理。

技术形态：企业内部物资采购系统的 **H5 版**（可直接挂企业微信自建应用）＋ 与之共用同一份业务规则的微信小程序源码。
纯静态前端：**无框架、无构建、无 npm 依赖**，浏览器打开即用。

- H5 演示：`h5/standalone.html`（单文件版，双击或 GitHub Pages 直开）
- 小程序：`miniprogram/`（微信开发者工具导入，需在 `project.config.json` 里换自己的 AppID）

## 业务链路

```
门店/部门下单 → 战区审核 →（超预算）运营管理部核定 → 金额分级审批
  → 供应商接单/发货 → 门店收货验收 → 结算金额门店与供应商共同确认
  → 统一对账 → 锁定
```

| 角色 | 能做什么 |
| --- | --- |
| 门店店长 | 下单、草稿、撤销、收货验收、填写结算金额 |
| 战区负责人 | 本战区门店单审核（必要性/合规性）、500–2000 元金额审批 |
| 运营管理部（中台） | 中台操作台（物资增删改/合同上限/审批规则）、预算核定、部门确认、超 2000 元审批、统一对账 |
| 职能部门 | 部门采购、验收、填写结算金额 |
| 供应商 | 接单/拒单、分批发货登记、确认结算金额 |

## 本地运行

```bash
npm run h5:serve        # http://127.0.0.1:8899/index.html
```

演示身份直达：`?as=<账号ID>`

| 账号 ID | 角色 |
| --- | --- |
| `TEST-STORE-A` / `TEST-STORE-B` | 门店店长 |
| `TEST-REGION-A` / `TEST-REGION-B` | 战区负责人 |
| `TEST-CENTRAL` | 运营管理部（中台） |
| `TEST-DEPT-01` | 职能部门采购员 |
| `TEST-SUPPLIER-1` / `TEST-SUPPLIER-2` | 供应商 |

例：`http://127.0.0.1:8899/index.html?as=TEST-SUPPLIER-1#/supplier`

## 在线预览与自动化

仓库已配好两条 GitHub Actions：

| 工作流 | 触发 | 做什么 |
| --- | --- | --- |
| **校验** | 每次 push / PR | `biz.js` 指纹比对、`standalone.html` 过期检测、50 个 JS 语法检查、业务逻辑单元测试 |
| **部署 H5 到 Pages** | push 且改动 `h5/**` | 先校验产物，过期直接中止；再用 rsync 排除调试文件，把 `h5/` 作为站点根发布 |

**Pages 需先手动开启一次**：仓库 → Settings → Pages → Source 选 `GitHub Actions`。之后访问：

```
https://laupppp.github.io/AJLY-WZ/
```

Pages 发布的是**仓库里已提交的产物**，所以改了源码要先在本地 `npm run h5:build`、必要时再 `npm run h5:standalone`，连同产物一起提交。部署任务会先跑校验，产物过期就中止，不会把旧版本发上线。

## 目录

```
h5/                      H5 前端（全部代码）
├── index.html           单页壳
├── standalone.html      单文件产物（全部 CSS/JS 内联，双击可开）
├── css/app.css          全部样式（移动优先，≥900px 桌面段在文件末尾）
├── build-biz.js         构建：miniprogram/{utils,data} → js/biz.js
├── build-standalone.js  构建：多文件 → standalone.html（带 --check 模式）
├── check-syntax.js      校验：h5 + miniprogram 全部 JS 的语法
└── js/
    ├── biz.js           ★构建产物（勿手改）：业务规则唯一来源
    ├── store.js         localStorage 持久化
    ├── session.js       身份（演示身份 + 企业微信免登适配）
    ├── ui.js            toast/sheet/状态胶囊/图标/金额
    ├── app.js           hash 路由、渲染、导航徽标
    └── pages/           16 个页面（含中台操作台 console.js）
miniprogram/
├── utils/               domain（状态机/预算/结算）、perm、format —— H5 与小程序共用
├── data/                catalog（278 项物资）、seed、subcats、budget、rules
└── pages/               小程序 15 个页面（与 H5 业务页对应）
tests/
└── domain.test.js       业务逻辑单元测试（node:test）
docs/
└── OPTIMIZATION_GUIDE.md 优化改动说明与中台操作台使用指南
.github/workflows/
├── verify.yml           推送即校验产物、语法与单元测试
└── pages.yml            部署 h5/ 到 GitHub Pages
```

## 命令

```bash
npm run h5:serve        # 本地起服务 http://127.0.0.1:8899/index.html
npm run h5:verify       # 产物一致 + 语法检查
npm run h5:build        # 重建 biz.js（改了 miniprogram 才需要）
npm run h5:check        # 只检查 biz.js 是否过期（过期退出码 1）
npm run h5:watch        # 监听源文件自动重建
npm run h5:standalone   # 重新生成单文件版 standalone.html
npm run h5:lint         # 全量 JS 语法检查
npm run test:unit       # 运行业务逻辑单元测试
npm test                # 产物一致 + 语法检查 + 单元测试
```

## 数据说明

演示态：全部数据存浏览器 `localStorage`（前缀 `anju_h5_`），无后端、无账号体系。
正式上线需要后端（企业微信免登换身份、订单状态机、预算占用的原子扣减），
接口契约与替换点见 [`h5/README.md`](h5/README.md) 第 5、6 节。

## 文档

- [`h5/README.md`](h5/README.md) —— H5 架构、构建机制、企业微信接入、上线替换清单
- [`HANDOFF_CHATGPT.md`](HANDOFF_CHATGPT.md) —— 交接说明：代码约定、状态机口径、常见改动配方、已知坑
- [`docs/OPTIMIZATION_GUIDE.md`](docs/OPTIMIZATION_GUIDE.md) —— 流程优化、缺陷修复与中台操作台使用说明
