use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

pub mod web_fetch;
pub mod web_search;

use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

const HEADER_BLOCKLIST: &[&str] = &[
    "host",
    "content-length",
    "connection",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "transfer-encoding",
    "upgrade",
    "trailer",
    "expect",
];

fn is_blocked_host_name(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    matches!(
        host.as_str(),
        "metadata.google.internal" | "metadata" | "metadata.azure.com"
    )
}

fn ip_kind(ip: IpAddr) -> IpKind {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            // Cloud metadata IPv4: 169.254.169.254
            if v.is_link_local() {
                return IpKind::BlockedMetadata;
            }
            if v.is_loopback() || v.is_unspecified() || v.is_broadcast() || v.is_multicast() {
                return IpKind::Loopback;
            }
            // RFC1918 + CGNAT + benchmarking + IETF
            if o[0] == 10
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
                || (o[0] == 100 && (64..=127).contains(&o[1]))
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
            {
                return IpKind::Private;
            }
            IpKind::Public
        }
        IpAddr::V6(v) => {
            // IPv4-mapped IPv6 (`::ffff:a.b.c.d`) must be classified by its
            // embedded IPv4 address. `Ipv6Addr::is_loopback()`/link-local
            // checks return false for mapped addresses, so without this
            // `::ffff:127.0.0.1` would be Public and `::ffff:169.254.169.254`
            // (cloud metadata) would slip past the metadata block.
            if let Some(v4) = v.to_ipv4_mapped() {
                return ip_kind(IpAddr::V4(v4));
            }
            if v.is_loopback() || v.is_unspecified() || v.is_multicast() {
                return IpKind::Loopback;
            }
            // Cloud metadata IPv6 (AWS): fd00:ec2::254
            let segs = v.segments();
            if segs[0] == 0xfd00 && segs[1] == 0xec2 {
                return IpKind::BlockedMetadata;
            }
            // fe80::/10 link-local
            if segs[0] & 0xffc0 == 0xfe80 {
                return IpKind::BlockedMetadata;
            }
            // fc00::/7 unique-local (private)
            if segs[0] & 0xfe00 == 0xfc00 {
                return IpKind::Private;
            }
            IpKind::Public
        }
    }
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum IpKind {
    Public,
    Private,
    Loopback,
    BlockedMetadata,
}

/// Resolve `host` once and return both its safety classification and the
/// concrete IPs we resolved. Callers can pin reqwest to these IPs to defeat
/// DNS rebinding (where a second lookup returns a different address).
async fn resolve_and_classify(host: &str) -> Result<(IpKind, Vec<IpAddr>), String> {
    // Direct literal? Skip DNS.
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok((ip_kind(ip), vec![ip]));
    }
    let host_owned = host.to_string();
    let lookup = tokio::task::spawn_blocking(move || {
        (host_owned.as_str(), 0u16)
            .to_socket_addrs()
            .map(|it| it.map(|a| a.ip()).collect::<Vec<_>>())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("dns: {e}"))?;
    if lookup.is_empty() {
        return Err("dns: no addresses".into());
    }
    let mut worst = IpKind::Public;
    for ip in &lookup {
        let k = ip_kind(*ip);
        worst = match (worst, k) {
            (_, IpKind::BlockedMetadata) => IpKind::BlockedMetadata,
            (IpKind::BlockedMetadata, _) => IpKind::BlockedMetadata,
            (IpKind::Public, x) => x,
            (x, IpKind::Public) => x,
            (a, _) => a,
        };
    }
    Ok((worst, lookup))
}

use std::net::ToSocketAddrs;

fn validate_url(url: &str, allow_private: bool) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        s => return Err(format!("scheme not allowed: {s}")),
    }
    if parsed.username() != "" || parsed.password().is_some() {
        return Err("userinfo in url is not allowed".into());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "missing host".to_string())?;
    if is_blocked_host_name(host) {
        return Err(format!("host not allowed: {host}"));
    }
    // The actual IP classification has to be async — caller does it.
    let _ = allow_private;
    Ok(parsed)
}

