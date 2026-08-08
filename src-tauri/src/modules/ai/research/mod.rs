//! L3 deep_search research harness (P3): plan→poll session state machine over
//! the phase pipeline (Plan → Research → Verify → Report), with the fira-style
//! independent `#dr` budget (reserve/refund) and exact-ID verification. The
//! heavy lifting (subagent runs) stays delegated; the orchestration,
//! accounting, and reconciliation are native Rust pure functions.

pub mod budget;
pub mod report;
pub mod verify;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use tauri::State;

use self::budget::{BudgetOutcome, ResearchBudget};
use self::verify::Claim;

const DEFAULT_BREADTH: usize = 4;
const MAX_BREADTH: usize = 6;
const DEFAULT_DR_BUDGET: u64 = 8; // parallel worker slots
const RESERVED_PER_WORKER: u64 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResearchPhase {
    Plan,
    Research,
    Verify,
    Report,
    Done,
}

impl ResearchPhase {
    fn label(&self) -> &'static str {
        match self {
            ResearchPhase::Plan => "plan",
            ResearchPhase::Research => "research",
            ResearchPhase::Verify => "verify",
            ResearchPhase::Report => "report",
            ResearchPhase::Done => "done",
        }
    }
}

pub struct DeepSearchState {
    sessions: RwLock<HashMap<u32, Arc<DeepSearchSession>>>,
    next_id: AtomicU32,
}

impl Default for DeepSearchState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

