//! SSH remote terminal support.
//!
//! Design: spawn the system `ssh` client as the PTY child process, reusing the
//! existing pty session pipeline (reader/flusher/waiter/agent-detect). This
//! gives known_hosts verification, password/key/agent auth, and forward agent
//! support natively with zero new heavy dependencies (no openssl/libssh2),
//! matching how VS Code and Windows Terminal implement remote terminals.

pub mod sftp;
pub mod target;
pub mod tunnels;

pub use sftp::{sftp_list, sftp_read, sftp_write};
pub use target::{build_command, SshTarget};
pub use tunnels::{ssh_tunnel_kill, ssh_tunnel_list, ssh_tunnel_start, TunnelsState};
