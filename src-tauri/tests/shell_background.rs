#![cfg(unix)]

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
fn spawn_empty_command_errors() {
    assert!(background::spawn("   ".into(), None, WorkspaceEnv::Local).is_err());
}

#[test]
fn spawn_invalid_cwd_errors() {
    let err = background::spawn(
        "true".into(),
        Some("/no/such/dir".into()),
        WorkspaceEnv::Local,
    );
    assert!(err.is_err());
}

#[test]
fn spawn_captures_stdout_and_exits_zero() {
    let proc = background::spawn(
        "printf 'hello\\n'".into(),
        None,
        WorkspaceEnv::Local,
    )
    .expect("spawn");

    assert!(wait_until(Duration::from_secs(5), || {
        proc.read_logs(0).exited
    }));

    let logs = proc.read_logs(0);
    assert!(logs.bytes.contains("hello"));
    assert!(logs.exited);
    assert_eq!(logs.exit_code, Some(0));
}

#[test]
fn spawn_captures_nonzero_exit() {
    let proc = background::spawn("exit 42".into(), None, WorkspaceEnv::Local).expect("spawn");

    assert!(wait_until(Duration::from_secs(5), || {
        proc.read_logs(0).exited
    }));
    assert_eq!(proc.read_logs(0).exit_code, Some(42));
}

#[test]
fn kill_terminates_a_running_process() {
    let proc =
        background::spawn("sleep 30".into(), None, WorkspaceEnv::Local).expect("spawn");

    proc.kill();

    assert!(
        wait_until(Duration::from_secs(5), || { proc.read_logs(0).exited }),
        "killed process must reach exited state",
    );
}

#[test]
fn read_logs_advances_offset() {
    let proc = background::spawn(
        "printf 'one\\n'; printf 'two\\n'".into(),
        None,
        WorkspaceEnv::Local,
    )
    .expect("spawn");

    assert!(wait_until(Duration::from_secs(5), || {
        proc.read_logs(0).exited
    }));

    let first = proc.read_logs(0);
    assert!(first.next_offset > 0);

    let next = proc.read_logs(first.next_offset);
    assert!(next.bytes.is_empty(), "consumed offset must return no bytes");
    assert_eq!(next.next_offset, first.next_offset);
}

#[test]
fn info_reflects_command_and_exit() {
    let proc = background::spawn("true".into(), None, WorkspaceEnv::Local).expect("spawn");
    let info_running = proc.info(7);
    assert_eq!(info_running.handle, 7);
    assert_eq!(info_running.command, "true");

    assert!(wait_until(Duration::from_secs(5), || {
        proc.read_logs(0).exited
    }));
    let info_done = proc.info(7);
    assert!(info_done.exited);
    assert_eq!(info_done.exit_code, Some(0));
}

#[test]
fn kill_terminates_the_whole_process_group() {
    // `sh -c "sleep 30 & wait"` spawns sleep in the same process group as the
    // shell (process_group(0)). kill() must reap both, not just the direct child.
    let proc = background::spawn(
        "sh -c 'sleep 30 & wait'".into(),
        None,
        WorkspaceEnv::Local,
    )
    .expect("spawn");
    let pgid = proc.child.id() as i32;

    proc.kill();

    assert!(
        wait_until(Duration::from_secs(5), || { proc.read_logs(0).exited }),
        "shell must reach exited state after kill",
    );
    // kill -0 on the (negative) pgid fails once the group is empty.
    let probe = std::process::Command::new("kill")
        .args(["-0", &format!("-{pgid}")])
        .status();
    assert!(
        probe.map(|s| !s.success()).unwrap_or(true),
        "process group {pgid} must be empty after group kill",
    );
}
