use std::collections::HashMap;

use tauri::{AppHandle, Manager};

use crate::modules::git::operations;
use crate::modules::git::types::{
    BlameLine, DiscardEntry, GitBranchListResult, GitCheckpoint, GitCommitFileChange,
    GitCommitResult, GitConflictResult, GitDiffContentResult, GitDiffResult, GitLogEntry,
    GitPanelSnapshot, GitPushResult, GitRepoInfo, GitStashEntry, GitStatusSnapshot,
    GitSubmoduleStatusResult,
};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

async fn blocking<F, T>(app: AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&WorkspaceRegistry) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        f(&registry)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_resolve_repo(
    cwd: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<Option<GitRepoInfo>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::resolve_repo(r, &cwd, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_panel_snapshot(
    cwd: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitPanelSnapshot, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::panel_snapshot(r, &cwd, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_status(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitStatusSnapshot, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::status(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_diff(
    repo_root: String,
    path: Option<String>,
    staged: bool,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitDiffResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::diff(r, &repo_root, path.as_deref(), staged, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_diff_content(
    repo_root: String,
    path: String,
    staged: bool,
    original_path: Option<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitDiffContentResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::diff_content(
            r,
            &repo_root,
            &path,
            staged,
            original_path.as_deref(),
            &workspace,
        )
        .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_stage(
    repo_root: String,
    paths: Vec<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::stage(r, &repo_root, &paths, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_unstage(
    repo_root: String,
    paths: Vec<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::unstage(r, &repo_root, &paths, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_discard(
    repo_root: String,
    entries: Vec<DiscardEntry>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::discard(r, &repo_root, &entries, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_commit(
    repo_root: String,
    message: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitCommitResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::commit(r, &repo_root, &message, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_fetch(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::fetch(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_pull_ff_only(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::pull_ff_only(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_push(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitPushResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::push(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_log(
    repo_root: String,
    limit: Option<u32>,
    before_sha: Option<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<Vec<GitLogEntry>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::log(
            r,
            &repo_root,
            limit.unwrap_or(30),
            before_sha.as_deref(),
            &workspace,
        )
        .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_show_commit(
    repo_root: String,
    sha: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitDiffResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::show_commit_diff(r, &repo_root, &sha, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_commit_files(
    repo_root: String,
    sha: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<Vec<GitCommitFileChange>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::commit_files(r, &repo_root, &sha, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_commit_file_diff(
    repo_root: String,
    sha: String,
    path: String,
    original_path: Option<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitDiffContentResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::commit_file_diff(
            r,
            &repo_root,
            &sha,
            &path,
            original_path.as_deref(),
            &workspace,
        )
        .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_remote_url(
    repo_root: String,
    name: Option<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<Option<String>, String> {
    let remote = name.unwrap_or_else(|| "origin".to_string());
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::remote_url(r, &repo_root, &remote, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_list_branches(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitBranchListResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::list_branches(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_checkout_branch(
    repo_root: String,
    branch: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::checkout_branch(r, &repo_root, &branch, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_create_branch(
    repo_root: String,
    name: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::create_branch(r, &repo_root, &name, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_delete_branch(
    repo_root: String,
    name: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::delete_branch(r, &repo_root, &name, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_rename_branch(
    repo_root: String,
    old: String,
    new: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::rename_branch(r, &repo_root, &old, &new, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_push_upstream(
    repo_root: String,
    remote: Option<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitPushResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::push_upstream(r, &repo_root, remote.as_deref(), &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_pull(
    repo_root: String,
    strategy: Option<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::pull(r, &repo_root, strategy.as_deref(), &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_stash_save(
    repo_root: String,
    message: Option<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::stash_save(r, &repo_root, message.as_deref(), &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_stash_list(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<Vec<GitStashEntry>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::stash_list(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_stash_pop(
    repo_root: String,
    index: Option<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::stash_pop(r, &repo_root, index.as_deref(), &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_stash_apply(
    repo_root: String,
    index: Option<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::stash_apply(r, &repo_root, index.as_deref(), false, &workspace)
            .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_stash_drop(
    repo_root: String,
    index: Option<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::stash_drop(r, &repo_root, index.as_deref(), &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_conflicts(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitConflictResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::conflicts(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_merge_abort(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::merge_abort(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_blame(
    repo_root: String,
    path: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<Vec<BlameLine>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::blame(r, &repo_root, &path, &workspace).map_err(Into::into)
    })
    .await
}

// ── P3-13 Git snapshot checkpoints (N3) ───────────────────────────────────

fn checkpoint_store_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("git-checkpoints.json"))
}

fn read_checkpoints(path: &std::path::Path) -> HashMap<String, Vec<GitCheckpoint>> {
    let Ok(bytes) = std::fs::read(path) else {
        return HashMap::new();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn write_checkpoints(
    path: &std::path::Path,
    map: &HashMap<String, Vec<GitCheckpoint>>,
) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(map).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Snapshot the working tree and record it out-of-band (non-destructive:
/// `git stash create` does not move HEAD or the branch). Returns the sha, or
/// `null` when the working tree is clean.
#[tauri::command]
pub async fn git_checkpoint_create(
    repo_root: String,
    message: Option<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<Option<GitCheckpoint>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let path = checkpoint_store_path(&app)?;
    let root = repo_root.clone();
    let sha = blocking(app, move |r| {
        operations::checkpoint_snapshot(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await?;
    let Some(sha) = sha else {
        return Ok(None);
    };
    let checkpoint = GitCheckpoint {
        sha,
        message: message.unwrap_or_else(|| "yamet checkpoint".to_string()),
        created_at: now_secs(),
    };
    let mut map = read_checkpoints(&path);
    let list = map.entry(root).or_default();
    // Cap retained checkpoints per repo (ring buffer) to avoid unbounded growth.
    list.push(checkpoint.clone());
    if list.len() > 20 {
        let overflow = list.len() - 20;
        list.drain(..overflow);
    }
    write_checkpoints(&path, &map)?;
    Ok(Some(checkpoint))
}

#[tauri::command]
pub fn git_checkpoint_list(
    repo_root: String,
    app: AppHandle,
) -> Result<Vec<GitCheckpoint>, String> {
    let path = checkpoint_store_path(&app)?;
    Ok(read_checkpoints(&path).remove(&repo_root).unwrap_or_default())
}

#[tauri::command]
pub async fn git_checkpoint_restore(
    repo_root: String,
    sha: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::checkpoint_restore(r, &repo_root, &sha, &workspace).map_err(Into::into)
    })
    .await
}

fn now_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkpoint_storage_roundtrips_and_caps() {
        let dir = std::env::temp_dir().join(format!("yamet-git-cp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("checkpoints.json");
        let mut map = read_checkpoints(&path);
        let root = "/repo".to_string();
        let list = map.entry(root.clone()).or_default();
        for i in 0..25 {
            list.push(GitCheckpoint {
                sha: format!("{i:040x}"),
                message: format!("cp {i}"),
                created_at: i as u64,
            });
        }
        if list.len() > 20 {
            let overflow = list.len() - 20;
            list.drain(..overflow);
        }
        write_checkpoints(&path, &map).unwrap();
        let reloaded = read_checkpoints(&path);
        let got = reloaded.get(&root).unwrap();
        assert_eq!(got.len(), 20);
        assert_eq!(got[0].sha, format!("{:040x}", 5));
        assert_eq!(got[19].sha, format!("{:040x}", 24));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[tauri::command]
pub async fn git_checkout_ours(
    repo_root: String,
    path: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::checkout_ours(r, &repo_root, &path, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_checkout_theirs(
    repo_root: String,
    path: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::checkout_theirs(r, &repo_root, &path, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_submodule_status(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitSubmoduleStatusResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::submodule_status(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_submodule_update(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::submodule_update(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}
