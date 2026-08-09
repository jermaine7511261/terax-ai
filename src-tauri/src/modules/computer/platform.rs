//! Computer-use platform layer (P3, M1-M2): screen capture + input injection.
//!
//! Windows: BitBlt screen capture (M1) + SendInput injection (M2). macOS/Linux
//! return a clear "not implemented" error (M1/M2 land cross-platform in a
//! later milestone — ScreenCaptureKit/CGEvent and xcap/XTEST respectively).

use super::safety::{capture_scale, ActionKind, ComputerAction};

pub struct CaptureResult {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

/// Capture the primary screen as PNG bytes. Errors are human-readable.
pub fn capture_screen() -> Result<CaptureResult, String> {
    #[cfg(target_os = "windows")]
    {
        capture_windows()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("computer use capture is not implemented on this platform yet".into())
    }
}

/// Inject a gated input action (M2). The caller (`computer_action`) enforces
/// approval + sensitive regions + budget; this performs the actual injection.
pub fn inject_action(action: &ComputerAction) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        inject_windows(action)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = action;
        Err("computer use input injection is not implemented on this platform yet".into())
    }
}

#[cfg(target_os = "windows")]
fn screen_dimensions() -> (i32, i32) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
    unsafe {
        (
            GetSystemMetrics(SM_CXSCREEN),
            GetSystemMetrics(SM_CYSCREEN),
        )
    }
}

/// Convert a fractional (0..1) coordinate to absolute pixels, clamped.
#[cfg(target_os = "windows")]
fn abs_coord(frac: f64, px: i32) -> i32 {
    if px <= 0 {
        return 0;
    }
    ((frac * px as f64).round() as i32).clamp(0, px - 1)
}

/// Map a named key to a Windows virtual-key code. Pure — unit-tested.
#[cfg(target_os = "windows")]
fn virtual_key(name: &str) -> Result<u16, String> {
    let n = name.trim().to_ascii_lowercase();
    // Single alphanumeric keys map directly (a-z / 0-9 → uppercase VK).
    if n.chars().count() == 1 {
        if let Some(ch) = n.chars().next() {
            if ch.is_ascii_alphanumeric() {
                return Ok(ch.to_ascii_uppercase() as u16);
            }
        }
    }
    let vk = match n.as_str() {
        "enter" | "return" => 0x0D,
        "tab" => 0x09,
        "escape" | "esc" => 0x1B,
        "space" => 0x20,
        "backspace" => 0x08,
        "delete" | "del" => 0x2E,
        "left" => 0x25,
        "up" => 0x26,
        "right" => 0x27,
        "down" => 0x28,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        _ => {
            return Err(format!("unsupported key name: {name}"));
        }
    };
    Ok(vk)
}

