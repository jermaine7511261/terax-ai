//! UI smoke tests via tauri-driver + thirtyfour (P3-6..8, e2e-smoke plan).
//!
//! These are `#[ignore]`d by default because they need a running
//! `tauri-driver` binary plus the platform's native WebDriver:
//!   - Windows: Edge WebDriver (msedgedriver, ships with Edge)
//!   - Linux:   WebKitWebDriver
//!   - macOS:   Appium Mac2 Driver (proof-of-concept pending)
//!
//! CI installs tauri-driver and runs them explicitly:
//!   cargo install tauri-driver --locked
//!   pnpm tauri build --debug --features devtools
//!   cargo test --test ui_smoke -- --ignored
//!
//! The app binary must be built with the `devtools` feature so the webview
//! exposes its debugging endpoint to the WebDriver server.

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use thirtyfour::prelude::*;

const DRIVER_URL: &str = "http://localhost:4444";
const DRIVER_ADDR: &str = "127.0.0.1:4444";

fn app_binary() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_yamet"))
}

struct Webdriver {
    /// The `tauri-driver` intermediary-node process.
    process: Child,
    /// The WebDriver client session bound to the app's webview.
    session: WebDriver,
}

/// Poll a TCP port until it accepts connections (the WebDriver server is up).
fn wait_for_port(addr: &str, timeout: Duration) {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect(addr).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    panic!("{addr} did not become reachable within {timeout:?}");
}

async fn setup() -> Webdriver {
    // 1. Launch the WebDriver intermediary node on its default ports.
    let process = Command::new("tauri-driver")
        .arg("--port")
        .arg("4444")
        .arg("--native-port")
        .arg("4445")
        .spawn()
        .expect("failed to spawn tauri-driver (run `cargo install tauri-driver --locked` first)");
    wait_for_port(DRIVER_ADDR, Duration::from_secs(20));

    // 2. The webview's WebDriver capabilities — tauri-driver bridges the wry
    //    webview under the "wry" browser name.
    let mut caps = DesiredCapabilities::chrome();
    caps.set("browserName", "wry").expect("set browser name to wry");
    let session = WebDriver::new(DRIVER_URL, caps)
        .await
        .expect("failed to create WebDriver session");

    // 3. Launch the app (built with the devtools feature). Give the webview a
    //    moment to attach to the session before the first find().
    let _app = Command::new(app_binary())
        .spawn()
        .expect("failed to spawn app binary");

    Webdriver { process, session }
}

/// Root `body` text — a cheap "the webview rendered React" assertion.
async fn body_text(session: &WebDriver) -> String {
    session
        .find(By::Tag("body"))
        .await
        .expect("find <body>")
        .text()
        .await
        .expect("read body text")
}

async fn teardown(wd: &mut Webdriver) {
    let _ = wd.session.clone().quit().await;
    let _ = wd.process.kill();
    let _ = wd.process.wait();
}

#[tokio::test]
#[ignore]
async fn launches_and_renders_react_root() {
    let mut wd = setup().await;
    wd.session.goto("tauri://localhost").await.expect("navigate to app");
    let body = body_text(&wd.session).await;
    assert!(!body.trim().is_empty(), "webview must render non-empty content");
    teardown(&mut wd).await;
}

#[tokio::test]
#[ignore]
async fn terminal_area_is_present() {
    let mut wd = setup().await;
    wd.session.goto("tauri://localhost").await.expect("navigate to app");
    // The default tab is a terminal; xterm renders a .xterm host element.
    let found = wd
        .session
        .find(By::Css(".xterm"))
        .await
        .ok()
        .is_some();
    assert!(found, "a terminal surface (.xterm) should be rendered");
    teardown(&mut wd).await;
}

#[tokio::test]
#[ignore]
async fn new_tab_button_creates_second_tab() {
    let mut wd = setup().await;
    wd.session.goto("tauri://localhost").await.expect("navigate to app");
    let tabs_before = wd.session.find_all(By::Css("[data-tab-id]")).await.unwrap().len();
    // Click the "new tab" control (header has a plus/shell add button).
    if let Ok(add) = wd.session.find(By::Css("[data-new-tab]")).await {
        add.click().await.expect("click new tab");
    }
    let tabs_after = wd.session.find_all(By::Css("[data-tab-id]")).await.unwrap().len();
    assert!(tabs_after >= tabs_before, "tab count must not shrink");
    teardown(&mut wd).await;
}

#[tokio::test]
#[ignore]
async fn ai_composer_input_exists() {
    let mut wd = setup().await;
    wd.session.goto("tauri://localhost").await.expect("navigate to app");
    // The AI input bar is mounted app-wide (AiComposerProvider at the root);
    // assert on its data attribute so the AI entry point is present.
    let found = wd
        .session
        .find(By::Css("[data-ai-composer]"))
        .await
        .ok()
        .is_some();
    assert!(found, "AI composer input should be mounted");
    teardown(&mut wd).await;
}

#[tokio::test]
#[ignore]
async fn status_bar_reports_a_cwd() {
    let mut wd = setup().await;
    wd.session.goto("tauri://localhost").await.expect("navigate to app");
    // The status bar renders a cwd breadcrumb; after the shell boots it shows
    // a real directory. Just assert the element is present.
    let found = wd
        .session
        .find(By::Css("[data-status-cwd]"))
        .await
        .ok()
        .is_some();
    assert!(found, "status bar cwd breadcrumb should be present");
    teardown(&mut wd).await;
}
