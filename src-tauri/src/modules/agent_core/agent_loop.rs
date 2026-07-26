//! The Think → Act → Observe agent loop.
//!
//! Drives a single agent session: gets an LLM response, optionally executes
//! tool calls, feeds results back, and repeats until a terminal state.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde_json::Value;

use super::llm::{self, LlmResponse, Message, ToolCall, ToolDef};
use super::tool::ToolRegistry;

/// Agent session state machine.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq)]
pub enum AgentStatus {
    /// Ready to start.
    Idle,
    /// Waiting for LLM response.
    Thinking,
    /// Executing tool calls.
    Acting,
    /// Waiting for user input/approval.
    WaitingForUser,
    /// Finished (success or stop).
    Finished,
    /// Hit step limit.
    MaxStepsReached,
    /// Error state.
    Error(String),
}

/// A single turn in the agent loop.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Turn {
    pub step: u32,
    pub llm_response: String,
    pub tool_calls: Vec<ToolCallInfo>,
    pub tool_results: Vec<ToolCallInfo>,
    pub timestamp: u64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ToolCallInfo {
    pub tool: String,
    pub args: String,
    pub result: String,
    pub success: bool,
    pub duration_ms: u64,
}

/// Agent session configuration.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct AgentConfig {
    pub system_prompt: String,
    pub max_steps: u32,
    pub temperature: f64,
    pub model: String,
    pub provider: String,
    pub api_key: String,
    pub api_base: Option<String>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            system_prompt: "You are an autonomous AI agent inside the OpenAgent development workspace. You have access to tools (read_file, write_file, grep, glob, bash_run, list_directory, todo_write) that let you inspect and modify the codebase. Think step by step. Read before you write. Use todo_write to plan multi-step tasks.".into(),
            max_steps: 25,
            temperature: 0.0,
            model: "gpt-4o".into(),
            provider: "openai".into(),
            api_key: String::new(),
            api_base: None,
        }
    }
}

/// A running agent instance.
pub struct AgentInstance {
    pub id: String,
    pub config: AgentConfig,
    pub status: AgentStatus,
    pub messages: Vec<Message>,
    pub turn_history: Vec<Turn>,
    pub step_count: u32,
    pub total_prompt_tokens: u32,
    pub total_completion_tokens: u32,
    pub created_at: u64,
    pub updated_at: u64,
    /// Signal to stop the agent loop.
    pub stop_requested: Arc<AtomicBool>,
}

impl AgentInstance {
    pub fn new(id: String, config: AgentConfig) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        Self {
            id,
            config,
            status: AgentStatus::Idle,
            messages: Vec::new(),
            turn_history: Vec::new(),
            step_count: 0,
            total_prompt_tokens: 0,
            total_completion_tokens: 0,
            created_at: now,
            updated_at: now,
            stop_requested: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn stop(&self) {
        self.stop_requested.store(true, Ordering::SeqCst);
    }

    pub fn stop_requested(&self) -> bool {
        self.stop_requested.load(Ordering::SeqCst)
    }

    pub fn add_user_message(&mut self, content: &str) {
        // Store as user message
        self.messages.push(Message {
            role: "user".into(),
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        });
    }

    fn add_system_message(&mut self) {
        // Only add if not already present
        if !self.messages.iter().any(|m| m.role == "system") {
            self.messages.insert(0, Message {
                role: "system".into(),
                content: self.config.system_prompt.clone(),
                tool_calls: None,
                tool_call_id: None,
                name: None,
            });
        }
    }

    fn add_assistant_message(&mut self, content: &str, calls: Option<Vec<ToolCall>>) {
        self.messages.push(Message {
            role: "assistant".into(),
            content: content.to_string(),
            tool_calls: calls,
            tool_call_id: None,
            name: None,
        });
    }

    fn add_tool_result(&mut self, tool_call_id: &str, name: &str, content: &str) {
        self.messages.push(Message {
            role: "tool".into(),
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: Some(tool_call_id.to_string()),
            name: Some(name.to_string()),
        });
    }

    fn estimate_token_count(text: &str) -> u32 {
        // Rough estimation: ~4 chars per token
        ((text.len() as f64) / 4.0).ceil() as u32
    }

    fn estimate_context_tokens(messages: &[Message]) -> u32 {
        let mut total = 0u32;
        for msg in messages {
            total += Self::estimate_token_count(&msg.content);
            if let Some(ref calls) = msg.tool_calls {
                for call in calls {
                    total += Self::estimate_token_count(&call.function.name);
                    total += Self::estimate_token_count(&call.function.arguments);
                }
            }
        }
        total
    }

    /// Trim context if it exceeds the token limit
    fn trim_context(&mut self, max_tokens: u32) {
        let estimated = Self::estimate_context_tokens(&self.messages);
        if estimated <= max_tokens {
            return;
        }

        // Keep system message, remove oldest non-system, non-tool messages
        // until under limit
        let mut i = 1; // skip system message at index 0
        while i < self.messages.len() && Self::estimate_context_tokens(&self.messages) > max_tokens {
            let msg = &self.messages[i];
            // Don't remove tool results that are part of active conversation
            if msg.role == "system" {
                i += 1;
                continue;
            }
            // Remove oldest non-essential messages
            self.messages.remove(i);
            // After removal, don't increment i — next element shifts here
        }
    }
}

// ---------------------------------------------------------------------------
// The main agent loop runner
// ---------------------------------------------------------------------------

pub struct AgentRunner {
    registry: Arc<ToolRegistry>,
}

impl AgentRunner {
    pub fn new(registry: Arc<ToolRegistry>) -> Self {
        Self { registry }
    }

