//! Wire protocol between the YaMet main process and the PTY helper process.
//!
//! Transport: TCP on 127.0.0.1 (loopback only). The helper binds a random
//! ephemeral port and publishes it (with a per-spawn random auth token) in
//! `~/.yamet/pty-helper.json`. The main process must present the token on the
//! first frame, which keeps other local processes from connecting.
//!
//! Frame layout (all integers little-endian):
//!   u32 total_len | u8 msg_type | body
//!   body is either raw bytes (Output/Write) or JSON (control messages).
//!
//! Messages are fire-and-forget in both directions except List/Ping, which
//! are answered. The helper never reads the wire in a way that blocks the
//! PTY reader threads: it writes Output frames from the flusher and reads
//! control frames on a dedicated thread.

use serde::{Deserialize, Serialize};

pub const TYPE_AUTH: u8 = 0x01;
pub const TYPE_OPEN: u8 = 0x02;
pub const TYPE_WRITE: u8 = 0x03;
pub const TYPE_RESIZE: u8 = 0x04;
pub const TYPE_KILL: u8 = 0x05;
pub const TYPE_LIST: u8 = 0x06;
pub const TYPE_PING: u8 = 0x07;
pub const TYPE_SHUTDOWN: u8 = 0x08;
pub const TYPE_REPLAY: u8 = 0x09;
pub const TYPE_OUTPUT: u8 = 0x81;
pub const TYPE_EXIT: u8 = 0x82;
pub const TYPE_AGENT_SIGNAL: u8 = 0x83;
pub const TYPE_SESSION_LIST: u8 = 0x84;
pub const TYPE_PONG: u8 = 0x85;
pub const TYPE_ERROR: u8 = 0x86;

// Cap on a single frame. Output frames carry up to a read chunk (16 KiB);
// control frames are tiny. The cap keeps a corrupt peer from making us
// allocate unboundedly.
pub const MAX_FRAME: usize = 1 << 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenReq {
    pub id: u32,
    pub cols: u16,
    pub rows: u16,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub blocks: bool,
    // Workspace encoding: "local" or "wsl:<distro>". Kept as a string so the
    // protocol layer stays free of workspace types.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_key: Option<String>,
}

