//! Graph orchestration pure core (P2). Topological waves (Kahn) + parallel
//! eligibility, mirroring the frontend `graph/engine.ts` scheduling so the
//! existing graph tests' wave semantics are reproduced in Rust. No I/O — the
//! node execution (agent/judge/human/merge) stays in the harness/UI.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Agent,
    Judge,
    Human,
    Merge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeStatus {
    Pending,
    Running,
    Done,
    Failed,
    WaitingHuman,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub kind: NodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphDef {
    pub id: String,
    pub name: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRunState {
    pub node_id: String,
    pub status: NodeStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl GraphRunState {
    pub fn pending(node_id: &str) -> Self {
        Self {
            node_id: node_id.to_string(),
            status: NodeStatus::Pending,
            output: None,
            error: None,
        }
    }
}

/// Request hash: deterministic JSON of the graph structure (id + node
/// kind/agent/prompt + edges), mirroring the frontend `hashGraphDef`. Two
/// structurally identical runs map to the same journal entry.
pub fn hash_graph_def(def: &GraphDef) -> String {
    let nodes: Vec<Vec<String>> = def
        .nodes
        .iter()
        .map(|n| {
            let kind = match n.kind {
                NodeKind::Agent => "agent",
                NodeKind::Judge => "judge",
                NodeKind::Human => "human",
                NodeKind::Merge => "merge",
            };
            vec![
                n.id.clone(),
                kind.to_string(),
                n.agent.clone().unwrap_or_default(),
                n.prompt.clone().unwrap_or_default(),
            ]
        })
        .collect();
    let edges: Vec<(&str, &str)> = def.edges.iter().map(|e| (e.from.as_str(), e.to.as_str())).collect();
    serde_json::json!({
        "id": def.id,
        "nodes": nodes,
        "edges": edges,
    })
    .to_string()
}

/// Topological order via Kahn's algorithm. Returns `None` when the graph has a
/// cycle (refuse to run, mirroring the frontend).
pub fn topological_order(def: &GraphDef) -> Option<Vec<String>> {
    let mut indegree: HashMap<String, usize> = HashMap::new();
    let mut outgoing: HashMap<String, Vec<String>> = HashMap::new();
    for n in &def.nodes {
        indegree.insert(n.id.clone(), 0);
        outgoing.insert(n.id.clone(), Vec::new());
    }
    for e in &def.edges {
        if let Some(d) = indegree.get_mut(&e.to) {
            *d += 1;
        }
        if let Some(v) = outgoing.get_mut(&e.from) {
            v.push(e.to.clone());
        }
    }
    let mut queue: Vec<String> = indegree
        .iter()
        .filter(|(_, d)| **d == 0)
        .map(|(id, _)| id.clone())
        .collect();
    // Deterministic: process in node-definition order.
    queue.sort();
    let mut order: Vec<String> = Vec::new();
    let mut qi = 0usize;
    while qi < queue.len() {
        let n = queue[qi].clone();
        qi += 1;
        order.push(n.clone());
        if let Some(targets) = outgoing.get(&n) {
            let mut targets = targets.clone();
            targets.sort();
            for t in targets {
                if let Some(d) = indegree.get_mut(&t) {
                    *d -= 1;
                    if *d == 0 {
                        queue.push(t);
                    }
                }
            }
        }
    }
    if order.len() != def.nodes.len() {
        return None;
    }
    Some(order)
}

/// Build parallel waves: a node belongs to wave `max(predecessor wave) + 1`.
/// Mirrors the frontend wave construction (longest-path layering).
pub fn build_waves(def: &GraphDef) -> Option<Vec<Vec<String>>> {
    let order = topological_order(def)?;
    let preds: HashMap<String, Vec<String>> = {
        let mut m: HashMap<String, Vec<String>> = HashMap::new();
        for n in &def.nodes {
            m.insert(n.id.clone(), Vec::new());
        }
        for e in &def.edges {
            if let Some(v) = m.get_mut(&e.to) {
                v.push(e.from.clone());
            }
        }
        m
    };
    let mut wave_of: HashMap<String, usize> = HashMap::new();
    let mut waves: Vec<Vec<String>> = Vec::new();
    for id in order {
        let mut w = 0usize;
        if let Some(ps) = preds.get(&id) {
            for p in ps {
                if let Some(pw) = wave_of.get(p) {
                    if *pw >= w {
                        w = pw + 1;
                    }
                }
            }
        }
        wave_of.insert(id.clone(), w);
        if waves.len() <= w {
            waves.resize(w + 1, Vec::new());
        }
        waves[w].push(id);
    }
    Some(waves)
}

/// Judge branch pruning (frontend): mark unchosen branch roots + transitive
/// children cancelled, but only cancel a deeper node when ALL its predecessors
/// are cancelled (so a merge/diamond fed by a live branch survives).
pub fn prune_judge_branches(
    def: &GraphDef,
    judge_node: &str,
    chosen: &str,
) -> Vec<(String, NodeStatus)> {
    let outgoing: HashMap<String, Vec<String>> = {
        let mut m: HashMap<String, Vec<String>> = HashMap::new();
        for e in &def.edges {
            m.entry(e.from.clone()).or_default().push(e.to.clone());
        }
        m
    };
    let incoming: HashMap<String, Vec<String>> = {
        let mut m: HashMap<String, Vec<String>> = HashMap::new();
        for e in &def.edges {
            m.entry(e.to.clone()).or_default().push(e.from.clone());
        }
        m
    };
    let mut cancelled: HashMap<String, NodeStatus> = HashMap::new();
    let mut queue: Vec<String> = Vec::new();
    if let Some(outs) = outgoing.get(judge_node) {
        for to in outs {
            if to == chosen {
                continue;
            }
            cancelled.insert(to.clone(), NodeStatus::Cancelled);
            queue.push(to.clone());
        }
    }
    let mut qi = 0usize;
    while qi < queue.len() {
        let id = queue[qi].clone();
        qi += 1;
        if let Some(children) = outgoing.get(&id) {
            for child in children {
                if cancelled.contains_key(child) {
                    continue;
                }
                let all_preds_cancelled = incoming
                    .get(child)
                    .map(|ps| ps.iter().all(|p| cancelled.contains_key(p)))
                    .unwrap_or(true);
                if all_preds_cancelled {
                    cancelled.insert(child.clone(), NodeStatus::Cancelled);
                    queue.push(child.clone());
                }
            }
        }
    }
    cancelled.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, kind: NodeKind) -> GraphNode {
        GraphNode {
            id: id.to_string(),
            kind,
            agent: None,
            prompt: None,
        }
    }

    fn def(id: &str, nodes: Vec<GraphNode>, edges: Vec<&(&str, &str)>) -> GraphDef {
        GraphDef {
            id: id.to_string(),
            name: "g".to_string(),
            nodes,
            edges: edges
                .iter()
                .map(|(f, t)| GraphEdge {
                    from: f.to_string(),
                    to: t.to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn linear_graph_orders_and_waves() {
        let g = def(
            "g1",
            vec![node("a", NodeKind::Agent), node("b", NodeKind::Agent), node("c", NodeKind::Agent)],
            vec![&("a", "b"), &("b", "c")],
        );
        let order = topological_order(&g).unwrap();
        assert_eq!(order, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
        let waves = build_waves(&g).unwrap();
        assert_eq!(waves.len(), 3);
        assert_eq!(waves[0], vec!["a".to_string()]);
        assert_eq!(waves[2], vec!["c".to_string()]);
    }

    #[test]
    fn parallel_nodes_share_a_wave() {
        let g = def(
            "g2",
            vec![node("a", NodeKind::Agent), node("b", NodeKind::Agent), node("c", NodeKind::Merge)],
            vec![&("a", "c"), &("b", "c")],
        );
        let waves = build_waves(&g).unwrap();
        assert_eq!(waves.len(), 2);
        assert_eq!(waves[0].len(), 2); // a + b in parallel
        assert_eq!(waves[1], vec!["c".to_string()]);
    }

    #[test]
    fn cycle_is_rejected() {
        let g = def(
            "g3",
            vec![node("a", NodeKind::Agent), node("b", NodeKind::Agent)],
            vec![&("a", "b"), &("b", "a")],
        );
        assert!(topological_order(&g).is_none());
        assert!(build_waves(&g).is_none());
    }

    #[test]
    fn hash_is_deterministic() {
        let g = def(
            "g4",
            vec![node("a", NodeKind::Agent), node("b", NodeKind::Judge)],
            vec![&("a", "b")],
        );
        assert_eq!(hash_graph_def(&g), hash_graph_def(&g));
        let mut g2 = g.clone();
        g2.name = "different-name".to_string();
        assert_eq!(hash_graph_def(&g), hash_graph_def(&g2)); // name excluded
    }

    #[test]
    fn judge_prune_cancels_branch_roots() {
        let g = def(
            "g5",
            vec![node("j", NodeKind::Judge), node("x", NodeKind::Agent), node("y", NodeKind::Agent)],
            vec![&("j", "x"), &("j", "y")],
        );
        let pruned = prune_judge_branches(&g, "j", "x");
        assert_eq!(pruned.len(), 1);
        assert_eq!(pruned[0].0, "y");
        assert_eq!(pruned[0].1, NodeStatus::Cancelled);
    }

    #[test]
    fn judge_prune_preserves_diamond_merge() {
        // j -> x -> m, j -> y -> m: choosing x cancels y but NOT m (one live pred).
        let g = def(
            "g6",
            vec![node("j", NodeKind::Judge), node("x", NodeKind::Agent), node("y", NodeKind::Agent), node("m", NodeKind::Merge)],
            vec![&("j", "x"), &("j", "y"), &("x", "m"), &("y", "m")],
        );
        let pruned: HashMap<String, NodeStatus> = prune_judge_branches(&g, "j", "x")
            .into_iter()
            .collect();
        assert_eq!(pruned.get("y"), Some(&NodeStatus::Cancelled));
        assert!(!pruned.contains_key("m"));
    }
}
