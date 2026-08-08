//! Computer-use safety core (P3, M1-M2): action schema validation, sensitive
//! regions, action budget, and vision routing — pure + unit-tested.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    #[default]
    Capture,
    Click,
    Type,
    Key,
    Drag,
    Scroll,
    SetValue,
}

/// Maximum action steps per computer-use session (abort past this).
pub const MAX_ACTIONS_PER_SESSION: u32 = 50;

/// Screenshot pixel budget — images larger than this get downscaled so the
/// vision call stays cheap.
pub const MAX_CAPTURE_PIXELS: u64 = 1_500_000;

/// Sensitive regions (fractional 0..1 of the screen) where input injection is
/// refused: top-right corner (system tray / power controls) by default.
pub fn sensitive_region(x: f64, y: f64) -> bool {
    // Top-right 8% x 8% square = OS status area.
    x >= 0.92 && y <= 0.08
}

/// Validate an action request. Returns an error string or `None` when valid.
pub fn validate_action(action: &ComputerAction) -> Option<String> {
    match action.kind {
        ActionKind::Click | ActionKind::Drag => {
            if action.x.is_none() || action.y.is_none() {
                return Some("click/drag requires x,y".into());
            }
        }
        ActionKind::Type => {
            if action.text.as_deref().map(str::trim).unwrap_or("").is_empty() {
                return Some("type requires non-empty text".into());
            }
        }
        ActionKind::Key => {
            if action.key.as_deref().map(str::trim).unwrap_or("").is_empty() {
                return Some("key requires a key name".into());
            }
        }
        ActionKind::Scroll => {
            if action.scroll_dx.is_none() && action.scroll_dy.is_none() {
                return Some("scroll requires dx or dy".into());
            }
        }
        ActionKind::SetValue => {
            if action.text.is_none() {
                return Some("set_value requires text".into());
            }
        }
        ActionKind::Capture => {}
    }
    None
}

/// Gating decision for an input-injection action (M2): needs user approval,
/// and must not target a sensitive region. Returns `Some(reason)` to deny.
pub fn gate_input(action: &ComputerAction, auto_approved: bool) -> Option<String> {
    let is_injection = matches!(
        action.kind,
        ActionKind::Click | ActionKind::Type | ActionKind::Key | ActionKind::Drag | ActionKind::Scroll | ActionKind::SetValue
    );
    if !is_injection {
        return None; // capture is read-only
    }
    if let (Some(x), Some(y)) = (action.x, action.y) {
        if sensitive_region(x, y) {
            return Some("refusing: target is in a sensitive region (OS status area)".into());
        }
    }
    if !auto_approved {
        return Some("input injection requires user approval".into());
    }
    None
}

/// Action budget: refuse after `MAX_ACTIONS_PER_SESSION` injected actions.
pub fn budget_exceeded(actions_used: u32, max: u32) -> bool {
    actions_used >= max
}

/// Vision routing (hermes `should_route_capture_to_aux_vision`, fail-closed):
/// when the main model has no vision, an aux vision call is REQUIRED; when the
/// main model is vision-capable it may describe directly. Returns whether to
/// route to the aux vision pipeline.
pub fn should_route_to_aux_vision(main_model_has_vision: bool, aux_available: bool) -> bool {
    if !main_model_has_vision {
        return true; // fail-closed: main model can't see, must use aux
    }
    !aux_available
}

/// Downscale factor so a WxH capture fits within `MAX_CAPTURE_PIXELS`. Returns
/// a scale 0..=1 (1 = keep original).
pub fn capture_scale(width: u64, height: u64) -> f64 {
    let pixels = width.saturating_mul(height);
    if pixels == 0 || pixels <= MAX_CAPTURE_PIXELS {
        return 1.0;
    }
    (MAX_CAPTURE_PIXELS as f64 / pixels as f64).sqrt().min(1.0)
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerAction {
    pub kind: ActionKind,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub scroll_dx: Option<f64>,
    #[serde(default)]
    pub scroll_dy: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn click(x: f64, y: f64) -> ComputerAction {
        ComputerAction {
            kind: ActionKind::Click,
            x: Some(x),
            y: Some(y),
            text: None,
            key: None,
            scroll_dx: None,
            scroll_dy: None,
        }
    }

    #[test]
    fn capture_is_always_allowed() {
        let a = ComputerAction {
            kind: ActionKind::Capture,
            ..Default::default()
        };
        assert!(validate_action(&a).is_none());
        assert!(gate_input(&a, false).is_none());
    }

    #[test]
    fn click_requires_coordinates() {
        let a = ComputerAction {
            kind: ActionKind::Click,
            ..Default::default()
        };
        assert!(validate_action(&a).is_some());
    }

    #[test]
    fn sensitive_region_denies_input() {
        assert!(sensitive_region(0.95, 0.02)); // top-right status area
        assert!(!sensitive_region(0.5, 0.5));
        assert!(gate_input(&click(0.95, 0.02), true).is_some());
    }

    #[test]
    fn injection_requires_approval() {
        assert!(gate_input(&click(0.5, 0.5), false).is_some());
        assert!(gate_input(&click(0.5, 0.5), true).is_none());
    }

    #[test]
    fn budget_exceeded_at_max() {
        assert!(!budget_exceeded(49, MAX_ACTIONS_PER_SESSION));
        assert!(budget_exceeded(50, MAX_ACTIONS_PER_SESSION));
    }

    #[test]
    fn vision_routing_is_fail_closed() {
        assert!(should_route_to_aux_vision(false, true)); // no main vision → aux
        assert!(should_route_to_aux_vision(false, false));
        assert!(!should_route_to_aux_vision(true, true)); // main can see
        assert!(should_route_to_aux_vision(true, false)); // main can see but aux required for accessibility
    }

    #[test]
    fn scale_reduces_large_captures() {
        // 1920×1080 (2.07M px) exceeds the 1.5M budget → downscale.
        let s = capture_scale(1920, 1080);
        assert!(s < 1.0);
        assert!((s * s * 1920.0 * 1080.0) <= MAX_CAPTURE_PIXELS as f64 + 1.0);
        // 4K even more so.
        let s4k = capture_scale(3840, 2160);
        assert!(s4k < s);
    }

    #[test]
    fn scale_keeps_small_unchanged() {
        assert_eq!(capture_scale(800, 600), 1.0);
    }
}
