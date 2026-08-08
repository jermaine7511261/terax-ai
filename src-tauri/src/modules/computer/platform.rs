//! Computer-use platform layer (P3, M1): screen capture.
//!
//! Windows: BitBlt from the screen DC into a DIB, downscale to the pixel
//! budget, encode PNG. macOS/Linux return a clear "not implemented" error
//! (M1 milestone is Windows-first per decision 4); later milestones add
//! ScreenCaptureKit / XShm.

use super::safety::capture_scale;

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
        Err("computer use capture is not implemented on this platform yet (Windows M1 ships first)".into())
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
        let s = capture_scale(7680, 4320);
        assert!(s < 1.0);
    }
}
