//! Native OpenAI-compatible chat completions client (P0).
//!
//! The Rust AI harness calls the model directly over the same SSRF-guarded
//! reqwest client as `ai_http_stream` (via `net::safe_client_for_url`) — never
//! a raw client. Streaming is SSE-decoded here; the harness only sees decoded
//! deltas, so the frontend never touches HTTP for model calls.

use serde::{Deserialize, Serialize};
use serde_json::json;

const CHAT_COMPLETIONS_PATH: &str = "/chat/completions";
const MAX_ERROR_BODY_BYTES: usize = 4 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: ToolFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFunction {
    pub name: String,
    /// JSON-encoded arguments string, as the wire format requires.
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub role: ChatRole,
    /// String content for plain turns; a parts array (text/image) when the
    /// caller builds multi-part content. `None` for tool-call handoffs.
    pub content: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: ChatRole::System,
            content: Some(serde_json::Value::String(content.into())),
            name: None,
            tool_call_id: None,
            tool_calls: None,
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: ChatRole::User,
            content: Some(serde_json::Value::String(content.into())),
            name: None,
            tool_call_id: None,
            tool_calls: None,
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: ChatRole::Assistant,
            content: Some(serde_json::Value::String(content.into())),
            name: None,
            tool_call_id: None,
            tool_calls: None,
        }
    }

    pub fn tool(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: ChatRole::Tool,
            content: Some(serde_json::Value::String(content.into())),
            name: None,
            tool_call_id: Some(tool_call_id.into()),
            tool_calls: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolFunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolDef {
    #[serde(rename = "type")]
    pub kind: String,
    pub function: ToolFunctionDef,
}

impl ToolDef {
    pub fn function(
        name: impl Into<String>,
        description: impl Into<String>,
        parameters: serde_json::Value,
    ) -> Self {
        Self {
            kind: "function".into(),
            function: ToolFunctionDef {
                name: name.into(),
                description: description.into(),
                parameters,
            },
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChatOptions {
    pub base_url: String,
    pub api_key: Option<String>,
    pub allow_private_network: bool,
}

#[derive(Debug, Clone, Default)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub tools: Option<Vec<ToolDef>>,
    pub reasoning_effort: Option<String>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

/// Pure request-body builder. `stream` is always true in practice but kept
/// parameterized for tests.
pub fn build_chat_body(req: &ChatRequest, stream: bool) -> serde_json::Value {
    let mut body = json!({
        "model": req.model,
        "messages": req.messages,
        "stream": stream,
    });
    if let Some(tools) = &req.tools {
        if !tools.is_empty() {
            body["tools"] = json!(tools);
        }
    }
    if let Some(effort) = &req.reasoning_effort {
        body["reasoning_effort"] = json!(effort);
    }
    if let Some(temp) = req.temperature {
        body["temperature"] = json!(temp);
    }
    if let Some(max) = req.max_tokens {
        body["max_tokens"] = json!(max);
    }
    body
}

/// Incremental SSE decoder: buffers partial lines across chunk boundaries and
/// yields complete `data:` payloads (prefix stripped, trailing whitespace
/// removed). Pure and unit-tested.
#[derive(Debug, Default)]
pub struct SseDecoder {
    buf: Vec<u8>,
}

impl SseDecoder {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    /// Feed a stream chunk; returns any complete `data:` payloads it contained.
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        let mut out = Vec::new();
        let mut start = 0usize;
        for (i, &b) in chunk.iter().enumerate() {
            if b == b'\n' {
                self.buf.extend_from_slice(&chunk[start..i]);
                let line = String::from_utf8_lossy(&self.buf).trim_end_matches('\r').to_string();
                self.buf.clear();
                if let Some(payload) = line.strip_prefix("data:") {
                    let trimmed = payload.trim();
                    if !trimmed.is_empty() {
                        out.push(trimmed.to_string());
                    }
                }
                start = i + 1;
            }
        }
        self.buf.extend_from_slice(&chunk[start..]);
        out
    }

    /// Flush any trailing line that ended without a newline (stream end).
    pub fn flush(&mut self) -> Vec<String> {
        if self.buf.is_empty() {
            return Vec::new();
        }
        let line = String::from_utf8_lossy(&self.buf).trim_end_matches('\r').to_string();
        self.buf.clear();
        if let Some(payload) = line.strip_prefix("data:") {
            let trimmed = payload.trim();
            if trimmed.is_empty() {
                Vec::new()
            } else {
                vec![trimmed.to_string()]
            }
        } else {
            Vec::new()
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    #[serde(rename = "prompt_tokens_details")]
    pub prompt_tokens_details: Option<PromptTokensDetails>,
}

#[derive(Debug, Clone, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PromptTokensDetails {
    pub cached_tokens: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatChunk {
    pub id: Option<String>,
    pub choices: Vec<ChunkChoice>,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ChunkChoice {
    #[serde(default)]
    pub index: usize,
    pub delta: Option<Delta>,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct Delta {
    pub role: Option<String>,
    pub content: Option<String>,
    #[serde(rename = "reasoning_content")]
    pub reasoning_content: Option<String>,
    #[serde(rename = "tool_calls")]
    pub tool_calls: Option<Vec<DeltaToolCall>>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct DeltaToolCall {
    pub index: usize,
    pub id: Option<String>,
    pub function: Option<DeltaFunction>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct DeltaFunction {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SseEvent {
    Chunk(ChatChunk),
    Done,
}

/// Parse a single `data:` payload into a stream event. `[DONE]` terminates.
pub fn parse_sse_payload(payload: &str) -> Result<SseEvent, String> {
    if payload == "[DONE]" {
        return Ok(SseEvent::Done);
    }
    let chunk: ChatChunk =
        serde_json::from_str(payload).map_err(|e| format!("sse parse: {e}"))?;
    Ok(SseEvent::Chunk(chunk))
}

/// A tool call whose `arguments` may arrive as several JSON fragments.
#[derive(Debug, Clone, Default)]
pub struct PartialToolCall {
    pub index: usize,
    pub id: String,
    pub name: String,
    pub arguments: String,
}

/// Accumulates fragmented tool-call deltas into complete tool calls.
#[derive(Debug, Default)]
pub struct ToolCallAccumulator {
    calls: Vec<PartialToolCall>,
}

impl ToolCallAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn apply(&mut self, delta: &Delta) {
        let Some(calls) = &delta.tool_calls else {
            return;
        };
        for tc in calls {
            let idx = tc.index;
            while self.calls.len() <= idx {
                self.calls.push(PartialToolCall::default());
            }
            let slot = &mut self.calls[idx];
            if let Some(id) = &tc.id {
                slot.id = id.clone();
            }
            if let Some(f) = &tc.function {
                if let Some(name) = &f.name {
                    slot.name = name.clone();
                }
                if let Some(args) = &f.arguments {
                    slot.arguments.push_str(args);
                }
            }
        }
    }

    /// Produce final wire-format tool calls. Emits `ToolCall` with a stable id.
    pub fn finalize(self) -> Vec<ToolCall> {
        self.calls
            .into_iter()
            .map(|c| ToolCall {
                id: c.id,
                kind: "function".into(),
                function: ToolFunction {
                    name: c.name,
                    arguments: c.arguments,
                },
            })
            .collect()
    }
}

/// Decoded stream events surfaced to the harness.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatStreamEvent {
    ContentDelta(String),
    ReasoningDelta(String),
    ToolCallStart { index: usize, id: String, name: String },
    ToolCallDelta { index: usize, args: String },
    Finish { finish_reason: Option<String>, usage: Option<Usage> },
}

/// Stream a chat completion. Emits decoded events via `on_event`; returns
/// `Err` on HTTP/transport/parse failure (message already human-readable).
pub async fn stream_chat_completions(
    opts: &ChatOptions,
    req: &ChatRequest,
    mut on_event: impl FnMut(ChatStreamEvent) -> Result<(), String>,
) -> Result<(), String> {
    let endpoint = format!(
        "{}{}",
        opts.base_url.trim_end_matches('/'),
        CHAT_COMPLETIONS_PATH
    );
    let (url, client) = crate::modules::net::safe_client_for_url(
        &endpoint,
        opts.allow_private_network,
    )
    .await?;

    let mut req_builder = client.post(url).header("content-type", "application/json");
    if let Some(key) = &opts.api_key {
        if !key.is_empty() {
            req_builder = req_builder.header("authorization", format!("Bearer {key}"));
        }
    }
    let body = build_chat_body(req, true);
    let body_bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;

    let resp = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        req_builder.body(body_bytes).send(),
    )
    .await
    .map_err(|_| "timed out waiting for model response".to_string())?
    .map_err(|e| e.to_string())?;

    let status = resp.status();
    if !status.is_success() {
        let body_text = read_error_body(resp).await;
        return Err(format!("model api error {status}: {body_text}"));
    }

    let mut decoder = SseDecoder::new();
    let mut acc = ToolCallAccumulator::new();
    let mut stream = resp.bytes_stream();
    loop {
        let chunk = match tokio::time::timeout(
            std::time::Duration::from_secs(60),
            stream.next(),
        )
        .await
        {
            Ok(Some(Ok(bytes))) => bytes,
            Ok(Some(Err(e))) => return Err(format!("model stream error: {e}")),
            Ok(None) => break,
            Err(_) => return Err("timed out reading model stream".to_string()),
        };
        for payload in decoder.feed(&chunk) {
            match parse_sse_payload(&payload)? {
                SseEvent::Done => {
                    let _ = decoder.flush();
                    return Ok(());
                }
                SseEvent::Chunk(c) => {
                    if let Some(usage) = &c.usage {
                        on_event(ChatStreamEvent::Finish {
                            finish_reason: None,
                            usage: Some(usage.clone()),
                        })?;
                    }
                    for choice in &c.choices {
                        let Some(delta) = &choice.delta else {
                            continue;
                        };
                        // Record which tool-call slots existed before this delta
                        // so a fresh slot can emit its id/name once.
                        let prev_slots = acc.calls.len();
                        acc.apply(delta);
                        if let Some(content) = &delta.content {
                            if !content.is_empty() {
                                on_event(ChatStreamEvent::ContentDelta(content.clone()))?;
                            }
                        }
                        if let Some(reasoning) = &delta.reasoning_content {
                            if !reasoning.is_empty() {
                                on_event(ChatStreamEvent::ReasoningDelta(reasoning.clone()))?;
                            }
                        }
                        if let Some(calls) = &delta.tool_calls {
                            for tc in calls {
                                let args = tc
                                    .function
                                    .as_ref()
                                    .and_then(|f| f.arguments.as_ref())
                                    .cloned()
                                    .unwrap_or_default();
                                if tc.index >= prev_slots {
                                    on_event(ChatStreamEvent::ToolCallStart {
                                        index: tc.index,
                                        id: tc.id.clone().unwrap_or_default(),
                                        name: tc
                                            .function
                                            .as_ref()
                                            .and_then(|f| f.name.clone())
                                            .unwrap_or_default(),
                                    })?;
                                }
                                if !args.is_empty() {
                                    on_event(ChatStreamEvent::ToolCallDelta {
                                        index: tc.index,
                                        args,
                                    })?;
                                }
                            }
                        }
                        if let Some(fr) = &choice.finish_reason {
                            on_event(ChatStreamEvent::Finish {
                                finish_reason: Some(fr.clone()),
                                usage: c.usage.clone(),
                            })?;
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

async fn read_error_body(resp: reqwest::Response) -> String {
    let mut body = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                if body.len() + bytes.len() > MAX_ERROR_BODY_BYTES {
                    break;
                }
                body.extend_from_slice(&bytes);
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&body).chars().take(500).collect()
}

use futures_util::StreamExt;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_decoder_yields_complete_data_payloads() {
        let mut d = SseDecoder::new();
        let out = d.feed(b"data: {\"a\":1}\n\ndata: [DONE]\n\n");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0], "{\"a\":1}");
        assert_eq!(out[1], "[DONE]");
    }

    #[test]
    fn sse_decoder_buffers_partial_lines_across_chunks() {
        let mut d = SseDecoder::new();
        assert!(d.feed(b"data: {\"a\"").is_empty());
        let out = d.feed(b":1}\n");
        assert_eq!(out, vec!["{\"a\":1}".to_string()]);
    }

    #[test]
    fn sse_decoder_strips_crlf_and_ignores_non_data_lines() {
        let mut d = SseDecoder::new();
        let out = d.feed(b"event: message\r\ndata: x\r\n\r\n");
        assert_eq!(out, vec!["x".to_string()]);
    }

    #[test]
    fn sse_decoder_flush_returns_trailing_payload() {
        let mut d = SseDecoder::new();
        d.feed(b"data: tail");
        assert_eq!(d.flush(), vec!["tail".to_string()]);
    }

    #[test]
    fn parse_sse_payload_done() {
        assert_eq!(parse_sse_payload("[DONE]").unwrap(), SseEvent::Done);
    }

    #[test]
    fn parse_sse_payload_chunk_with_delta() {
        let payload = r#"{"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}"#;
        match parse_sse_payload(payload).unwrap() {
            SseEvent::Chunk(c) => {
                let delta = c.choices[0].delta.as_ref().unwrap();
                assert_eq!(delta.content.as_deref(), Some("Hi"));
                assert_eq!(c.choices[0].finish_reason, None);
            }
            SseEvent::Done => panic!("expected chunk"),
        }
    }

    #[test]
    fn parse_sse_payload_rejects_garbage() {
        assert!(parse_sse_payload("not json").is_err());
    }

    #[test]
    fn tool_call_accumulator_joins_fragmented_arguments() {
        let mut acc = ToolCallAccumulator::new();
        acc.apply(&Delta {
            role: None,
            content: None,
            reasoning_content: None,
            tool_calls: Some(vec![DeltaToolCall {
                index: 0,
                id: Some("call_1".into()),
                function: Some(DeltaFunction {
                    name: Some("read_file".into()),
                    arguments: Some("{\"path\":\"".into()),
                }),
            }]),
        });
        acc.apply(&Delta {
            role: None,
            content: None,
            reasoning_content: None,
            tool_calls: Some(vec![DeltaToolCall {
                index: 0,
                id: None,
                function: Some(DeltaFunction {
                    name: None,
                    arguments: Some("src/main.rs\"}".into()),
                }),
            }]),
        });
        let calls = acc.finalize();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[0].function.name, "read_file");
        assert_eq!(calls[0].function.arguments, "{\"path\":\"src/main.rs\"}");
    }

    #[test]
    fn tool_call_accumulator_orders_by_index() {
        let mut acc = ToolCallAccumulator::new();
        acc.apply(&Delta {
            role: None,
            content: None,
            reasoning_content: None,
            tool_calls: Some(vec![
                DeltaToolCall {
                    index: 1,
                    id: Some("b".into()),
                    function: Some(DeltaFunction {
                        name: Some("grep".into()),
                        arguments: None,
                    }),
                },
                DeltaToolCall {
                    index: 0,
                    id: Some("a".into()),
                    function: Some(DeltaFunction {
                        name: Some("read_file".into()),
                        arguments: None,
                    }),
                },
            ]),
        });
        let calls = acc.finalize();
        assert_eq!(calls[0].function.name, "read_file");
        assert_eq!(calls[1].function.name, "grep");
    }

    #[test]
    fn build_chat_body_includes_optional_fields() {
        let req = ChatRequest {
            model: "m".into(),
            messages: vec![ChatMessage::user("hi")],
            tools: Some(vec![ToolDef::function("read_file", "Read a file", json!({"type":"object"}))]),
            reasoning_effort: Some("medium".into()),
            temperature: Some(0.5),
            max_tokens: Some(100),
        };
        let body = build_chat_body(&req, true);
        assert_eq!(body["model"], "m");
        assert_eq!(body["stream"], true);
        assert_eq!(body["reasoning_effort"], "medium");
        assert_eq!(body["temperature"], 0.5);
        assert_eq!(body["max_tokens"], 100);
        assert!(body["tools"].is_array());
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn build_chat_body_omits_tools_when_empty() {
        let req = ChatRequest {
            model: "m".into(),
            messages: vec![],
            tools: Some(vec![]),
            reasoning_effort: None,
            temperature: None,
            max_tokens: None,
        };
        let body = build_chat_body(&req, true);
        assert!(body.get("tools").is_none());
        assert!(body.get("reasoning_effort").is_none());
    }
}