/// Classify the host AND return safe IPs to pin reqwest's resolver to.
/// Defeats DNS rebinding (second-lookup-returns-different-IP) by reusing
/// exactly the addresses that passed `ip_kind`.
async fn classify_and_collect_safe_ips(
    host: &str,
    allow_private: bool,
) -> Result<Vec<IpAddr>, String> {
    let (worst, ips) = resolve_and_classify(host).await?;
    match worst {
        IpKind::BlockedMetadata => return Err(format!("host not allowed: {host}")),
        IpKind::Loopback | IpKind::Private if !allow_private => {
            return Err(format!(
                "host {host} resolves to a private/loopback address; this endpoint requires explicit opt-in",
            ));
        }
        _ => {}
    }
    let safe: Vec<IpAddr> = ips
        .into_iter()
        .filter(|ip| match ip_kind(*ip) {
            IpKind::BlockedMetadata => false,
            IpKind::Loopback | IpKind::Private => allow_private,
            IpKind::Public => true,
        })
        .collect();
    if safe.is_empty() {
        return Err(format!("host {host}: no safe IPs"));
    }
    Ok(safe)
}

fn sanitize_headers(headers: Option<HashMap<String, String>>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    let Some(h) = headers else { return Ok(map) };
    for (k, v) in h {
        let lower = k.to_ascii_lowercase();
        if HEADER_BLOCKLIST.contains(&lower.as_str()) {
            return Err(format!("header not allowed: {k}"));
        }
        // CRLF injection: header value must not contain CR / LF / NUL.
        if v.as_bytes().iter().any(|b| matches!(b, 0 | b'\r' | b'\n')) {
            return Err(format!("header value contains control bytes: {k}"));
        }
        let name = HeaderName::from_bytes(k.as_bytes()).map_err(|e| e.to_string())?;
        let value = HeaderValue::from_str(&v).map_err(|e| e.to_string())?;
        map.insert(name, value);
    }
    Ok(map)
}

#[tauri::command]
pub async fn lm_ping(base_url: String) -> Result<u16, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("empty base url".into());
    }
    let probe = format!("{trimmed}/models");
    let parsed = validate_url(&probe, true)?;
    let client = build_egress_client(&parsed, true).await?;
    client
        .get(parsed)
        .send()
        .await
        .map(|r| r.status().as_u16())
        .map_err(|e| e.to_string())
}
// AI HTTP proxy — bypasses webview CORS / Mixed-Content / PNA so local-network
// model servers (LM Studio, Ollama, vLLM) work in the production bundle.

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

fn build_request(
    client: &reqwest::Client,
    method: &str,
    url: reqwest::Url,
    headers: Option<HashMap<String, String>>,
    body: Option<Vec<u8>>,
) -> Result<reqwest::RequestBuilder, String> {
    let method = Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client.request(method, url);
    let map = sanitize_headers(headers)?;
    req = req.headers(map);
    if let Some(b) = body {
        req = req.body(b);
    }
    Ok(req)
}

fn build_safe_client(
    allow_private: bool,
    pinned: &[(String, Vec<IpAddr>)],
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10));
    // Pin reqwest's resolver to the IPs we just classified. Without this,
    // reqwest's own DNS lookup could return a different (private/metadata) IP
    // for the same hostname between classify and connect — classic DNS
    // rebinding attack. We pin port 0 because reqwest fills in the actual
    // port from the URL when wiring up the override map.
    for (host, ips) in pinned {
        let addrs: Vec<SocketAddr> = ips.iter().map(|ip| SocketAddr::new(*ip, 0)).collect();
        if !addrs.is_empty() {
            builder = builder.resolve_to_addrs(host, &addrs);
        }
    }
    builder
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() > 10 {
                return attempt.error("too many redirects");
            }
            let next = attempt.url();
            match next.scheme() {
                "http" | "https" => {}
                _ => return attempt.stop(),
            }
            if next.username() != "" || next.password().is_some() {
                return attempt.stop();
            }
            let Some(host) = next.host_str() else {
                return attempt.stop();
            };
            if is_blocked_host_name(host) {
                return attempt.stop();
            }
            if let Ok(ip) = host.parse::<IpAddr>() {
                let k = ip_kind(ip);
                if k == IpKind::BlockedMetadata {
                    return attempt.stop();
                }
                if !allow_private && matches!(k, IpKind::Loopback | IpKind::Private) {
                    return attempt.stop();
                }
            } else if !allow_private {
                if let Some(prev) = attempt.previous().last() {
                    if prev.host_str() != Some(host) {
                        return attempt.stop();
                    }
                }
            }
            attempt.follow()
        }))
        .build()
        .map_err(|e| e.to_string())
}

