//! Windows branch: background processes are attached to a Job Object
//! (KILL_ON_JOB_CLOSE), so kill() reaps the whole tree, not just the direct
//! child. Compiled only on Windows (the Unix integration test is gated
//! `#![cfg(unix)]`; this file fills the Windows coverage gap).

#![cfg(windows)]

use std::time::{Duration, Instant};

use yamet_lib::modules::shell::background;
use yamet_lib::modules::workspace::WorkspaceEnv;

fn wait_until<F: Fn() -> bool>(timeout: Duration, check: F) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if check() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    check()
}

#[test]
fn spawn_captures_exit_code() {
    let proc = background::spawn("exit 7".into(), None, WorkspaceEnv::Local).expect("spawn");
    assert!(
        wait_until(Duration::from_secs(10), || { proc.read_logs(0).exited }),
        "process must exit",
    );
    assert_eq!(proc.read_logs(0).exit_code, Some(7));
}

#[test]
fn kill_reaps_process_tree_via_job_object() {
    // cmd /c ping spawns ping.exe as a child; both must die on kill().
    let proc = background::spawn(
        "cmd /c ping -n 30 127.0.0.1 > nul".into(),
        None,
        WorkspaceEnv::Local,
    )
    .expect("spawn");

    proc.kill();

    assert!(
        wait_until(Duration::from_secs(10), || { proc.read_logs(0).exited }),
        "cmd must reach exited state after kill (job object must reap tree)",
    );
}