#[cfg(target_os = "windows")]
fn inject_windows(action: &ComputerAction) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN,
        MOUSEEVENTF_LEFTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT, SendInput, INPUT, INPUT_0,
        INPUT_KEYBOARD, INPUT_MOUSE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos;

    fn send(events: &[INPUT]) -> Result<(), String> {
        let sent = unsafe {
            SendInput(
                events.len() as u32,
                events.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        };
        if sent == 0 {
            return Err(format!(
                "SendInput failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }

    fn mouse(flags: u32, data: u32) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: data,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn key(vk: u16, scan: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    match action.kind {
        ActionKind::Click => {
            let (sw, sh) = screen_dimensions();
            let x = action.x.ok_or("click requires x")?;
            let y = action.y.ok_or("click requires y")?;
            unsafe {
                SetCursorPos(abs_coord(x, sw), abs_coord(y, sh));
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
            send(&[mouse(MOUSEEVENTF_LEFTDOWN, 0), mouse(MOUSEEVENTF_LEFTUP, 0)])
        }
        ActionKind::Drag => {
            let (sw, sh) = screen_dimensions();
            let x = action.x.ok_or("drag requires x")?;
            let y = action.y.ok_or("drag requires y")?;
            send(&[mouse(MOUSEEVENTF_LEFTDOWN, 0)])?;
            std::thread::sleep(std::time::Duration::from_millis(20));
            unsafe {
                SetCursorPos(abs_coord(x, sw), abs_coord(y, sh));
            }
            std::thread::sleep(std::time::Duration::from_millis(40));
            send(&[mouse(MOUSEEVENTF_LEFTUP, 0)])
        }
        ActionKind::Type | ActionKind::SetValue => {
            let text = action.text.as_deref().unwrap_or("");
            let mut inputs: Vec<INPUT> = Vec::with_capacity(text.encode_utf16().count() * 2);
            for unit in text.encode_utf16() {
                inputs.push(key(0, unit, KEYEVENTF_UNICODE));
                inputs.push(key(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
            }
            send(&inputs)
        }
        ActionKind::Key => {
            let vk = virtual_key(action.key.as_deref().unwrap_or(""))?;
            send(&[key(vk, 0, 0), key(vk, 0, KEYEVENTF_KEYUP)])
        }
        ActionKind::Scroll => {
            let dy = action.scroll_dy.unwrap_or(0.0);
            let dx = action.scroll_dx.unwrap_or(0.0);
            let mut inputs: Vec<INPUT> = Vec::new();
            if dy != 0.0 {
                let delta = (dy * 120.0).round() as i32;
                inputs.push(mouse(MOUSEEVENTF_WHEEL, delta as u32));
            }
            if dx != 0.0 {
                let delta = (dx * 120.0).round() as i32;
                inputs.push(mouse(MOUSEEVENTF_HWHEEL, delta as u32));
            }
            if inputs.is_empty() {
                return Ok(());
            }
            send(&inputs)
        }
        ActionKind::Capture => Err("capture is read-only; use capture_screen".into()),
    }
}

#[cfg(target_os = "windows")]
fn capture_windows() -> Result<CaptureResult, String> {
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, GetObjectW, ReleaseDC, SelectObject, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
        BI_RGB, DIB_RGB_COLORS, HDC, HBITMAP, SRCCOPY,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN,
    };

    unsafe {
        let screen_w = GetSystemMetrics(SM_CXSCREEN) as u32;
        let screen_h = GetSystemMetrics(SM_CYSCREEN) as u32;
        if screen_w == 0 || screen_h == 0 {
            return Err("failed to read screen dimensions".into());
        }

        let scale = capture_scale(screen_w as u64, screen_h as u64);
        let out_w = ((screen_w as f64 * scale).floor() as u32).max(1);
        let out_h = ((screen_h as f64 * scale).floor() as u32).max(1);

        let hdc_screen: HDC = GetDC(std::ptr::null_mut());
        if hdc_screen.is_null() {
            return Err("GetDC failed".into());
        }
        let hdc_mem: HDC = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_null() {
            let _ = ReleaseDC(std::ptr::null_mut(), hdc_screen);
            return Err("CreateCompatibleDC failed".into());
        }
        let hbmp: HBITMAP = CreateCompatibleBitmap(hdc_screen, screen_w as i32, screen_h as i32);
        if hbmp.is_null() {
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(std::ptr::null_mut(), hdc_screen);
            return Err("CreateCompatibleBitmap failed".into());
        }
        let prev = SelectObject(hdc_mem, hbmp as _);
        let ok = BitBlt(
            hdc_mem,
            0,
            0,
            screen_w as i32,
            screen_h as i32,
            hdc_screen,
            0,
            0,
            SRCCOPY,
        );
        // Restore the previous object before deleting the bitmap.
        if !prev.is_null() {
            let _ = SelectObject(hdc_mem, prev);
        }
        if ok == 0 {
            let _ = DeleteObject(hbmp as _);
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(std::ptr::null_mut(), hdc_screen);
            return Err("BitBlt failed".into());
        }

        let mut bmp: BITMAP = std::mem::zeroed();
        GetObjectW(hbmp as _, std::mem::size_of::<BITMAP>() as i32, &mut bmp as *mut _ as *mut _);
        let row_bytes = ((bmp.bmWidth * 32 + 31) / 32) * 4;
        let mut pixels = vec![0u8; (row_bytes * bmp.bmHeight) as usize];

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = bmp.bmWidth;
        bmi.bmiHeader.biHeight = -bmp.bmHeight; // top-down
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        let copied = GetDIBits(
            hdc_mem,
            hbmp,
            0,
            bmp.bmHeight as u32,
            pixels.as_mut_ptr() as *mut _,
            &mut bmi,
            DIB_RGB_COLORS,
        );
        let _ = DeleteObject(hbmp as _);
        let _ = DeleteDC(hdc_mem);
        let _ = ReleaseDC(std::ptr::null_mut(), hdc_screen);
        if copied == 0 {
            return Err("GetDIBits failed".into());
        }

        // BGRA → RGBA, then downscale to the pixel budget.
        let src_w = bmp.bmWidth as u32;
        let src_h = bmp.bmHeight as u32;
        let mut rgba = Vec::with_capacity((src_w * src_h * 4) as usize);
        for row in 0..src_h as usize {
            let row_off = row * row_bytes as usize;
            for col in 0..src_w as usize {
                let o = row_off + col * 4;
                rgba.extend_from_slice(&[pixels[o + 2], pixels[o + 1], pixels[o], pixels[o + 3]]);
            }
        }

        let img = image::RgbaImage::from_raw(src_w, src_h, rgba)
            .ok_or_else(|| "image buffer allocation failed".to_string())?;
        let out = if scale < 1.0 {
            image::imageops::resize(
                &img,
                out_w,
                out_h,
                image::imageops::FilterType::Triangle,
            )
        } else {
            img
        };

        let mut png: Vec<u8> = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut png);
        out.write_with_encoder(encoder).map_err(|e| format!("png encode failed: {e}"))?;

        Ok(CaptureResult {
            png,
            width: out_w,
            height: out_h,
            scale,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_reduces_huge_captures() {
        // 8K screen → still over budget after scale.
        let s = super::super::safety::capture_scale(7680, 4320);
        assert!(s < 1.0);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn abs_coord_clamps_fractional_to_pixels() {
        assert_eq!(abs_coord(0.0, 1920), 0);
        assert_eq!(abs_coord(1.0, 1920), 1919);
        assert_eq!(abs_coord(0.5, 1920), 960);
        assert_eq!(abs_coord(-0.2, 1920), 0);
        assert_eq!(abs_coord(5.0, 1920), 1919);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn virtual_key_maps_named_keys() {
        assert_eq!(virtual_key("Enter").unwrap(), 0x0D);
        assert_eq!(virtual_key("TAB").unwrap(), 0x09);
        assert_eq!(virtual_key("left").unwrap(), 0x25);
        assert_eq!(virtual_key("a").unwrap(), 'A' as u16);
        assert_eq!(virtual_key("7").unwrap(), '7' as u16);
        assert!(virtual_key("shift").is_err()); // modifiers handled separately later
        assert!(virtual_key("ctrl").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn non_injectable_kinds_are_rejected() {
        let capture = ComputerAction {
            kind: ActionKind::Capture,
            ..Default::default()
        };
        assert!(inject_windows(&capture).is_err());
    }
}