fn header_map_to_strings(headers: &HeaderMap) -> HashMap<String, String> {
    let mut out = HashMap::with_capacity(headers.len());
    for (k, v) in headers {
        if let Ok(s) = v.to_str() {
            out.insert(k.as_str().to_ascii_lowercase(), s.to_string());
        }
    }
    out
}

const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

/// Build a reqwest URL + client for a caller-supplied URL with full SSRF
/// protection (DNS-rebinding pinning, metadata/private blocking). Shared by
/// `ai_http_request` / `ai_http_stream` and the Rust AI harness (native LLM
/// calls must ride the same guardrail, not bypass it with a raw client).
pub(crate) async fn safe_client_for_url(
    url: &str,
    allow_private: bool,
) -> Result<(reqwest::Url, reqwest::Client), String> {
    let parsed = validate_url(url, allow_private)?;
    let client = build_egress_client(&parsed, allow_private).await?;
    Ok((parsed, client))
}

/// Whether the OS has a system proxy configured. Reads proxy env vars and, on
/// Windows, the `Internet Settings` registry (Clash / v2ray / corporate proxies
/// set it there; reqwest's default client honors it once the `system-proxy`
/// feature is enabled). Used to decide between the proxy egress path (no DNS
/// pinning — the proxy owns DNS + routing) and the direct SSRF-pinned path.
fn system_proxy_configured() -> bool {
    for k in [
        "https_proxy",
        "HTTPS_PROXY",
        "http_proxy",
        "HTTP_PROXY",
        "all_proxy",
        "ALL_PROXY",
    ] {
        if std::env::var_os(k).is_some_and(|v| !v.is_empty()) {
            return true;
        }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Registry::{
            RegGetValueW, HKEY_CURRENT_USER, RRF_RT_DWORD,
        };
        fn wide(s: &str) -> Vec<u16> {
            s.encode_utf16().chain(std::iter::once(0)).collect()
        }
        let subkey = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings");
        let value = wide("ProxyEnable");
        let mut enabled: u32 = 0;
        let mut len = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                value.as_ptr(),
                RRF_RT_DWORD,
                std::ptr::null_mut(),
                &mut enabled as *mut u32 as *mut _,
                &mut len,
            )
        };
        if status == 0 && enabled != 0 {
            return true;
        }
    }
    false
}

/// Build the egress client for a validated URL.
///
/// - Literal private/loopback/metadata IP targets always use the direct,
///   fully-classified client (local model servers must never be routed through
///   a proxy; metadata is still blocked).
/// - Public hostnames with a **system proxy** configured use a plain client —
///   reqwest auto-applies the OS proxy, which owns DNS + routing. This is what
///   makes requests work under fake-IP DNS resolvers (Clash / v2ray / sing-box
///   system-proxy mode return synthetic addresses such as 198.18.x.x / fd00::/7
///   that are unreachable by direct connect, which broke every AI request) and
///   through corporate proxies, matching how the OS and browsers reach the
///   endpoint. The DNS-rebinding pin is skipped because the proxy resolves.
/// - No proxy: the SSRF-safe direct client with DNS-rebinding pinning.
async fn build_egress_client(
    parsed: &reqwest::Url,
    allow_private: bool,
) -> Result<reqwest::Client, String> {
    let host = parsed
        .host_str()
        .ok_or_else(|| "missing host".to_string())?
        .to_string();

    // Literal IP target: direct + fully classified.
    if let Ok(ip) = host.parse::<IpAddr>() {
        let k = ip_kind(ip);
        if k == IpKind::BlockedMetadata {
            return Err(format!("host not allowed: {host}"));
        }
        if !allow_private && matches!(k, IpKind::Loopback | IpKind::Private) {
            return Err(format!(
                "host {host} resolves to a private/loopback address; this endpoint requires explicit opt-in"
            ));
        }
        return build_safe_client(allow_private, &[(host, vec![ip])]);
    }

    if system_proxy_configured() {
        // Disable automatic decompression when using a system proxy.
        // Proxies (Clash / v2ray) may return HTML error pages that carry the
        // original `Content-Encoding: gzip` header from the upstream server,
        // causing reqwest's auto-decompression to fail with "error decoding
        // response body".  By disabling auto-decompression, we get raw bytes
        // that match the actual wire format.  SSE responses from LLM providers
        // are plain text (no gzip) when the client omits Accept-Encoding, so
        // this is safe in practice.
        return reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .build()
            .map_err(|e| e.to_string());
    }

    let safe_ips = classify_and_collect_safe_ips(&host, allow_private).await?;
    build_safe_client(allow_private, &[(host, safe_ips)])
}

