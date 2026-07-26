//! LLM provider abstraction for the agent core.
//!
//! Supports any OpenAI-compatible API (OpenAI, Anthropic, local Ollama/LMStudio,
//! etc.) via HTTP POST requests. Uses `reqwest` which is already a dependency.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A chat message in the conversation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub role: String, // "system" | "user" | "assistant" | "tool"
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// A tool call request from the LLM.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String, // "function"
    pub function: ToolCallFunction,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolCallFunction {
    pub name: String,
    pub arguments: String, // JSON string
}

/// A tool result to feed back to the LLM.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub role: String, // "tool"
    pub content: String,
    pub name: String,
}

/// Tool definition for the LLM API.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolDef {
    #[serde(rename = "type")]
    pub def_type: String, // "function"
    pub function: ToolDefFunction,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolDefFunction {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

// OpenAI chat completion API structures

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    tools: Option<Vec<ToolDef>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    #[serde(default)]
    choices: Vec<Choice>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Deserialize)]
struct Choice {
    message: ChatMessage,
    #[allow(dead_code)]
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct Usage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<StreamChoice>,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct StreamChoice {
    #[serde(default)]
    delta: Delta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[allow(dead_code)]
#[derive(Deserialize, Default)]
struct Delta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<StreamToolCall>>,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct StreamToolCall {
    index: u64,
    #[serde(default)]
    id: Option<String>,
    #[serde(rename = "type")]
    #[serde(default)]
    call_type: Option<String>,
    #[serde(default)]
    function: Option<StreamToolFunction>,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct StreamToolFunction {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

/// Result from an LLM call.
#[derive(Clone, Debug)]
pub enum LlmResponse {
    Text {
        content: String,
        usage: TokenUsage,
    },
    ToolCalls {
        calls: Vec<ToolCall>,
        usage: TokenUsage,
    },
}

#[derive(Clone, Copy, Debug, Default)]
pub struct TokenUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
}

// ---------------------------------------------------------------------------
// Provider trait
// ---------------------------------------------------------------------------

pub trait LlmProvider: Send + Sync {
    /// Chat completion with possible tool calls.
    fn chat(
        &self,
        messages: &[Message],
        tools: &[ToolDef],
    ) -> Result<LlmResponse, String>;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider
// ---------------------------------------------------------------------------

pub struct OpenAiCompatibleProvider {
    api_base: String,
    api_key: String,
    model: String,
    client: reqwest::blocking::Client,
    max_tokens: u32,
    temperature: f64,
}

impl OpenAiCompatibleProvider {
    pub fn new(api_base: &str, api_key: &str, model: &str) -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(120))
            .user_agent("openagent-agent-core/0.1")
            .build()
            .unwrap_or_default();

        Self {
            api_base: api_base.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
            model: model.to_string(),
            client,
            max_tokens: 4096,
            temperature: 0.0,
        }
    }

    pub fn with_max_tokens(mut self, n: u32) -> Self {
        self.max_tokens = n;
        self
    }

    pub fn with_temperature(mut self, t: f64) -> Self {
        self.temperature = t;
        self
    }

    fn convert_messages(messages: &[Message]) -> Vec<ChatMessage> {
        messages
            .iter()
            .map(|m| {
                let mut cm = ChatMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                    tool_calls: None,
                    tool_call_id: None,
                    name: None,
                };
                // Check if assistant message has tool_calls
                if m.role == "assistant" {
                    if let Some(ref calls) = m.tool_calls {
                        cm.tool_calls = Some(calls.clone());
                    }
                }
                if m.role == "tool" {
                    cm.tool_call_id = m.tool_call_id.clone();
                    cm.name = m.name.clone();
                }
                cm
            })
            .collect()
    }
}

impl LlmProvider for OpenAiCompatibleProvider {
    fn chat(
        &self,
        messages: &[Message],
        tools: &[ToolDef],
    ) -> Result<LlmResponse, String> {
        let url = format!("{}/chat/completions", self.api_base);

        let request_body = ChatCompletionRequest {
            model: self.model.clone(),
            messages: Self::convert_messages(messages),
            tools: if tools.is_empty() { None } else { Some(tools.to_vec()) },
            temperature: Some(self.temperature),
            max_tokens: Some(self.max_tokens),
            stream: false,
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .map_err(|e| format!("LLM request failed: {e}"))?;

        let status = response.status();
        let body = response
            .text()
            .map_err(|e| format!("LLM response read failed: {e}"))?;

        if !status.is_success() {
            return Err(format!(
                "LLM API error ({}): {}",
                status.as_u16(),
                &body.chars().take(500).collect::<String>()
            ));
        }

        let completion: ChatCompletionResponse = serde_json::from_str(&body)
            .map_err(|e| format!("LLM response parse failed: {e}"))?;

        let choice = completion
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| "LLM returned no choices".to_string())?;

        let usage = completion.usage.map(|u| TokenUsage {
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
        }).unwrap_or_default();

        if let Some(calls) = choice.message.tool_calls {
            if !calls.is_empty() {
                return Ok(LlmResponse::ToolCalls {
                    calls,
                    usage,
                });
            }
        }

        Ok(LlmResponse::Text {
            content: choice.message.content,
            usage,
        })
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/// Build a provider from a provider kind string and config.
pub fn build_provider(
    kind: &str,
    model: &str,
    api_key: &str,
    base_url: Option<&str>,
) -> Result<Box<dyn LlmProvider>, String> {
    match kind {
        "openai" => Ok(Box::new(OpenAiCompatibleProvider::new(
            base_url.unwrap_or("https://api.openai.com/v1"),
            api_key,
            model,
        ))),
        "anthropic" => Ok(Box::new(OpenAiCompatibleProvider::new(
            base_url.unwrap_or("https://api.anthropic.com/v1"),
            api_key,
            model,
        ))),
        "google" => Ok(Box::new(OpenAiCompatibleProvider::new(
            base_url.unwrap_or("https://generativelanguage.googleapis.com/v1beta/openai"),
            api_key,
            model,
        ))),
        "ollama" => Ok(Box::new(OpenAiCompatibleProvider::new(
            base_url.unwrap_or("http://localhost:11434/v1"),
            api_key,
            model,
        ))),
        "lmstudio" => Ok(Box::new(OpenAiCompatibleProvider::new(
            base_url.unwrap_or("http://localhost:1234/v1"),
            "",
            model,
        ))),
        "openai-compatible" => {
            let base = base_url.ok_or_else(|| "base_url required for openai-compatible provider")?;
            Ok(Box::new(OpenAiCompatibleProvider::new(base, api_key, model)))
        }
        _ => Err(format!("unsupported LLM provider: {kind}")),
    }
}
