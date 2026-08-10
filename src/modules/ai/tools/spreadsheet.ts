import { tool } from "ai";
import { z } from "zod";
import type { WorkBook } from "xlsx";
import { native } from "../lib/native";
import { checkReadableCanonical } from "../lib/security";
import { resolvePath, type ToolContext } from "./context";

const XLSX_EXTENSIONS = new Set([".xlsx", ".xls", ".csv", ".tsv", ".ods"]);
const ROW_CAP = 200;
const COL_CAP = 50;

function extOf(p: string): string {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i).toLowerCase() : "";
}

function isSpreadsheetPath(p: string): boolean {
  return XLSX_EXTENSIONS.has(extOf(p));
}

function cellToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return JSON.stringify(v);
}

export function buildSpreadsheetTools(ctx: ToolContext) {
  return {
    read_spreadsheet: tool({
      description:
        "Read an Excel (.xlsx/.xls), CSV, TSV, or ODS spreadsheet. Returns a summary (sheet names, row/column counts) and the first N rows as a markdown table or JSON array. Use this instead of read_file for spreadsheet files -- read_file cannot parse binary Excel formats.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute path, or relative to the active terminal cwd."),
        sheet: z
          .string()
          .optional()
          .describe("Sheet name or 0-based index. Default: first sheet."),
        max_rows: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Max data rows to return (default 50, max 500)."),
        format: z
          .enum(["table", "json"])
          .optional()
          .describe("Output format: 'table' (markdown) or 'json'. Default: table."),
      }),
      execute: async ({ path, sheet, max_rows, format }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkReadableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;

        if (!isSpreadsheetPath(abs)) {
          return {
            error: `unsupported file type: ${extOf(abs) || "(none)"}. Supported: ${[...XLSX_EXTENSIONS].join(", ")}`,
            path: abs,
          };
        }

        try {
          const XLSX = await import("xlsx");
          const ext = extOf(abs);

          // For CSV/TSV, readFile returns the text content
          if (ext === ".csv" || ext === ".tsv") {
            const textResult = await native.readFile(abs);
            if (textResult.kind !== "text") {
              return { error: "cannot read CSV as text", path: abs };
            }
            const workbook = XLSX.read(textResult.content, { type: "string" });
            return await formatWorkbook(workbook, sheet, max_rows, format, abs);
          }

          // For binary formats (xlsx, xls, ods), try reading as text first
          const textResult = await native.readFile(abs);
          if (textResult.kind === "text") {
            const workbook = XLSX.read(textResult.content, { type: "string" });
            return await formatWorkbook(workbook, sheet, max_rows, format, abs);
          }

          // Binary file - can't get raw bytes through current native API
          return {
            error:
              "binary Excel file detected. Convert to CSV first, or use a tool that supports binary file reads.",
            path: abs,
            hint: "Try: save the Excel file as CSV from Excel, then use read_spreadsheet on the CSV.",
          };
        } catch (e) {
          return {
            error: `failed to parse spreadsheet: ${e instanceof Error ? e.message : String(e)}`,
            path: abs,
          };
        }
      },
    }),
  };
}

async function formatWorkbook(
  workbook: WorkBook,
  sheet: string | undefined,
  maxRows: number | undefined,
  format: "table" | "json" | undefined,
  absPath: string,
) {
  const sheetNames: string[] = workbook.SheetNames ?? [];
  if (sheetNames.length === 0) {
    return { error: "spreadsheet has no sheets", path: absPath };
  }

  // Select sheet
  let targetSheet: string;
  if (sheet !== undefined) {
    const idx = typeof sheet === "number" ? sheet : parseInt(sheet, 10);
    if (!Number.isNaN(idx) && idx >= 0 && idx < sheetNames.length) {
      targetSheet = sheetNames[idx];
    } else if (typeof sheet === "string" && sheetNames.includes(sheet)) {
      targetSheet = sheet;
    } else {
      return {
        error: `sheet "${sheet}" not found. Available: ${sheetNames.join(", ")}`,
        path: absPath,
        available_sheets: sheetNames,
      };
    }
  } else {
    targetSheet = sheetNames[0];
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const ws = workbook.Sheets[targetSheet];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const rawRows: unknown[][] = (await import("xlsx")).utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];

  const totalRows = rawRows.length;
  const cap = Math.min(maxRows ?? ROW_CAP, 500);
  const sliced = rawRows.slice(0, cap);

  // Build header from first row if it looks like headers
  let headers: string[];
  let dataRows: unknown[][];
  if (
    sliced.length > 0 &&
    sliced[0].every((c: unknown) => typeof c === "string")
  ) {
    headers = sliced[0] as string[];
    dataRows = sliced.slice(1);
  } else {
    headers = [];
    dataRows = sliced;
  }

  // Cap columns
  const colCount = headers.length || (dataRows[0]?.length ?? 0);
  const colCap = Math.min(colCount, COL_CAP);
  if (headers.length > colCap) headers = headers.slice(0, colCap);
  dataRows = dataRows.map((r) => r.slice(0, colCap));

  const summary = {
    path: absPath,
    sheet: targetSheet,
    sheets: sheetNames,
    total_rows: totalRows,
    total_columns: colCount,
    returned_rows: dataRows.length,
    truncated: totalRows > cap,
  };

  if (format === "json") {
    if (headers.length > 0) {
      const objects = dataRows.map((r) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = cellToString(r[i]);
        });
        return obj;
      });
      return { ...summary, data: objects };
    }
    return {
      ...summary,
      data: dataRows.map((r) => r.map(cellToString)),
    };
  }

  // Markdown table format
  if (headers.length > 0) {
    const colWidths = headers.map((h) => Math.min(h.length, 30));
    const sep = colWidths.map((w) => "-".repeat(Math.max(w, 3))).join(" | ");
    const headerLine = headers
      .map((h) => h.slice(0, 30).padEnd(colWidths[0]))
      .join(" | ");
    const lines = [headerLine, sep];
    for (const row of dataRows) {
      const cells = headers.map((_, i) =>
        cellToString(row[i]).slice(0, 30).padEnd(colWidths[0]),
      );
      lines.push(cells.join(" | "));
    }
    return { ...summary, table: lines.join("\n") };
  }

  // No headers -- just render as numbered rows
  const lines = dataRows.map(
    (r, i) =>
      `| ${i + 1} | ${r.map(cellToString).slice(0, COL_CAP).join(" | ")} |`,
  );
  return { ...summary, table: lines.join("\n") };
}
