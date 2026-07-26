import { describe, it, expect } from "vitest";

// Replicate the permission logic for testing
type PermissionEffect = "allow" | "ask" | "deny";
type PermissionRule = { action: string; resource: string; effect: PermissionEffect };
type PermissionRuleset = PermissionRule[];

function match(input: string, pattern: string): boolean {
  const normalize = (s: string) => s.replaceAll("\\", "/");
  const escapeRegex = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  let escaped = normalize(pattern);

  // Handle the resource patterns: `*` at the resource level matches everything
  if (escaped === "*" || escaped === "**") return true;

  // Replace `**` with placeholder BEFORE escaping regex chars
  escaped = escaped.replace(/\*\*/g, "___DBL___");
  // Escape special regex chars (but not the placeholder)
  escaped = escapeRegex(escaped);
  // `*` → match any non-slash characters (for file paths)
  // But for command patterns (git *, rm -rf *, npm *), `*` should match everything
  escaped = escaped.replace(/\*/g, ".*");
  // `?` → match any single non-slash character
  escaped = escaped.replace(/\?/g, "[^/]");
  // Restore `**` placeholder → match everything including slashes
  escaped = escaped.replace(/___DBL___/g, ".*");

  // If pattern ends with `/*`, also allow end-of-string (bare directory)
  if (escaped.endsWith("/[^/]*")) {
    return new RegExp(`^${escaped.slice(0, -6)}(/[^/]*)?$`, "i").test(normalize(input));
  }
  return new RegExp(`^${escaped}$`, "i").test(normalize(input));
}

function evaluate(action: string, resource: string, ...rulesets: PermissionRuleset[]): PermissionRule {
  const allRules = rulesets.flat();
  const matched = allRules.findLast(
    (rule) => match(action, rule.action) && match(resource, rule.resource),
  );
  return matched ?? { action: "*", resource: "*", effect: "ask" };
}

const BUILD_PERMISSIONS: PermissionRuleset = [
  { action: "read", resource: "**", effect: "allow" },
  { action: "edit", resource: "**", effect: "allow" },
  { action: "bash", resource: "**", effect: "allow" },
  { action: "bash", resource: "rm -rf *", effect: "deny" },
  { action: "bash", resource: "sudo *", effect: "ask" },
];

const PLAN_PERMISSIONS: PermissionRuleset = [
  { action: "read", resource: "**", effect: "allow" },
  { action: "edit", resource: "**", effect: "deny" },
  { action: "bash", resource: "npm *", effect: "deny" },
  { action: "web_search", resource: "**", effect: "allow" },
];

describe("Permission System", () => {
  it("allows read for build agent", () => {
    const r = evaluate("read", "/workspace/file.ts", BUILD_PERMISSIONS);
    expect(r.effect).toBe("allow");
  });

  it("allows edit for build agent", () => {
    const r = evaluate("edit", "/workspace/file.ts", BUILD_PERMISSIONS);
    expect(r.effect).toBe("allow");
  });

  it("denies rm -rf for build agent", () => {
    const r = evaluate("bash", "rm -rf /", BUILD_PERMISSIONS);
    expect(r.effect).toBe("deny");
  });

  it("asks for sudo in build agent", () => {
    const r = evaluate("bash", "sudo rm -rf", BUILD_PERMISSIONS);
    expect(r.effect).toBe("ask");
  });

  it("denies edit for plan agent", () => {
    const r = evaluate("edit", "/workspace/file.ts", PLAN_PERMISSIONS);
    expect(r.effect).toBe("deny");
  });

  it("allows read for plan agent", () => {
    const r = evaluate("read", "/workspace/file.ts", PLAN_PERMISSIONS);
    expect(r.effect).toBe("allow");
  });

  it("denies npm for plan agent", () => {
    const r = evaluate("bash", "npm install", PLAN_PERMISSIONS);
    expect(r.effect).toBe("deny");
  });

  it("fallbacks to ask when no rule matches", () => {
    const r = evaluate("unknown_action", "unknown_resource", []);
    expect(r.effect).toBe("ask");
  });

  it("last matching rule wins", () => {
    const r = evaluate("bash", "npm install", [
      { action: "bash", resource: "**", effect: "allow" },
      { action: "bash", resource: "npm *", effect: "deny" },
    ]);
    expect(r.effect).toBe("deny");
  });
});

describe("Wildcard Matching", () => {
  it("matches exact patterns", () => {
    expect(match("file.ts", "file.ts")).toBe(true);
    expect(match("file.ts", "*.ts")).toBe(true);
    expect(match("file.js", "*.ts")).toBe(false);
  });

  it("matches glob patterns", () => {
    expect(match("src/main.ts", "src/*.ts")).toBe(true);
    expect(match("src/main.js", "src/*.ts")).toBe(false);
  });

  it("matches double-star patterns", () => {
    expect(match("src/a/b/c.ts", "src/**/*.ts")).toBe(true);
    expect(match("src/a/b/c.ts", "src/**/*.js")).toBe(false);
  });

  it("matches git command patterns", () => {
    expect(match("git push", "git *")).toBe(true);
    expect(match("git commit -m 'fix'", "git *")).toBe(true);
    expect(match("npm install", "git *")).toBe(false);
  });
});

describe("Security Checks", () => {
  const secretPaths = [
    ".env",
    ".env.local",
    ".env.production",
    "config/id_rsa",
    "path/to/credentials.pem",
    ".ssh/id_ed25519",
    ".aws/credentials",
  ];

  const safePaths = [
    "src/main.ts",
    "package.json",
    "README.md",
    "config.ts",
    "path/to/file.rs",
  ];

  it("detects secret files by basename pattern", () => {
    const isSecret = (path: string) =>
      /^\.env(\..+)?/i.test(path) ||
      /\.pem$/i.test(path) ||
      /id_rsa/i.test(path) ||
      /\.ssh\//i.test(path) ||
      /\.aws\//i.test(path);

    for (const p of secretPaths) {
      expect(isSecret(p)).toBe(true);
    }
    for (const p of safePaths) {
      expect(isSecret(p)).toBe(false);
    }
  });
});

describe("Sandbox Levels", () => {
  type SandboxLevel = "Off" | "Workspace" | "Strict" | "ReadOnly";

  function canWrite(level: SandboxLevel, path: string, workspace: string): boolean {
    switch (level) {
      case "Off": return true;
      case "ReadOnly": return false;
      case "Workspace":
      case "Strict":
        return path.startsWith(workspace);
    }
  }

  function canNetwork(level: SandboxLevel): boolean {
    return level !== "Strict";
  }

  it("allows all in Off mode", () => {
    expect(canWrite("Off", "/etc/passwd", "/workspace")).toBe(true);
    expect(canNetwork("Off")).toBe(true);
  });

  it("blocks writes in ReadOnly mode", () => {
    expect(canWrite("ReadOnly", "/workspace/file.ts", "/workspace")).toBe(false);
  });

  it("restricts to workspace in Workspace mode", () => {
    expect(canWrite("Workspace", "/workspace/file.ts", "/workspace")).toBe(true);
    expect(canWrite("Workspace", "/etc/passwd", "/workspace")).toBe(false);
  });

  it("blocks network in Strict mode", () => {
    expect(canNetwork("Strict")).toBe(false);
  });
});
