//! Generic media download helper shared by platform adapters.
//!
//! Each adapter can call [`download_media`] to fetch a URL, persist it to
//! `~/.yamet/media/`, and get back the local path.  The filename is derived
//! from an MD-5 hash of the URL to avoid collisions and redundant downloads.

use std::path::PathBuf;
use std::time::Duration;

use md5::{Digest, Md5};

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30);

/// Derive the `~/.yamet/media/` directory (creates it on first call).
fn media_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(".yamet")
        .join("media")
}

/// Compute a short hex digest from a byte slice (MD-5 → first 16 hex chars).
fn short_hash(data: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(data);
    let result = hasher.finalize();
    hex::encode(result)[..16].to_string()
}

/// Guess a file extension from the URL path or Content-Type header.
fn guess_extension(url: &str, content_type: Option<&str>) -> String {
    // Try Content-Type first.
    if let Some(ct) = content_type {
        let ct_lower = ct.to_lowercase();
        let ext = match ct_lower.as_str() {
            "image/jpeg" | "image/jpg" => "jpg",
            "image/png" => "png",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/svg+xml" => "svg",
            "image/bmp" => "bmp",
            "audio/amr" | "audio/ogg" | "audio/mp4" | "audio/mpeg" => "amr",
            "video/mp4" | "video/quicktime" => "mp4",
            "application/pdf" => "pdf",
            "application/zip" => "zip",
            _ => "",
        };
        if !ext.is_empty() {
            return ext.to_string();
        }
    }

    // Fallback: look at the URL path extension.
    if let Ok(parsed) = url::Url::parse(url) {
        let path = parsed.path();
        if let Some(dot_pos) = path.rfind('.') {
            let ext = &path[dot_pos + 1..];
            // Only accept short, reasonable extensions.
            if ext.len() <= 8 && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
                return ext.to_lowercase();
            }
        }
    }
    "bin".to_string()
}

/// Download a media URL and persist it locally.
///
/// Returns `Ok(local_path)` on success.  On failure, logs a warning and
/// returns `Err` — callers should treat this as non-fatal (the message is
/// still delivered, just without a local attachment).
///
/// `platform` is a short tag like `"weixin"`, `"qq"`, etc. used in the
/// filename for easy provenance tracking.
pub async fn download_media(
    client: &reqwest::Client,
    url: &str,
    platform: &str,
) -> Result<String, String> {
    if url.is_empty() {
        return Err("download_media: empty url".into());
    }

    // 1. Fetch the bytes with a timeout.
    let resp = client
        .get(url)
        .timeout(DOWNLOAD_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("media download request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("media download HTTP {status} for {url}"));
    }

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("media download read failed: {e}"))?;

    // 2. Build the local path: ~/.yamet/media/{platform}_{hash}.{ext}
    let dir = media_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("media dir create failed: {e}"))?;

    let ext = guess_extension(url, content_type.as_deref());
    let hash = short_hash(url.as_bytes());
    let filename = format!("{platform}_{hash}.{ext}");
    let path = dir.join(&filename);

    // 3. Write the bytes.
    std::fs::write(&path, &bytes)
        .map_err(|e| format!("media write failed: {e}"))?;

    Ok(path.to_string_lossy().into_owned())
}

/// Download media for every item in a slice, filling `local_path` in-place.
/// Failures are logged but do not short-circuit — remaining items still
/// attempt download.
pub async fn download_media_items(
    client: &reqwest::Client,
    items: &mut [crate::modules::gateway::message::MediaItem],
    platform: &str,
) {
    for item in items.iter_mut() {
        if item.local_path.is_some() {
            continue; // already resolved
        }
        let url = match item.url.as_deref() {
            Some(u) if !u.starts_with("media-") => u, // skip raw media_id placeholders
            _ => continue,
        };
        match download_media(client, url, platform).await {
            Ok(path) => {
                item.local_path = Some(path);
            }
            Err(e) => {
                log::warn!("media download failed for {platform}: {e}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_hash_deterministic() {
        let a = short_hash(b"https://example.com/img.png");
        let b = short_hash(b"https://example.com/img.png");
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn short_hash_different_for_different_urls() {
        let a = short_hash(b"https://example.com/a.png");
        let b = short_hash(b"https://example.com/b.png");
        assert_ne!(a, b);
    }

    #[test]
    fn guess_extension_from_content_type() {
        assert_eq!(guess_extension("http://x", Some("image/jpeg")), "jpg");
        assert_eq!(guess_extension("http://x", Some("image/png")), "png");
        assert_eq!(guess_extension("http://x", Some("video/mp4")), "mp4");
        assert_eq!(guess_extension("http://x", Some("audio/amr")), "amr");
    }

    #[test]
    fn guess_extension_from_url_path() {
        assert_eq!(
            guess_extension("https://x.com/photo.jpg", None),
            "jpg"
        );
        assert_eq!(
            guess_extension("https://x.com/vid.mp4?v=1", None),
            "mp4"
        );
    }

    #[test]
    fn guess_extension_fallback_bin() {
        assert_eq!(guess_extension("https://x.com/download", None), "bin");
        assert_eq!(
            guess_extension("https://x.com/f", Some("application/octet-stream")),
            "bin"
        );
    }

    #[test]
    fn media_dir_returns_path() {
        let d = media_dir();
        assert!(d.to_string_lossy().contains(".yamet"));
        assert!(d.to_string_lossy().contains("media"));
    }
}
