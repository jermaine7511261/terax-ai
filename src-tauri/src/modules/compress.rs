use std::collections::VecDeque;
use std::sync::Mutex;

/// A compressed message segment.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct CompressedSegment {
    pub index: usize,
    pub original_role: String,
    pub summary: String,
    pub token_estimate: u32,
    pub original_tokens: u32,
    pub compression_ratio: f64,
}

/// Session compression plan.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct CompressionPlan {
    pub segments: Vec<CompressedSegment>,
    pub total_original_tokens: u32,
    pub total_compressed_tokens: u32,
    pub total_savings: u32,
    pub savings_percent: f64,
}

/// Compression strategy.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum CompressionStrategy {
    /// Drop oldest messages first (FIFO).
    DropOldest,
    /// Summarize older messages into short descriptions.
    Summarize,
    /// Keep only tool call + result pairs, drop prose.
    ToolsOnly,
    /// Keep only the most recent N messages.
    Truncate { max_messages: u32 },
}

pub struct SessionCompressor {
    max_tokens: u32,
    strategy: Mutex<CompressionStrategy>,
}

impl SessionCompressor {
    pub fn new(max_tokens: u32) -> Self {
        Self {
            max_tokens,
            strategy: Mutex::new(CompressionStrategy::Summarize),
        }
    }

    pub fn set_strategy(&self, strategy: CompressionStrategy) {
        *self.strategy.lock().unwrap() = strategy;
    }

    /// Analyze a sequence of messages and produce a compression plan.
    pub fn analyze(&self, messages: &[MessageEntry]) -> CompressionPlan {
        let strategy = *self.strategy.lock().unwrap();
        let total_original: u32 = messages.iter().map(|m| m.token_estimate).sum();
        let mut segments = Vec::new();
        let mut compressed_total: u32 = 0;

        if total_original <= self.max_tokens {
            return CompressionPlan {
                segments: vec![],
                total_original_tokens: total_original,
                total_compressed_tokens: total_original,
                total_savings: 0,
                savings_percent: 0.0,
            };
        }

        match strategy {
            CompressionStrategy::DropOldest => {
                let mut queue: VecDeque<&MessageEntry> = messages.iter().collect();
                let mut running = 0u32;
                while let Some(msg) = queue.front() {
                    if running + msg.token_estimate > self.max_tokens {
                        let m = queue.pop_front().unwrap();
                        segments.push(CompressedSegment {
                            index: m.index,
                            original_role: m.role.clone(),
                            summary: "(dropped)".into(),
                            token_estimate: 0,
                            original_tokens: m.token_estimate,
                            compression_ratio: 1.0,
                        });
                    } else {
                        running += msg.token_estimate;
                        // Keep remaining as-is
                        break;
                    }
                }
                compressed_total = running;
            }
            CompressionStrategy::Summarize => {
                // Summarize older messages, keep recent ones intact
                let mut running = 0u32;
                let mut summarize_count = 0u32;
                for msg in messages.iter().rev() {
                    if running + msg.token_estimate > self.max_tokens {
                        summarize_count += 1;
                    } else {
                        running += msg.token_estimate;
                    }
                }
                let keep_from = messages.len().saturating_sub(messages.len() - summarize_count as usize);
                for (i, msg) in messages.iter().enumerate() {
                    if i < keep_from {
                        let summary = truncate(&msg.content, 50);
                        let estimated = (msg.token_estimate as f64 * 0.15) as u32;
                        compressed_total += estimated;
                        segments.push(CompressedSegment {
                            index: msg.index,
                            original_role: msg.role.clone(),
                            summary: format!("[summarized] {summary}"),
                            token_estimate: estimated,
                            original_tokens: msg.token_estimate,
                            compression_ratio: 1.0 - (estimated as f64 / msg.token_estimate.max(1) as f64),
                        });
                    } else {
                        compressed_total += msg.token_estimate;
                    }
                }
            }
            CompressionStrategy::ToolsOnly => {
                for msg in messages {
                    if msg.role == "tool" || msg.role == "tool-result" {
                        compressed_total += msg.token_estimate;
                    } else {
                        let estimated = (msg.token_estimate as f64 * 0.1) as u32;
                        compressed_total += estimated;
                        segments.push(CompressedSegment {
                            index: msg.index,
                            original_role: msg.role.clone(),
                            summary: "(tools-only)".into(),
                            token_estimate: estimated,
                            original_tokens: msg.token_estimate,
                            compression_ratio: 1.0 - (estimated as f64 / msg.token_estimate.max(1) as f64),
                        });
                    }
                }
            }
            CompressionStrategy::Truncate { max_messages } => {
                let keep = (max_messages as usize).min(messages.len());
                for (i, msg) in messages.iter().enumerate() {
                    if i < messages.len() - keep {
                        compressed_total += 0;
                        segments.push(CompressedSegment {
                            index: msg.index,
                            original_role: msg.role.clone(),
                            summary: "(truncated)".into(),
                            token_estimate: 0,
                            original_tokens: msg.token_estimate,
                            compression_ratio: 1.0,
                        });
                    } else {
                        compressed_total += msg.token_estimate;
                    }
                }
            }
        }

        CompressionPlan {
            segments,
            total_original_tokens: total_original,
            total_compressed_tokens: compressed_total,
            total_savings: total_original.saturating_sub(compressed_total),
            savings_percent: if total_original > 0 {
                (total_original.saturating_sub(compressed_total)) as f64 / total_original as f64 * 100.0
            } else {
                0.0
            },
        }
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct MessageEntry {
    pub index: usize,
    pub role: String,
    pub content: String,
    pub token_estimate: u32,
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max.saturating_sub(1)])
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn compress_analyze(
    compressor: tauri::State<'_, SessionCompressor>,
    messages: Vec<MessageEntry>,
) -> Result<CompressionPlan, String> {
    Ok(compressor.analyze(&messages))
}

#[tauri::command]
pub fn compress_set_strategy(
    compressor: tauri::State<'_, SessionCompressor>,
    strategy: CompressionStrategy,
) -> Result<(), String> {
    compressor.set_strategy(strategy);
    Ok(())
}

#[tauri::command]
pub fn compress_estimate_tokens(text: String) -> Result<u32, String> {
    // Simple estimation: ~4 chars per token for English
    Ok(((text.len() as f64) / 4.0).ceil() as u32)
}
