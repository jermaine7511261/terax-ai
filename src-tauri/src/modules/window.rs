//! Window / webview control commands (kept in a module so `#[tauri::command]`
//! macro-generated names don't collide with `generate_handler!` at crate root).

/// Toggle the webview's developer tools (preview debugging + Yamet's own UI).
/// The devtools methods are gated behind `debug_assertions`/the `devtools`
/// feature in tauri; keep the command compilable in release by no-op'ing when
/// unavailable.
#[tauri::command]
pub fn toggle_devtools(window: tauri::WebviewWindow) {
    #[cfg(any(debug_assertions, feature = "devtools"))]
    {
        if window.is_devtools_open() {
            window.close_devtools();
        } else {
            window.open_devtools();
        }
    }
    #[cfg(not(any(debug_assertions, feature = "devtools")))]
    let _ = window;
}
