//! Authoritative, backend-side path-safety guard for the AI read/write path.
//!
//! The frontend `src/modules/ai/lib/security.ts` is the first gate; this is the
//! second, authoritative one. AI-sourced (`source == "ai"`) reads and writes
//! must pass this policy *in addition to* any workspace-authorization check.
//! Editor/explorer operations (no `source` or `source != "ai"`) carry their own
//! user trust and are intentionally not gated here — a user opening their own
//! `.env` is legitimate.
//!
//! The rules mirror `security.ts`: sensitive basenames, protected directories,
//! and system write prefixes, compared against a normalized comparison form
//! (forward slashes, stripped drive prefix, stripped NTFS alternate-data-stream
//! suffix, stripped trailing dots/spaces, lowercased, collapsed slashes).

use std::path::Path;

/// Sensitive-file basename patterns, matched against the file's basename.
const SECRET_BASENAME_PATTERNS: &[&str] = &[
    // `.env`, `.env.<suffix>`, and Windows trailing-dot/space / ADS variants.
    // NOTE: keep in sync with `SECRET_BASENAME_PATTERNS` in
    // `src/modules/ai/lib/security.ts` (enforced by scripts/check-doc-drift.mjs).
    r"^\.env(\..+)?(?:[.\s:]|$)",
    r"^.*\.pem(?:[.\s:]|$)",
    r"^.*\.key(?:[.\s:]|$)",
    r"^.*\.p12(?:[.\s:]|$)",
    r"^.*\.pfx(?:[.\s:]|$)",
    r"^.*\.asc(?:[.\s:]|$)",
    r"^.*\.gpg(?:[.\s:]|$)",
    r"^.*\.keystore(?:[.\s:]|$)",
    r"^.*\.jks(?:[.\s:]|$)",
    r"^id_(rsa|dsa|ecdsa|ed25519)([._-].*)?(?:[.\s:]|$)",
    r"^known_hosts(?:[.\s:]|$)",
    r"^authorized_keys(?:[.\s:]|$)",
    r"^htpasswd(?:[.\s:]|$)",
    r"^\.netrc(?:[.\s:]|$)",
    r"^_netrc(?:[.\s:]|$)",
    r"^credentials(?:[.\s:]|$)",
    r"^\.pgpass(?:[.\s:]|$)",
    r"^\.npmrc(?:[.\s:]|$)",
    r"^\.pypirc(?:[.\s:]|$)",
    r"^secrets?\.(json|ya?ml|toml|env)(?:[.\s:]|$)",
    r"^service[-_]?account.*\.json(?:[.\s:]|$)",
];

/// Protected directories. Matched as exact-or-descendant (segment-anchored),
/// never a raw substring. Listed without trailing slash.
const PROTECTED_DIRS: &[&str] = &[
    "/.ssh",
    "/.gnupg",
    "/.aws",
    "/.azure",
    "/.kube",
    "/.docker",
    "/.config/gh",
    "/.config/git",
    "/.config/gcloud",
    "/.config/op",
    "/.git",
    "/.terraform.d",
    "/library/keychains",
    "/library/cookies",
    "/etc",
    "/private/etc",
    "/proc",
    "/sys",
    "/var/db",
    "/var/root",
    "/private/var/db",
    "/private/var/root",
    "/appdata/roaming/microsoft/credentials",
    "/appdata/local/microsoft/credentials",
    "/appdata/roaming/gcloud",
];

/// Write-only deny prefixes (system locations). Read access is not universally
/// blocked — reading `/etc/hosts` is fine; writing to it isn't.
const WRITE_DENY_PREFIXES: &[&str] = &[
    "/etc/",
    "/var/db/",
    "/var/root/",
    "/system/",
    "/library/keychains/",
    "/library/launchagents/",
    "/library/launchdaemons/",
    "/private/etc/",
    "/private/var/db/",
    "/usr/bin/",
    "/usr/sbin/",
    "/usr/local/bin/",
    "/bin/",
    "/sbin/",
    "/boot/",
    "/windows/",
    "/program files/",
    "/program files (x86)/",
    "/programdata/",
];

