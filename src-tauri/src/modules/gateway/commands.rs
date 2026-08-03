//! Tauri commands exposing the gateway to the settings/frontend layer.

use serde::Serialize;
use tauri::{Manager, State};

use super::adapter::ChatTarget;
use super::adapters::weixin::{run_qr_login, QrLoginFrame, WeixinAdapter, WeixinConfig};
use super::message::ChatType;
use super::platform::PlatformId;
use super::registry::GatewayRegistry;

/// Reconfigure a platform from a JSON credentials blob. Rebuilds and
/// re-registers the adapter and persists the credentials to the OS keychain
/// (service `yamet-ai`) so they survive restarts without touching disk.
#[tauri::command]
pub async fn gateway_configure(
    app: tauri::AppHandle,
    state: State<'_, GatewayRegistry>,
    platform: String,
    config_json: String,
) -> Result<(), String> {
    let secrets_state = app.state::<crate::modules::secrets::SecretsState>();
    crate::modules::secrets::secrets_set(
        app.clone(),
        secrets_state,
        "yamet-ai".to_string(),
        format!("gateway:{platform}"),
        config_json.clone(),
    )
    .await?;
    let id: PlatformId = platform.parse().map_err(|e: String| e)?;
    state.register(super::adapters::build_adapter(id, &config_json)?);
    Ok(())
}

#[derive(Serialize)]
pub struct PlatformStatus {
    pub id: String,
    pub label: String,
    pub configured: bool,
    pub connected: bool,
}

#[derive(Serialize)]
pub struct SessionInfo {
    pub session_key: String,
    pub platform: String,
    pub chat_type: String,
    pub chat_id: String,
    pub authorized: bool,
    pub auto_approve: bool,
    pub awaiting_approval: bool,
    pub last_active_ms: u64,
}

/// List known gateway sessions with their authorization state.
#[tauri::command]
pub fn gateway_sessions(state: State<'_, GatewayRegistry>) -> Vec<SessionInfo> {
    state
        .sessions()
        .all()
        .into_iter()
        .map(|s| SessionInfo {
            session_key: s.session_key,
            platform: s.platform,
            chat_type: s.chat_type,
            chat_id: s.chat_id,
            authorized: s.authorized,
            auto_approve: s.auto_approve,
            awaiting_approval: s.awaiting_approval,
            last_active_ms: s.last_active_ms,
        })
        .collect()
}

/// Approve a session (add to the whitelist) so it may drive the agent.
#[tauri::command]
pub fn gateway_authorize(
    state: State<'_, GatewayRegistry>,
    session_key: String,
) -> Result<(), String> {
    state.sessions().approve(&session_key);
    Ok(())
}

/// Revoke a session (back to default-deny).
#[tauri::command]
pub fn gateway_revoke(
    state: State<'_, GatewayRegistry>,
    session_key: String,
) -> Result<(), String> {
    state.sessions().revoke(&session_key);
    Ok(())
}

/// Toggle per-session auto-approve (bypasses the approval prompt).
#[tauri::command]
pub fn gateway_auto_approve(
    state: State<'_, GatewayRegistry>,
    session_key: String,
    value: bool,
) -> Result<(), String> {
    state.sessions().set_auto_approve(&session_key, value);
    Ok(())
}

#[tauri::command]
pub fn gateway_platforms(state: State<'_, GatewayRegistry>) -> Vec<PlatformStatus> {
    let mut out: Vec<_> = state
        .registered_platforms()
        .iter()
        .map(|id| PlatformStatus {
            id: id.as_str().to_string(),
            label: id.label().to_string(),
            configured: state.is_configured(*id),
            connected: state.is_connected(*id),
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

#[tauri::command]
pub async fn gateway_connect(
    state: State<'_, GatewayRegistry>,
    platform: String,
) -> Result<(), String> {
    let id: PlatformId = platform.parse().map_err(|e: String| e)?;
    state.connect_platform(id).await
}

#[tauri::command]
pub async fn gateway_disconnect(
    state: State<'_, GatewayRegistry>,
    platform: String,
) -> Result<(), String> {
    let id: PlatformId = platform.parse().map_err(|e: String| e)?;
    state.disconnect_platform(id).await;
    Ok(())
}

#[tauri::command]
pub async fn gateway_send(
    state: State<'_, GatewayRegistry>,
    platform: String,
    chat_id: String,
    text: String,
    group: Option<bool>,
) -> Result<(), String> {
    let id: PlatformId = platform.parse().map_err(|e: String| e)?;
    let target = ChatTarget {
        chat_type: if group.unwrap_or(false) {
            ChatType::Group
        } else {
            ChatType::Dm
        },
        chat_id,
        reply_to: None,
    };
    state.send_text(id, &target, &text).await.map(|_| ())
}

/// Run the interactive Weixin iLink QR login flow, streaming QR/status frames
/// to the frontend via a Tauri channel. On confirmation, persists the returned
/// credentials to the keychain and re-registers the adapter, then resolves the
/// channel with the confirmed credentials.
#[tauri::command]
pub async fn gateway_weixin_qr_login(
    app: tauri::AppHandle,
    state: State<'_, GatewayRegistry>,
    on_frame: tauri::ipc::Channel<QrLoginFrame>,
) -> Result<(String, String, String), String> {
    let client = reqwest::Client::builder()
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let result = run_qr_login(&client, &|frame| {
        let _ = on_frame.send(frame);
    })
    .await;

    match result {
        Ok((account_id, token, base_url)) => {
            let config = WeixinConfig {
                base_url: base_url.clone(),
                token: token.clone(),
                account_id: account_id.clone(),
            };
            let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
            // Persist to keychain + re-register so the fresh token survives.
            let secrets_state = app.state::<crate::modules::secrets::SecretsState>();
            crate::modules::secrets::secrets_set(
                app.clone(),
                secrets_state,
                "yamet-ai".to_string(),
                "gateway:weixin".to_string(),
                config_json.clone(),
            )
            .await?;
            state.register(Box::new(WeixinAdapter::new(config)));
            Ok((account_id, token, base_url))
        }
        Err(e) => Err(e),
    }
}

/// Current local callback URLs per platform. Platforms without callbacks
/// (dingtalk/feishu/qq/weixin) return `None`. The settings UI shows these so
/// the user can paste them into the platform admin console (tunneled).
#[tauri::command]
pub fn gateway_callback_urls(state: State<'_, GatewayRegistry>) -> Vec<CallbackUrlInfo> {
    state
        .callback_urls()
        .into_iter()
        .map(|(id, url)| CallbackUrlInfo { id, url })
        .collect()
}

/// Persist fresh Weixin credentials after a **background** QR re-login
/// (session-expired while polling). Unlike `gateway_weixin_qr_login`, this does
/// not re-register the adapter — the poll loop already swapped the live token
/// in memory; we only write the keychain so the new token survives restarts.
#[tauri::command]
pub async fn gateway_weixin_persist(
    app: tauri::AppHandle,
    account_id: String,
    token: String,
    base_url: String,
) -> Result<(), String> {
    if account_id.is_empty() || token.is_empty() {
        return Err("weixin persist: incomplete credentials".into());
    }
    let config = WeixinConfig {
        base_url,
        token,
        account_id,
    };
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    let secrets_state = app.state::<crate::modules::secrets::SecretsState>();
    crate::modules::secrets::secrets_set(
        app.clone(),
        secrets_state,
        "yamet-ai".to_string(),
        "gateway:weixin".to_string(),
        config_json,
    )
    .await
}

#[derive(Serialize)]
pub struct CallbackUrlInfo {
    pub id: String,
    pub url: Option<String>,
}
