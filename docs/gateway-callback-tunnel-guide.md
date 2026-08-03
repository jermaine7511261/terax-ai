# 企微 / 公众号回调隧道使用指南

Yamet 网关的**企业微信（wecom）**与**微信公众号（official_account）**两个平台
依赖公网可访问的回调 URL：微信服务器需要主动把事件（消息、验签）POST 到你的
服务端。开发者在本地运行 Yamet 时没有公网 IP，因此需要一条**隧道**把本地回调
端口暴露到公网。

本文给出两种常用方案的完整配置：**frp**（自建，稳定、可控）与 **ngrok**
（免费、零配置，适合临时调试）。

---

## 一、回调服务器在哪儿？

Yamet 本身不内嵌公网回调服务器 —— 网关把回调相关配置（`token` /
`encoding_aes_key`）保存到凭据里，真正的回调校验与事件处理在后续版本接入时
复用这些配置。本文档说明的是**隧道本身**如何把「微信 → 你的本地 Yamet 进程」的
链路打通，供回调功能落地时直接使用。

约定：假设你的本地回调端口是 **`8787`**（可在配置中调整），回调路径为
`/callback`。

---

## 二、方案 A：frp（自建内网穿透）

需要一个有公网 IP 的服务器（VPS）运行 frps 服务端，本地运行 frpc 客户端。

### 1. 服务端（公网服务器）`frps.toml`

```toml
bindPort = 7000

# 鉴权（务必设置，避免被滥用）
auth.method = "token"
auth.token = "YOUR_RANDOM_TOKEN"

# 允许本地客户端映射公网端口到指定范围
allowPorts = [{ start = 8000, end = 9000 }]
```

启动：`frps -c frps.toml`

### 2. 客户端（本机）`frpc.toml`

```toml
serverAddr = "你的公网服务器IP"
serverPort = 7000

auth.method = "token"
auth.token = "YOUR_RANDOM_TOKEN"

[[proxies]]
name = "yamet-wecom-callback"
type = "tcp"
localIP = "127.0.0.1"
localPort = 8787
remotePort = 8787
```

启动：`frpc -c frpc.toml`

### 3. 微信后台填写的回调 URL

```
http://你的公网服务器IP:8787/callback
```

### 4. 验证

浏览器访问 `http://你的公网服务器IP:8787/callback`，应能看到 Yamet 回调端点的
响应（未配置成功时会返回错误提示，但「能通」即说明隧道已建立）。

---

## 三、方案 B：ngrok（免费临时隧道）

无需服务器，一条命令即可。注册后可获得稳定的免费域名。

### 1. 安装并登录

```bash
# Windows (choco) / macOS (brew) / Linux
choco install ngrok   # 或 brew install ngrok / 直接下载二进制
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
```

### 2. 暴露本地回调端口

```bash
ngrok http 8787
```

输出会给出一个公网地址，例如 `https://abcd-123.ngrok-free.app`。

### 3. 微信后台填写的回调 URL

```
https://abcd-123.ngrok-free.app/callback
```

> 免费 ngrok 域名会随进程重启变化；如需固定地址请购买域名或使用 frp。

---

## 四、常见问题

| 问题 | 原因 / 解法 |
|---|---|
| 微信后台提示「URL 不合法 / 校验失败」 | 回调路径或端口填错；确认隧道已启动且本地端口匹配 |
| 能访问但验签失败 | `token` / `encoding_aes_key` 与微信后台填写的**完全一致**（含大小写） |
| ngrok 免费域名变化 | 每次重启后重新复制新 URL 到微信后台，或改用 frp |
| 本地防火墙拦截 | 放行本地回调端口 `8787` 的入站（仅对本机进程无需额外放行） |
| 隧道被滥用 | frp 务必设置 `auth.token` 并限制 `allowPorts` 范围 |

---

## 五、安全建议

1. **不要**把回调服务器暴露在任意公网端口长期运行；调试完用 frp 时关闭映射。
2. `token` 与 `encoding_aes_key` 属于敏感凭据 —— Yamet 会存入系统 keychain，
   不会明文写盘。
3. 若使用公网隧道，建议在微信后台只勾选所需的回调事件类型，减少攻击面。
