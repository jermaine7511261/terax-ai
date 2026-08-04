// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Standalone MCP server mode: `yamet __mcp_server` (★ L1 LangBot). Runs
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
