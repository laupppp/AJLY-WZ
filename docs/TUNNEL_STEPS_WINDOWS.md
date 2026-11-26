# 内网穿透落地步骤：Windows 本机服务 → 门店远程访问

> 前置条件：已按 `SHARED_TRIAL_WINDOWS.md` 第三节把服务端跑起来，
> 本机 `http://127.0.0.1:3010/` 能正常打开系统。
>
> 适用范围：**只发链接给门店用**（不是接入企微工作台）。工作台仍需公司主体备案域名 + 免登改造。

---

## 0. 先记住四个固定值

| 项 | 值 |
|---|---|
| 内网主机 | `127.0.0.1` |
| 内网端口 | `3010` |
| 本地协议 | HTTP（HTTPS 由隧道端负责，本机不用配证书） |
| 数据目录 | 项目文件夹旁边的 `ajly-shared-data\` |

**两个前提，别踩坑：**

1. 服务只监听 `127.0.0.1`（见 `server\start-windows.bat`），所以**穿透客户端必须装在同一台电脑**。
   这样做的好处是 Windows 防火墙不用放行任何端口，攻击面更小。
2. `server/app.js` 在返回 `/js/config.js` 时会自动把前端切成 remote（共享）模式，
   所以只要访问地址最终指到这台 3010 服务，门店看到的就是**同一份数据**；
   直接双击 `standalone.html` 或打开 GitHub Pages 地址则是各自独立的演示数据。

---

## 路线一：今天就能跑通（Cloudflare Quick Tunnel，零成本）

免账号、免实名、免域名，自动 HTTPS。适合「先验证外面到底能不能连」。

**1. 装 cloudflared**（管理员 PowerShell，二选一）

```powershell
winget install --id Cloudflare.cloudflared
```

或从 GitHub 下载 `cloudflared-windows-amd64.exe` 放到 `D:\AJLY-WZ\tools\`：
`https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe`

**2. 保持服务端窗口开着**（双击 `server\start-windows.bat`，别关）。

**3. 另开一个 PowerShell 建隧道**

```powershell
cd D:\AJLY-WZ
.\tools\cloudflared-windows-amd64.exe tunnel --url http://127.0.0.1:3010
```

winget 安装的话命令是 `cloudflared tunnel --url http://127.0.0.1:3010`。

**4. 记下输出里的地址**，形如 `https://xxxx-yyyy.trycloudflare.com`。

**5. 拼上令牌发给门店**

```
https://xxxx-yyyy.trycloudflare.com/?token=<某人的token>#/home
```

token 从 `ajly-shared-data\accounts.txt` 里取，**一人一个、单独发、别发群里**。

**6. 验证**：手机关掉 WiFi、用 4G 打开链接；A 下一单，B 的手机应在 4 秒内看到。

**必须知道的限制：**

- **每次重启这条命令，地址都会变**（不是定时变，是重建就变）→ 不能写死在群公告或收藏里
- 最多 200 个并发请求、不支持 SSE；本项目是 4 秒轮询，不受影响
- 无可用性保证，国内晚高峰偏慢，偶发人机校验
- 关掉窗口 / 电脑睡眠，服务立刻断

结论：**只适合临时演示和自测，不适合发给门店天天用。**

---

## 路线二：发给门店长期用（国内穿透服务，个人实名 + 几十元/年）

花生壳、cpolar、NATAPP、PassNAT 流程基本一致，下面以**花生壳 / cpolar** 为例任选一家。

**1. 注册账号**：个人手机号即可，**不需要公司营业执照、不需要公司 IT 介入**。

**2. 完成实名认证**：国内节点强制实名（花生壳要求注册后 15 天内完成，否则赠送域名会锁定）。
用个人身份证即可，这一步不占公司资源。

**3. 安装 Windows 客户端**：装在**跑服务的那台电脑**上，登录账号。

**4. 领 / 买一个固定二级域名**

