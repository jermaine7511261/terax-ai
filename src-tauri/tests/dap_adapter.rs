//! DAP transport integration tests against real child processes.
//!
//! Round-12 pattern (grok `xai-grok-test-support`): exercise the native
//! stdio transport against a real subprocess and the real Content-Length
//! framing; never mock the transport layer. Unix-only: Windows uses ConPTY
//! elsewhere and the plain-pipe semantics differ; the cfg gate keeps the
//! suite green on the windows CI runner.

use yamet_lib::modules::dap::transport::StdioDapTransport;

#[cfg(unix)]
mod unix {
    use super::*;

    #[test]
    fn stdio_transport_receives_frames_from_child() {
        let t = StdioDapTransport::spawn(
            "sh",
            &["-c", "printf 'Content-Length: 5\r\n\r\nhello'".to_string()],
            &[],
            None,
        )
        .expect("spawn sh");
        assert_eq!(t.recv_frame().unwrap(), "hello");
        t.close();
    }

    #[test]
    fn stdio_transport_echo_roundtrip_via_cat() {
        let t = StdioDapTransport::spawn("cat", &[], &[], None).expect("spawn cat");
        t.send_frame("{\"seq\":1,\"type\":\"request\"}").unwrap();
        assert_eq!(t.recv_frame().unwrap(), "{\"seq\":1,\"type\":\"request\"}");
        t.close();
    }

    #[test]
    fn spawn_failure_reports_a_clear_error() {
        let err = StdioDapTransport::spawn(
            "definitely-not-a-real-binary-yamet-test",
            &[],
            &[],
            None,
        )
        .expect_err("missing binary must fail");
        assert!(err.contains("dap spawn failed"), "unexpected error: {err}");
    }
}
