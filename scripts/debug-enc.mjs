import { readFileSync } from "fs";
const c = readFileSync("E:/Agent/yamet/src/modules/ai/store/agentsStore.ts", "utf8");
console.log("hasCR:", c.includes("\r"));
console.log("hasCRLF:", c.includes("\r\n"));
console.log("indexOf emit:", c.indexOf("events.emit("));
console.log("indexOf CHANGED:", c.indexOf("CHANGED_EVENT)"));
const idx = c.indexOf("CHANGED_EVENT)");
if (idx >= 0) console.log("context:", JSON.stringify(c.substring(idx - 10, idx + 30)));
