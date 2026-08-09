//! CLI agent front-end (round 25 补齐, 十六轮 CLI 愿景): `YaMet --prompt`.
//!
//! Print-mode single-turn chat: reads model config from flags/env, resolves
//! the key from keyring (or `YAMET_API_KEY` for headless), and streams a chat
//! completion to stdout via the native `ai::client` (SSRF-guarded). No Tauri
//! runtime — this runs before `run()` like `__mcp_server` / `--pty-helper`.

use std::io::Write;

use crate::modules::ai::client::{self, ChatMessage, ChatRequest, ChatStreamEvent};

const KEYRING_SERVICE: &str = "yamet-ai";

pub struct CliOptions {
    pub prompt: String,
    pub base_url: String,
    pub model: String,
    pub keyring_account: Option<String>,
    pub system: String,
    pub allow_private_network: bool,
    pub reasoning_effort: Option<String>,
}

/// Parse `YaMet --prompt "..." [--model m] [--base-url u] [--keyring-account a]`.
pub fn parse_prompt_args(args: &[String]) -> Result<CliOptions, String> {
    fn value(args: &[String], name: &str) -> Option<String> {
        args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
    }
    let prompt = value(args, "--prompt").ok_or_else(|| "--prompt <text> is required".to_string())?;
    if prompt.trim().is_empty() {
        return Err("--prompt must not be empty".into());
    }
    let base_url = value(args, "--base-url")
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("YAMET_BASE_URL").ok().filter(|s| !s.is_empty()))
        .unwrap_or_else(|| "https://api.deepseek.com".to_string());
    let model = value(args, "--model")
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("YAMET_MODEL").ok().filter(|s| !s.is_empty()))
        .unwrap_or_else(|| "deepseek-v4-flash".to_string());
    let keyring_account = value(args, "--keyring-account").or_else(|| {
        std::env::var("YAMET_KEYRING_ACCOUNT").ok().filter(|s| !s.is_empty())
    });
    let system = value(args, "--system")
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("YAMET_SYSTEM").ok().filter(|s| !s.is_empty()))
        .unwrap_or_else(|| "You are YaMet, a concise engineering assistant.".to_string());
    let allow_private = args.iter().any(|a| a == "--allow-private");
    let reasoning_effort = value(args, "--reasoning-effort").filter(|s| !s.is_empty());
    Ok(CliOptions {
        prompt,
        base_url,
        model,
        keyring_account,
        system,
        allow_private_network: allow_private,
        reasoning_effort,
    })
}

/// Resolve the API key: keyring account when given, else `YAMET_API_KEY`.
fn resolve_key(account: Option<&str>) -> Result<Option<String>, String> {
    if let Ok(env) = std::env::var("YAMET_API_KEY") {
        if !env.is_empty() {
            return Ok(Some(env));
        }
    }
    let Some(acc) = account.filter(|a| !a.is_empty()) else {
        return Ok(None);
    };
    #[cfg(not(target_os = "linux"))]
    {
        let e = keyring::Entry::new(KEYRING_SERVICE, acc).map_err(|e| e.to_string())?;
        match e.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(err.to_string()),
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Linux keyring uses a file store resolved via the app data dir, which
        // needs the Tauri runtime. Fall back to env for headless Linux CLI.
        Ok(None)
    }
}

/// Run a single-turn prompt and stream the answer to stdout. Returns exit
/// code (0 ok, 1 error).
pub fn run_prompt(opts: &CliOptions) -> i32 {
    let key = match resolve_key(opts.keyring_account.as_deref()) {
        Ok(k) => k,
        Err(e) => {
            eprintln!("[YaMet cli] key lookup failed: {e}");
            return 1;
        }
    };
    let options = client::ChatOptions {
        base_url: opts.base_url.clone(),
        api_key: key,
        allow_private_network: opts.allow_private_network,
    };
    let request = ChatRequest {
        model: opts.model.clone(),
        messages: vec![
            ChatMessage::system(opts.system.clone()),
            ChatMessage::user(opts.prompt.clone()),
        ],
        tools: None,
        reasoning_effort: opts.reasoning_effort.clone(),
        temperature: None,
        max_tokens: None,
    };

    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[YaMet cli] runtime init failed: {e}");
            return 1;
        }
    };

    rt.block_on(async {
        match client::stream_chat_completions(&options, &request, |ev| {
            if let ChatStreamEvent::ContentDelta(text) = ev {
                print!("{text}");
                let _ = std::io::stdout().flush();
            }
            Ok(())
        })
        .await
        {
            Ok(()) => {
                println!();
                0
            }
            Err(e) => {
                eprintln!("\n[YaMet cli] error: {e}");
                1
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parse_requires_prompt() {
        assert!(parse_prompt_args(&args(&["--model", "m"])).is_err());
    }

    #[test]
    fn parse_defaults_model_and_base_url() {
        let o = parse_prompt_args(&args(&["--prompt", "hi"])).unwrap();
        assert_eq!(o.model, "deepseek-v4-flash");
        assert_eq!(o.base_url, "https://api.deepseek.com");
        assert!(!o.allow_private_network);
    }

    #[test]
    fn parse_reads_flags() {
        let o = parse_prompt_args(&args(&[
            "--prompt", "q", "--model", "m1", "--base-url", "http://x/v1",
            "--keyring-account", "acc", "--allow-private", "--reasoning-effort", "high",
        ]))
        .unwrap();
        assert_eq!(o.model, "m1");
        assert_eq!(o.base_url, "http://x/v1");
        assert_eq!(o.keyring_account.as_deref(), Some("acc"));
        assert!(o.allow_private_network);
        assert_eq!(o.reasoning_effort.as_deref(), Some("high"));
    }

    #[test]
    fn parse_env_fallbacks_override_nothing() {
        // Without flags, env vars fill defaults; we can't set env in a parallel
        // test safely, so assert the static defaults hold.
        let o = parse_prompt_args(&args(&["--prompt", "hi"])).unwrap();
        assert_eq!(o.base_url, "https://api.deepseek.com");
    }

    #[test]
    fn resolve_key_prefers_env() {
        std::env::set_var("YAMET_API_KEY", "sk-test-env");
        assert_eq!(resolve_key(None).unwrap().as_deref(), Some("sk-test-env"));
        std::env::remove_var("YAMET_API_KEY");
    }
}