- 免费档：送一个随机壳域名（花生壳有效期 1 年），带宽约 1 Mbps、月流量 1 GB
- 建议直接上低价档拿固定地址：cpolar 基础版约 99 元/年（2 Mbps 不限流量），
  花生壳体验版免费但流量偏紧，NATAPP VIP 约 9 元/月起
- 价格以官网为准，个人出资即可，不走公司采购

**5. 添加一条映射**（关键参数照填）

| 字段 | 填什么 |
|---|---|
| 应用名称 | 安居采购 |
| 映射类型 / 协议 | **HTTPS**（网站应用），云端自动签发证书，本地 3010 保持 http |
| 内网主机 | `127.0.0.1` |
| 内网端口 | `3010` |
| 外网域名 | 上一步领到的固定域名 |

保存后诊断应显示「连接成功」，记下外网地址，例如 `https://ajly.xxx.cn`。

**6. 自己先验一遍**（手机 4G，关 WiFi）

```
https://ajly.xxx.cn/api/health     → 应返回 {"ok":true,"revision":N}
https://ajly.xxx.cn/               → 应能打开系统首页
```

**7. 分发一次性链接**：从 `accounts.txt` 取每人 token，单独发

```
https://ajly.xxx.cn/?token=<他的token>#/home
```

提醒对方不要转发链接。也可以只发首页地址，让对方自己粘贴 token 登录。

---

## 常见排错

| 现象 | 原因 / 处理 |
|---|---|
| 诊断「连接成功」但外网打不开 | 穿透客户端和 node 服务不在同一台电脑。若确实分开部署，把 `start-windows.bat` 里 `AJLY_HOST` 改成 `0.0.0.0`，内网主机填这台电脑的局域网 IP（如 `192.168.1.20`），并放行防火墙 3010 |
| 打开后是演示版、各看各的数据 | 地址没指到 3010 服务（点了 standalone.html 或 Pages 地址）。确认走的是隧道地址 |
| 上传验收照片很慢 / 失败 | 免费 1 Mbps、1 GB 月流量偏紧，升带宽档或压缩图片后再传 |
| 企微里提示「非可信域名 / 风险提示」 | 只是发链接属正常现象，不影响打开；要去掉提示、做免登才需要公司主体备案域名 |
| 手机能开但 4 秒不同步 | 看 `/api/health` 的 revision 是否递增；检查服务端窗口是否被关掉 |

---

## 让它一直在线（两处自启，缺一不可）

1. **服务端**：管理员 PowerShell 执行一次

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\server\setup-tasks.ps1
   ```

   建两个计划任务：登录后 30 秒启动服务、每天 02:00 在线备份。

2. **穿透客户端**：花生壳 / cpolar 客户端里打开「开机自启 / 后台服务」开关；
   若用 cloudflared，需自己用计划任务或 nssm 包一层并配掉线重连。

3. 电源选项改「**从不睡眠**」，电脑保持登录状态、不断网。

4. 每周把 `shared-backup-*.sqlite` 拷到 U 盘或网盘 —— 目前只有本机备份。

---

## 验证清单（打勾用）

- [ ] 本机 `http://127.0.0.1:3010/` 能打开
- [ ] `/api/health` 返回 `{"ok":true,...}`
- [ ] 手机 4G（关 WiFi）能打开外网地址
- [ ] 用 A 的 token 下单，B 的手机 4 秒内看到
- [ ] 重启电脑后，服务与隧道都自动回来
- [ ] `ajly-shared-data\` 里每天有新的备份文件

---

## 发给领导前先过一遍

1. **令牌一人一个**，`credentials.json` / `accounts.txt` 绝不外发；拿到令牌就能以该身份操作。
2. **业务数据经第三方节点转发**（采购金额、供应商、门店信息），正式上线前需过公司信息安全审批。
3. **这是试点不是生产**：单机、无监控、无异地备份、无 UPS，断电或断网就停。
4. **这条路线不等于接入企微工作台**。工作台图标 + 免登仍需公司主体备案域名，
   但同样不需要公司服务器 —— 逻辑见 `SHARED_TRIAL_WINDOWS.md` 第二节。
