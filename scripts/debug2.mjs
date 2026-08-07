import { readFileSync } from "fs";
const c = readFileSync("E:/Agent/yamet/src/modules/ai/store/agentsStore.ts", "utf8");
console.log("line29:", c.split("\n")[28]?.trim());
