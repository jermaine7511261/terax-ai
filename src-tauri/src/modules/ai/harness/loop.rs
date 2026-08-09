//! Loop turn decision core (P0 skeleton; full loop lands in P1). Pure
//! functions mirroring the frontend `lib/loop.ts` contract so the Rust harness
//! can reproduce the existing loop.test.ts decision matrix.

/// Robust exit (: `finish != tool-calls && no pending tool`): the loop
/// should only terminate when the model stopped WITHOUT a pending tool call.
/// A tool-call handoff must continue; the step cap is always a hard stop.
pub fn should_exit_loop(opts: ShouldExitLoop) -> bool {
    if opts.steps_seen >= opts.max_steps {
        return true;
    }
    if opts.has_pending_tool_call {
        return false;
    }
    !matches!(opts.finish_reason.as_str(), "tool-calls" | "tool-call")
}

pub struct ShouldExitLoop {
    pub finish_reason: String,
    pub has_pending_tool_call: bool,
    pub steps_seen: u32,
    pub max_steps: u32,
}

/// Doom-loop detection ( processor.ts): the last `window_size` tool
/// calls sharing the same tool + same serialized args mean the agent is stuck
/// repeating itself.
pub fn detect_doom_loop(recent: &[RecentToolCall], window_size: usize) -> bool {
    if recent.len() < window_size {
        return false;
    }
    let window = &recent[recent.len() - window_size..];
    let first = &window[0];
    window
        .iter()
        .all(|t| t.tool_name == first.tool_name && t.args == first.args)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecentToolCall {
    pub tool_name: String,
    pub args: String,
}

/// Push a tool call onto the rolling window (cap the buffer length).
pub fn push_tool_call(
    recent: &mut Vec<RecentToolCall>,
    call: RecentToolCall,
    max_len: usize,
) {
    recent.push(call);
    if recent.len() > max_len {
        let excess = recent.len() - max_len;
        recent.drain(0..excess);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_exit_when_stopped_without_pending_tool() {
        assert!(should_exit_loop(ShouldExitLoop {
            finish_reason: "stop".into(),
            has_pending_tool_call: false,
            steps_seen: 2,
            max_steps: 24,
        }));
    }

    #[test]
    fn should_not_exit_when_tool_call_pending() {
        assert!(!should_exit_loop(ShouldExitLoop {
            finish_reason: "tool-calls".into(),
            has_pending_tool_call: true,
            steps_seen: 2,
            max_steps: 24,
        }));
    }

    #[test]
    fn step_cap_hard_stops_even_with_pending_tool() {
        assert!(should_exit_loop(ShouldExitLoop {
            finish_reason: "tool-calls".into(),
            has_pending_tool_call: true,
            steps_seen: 24,
            max_steps: 24,
        }));
    }

    #[test]
    fn doom_loop_detected_on_identical_triple() {
        let mut recent = Vec::new();
        for _ in 0..3 {
            push_tool_call(
                &mut recent,
                RecentToolCall {
                    tool_name: "read_file".into(),
                    args: "a".into(),
                },
                12,
            );
        }
        assert!(detect_doom_loop(&recent, 3));
    }

    #[test]
    fn doom_loop_not_detected_on_differing_args() {
        let recent = vec![
            RecentToolCall {
                tool_name: "read_file".into(),
                args: "a".into(),
            },
            RecentToolCall {
                tool_name: "read_file".into(),
                args: "a".into(),
            },
            RecentToolCall {
                tool_name: "read_file".into(),
                args: "b".into(),
            },
        ];
        assert!(!detect_doom_loop(&recent, 3));
    }

    #[test]
    fn doom_loop_needs_full_window() {
        let mut recent = Vec::new();
        push_tool_call(
            &mut recent,
            RecentToolCall {
                tool_name: "read_file".into(),
                args: "a".into(),
            },
            12,
        );
        assert!(!detect_doom_loop(&recent, 3));
    }

    #[test]
    fn push_caps_window_length() {
        let mut recent = Vec::new();
        for i in 0..20 {
            push_tool_call(
                &mut recent,
                RecentToolCall {
                    tool_name: "x".into(),
                    args: i.to_string(),
                },
                12,
            );
        }
        assert_eq!(recent.len(), 12);
    }
}
