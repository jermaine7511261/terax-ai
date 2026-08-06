// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- Minimal fake IndexedDB (jsdom has none). Handlers are fired on a
// microtask so the caller's `onsuccess`/`oncomplete`/`onupgradeneeded`
// assignments (which happen synchronously right after the call) are in place. ----

class FakeRequest {
  result: unknown = null;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

class FakeDatabase {
  onclose: (() => void) | null = null;
  constructor(private store: Map<string, unknown>) {}
  // The fake Map already acts as the object store; no-op for the upgrade path.
  createObjectStore(): void {}
  transaction(): FakeTransaction {
    const tx = new FakeTransaction(this.store);
    queueMicrotask(() => tx.oncomplete?.());
    return tx;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: Error | null = null;
  constructor(private store: Map<string, unknown>) {}
  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.store);
  }
}

class FakeObjectStore {
  constructor(private store: Map<string, unknown>) {}
  put(value: unknown, key: string): FakeRequest {
    this.store.set(key, value);
    return new FakeRequest();
  }
  get(key: string): FakeRequest {
    const req = new FakeRequest();
    req.result = this.store.get(key);
    queueMicrotask(() => req.onsuccess?.());
    return req;
  }
  delete(key: string): FakeRequest {
    this.store.delete(key);
    return new FakeRequest();
  }
}

const fakeIndexedDB = {
  data: new Map<string, unknown>(),
  open(): FakeRequest {
    const req = new FakeRequest();
    queueMicrotask(() => {
      req.result = new FakeDatabase(this.data);
      req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
};

// Wire the fake into the global before importing the module under test.
Object.defineProperty(globalThis, "indexedDB", {
  value: fakeIndexedDB,
  configurable: true,
  writable: true,
});

// Stub createImageBitmap (not present in jsdom).
const createImageBitmapMock = vi.fn(async () => ({
  width: 100,
  height: 50,
  close: vi.fn(),
}));
Object.defineProperty(globalThis, "createImageBitmap", {
  value: createImageBitmapMock,
  configurable: true,
  writable: true,
});

import {
  deleteBgImage,
  getBgImage,
  importBgImageFromFile,
  putBgImage,
} from "./bgImageStore";

beforeEach(() => {
  fakeIndexedDB.data.clear();
  createImageBitmapMock.mockReset();
  createImageBitmapMock.mockResolvedValue({ width: 100, height: 50, close: vi.fn() });
});

afterEach(() => {
  // @ts-expect-error cleanup between tests
  delete globalThis.OffscreenCanvas;
  // Restore real document.createElement for the DOM-canvas fallback test.
  // (vitest resets the DOM per file; we only override within the test.)
});

describe("bgImageStore CRUD", () => {
  it("puts and gets a blob by id", async () => {
    const blob = new Blob(["x"], { type: "image/png" });
    await putBgImage("img1", blob);
    const got = await getBgImage("img1");
    expect(got).toBe(blob);
  });

  it("returns null for a missing id", async () => {
    expect(await getBgImage("nope")).toBeNull();
  });

  it("deletes a blob by id", async () => {
    await putBgImage("img2", new Blob(["y"]));
    await deleteBgImage("img2");
    expect(await getBgImage("img2")).toBeNull();
  });
});

describe("importBgImageFromFile validation", () => {
  it("rejects a non-image file type", async () => {
    const file = new File(["a"], "notes.txt", { type: "text/plain" });
    await expect(importBgImageFromFile(file)).rejects.toThrow(/isn't an image/i);
  });

  it("rejects an animated gif over the animated size limit", async () => {
    const big = new File([new Uint8Array(11 * 1024 * 1024)], "anim.gif", {
      type: "image/gif",
    });
    await expect(importBgImageFromFile(big)).rejects.toThrow(
      /Animated images are limited to 10 MB/i,
    );
  });

  it("rejects a static image over the static size limit", async () => {
    const big = new File([new Uint8Array(31 * 1024 * 1024)], "photo.png", {
      type: "image/png",
    });
    await expect(importBgImageFromFile(big)).rejects.toThrow(/limited to 30 MB/i);
  });

  it("rethrows a decode failure as a friendly error", async () => {
    createImageBitmapMock.mockRejectedValue(new Error("decode fail"));
    const file = new File(["abc"], "bad.png", { type: "image/png" });
    await expect(importBgImageFromFile(file)).rejects.toThrow(/couldn't be decoded/i);
  });

  it("stores an animated file as-is", async () => {
    const file = new File(["gif-data"], "anim.gif", { type: "image/gif" });
    const { id, blob } = await importBgImageFromFile(file);
    expect(id).toBeTruthy();
    expect(blob).toBeTruthy();
    expect(createImageBitmapMock).not.toHaveBeenCalled();
    expect(await getBgImage(id)).toBe(blob);
  });

  it("re-encodes a static image via OffscreenCanvas when available", async () => {
    const convertToBlob = vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" }));
    const ctx = { drawImage: vi.fn() };
    class FakeOffscreenCanvas {
      width = 0;
      height = 0;
      getContext(): typeof ctx {
        return ctx;
      }
      convertToBlob = convertToBlob;
    }
    // @ts-expect-error assigning a fake class to OffscreenCanvas global
    globalThis.OffscreenCanvas = FakeOffscreenCanvas;

    const file = new File(["png-data"], "photo.png", { type: "image/png" });
    const { id, blob } = await importBgImageFromFile(file);
    expect(blob.type).toBe("image/jpeg");
    expect(convertToBlob).toHaveBeenCalled();
    expect(await getBgImage(id)).toBe(blob);
  });

  it("falls back to a DOM canvas when OffscreenCanvas is unavailable", async () => {
    const toBlob = vi.fn((cb: (b: Blob | null) => void) => {
      cb(new Blob(["jpeg2"], { type: "image/jpeg" }));
    });
    const ctx = { drawImage: vi.fn() };
    class FakeCanvas {
      width = 0;
      height = 0;
      getContext(): typeof ctx {
        return ctx;
      }
      toBlob = toBlob;
    }
    const realCreateElement = document.createElement.bind(document);
    document.createElement = vi.fn((tag: string) =>
      tag === "canvas" ? new FakeCanvas() : realCreateElement(tag),
    ) as unknown as typeof document.createElement;

    try {
      const file = new File(["png-data"], "photo.png", { type: "image/png" });
      const { blob } = await importBgImageFromFile(file);
      expect(blob.type).toBe("image/jpeg");
      expect(toBlob).toHaveBeenCalled();
    } finally {
      document.createElement = realCreateElement;
    }
  });
});
