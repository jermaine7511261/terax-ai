pub mod modules;
pub use modules::cli;

use modules::{agent, ai, computer, dap, fs, gateway, git, history, lsp, mcp, mcp_server, net, proc, pty, pty_helper, scheduler, secrets, shell, ssh, window, workspace};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri::{PhysicalPosition, WindowEvent};
use tauri_plugin_window_state::StateFlags;

/// Drained on first read so HMR / re-mounts can't replay the launch dir.
#[derive(Default)]
struct LaunchDir(Mutex<Option<String>>);

/// Standalone MCP server entry (`yamet __mcp_server`): serves read-only
/// workspace tools to external agents over stdio JSON-RPC (★ L1).
pub fn mcp_server_run(cwd: &str) {
    mcp_server::run_server(std::path::Path::new(cwd))
}

/// Detached PTY helper entry (`yamet --pty-helper`): hosts portable-pty
/// sessions outside the main process so they survive a restart (I1c).
pub fn pty_helper_run() {
    install_console_logger();
    let token = std::env::var("YAMET_PTY_HELPER_TOKEN").unwrap_or_default();
    let state_file = pty_helper::state_file_path();
    if let Err(e) = pty_helper::run_helper(token, state_file) {
        eprintln!("pty helper error: {e}");
        std::process::exit(1);
    }
}

// The helper runs outside Tauri (no tauri-plugin-log), so wire the `log`
// facade to stderr so log::info!/warn! calls are visible.
fn install_console_logger() {
    struct ConsoleLogger;
    impl log::Log for ConsoleLogger {
        fn enabled(&self, _: &log::Metadata<'_>) -> bool {
            true
        }
        fn log(&self, record: &log::Record<'_>) {
            eprintln!("[{}] {}", record.level(), record.args());
        }
        fn flush(&self) {}
    }
    static LOGGER: ConsoleLogger = ConsoleLogger;
    let _ = log::set_logger(&LOGGER);
    log::set_max_level(log::LevelFilter::Info);
}

/// Drained on first read so HMR / re-mounts can't replay the launch files.
#[derive(Default)]
struct LaunchFiles(Mutex<Vec<String>>);

#[tauri::command]
fn get_launch_dir(state: State<'_, LaunchDir>) -> Option<String> {
    state.0.lock().unwrap_or_else(|e| e.into_inner()).take()
}

#[tauri::command]
fn get_launch_files(state: State<'_, LaunchFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap_or_else(|e| e.into_inner()))
}

enum LaunchEntry {
    Dir(PathBuf),
    File(PathBuf),
}

#[derive(Default, Debug, PartialEq)]
struct LaunchTarget {
    dir: Option<String>,
    files: Vec<String>,
}

/// First dir arg (else the first file's parent) becomes the workspace; every
/// file arg is opened. Kept free of fs/env access so it stays unit-testable.
fn resolve_launch_target(entries: Vec<LaunchEntry>) -> LaunchTarget {
    let mut dir = None;
    let mut files = Vec::new();
    for entry in entries {
        match entry {
            LaunchEntry::Dir(path) => {
                if dir.is_none() {
                    dir = Some(fs::to_canon(&path));
                }
            }
            LaunchEntry::File(path) => {
                if dir.is_none() {
                    dir = path.parent().map(fs::to_canon);
                }
                files.push(fs::to_canon(&path));
            }
        }
    }
    LaunchTarget { dir, files }
}

fn parse_launch_target() -> LaunchTarget {
    let entries = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| std::fs::canonicalize(arg).ok())
        .filter_map(|path| {
            let meta = std::fs::metadata(&path).ok()?;
            Some(if meta.is_dir() {
                LaunchEntry::Dir(path)
            } else {
                LaunchEntry::File(path)
            })
        })
        .collect();
    resolve_launch_target(entries)
}

