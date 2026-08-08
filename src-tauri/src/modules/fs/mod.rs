pub mod document;
pub mod file;
pub mod grep;
pub mod index_cache;
pub mod mutate;
pub mod policy;
pub mod search;
pub mod tree;
pub mod watch;

use std::path::Path;

use crate::modules::workspace::WorkspaceRegistry;

/// Defense-in-depth for the AI write path: the frontend `security.ts` denylist
/// is the first gate; this is the second, backend layer. AI-sourced mutations
/// (`source == "ai"`) must (a) not target a sensitive/denylisted path
/// (`policy::check_readable`, symmetric with the read path) and (b) resolve to
/// a path under an authorized workspace root. The user's own editor/explorer
/// writes pass `source == "editor"`/null and are not gated here (they carry
/// their own trust), so this must not break normal editing.
///
/// NOTE on trust model: the AI layer already has shell execution privilege
/// (`shell_run_command`), so this gate is defense-in-depth rather than a
/// security boundary — its real value is as a boundary for a future restricted
/// (shell-less) agent tool surface. `source` is client-supplied and not
/// cryptographically authenticated; see the round-17 requirements doc.
pub(crate) fn enforce_ai_workspace_authorization(
    target: &Path,
    source: &Option<String>,
    registry: &WorkspaceRegistry,
) -> Result<(), String> {
    if source.as_deref() != Some("ai") {
        return Ok(());
    }
    // Defense-in-depth, symmetric with the read path: an AI-sourced write must
    // not target a sensitive/denylisted path either (e.g. `.env`, `~/.ssh/…`,
    // private keys), even when the target sits inside an authorized workspace.
    // Without this, an AI write to `~/.bashrc` (home is authorized) would bypass
    // the secret-basename list that the read side already enforces.
    policy::check_readable(&target.to_string_lossy()).map_err(|e| {
        log::warn!("{e}");
        e
    })?;
    // The file may not exist yet (new file / deep dir chain), so canonicalize
    // the nearest existing ancestor and require that it sits under an
    // authorized root.
    let mut ancestor = target;
    while !ancestor.exists() {
        match ancestor.parent() {
            Some(p) if p != ancestor => ancestor = p,
            _ => break,
        }
    }
    let canonical = std::fs::canonicalize(ancestor).map_err(|e| {
        format!(
            "AI write target not accessible: {} ({e})",
            ancestor.display()
        )
    })?;
    if registry.is_authorized(&canonical) {
        Ok(())
    } else {
        Err(format!(
            "AI write refused: {} is outside the authorized workspace",
            canonical.display()
        ))
    }
}

/// The single canonical-to-display conversion: forward slashes, Windows
/// verbatim `\\?\` prefix stripped. Route every such conversion through here.
pub fn to_canon(p: impl AsRef<Path>) -> String {
    let s = p.as_ref().to_string_lossy();
    #[cfg(windows)]
    {
        strip_verbatim(&s)
    }
    #[cfg(not(windows))]
    {
        // Backslashes are legal in Unix filenames; never rewrite them.
        s.into_owned()
    }
}

