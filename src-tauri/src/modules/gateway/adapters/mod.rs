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

use crate::modules::gateway::registry::GatewayRegistry;

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
