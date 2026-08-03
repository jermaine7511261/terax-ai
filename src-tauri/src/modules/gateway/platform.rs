use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// A domestic IM platform the gateway can attach to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformId {
    DingTalk,
    Feishu,
    WeCom,
    Qq,
    Weixin,
    OfficialAccount,
}

impl PlatformId {
    pub fn as_str(&self) -> &'static str {
        match self {
            PlatformId::DingTalk => "dingtalk",
            PlatformId::Feishu => "feishu",
            PlatformId::WeCom => "wecom",
            PlatformId::Qq => "qq",
            PlatformId::Weixin => "weixin",
            PlatformId::OfficialAccount => "official_account",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            PlatformId::DingTalk => "钉钉",
            PlatformId::Feishu => "飞书",
            PlatformId::WeCom => "企业微信",
            PlatformId::Qq => "QQ",
            PlatformId::Weixin => "微信",
            PlatformId::OfficialAccount => "微信公众号",
        }
    }
}

impl fmt::Display for PlatformId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for PlatformId {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "dingtalk" => Ok(PlatformId::DingTalk),
            "feishu" => Ok(PlatformId::Feishu),
            "wecom" => Ok(PlatformId::WeCom),
            "qq" => Ok(PlatformId::Qq),
            "weixin" => Ok(PlatformId::Weixin),
            "official_account" => Ok(PlatformId::OfficialAccount),
            other => Err(format!("unknown platform: {other}")),
        }
    }
}

/// A free-form platform handle (e.g. a configured bot's own id).
pub type PlatformHandle = String;