    /// Run a single step of the agent loop (think → act → observe).
    /// Returns the status after the step.
    pub fn step(
        &self,
        agent: &mut AgentInstance,
    ) -> Result<AgentStatus, String> {
        if agent.stop_requested() {
            agent.status = AgentStatus::Finished;
            return Ok(AgentStatus::Finished);
        }

        if agent.step_count >= agent.config.max_steps {
            agent.status = AgentStatus::MaxStepsReached;
            return Ok(AgentStatus::MaxStepsReached);
        }

        // Ensure system message is present
        agent.add_system_message();

        // Trim context to stay within reasonable bounds (~128K tokens)
        agent.trim_context(128_000);

        // Build the LLM provider
        let provider = llm::build_provider(
            &agent.config.provider,
            &agent.config.model,
            &agent.config.api_key,
            agent.config.api_base.as_deref(),
        )?;

        // Get tool definitions from registry
        let tool_defs: Vec<ToolDef> = self
            .registry
            .list_defs()
            .into_iter()
            .map(|d| ToolDef {
                def_type: "function".into(),
                function: llm::ToolDefFunction {
                    name: d.name.clone(),
                    description: d.description.clone(),
                    parameters: d.parameters.clone(),
                },
            })
            .collect();

        // ── THINK: Call the LLM ──
        agent.status = AgentStatus::Thinking;
        let llm_response = provider.chat(&agent.messages, &tool_defs)?;

        let (content, tool_calls, usage) = match llm_response {
            LlmResponse::Text { content, usage } => (content, vec![], usage),
            LlmResponse::ToolCalls { calls, usage } => (String::new(), calls, usage),
        };

        agent.total_prompt_tokens += usage.prompt_tokens;
        agent.total_completion_tokens += usage.completion_tokens;

        // ── ACT ──
        agent.step_count += 1;
        agent.updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        if !tool_calls.is_empty() {
            agent.status = AgentStatus::Acting;

            // Register the assistant message with tool calls
            agent.add_assistant_message(&content, Some(tool_calls.clone()));

            // Execute each tool call
            let mut tool_infos = Vec::new();
            for call in &tool_calls {
                if agent.stop_requested() {
                    break;
                }

                let tool_name = &call.function.name;
                let args: Value = match serde_json::from_str(&call.function.arguments) {
                    Ok(v) => v,
                    Err(e) => {
                        let err_msg = format!("failed to parse tool arguments: {e}");
                        agent.add_tool_result(&call.id, tool_name, &err_msg);
                        continue;
                    }
                };

                let start = Instant::now();
                let result = self.registry.execute(tool_name, args.clone());
                let elapsed_ms = start.elapsed().as_millis() as u64;

                match result {
                    Ok(tool_result) => {
                        agent.add_tool_result(
                            &call.id,
                            tool_name,
                            &tool_result.output,
                        );
                        tool_infos.push(ToolCallInfo {
                            tool: tool_name.clone(),
                            args: call.function.arguments.clone(),
                            result: tool_result.output,
                            success: tool_result.success,
                            duration_ms: elapsed_ms,
                        });
                    }
                    Err(e) => {
                        agent.add_tool_result(&call.id, tool_name, &e);
                        tool_infos.push(ToolCallInfo {
                            tool: tool_name.clone(),
                            args: call.function.arguments.clone(),
                            result: String::new(),
                            success: false,
                            duration_ms: elapsed_ms,
                        });
                    }
                }
            }

            // Record the turn
            agent.turn_history.push(Turn {
                step: agent.step_count,
                llm_response: content.clone(),
                tool_calls: tool_infos,
                tool_results: vec![], // results are embedded in tool_calls
                timestamp: agent.updated_at,
            });

            // Continue the loop — next step will process tool results
            // Return acting status so the caller knows to call step() again
            Ok(AgentStatus::Acting)
        } else {
            // Text response — agent is done (or waiting for user)
            agent.add_assistant_message(&content, None);

            agent.turn_history.push(Turn {
                step: agent.step_count,
                llm_response: content.clone(),
                tool_calls: vec![],
                tool_results: vec![],
                timestamp: agent.updated_at,
            });

            agent.status = AgentStatus::Finished;
            Ok(AgentStatus::Finished)
        }
    }

    /// Run the full agent loop until a terminal state.
    #[allow(dead_code)]
    pub fn run_to_completion(
        &self,
        agent: &mut AgentInstance,
        on_step: Option<impl Fn(&Turn)>,
    ) -> Result<AgentStatus, String> {
        loop {
            let status = self.step(agent)?;

            // Notify caller of each turn
            if let Some(ref cb) = on_step {
                if let Some(turn) = agent.turn_history.last() {
                    cb(turn);
                }
            }

            match status {
                AgentStatus::Finished
                | AgentStatus::MaxStepsReached
                | AgentStatus::Error(_)
                | AgentStatus::WaitingForUser => return Ok(status),
                AgentStatus::Acting | AgentStatus::Thinking => {
                    // Continue loop — next step processes tool results
                    continue;
                }
                AgentStatus::Idle => return Ok(AgentStatus::Idle),
            }
        }
    }
}
