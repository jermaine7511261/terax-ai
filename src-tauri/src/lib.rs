pub mod modules;

use modules::{agent, agent_core, agent_learn, backend, billing, checkpoint, compress, cron, credential_pool, errors, fs, gateway_bridge, gateway_ws, git, history, honcho, hub, lsp, mcp, memory, moa, net, plugin, pty, sandbox, secrets, sessions, shell, shell_hooks, skills, tool_guard, web_search, workspace};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use modules::agent_learn::LearningEngine;
use modules::checkpoint::CheckpointManager;
use modules::backend::BackendManager;
use modules::billing::BillingEngine;
use modules::circuit::CircuitBoard;
use modules::codebase_graph::CodebaseGraph;
use modules::compress::SessionCompressor;
use modules::hunker::HunkTracker;
use modules::tts::TtsEngine;
use modules::worktree::Worktree;
use modules::credential_pool::CredentialPool;
use modules::errors::ErrorClassifier;
use modules::cron::CronEngine;
use modules::gateway_bridge::GatewayBridge;
use modules::gateway_ws::GatewayWs;
use modules::honcho::HonchoEngine;
use modules::hub::SkillsHub;
use modules::mcp::McpManager;
use modules::moa::MoaEngine;
use modules::memory::MemoryDb;
use modules::honcho::MemorySnapshotManager;
use modules::codebase_graph;
use modules::circuit;
use modules::hunker;
use modules::tts;
use modules::worktree;
use modules::plugin::PluginEngine;
use modules::sandbox::Sandbox;
use modules::sessions::SessionManager;
use modules::shell_hooks::ShellHooksEngine;
use modules::tool_guard::ToolGuard;
use modules::web_search::WebSearch;
use modules::skills::SkillsEngine;
#[cfg(target_os = "macos")]
use tauri::{PhysicalPosition, WindowEvent};
use tauri_plugin_window_state::StateFlags;

/// Drained on first read so HMR / re-mounts can't replay the launch dir.
#[derive(Default)]
struct LaunchDir(Mutex<Option<String>>);

/// Drained on first read so HMR / re-mounts can't replay the launch files.
#[derive(Default)]
struct LaunchFiles(Mutex<Vec<String>>);

#[tauri::command]
fn get_launch_dir(state: State<'_, LaunchDir>) -> Option<String> {
    state.0.lock().expect("LaunchDir mutex poisoned").take()
}

