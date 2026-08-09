//! Process resource statistics (CPU %, memory). GPU is surfaced by the
//! frontend via active WebGL context count + renderer string, since per-GPU
//! utilization requires vendor counters (NVML / DXGI) that are out of scope
//! here. CPU% is a delta between successive samples (first call = 0).

use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::State;

/// Holds the previous (process_cpu_ms, wall_ms) sample so `resource_stats`
/// can compute a delta CPU%.
#[derive(Default)]
pub struct ResourceStatsState {
    last: RwLock<Option<(u64, u64)>>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceStats {
    /// CPU% of this process since the previous sample (0 on first call).
    pub cpu_percent: f64,
    /// Resident set size in MB.
    pub memory_mb: f64,
    /// Process uptime in seconds.
    pub uptime_secs: u64,
}

fn now_wall_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Process CPU time consumed (ms), user + kernel.
#[cfg(windows)]
fn process_cpu_time_ms() -> u64 {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};
    unsafe {
        let mut creation: FILETIME = std::mem::zeroed();
        let mut exit: FILETIME = std::mem::zeroed();
        let mut kernel: FILETIME = std::mem::zeroed();
        let mut user: FILETIME = std::mem::zeroed();
        if GetProcessTimes(
            GetCurrentProcess(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        ) == 0
        {
            return 0;
        }
        let to_ms = |t: FILETIME| -> u64 {
            let raw = ((t.dwHighDateTime as u64) << 32) | (t.dwLowDateTime as u64);
            raw / 10_000 // 100ns units → ms
        };
        to_ms(kernel).saturating_add(to_ms(user))
    }
}

/// Process CPU time consumed (ms), user + kernel (getrusage timeval).
#[cfg(not(windows))]
fn process_cpu_time_ms() -> u64 {
    unsafe {
        let mut ru: libc::rusage = std::mem::zeroed();
        if libc::getrusage(libc::RUSAGE_SELF, &mut ru) != 0 {
            return 0;
        }
        let to_ms = |tv: libc::timeval| -> u64 {
            (tv.tv_sec as u64).saturating_mul(1000)
                + (tv.tv_usec as u64) / 1000
        };
        to_ms(ru.ru_utime).saturating_add(to_ms(ru.ru_stime))
    }
}

/// Resident set size in MB.
#[cfg(windows)]
fn process_rss_mb() -> f64 {
    use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    unsafe {
        let mut counters: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
        if GetProcessMemoryInfo(
            GetCurrentProcess(),
            &mut counters,
            std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        ) == 0
        {
            return 0.0;
        }
        counters.WorkingSetSize as f64 / (1024.0 * 1024.0)
    }
}

/// Resident set size in MB (getrusage ru_maxrss; KB on Linux, bytes on macOS).
#[cfg(not(windows))]
fn process_rss_mb() -> f64 {
    unsafe {
        let mut ru: libc::rusage = std::mem::zeroed();
        if libc::getrusage(libc::RUSAGE_SELF, &mut ru) != 0 {
            return 0.0;
        }
        #[cfg(target_os = "macos")]
        {
            ru.ru_maxrss as f64 / (1024.0 * 1024.0)
        }
        #[cfg(not(target_os = "macos"))]
        {
            ru.ru_maxrss as f64 / 1024.0
        }
    }
}

/// Compute the CPU% delta between two samples. Pure — unit-tested.
fn compute_cpu_percent(last_cpu: u64, last_wall: u64, now_cpu: u64, now_wall: u64) -> f64 {
    if now_wall <= last_wall {
        return 0.0;
    }
    let cpu_delta = now_cpu.saturating_sub(last_cpu) as f64;
    let wall_delta = (now_wall - last_wall) as f64;
    (cpu_delta / wall_delta * 100.0).clamp(0.0, 100.0)
}

/// Snapshot of this process's resource usage. `cpu_percent` is the delta over
/// the interval since the previous call (stateful); the first call reports 0.
#[tauri::command]
pub fn resource_stats(state: State<'_, ResourceStatsState>) -> ResourceStats {
    let wall = now_wall_ms();
    let cpu = process_cpu_time_ms();
    let cpu_percent = match *state.last.read().unwrap_or_else(|e| e.into_inner()) {
        Some((last_cpu, last_wall)) => {
            let pct = compute_cpu_percent(last_cpu, last_wall, cpu, wall);
            (pct * 10.0).round() / 10.0
        }
        None => 0.0,
    };
    *state.last.write().unwrap_or_else(|e| e.into_inner()) = Some((cpu, wall));
    ResourceStats {
        cpu_percent,
        memory_mb: (process_rss_mb() * 10.0).round() / 10.0,
        uptime_secs: wall / 1000,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_percent_delta_math() {
        // 500ms cpu over 1000ms wall → 50%.
        assert_eq!(compute_cpu_percent(0, 0, 500, 1000), 50.0);
        // cpu > wall (multi-core) caps at 100%.
        assert_eq!(compute_cpu_percent(0, 0, 1500, 1000), 100.0);
        // Same timestamp → 0 (guard against div-by-zero).
        assert_eq!(compute_cpu_percent(10, 5, 10, 5), 0.0);
        // Backwards wall clock → 0.
        assert_eq!(compute_cpu_percent(10, 1000, 20, 500), 0.0);
    }
}
