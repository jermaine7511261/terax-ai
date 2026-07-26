use std::collections::HashMap;
use std::sync::Mutex;

/// A single credential source.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct CredentialSource {
    pub id: String,
    pub provider: String,
    pub source_type: CredentialSourceType,
    pub priority: u32,
    pub is_active: bool,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum CredentialSourceType {
    /// OS keychain (default, highest priority).
    Keychain,
    /// Environment variable.
    EnvVar { var_name: String },
    /// File-based credential (e.g. ~/.config/terax/keys.json).
    File { path: String },
    /// Plaintext (in-memory, user-entered).
    InMemory,
    /// HTTP endpoint (enterprise credential manager).
    Http { url: String, auth_token: Option<String> },
}

/// A resolved credential with its metadata.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ResolvedCredential {
    pub source_id: String,
    pub provider: String,
    pub api_key: String,
    pub source_type: CredentialSourceType,
    pub resolved_at: String,
}

pub struct CredentialPool {
    sources: Mutex<Vec<CredentialSource>>,
    cache: Mutex<HashMap<String, ResolvedCredential>>,
}

impl Default for CredentialPool {
    fn default() -> Self {
        let mut sources = Vec::new();
        // Register default keychain sources for common providers
        for provider in &["openai", "anthropic", "google", "xai", "groq", "deepseek", "mistral", "openrouter"] {
            sources.push(CredentialSource {
                id: format!("keychain-{provider}"),
                provider: provider.to_string(),
                source_type: CredentialSourceType::Keychain,
                priority: 100,
                is_active: true,
                last_error: None,
            });
        }
        Self {
            sources: Mutex::new(sources),
            cache: Mutex::new(HashMap::new()),
        }
    }
}

impl CredentialPool {
    pub fn new() -> Self { Self::default() }

    pub fn list_sources(&self) -> Result<Vec<CredentialSource>, String> {
        self.sources.lock().map_err(|e| e.to_string()).map(|s| s.clone())
    }

    pub fn register_source(&self, source: CredentialSource) -> Result<(), String> {
        let mut sources = self.sources.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = sources.iter_mut().find(|s| s.id == source.id) {
            *existing = source;
        } else {
            sources.push(source);
        }
        Ok(())
    }

    pub fn remove_source(&self, id: &str) -> Result<(), String> {
        let mut sources = self.sources.lock().map_err(|e| e.to_string())?;
        sources.retain(|s| s.id != id);
        let mut cache = self.cache.lock().map_err(|e| e.to_string())?;
        cache.retain(|k, _| !k.starts_with(&format!("{id}:")));
        Ok(())
    }

    /// Resolve a credential for a provider by trying all matching sources
    /// in priority order.
    pub fn resolve(&self, provider: &str) -> Result<ResolvedCredential, String> {
        let sources = self.sources.lock().map_err(|e| e.to_string())?;
        let mut candidates: Vec<&CredentialSource> = sources.iter()
            .filter(|s| s.provider == provider && s.is_active)
            .collect();
        candidates.sort_by(|a, b| b.priority.cmp(&a.priority));

        if candidates.is_empty() {
            return Err(format!("No credential source for provider '{provider}'"));
        }

        for source in &candidates {
            match self.try_resolve_source(source) {
                Ok(key) => {
                    let now = iso_now();
                    let resolved = ResolvedCredential {
                        source_id: source.id.clone(),
                        provider: source.provider.clone(),
                        api_key: key,
                        source_type: source.source_type.clone(),
                        resolved_at: now.clone(),
                    };
                    let mut cache = self.cache.lock().map_err(|e| e.to_string())?;
                    cache.insert(format!("{provider}"), resolved.clone());
                    return Ok(resolved);
                }
                Err(e) => {
                    // Mark source as failed
                    let _ = e;
                }
            }
        }

        Err(format!("All credential sources for '{provider}' failed"))
    }

    /// Get cached credential without re-resolving.
    pub fn get_cached(&self, provider: &str) -> Result<Option<ResolvedCredential>, String> {
        self.cache.lock().map_err(|e| e.to_string()).map(|c| c.get(provider).cloned())
    }

    /// Invalidate cached credential for a provider.
    pub fn invalidate(&self, provider: &str) -> Result<(), String> {
        let mut cache = self.cache.lock().map_err(|e| e.to_string())?;
        cache.remove(provider);
        Ok(())
    }