/// Global budget for in-flight response bodies across concurrent
/// `ai_http_request` calls. Each request reserves its worst-case quota
/// (MAX_RESPONSE_BYTES) up front; when the budget is exhausted, new requests
/// are refused instead of stacking 64 MiB buffers until OOM.
const MAX_INFLIGHT_RESPONSE_BYTES: usize = 256 * 1024 * 1024;
static INFLIGHT_RESPONSE_BYTES: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// RAII reservation of the per-request response quota. Created before the
/// body is read and released on drop, so every exit path (success, error,
/// timeout) frees the reservation.
struct ResponseQuotaGuard;

impl ResponseQuotaGuard {
    fn acquire() -> Result<Self, String> {
        use std::sync::atomic::Ordering;
        let prev =
            INFLIGHT_RESPONSE_BYTES.fetch_add(MAX_RESPONSE_BYTES, Ordering::Relaxed);
        if prev + MAX_RESPONSE_BYTES > MAX_INFLIGHT_RESPONSE_BYTES {
            INFLIGHT_RESPONSE_BYTES.fetch_sub(MAX_RESPONSE_BYTES, Ordering::Relaxed);
            return Err(format!(
                "too many concurrent large responses in flight ({prev} bytes reserved)"
            ));
        }
        Ok(Self)
    }
}

impl Drop for ResponseQuotaGuard {
    fn drop(&mut self) {
        INFLIGHT_RESPONSE_BYTES.fetch_sub(MAX_RESPONSE_BYTES, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Read the response body, enforcing a hard size cap so a misbehaving
/// provider cannot exhaust memory (ai_http_request feeds the AI layer).
async fn read_body_limited(resp: reqwest::Response) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt;
    if let Some(cl) = resp.content_length() {
        if cl > MAX_RESPONSE_BYTES as u64 {
            return Err(format!(
                "response too large ({cl} bytes, limit {MAX_RESPONSE_BYTES})"
            ));
        }
    }
    let mut body = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let c = chunk.map_err(|e| e.to_string())?;
        if body.len() + c.len() > MAX_RESPONSE_BYTES {
            return Err(format!(
                "response exceeds {MAX_RESPONSE_BYTES} byte limit"
            ));
        }
        body.extend_from_slice(&c);
    }
    Ok(body)
}

#[tauri::command]
pub async fn ai_http_request(
    url: String,
    method: String,
    headers: Option<HashMap<String, String>>,
    body: Option<Vec<u8>>,
    allow_private_network: Option<bool>,
) -> Result<HttpResponse, String> {
    let allow_private = allow_private_network.unwrap_or(false);
    let parsed = validate_url(&url, allow_private)?;
    let client = build_egress_client(&parsed, allow_private).await?;

    let req = build_request(&client, &method, parsed, headers, body)?;
    // Reserve in-flight quota before the request; released on drop.
    let _quota = ResponseQuotaGuard::acquire()?;
    let resp = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        req.send(),
    )
    .await
    .map_err(|_| "ai_http_request timed out waiting for response".to_string())?
    .map_err(|e| e.to_string())?;

