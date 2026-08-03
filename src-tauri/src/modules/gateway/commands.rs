//! Tauri commands exposing the gateway to the settings/frontend layer.

use serde::Serialize;
use tauri::State;

use super::adapter::{ChatTarget, PlatformAdapter};
use super::adapters::{dingtalk, feishu, official_account, qq, wecom, weixin};
use super::message::ChatType;
use super::platform::PlatformId;
use super::registry::GatewayRegistry;

/// Reconfigure a platform from a JSON credentials blob. Rebuilds and
/// re-registers the adapter so the new credentials take effect immediately.
#[tauri::command]
pub fn gateway_configure(
    state: State<'_, GatewayRegistry>,
    platform: String,
    config_json: String,
) -> Result<(), String> {
    let id: PlatformId = platform.parse().map_err(|e: String| e)?;
    let adapter: Box<dyn PlatformAdapter> = match id {
        PlatformId::DingTalk => Box::new(dingtalk::DingTalkAdapter::new(
            serde_json::from_str(&config_json).map_err(|e| e.to_string())?,
        )),
        PlatformId::Feishu => Box::new(feishu::FeishuAdapter::new(
            serde_json::from_str(&config_json).map_err(|e| e.to_string())?,
        )),
        PlatformId::WeCom => Box::new(wecom::WeComAdapter::new(
            serde_json::from_str(&config_json).map_err(|e| e.to_string())?,
        )),
        PlatformId::Qq => Box::new(qq::QqAdapter::new(
            serde_json::from_str(&config_json).map_err(|e| e.to_string())?,
        )),
        PlatformId::Weixin => Box::new(weixin::WeixinAdapter::new(
            serde_json::from_str(&config_json).map_err(|e| e.to_string())?,
        )),
        PlatformId::OfficialAccount => Box::new(official_account::OfficialAccountAdapter::new(
            serde_json::from_str(&config_json).map_err(|e| e.to_string())?,
        )),
    };
    state.register(adapter);
    Ok(())
}

#[derive(Serialize)]
pub struct PlatformStatus {
    pub id: String,
    pub label: String,
    pub configured: bool,
    pub connected: bool,
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
            connected: false,
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