    /// Invalidate all cached credentials.
    pub fn invalidate_all(&self) -> Result<(), String> {
        let mut cache = self.cache.lock().map_err(|e| e.to_string())?;
        cache.clear();
        Ok(())
    }

    fn try_resolve_source(&self, source: &CredentialSource) -> Result<String, String> {
        match &source.source_type {
            CredentialSourceType::Keychain => {
                // Delegate to existing secrets module via env var fallback
                let _keyring_account = format!("{}-api-key", source.provider);
                // Try environment variable first
                let env_var = format!("{}_API_KEY", source.provider.to_uppercase().replace('-', "_"));
                if let Ok(val) = std::env::var(&env_var) {
                    if !val.is_empty() {
                        return Ok(val);
                    }
                }
                // Try Tauri secrets (will fail in non-Tauri context gracefully)
                Err(format!("Keychain credential for '{}' not available, set {env_var}", source.id))
            }
            CredentialSourceType::EnvVar { var_name } => {
                std::env::var(var_name).map_err(|_| format!("Env var '{var_name}' not set"))
            }
            CredentialSourceType::File { path } => {
                let expanded = shellexpand::tilde(path).into_owned();
                let content = std::fs::read_to_string(&expanded)
                    .map_err(|e| format!("Cannot read credential file '{path}': {e}"))?;
                let parsed: HashMap<String, String> = serde_json::from_str(&content)
                    .map_err(|_| format!("Invalid JSON in credential file '{path}'"))?;
                let key = parsed.get(&source.provider)
                    .or_else(|| parsed.get("api_key"))
                    .or_else(|| parsed.get("key"))
                    .cloned()
                    .ok_or_else(|| format!("No key for '{}' in credential file", source.provider))?;
                Ok(key)
            }
            CredentialSourceType::InMemory => {
                Err("InMemory credentials must be set via set_in_memory".into())
            }
            CredentialSourceType::Http { url, auth_token: _ } => {
                Err(format!("HTTP credential source '{url}' requires async runtime. Use the async variant."))
            }
        }
    }

    /// Set an in-memory credential (from user input).
    pub fn set_in_memory(&self, provider: &str, key: String) -> Result<(), String> {
        let source_id = format!("memory-{provider}");
        // Register in-memory source
        let mut sources = self.sources.lock().map_err(|e| e.to_string())?;
        if !sources.iter().any(|s| s.id == source_id) {
            sources.push(CredentialSource {
                id: source_id.clone(),
                provider: provider.to_string(),
                source_type: CredentialSourceType::InMemory,
                priority: 200,
                is_active: true,
                last_error: None,
            });
        }
        let mut cache = self.cache.lock().map_err(|e| e.to_string())?;
        cache.insert(provider.to_string(), ResolvedCredential {
            source_id,
            provider: provider.to_string(),
            api_key: key,
            source_type: CredentialSourceType::InMemory,
            resolved_at: iso_now(),
        });
        Ok(())
    }
}

fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs();
    format!("{}", secs)
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn cp_list_sources(pool: tauri::State<'_, CredentialPool>) -> Result<Vec<CredentialSource>, String> {
    pool.list_sources()
}

#[tauri::command]
pub fn cp_register_source(pool: tauri::State<'_, CredentialPool>, source: CredentialSource) -> Result<(), String> {
    pool.register_source(source)
}

#[tauri::command]
pub fn cp_remove_source(pool: tauri::State<'_, CredentialPool>, id: String) -> Result<(), String> {
    pool.remove_source(&id)
}

#[tauri::command]
pub fn cp_resolve(pool: tauri::State<'_, CredentialPool>, provider: String) -> Result<ResolvedCredential, String> {
    pool.resolve(&provider)
}

#[tauri::command]
pub fn cp_set_in_memory(pool: tauri::State<'_, CredentialPool>, provider: String, key: String) -> Result<(), String> {
    pool.set_in_memory(&provider, key)
}

#[tauri::command]
pub fn cp_invalidate(pool: tauri::State<'_, CredentialPool>, provider: Option<String>) -> Result<(), String> {
    match provider {
        Some(p) => pool.invalidate(&p),
        None => pool.invalidate_all(),
    }
}
