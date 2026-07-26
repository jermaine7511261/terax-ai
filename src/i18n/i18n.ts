import zh from "./locales/zh";

export type Locale = "zh" | "en";

const STORAGE_KEY = "openagent-locale";

let currentLocale: Locale = (typeof localStorage !== "undefined"
  ? (localStorage.getItem(STORAGE_KEY) as Locale)
  : null) || "zh";

type TranslationValue = string | ((...args: string[]) => string);

const translations = new Map<Locale, Record<string, TranslationValue>>();

// Pre-load both languages synchronously
translations.set("zh", zh);
translations.set("en", {
  "app.name": "OpenAgent",
  "app.tagline": "AI-Native Development Environment",
  "nav.explorer": "Explorer",
  "nav.sourceControl": "Source Control",
  "nav.memory": "Memory",
  "nav.skills": "Skills",
  "nav.collaboration": "Collaboration",
  "nav.mcp": "MCP",
  "nav.sandbox": "Sandbox",
  "nav.checkpoints": "Checkpoints",
  "nav.backends": "Backends",
  "nav.cron": "Cron",
  "nav.gateway": "Gateway",
  "nav.hub": "Skills Hub",
  "nav.plugins": "Plugins",
  "nav.learning": "Learning",
  "nav.settings": "Settings",
  "ai.placeholder": "Ask anything...",
  "ai.send": "Send",
  "ai.stop": "Stop",
  "ai.thinking": "Thinking...",
  "ai.error.noKey": "No API key configured for {0}",
  "ai.error.generic": "An error occurred: {0}",
  "ai.planMode": "Plan Mode",
  "ai.buildMode": "Build Mode",
  "agent.build": "Build",
  "agent.plan": "Plan",
  "agent.explore": "Explore",
  "agent.codeReview": "Code Review",
  "agent.security": "Security",
  "agent.general": "General",
  "agent.scout": "Scout",
  "terminal.newTab": "New Terminal",
  "terminal.close": "Close",
  "terminal.copy": "Copy",
  "terminal.paste": "Paste",
  "terminal.clear": "Clear",
  "editor.unsaved": "Unsaved changes",
  "editor.save": "Save",
  "editor.format": "Format",
  "editor.find": "Find",
  "editor.replace": "Replace",
  "editor.vim": "Vim Mode",
  "settings.title": "Settings",
  "settings.ai": "AI Providers",
  "settings.models": "Models",
  "settings.theme": "Theme",
  "settings.language": "Language",
  "settings.keybindings": "Keybindings",
  "settings.about": "About",
  "permissions.allow": "Allow",
  "permissions.ask": "Ask",
  "permissions.deny": "Deny",
  "permissions.always": "Always for this session",
  "permissions.once": "Once",
  "file.open": "Open File",
  "file.save": "Save",
  "file.saveAs": "Save As",
  "file.delete": "Delete",
  "file.rename": "Rename",
  "file.newFile": "New File",
  "file.newFolder": "New Folder",
  "git.stage": "Stage",
  "git.unstage": "Unstage",
  "git.commit": "Commit",
  "git.push": "Push",
  "git.pull": "Pull",
  "git.discard": "Discard Changes",
  "git.branch": "Branch",
  "git.message": "Commit message",
  "memory.search": "Search memories...",
  "memory.noResults": "No memories found",
  "memory.sessions": "Sessions",
  "memory.memories": "Memories",
  "skills.hub": "Skills Hub",
  "skills.browse": "Browse",
  "skills.installed": "Installed",
  "skills.install": "Install",
  "skills.uninstall": "Uninstall",
  "skills.enable": "Enable",
  "skills.disable": "Disable",
  "skills.search": "Search skills...",
  "skills.noResults": "No skills found",
  "skills.noInstalled": "No installed skills",
  "mcp.title": "MCP Servers",
  "mcp.add": "Add Server",
  "mcp.remove": "Remove",
  "mcp.noServers": "No MCP servers configured",
  "sandbox.title": "Sandbox",
  "sandbox.off": "Off — No restrictions",
  "sandbox.workspace": "Workspace — Restricted to workspace",
  "sandbox.strict": "Strict — No network, workspace only",
  "sandbox.readOnly": "Read Only — No file mutations",
  "checkpoint.title": "Checkpoints",
  "checkpoint.save": "Save Snapshot",
  "checkpoint.restore": "Restore",
  "checkpoint.delete": "Delete",
  "checkpoint.noCheckpoints": "No checkpoints yet",
  "cron.title": "Cron Jobs",
  "cron.add": "Add Job",
  "cron.delete": "Delete",
  "cron.noJobs": "No cron jobs scheduled",
  "cron.schedule": "Schedule",
  "cron.command": "Command",
  "cron.name": "Job Name",
  "gateway.title": "Message Gateways",
  "gateway.add": "Add Gateway",
  "gateway.remove": "Remove",
  "gateway.noGateways": "No gateways configured",
  "gateway.platform": "Platform",
  "learning.insights": "Learning Insights",
  "learning.on": "ON",
  "learning.off": "OFF",
  "learning.noInsights": "No insights yet",
  "learning.analyzing": "Analyzing...",
  "error.unknown": "An unknown error occurred",
  "error.network": "Network error. Check your connection.",
  "error.permission": "Permission denied: {0}",
  "error.notFound": "Not found: {0}",
  "common.loading": "Loading...",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.create": "Create",
  "common.search": "Search",
  "common.filter": "Filter",
  "common.back": "Back",
  "common.refresh": "Refresh",
  "common.copy": "Copy",
  "common.copied": "Copied!",
  "common.yes": "Yes",
  "common.no": "No",
  "common.confirm": "Confirm",
  "common.close": "Close",
  "common.more": "More",
  "common.less": "Less",
  "common.all": "All",
});

export function getAvailableLocales(): { code: Locale; name: string; native: string }[] {
  return [
    { code: "zh", name: "Chinese", native: "中文" },
    { code: "en", name: "English", native: "English" },
  ];
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, locale);
  }
}

export function t(key: string, ...args: string[]): string {
  const dict = translations.get(currentLocale);
  let value = dict?.[key];

  if (!value && currentLocale !== "en") {
    const enDict = translations.get("en");
    value = enDict?.[key];
  }

  if (!value) return key;

  if (typeof value === "function") {
    return value(...args);
  }
  if (args.length > 0 && typeof value === "string") {
    return value.replace(/\{(\d+)\}/g, (_, idx) => args[Number(idx)] ?? "");
  }
  return value;
}

export function onLocaleChange(cb: () => void): void {
  listeners.add(cb);
}

export function offLocaleChange(cb: () => void): void {
  listeners.delete(cb);
}

const listeners = new Set<() => void>();

export function notifyLocaleChange(): void {
  listeners.forEach((cb) => cb());
}
