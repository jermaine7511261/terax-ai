//! Debug Adapter Protocol (DAP) adapter registry.
//!
//! Maps a file (by extension + ancestor root markers) to a concrete debug
//! adapter binary. Modeled on oh-my-pi `dap/config.ts` and Theia's
//! `DebugAdapterContribution`. Adapters are a small static registry (not
//! hardcoded per-file glue); new runtimes add one `DapAdapterDef`.

use std::path::Path;

/// A debug adapter definition: how to spawn the DAP server for a language.
pub struct DapAdapterDef {
    /// Stable id, surfaced to the frontend for config/UI.
    pub id: &'static str,
    /// File extensions this adapter claims, without leading dot.
    pub extensions: &'static [&'static str],
    /// Root markers (file names) that bound the project root for this
    /// language, used only for disambiguation among adapters.
    pub root_markers: &'static [&'static str],
    /// Executable to launch (resolved on the host).
    pub command: &'static str,
    /// Args, appended before the launch/attach request body is sent over
    /// the DAP channel (most adapters take no extra args; config drives
    /// launch).
    pub args: &'static [&'static str],
}

/// Common runtimes. Keep minimal and focused: these are the adapters we
/// actually validate end-to-end this round (Python + Node), plus cheap
/// native/Go wins. Missing binaries produce a clear error at launch, never
/// a hang.
const ADAPTERS: &[DapAdapterDef] = &[
    DapAdapterDef {
        id: "debugpy",
        extensions: &["py", "pyi"],
        root_markers: &["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"],
        command: "python",
        args: &["-m", "debugpy.adapter"],
    },
    DapAdapterDef {
        id: "node-inspect",
        extensions: &["js", "jsx", "mjs", "cjs", "ts", "tsx"],
        root_markers: &["package.json", "tsconfig.json"],
        command: "node",
        // Spawned by the native stdio transport (dap/transport.rs); the
        // launch config supplies the adapter invocation (`node --inspect` or
        // a DAP-over-stdio bridge) via adapterCommand/adapterArgs. No
        // external DAP client library is bundled.
        args: &[],
    },
    DapAdapterDef {
        id: "lldb-dap",
        extensions: &["rs", "c", "cpp", "h", "hpp", "cc", "cxx"],
        root_markers: &["Cargo.toml", "CMakeLists.txt", ".lldbinit"],
        command: "lldb-dap",
        args: &[],
    },
    DapAdapterDef {
        id: "gdb",
        extensions: &["c", "cpp", "h", "hpp", "cc", "cxx"],
        root_markers: &["CMakeLists.txt", "Makefile", ".gdbinit"],
        command: "gdb",
        args: &["-i", "dap"],
    },
    DapAdapterDef {
        id: "dlv",
        extensions: &["go"],
        root_markers: &["go.mod"],
        command: "dlv",
        args: &["dap"],
    },
];

/// Select an adapter for a file's extension, preferring one whose root
/// marker is present in `root`. Returns the first extension match whose
/// markers (if any) are satisfied; if `root` has none of an adapter's
/// markers but no other candidate claims the extension, the match still
/// stands (markers are a disambiguation hint, not a gate).
pub fn select_adapter(ext: &str, root: Option<&Path>) -> Option<&'static DapAdapterDef> {
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    let mut first_match: Option<&'static DapAdapterDef> = None;
    for a in ADAPTERS {
        if !a.extensions.iter().any(|e| *e == ext) {
            continue;
        }
        if first_match.is_none() {
            first_match = Some(a);
        }
        if a.root_markers.is_empty() {
            return Some(a);
        }
        if let Some(root) = root {
            if a.root_markers.iter().any(|m| root.join(m).exists()) {
                return Some(a);
            }
        }
    }
    first_match
}

pub fn all_adapter_ids() -> Vec<&'static str> {
    ADAPTERS.iter().map(|a| a.id).collect()
}

pub fn adapter_by_id(id: &str) -> Option<&'static DapAdapterDef> {
    ADAPTERS.iter().find(|a| a.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_debugpy_for_python() {
        let d = select_adapter("py", None).expect("py adapter");
        assert_eq!(d.id, "debugpy");
    }

    #[test]
    fn selects_node_for_ts() {
        let d = select_adapter("ts", None).expect("ts adapter");
        assert_eq!(d.id, "node-inspect");
    }

    #[test]
    fn selects_lldb_for_rust_when_marker_present() {
        let tmp = tempfile::tempdir().expect("tempdir");
        std::fs::write(tmp.path().join("Cargo.toml"), "").unwrap();
        let d = select_adapter("rs", Some(tmp.path())).expect("rs adapter");
        assert_eq!(d.id, "lldb-dap");
    }

    #[test]
    fn extension_case_insensitive() {
        let d = select_adapter(".PY", None).expect("adapter");
        assert_eq!(d.id, "debugpy");
    }

    #[test]
    fn unknown_extension_returns_none() {
        assert!(select_adapter("xyz", None).is_none());
    }

    #[test]
    fn all_ids_unique() {
        let ids = all_adapter_ids();
        let mut sorted = ids.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(ids.len(), sorted.len());
    }
}