    let status = resp.status().as_u16();
    let headers = header_map_to_strings(resp.headers());
    let body = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        read_body_limited(resp),
    )
    .await
    .map_err(|_| "ai_http_request timed out reading response body".to_string())??;
    Ok(HttpResponse {
        status,
        headers,
        body,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiStreamEvent {
    Headers {
        status: u16,
        headers: HashMap<String, String>,
    },
    Chunk {
        bytes: Vec<u8>,
    },
    End,
    Error {
        message: String,
    },
}

#[tauri::command]
pub async fn ai_http_stream(
    url: String,
    method: String,
    headers: Option<HashMap<String, String>>,
    body: Option<Vec<u8>>,
    allow_private_network: Option<bool>,
    on_event: Channel<AiStreamEvent>,
) -> Result<(), String> {
    let allow_private = allow_private_network.unwrap_or(false);
    let parsed = match validate_url(&url, allow_private) {
        Ok(p) => p,
        Err(e) => {
            let _ = on_event.send(AiStreamEvent::Error { message: e.clone() });
            return Err(e);
        }
    };
    let client = match build_egress_client(&parsed, allow_private).await {
        Ok(c) => c,
        Err(e) => {
            let _ = on_event.send(AiStreamEvent::Error { message: e.clone() });
            return Err(e);
        }
    };

    let req = build_request(&client, &method, parsed, headers, body)?;
    // Bound the initial response wait and each streamed chunk read so a server
    // that accepts the connection but never responds / stalls mid-stream can't
    // hold the request open forever (no read timeout on the client otherwise).
    let resp = match tokio::time::timeout(
        std::time::Duration::from_secs(60),
        req.send(),
    )
    .await
    {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => {
            let _ = on_event.send(AiStreamEvent::Error {
                message: e.to_string(),
            });
            return Err(e.to_string());
        }
        Err(_) => {
            let m = "ai_http_stream timed out waiting for response".to_string();
            let _ = on_event.send(AiStreamEvent::Error { message: m.clone() });
            return Err(m);
        }
    };

    let status = resp.status().as_u16();
    let headers = header_map_to_strings(resp.headers());
    let _ = on_event.send(AiStreamEvent::Headers { status, headers });

    let mut stream = resp.bytes_stream();
    loop {
        // Bound each streamed chunk read; a stalled upstream can't hang us.
        match tokio::time::timeout(
            std::time::Duration::from_secs(60),
            stream.next(),
        )
        .await
        {
            Ok(Some(chunk)) => {
                let bytes: Bytes = match chunk {
                    Ok(b) => b,
                    Err(e) => {
                        let _ = on_event.send(AiStreamEvent::Error {
                            message: e.to_string(),
                        });
                        return Err(e.to_string());
                    }
                };
                if on_event
                    .send(AiStreamEvent::Chunk {
                        bytes: bytes.to_vec(),
                    })
                    .is_err()
                {
                    // Channel dropped (frontend aborted) — stop streaming.
                    return Ok(());
                }
            }
            Ok(None) => break, // stream ended
            Err(_) => {
                let m = "ai_http_stream timed out reading stream".to_string();
                let _ = on_event.send(AiStreamEvent::Error { message: m.clone() });
                return Err(m);
            }
        }
    }

    let _ = on_event.send(AiStreamEvent::End);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn metadata_ips_classified_as_blocked() {
        // AWS / Google / Azure all share the IPv4 169.254.169.254 link-local.
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254))),
            IpKind::BlockedMetadata
        );
        // AWS IPv6 metadata
        assert_eq!(
            ip_kind("fd00:ec2::254".parse().unwrap()),
            IpKind::BlockedMetadata
        );
        // Any link-local IPv4 (169.254/16) — same network range, still blocked.
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(169, 254, 1, 1))),
            IpKind::BlockedMetadata
        );
        // IPv6 link-local fe80::/10
        assert_eq!(
            ip_kind("fe80::1".parse().unwrap()),
            IpKind::BlockedMetadata
        );
    }

    #[test]
    fn ipv4_mapped_ipv6_classified_by_embedded_ipv4() {
        // `::ffff:` IPv4-mapped IPv6 must be classified by its embedded IPv4
        // address, not by the V6 checks (which return false for mapped forms).
        // Without the to_ipv4_mapped() unwrap these would all be "Public" —
        // a real SSRF bypass: ::ffff:169.254.169.254 reaches cloud metadata.
        assert_eq!(
            ip_kind("::ffff:169.254.169.254".parse().unwrap()),
            IpKind::BlockedMetadata
        );
        assert_eq!(
            ip_kind("::ffff:127.0.0.1".parse().unwrap()),
            IpKind::Loopback
        );
        assert_eq!(
            ip_kind("::ffff:10.0.0.1".parse().unwrap()),
            IpKind::Private
        );
        // A genuinely public mapped address stays Public.
        assert_eq!(
            ip_kind("::ffff:8.8.8.8".parse().unwrap()),
            IpKind::Public
        );
        // Non-mapped V6 (e.g. 64:ff9b:: NAT64) still goes through V6 rules.
        assert_eq!(
            ip_kind("64:ff9b::c0a8:101".parse().unwrap()),
            IpKind::Public
        );
    }

    #[test]
    fn private_ips_classified_correctly() {
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))),
            IpKind::Private
        );
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1))),
            IpKind::Private
        );
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))),
            IpKind::Private
        );
        // CGNAT 100.64/10
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1))),
            IpKind::Private
        );
    }

    #[test]
    fn loopback_classified_as_loopback() {
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))),
            IpKind::Loopback
        );
        assert_eq!(ip_kind("::1".parse().unwrap()), IpKind::Loopback);
    }

    #[test]
    fn public_ips_classified_as_public() {
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))),
            IpKind::Public
        );
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))),
            IpKind::Public
        );
    }

    #[test]
    fn validate_url_blocks_userinfo_and_metadata_hostnames() {
        // URLs with userinfo can confuse browsers / leak creds in redirects.
        assert!(validate_url("http://user:pass@example.com/", true).is_err());
        // Cloud metadata-by-name.
        assert!(validate_url("http://metadata.google.internal/", true).is_err());
        assert!(validate_url("http://metadata/", true).is_err());
        assert!(validate_url("http://metadata.azure.com/", true).is_err());
    }

    #[test]
    fn validate_url_rejects_non_http_schemes() {
        assert!(validate_url("ftp://example.com/", true).is_err());
        assert!(validate_url("file:///etc/passwd", true).is_err());
        assert!(validate_url("javascript:alert(1)", true).is_err());
    }

    #[test]
    fn sanitize_headers_blocks_crlf_injection() {
        let mut h = HashMap::new();
        h.insert("X-Foo".to_string(), "bar\r\nX-Evil: yes".to_string());
        assert!(sanitize_headers(Some(h)).is_err());
    }

    #[test]
    fn sanitize_headers_blocks_hop_by_hop_headers() {
        for hop in [
            "host",
            "content-length",
            "connection",
            "proxy-authorization",
        ] {
            let mut h = HashMap::new();
            h.insert(hop.to_string(), "value".to_string());
            assert!(
                sanitize_headers(Some(h)).is_err(),
                "expected {hop} to be rejected"
            );
        }
    }

    #[test]
    fn response_quota_rejects_when_exhausted_and_releases_on_drop() {
        use std::sync::atomic::Ordering;
        // Budget allows 4 concurrent reservations; the 5th must be refused.
        INFLIGHT_RESPONSE_BYTES.store(0, Ordering::SeqCst);
        let g1 = ResponseQuotaGuard::acquire().unwrap();
        let _g2 = ResponseQuotaGuard::acquire().unwrap();
        let _g3 = ResponseQuotaGuard::acquire().unwrap();
        let _g4 = ResponseQuotaGuard::acquire().unwrap();
        assert!(ResponseQuotaGuard::acquire().is_err());

        // Dropping one reservation frees a slot for a new request.
        drop(g1);
        let _g5 = ResponseQuotaGuard::acquire().unwrap();

        // Restore for other tests.
        INFLIGHT_RESPONSE_BYTES.store(0, Ordering::SeqCst);
    }

    #[test]
    fn system_proxy_detection_runs() {
        // Returns a bool on every platform without panicking (env or registry).
        let _ = system_proxy_configured();
    }

    // One-off connectivity check against the built-in opencode endpoint (this
    // machine uses fake-IP DNS + a system proxy). Kept #[ignore] — network
    // tests must not run in CI. Run manually: cargo test --lib -- --ignored net::egress_reaches_opencode
    #[tokio::test]
    #[ignore]
    async fn egress_reaches_opencode() {
        let url = "https://opencode.ai/zen/go/v1/models";
        let (parsed, client) = safe_client_for_url(url, true).await.unwrap();
        let resp = client.get(parsed).send().await.unwrap();
        assert!(resp.status().is_success(), "status: {}", resp.status());
    }
}
