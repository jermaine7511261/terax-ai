import type { LspPreset } from "@/modules/lsp/lib/presets";

export type LspDiagnostic = {
  serverId: string;
  serverName: string;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  file: string;
  line: number;
  column: number;
  code?: string;
};

export type LspSymbol = {
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
  containerName?: string;
};

export function formatDiagnosticsForAI(
  diagnostics: LspDiagnostic[],
): string {
  if (diagnostics.length === 0) return "";
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const others = diagnostics.filter(
    (d) => d.severity !== "error" && d.severity !== "warning",
  );

  const lines: string[] = ["<lsp_diagnostics>"];
  if (errors.length > 0) {
    lines.push(`  ${errors.length} error(s):`);
    for (const e of errors) {
      lines.push(`    ${e.file}:${e.line}:${e.column} — ${e.message}`);
    }
  }
  if (warnings.length > 0) {
    lines.push(`  ${warnings.length} warning(s):`);
    for (const w of warnings) {
      lines.push(`    ${w.file}:${w.line}:${w.column} — ${w.message}`);
    }
  }
  if (others.length > 0) {
    lines.push(`  ${others.length} other diagnostic(s):`);
    for (const o of others) {
      lines.push(`    ${o.file}:${o.line}:${o.column} — ${o.message}`);
    }
  }
  lines.push("</lsp_diagnostics>");
  return lines.join("\n");
}

export function formatSymbolsForAI(symbols: LspSymbol[]): string {
  if (symbols.length === 0) return "";
  const lines: string[] = ["<lsp_symbols>"];
  for (const s of symbols) {
    const container = s.containerName ? ` (in ${s.containerName})` : "";
    lines.push(`  ${s.kind} ${s.name}${container} — ${s.file}:${s.line}:${s.column}`);
  }
  lines.push("</lsp_symbols>");
  return lines.join("\n");
}

export function formatDefinitionForAI(
  name: string,
  def: { file: string; line: number; column: number; content: string } | null,
): string {
  if (!def) return `<lsp_definition name="${name}">not found</lsp_definition>`;
  return `<lsp_definition name="${name}" file="${def.file}:${def.line}:${def.column}">\n${def.content}\n</lsp_definition>`;
}

export function presetsToContext(presets: LspPreset[]): string {
  if (presets.length === 0) return "";
  const lines: string[] = ["<available_lsp_servers>"];
  for (const p of presets) {
    const langs = Object.keys(p.languages).join(", ");
    lines.push(`  ${p.name} (${p.command}) — ${langs}`);
  }
  lines.push("</available_lsp_servers>");
  return lines.join("\n");
}