#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle, tab: Option<String>) -> Result<(), String> {
    let url_path = match tab.as_deref() {
        Some(t) if !t.is_empty() => format!("settings.html?tab={}", t),
        _ => "settings.html".to_string(),
    };

    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(t) = tab.as_deref().filter(|s| !s.is_empty()) {
            // emit() serializes via JSON — no string-escape footgun, unlike
            // eval() with format!(). Frontend listens via Tauri event API.
            let _ = window.emit("yamet:settings-tab", t);
        }
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(url_path.into()))
        .title("Settings")
        .inner_size(900.0, 700.0)
        .min_inner_size(820.0, 620.0)
        .resizable(true)
        .visible(false)
        // Keep settings above the main app window so it doesn't get hidden
        // when the user clicks back into the editor or terminal (#33).
        .always_on_top(true);

    // Tie lifecycle to the main window so settings minimizes/closes with it.
    // macOS: skip parent() — child + always_on_top leaves the settings webview
    // behind the main window except while the parent is being dragged (#33).
    #[cfg(not(target_os = "macos"))]
    let builder = if let Some(main) = app.get_webview_window("main") {
        builder.parent(&main).map_err(|e| e.to_string())?
    } else {
        builder
    };

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    // On Linux/Windows we render our own titlebar, so drop native chrome
    // and make the window transparent.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.decorations(false).transparent(true);

    let _window = builder.build().map_err(|e| e.to_string())?;

    // Some Linux compositors (GNOME/Mutter with CSD-by-default) ignore the
    // builder-time decorations flag — re-assert it after realize.
    #[cfg(target_os = "linux")]
    {
        let _ = window.set_decorations(false);
    }

    #[cfg(target_os = "macos")]
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(main_pos), Ok(main_size), Ok(settings_size)) = (
            main.outer_position(),
            main.outer_size(),
            window.outer_size(),
        ) {
            let x = main_pos.x
                + ((main_size.width as i32).saturating_sub(settings_size.width as i32)) / 2;
            let y = main_pos.y
                + ((main_size.height as i32).saturating_sub(settings_size.height as i32)) / 2;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        } else {
            let _ = window.center();
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    {
        let args: Vec<String> = std::env::args().collect();
        if args.get(1).map(String::as_str) == Some("__yamet_notify") {
            if let (Some(agent), Some(event)) = (args.get(2), args.get(3)) {
                agent::emit_conout_marker(agent, event);
            }
            use std::io::Write;
            let mut out = std::io::stdout();
            let _ = out.write_all(b"{}");
            let _ = out.flush();
            std::process::exit(0);
        }
    }

    let launch = parse_launch_target();
    let cli_dir = launch.dir.clone();
    workspace::init_launch_cwd(cli_dir.as_deref());

    let builder = tauri::Builder::default();
    #[cfg(target_os = "linux")]
    let builder = builder.plugin(tauri_plugin_clipboard_manager::init());
    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Skip restoring VISIBLE — frontend calls window.show() after first
        // paint so the user never sees a transparent window-shadow flash on
        // Windows/Linux.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Stdout,
                    ),
                    tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::LogDir {
                            file_name: Some("yamet".into()),
                        },
                    ),
                ])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Instantiate the IM gateway registry and register every platform
            // adapter (configs are filled in from the settings UI at runtime).
            let gateway_registry = gateway::registry::GatewayRegistry::new();
            gateway::adapters::register_all(&gateway_registry);
            // Restore credentials persisted in the OS file store so configured
            // platforms survive app restarts.
            let app_handle = app.handle().clone();
            gateway::adapters::restore_from_keychain(&gateway_registry, &app_handle);
            // Restore the session-authorization whitelist from disk (approved
            // sessions survive restarts; everything else re-requests approval).
            if let Ok(data_dir) = app.path().app_local_data_dir() {
                let _ = std::fs::create_dir_all(&data_dir);
                gateway_registry.sessions().set_persist_path(
                    data_dir.join("gateway-sessions.json"),
                );
            }
            app.manage(gateway_registry);
            {
                use tauri::Emitter;
                let h = app.handle().clone();
                let reg = app.state::<gateway::registry::GatewayRegistry>();
                // Deliver authorized inbound messages to the frontend so they
                // can drive the agent (session-approved IM chats reach the AI
                // surface instead of being silently dropped). Unauthorized
                // messages stay on the approval path.
                reg.set_handler(std::sync::Arc::new(move |ev| {
                    let _ = h.emit("yamet:gateway-message", &ev);
                }));
            }
            {
                use tauri::Emitter;
                let h = app.handle().clone();
                let reg = app.state::<gateway::registry::GatewayRegistry>();
                reg.set_on_pending(std::sync::Arc::new(move |sk, summary| {
                    let _ = h.emit("yamet:gateway-pending", (sk, summary));
                }));
            }
            {
                use tauri::Emitter;
                let h = app.handle().clone();
                let reg = app.state::<gateway::registry::GatewayRegistry>();
                reg.set_on_connected(std::sync::Arc::new(move |platform, url| {
                    let _ = h.emit("yamet:gateway-connected", (platform, url));
                }));
            }
            {
                use tauri::Emitter;
                let h = app.handle().clone();
                let reg = app.state::<gateway::registry::GatewayRegistry>();
                reg.set_platform_event(std::sync::Arc::new(move |platform, payload| {
                    let _ = h.emit("yamet:gateway-platform-event", (platform, payload));
                }));
            }
            // macOS skips parent() for the settings window, so tie its lifecycle
            // to the main window here instead. Other platforms keep parent().
            #[cfg(target_os = "macos")]
            if let Some(main) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if matches!(
                        event,
                        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
                    ) {
                        if let Some(settings) = handle.get_webview_window("settings") {
                            let _ = settings.close();
                        }
                    }
                });
            }
            // Cron scheduler (★ H3): own an Arc (shared with the tick
            // thread), register it as managed state, load persisted tasks,
            // then tick every 30s emitting `yamet:scheduler-fire` so the
            // frontend can spawn agent runs (notification / session targets).
            {
                let scheduler_arc: std::sync::Arc<scheduler::SchedulerState> =
                    std::sync::Arc::new(scheduler::SchedulerState::default());
                app.manage(scheduler_arc.clone());
                if let Ok(data_dir) = app.path().app_local_data_dir() {
                    let _ = std::fs::create_dir_all(&data_dir);
                    scheduler_arc.set_persist_path(data_dir.join("scheduler.json"));
                    scheduler_arc.load();
                }
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    loop {
                        for fired in scheduler_arc.tick() {
                            let _ = handle.emit("yamet:scheduler-fire", &fired);
                        }
                        std::thread::sleep(std::time::Duration::from_secs(30));
                    }
                });
            }
            Ok(())
        })
        .manage(pty::PtyState::default())
        .manage(shell::ShellState::default())
        .manage(proc::stats::ResourceStatsState::default())
        .manage(secrets::SecretsState::default())
        .manage(fs::watch::FsWatchState::default())
        .manage(history::HistoryState::default())
        .manage(mcp::McpServerState::default())
        .manage(lsp::LspState::default())
        .manage(dap::DapSessionState::default())
        .manage(pty_helper::HelperClientState::default())
        .manage(ssh::TunnelsState::default())
        .manage(fs::grep::ContentSearchState::default())
        .manage(net::web_fetch::WebFetchState::default())
        .manage(net::web_search::WebSearchState::default())
        .manage(ai::harness::AiSessionState::default())
        .manage(ai::memory::MemoryState::default())
        .manage(ai::research::DeepSearchState::default())
        .manage(ai::agents::platform::AgentPlatformState::default())
        .manage(computer::ComputerUseState::default())
        .manage({
            let registry = workspace::WorkspaceRegistry::default();
            workspace::bootstrap_registry(&registry);
            if let Some(ref launch_dir) = cli_dir {
                let _ = registry.authorize(launch_dir);
            }
            registry
        })
        .manage(LaunchDir(Mutex::new(cli_dir)))
        .manage(LaunchFiles(Mutex::new(launch.files)))
        .invoke_handler(tauri::generate_handler![
            // --- PTY / SSH ---
            pty_helper::client::pty_helper_open,
            pty_helper::client::pty_helper_attach,
            pty_helper::client::pty_helper_write,
            pty_helper::client::pty_helper_resize,
            pty_helper::client::pty_helper_close,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_close_all,
            pty::pty_has_foreground_process,
            pty::pty_has_foreground_job,
            pty::pty_buffer_lines,
            pty_helper::client::pty_helper_buffer_lines,
            pty::pty_shell_name,
            pty::pty_list_shells,
            ssh::sftp::sftp_list,
            ssh::sftp::sftp_read,
            ssh::sftp::sftp_write,
            ssh::tunnels::ssh_tunnel_start,
            ssh::tunnels::ssh_tunnel_list,
            ssh::tunnels::ssh_tunnel_kill,
            // --- 文件系统 fs ---
            fs::tree::list_subdirs,
            fs::tree::fs_read_dir,
            fs::file::fs_read_file,
            fs::file::fs_write_file,
            fs::document::fs_create_docx,
            fs::document::fs_create_xlsx,
            fs::document::fs_create_pptx,
            fs::document::fs_create_pdf,
            fs::document::fs_edit_docx,
            fs::document::fs_edit_xlsx,
            fs::document::fs_edit_pptx,
            fs::document::fs_pdf_page_count,
            fs::document::fs_pdf_merge,
            fs::document::fs_pdf_encrypt,
            fs::file::fs_stat,
            fs::file::fs_canonicalize,
            fs::mutate::fs_create_file,
            fs::mutate::fs_create_dir,
            fs::mutate::fs_rename,
            fs::mutate::fs_delete,
            fs::mutate::fs_copy,
            fs::watch::fs_watch_add,
            fs::watch::fs_watch_remove,
            // --- LSP / DAP ---
            lsp::lsp_detect,
            lsp::lsp_host_pid,
            lsp::lsp_resolve_root,
            lsp::lsp_spawn,
            lsp::lsp_send,
            lsp::lsp_kill,
            // DAP native integration commands
            dap::session::dap_session_create,
            dap::session::dap_session_connect,
            dap::session::dap_session_disconnect,
            dap::session::dap_session_list,
            dap::session::dap_session_get,
            dap::session::dap_request_send,
            // --- 搜索 ---
            fs::search::fs_search,
            fs::search::fs_list_files,
            fs::grep::fs_grep,
            fs::grep::fs_grep_interactive,
            fs::grep::fs_glob,
            // --- git ---
            git::commands::git_resolve_repo,
            git::commands::git_panel_snapshot,
            git::commands::git_status,
            git::commands::git_diff,
            git::commands::git_diff_content,
            git::commands::git_stage,
            git::commands::git_unstage,
            git::commands::git_discard,
            git::commands::git_commit,
            git::commands::git_fetch,
            git::commands::git_pull_ff_only,
            git::commands::git_push,
            git::commands::git_log,
            git::commands::git_show_commit,
            git::commands::git_commit_files,
            git::commands::git_commit_file_diff,
            git::commands::git_remote_url,
            git::commands::git_blame,
            git::commands::git_checkpoint_create,
            git::commands::git_checkpoint_list,
            git::commands::git_checkpoint_restore,
            git::commands::git_list_branches,
            git::commands::git_checkout_branch,
            git::commands::git_create_branch,
            git::commands::git_delete_branch,
            git::commands::git_rename_branch,
            git::commands::git_push_upstream,
            git::commands::git_pull,
            git::commands::git_stash_save,
            git::commands::git_stash_list,
            git::commands::git_stash_pop,
            git::commands::git_stash_apply,
            git::commands::git_stash_drop,
            git::commands::git_conflicts,
            git::commands::git_merge_abort,
            git::commands::git_checkout_ours,
            git::commands::git_checkout_theirs,
            git::commands::git_submodule_status,
            git::commands::git_submodule_update,
            shell::shell_run_command,
            proc::stats::resource_stats,
            shell::shell_session_open,
            shell::shell_session_run,
            shell::shell_session_close,
            shell::shell_bg_spawn,
            shell::shell_bg_logs,
            shell::shell_bg_kill,
            shell::shell_bg_list,
            shell::agent_probe,
            workspace::wsl_list_distros,
            workspace::wsl_home,
            workspace::workspace_authorize,
            workspace::workspace_current_dir,
            workspace::workspace_set_current,
            get_launch_dir,
            get_launch_files,
            open_settings_window,
            // --- agent / secrets ---
            agent::agent_enable_hooks,
            agent::agent_hooks_status,
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
            secrets::secrets_get_all,
            // --- IM gateway ---
            gateway::commands::gateway_platforms,
            gateway::commands::gateway_configure,
            gateway::commands::gateway_connect,
            gateway::commands::gateway_disconnect,
            gateway::commands::gateway_send,
            gateway::commands::gateway_weixin_qr_login,
            gateway::commands::gateway_sessions,
            gateway::commands::gateway_authorize,
            gateway::commands::gateway_revoke,
            gateway::commands::gateway_auto_approve,
            gateway::commands::gateway_callback_urls,
            gateway::commands::gateway_weixin_persist,
            // --- AI 网络代理 / 历史 ---
            net::lm_ping,
            net::ai_http_request,
            net::ai_http_stream,
            net::web_fetch::web_fetch,
            net::web_search::web_search,
            // --- AI 原生子系统 (harness / context) ---
            ai::harness::ai_session_open,
            ai::harness::ai_session_close,
            ai::harness::ai_session_abort,
            ai::harness::ai_session_status,
            ai::harness::ai_session_send,
            ai::context::ai_estimate_tokens,
            ai::context::ai_estimate_messages,
            ai::memory::memory_remember,
            ai::memory::memory_recall,
            ai::memory::memory_stats,
            ai::research::deep_search_start,
            ai::research::deep_search_poll,
            ai::research::deep_search_abort,
            ai::research::deep_search_advance,
            ai::research::deep_search_reserve,
            ai::agents::platform::agent_registry_list,
            ai::agents::platform::agent_registry_get,
            ai::agents::platform::agent_registry_delegatable,
            ai::agents::platform::agent_registry_primary,
            ai::agents::platform::agent_registry_register,
            ai::agents::platform::agent_registry_remove,
            ai::agents::platform::agent_instance_create,
            ai::agents::platform::agent_instance_get,
            ai::agents::platform::agent_instance_transition,
            ai::agents::platform::agent_instance_record_step,
            ai::agents::platform::agent_instance_finalize,
            ai::agents::platform::agent_history,
            ai::agents::platform::agent_within_budget,
            ai::agents::platform::agent_checkpoint_save,
            ai::agents::platform::agent_checkpoint_restore,
            ai::agents::platform::agent_template_list,
            ai::agents::platform::agent_template_clone,
            ai::agents::platform::agent_skill_fork,
            ai::agents::platform::agent_steer_add,
            ai::agents::platform::agent_steer_list,
            ai::agents::platform::agent_steer_drain,
            // --- computer use ---
            computer::computer_session_open,
            computer::computer_session_close,
            computer::computer_approve,
            computer::computer_revoke,
            computer::computer_capture,
            computer::computer_action,
            // §3.1.2 computer-use simple commands
            computer::commands::computer_screenshot,
            computer::commands::computer_click,
            computer::commands::computer_type,
            computer::commands::computer_read_accessibility_tree,
            // §3.5.2 FTS search
            ai::memory::fts::memory_fts_search,
            // §3.5.3 user preferences
            ai::preferences::preferences_extract,
            ai::preferences::preferences_get,
            // §3.6.2 image generation
            ai::media::generate_image,
            ai::resilience::resilience_status,
            history::history_suggest,
            history::history_commands,
            history::history_record,
            history::history_list,
            // --- MCP / 窗口 / 调度 ---
            mcp::server::mcp_server_add,
            mcp::server::mcp_server_remove,
            mcp::server::mcp_server_list,
            mcp::server::mcp_server_get,
            mcp::server::mcp_server_connect,
            mcp::server::mcp_server_disconnect,
            mcp::server::mcp_server_refresh,
            mcp::server::mcp_tool_call,
            mcp::server::mcp_resource_read,
            window::toggle_devtools,
            scheduler::scheduler_list,
            scheduler::scheduler_upsert,
            scheduler::scheduler_delete,
            scheduler::scheduler_toggle,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                // Servers exit on stdin EOF, but destructors are not guaranteed
                // on process exit; kill explicitly.
                tauri::RunEvent::Exit => {
                    if let Some(state) = app.try_state::<lsp::LspState>() {
                        state.kill_all();
                    }
                    if let Some(state) = app.try_state::<mcp::McpServerState>() {
                        state.shutdown_all();
                    }
                    if let Some(state) = app.try_state::<dap::DapSessionState>() {
                        state.close_all();
                    }
                    // Ask the detached PTY helper to clean up and exit now, so a
                    // long-lived helper doesn't linger until its 10-min orphan
                    // timeout after the app has closed.
                    pty_helper::client::shutdown_helper(app);
                }
                // macOS delivers "Open With" files here, not as argv (cold and
                // warm start, several at once). Seed the drain-once state and
                // emit; canonicalize so the /tmp -> /private/tmp symlink can't
                // defeat openFileTab's path dedupe against a CLI launch.
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    let entries = urls
                        .iter()
                        .filter_map(|u| u.to_file_path().ok())
                        .filter_map(|p| std::fs::canonicalize(p).ok())
                        .filter(|p| p.is_file())
                        .map(LaunchEntry::File)
                        .collect();
                    let target = resolve_launch_target(entries);
                    if target.files.is_empty() {
                        return;
                    }
                    if let Some(dir) = &target.dir {
                        if let Some(registry) = app.try_state::<workspace::WorkspaceRegistry>() {
                            let _ = registry.authorize(dir);
                        }
                        if let Some(state) = app.try_state::<LaunchDir>() {
                            *state.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(dir.clone());
                        }
                    }
                    if let Some(state) = app.try_state::<LaunchFiles>() {
                        *state.0.lock().unwrap_or_else(|e| e.into_inner()) = target.files.clone();
                    }
                    let _ = app.emit("yamet:open-file", target.files);
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod launch_target_tests {
    use super::{resolve_launch_target, LaunchEntry, LaunchTarget};
    use std::path::PathBuf;

    #[test]
    fn no_entries_resolves_to_empty() {
        assert_eq!(resolve_launch_target(vec![]), LaunchTarget::default());
    }

    #[test]
    fn dir_arg_sets_workspace_and_opens_nothing() {
        let out = resolve_launch_target(vec![LaunchEntry::Dir(PathBuf::from("/home/u/proj"))]);
        assert_eq!(out.dir.as_deref(), Some("/home/u/proj"));
        assert!(out.files.is_empty());
    }

    #[test]
    fn file_arg_opens_file_and_uses_parent_as_workspace() {
        let out =
            resolve_launch_target(vec![LaunchEntry::File(PathBuf::from("/home/u/proj/main.rs"))]);
        assert_eq!(out.dir.as_deref(), Some("/home/u/proj"));
        assert_eq!(out.files, vec!["/home/u/proj/main.rs".to_string()]);
    }

    #[test]
    fn multiple_files_all_open_and_first_parent_wins() {
        let out = resolve_launch_target(vec![
            LaunchEntry::File(PathBuf::from("/a/one.txt")),
            LaunchEntry::File(PathBuf::from("/b/two.txt")),
        ]);
        assert_eq!(out.dir.as_deref(), Some("/a"));
        assert_eq!(
            out.files,
            vec!["/a/one.txt".to_string(), "/b/two.txt".to_string()]
        );
    }

    #[test]
    fn explicit_dir_takes_precedence_over_file_parent() {
        let out = resolve_launch_target(vec![
            LaunchEntry::Dir(PathBuf::from("/workspace")),
            LaunchEntry::File(PathBuf::from("/other/x.rs")),
        ]);
        assert_eq!(out.dir.as_deref(), Some("/workspace"));
        assert_eq!(out.files, vec!["/other/x.rs".to_string()]);
    }
}
