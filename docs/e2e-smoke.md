# E2E 冒烟测试（端到端）

## 现状

- **无 GUI 的进程级冒烟**（已落地，零额外依赖，进 `cargo test`）：
  `src-tauri/tests/cli_entry.rs` 启动真实二进制，走 `__mcp_server` 分支完成
  JSON-RPC 握手并验证干净退出。CI 三平台矩阵都会跑。
- **UI 级冒烟**（未落地）：需要 tauri-driver + WebDriver 浏览器 + 显示环境，
  本机开发环境（受限 shell、无 GUI）无法执行，仅提供方案。

## UI 冒烟方案（tauri-driver）

1. 安装驱动：
   ```bash
   cargo install tauri-driver
   # Linux: sudo apt-get install -y xvfb chromium-chromedriver
   # Windows: Edge WebDriver (msedgedriver) 或 chromedriver
   ```
2. 冒烟测试骨架（`src-tauri/tests/ui_smoke.rs`，用 `thirtyfour` 客户端）：
   ```rust
   // #[ignore] 默认不跑：cargo test -- --ignored ui_smoke
   use thirtyfour::prelude::*;

   #[tokio::test]
   #[ignore]
   async fn app_launches_and_renders() -> WebDriverResult<()> {
       // tauri-driver 已在 4444 端口起服务（tauri.conf.json 的
       // tauri > devtools + capabilities 需开 webdriver 权限）
       let caps = DesiredCapabilities::chrome();
       let driver = WebDriver::new("http://localhost:4444", caps).await?;
       driver.get("tauri://localhost").await?;
       // 断言主窗口渲染出终端/编辑器骨架
       assert!(driver.find(By::Tag("body")).await?.is_displayed().await?);
       driver.quit().await
   }
   ```
3. CI（`ci.yml` 新增 job，Linux 用 xvfb-run）：
   ```yaml
   e2e-smoke:
     runs-on: ubuntu-22.04
     steps:
       - uses: actions/checkout@v7
       - run: sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev xvfb chromium-chromedriver
       - uses: dtolnay/rust-toolchain@stable
       - uses: taiki-e/install-action@v2
         with: { tool: tauri-driver }
       - run: pnpm install --frozen-lockfile
       - name: Start dev app + driver
         run: xvfb-run -a pnpm tauri dev &
       - name: Run UI smoke
         working-directory: src-tauri
         run: cargo test --test ui_smoke -- --ignored
   ```

## 验收标准

- [x] 进程级：`yamet __mcp_server` 握手 + 干净退出（`tests/cli_entry.rs`）
- [ ] UI 级：窗口渲染、开终端出 prompt、AI 面板打开（tauri-driver 骨架待落）