#[tauri::command]
fn get_launch_files(state: State<'_, LaunchFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().expect("LaunchFiles mutex poisoned"))
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
            let _ = window.emit("terax:settings-tab", t);
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
        if args.get(1).map(String::as_str) == Some("__terax_notify") {
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
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
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
            // Initialize memory (FTS5) and skills engines
            if let Ok(dir) = app.path().app_data_dir() {
                std::fs::create_dir_all(&dir).ok();
                let db_path = dir.join("terax-memory.db");
                match MemoryDb::new(&db_path) {
                    Ok(db) => { app.manage(db); },
                    Err(e) => { log::error!("failed to init memory db: {e}"); }
                }
                let engine = SkillsEngine::new();
                let _ = engine.init(&dir);
                app.manage(engine);
                let learn = LearningEngine::new();
                let _ = learn.init(&dir);
                app.manage(learn);
                app.manage(SessionManager::new());
                app.manage(BackendManager::new());
                app.manage(CronEngine::new());
                let sh = SkillsHub::new();
                let _ = sh.init(&dir);
                app.manage(sh);
                app.manage(PluginEngine::new());
                app.manage(GatewayBridge::new());
                app.manage(McpManager::new());
                app.manage(Sandbox::new());
                let cm = CheckpointManager::new();
                cm.init(&dir);
                app.manage(cm);
                app.manage(MoaEngine::new());
                app.manage(CredentialPool::new());
                app.manage(BillingEngine::new());
                app.manage(ErrorClassifier::new());
                app.manage(GatewayWs::new());
                app.manage(ToolGuard::new());
                // Agent Core — autonomous AI agent engine
                app.manage(agent_core::AgentEngine::new(
                    &dir.to_string_lossy(),
                ));
                app.manage(HonchoEngine::new());
                app.manage(MemorySnapshotManager::new());
                app.manage(WebSearch::new());
                app.manage(ShellHooksEngine::new());
                app.manage(SessionCompressor::new(128_000));
                app.manage(CircuitBoard::new());
                app.manage(HunkTracker::new());
                app.manage(TtsEngine::new());
                let cg = CodebaseGraph::new();
                cg.init(&dir);
                app.manage(cg);
                let wt = Worktree::new();
                wt.init(&dir);
                app.manage(wt);
            }
            Ok(())
        })
        .manage(pty::PtyState::default())
        .manage(shell::ShellState::default())
        .manage(secrets::SecretsState::default())
        .manage(fs::watch::FsWatchState::default())
        .manage(history::HistoryState::default())
        .manage(lsp::LspState::default())
        .manage(fs::grep::ContentSearchState::default())
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
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_close_all,
            pty::pty_has_foreground_process,
            pty::pty_has_foreground_job,
            pty::pty_shell_name,
            pty::pty_list_shells,
            fs::tree::list_subdirs,
            fs::tree::fs_read_dir,
            fs::file::fs_read_file,
            fs::file::fs_write_file,
            fs::file::fs_stat,
            fs::file::fs_canonicalize,
            fs::mutate::fs_create_file,
            fs::mutate::fs_create_dir,
            fs::mutate::fs_rename,
            fs::mutate::fs_delete,
            fs::mutate::fs_copy,
            fs::watch::fs_watch_add,
            fs::watch::fs_watch_remove,
            lsp::lsp_detect,
            lsp::lsp_host_pid,
            lsp::lsp_resolve_root,
            lsp::lsp_spawn,
            lsp::lsp_send,
            lsp::lsp_kill,
            fs::search::fs_search,
            fs::search::fs_list_files,
            fs::grep::fs_grep,
            fs::grep::fs_grep_interactive,
            fs::grep::fs_glob,
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
            git::commands::git_list_branches,
            git::commands::git_checkout_branch,
            shell::shell_run_command,
            shell::shell_session_open,
            shell::shell_session_run,
            shell::shell_session_close,
            shell::shell_bg_spawn,
            shell::shell_bg_logs,
            shell::shell_bg_kill,
            shell::shell_bg_list,
            workspace::wsl_list_distros,
            workspace::wsl_default_distro,
            workspace::wsl_home,
            workspace::workspace_authorize,
            workspace::workspace_current_dir,
            get_launch_dir,
            get_launch_files,
            open_settings_window,
            agent::agent_enable_hooks,
            agent::agent_hooks_status,
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
            secrets::secrets_get_all,
            net::lm_ping,
            net::ai_http_request,
            net::ai_http_stream,
            history::history_suggest,
            history::history_commands,
            history::history_record,
            history::history_list,
            memory::memory_search,
            memory::memory_add,
            memory::memory_save_session,
            memory::memory_search_sessions,
            skills::skills_list,
            skills::skills_get,
            skills::skills_create,
            skills::skills_delete,
            skills::skills_use,
            agent_learn::learn_record_turn,
            agent_learn::learn_build_review_context,
            agent_learn::learn_store_review_result,
            agent_learn::learn_get_review_results,
            agent_learn::learn_run_curator,
            mcp::mcp_list_servers,
            mcp::mcp_register_server,
            mcp::mcp_unregister_server,
            mcp::mcp_list_tools,
            sandbox::sandbox_get_config,
            sandbox::sandbox_set_config,
            sandbox::sandbox_can_read,
            sandbox::sandbox_can_write,
            sandbox::sandbox_can_network,
            checkpoint::checkpoint_create,
            checkpoint::checkpoint_list,
            checkpoint::checkpoint_restore,
            checkpoint::checkpoint_delete,
            honcho::profile_get,
            honcho::profile_save,
            honcho::profile_get_markdown,
            honcho::profile_record_goal,
            honcho::honcho_observe,
            honcho::honcho_insights,
            honcho::ms_create,
            honcho::ms_list,
            honcho::ms_delete,
            backend::backend_list,
            backend::backend_register,
            backend::backend_remove,
            backend::backend_execute,
            backend::backend_status,
            backend::backend_status_all,
            cron::cron_list,
            cron::cron_add,
            cron::cron_update,
            cron::cron_delete,
            cron::cron_logs,
            cron::cron_tick,
            gateway_bridge::gateway_list,
            gateway_bridge::gateway_save,
            gateway_bridge::gateway_delete,
            gateway_bridge::gateway_messages,
            hub::hub_refresh,
            hub::hub_search,
            hub::hub_install,
            hub::hub_uninstall,
            hub::hub_list_installed,
            hub::hub_get_installed,
            hub::hub_toggle,
            plugin::plugin_register,
            plugin::plugin_unregister,
            plugin::plugin_list,
            plugin::plugin_get,
            plugin::plugin_toggle,
            plugin::plugin_collect_tools,
            moa::moa_register,
            moa::moa_unregister,
            moa::moa_list,
            moa::moa_select,
            credential_pool::cp_list_sources,
            credential_pool::cp_register_source,
            credential_pool::cp_remove_source,
            credential_pool::cp_resolve,
            credential_pool::cp_set_in_memory,
            credential_pool::cp_invalidate,
            compress::compress_analyze,
            compress::compress_set_strategy,
            compress::compress_estimate_tokens,
            gateway_ws::ws_start,
            gateway_ws::ws_stop,
            gateway_ws::ws_stop_all,
            gateway_ws::ws_status,
            gateway_ws::ws_send,
            gateway_ws::ws_messages,
            web_search::ws_search,
            web_search::ws_fetch,
            web_search::ws_set_backend,
            tool_guard::guard_check,
            tool_guard::guard_list_rules,
            tool_guard::guard_add_rule,
            tool_guard::guard_remove_rule,
            tool_guard::guard_toggle_rule,
            tool_guard::guard_stats,
            gateway_bridge::gateway_list,
            shell_hooks::hooks_register,
            shell_hooks::hooks_unregister,
            shell_hooks::hooks_run,
            shell_hooks::hooks_toggle,
            billing::billing_record,
            billing::billing_summary,
            billing::billing_get_budget,
            billing::billing_set_budget,
            billing::billing_recent,
            billing::billing_calculate_cost,
            errors::errors_classify,
            errors::errors_stats,
            errors::errors_recent,
            errors::errors_mark_recovered,
            errors::errors_auto_fix,
            sessions::sess_create,
            sessions::sess_list,
            sessions::sess_get,
            sessions::sess_delete,
            sessions::sess_set_active,
            sessions::sess_get_active,
            sessions::sess_update_status,
            sessions::sess_cleanup,
            codebase_graph::cg_index,
            codebase_graph::cg_remove,
            codebase_graph::cg_search,
            codebase_graph::cg_references,
            codebase_graph::cg_file,
            codebase_graph::cg_all,
            codebase_graph::cg_stats,
            worktree::wt_snapshot,
            worktree::wt_diff,
            worktree::wt_pending,
            worktree::wt_clear,
            hunker::hunk_record,
            hunker::hunk_list,
            hunker::hunk_get,
            hunker::hunk_apply,
            hunker::hunk_delete,
            hunker::hunk_cleanup,
            circuit::cb_list,
            circuit::cb_get,
            circuit::cb_register,
            circuit::cb_call_allowed,
            circuit::cb_record_success,
            circuit::cb_record_failure,
            circuit::cb_reset,
            tts::tts_speak,
            tts::tts_set_backend,
            tts::tts_get_backend,
            tts::tts_voices,
            tts::tts_clear_cache,
            agent_core::agent_core_start,
            agent_core::agent_core_step,
            agent_core::agent_core_status,
            agent_core::agent_core_stop,
            agent_core::agent_core_list,
            agent_core::agent_core_delete,
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
                            *state.0.lock().expect("LaunchDir mutex poisoned") = Some(dir.clone());
                        }
                    }
                    if let Some(state) = app.try_state::<LaunchFiles>() {
                        *state.0.lock().expect("LaunchFiles mutex poisoned") = target.files.clone();
                    }
                    let _ = app.emit("terax:open-file", target.files);
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
