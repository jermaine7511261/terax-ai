//! MCP `tools/call` response parsing for key'd web-search providers (Exa /
//! Parallel). These providers speak the Model Context Protocol: they expect a
//! JSON-RPC `tools/call` request and answer with either a JSON-RPC response
//! (`result.content[].text`) or an SSE stream of `data:` frames carrying the
//! same shape. This module normalizes both into a flat list of result-text
//! blobs that the providers then map into [`SearchHit`]s.

use serde_json::Value;

/// Upper bound on the response body a provider may return before we refuse to
/// parse it (protects against unbounded memory from a rogue MCP server).
pub const MAX_RESPONSE_BYTES: usize = 256 * 1024;

/// Error produced when an MCP response cannot be parsed into result text.
#[derive(Debug)]
pub struct McpParseError(pub String);

impl std::fmt::Display for McpParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for McpParseError {}

/// Pull the `result.content[].text` blobs out of a parsed MCP response value.
///
/// Content items may carry `text` as a plain string or as a nested
/// `{"type":"text","text":"..."}` object; a content item that is itself a
/// plain string is also accepted. Returns an empty vec when the value has no
/// parseable text (e.g. an error frame).
fn texts_from_value(value: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let Some(content) = value
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c.as_array())
    else {
        return out;
    };
    for item in content {
        match item {
            Value::String(s) => out.push(s.clone()),
            Value::Object(map) => {
                if let Some(t) = map.get("text") {
                    match t {
                        Value::String(s) => out.push(s.clone()),
                        Value::Object(tmap) => {
                            if let Some(Value::String(s)) = tmap.get("text") {
                                out.push(s.clone());
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// Extract text from a raw body: whole-body JSON first, then SSE `data:`
/// frames. Returns an error only for the truncation guard; an empty collection
/// is returned when no text is present so the caller can classify it as a
/// parse failure.
fn texts_from_bytes(body: &[u8]) -> Result<Vec<String>, McpParseError> {
    let raw = String::from_utf8_lossy(body);

    // 1) Whole-body JSON: a direct JSON-RPC response with no SSE framing.
    if let Ok(value) = serde_json::from_str::<Value>(&raw) {
        let texts = texts_from_value(&value);
        if !texts.is_empty() {
            return Ok(texts);
        }
    }

    // 2) SSE fallback: scan line-by-line for `data:` frames, each a JSON-RPC
    //    response with the same shape. Non-`{` payloads are skipped. Text is
    //    accumulated across all frames.
    let mut out = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(payload) = trimmed.strip_prefix("data: ") {
            let payload = payload.trim();
            if payload.starts_with('{') {
                if let Ok(value) = serde_json::from_str::<Value>(payload) {
                    out.extend(texts_from_value(&value));
                }
            }
        }
    }
    Ok(out)
}

/// Parse an MCP `tools/call` response body into the list of result-text blobs
/// (one per result item).
///
/// Tries the body as a whole JSON-RPC response first, then falls back to
/// scanning SSE `data:` frames. Non-empty text from either path is returned.
/// An error is raised only when no text can be extracted at all (or the body
/// exceeds [`MAX_RESPONSE_BYTES`]).
pub fn parse_mcp_response(body: &[u8]) -> Result<Vec<String>, McpParseError> {
    if body.len() > MAX_RESPONSE_BYTES {
        return Err(McpParseError(format!(
            "mcp response exceeded {MAX_RESPONSE_BYTES} bytes"
        )));
    }
    let texts = texts_from_bytes(body)?;
    if texts.is_empty() {
        return Err(McpParseError(
            "no result text found in mcp response".into(),
        ));
    }
    Ok(texts)
}

#[cfg(test)]
mod tests {
    use super::*;

    const JSON_BODY: &str = r#"{
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "content": [
                {"type": "text", "text": "first"},
                {"type": "text", "text": "second"}
            ]
        }
    }"#;

    const NESTED_TEXT_BODY: &str = r#"{
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "content": [
                {"type": "text", "text": {"type":"text","text":"nested"}},
                "plain-item"
            ]
        }
    }"#;

    const SSE_BODY: &str =
        "event: message\ndata: {\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"sse-1\"}]}}\n\n\
         event: message\ndata: {\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"sse-2\"}]}}\n";

    #[test]
    fn parses_whole_json_response() {
        let texts = parse_mcp_response(JSON_BODY.as_bytes()).unwrap();
        assert_eq!(texts, vec!["first", "second"]);
    }

    #[test]
    fn parses_nested_text_object_and_string_item() {
        let texts = parse_mcp_response(NESTED_TEXT_BODY.as_bytes()).unwrap();
        assert_eq!(texts, vec!["nested", "plain-item"]);
    }

    #[test]
    fn parses_sse_data_frames() {
        let texts = parse_mcp_response(SSE_BODY.as_bytes()).unwrap();
        assert_eq!(texts, vec!["sse-1", "sse-2"]);
    }

    #[test]
    fn sse_skips_non_json_and_non_data_lines() {
        let body = "ping\ndata: not json\ndata: {\"result\":{\"content\":[{\"text\":\"kept\"}]}}\n";
        let texts = parse_mcp_response(body.as_bytes()).unwrap();
        assert_eq!(texts, vec!["kept"]);
    }

    #[test]
    fn rejects_oversized_body() {
        let big = vec![b'x'; MAX_RESPONSE_BYTES + 1];
        let err = parse_mcp_response(&big).unwrap_err();
        assert!(err.0.contains("exceeded"));
    }

    #[test]
    fn rejects_body_with_no_text() {
        let err = parse_mcp_response(
            b"{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-1,\"message\":\"boom\"}}",
        )
        .unwrap_err();
        assert!(!err.0.is_empty());
    }
}
