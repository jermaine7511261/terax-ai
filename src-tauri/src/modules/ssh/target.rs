use portable_pty::CommandBuilder;

/// A remote SSH target. Fields are sanitized before being turned into
/// command-line args so a hostile value can't smuggle extra `ssh` options.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SshTarget {
    pub host: String,
    /// Remote port. Defaults to 22 when omitted.
    #[serde(default)]
    pub port: Option<u16>,
    /// Remote username. Defaults to the client's current user when omitted.
    #[serde(default)]
    pub user: Option<String>,
    /// Path to an identity (private key) file, passed via `-i`.
    /// The frontend (useTabs.ts `SshTarget`, SshConnectDialog) sends
    /// `identityFile` (camelCase); backend callers may use `identity_file`.
    /// `rename` picks the primary wire name, `alias` accepts the other form so
    /// neither is silently dropped.
    #[serde(default, rename = "identityFile", alias = "identity_file")]
    pub identity_file: Option<String>,
}

pub(crate) fn clean_component(value: &str, what: &str) -> Result<String, String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(format!("ssh: {what} must not be empty"));
    }
    if v.starts_with('-') {
        return Err(format!("ssh: {what} must not start with '-'"));
    }
    if v.chars().any(char::is_whitespace) {
        return Err(format!("ssh: {what} must not contain whitespace"));
    }
    if v.chars().any(|c| c.is_control()) {
        return Err(format!("ssh: {what} contains control characters"));
    }
    Ok(v.to_string())
}

/// Build the `ssh` child command from a target. Rejects malformed hosts and
/// never interpolates into a shell — all values go through argv directly.
pub fn build_command(target: &SshTarget) -> Result<CommandBuilder, String> {
    let host = clean_component(&target.host, "host")?;
    let mut cmd = CommandBuilder::new("ssh");

    // Strict host-key checking is the secure default: an unknown host key
    // makes `ssh` prompt on the PTY (type `yes` to trust and record), so
    // known_hosts verification and the "remember" flow work out of the box.
    cmd.arg("-o");
    cmd.arg("StrictHostKeyChecking=ask");
    // Keep the interactive host-key prompt readable in a 256-color terminal.
    cmd.arg("-o");
    cmd.arg("VisualHostKey=no");

    if let Some(port) = target.port {
        if !(1..=65535).contains(&port) {
            return Err(format!("ssh: port out of range: {port}"));
        }
        cmd.arg("-p");
        cmd.arg(port.to_string());
    }

    if let Some(identity) = &target.identity_file {
        let id = clean_component(identity, "identity file")?;
        cmd.arg("-i");
        cmd.arg(id);
    }

    match &target.user {
        Some(user) => {
            let user = clean_component(user, "user")?;
            // `user@host` form is unambiguous; neither value can contain a
            // space or a leading dash so no option can be smuggled.
            cmd.arg(format!("{user}@{host}"));
        }
        None => cmd.arg(host),
    }

    // A real TTY on the remote side; carries through the local TERM so
    // interactive programs (vim, htop) render correctly.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    Ok(cmd)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(cmd: &CommandBuilder) -> Vec<String> {
        cmd.get_argv()
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn basic_target_builds_ssh_command() {
        let cmd = build_command(&SshTarget {
            host: "example.com".into(),
            port: None,
            user: None,
            identity_file: None,
        })
        .unwrap();
        let a = argv(&cmd);
        assert!(a.contains(&"-o".into()));
        assert!(a.contains(&"StrictHostKeyChecking=ask".into()));
        assert!(a.contains(&"example.com".into()));
        assert!(a.iter().all(|x| x != "host@example.com"));
    }

    #[test]
    fn full_target_uses_port_user_identity() {
        let cmd = build_command(&SshTarget {
            host: "10.0.0.5".into(),
            port: Some(2222),
            user: Some("deploy".into()),
            identity_file: Some("~/.ssh/id_ed25519".into()),
        })
        .unwrap();
        let a = argv(&cmd);
        assert!(a.contains(&"deploy@10.0.0.5".into()));
        assert!(a.contains(&"2222".into()));
        assert!(a.contains(&"~/.ssh/id_ed25519".into()));
    }

    #[test]
    fn rejects_host_with_leading_dash() {
        let cmd = build_command(&SshTarget {
            host: "-oProxyCommand=evil".into(),
            port: None,
            user: None,
            identity_file: None,
        });
        assert!(cmd.is_err());
    }

    #[test]
    fn rejects_host_with_whitespace() {
        let cmd = build_command(&SshTarget {
            host: "a b".into(),
            port: None,
            user: None,
            identity_file: None,
        });
        assert!(cmd.is_err());
    }

    #[test]
    fn rejects_control_chars_in_user() {
        let cmd = build_command(&SshTarget {
            host: "h".into(),
            port: None,
            user: Some("u\r\n-v".into()),
            identity_file: None,
        });
        assert!(cmd.is_err());
    }

    #[test]
    fn rejects_port_out_of_range() {
        let cmd = build_command(&SshTarget {
            host: "h".into(),
            port: Some(0),
            user: None,
            identity_file: None,
        });
        assert!(cmd.is_err());
    }

    #[test]
    fn empty_host_rejected() {
        let cmd = build_command(&SshTarget {
            host: "  ".into(),
            port: None,
            user: None,
            identity_file: None,
        });
        assert!(cmd.is_err());
    }

    #[test]
    fn deserializes_camelcase_from_frontend_wire() {
        // The frontend sends camelCase keys (`identityFile`); this is the MUST
        // regression: without serde rename_all they'd be silently dropped.
        let json = r#"{"host":"example.com","port":2222,"user":"deploy","identityFile":"~/.ssh/id"}"#;
        let t: SshTarget = serde_json::from_str(json).unwrap();
        assert_eq!(t.host, "example.com");
        assert_eq!(t.port, Some(2222));
        assert_eq!(t.user.as_deref(), Some("deploy"));
        assert_eq!(t.identity_file.as_deref(), Some("~/.ssh/id"));
    }

    #[test]
    fn deserializes_snake_case_for_backend_callers() {
        // Backend callers may still use snake_case; both must work.
        let json = r#"{"host":"h","identity_file":"/k"}"#;
        let t: SshTarget = serde_json::from_str(json).unwrap();
        assert_eq!(t.host, "h");
        assert_eq!(t.identity_file.as_deref(), Some("/k"));
    }
}
