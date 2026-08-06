//! DAP (Debug Adapter Protocol) native integration module.
//! Native stdio/TCP debug adapter clients with session lifecycle, the DAP
//! client protocol, and frontend events. This is a native feature, not
//! plugin-based.

pub mod protocol;
pub mod session;
pub mod transport;

pub use session::{DapSessionConfig, DapSessionInfo, DapSessionState, DapSessionStatus};
pub use transport::{DapTransport, DapTransportType, StdioDapTransport, TcpDapTransport};
