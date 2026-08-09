//! §3.1.2 Simple computer-use commands: screenshot, click, type, read_tree.
//!
//! These wrap the existing session-based computer_capture / computer_action
//! with a session-less convenience API.

use super::safety::{ComputerAction, ActionKind};
use super::ComputerCaptureResult;

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

/// Screenshot the screen and return PNG data URL.
#[tauri::command]
pub fn computer_screenshot() -> ComputerCaptureResult {
    match super::platform::capture_screen() {
        Ok(cap) => {
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&cap.png);
            ComputerCaptureResult {
                ok: true,
                image_data_url: Some(format!("data:image/png;base64,{b64}")),
                width: Some(cap.width),
                height: Some(cap.height),
                scale: Some(cap.scale),
                error: None,
            }
        }
        Err(e) => ComputerCaptureResult {
            ok: false,
            image_data_url: None,
            width: None,
            height: None,
            scale: None,
            error: Some(e),
        },
    }
}

/// Click at absolute pixel coordinates.
#[tauri::command]
pub fn computer_click(x: i32, y: i32, _button: Option<String>) -> Result<String, String> {
    let (sw, sh) = screen_dimensions();
    let fx = if sw > 0 { x as f64 / sw as f64 } else { 0.5 };
    let fy = if sh > 0 { y as f64 / sh as f64 } else { 0.5 };

    let action = ComputerAction {
        kind: ActionKind::Click,
        x: Some(fx.clamp(0.0, 1.0)),
        y: Some(fy.clamp(0.0, 1.0)),
        ..Default::default()
    };

    if let Some(err) = super::safety::validate_action(&action) {
        return Err(err);
    }
    super::platform::inject_action(&action)?;
    Ok(format!(r#"{{"ok":true,"x":{x},"y":{y}}}"#))
}

/// Type text at the current focus using Unicode input injection.
#[tauri::command]
pub fn computer_type(text: String) -> Result<String, String> {
    let action = ComputerAction {
        kind: ActionKind::Type,
        text: Some(text),
        ..Default::default()
    };

    if let Some(err) = super::safety::validate_action(&action) {
        return Err(err);
    }
    super::platform::inject_action(&action)?;
    Ok(r#"{"ok":true}"#.into())
}

/// Read the accessibility tree. Windows only; other platforms return an error.
#[tauri::command]
pub async fn computer_read_accessibility_tree() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    {
        read_windows_uia_tree()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("accessibility tree is only supported on Windows (UIA)".into())
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn screen_dimensions() -> (i32, i32) {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
        unsafe {
            (
                GetSystemMetrics(SM_CXSCREEN),
                GetSystemMetrics(SM_CYSCREEN),
            )
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        (1920, 1080)
    }
}

// ---------------------------------------------------------------------------
// Windows UIA Accessibility Tree
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn read_windows_uia_tree() -> Result<serde_json::Value, String> {
    use windows_sys::Win32::System::Com::CoInitialize;
    unsafe { CoInitialize(std::ptr::null_mut()); }

    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            "Add-Type -AssemblyName UIAutomationClient; \
             $root = [System.Windows.Automation.AutomationElement]::RootElement; \
             function Dump($el, $d) { \
               $name = $el.Current.Name; \
               $type = $el.Current.ControlType.ProgrammaticName; \
               $id = $el.Current.AutomationId; \
               $out = @{n=$name;t=$type}; \
               if($id){$out.a=$id}; \
               if($d -lt 4){ \
                 foreach($c in $el.FindAll([System.Windows.Automation.TreeScope]::Children, \
                   [System.Windows.Automation.Condition]::TrueCondition)) { \
                   $out.c += @((Dump $c ($d+1))) \
                 } \
               }; \
               $out \
             }; \
             Dump $root 0 | ConvertTo-Json -Depth 10 -Compress",
        ])
        .output()
        .map_err(|e| format!("UIA PowerShell failed: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    if !output.status.success() && stdout.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("UIA command failed: {stderr}"));
    }

    serde_json::from_str(&stdout)
        .map_err(|e| format!("UIA JSON parse failed: {e}"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn screen_dimensions_are_positive() {
        let (sw, sh) = super::screen_dimensions();
        assert!(sw > 0);
        assert!(sh > 0);
    }
}
