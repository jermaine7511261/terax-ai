//! §3.6.2 Media generation: AI image generation via OpenAI DALL-E / Gemini / Stability.
//!
//! Each provider uses its own key from the `yamet-ai` keyring service.

use serde::{Deserialize, Serialize};

const MAX_PROMPT_LEN: usize = 4000;
const KEYRING_SERVICE: &str = "yamet-ai";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageResult {
    pub ok: bool,
    pub image_data_url: Option<String>,
    pub provider: String,
    pub model: Option<String>,
    pub error: Option<String>,
}

fn keyring_account_for_provider(provider: &str) -> Result<&'static str, String> {
    match provider {
        "openai" => Ok("openai"),
        "gemini" | "google" => Ok("google"),
        "stability" => Ok("stability"),
        _ => Err(format!(
            "unsupported image provider: {provider} (supported: openai, gemini, stability)"
        )),
    }
}

/// Generate an image via the specified provider. Returns a data-URL string.
#[tauri::command]
pub async fn generate_image(
    app: tauri::AppHandle,
    prompt: String,
    provider: String,
    size: Option<String>,
) -> Result<GenerateImageResult, String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("empty prompt".into());
    }
    if prompt.len() > MAX_PROMPT_LEN {
        return Err(format!("prompt too long ({}, max {MAX_PROMPT_LEN})", prompt.len()));
    }

    let account = keyring_account_for_provider(&provider)?;
    let api_key_opt = crate::modules::secrets::read_key(&app, KEYRING_SERVICE, account)
        .map_err(|e| format!("no API key for {provider}: {e}"))?;
    let api_key = api_key_opt.as_deref().unwrap_or("");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("failed to create HTTP client: {e}"))?;

    match provider.as_str() {
        "openai" => generate_openai(&client, api_key, &prompt, size.as_deref()).await,
        "gemini" | "google" => generate_gemini(&client, api_key, &prompt, size.as_deref()).await,
        "stability" => generate_stability(&client, api_key, &prompt, size.as_deref()).await,
        _ => unreachable!("validated above"),
    }
}

async fn generate_openai(
    client: &reqwest::Client,
    api_key: &str,
    prompt: &str,
    size: Option<&str>,
) -> Result<GenerateImageResult, String> {
    let size_str = size.unwrap_or("1024x1024");
    let body = serde_json::json!({
        "model": "dall-e-3",
        "prompt": prompt,
        "n": 1,
        "size": size_str,
        "response_format": "b64_json",
    });

    let resp = client
        .post("https://api.openai.com/v1/images/generations")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error {status}: {err_body}"));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("OpenAI parse error: {e}"))?;

    let b64 = json["data"][0]["b64_json"]
        .as_str()
        .ok_or_else(|| "OpenAI response missing b64_json".to_string())?;

    let data_url = format!("data:image/png;base64,{b64}");
    Ok(GenerateImageResult {
        ok: true,
        image_data_url: Some(data_url),
        provider: "openai".into(),
        model: Some("dall-e-3".into()),
        error: None,
    })
}

async fn generate_gemini(
    client: &reqwest::Client,
    api_key: &str,
    prompt: &str,
    size: Option<&str>,
) -> Result<GenerateImageResult, String> {
    let body = serde_json::json!({
        "instances": [{"prompt": prompt}],
        "parameters": {
            "sampleCount": 1,
            "aspectRatio": match size.unwrap_or("1024x1024") {
                "1792x1024" => "16:9",
                "1024x1792" => "9:16",
                _ => "1:1",
            },
        },
    });

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key={api_key}"
    );

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!("Gemini API error {status}: {err_body}"));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Gemini parse error: {e}"))?;

    let b64 = json["predictions"][0]["bytesBase64Encoded"]
        .as_str()
        .ok_or_else(|| "Gemini response missing bytesBase64Encoded".to_string())?;

    let data_url = format!("data:image/png;base64,{b64}");
    Ok(GenerateImageResult {
        ok: true,
        image_data_url: Some(data_url),
        provider: "gemini".into(),
        model: Some("imagen-3.0".into()),
        error: None,
    })
}

async fn generate_stability(
    client: &reqwest::Client,
    api_key: &str,
    prompt: &str,
    _size: Option<&str>,
) -> Result<GenerateImageResult, String> {
    let body = serde_json::json!({
        "prompt": prompt,
        "output_format": "png",
    });

    let resp = client
        .post("https://api.stability.ai/v2beta/stable-image/generate/core")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Stability request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!("Stability API error {status}: {err_body}"));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Stability parse error: {e}"))?;

    let b64 = json["image"]
        .as_str()
        .ok_or_else(|| "Stability response missing image".to_string())?;

    let data_url = format!("data:image/png;base64,{b64}");
    Ok(GenerateImageResult {
        ok: true,
        image_data_url: Some(data_url),
        provider: "stability".into(),
        model: Some("stable-image-core".into()),
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyring_accounts_are_valid() {
        assert_eq!(keyring_account_for_provider("openai"), Ok("openai"));
        assert_eq!(keyring_account_for_provider("gemini"), Ok("google"));
        assert_eq!(keyring_account_for_provider("stability"), Ok("stability"));
        assert!(keyring_account_for_provider("unknown").is_err());
    }
}
