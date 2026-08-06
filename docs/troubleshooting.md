# Yamet 排障指南

> 简体中文。协议名/命令名/字段可保留英文。

## 平台相关

### Windows

- **首启「Windows 已保护你的电脑」**：Yamet 尚未代码签名，首次启动会显示未知发布者警告。点击**「更多信息」→「仍要运行」**即可。这是正常现象，不影响后续使用。
- **默认 shell 检测顺序**：`pwsh.exe`（PowerShell 7+）→ `powershell.exe`（Windows PowerShell 5.1）→ `cmd.exe`。
- **WSL 是一等公民**：每个标签页可独立选择 Local 或任意已安装 WSL 发行版作为工作区环境，不是包一层子进程。
- **创建符号链接报错**：Windows 上创建符号链接需要「开发者模式」或管理员权限（`os error 1314 客户端没有所需的特权`）。这与 Yamet 无关，是系统权限限制。

### Linux

- **Wayland 渲染花屏/空白**：若 AppImage 在 Wayland 下渲染异常，设环境变量 `WEBKIT_DISABLE_DMABUF_RENDERER=1` 再启动。
- **AppImage 需 FUSE**：未安装 FUSE 时用 `./Yamet_*.AppImage --appimage-extract-and-run`。
- **Arch / AUR**：`yay -S yamet-bin`（或 paru 等）。
- **NixOS / Nix**：用 flake（`nix profile install github:your-org/yamet`，或 `nixosModules.yamet`）。
- **系统 GTK 库**：`.deb` / `.rpm` 包链接系统 GTK，通常比 AppImage 更顺滑。

### macOS

- 使用原生红绿灯窗口控件（`USE_CUSTOM_WINDOW_CONTROLS` 关闭）。

## 调试与 AI

- **DAP 调试**：若提示「未找到调试适配器」，请先安装对应适配器：Python 用 `pip install debugpy`、Node 用 `npm install -g` 对应调试器。在侧栏「调试」视图「创建示例配置」会生成 `.yamet/launch.json`。
- **LSP 补全**：启用语言服务器见状态栏的语言徽标（启用/安装入口）。
- **AI 不可用**：确认已在 设置 → 模型 配置 API 密钥或本地端点（LM Studio / Ollama）。密钥存于系统钥匙串。
- **远程 / SFTP**：在侧栏「远程」视图填写 `user@host`，隧道用 `-L`（本地转发）/ `-R`（远程转发）。

## 其他

- **日志**：运行日志在终端输出（`--verbose` 可开更多）。日志时间戳为 UTC+8。