/// Build the normalized *comparison surface* — never used as a real path.
/// Mirrors `security.ts#comparisonForm`.
fn comparison_form(p: &str) -> String {
    let mut s = p.replace('\\', "/");
    // UNC / extended-length prefix: \\?\C:\... or //?/C:/... -> strip up to drive.
    if let Some(rest) = s.strip_prefix("//?/") {
        s = rest.to_string();
    }
    // Drive prefix: C:/foo -> /foo (before lowercasing).
    if s.len() >= 2 && s.as_bytes()[0].is_ascii_alphabetic() && s.as_bytes()[1] == b':' {
        s = s[2..].to_string();
    }
    // Strip NTFS alternate-data-stream syntax from each segment (`name:stream`).
    s = s
        .split('/')
        .map(|seg| seg.split(':').next().unwrap_or(seg).to_string())
        .collect::<Vec<_>>()
        .join("/");
    // Strip trailing dots/spaces from each segment (Windows behavior).
    s = s
        .split('/')
        .map(|seg| seg.trim_end_matches(['.', ' ', '\t']).to_string())
        .collect::<Vec<_>>()
        .join("/");
    // Collapse duplicate slashes.
    while s.contains("//") {
        s = s.replace("//", "/");
    }
    s = s.to_lowercase();
    // Drop trailing slash so "/foo/" and "/foo" compare equal.
    if s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    s
}

/// Whether `cmp` is equal-to-or-inside the protected dir (segment-anchored).
fn is_under_protected(cmp: &str, dir: &str) -> bool {
    format!("{cmp}/").contains(&format!("{dir}/"))
}

/// Test a basename against the secret patterns.
fn secret_basename_match(base: &str) -> bool {
    // Compile the static pattern list once; the AI read/write path calls this
    // on every guarded path, so per-call `Regex::new` would be pure waste.
    static PATTERNS: std::sync::OnceLock<Vec<regex::Regex>> = std::sync::OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        SECRET_BASENAME_PATTERNS
            .iter()
            .map(|re| regex::Regex::new(re).expect("static secret basename pattern"))
            .collect()
    });
    let lowered = base.to_lowercase();
    patterns.iter().any(|r| r.is_match(&lowered))
}

fn basename(p: &str) -> &str {
    match p.rfind(['/', '\\']) {
        Some(i) => &p[i + 1..],
        None => p,
    }
}

/// Guard for reads. Rejects empty/NUL/control-byte paths, secret basenames,
/// and paths inside protected directories. Mirrors `security.ts#checkReadable`.
pub fn check_readable(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("Refused: empty path.".into());
    }
    if path.contains('\0') || path.chars().any(|c| ('\u{0}'..'\u{20}').contains(&c)) {
        return Err("Refused: path contains control bytes.".into());
    }
    if secret_basename_match(basename(path)) {
        return Err(format!("Refused: {:?} matches a sensitive-file pattern.", basename(path)));
    }
    let cmp = comparison_form(path);
    for dir in PROTECTED_DIRS {
        if is_under_protected(&cmp, dir) {
            return Err(format!("Refused: path is inside a protected directory ({dir})."));
        }
    }
    Ok(())
}

/// Guard for writes. Inherits all read restrictions, plus system-directory
/// prefix blocks. Mirrors `security.ts#checkWritable`.
pub fn check_writable(path: &str) -> Result<(), String> {
    check_readable(path)?;
    let cmp = comparison_form(path);
    let cmp_for_prefix = if cmp.starts_with('/') { cmp.clone() } else { format!("/{cmp}") };
    for prefix in WRITE_DENY_PREFIXES {
        if cmp_for_prefix.starts_with(prefix) || format!("{cmp_for_prefix}/").starts_with(prefix) {
            return Err(format!(
                "Refused: writes under {:?} are not allowed.",
                prefix.trim_end_matches('/')
            ));
        }
    }
    Ok(())
}

