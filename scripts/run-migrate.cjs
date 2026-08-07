const { execSync } = require("child_process");
const { readFileSync, writeFileSync } = require("fs");
const { resolve } = require("path");

// Write node command to a temp script and run via Start-Process
const cmd = `& 'C:\\Program Files\\nodejs\\node.exe' 'E:\\Agent\\yamet\\scripts\\migrate-adapter.mjs' --dry-run`;
const ps = require("child_process").execSync(
  `powershell -Command "${cmd}"`,
  { encoding: "utf8", cwd: "E:\\Agent\\yamet" }
);
console.log(ps);
