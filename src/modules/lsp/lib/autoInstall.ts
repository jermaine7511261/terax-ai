import type { LspPreset } from "./presets";

export type LspInstallResult = {
  presetId: string;
  name: string;
  success: boolean;
  error?: string;
  installedAt?: string;
};

export type DetectResult = {
  presetId: string;
  name: string;
  found: boolean;
  version?: string;
  path?: string;
};

/**
 * Detect installed LSP servers by checking the PATH.
 * Returns which servers are already available.
 */
export async function detectInstalledServers(
  presets: LspPreset[],
): Promise<DetectResult[]> {
  const results: DetectResult[] = [];

  for (const preset of presets) {
    const cmd = preset.command;
    const found = await binaryExists(cmd);
    results.push({
      presetId: preset.id,
      name: preset.name,
      found,
      ...(found ? { version: "detected", path: cmd } : {}),
    });
  }

  return results;
}

/**
 * Auto-install a single LSP server using the best available package manager.
 */
export async function autoInstallLsp(
  preset: LspPreset,
): Promise<LspInstallResult> {
  if (!preset.install) {
    return {
      presetId: preset.id,
      name: preset.name,
      success: false,
      error: "No install instructions available for this LSP server",
    };
  }

  try {
    const installCmd = preset.install.command;
    // Determine the install method from the command
    const result = await executeInstall(installCmd);
    return {
      presetId: preset.id,
      name: preset.name,
      success: result.success,
      error: result.error,
      installedAt: result.success ? new Date().toISOString() : undefined,
    };
  } catch (e) {
    return {
      presetId: preset.id,
      name: preset.name,
      success: false,
      error: String(e),
    };
  }
}

/**
 * Auto-detect and install ALL missing LSP servers for a given language.
 */
export async function autoInstallForLanguage(
  presets: LspPreset[],
  langId: string,
): Promise<LspInstallResult[]> {
  const candidates = presets.filter((p) => langId in p.languages);
  const results: LspInstallResult[] = [];

  for (const preset of candidates) {
    const exists = await binaryExists(preset.command);
    if (!exists) {
      const result = await autoInstallLsp(preset);
      results.push(result);
    } else {
      results.push({
        presetId: preset.id,
        name: preset.name,
        success: true,
        installedAt: new Date().toISOString(),
      });
    }
  }

  return results;
}

/**
 * Auto-detect the programming language of a workspace and install
 * all recommended LSP servers.
 */
export async function autoDetectAndInstall(
  presets: LspPreset[],
  workspaceFiles: string[],
): Promise<{
  detected: string[];
  installed: LspInstallResult[];
}> {
  const detectedLangs = detectLanguages(workspaceFiles);
  const allResults: LspInstallResult[] = [];

  for (const lang of detectedLangs) {
    const results = await autoInstallForLanguage(presets, lang);
    allResults.push(...results);
  }

  return { detected: detectedLangs, installed: allResults };
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function binaryExists(cmd: string): Promise<boolean> {
  try {
    // Try using `which` (Unix) or `where` (Windows)
    if (typeof process !== "undefined" && process?.versions?.node) {
      const { execSync } = await import("child_process");
      try {
        execSync(`${process.platform === "win32" ? "where" : "which"} ${cmd}`, {
          stdio: "ignore",
        });
        return true;
      } catch {
        return false;
      }
    }
    // Web: always return false (no native binaries available)
    return false;
  } catch {
    return false;
  }
}

async function executeInstall(
  command: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (typeof process !== "undefined" && process?.versions?.node) {
      const { execSync } = await import("child_process");
      execSync(command, { stdio: "pipe", timeout: 120_000 });
      return { success: true };
    }
    // Web: simulate install (can't actually install)
    return {
      success: false,
      error: "Package installation not available in web mode. Install manually.",
    };
  } catch (e) {
    return {
      success: false,
      error: String(e),
    };
  }
}

// Known root markers for language detection
const LANGUAGE_DETECTORS: Record<string, string[]> = {
  typescript: ["tsconfig.json", "tsconfig.ts"],
  javascript: ["package.json", ".eslintrc", "jsconfig.json"],
  python: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"],
  rust: ["Cargo.toml", "rust-toolchain.toml"],
  go: ["go.mod", "go.sum", "Gopkg.toml"],
  java: ["pom.xml", "build.gradle", ".classpath"],
  ruby: ["Gemfile", "Rakefile", ".ruby-version"],
  php: ["composer.json", ".php"],
  c: ["CMakeLists.txt", "Makefile", "configure.ac"],
  cpp: ["CMakeLists.txt", "Makefile"],
  haskell: ["stack.yaml", "*.cabal"],
  elixir: ["mix.exs"],
  swift: ["Package.swift"],
  kotlin: ["build.gradle.kts", "settings.gradle.kts"],
  scala: ["build.sbt"],
  dart: ["pubspec.yaml"],
  lua: [".luarc.json", ".luarc.jsonc"],
  r: ["DESCRIPTION", ".Rprofile"],
  julia: ["Project.toml", "Manifest.toml"],
  dockerfile: ["Dockerfile", "docker-compose.yml"],
  terraform: ["*.tf", ".terraform"],
  solidity: ["hardhat.config.ts", "foundry.toml"],
  prisma: ["schema.prisma"],
  vue: ["vue.config.ts", "nuxt.config.ts"],
  svelte: ["svelte.config.js"],
  astro: ["astro.config.mjs", "astro.config.ts"],
};

function detectLanguages(files: string[]): string[] {
  const detected = new Set<string>();
  const fileSet = new Set(files.map((f) => f.toLowerCase()));

  for (const [lang, markers] of Object.entries(LANGUAGE_DETECTORS)) {
    for (const marker of markers) {
      const matchMarker = marker.replace("*.", "");
      if (
        fileSet.has(marker) ||
        (marker.startsWith("*.") &&
          Array.from(fileSet).some((f) => f.endsWith(matchMarker)))
      ) {
        detected.add(lang);
        break;
      }
    }
  }

  // Detect from file extensions as fallback
  for (const file of fileSet) {
    if (file.endsWith(".ts") || file.endsWith(".tsx")) detected.add("typescript");
    if (file.endsWith(".js") || file.endsWith(".jsx")) detected.add("javascript");
    if (file.endsWith(".py")) detected.add("python");
    if (file.endsWith(".rs")) detected.add("rust");
    if (file.endsWith(".go")) detected.add("go");
    if (file.endsWith(".java")) detected.add("java");
    if (file.endsWith(".rb")) detected.add("ruby");
    if (file.endsWith(".php")) detected.add("php");
    if (file.endsWith(".c") || file.endsWith(".h")) { detected.add("c"); detected.add("cpp"); }
    if (file.endsWith(".cs")) detected.add("csharp");
    if (file.endsWith(".swift")) detected.add("swift");
    if (file.endsWith(".kt") || file.endsWith(".kts")) detected.add("kotlin");
    if (file.endsWith(".vue")) detected.add("vue");
    if (file.endsWith(".svelte")) detected.add("svelte");
    if (file.endsWith(".astro")) detected.add("astro");
  }

  return Array.from(detected);
}
