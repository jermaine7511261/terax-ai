//! SFTP remote file browsing via the system `sftp` client in batch mode.
//!
//! The remote path is passed as a single argv argument to `sftp` (never
//! through a shell), so hostile values cannot inject commands. Directory
//! listing parses the `ls -la` line format; reading downloads to a temp file
//! and returns its content (bounded).

use std::io::Write;
use std::io::Read;
use std::process::{Command, Stdio};

use super::target::SshTarget;
use crate::modules::ssh::target::clean_component;

const READ_BYTE_CAP: usize = 4 * 1024 * 1024;
const WRITE_BYTE_CAP: usize = 4 * 1024 * 1024;

/// Read a local file as UTF-8 while enforcing `READ_BYTE_CAP` on the raw byte
/// length *during* the read (not after loading the whole file into memory).
fn read_bounded_text(path: &std::path::Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("sftp read open: {e}"))?;
    let meta = file
        .metadata()
        .map_err(|e| format!("sftp read stat: {e}"))?;
    if meta.len() > READ_BYTE_CAP as u64 {
        return Err(format!(
            "sftp: remote file is {} bytes, exceeds {} MiB read cap",
            meta.len(),
            READ_BYTE_CAP / (1024 * 1024)
        ));
    }
    // `take` caps the read loop so even an inconsistent stat can't pull the
    // whole file into memory before the limit check fires.
    let mut buf = Vec::with_capacity(meta.len().min(READ_BYTE_CAP as u64) as usize);
    file.take(READ_BYTE_CAP as u64 + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("sftp read: {e}"))?;
    if buf.len() > READ_BYTE_CAP {
        return Err("sftp: remote file exceeds 4 MiB read cap".into());
    }
    String::from_utf8(buf).map_err(|e| format!("sftp read utf8: {e}"))
}

/// Quote a path for an sftp batch command so names with spaces/special chars
/// survive tokenization. `sftp` batch mode does not do shell quoting, so we
/// re-quote with single quotes and escape embedded single quotes.
fn quote_batch(arg: &str) -> String {
    format!("'{}'", arg.replace('\'', "'\\''"))
}

/// Quote a single path token. Returns an error if it contains control chars.
fn sanitize_remote_path(path: &str) -> Result<String, String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("sftp: empty remote path".into());
    }
    if p.chars().any(char::is_control) {
        return Err("sftp: remote path contains control characters".into());
    }
    Ok(quote_batch(p))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub kind: String, // "dir" | "file" | "link" | "other"
    pub size: u64,
}

fn build_base(target: &SshTarget) -> Result<Command, String> {
    // Host/user are sanitized exactly like the interactive ssh path so a
    // hostile value can't smuggle extra `sftp`/`ssh` options via argv.
    let host = clean_component(&target.host, "host")?;
    let user = match &target.user {
        Some(u) if !u.trim().is_empty() => Some(clean_component(u, "user")?),
        _ => None,
    };

    let mut cmd = Command::new("sftp");
    // StrictHostKeyChecking=ask needs a TTY; sftp -b - has none, so on a first
    // connect to an unknown host it would fail. Use the same "ask, but fail
    // with a clear message rather than hang" posture the tunnel path uses:
    // accept the host key only if it's already known; otherwise error out.
    cmd.args(["-o", "StrictHostKeyChecking=ask", "-o", "BatchMode=yes"]);
    if let Some(port) = target.port {
        if !(1..=65535).contains(&port) {
            return Err(format!("sftp: port out of range: {port}"));
        }
        cmd.args(["-P", &port.to_string()]);
    }
    if let Some(id) = &target.identity_file {
        let id = clean_component(id, "identity file")?;
        cmd.args(["-i", &id]);
    }
    let dest = match user {
        Some(u) => format!("{u}@{host}"),
        None => host,
    };
    cmd.arg(dest);
    Ok(cmd)
}

