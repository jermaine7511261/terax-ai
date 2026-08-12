/**
 * Runtime shape of the memory configuration (Round 32, R32.5 ratio model).
 * The settings UI persists these as `Preferences` fields in
 * yamet\data\yamet-settings.json; this module maps that store state into a
 * lightweight, dependency-free shape for the injection/compression/tools
 * pipeline (transport.ts, memory tools).
 *
 * R32.5: compressThreshold / compressTarget are RATIOS (0–1) against the
 * memory-block capacity (MEMORY_CAP = 100, see memoryCompress.ts): compression
 * triggers at cap × thresholdRatio entries (0.5 → 50) and settles near
 * cap × targetRatio entries (0.2 → 20), with protectRecent newest entries
 * never merged.
 */
export type MemoryProvider = "file" | "native" | "session";
export type ContextEngine = "recall" | "full" | "native" | "off";

export type MemoryPrefs = {
  /** 持久记忆总闸：关 → 不注入记忆、记忆工具报禁用。 */
  persistentMemory: boolean;
  /** 用户画像：独立注入为 USER_PROFILE 块。 */
  userProfile: string;
  /** 记忆提供方：file（data\memory.md + 工作区 YaMet.md）/ native（Rust 三作用域）/ session（仅会话）。 */
  memoryProvider: MemoryProvider;
  /** 上下文引擎：recall（recallTop top-8）/ full（≤8KB 全量）/ native（Rust 召回，仅 provider=native）/ off。 */
  contextEngine: ContextEngine;
  /** 自动压缩：默认开启；条目数 > 上限 × 阈值时压缩。 */
  autoCompress: boolean;
  /** 压缩阈值（比例 0–1）：条目数 > MEMORY_CAP × thresholdRatio 触发（默认 0.5 = 50 条）。 */
  compressThreshold: number;
  /** 压缩目标（比例 0–1）：压缩后保留 ≈ MEMORY_CAP × targetRatio 条（默认 0.2 = 20 条）。 */
  compressTarget: number;
  /** 保护最近 N 条：按 createdAt 倒序，永不参与压缩（默认 20）。 */
  protectRecent: number;
};

export const DEFAULT_MEMORY_PREFS: MemoryPrefs = {
  persistentMemory: true,
  userProfile: "",
  memoryProvider: "file",
  contextEngine: "recall",
  autoCompress: true,
  compressThreshold: 0.5,
  compressTarget: 0.2,
  protectRecent: 20,
};

const PROVIDERS: readonly string[] = ["file", "native", "session"];
const ENGINES: readonly string[] = ["recall", "full", "native", "off"];

function clamp(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * Clamp a 0–1 ratio to 2 decimals. Legacy persisted values (> 1, old
 * entry-count / percentage semantics) are normalized: old threshold N entries
 * → N/100 (20 → 0.2 → still 20 entries at cap 100), old target P% → P/100
 * (50 → 0.5), so existing installs keep their behavior.
 */
function clampRatio(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  const normalized = v > 1 ? v / 100 : v;
  if (!Number.isFinite(normalized)) return fallback;
  const clamped = Math.min(max, Math.max(min, normalized));
  return Math.round(clamped * 100) / 100;
}

/** Map the persisted Preferences slice into validated runtime MemoryPrefs. */
export function memoryPrefsFromPreferences(p: {
  persistentMemory: boolean;
  userProfile: string;
  memoryProvider: string;
  contextEngine: string;
  autoCompress: boolean;
  compressThreshold: number;
  compressTarget: number;
  protectRecent: number;
}): MemoryPrefs {
  return {
    persistentMemory: p.persistentMemory !== false,
    userProfile: p.userProfile ?? "",
    memoryProvider: PROVIDERS.includes(p.memoryProvider)
      ? (p.memoryProvider as MemoryProvider)
      : DEFAULT_MEMORY_PREFS.memoryProvider,
    contextEngine: ENGINES.includes(p.contextEngine)
      ? (p.contextEngine as ContextEngine)
      : DEFAULT_MEMORY_PREFS.contextEngine,
    autoCompress: p.autoCompress !== false,
    compressThreshold: clampRatio(
      p.compressThreshold,
      0.05,
      0.95,
      DEFAULT_MEMORY_PREFS.compressThreshold,
    ),
    compressTarget: clampRatio(
      p.compressTarget,
      0.05,
      0.9,
      DEFAULT_MEMORY_PREFS.compressTarget,
    ),
    protectRecent: clamp(
      p.protectRecent,
      0,
      100,
      DEFAULT_MEMORY_PREFS.protectRecent,
    ),
  };
}
