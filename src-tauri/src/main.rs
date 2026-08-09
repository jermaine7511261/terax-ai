// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Standalone MCP server mode: `YaMet __mcp_server` (★ L1). Runs
    // before the Tauri runtime so external agents (Claude Code etc.) can
    // spawn us as a stdio MCP server; `YAMET_MCP_CWD` overrides the workspace.
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("__mcp_server") {
        let cwd = std::env::var("YAMET_MCP_CWD")
            .ok()
            .filter(|s| !s.is_empty())
            .or_else(|| std::env::current_dir().ok().map(|p| p.to_string_lossy().into_owned()))
            .unwrap_or_default();
        yamet_lib::mcp_server_run(&cwd);
        std::process::exit(0);
    }

    // Detached PTY helper mode: hosts portable-pty sessions so they survive a
    // main-process restart (I1c). Spawned by pty_helper_start with the token
    // in YAMET_PTY_HELPER_TOKEN; never reaches the Tauri runtime.
    if args.get(1).map(String::as_str) == Some("--pty-helper") {
        yamet_lib::pty_helper_run();
        std::process::exit(0);
    }

    // CLI agent front-end (round 25 补齐): `YaMet --prompt "..."` streams a
    // single-turn chat completion to stdout. Runs before the Tauri runtime so
    // it works headless; exit code is 0 on success, 1 on error.
    if args.iter().any(|a| a == "--prompt") {
        let opts = match yamet_lib::cli::parse_prompt_args(&args) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("[YaMet cli] {e}");
                std::process::exit(2);
            }
        };
        std::process::exit(yamet_lib::cli::run_prompt(&opts));
    }

    #[cfg(target_os = "macos")]
    {
        // Disable macOS press-and-hold character popup, so key repeat works in terminal.
        use objc2::msg_send;
        use objc2_foundation::{ns_string, NSUserDefaults};
        unsafe {
            let defaults = NSUserDefaults::standardUserDefaults();
            let key = ns_string!("ApplePressAndHoldEnabled");
            let _: () = msg_send![&defaults, setBool: false, forKey: key];
        }
    }

    yamet_lib::run()
}
