use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};
use std::path::Path;
use tauri::Manager;

fn create_file_sync(p: &Path) -> Result<(), String> {
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::write(p, "").map_err(|e| {
        log::debug!("fs_create_file({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Creates a new empty file. Fails if the file already exists.
#[tauri::command]
pub fn fs_create_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    // Defense-in-depth: AI-sourced mutations must land inside an authorized
    // workspace root (see fs::mod::enforce_ai_workspace_authorization).
    let registry = app.state::<WorkspaceRegistry>();
    super::enforce_ai_workspace_authorization(&p, &source, &registry).map_err(|e| {
        log::warn!("{e}");
        e
    })?;
    create_file_sync(&p)
}

fn create_dir_sync(p: &Path) -> Result<(), String> {
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::create_dir_all(p).map_err(|e| {
        log::debug!("fs_create_dir({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Creates a new directory. Fails if the directory already exists.
/// Parents are created as needed — matches the common "new folder" UX
/// where typing "a/b/c" creates the full chain.
#[tauri::command]
pub fn fs_create_dir(
    path: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let registry = app.state::<WorkspaceRegistry>();
    super::enforce_ai_workspace_authorization(&p, &source, &registry).map_err(|e| {
        log::warn!("{e}");
        e
    })?;
    create_dir_sync(&p)
}

fn rename_sync(from_p: &Path, to_p: &Path) -> Result<(), String> {
    if !from_p.exists() {
        return Err(format!("not found: {}", from_p.display()));
    }
    if to_p.exists() {
        return Err(format!("already exists: {}", to_p.display()));
    }
    std::fs::rename(from_p, to_p).map_err(|e| {
        log::debug!(
            "fs_rename({} -> {}) failed: {e}",
            from_p.display(),
            to_p.display()
        );
        e.to_string()
    })
}

/// Renames (or moves) a path. Refuses to overwrite an existing target.
#[tauri::command]
pub fn fs_rename(
    from: String,
    to: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let from_p = resolve_path(&from, &workspace);
    let to_p = resolve_path(&to, &workspace);
    let registry = app.state::<WorkspaceRegistry>();
    // Both endpoints must be inside the authorized workspace for AI-sourced
    // renames/moves — a move is a write at the destination and a delete at the
    // source.
    super::enforce_ai_workspace_authorization(&from_p, &source, &registry).map_err(|e| {
        log::warn!("{e}");
        e
    })?;
    super::enforce_ai_workspace_authorization(&to_p, &source, &registry).map_err(|e| {
        log::warn!("{e}");
        e
    })?;
    rename_sync(&from_p, &to_p)
}

fn delete_sync(p: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(p).map_err(|e| {
        log::debug!("fs_delete stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let result = if meta.is_dir() {
        std::fs::remove_dir_all(p)
    } else {
        std::fs::remove_file(p)
    };

    result.map_err(|e| {
        log::warn!("fs_delete({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Deletes a file or directory (recursively for dirs). Callers are
/// responsible for confirming destructive operations with the user.
#[tauri::command]
pub fn fs_delete(
    path: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let registry = app.state::<WorkspaceRegistry>();
    super::enforce_ai_workspace_authorization(&p, &source, &registry).map_err(|e| {
        log::warn!("{e}");
        e
    })?;
    delete_sync(&p)
}

fn copy_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::fs::create_dir(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(src, dst).map(|_| ())
    }
}

/// Copies external files/dirs into a destination directory, recursively for
/// dirs. Sources are absolute OS paths (from a drag-drop); only the destination
/// is workspace-resolved. Refuses to overwrite existing entries.
///
/// Pure core (testable without a Tauri AppHandle): `registry` gates AI-sourced
/// copies; pass `None` when the caller has no app context (unit tests) — the
/// AI source gate is skipped, mirroring the other fs commands.
fn fs_copy_impl(
    sources: Vec<String>,
    dest_dir: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    registry: Option<&WorkspaceRegistry>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let dest = resolve_path(&dest_dir, &workspace);
    if let Some(registry) = registry {
        // Defense-in-depth: AI-sourced copies must land inside an authorized
        // workspace root (mirrors the other fs mutation commands).
        super::enforce_ai_workspace_authorization(&dest, &source, registry).map_err(|e| {
            log::warn!("{e}");
            e
        })?;
        // An AI-sourced copy must not read a sensitive/denylisted source either
        // (e.g. `~/.bashrc`, `.git-credentials`), even if the destination is a
        // valid workspace. This closes the "copy any absolute path into the
        // workspace" gap on the source side.
        if source.as_deref() == Some("ai") {
            for src_str in &sources {
                let src = std::path::PathBuf::from(src_str);
                super::policy::check_read_path_authorized(&src, &source, Some(registry)).map_err(
                    |e| {
                        log::warn!("{e}");
                        e
                    },
                )?;
            }
        }
    }
    for src_str in &sources {
        let src = std::path::PathBuf::from(src_str);
        let name = src
            .file_name()
            .ok_or_else(|| format!("invalid source: {src_str}"))?;
        let target = dest.join(name);
        if target.exists() {
            return Err(format!("already exists: {}", target.display()));
        }
        copy_recursive(&src, &target).map_err(|e| {
            log::warn!(
                "fs_copy({} -> {}) failed: {e}",
                src.display(),
                target.display()
            );
            e.to_string()
        })?;
    }
    Ok(())
}

/// Tauri command shell — extracts the registry and delegates to the pure core.
#[tauri::command]
pub fn fs_copy(
    sources: Vec<String>,
    dest_dir: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let registry = app.state::<WorkspaceRegistry>();
    fs_copy_impl(sources, dest_dir, workspace, source, Some(&registry))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(p: std::path::PathBuf) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn create_file_makes_empty_and_refuses_to_clobber() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("new.txt");
        create_file_sync(&f).expect("create");
        assert!(f.exists());
        assert_eq!(std::fs::read(&f).unwrap(), b"");

        // A second create must error, not truncate existing content.
        std::fs::write(&f, b"data").unwrap();
        let err = create_file_sync(&f).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&f).unwrap(), b"data");
    }

    #[test]
    fn create_dir_builds_nested_chain_and_refuses_existing() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a/b/c");
        create_dir_sync(&nested).expect("create dir");
        assert!(nested.is_dir());
        let err = create_dir_sync(&nested).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[test]
    fn rename_moves_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("a.txt");
        let to = dir.path().join("b.txt");
        std::fs::write(&from, b"payload").unwrap();

        rename_sync(&from, &to).expect("rename");
        assert!(!from.exists());
        assert_eq!(std::fs::read(&to).unwrap(), b"payload");

        // Missing source is reported, not silently ignored.
        let err = rename_sync(&from, &dir.path().join("c.txt")).unwrap_err();
        assert!(err.contains("not found"), "got: {err}");

        // Refusing to overwrite an existing target is the data-loss guard.
        let occupied = dir.path().join("keep.txt");
        std::fs::write(&occupied, b"keep").unwrap();
        let err = rename_sync(&to, &occupied).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&occupied).unwrap(), b"keep");
        assert!(to.exists());
    }

    #[test]
    fn copy_brings_file_and_dir_in_and_refuses_clobber() {
        let src = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("a.txt"), b"payload").unwrap();
        std::fs::create_dir_all(src.path().join("d/inner")).unwrap();
        std::fs::write(src.path().join("d/inner/y.txt"), b"y").unwrap();

        fs_copy_impl(
            vec![s(src.path().join("a.txt")), s(src.path().join("d"))],
            s(dest.path().to_path_buf()),
            None,
            None,
            None,
        )
        .expect("copy");

        assert_eq!(
            std::fs::read(dest.path().join("a.txt")).unwrap(),
            b"payload"
        );
        assert_eq!(
            std::fs::read(dest.path().join("d/inner/y.txt")).unwrap(),
            b"y"
        );
        // copy, not move: the source survives.
        assert!(src.path().join("a.txt").exists());

        let err = fs_copy_impl(
            vec![s(src.path().join("a.txt"))],
            s(dest.path().to_path_buf()),
            None,
            None,
            None,
        )
        .unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[test]
    fn fs_copy_ai_source_gate_blocks_sensitive_source_and_outside_dest() {
        use crate::modules::workspace::WorkspaceRegistry;
        let registry = WorkspaceRegistry::default();
        let ws = tempfile::tempdir().unwrap();
        registry.authorize(ws.path()).unwrap();
        let outside = tempfile::tempdir().unwrap();

        // 1. An AI-sourced copy from an authorized source into an authorized
        //    workspace is allowed (source must also pass workspace auth + the
        //    sensitive denylist — that's the whole point of the gate).
        let good_src = tempfile::tempdir().unwrap();
        std::fs::write(good_src.path().join("n.txt"), b"n").unwrap();
        registry.authorize(good_src.path()).unwrap();
        assert!(
            fs_copy_impl(
                vec![s(good_src.path().join("n.txt"))],
                s(ws.path().to_path_buf()),
                None,
                Some("ai".into()),
                Some(&registry),
            )
            .is_ok(),
            "AI copy of a normal source into workspace must be allowed"
        );

        // 2. A sensitive/denylisted source (e.g. .env) must be refused even when
        //    the destination is an authorized workspace.
        let sensitive = tempfile::tempdir().unwrap();
        std::fs::write(sensitive.path().join(".env"), b"SECRET=1").unwrap();
        let err = fs_copy_impl(
            vec![s(sensitive.path().join(".env"))],
            s(ws.path().to_path_buf()),
            None,
            Some("ai".into()),
            Some(&registry),
        )
        .unwrap_err();
        assert!(
            !err.is_empty(),
            "AI copy of a denylisted source must be refused, got ok"
        );

        // 3. A non-AI copy (user drag-drop, source=None) of any absolute path
        //    into an authorized workspace is still allowed (no AI gate).
        std::fs::write(outside.path().join("x.txt"), b"x").unwrap();
        assert!(
            fs_copy_impl(
                vec![s(outside.path().join("x.txt"))],
                s(ws.path().to_path_buf()),
                None,
                None,
                Some(&registry),
            )
            .is_ok(),
            "non-AI copy must not be gated"
        );
    }

    #[test]
    fn delete_removes_file_then_dir_recursively() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("x.txt");
        std::fs::write(&f, b"x").unwrap();
        delete_sync(&f).expect("delete file");
        assert!(!f.exists());

        let sub = dir.path().join("sub");
        std::fs::create_dir_all(sub.join("inner")).unwrap();
        std::fs::write(sub.join("inner/y.txt"), b"y").unwrap();
        delete_sync(&sub).expect("delete dir");
        assert!(!sub.exists());

        let err = delete_sync(&dir.path().join("missing")).unwrap_err();
        assert!(!err.is_empty());
    }

    // Deleting a symlink that points at a directory must remove only the link,
    // never recurse through it and wipe the target's contents.
    #[cfg(unix)]
    #[test]
    fn delete_does_not_follow_symlink_into_target() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        std::fs::create_dir(&real).unwrap();
        std::fs::write(real.join("keep.txt"), b"keep").unwrap();

        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        delete_sync(&link).expect("delete symlink");
        assert!(!link.exists(), "symlink itself should be gone");
        assert!(real.is_dir(), "target dir must survive");
        assert_eq!(std::fs::read(real.join("keep.txt")).unwrap(), b"keep");
    }
}
