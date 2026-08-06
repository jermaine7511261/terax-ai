//! Per-session rolling scrollback buffer.
//!
//! The renderer (xterm.js) keeps its own scrollback in frontend memory. For
//! very large outputs that memory grows unbounded and is lost when the tab is
//! closed or the main process crashes (the helper holds the PTY, not the
//! buffer). This module mirrors output into a bounded ring so a consumer can
//! page it back via `pty_buffer_lines` without keeping the whole stream in
//! frontend memory.

use std::sync::Mutex;

/// Default cap: ~10k lines. Oldest lines are evicted past this.
pub const DEFAULT_CAP: usize = 10_000;

pub struct RollingBuffer {
    inner: Mutex<Ring>,
}

struct Ring {
    /// Line-ordered, `start` = absolute index of `lines[0]` in the stream.
    lines: Vec<String>,
    start: u64,
    cap: usize,
    /// Incomplete trailing line awaiting the next chunk (no trailing newline yet).
    partial: String,
}

impl Default for RollingBuffer {
    fn default() -> Self {
        Self::new(DEFAULT_CAP)
    }
}

impl RollingBuffer {
    pub fn new(cap: usize) -> Self {
        Self {
            inner: Mutex::new(Ring {
                lines: Vec::with_capacity(cap.min(4096)),
                start: 0,
                cap,
                partial: String::new(),
            }),
        }
    }

    /// Append a raw byte chunk, splitting into lines. ANSI escapes are kept
    /// as-is (the consumer is xterm.js which parses them); we only split on
    /// `\n`. Partial lines are completed by the next chunk.
    pub fn push(&self, chunk: &[u8]) {
        let mut ring = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let text = String::from_utf8_lossy(chunk);
        // Prepend any incomplete line from the previous chunk.
        let mut combined = std::mem::take(&mut ring.partial);
        combined.push_str(&text);
        // Split into lines: each segment before a \n is a complete line; a
        // trailing segment without \n is still incomplete.
        let mut parts = combined.split('\n').peekable();
        while let Some(part) = parts.next() {
            let part = part.strip_suffix('\r').unwrap_or(part);
            if parts.peek().is_none() {
                // Last segment: no trailing \n → incomplete, hold for next chunk.
                if !part.is_empty() {
                    ring.partial = part.to_string();
                }
            } else if !part.is_empty() {
                ring.push_line(part.to_string());
            }
        }
    }

    /// Page `count` lines ending at (exclusive) absolute `end`. `end == None`
    /// means the tail. Returns `(lines, absolute_start_of_first_line, total)`.
    /// `total` is the number of lines currently held.
    pub fn page(&self, count: usize, end: Option<u64>) -> (Vec<String>, u64, u64) {
        let ring = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        // The incomplete trailing line is exposed as the last line (it's what
        // the cursor sits on), so paging the tail includes it.
        let has_partial = !ring.partial.is_empty();
        let held = ring.lines.len() as u64 + if has_partial { 1 } else { 0 };
        let tail = end.unwrap_or(ring.start + held);
        let end = tail.clamp(ring.start, ring.start + held);
        let from = end.saturating_sub(count.max(1) as u64).max(ring.start);
        let from_idx = (from - ring.start) as usize;
        let end_idx = (end - ring.start) as usize;
        let mut lines: Vec<String> = ring.lines[from_idx..end_idx.min(ring.lines.len())].to_vec();
        if has_partial && end_idx >= ring.lines.len() {
            lines.push(ring.partial.clone());
        }
        (lines, from, held)
    }
}

impl Ring {
    fn push_line(&mut self, line: String) {
        // A trailing empty line after the final \n is a no-op for paging (it
        // represents the cursor position, not content).
        if self.lines.is_empty() && line.is_empty() {
            return;
        }
        self.lines.push(line);
        if self.lines.len() > self.cap {
            let overflow = self.lines.len() - self.cap;
            self.lines.drain(0..overflow);
            self.start += overflow as u64;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_lines_and_pages_tail() {
        let b = RollingBuffer::new(100);
        b.push(b"one\ntwo\nthree");
        let (lines, from, total) = b.page(10, None);
        assert_eq!(lines, vec!["one", "two", "three"]);
        assert_eq!(from, 0);
        assert_eq!(total, 3);
    }

    #[test]
    fn evicts_oldest_past_cap() {
        let b = RollingBuffer::new(3);
        for i in 0..10 {
            b.push(format!("line{i}").as_bytes());
            b.push(b"\n");
        }
        let (lines, from, total) = b.page(10, None);
        assert_eq!(lines, vec!["line7", "line8", "line9"]);
        assert_eq!(from, 7);
        assert_eq!(total, 3);
    }

    #[test]
    fn pages_historical_range() {
        let b = RollingBuffer::new(100);
        for i in 0..10 {
            b.push(format!("line{i}").as_bytes());
            b.push(b"\n");
        }
        // Page lines ending at absolute 5, 2 wide → ["line3","line4"].
        let (lines, from, _) = b.page(2, Some(5));
        assert_eq!(lines, vec!["line3", "line4"]);
        assert_eq!(from, 3);
    }

    #[test]
    fn handles_crlf() {
        let b = RollingBuffer::new(100);
        b.push(b"a\r\nb\r\n");
        let (lines, _, _) = b.page(10, None);
        assert_eq!(lines, vec!["a", "b"]);
    }

    #[test]
    fn clamp_end_into_held_range() {
        let b = RollingBuffer::new(100);
        b.push(b"a\nb\n");
        // end=9999 beyond tail → clamps to tail (2).
        let (lines, from, total) = b.page(10, Some(9999));
        assert_eq!(lines, vec!["a", "b"]);
        assert_eq!(from, 0);
        assert_eq!(total, 2);
    }
}