// Write payload is raw bytes on the wire (4-byte id + data), symmetric with
// Output, so keystrokes never pay JSON encoding.
#[derive(Debug, Clone)]
pub struct WriteReq {
    pub id: u32,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResizeReq {
    pub id: u32,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KillReq {
    pub id: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: u32,
    pub shell_pid: u32,
    pub exited: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionList {
    pub sessions: Vec<SessionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExitEvent {
    pub id: u32,
    pub code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSignalEvent {
    pub id: u32,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorMsg {
    pub message: String,
}

#[derive(Debug, Clone)]
pub enum Frame {
    Auth { token: String },
    Open(OpenReq),
    Write(WriteReq),
    Resize(ResizeReq),
    Kill(KillReq),
    List,
    Ping,
    Shutdown,
    Replay { id: u32 },
    Output { id: u32, data: Vec<u8> },
    Exit(ExitEvent),
    AgentSignal(AgentSignalEvent),
    SessionList(SessionList),
    Pong,
    Error(ErrorMsg),
}

fn encode_len(len: usize) -> [u8; 4] {
    (len as u32).to_le_bytes()
}

fn decode_len(b: &[u8]) -> usize {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize
}

/// Encode a frame into its wire bytes. `serde_json::to_vec` on these fixed,
/// `Serialize`-derived structs is not expected to fail, but we return a `Result`
/// so a serialization error degrades to a dropped frame instead of aborting the
/// process under `panic = abort`.
pub fn encode(frame: &Frame) -> Result<Vec<u8>, String> {
    let (msg_type, body): (u8, Vec<u8>) = match frame {
        Frame::Auth { token } => (TYPE_AUTH, serde_json::to_vec(token).map_err(|e| e.to_string())?),
        Frame::Open(req) => (TYPE_OPEN, serde_json::to_vec(req).map_err(|e| e.to_string())?),
        Frame::Write(req) => {
            let mut body = Vec::with_capacity(4 + req.data.len());
            body.extend_from_slice(&req.id.to_le_bytes());
            body.extend_from_slice(&req.data);
            (TYPE_WRITE, body)
        }
        Frame::Resize(req) => (TYPE_RESIZE, serde_json::to_vec(req).map_err(|e| e.to_string())?),
        Frame::Kill(req) => (TYPE_KILL, serde_json::to_vec(req).map_err(|e| e.to_string())?),
        Frame::List => (TYPE_LIST, Vec::new()),
        Frame::Ping => (TYPE_PING, Vec::new()),
        Frame::Shutdown => (TYPE_SHUTDOWN, Vec::new()),
        Frame::Replay { id } => (TYPE_REPLAY, id.to_le_bytes().to_vec()),
        Frame::Output { id, data } => {
            let mut body = Vec::with_capacity(4 + data.len());
            body.extend_from_slice(&id.to_le_bytes());
            body.extend_from_slice(data);
            (TYPE_OUTPUT, body)
        }
        Frame::Exit(e) => (TYPE_EXIT, serde_json::to_vec(e).map_err(|e| e.to_string())?),
        Frame::AgentSignal(e) => (TYPE_AGENT_SIGNAL, serde_json::to_vec(e).map_err(|e| e.to_string())?),
        Frame::SessionList(l) => (TYPE_SESSION_LIST, serde_json::to_vec(l).map_err(|e| e.to_string())?),
        Frame::Pong => (TYPE_PONG, Vec::new()),
        Frame::Error(e) => (TYPE_ERROR, serde_json::to_vec(e).map_err(|e| e.to_string())?),
    };
    let mut out = Vec::with_capacity(5 + body.len());
    out.extend_from_slice(&encode_len(body.len()));
    out.push(msg_type);
    out.extend_from_slice(&body);
    Ok(out)
}

/// Decode one frame body (length prefix and type byte already stripped).
pub fn decode(body_len: usize, msg_type: u8, body: &[u8]) -> Option<Frame> {
    debug_assert_eq!(body.len(), body_len);
    match msg_type {
        TYPE_AUTH => serde_json::from_slice::<String>(body).ok().map(|token| Frame::Auth { token }),
        TYPE_OPEN => serde_json::from_slice::<OpenReq>(body).ok().map(Frame::Open),
        TYPE_WRITE => {
            if body.len() < 4 {
                return None;
            }
            let id = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
            Some(Frame::Write(WriteReq { id, data: body[4..].to_vec() }))
        }
        TYPE_RESIZE => serde_json::from_slice::<ResizeReq>(body).ok().map(Frame::Resize),
        TYPE_KILL => serde_json::from_slice::<KillReq>(body).ok().map(Frame::Kill),
        TYPE_LIST => Some(Frame::List),
        TYPE_PING => Some(Frame::Ping),
        TYPE_SHUTDOWN => Some(Frame::Shutdown),
        TYPE_REPLAY => {
            if body.len() < 4 {
                return None;
            }
            let id = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
            Some(Frame::Replay { id })
        }
        TYPE_OUTPUT => {
            if body.len() < 4 {
                return None;
            }
            let id = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
            Some(Frame::Output { id, data: body[4..].to_vec() })
        }
        TYPE_EXIT => serde_json::from_slice::<ExitEvent>(body).ok().map(Frame::Exit),
        TYPE_AGENT_SIGNAL => {
            serde_json::from_slice::<AgentSignalEvent>(body).ok().map(Frame::AgentSignal)
        }
        TYPE_SESSION_LIST => serde_json::from_slice::<SessionList>(body).ok().map(Frame::SessionList),
        TYPE_PONG => Some(Frame::Pong),
        TYPE_ERROR => serde_json::from_slice::<ErrorMsg>(body).ok().map(Frame::Error),
        _ => None,
    }
}

/// A reader that consumes length-prefixed frames from a byte stream.
/// `read_frame` blocks until a full frame is available or EOF.
pub struct FrameReader<T> {
    inner: T,
}

impl<T: std::io::Read> FrameReader<T> {
    pub fn new(inner: T) -> Self {
        Self { inner }
    }

    /// Reads one frame. Ok(Some((type, body))) on success, Ok(None) on clean
    /// EOF, Err on I/O errors or oversized frames.
    pub fn read_frame(&mut self) -> std::io::Result<Option<(u8, Vec<u8>)>> {
        let mut len_buf = [0u8; 4];
        let mut read = 0;
        while read < 4 {
            match self.inner.read(&mut len_buf[read..]) {
                Ok(0) => {
                    if read == 0 {
                        return Ok(None);
                    }
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "truncated frame header",
                    ));
                }
                Ok(n) => read += n,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e),
            }
        }
        let len = decode_len(&len_buf);
        if len > MAX_FRAME {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("frame too large: {len}"),
            ));
        }
        let mut type_buf = [0u8; 1];
        read = 0;
        while read < 1 {
            match self.inner.read(&mut type_buf[read..]) {
                Ok(0) => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "truncated frame type",
                    ));
                }
                Ok(n) => read += n,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e),
            }
        }
        let mut body = vec![0u8; len];
        self.inner.read_exact(&mut body)?;
        Ok(Some((type_buf[0], body)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(frame: &Frame) -> Frame {
        let bytes = encode(frame).expect("encode");
        let len = decode_len(&bytes[..4]);
        assert_eq!(len, bytes.len() - 5);
        decode(len, bytes[4], &bytes[5..]).expect("decode")
    }

    #[test]
    fn roundtrips_control_frames() {
        let cases = [
            Frame::Auth { token: "tok-123".into() },
            Frame::Open(OpenReq {
                id: 7,
                cols: 120,
                rows: 40,
                cwd: Some("/tmp".into()),
                shell: None,
                blocks: true,
                workspace: None,
                ssh_host: None,
                ssh_user: None,
                ssh_port: None,
                ssh_key: None,
            }),
            Frame::Write(WriteReq { id: 7, data: b"echo hi\r".to_vec() }),
            Frame::Resize(ResizeReq { id: 7, cols: 100, rows: 30 }),
            Frame::Kill(KillReq { id: 7 }),
            Frame::List,
            Frame::Ping,
            Frame::Shutdown,
            Frame::Replay { id: 7 },
            Frame::Exit(ExitEvent { id: 7, code: 0 }),
            Frame::AgentSignal(AgentSignalEvent { id: 7, kind: "started".into(), agent: Some("claude".into()) }),
            Frame::SessionList(SessionList { sessions: vec![] }),
            Frame::Error(ErrorMsg { message: "boom".into() }),
        ];
        for c in &cases {
            match (c, roundtrip(c)) {
                (Frame::Open(a), Frame::Open(b)) => assert_eq!(a.id, b.id),
                (Frame::Write(a), Frame::Write(b)) => {
                    assert_eq!(a.id, b.id);
                    assert_eq!(a.data, b.data);
                }
                (a, b) => assert_eq!(format!("{a:?}"), format!("{b:?}")),
            }
        }
    }

    #[test]
    fn roundtrips_write_with_binary_payload() {
        let payload = (0..=255u8).collect::<Vec<_>>();
        match roundtrip(&Frame::Write(WriteReq { id: 9, data: payload.clone() })) {
            Frame::Write(WriteReq { id, data }) => {
                assert_eq!(id, 9);
                assert_eq!(data, payload);
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn roundtrips_output_with_binary_payload() {
        let payload = (0..=255u8).collect::<Vec<_>>();
        let frame = Frame::Output { id: 3, data: payload.clone() };
        match roundtrip(&frame) {
            Frame::Output { id, data } => {
                assert_eq!(id, 3);
                assert_eq!(data, payload);
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn reader_parses_back_to_back_frames() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&encode(&Frame::Ping).expect("encode"));
        bytes.extend_from_slice(&encode(&Frame::Output { id: 1, data: vec![1, 2, 3] }).expect("encode"));
        let mut reader = FrameReader::new(&bytes[..]);
        let (t, _) = reader.read_frame().unwrap().unwrap();
        assert_eq!(t, TYPE_PING);
        let (t2, body2) = reader.read_frame().unwrap().unwrap();
        assert_eq!(t2, TYPE_OUTPUT);
        match decode(body2.len(), t2, &body2) {
            Some(Frame::Output { id, data }) => {
                assert_eq!(id, 1);
                assert_eq!(data, vec![1, 2, 3]);
            }
            other => panic!("unexpected: {other:?}"),
        }
        assert!(reader.read_frame().unwrap().is_none());
    }

    #[test]
    fn rejects_oversized_frame() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&((MAX_FRAME as u32) + 1).to_le_bytes());
        bytes.push(TYPE_PING);
        let mut reader = FrameReader::new(&bytes[..]);
        assert!(reader.read_frame().is_err());
    }

    #[test]
    fn rejects_unknown_type() {
        let mut raw = Vec::new();
        raw.extend_from_slice(&1u32.to_le_bytes());
        raw.push(0xEE);
        raw.push(0x01);
        let mut reader = FrameReader::new(&raw[..]);
        let (t, body) = reader.read_frame().unwrap().unwrap();
        assert_eq!(t, 0xEE);
        assert!(decode(body.len(), t, &body).is_none());
    }
}