/// Full guard used by the AI read path: policy + (when a registry is
/// available) workspace authorization. `target` is the resolved absolute path.
/// Pass `None` for the registry when the caller has no app context (e.g. unit
/// tests) — the denylist still applies; workspace authorization is skipped.
pub fn check_read_path_authorized(
    target: &Path,
    source: &Option<String>,
    registry: Option<&crate::modules::workspace::WorkspaceRegistry>,
) -> Result<(), String> {
    if source.as_deref() != Some("ai") {
        return Ok(());
    }
    let disp = target.to_string_lossy();
    check_readable(&disp)?;
    // Workspace authorization for AI reads too — mirrors the write gate.
    if let Some(registry) = registry {
        if let Ok(canon) = std::fs::canonicalize(target) {
            if !registry.is_authorized(&canon) {
                return Err(format!(
                    "AI read refused: {} is outside the authorized workspace",
                    target.display()
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_env_files() {
        assert!(check_readable("/Users/me/proj/.env").is_err());
        assert!(check_readable("/Users/me/proj/.env.production").is_err());
        assert!(check_readable("/Users/me/proj/.env").is_err());
    }

    #[test]
    fn rejects_ssh_dir_and_keys() {
        assert!(check_readable("/Users/me/.ssh/id_rsa").is_err());
        assert!(check_readable("/Users/me/.ssh/config").is_err());
        assert!(check_readable("/home/u/.ssh").is_err());
    }

    #[test]
    fn rejects_pem_and_private_keys() {
        assert!(check_readable("/data/server.pem").is_err());
        assert!(check_readable("/data/foo.p12").is_err());
        assert!(check_readable("/home/u/id_ed25519.bak").is_err());
    }

    #[test]
    fn allows_normal_project_files() {
        assert!(check_readable("/Users/me/proj/src/main.ts").is_ok());
        assert!(check_readable("/Users/me/proj/package.json").is_ok());
        assert!(check_readable("/Users/me/proj/.gitignore").is_ok());
    }

    #[test]
    fn rejects_case_variants() {
        // Protected dirs compare case-insensitively.
        assert!(check_readable("/Users/me/.SSH/id_rsa").is_err());
    }

    #[test]
    fn rejects_ntfs_stream_and_drive() {
        // C:\Users\me\.ssh\id_rsa::$DATA must be caught.
        assert!(check_readable(r"C:\Users\me\.ssh\id_rsa::$DATA").is_err());
        // Drive prefix stripped before protected-dir matching.
        assert!(check_readable(r"C:\Users\me\.ssh\config").is_err());
    }

    #[test]
    fn rejects_etc_and_proc() {
        assert!(check_readable("/etc/passwd").is_err());
        assert!(check_readable("/private/etc/shadow").is_err());
        assert!(check_readable("/proc/self/environ").is_err());
    }

    #[test]
    fn write_blocks_system_prefixes_but_normal_writes_allowed() {
        // /etc is a protected dir: read and write both refused.
        assert!(check_readable("/etc/hosts").is_err());
        assert!(check_writable("/etc/hosts").is_err());
        // Write to /usr/bin blocked.
        assert!(check_writable("/usr/bin/tool").is_err());
        assert!(check_writable("/windows/system32/x.dll").is_err());
        // Normal project write allowed.
        assert!(check_writable("/Users/me/proj/src/new.ts").is_ok());
    }

    #[test]
    fn rejects_control_bytes_and_empty() {
        assert!(check_readable("").is_err());
        assert!(check_readable("/foo/\0bar").is_err());
        assert!(check_readable("/foo/\u{1}baz").is_err());
    }

    #[test]
    fn non_ai_source_skipped() {
        // check_read_path_authorized is a no-op for non-ai sources.
        assert!(check_read_path_authorized(
            Path::new("/Users/me/.ssh/id_rsa"),
            &Some("editor".to_string()),
            None,
        )
        .is_ok());
    }

    #[test]
    fn ai_source_still_blocked_without_registry() {
        // Even with no registry (unit-test caller), the denylist still applies.
        assert!(check_read_path_authorized(
            Path::new("/Users/me/.ssh/id_rsa"),
            &Some("ai".to_string()),
            None,
        )
        .is_err());
    }
}
