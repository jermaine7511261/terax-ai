//! Graph subsystem (P2): pure topological-wave scheduling + journal hash +
//! approval tri-state. Node execution (agent/judge/human/merge) lives in the
//! harness/UI; the Rust core reproduces the frontend `graph/engine.ts` +
//! `journal.ts` + `approval.ts` scheduling semantics.

pub mod approval;
pub mod engine;

pub use approval::{ApprovalChoice, ApprovalScope, ApprovalStatus, ApprovalStore, decide, reject_feedback};
pub use engine::{GraphDef, GraphEdge, GraphNode, NodeKind, NodeStatus, build_waves, hash_graph_def, prune_judge_branches, topological_order};
