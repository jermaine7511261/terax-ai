// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { webEvents } from "./events";

describe("webEvents", () => {
  it("listen then emit delivers payload", async () => {
    const received: unknown[] = [];
    const unlisten = await webEvents.listen("test-event", (p) => {
      received.push(p.payload);
    });
    await webEvents.emit("test-event", { hello: 1 });
    await webEvents.emit("test-event", { hello: 2 });
    expect(received).toEqual([{ hello: 1 }, { hello: 2 }]);
    unlisten();
    await webEvents.emit("test-event", { hello: 3 });
    expect(received).toEqual([{ hello: 1 }, { hello: 2 }]);
  });

  it("multiple listeners on the same event", async () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    await webEvents.listen("multi", (p) => a.push(p.payload));
    await webEvents.listen("multi", (p) => b.push(p.payload));
    await webEvents.emit("multi", "x");
    expect(a).toEqual(["x"]);
    expect(b).toEqual(["x"]);
  });

  it("isolates different event names", async () => {
    const received: unknown[] = [];
    await webEvents.listen("only-a", (p) => received.push(p.payload));
    await webEvents.emit("only-b", "nope");
    await webEvents.emit("only-a", "yes");
    expect(received).toEqual(["yes"]);
  });
});