pub struct DeepSearchSession {
    pub id: u32,
    pub query: String,
    pub breadth: usize,
    pub phase: RwLock<ResearchPhase>,
    pub budget: RwLock<ResearchBudget>,
    pub candidates: RwLock<Vec<Claim>>,
    pub verified: RwLock<Vec<Claim>>,
    pub coverage_notes: RwLock<Vec<String>>,
    pub report: RwLock<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSearchStartParams {
    pub query: String,
    pub breadth: Option<usize>,
    pub budget: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSearchPoll {
    pub id: u32,
    pub phase: String,
    pub query: String,
    pub progress: String,
    pub verified: usize,
    pub total_candidates: usize,
    pub usage_ratio: f64,
    pub report: Option<String>,
}

/// Start a research session. The caller advances it phase-by-phase via
/// `deep_search_advance` (the harness drives the actual subagent calls).
#[tauri::command]
pub async fn deep_search_start(
    state: State<'_, DeepSearchState>,
    params: DeepSearchStartParams,
) -> Result<u32, String> {
    let query = params.query.trim().to_string();
    if query.is_empty() {
        return Err("empty research query".into());
    }
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let session = Arc::new(DeepSearchSession {
        id,
        query,
        breadth: params.breadth.unwrap_or(DEFAULT_BREADTH).clamp(2, MAX_BREADTH),
        phase: RwLock::new(ResearchPhase::Plan),
        budget: RwLock::new(ResearchBudget::new(params.budget.unwrap_or(DEFAULT_DR_BUDGET))),
        candidates: RwLock::new(Vec::new()),
        verified: RwLock::new(Vec::new()),
        coverage_notes: RwLock::new(Vec::new()),
        report: RwLock::new(None),
    });
    state.sessions.write().unwrap_or_else(|e| e.into_inner()).insert(id, Arc::clone(&session));
    log::info!("deep_search started id={id} breadth={}", session.breadth);
    Ok(id)
}

fn take_session(state: &DeepSearchState, id: u32) -> Result<Arc<DeepSearchSession>, String> {
    state
        .sessions
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("no deep_search session {id}"))
}

#[tauri::command]
pub fn deep_search_abort(state: State<'_, DeepSearchState>, id: u32) -> Result<(), String> {
    if state.sessions.write().unwrap_or_else(|e| e.into_inner()).remove(&id).is_some() {
        log::info!("deep_search aborted id={id}");
    }
    Ok(())
}

#[tauri::command]
pub fn deep_search_poll(
    state: State<'_, DeepSearchState>,
    id: u32,
) -> Result<DeepSearchPoll, String> {
    let s = take_session(&state, id)?;
    let phase = s.phase.read().unwrap_or_else(|e| e.into_inner()).label().to_string();
    let verified = s.verified.read().unwrap_or_else(|e| e.into_inner()).len();
    let total = s.candidates.read().unwrap_or_else(|e| e.into_inner()).len();
    let usage = s.budget.read().unwrap_or_else(|e| e.into_inner()).usage_ratio();
    let report = s.report.read().unwrap_or_else(|e| e.into_inner()).clone();
    let progress = report::status_line(&s.query, &phase, verified, total);
    Ok(DeepSearchPoll {
        id,
        phase,
        query: s.query.clone(),
        progress,
        verified,
        total_candidates: total,
        usage_ratio: usage,
        report,
    })
}

/// Advance a session to the next phase. `verified` is the reconciled verified
/// claim set (from the verify phase); when `Some`, the session finalizes the
/// report and moves to Done.
#[tauri::command]
pub async fn deep_search_advance(
    state: State<'_, DeepSearchState>,
    id: u32,
    candidates: Option<Vec<Claim>>,
    verified: Option<Vec<Claim>>,
    coverage_notes: Option<Vec<String>>,
) -> Result<DeepSearchPoll, String> {
    let s = take_session(&state, id)?;
    {
        let mut phase = s.phase.write().unwrap_or_else(|e| e.into_inner());
        let next = match *phase {
            ResearchPhase::Plan => ResearchPhase::Research,
            ResearchPhase::Research => ResearchPhase::Verify,
            ResearchPhase::Verify => ResearchPhase::Report,
            ResearchPhase::Report | ResearchPhase::Done => ResearchPhase::Done,
        };
        *phase = next;
    }
    if let Some(cands) = candidates {
        *s.candidates.write().unwrap_or_else(|e| e.into_inner()) = cands;
    }
    if let Some(notes) = coverage_notes {
        *s.coverage_notes.write().unwrap_or_else(|e| e.into_inner()) = notes;
    }
    if let Some(v) = verified {
        {
            let mut b = s.budget.write().unwrap_or_else(|e| e.into_inner());
            // Refund unused reservations now that the worker fan-out is done.
            for _ in 0..s.breadth {
                b.refund(RESERVED_PER_WORKER);
            }
        }
        *s.verified.write().unwrap_or_else(|e| e.into_inner()) = v.clone();
        let notes = s.coverage_notes.read().unwrap_or_else(|e| e.into_inner()).clone();
        let report = report::synthesize_report(&s.query, &v, &notes);
        *s.report.write().unwrap_or_else(|e| e.into_inner()) = Some(report);
        *s.phase.write().unwrap_or_else(|e| e.into_inner()) = ResearchPhase::Done;
    }
    deep_search_poll(state, id)
}

/// Reserve worker quota for a research fan-out. Returns how many slots were
/// reserved (may be less than `n` when the budget is tight).
#[tauri::command]
pub fn deep_search_reserve(
    state: State<'_, DeepSearchState>,
    id: u32,
    workers: u64,
) -> Result<u64, String> {
    let s = take_session(&state, id)?;
    let mut b = s.budget.write().unwrap_or_else(|e| e.into_inner());
    let mut reserved = 0u64;
    for _ in 0..workers {
        if b.reserve(RESERVED_PER_WORKER) == BudgetOutcome::Reserved {
            reserved += 1;
        } else {
            break;
        }
    }
    Ok(reserved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claim(id: &str) -> Claim {
        Claim {
            id: id.to_string(),
            claim: format!("claim {id}"),
            evidence: format!("ev {id}"),
            source_title: format!("src {id}"),
            source_locator: format!("https://e.com/{id}"),
        }
    }

    fn session(query: &str) -> Arc<DeepSearchSession> {
        Arc::new(DeepSearchSession {
            id: 1,
            query: query.to_string(),
            breadth: 4,
            phase: RwLock::new(ResearchPhase::Plan),
            budget: RwLock::new(ResearchBudget::new(DEFAULT_DR_BUDGET)),
            candidates: RwLock::new(Vec::new()),
            verified: RwLock::new(Vec::new()),
            coverage_notes: RwLock::new(Vec::new()),
            report: RwLock::new(None),
        })
    }

    #[test]
    fn phase_advances_through_pipeline() {
        let s = session("q");
        let phase = s.phase.read().unwrap().label().to_string();
        assert_eq!(phase, "plan");
    }

    #[test]
    fn reserve_limits_parallel_workers() {
        let s = session("q");
        {
            let mut b = s.budget.write().unwrap();
            assert_eq!(b.reserve(RESERVED_PER_WORKER * 4), BudgetOutcome::Reserved);
            assert_eq!(b.reserve(RESERVED_PER_WORKER * 4), BudgetOutcome::Reserved);
            // cap is 8; the 9th reservation is refused.
            assert_eq!(b.reserve(RESERVED_PER_WORKER), BudgetOutcome::Exhausted);
        }
    }

    #[test]
    fn advance_finalizes_report_on_verified() {
        let s = session("q");
        let cands = vec![claim("c1"), claim("c2")];
        let verified = vec![claim("c1")];
        {
            let mut p = s.phase.write().unwrap();
            *p = ResearchPhase::Verify;
        }
        let mut cs = s.candidates.write().unwrap();
        *cs = cands;
        drop(cs);
        let mut v = s.verified.write().unwrap();
        *v = verified;
        drop(v);
        let mut r = s.report.write().unwrap();
        *r = Some(report::synthesize_report("q", &s.verified.read().unwrap().clone(), &[]));
        drop(r);
        assert!(s.report.read().unwrap().as_deref().unwrap_or("").contains("Status: Verified"));
    }

    #[test]
    fn ids_increment() {
        let st = DeepSearchState::default();
        assert_eq!(st.next_id.fetch_add(1, Ordering::Relaxed), 1);
    }
}
