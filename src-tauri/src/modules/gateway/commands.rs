//! Tauri commands exposing the gateway to the settings/frontend layer.

use serde::Serialize;
use tauri::State;

use super::adapter::ChatTarget;
use super::message::ChatType;
use super::platform::PlatformId;
use super::registry::GatewayRegistry;

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