// Pure so it stays unit-testable on any host. `\\?\C:\x` -> `C:/x`.
#[cfg_attr(not(windows), allow(dead_code))]
fn strip_verbatim(s: &str) -> String {
    let stripped = if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s.to_string()
    };
    stripped.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::strip_verbatim;
    use proptest::prelude::*;

    #[test]
    fn ai_write_to_sensitive_path_is_refused_even_inside_workspace() {
        use crate::modules::workspace::WorkspaceRegistry;
        let registry = WorkspaceRegistry::default();
        let ws = tempfile::tempdir().unwrap();
        registry.authorize(ws.path()).unwrap();

        // An AI write to a secret-basename file (`.env`) inside an authorized
        // workspace must be refused by the sensitive-list check (P1-1), even
        // though the workspace auth itself would allow it.
        let env_path = ws.path().join(".env");
        assert!(
            super::enforce_ai_workspace_authorization(&env_path, &Some("ai".into()), &registry)
                .is_err(),
            "AI write to .env must be refused (sensitive-list gate)"
        );
        // A private key / protected-dir path too.
        let key_path = ws.path().join("id_ed25519");
        assert!(
            super::enforce_ai_workspace_authorization(&key_path, &Some("ai".into()), &registry)
                .is_err(),
            "AI write to id_ed25519 must be refused"
        );
    }

    #[test]
    fn ai_write_to_normal_workspace_file_is_allowed() {
        use crate::modules::workspace::WorkspaceRegistry;
        let registry = WorkspaceRegistry::default();
        let ws = tempfile::tempdir().unwrap();
        registry.authorize(ws.path()).unwrap();

        let normal = ws.path().join("main.rs");
        assert!(
            super::enforce_ai_workspace_authorization(&normal, &Some("ai".into()), &registry)
                .is_ok(),
            "AI write to a normal file inside the workspace must be allowed"
        );
    }

    #[test]
    fn user_write_to_sensitive_path_is_not_gated() {
        use crate::modules::workspace::WorkspaceRegistry;
        let registry = WorkspaceRegistry::default();
        let ws = tempfile::tempdir().unwrap();
        registry.authorize(ws.path()).unwrap();

        // Editor/explorer writes (source != "ai") to any path are not gated.
        let env_path = ws.path().join(".env");
        assert!(
            super::enforce_ai_workspace_authorization(
                &env_path,
                &Some("editor".into()),
                &registry,
            )
            .is_ok(),
            "user write to .env must not be gated"
        );
        assert!(
            super::enforce_ai_workspace_authorization(&env_path, &None, &registry).is_ok(),
            "null-source write to .env must not be gated"
        );
    }

    #[test]
    fn strips_drive_verbatim_prefix() {
        assert_eq!(strip_verbatim(r"\\?\C:\Users\foo"), "C:/Users/foo");
    }

    #[test]
    fn rewrites_verbatim_unc_to_share_path() {
        assert_eq!(
            strip_verbatim(r"\\?\UNC\server\share\dir"),
            "//server/share/dir"
        );
    }

    #[test]
    fn passes_through_plain_windows_path() {
        assert_eq!(strip_verbatim(r"C:\Users\foo"), "C:/Users/foo");
    }

    #[test]
    fn leaves_forward_slash_path_unchanged() {
        assert_eq!(strip_verbatim("C:/Users/foo"), "C:/Users/foo");
    }

    #[test]
    fn handles_drive_root() {
        assert_eq!(strip_verbatim(r"\\?\C:\"), "C:/");
    }

    proptest! {
        #[test]
        fn strip_verbatim_never_leaves_backslashes_or_prefix(s in r"[A-Za-z0-9\\/: .]{0,40}") {
            let out = strip_verbatim(&s);
            prop_assert!(!out.contains('\\'));
            prop_assert!(!out.starts_with(r"\\?\"));
        }

        #[test]
        fn strip_verbatim_is_idempotent(s in r"[A-Za-z0-9\\/: .]{0,40}") {
            let once = strip_verbatim(&s);
            prop_assert_eq!(strip_verbatim(&once), once);
        }

        #[test]
        fn strip_verbatim_on_plain_input_equals_slash_swap(s in r"[A-Za-z0-9\\/: .]{0,40}") {
            prop_assume!(!s.starts_with(r"\\?\"));
            prop_assert_eq!(strip_verbatim(&s), s.replace('\\', "/"));
        }

        #[test]
        fn strip_verbatim_drive_root_is_preserved(
            drive in r"[A-Z]",
            tail in r"[A-Za-z0-9\\/ .]{0,40}",
        ) {
            let input = format!(r"\\?\{drive}:\{tail}");
            let out = strip_verbatim(&input);
            let expected = format!("{drive}:/");
            prop_assert!(out.starts_with(&expected));
        }

        #[test]
        fn strip_verbatim_unc_becomes_double_slash(tail in r"[A-Za-z0-9\\/ .]{0,40}") {
            let input = format!(r"\\?\UNC\{tail}");
            let out = strip_verbatim(&input);
            prop_assert!(out.starts_with("//"));
            prop_assert!(!out.starts_with(r"\\?\"));
        }
    }
}
