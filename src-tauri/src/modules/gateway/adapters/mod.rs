//! Concrete platform adapters. Each implements the `PlatformAdapter` trait and
//! is registered into the `GatewayRegistry` from the Tauri setup hook.
//!
//! Reference implementations live in:
//! - the Python agent gateway — the authority for Weixin iLink, plus
//!   `plugins/platforms/{dingtalk,feishu,wecom,qqbot}` adapters
//! - the Python IM bot platform — `pkg/platform/sources/{dingtalk, lark, wecom,
//!   aiocqhttp, officialaccount, wechatpad}.py`

pub mod dingtalk;
pub mod feishu;
pub mod media;
pub mod official_account;
pub mod qq;
pub mod wecom;
pub mod weixin;

mod creds_encrypt;

use crate::modules::gateway::adapter::PlatformAdapter;
use crate::modules::gateway::platform::PlatformId;
use crate::modules::gateway::registry::GatewayRegistry;
use tauri::Manager;

/// Directory holding persisted gateway credentials as one JSON file per
/// platform. This is a deliberate file-backed store (more reliable than the OS
/// keyring on Windows, where Credential Manager may be unavailable) — it is
/// *not* encrypted at rest. The directory is locked down to owner-only
/// permissions on Unix to limit exposure.
fn creds_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("gateway-creds")
}

fn creds_file(app: &tauri::AppHandle, id: PlatformId) -> std::path::PathBuf {
    creds_dir(app).join(format!("{}.json", id.as_str()))
}

/// Persist a platform's credentials to a JSON file in the app data dir (in
/// addition to the OS keychain). This file-backed store is a deliberate
/// reliability fallback for Windows (where the keyring can be unavailable) and
/// survives restarts on every OS. At rest the file is encrypted with DPAPI on
/// Windows (bound to the current user + machine) and protected by owner-only
/// 0700/0600 permissions on Unix.
pub fn persist_creds_to_file(app: &tauri::AppHandle, id: PlatformId, config_json: &str) {
    let dir = creds_dir(app);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    let bytes = creds_encrypt::encrypt(config_json.as_bytes());
    let _ = std::fs::write(creds_file(app, id), bytes);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(
            creds_file(app, id),
            std::fs::Permissions::from_mode(0o600),
        );
    }
}

/// Read a platform's credentials from the file store if present. On Windows the
/// stored blob is DPAPI-decrypted; if it was written plaintext by an older
/// build (no DPAPI), we transparently fall back to reading it as-is so existing
/// installs keep working.
pub fn read_creds_from_file(app: &tauri::AppHandle, id: PlatformId) -> Option<String> {
    let bytes = std::fs::read(creds_file(app, id)).ok()?;
    // Prefer DPAPI decrypt; fall back to raw UTF-8 (legacy plaintext file).
    if let Some(plain) = creds_encrypt::decrypt(&bytes) {
        if let Ok(s) = String::from_utf8(plain) {
            return Some(s);
        }
    }
    String::from_utf8(bytes).ok()
}

pub fn register_all(registry: &GatewayRegistry) {
    registry.register(Box::new(dingtalk::DingTalkAdapter::new(
        dingtalk::DingTalkConfig::default(),
    )));
    registry.register(Box::new(feishu::FeishuAdapter::new(
        feishu::FeishuConfig::default(),
    )));
    registry.register(Box::new(wecom::WeComAdapter::new(
        wecom::WeComConfig::default(),
    )));
    registry.register(Box::new(qq::QqAdapter::new(qq::QqConfig::default())));
    registry.register(Box::new(weixin::WeixinAdapter::new(
        weixin::WeixinConfig::default(),
    )));
    registry.register(Box::new(official_account::OfficialAccountAdapter::new(
        official_account::OfficialAccountConfig::default(),
    )));
}

/// Build a platform adapter from a JSON credentials blob (same shape the
/// frontend sends to `gateway_configure`).
pub fn build_adapter(id: PlatformId, config_json: &str) -> Result<Box<dyn PlatformAdapter>, String> {
    Ok(match id {
        PlatformId::DingTalk => Box::new(dingtalk::DingTalkAdapter::new(
            serde_json::from_str(config_json).map_err(|e| e.to_string())?,
        )),
        PlatformId::Feishu => Box::new(feishu::FeishuAdapter::new(
            serde_json::from_str(config_json).map_err(|e| e.to_string())?,
        )),
        PlatformId::WeCom => Box::new(wecom::WeComAdapter::new(
            serde_json::from_str(config_json).map_err(|e| e.to_string())?,
        )),
        PlatformId::Qq => Box::new(qq::QqAdapter::new(
            serde_json::from_str(config_json).map_err(|e| e.to_string())?,
        )),
        PlatformId::Weixin => Box::new(weixin::WeixinAdapter::new(
            serde_json::from_str(config_json).map_err(|e| e.to_string())?,
        )),
        PlatformId::OfficialAccount => Box::new(official_account::OfficialAccountAdapter::new(
            serde_json::from_str(config_json).map_err(|e| e.to_string())?,
        )),
    })
}

/// Re-register every platform from its persisted file-backed credentials.
/// Called at startup so configured platforms survive app restarts. The store is
/// plaintext (deliberate file-backed fallback for Windows keyring reliability);
/// on Unix it is locked to owner-only via `persist_creds_to_file`.
pub fn restore_from_keychain(registry: &GatewayRegistry, app: &tauri::AppHandle) {
    const PLATFORMS: [PlatformId; 6] = [
        PlatformId::DingTalk,
        PlatformId::Feishu,
        PlatformId::WeCom,
        PlatformId::Qq,
        PlatformId::Weixin,
        PlatformId::OfficialAccount,
    ];
    for id in PLATFORMS {
        // Read from the file store (reliable across restarts on every OS).
        // The OS keychain is skipped here to avoid a deadlock (block_on inside
        // async fn) and because file-based persistence is more reliable.
        let cfg = read_creds_from_file(app, id);
        if let Some(cfg) = cfg {
            if let Ok(adapter) = build_adapter(id, &cfg) {
                registry.register(adapter);
            }
        }
    }
}
