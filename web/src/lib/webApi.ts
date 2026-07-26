/**
 * Web-compatible API layer — replaces Tauri IPC with IndexedDB + in-memory stores.
 * Allows the same React components to run in the browser without Tauri.
 */

const DB_NAME = "terax-web";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("memories")) {
        db.createObjectStore("memories", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("skills")) {
        db.createObjectStore("skills", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("keychain")) {
        db.createObjectStore("keychain", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("store")) {
        db.createObjectStore("store", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeGet<T>(storeName: string, id: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function storeSet(storeName: string, data: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function storeDelete(storeName: string, id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function storeAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

// ─── Storage API (replaces tauri-plugin-store) ────────────────────────

export const webStore = {
  async get<T>(key: string): Promise<T | null> {
    const entry = await storeGet<{ key: string; value: T }>("store", key);
    return entry?.value ?? null;
  },
  async set<T>(key: string, value: T): Promise<void> {
    await storeSet("store", { key, value });
  },
  async remove(key: string): Promise<void> {
    await storeDelete("store", key);
  },
};

// ─── Keychain API (replaces OS keychain) ──────────────────────────────

export const webKeychain = {
  async get(key: string): Promise<string | null> {
    const entry = await storeGet<{ key: string; value: string }>("keychain", key);
    return entry?.value ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    await storeSet("keychain", { key, value });
  },
  async delete(key: string): Promise<void> {
    await storeDelete("keychain", key);
  },
};

// ─── Memory API ───────────────────────────────────────────────────────

export type MemoryRecord = { id: string; content: string; tags: string; source: string; created_at: string };
export type SessionRecord = { id: string; title: string; summary: string; created_at: string; model_id: string };

export const webMemory = {
  async searchMemories(query: string, _limit = 20): Promise<MemoryRecord[]> {
    const all = await storeAll<MemoryRecord>("memories");
    const q = query.toLowerCase();
    return all.filter((m) => m.content.toLowerCase().includes(q) || m.tags.toLowerCase().includes(q)).slice(0, _limit);
  },
  async addMemory(id: string, content: string, tags = "", source = ""): Promise<void> {
    await storeSet("memories", { id, content, tags, source, created_at: new Date().toISOString() });
  },
  async searchSessions(query: string, _limit = 20): Promise<SessionRecord[]> {
    const all = await storeAll<SessionRecord>("sessions");
    const q = query.toLowerCase();
    return all.filter((s) => s.title.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q)).slice(0, _limit);
  },
  async saveSession(id: string, title: string, summary: string, modelId: string): Promise<void> {
    await storeSet("sessions", { id, title, summary, model_id: modelId, created_at: new Date().toISOString() });
  },
};

// ─── Skills API ───────────────────────────────────────────────────────

export type SkillDef = { id: string; name: string; description: string; category: string; instructions: string; version: string; usage_count: number; created_at: string; updated_at: string };

export const webSkills = {
  async list(): Promise<SkillDef[]> { return storeAll<SkillDef>("skills"); },
  async get(id: string): Promise<SkillDef | null> { return storeGet<SkillDef>("skills", id); },
  async create(skill: SkillDef): Promise<void> { await storeSet("skills", skill as unknown as Record<string, unknown>); },
  async delete(id: string): Promise<void> { await storeDelete("skills", id); },
  async use(id: string): Promise<void> {
    const skill = await storeGet<SkillDef>("skills", id);
    if (skill) { skill.usage_count++; skill.updated_at = new Date().toISOString(); await storeSet("skills", skill as unknown as Record<string, unknown>); }
  },
};

// ─── File System API (web-compatible — uses in-memory + localStorage) ─

const virtualFs = new Map<string, string>();

export const webFs = {
  async readFile(path: string): Promise<string | null> { return virtualFs.get(path) ?? null; },
  async writeFile(path: string, content: string): Promise<void> { virtualFs.set(path, content); },
  async deleteFile(path: string): Promise<void> { virtualFs.delete(path); },
  async listDir(dir: string): Promise<string[]> {
    const files: string[] = [];
    for (const key of virtualFs.keys()) {
      if (key.startsWith(dir)) files.push(key);
    }
    return files;
  },
  async exists(path: string): Promise<boolean> { return virtualFs.has(path); },
};

// ─── Shell API (simulated) ────────────────────────────────────────────

export const webShell = {
  async run(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const parts = command.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    if (cmd === "echo") return { stdout: parts.slice(1).join(" "), stderr: "", exitCode: 0 };
    if (cmd === "ls" || cmd === "dir") {
      const dir = parts[1] ?? "/";
      const files = await webFs.listDir(dir);
      return { stdout: files.join("\n"), stderr: "", exitCode: 0 };
    }
    if (cmd === "cat") {
      const content = await webFs.readFile(parts[1] ?? "");
      return { stdout: content ?? `File not found: ${parts[1]}`, stderr: "", exitCode: content ? 0 : 1 };
    }
    if (cmd === "date") return { stdout: new Date().toISOString(), stderr: "", exitCode: 0 };
    if (cmd === "pwd") return { stdout: "/workspace", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: `Command not available in web mode: ${command}`, exitCode: 127 };
  },
};

// ─── LSP Detection API (web-compatible) ───────────────────────────────

export const webLsp = {
  async detect(_command: string): Promise<string | null> { return null; },
  async resolveRoot(_path: string, _markers: string[]): Promise<string | null> { return "/workspace"; },
};

// ─── AI Provider API (uses simulated or real API calls) ───────────────

export const webAi = {
  async pingProvider(url: string, _apiKey: string): Promise<boolean> {
    try {
      const resp = await fetch(url, { method: "HEAD", mode: "no-cors" });
      return resp.type === "opaque" || resp.ok;
    } catch { return false; }
  },
};

// ─── App Info ─────────────────────────────────────────────────────────

export const webAppInfo = {
  isWeb: true,
  platform: "web",
  version: "0.1.0",
};
