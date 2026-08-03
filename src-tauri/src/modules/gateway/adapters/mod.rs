//! Concrete platform adapters. Each implements the `PlatformAdapter` trait and
//! is registered into the `GatewayRegistry` from the Tauri setup hook.
//!
//! Reference implementations live in:
//! - Hermes  (the Python agent gateway)  → the authority for Weixin iLink,
//!   plus `plugins/platforms/{dingtalk,feishu,wecom,qqbot}` adapters.
//! - LangBot (the Python IM bot platform) → `pkg/platform/sources/{dingtalk,
//!   lark,wecom,aiocqhttp,officialaccount,wechatpad}.py`.

pub mod dingtalk;
pub mod feishu;
pub mod official_account;
pub mod qq;
pub mod wecom;
pub mod weixin;

use crate::modules::gateway::adapter::PlatformAdapter;
use crate::modules::gateway::platform::PlatformId;
use crate::modules::gateway::registry::GatewayRegistry;
use tauri::Manager;

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

/// Re-register every platform from its persisted keychain credentials. Called
/// at startup so configured platforms survive app restarts (credentials never
/// touch disk unencrypted).
pub async fn restore_from_keychain(registry: &GatewayRegistry, app: &tauri::AppHandle) {
    const PLATFORMS: [PlatformId; 6] = [
        PlatformId::DingTalk,
        PlatformId::Feishu,
        PlatformId::WeCom,
        PlatformId::Qq,
        PlatformId::Weixin,
        PlatformId::OfficialAccount,
    ];
    for id in PLATFORMS {
        let secrets_state = app.state::<crate::modules::secrets::SecretsState>();
        let account = format!("gateway:{}", id.as_str());
        match crate::modules::secrets::secrets_get(
            app.clone(),
            secrets_state,
            "yamet-ai".to_string(),
            account,
        )
        .await
        {
            Ok(Some(cfg)) => {
                if let Ok(adapter) = build_adapter(id, &cfg) {
                    registry.register(adapter);
                }
            }
            _ => {}
        }
    }
}