/// Run an sftp batch script; returns stdout on success.
fn run_batch(target: &SshTarget, script: &str) -> Result<String, String> {
    let mut cmd = build_base(target)?;
    cmd.arg("-b")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("sftp spawn: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("sftp: no stdin")?;
    // Script terminates with `quit`; stdin closes after writing.
    let script_owned = script.to_string();
    std::thread::spawn(move || {
        let _ = stdin.write_all(script_owned.as_bytes());
    });
    let out = child
        .wait_with_output()
        .map_err(|e| format!("sftp wait: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("sftp: {}", err.trim().lines().last().unwrap_or("failed")));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Parse a single `ls -la` line into an entry. Format (OpenSSH sftp):
///   drwxr-xr-x    5 user group     4096 Aug  1 12:00 dirname
/// Returns None for non-matching lines (total, blank, errors).
pub fn parse_ls_line(line: &str) -> Option<SftpEntry> {
    let line = line.trim_end_matches('\r');
    if line.is_empty() || line.starts_with("total ") || line.starts_with("Couldn't") {
        return None;
    }
    let mut parts = line.split_whitespace();
    let perms = parts.next()?;
    if perms.len() != 10 || !perms.starts_with('-') && !perms.starts_with('d') && !perms.starts_with('l') {
        return None;
    }
    let _links = parts.next()?;
    let _user = parts.next()?;
    let _group = parts.next()?;
    let size: u64 = parts.next()?.parse().ok()?;
    // Month day [time|year] name...
    let _m = parts.next()?;
    let _d = parts.next()?;
    let _t = parts.next()?;
    let name = parts.collect::<Vec<_>>().join(" ");
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }
    let kind = if perms.starts_with('d') {
        "dir"
    } else if perms.starts_with('l') {
        "link"
    } else if perms.starts_with('-') {
        "file"
    } else {
        "other"
    };
    Some(SftpEntry { name, kind: kind.to_string(), size })
}

/// List a remote directory.
#[tauri::command]
pub async fn sftp_list(target: SshTarget, path: String) -> Result<Vec<SftpEntry>, String> {
    let path = sanitize_remote_path(&path)?;
    let script = format!("ls -la {path}\nquit\n");
    let out = tokio::task::spawn_blocking(move || run_batch(&target, &script))
        .await
        .map_err(|e| e.to_string())??;
    Ok(out.lines().filter_map(parse_ls_line).collect())
}

/// Read a remote file's content (bounded). First stats the file via `ls -la`
/// to reject over-cap files *before* downloading, then `get`s to a temp file,
/// reads it back, and removes it. This avoids reading a huge file into memory.
#[tauri::command]
pub async fn sftp_read(target: SshTarget, path: String) -> Result<String, String> {
    let quoted = sanitize_remote_path(&path)?;
    // Pre-flight size check: bail out before pulling a multi-GB file.
    let stat_script = format!("ls -la {quoted}\nquit\n");
    let target_for_stat = target.clone();
    let stat_out = tokio::task::spawn_blocking(move || run_batch(&target_for_stat, &stat_script))
        .await
        .map_err(|e| e.to_string())??;
    let size = stat_out
        .lines()
        .find_map(parse_ls_line)
        .map(|e| e.size)
        .unwrap_or(0);
    if size > READ_BYTE_CAP as u64 {
        return Err(format!(
            "sftp: remote file is {} bytes, exceeds {} MiB read cap",
            size,
            READ_BYTE_CAP / (1024 * 1024)
        ));
    }

    let dir = tempfile::tempdir().map_err(|e| format!("sftp tempdir: {e}"))?;
    let local = dir.path().join("yamet-remote");
    // Quote the local temp path too: a Windows user dir containing a space
    // (e.g. C:\Users\John Doe\...) would otherwise be split by sftp's batch
    // tokenizer.
    let local_quoted = quote_batch(&local.display().to_string());
    let script = format!("get {quoted} {local_quoted}\nquit\n");
    tokio::task::spawn_blocking(move || run_batch(&target, &script))
        .await
        .map_err(|e| e.to_string())??;
    read_bounded_text(&local)
}

#[tauri::command]
pub async fn sftp_write(
    target: SshTarget,
    path: String,
    content: String,
) -> Result<(), String> {
    if content.len() > WRITE_BYTE_CAP {
        return Err(format!(
            "sftp: content is {} bytes, exceeds {} MiB write cap",
            content.len(),
            WRITE_BYTE_CAP / (1024 * 1024)
        ));
    }
    let quoted = sanitize_remote_path(&path)?;
    let dir = tempfile::tempdir().map_err(|e| format!("sftp tempdir: {e}"))?;
    let local = dir.path().join("yamet-remote-write");
    std::fs::write(&local, content.as_bytes()).map_err(|e| format!("sftp write local: {e}"))?;
    let local_quoted = quote_batch(&local.display().to_string());
    let script = format!("put {local_quoted} {quoted}\nquit\n");
    tokio::task::spawn_blocking(move || run_batch(&target, &script))
        .await
        .map_err(|e| e.to_string())??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_bounded_text_rejects_oversized_file_during_read() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("big.txt");
        // Sparse file well over the cap; metadata().len() must trip the pre-check.
        let f = std::fs::File::create(&p).unwrap();
        f.set_len((READ_BYTE_CAP as u64) + 1).unwrap();
        drop(f);
        let err = read_bounded_text(&p).unwrap_err();
        assert!(err.contains("exceeds"), "got: {err}");
    }

    #[test]
    fn read_bounded_text_returns_utf8_content() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("ok.txt");
        std::fs::write(&p, "héllo wörld").unwrap();
        assert_eq!(read_bounded_text(&p).unwrap(), "héllo wörld");
    }

    #[test]
    fn parses_directory_line() {
        let e = parse_ls_line("drwxr-xr-x    5 user group     4096 Aug  1 12:00 src").unwrap();
        assert_eq!(e.name, "src");
        assert_eq!(e.kind, "dir");
        assert_eq!(e.size, 4096);
    }

    #[test]
    fn parses_file_line_with_year() {
        let e = parse_ls_line("-rw-r--r--   1 user group   1234 Jul 15  2024 Cargo.toml").unwrap();
        assert_eq!(e.name, "Cargo.toml");
        assert_eq!(e.kind, "file");
        assert_eq!(e.size, 1234);
    }

    #[test]
    fn parses_link_and_spaced_name() {
        let e = parse_ls_line("lrwxrwxrwx   1 user group      7 Jan  1 00:00 my link").unwrap();
        assert_eq!(e.name, "my link");
        assert_eq!(e.kind, "link");
    }

    #[test]
    fn ignores_total_and_errors() {
        assert!(parse_ls_line("total 12").is_none());
        assert!(parse_ls_line("Couldn't stat remote file").is_none());
        assert!(parse_ls_line("").is_none());
    }

    #[test]
    fn rejects_non_ls_lines() {
        assert!(parse_ls_line("sftp> ls -la").is_none());
        assert!(parse_ls_line("random garbage").is_none());
    }

    #[test]
    fn quote_batch_handles_spaces_and_quotes() {
        assert_eq!(quote_batch("my file.txt"), "'my file.txt'");
        assert_eq!(quote_batch("it's here"), "'it'\\''s here'");
        assert_eq!(quote_batch("plain"), "'plain'");
    }

    #[test]
    fn sanitize_remote_path_rejects_control_chars() {
        assert!(sanitize_remote_path("a\nb").is_err());
        assert!(sanitize_remote_path("").is_err());
        assert_eq!(sanitize_remote_path("my dir").unwrap(), "'my dir'");
    }

    #[test]
    fn build_base_rejects_option_smuggling_host() {
        let target = SshTarget {
            host: "-oProxyCommand=evil".into(),
            port: None,
            user: None,
            identity_file: None,
        };
        assert!(build_base(&target).is_err());
    }

    #[test]
    fn build_base_rejects_whitespace_host() {
        let target = SshTarget {
            host: "a b".into(),
            port: None,
            user: None,
            identity_file: None,
        };
        assert!(build_base(&target).is_err());
    }

    #[test]
    fn build_base_batches_and_uses_identity() {
        let cmd = build_base(&SshTarget {
            host: "example.com".into(),
            port: Some(2222),
            user: Some("deploy".into()),
            identity_file: Some("~/.ssh/id_ed25519".into()),
        })
        .unwrap();
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.contains(&"-P".into()));
        assert!(args.contains(&"2222".into()));
        assert!(args.contains(&"-i".into()));
        assert!(args.contains(&"~/.ssh/id_ed25519".into()));
        assert!(args.contains(&"deploy@example.com".into()));
        assert!(args.contains(&"BatchMode=yes".into()));
    }
}
