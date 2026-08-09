const fs = require('fs');

// Patch 1: createSkill.ts — create skill dir before writing
{
  const p = 'src/modules/ai/tools/createSkill.ts';
  let c = fs.readFileSync(p, 'utf8');
  const needle =
    '        const safeName = name.trim().toLowerCase();\r\n' +
    '        const filePath = `${dir}/${safeName}/skill.json`;\r\n' +
    '\r\n' +
    '        // Workspace authorization: the skill path must be writable within the\r\n' +
    '        // workspace.\r\n' +
    '        const writeCheck = await checkWritableCanonical(filePath, native.canonicalize);\r\n' +
    '        if (!writeCheck.ok) return { error: writeCheck.reason };\r\n';
  if (!c.includes(needle)) {
    console.error('createSkill.ts: needle not found');
    process.exit(1);
  }
  const replacement =
    '        const safeName = name.trim().toLowerCase();\r\n' +
    '        const skillDir = `${dir}/${safeName}`;\r\n' +
    '        const filePath = `${skillDir}/skill.json`;\r\n' +
    '\r\n' +
    '        // Workspace authorization: the skill path must be writable within the\r\n' +
    '        // workspace.\r\n' +
    '        const writeCheck = await checkWritableCanonical(filePath, native.canonicalize);\r\n' +
    '        if (!writeCheck.ok) return { error: writeCheck.reason };\r\n' +
    '\r\n' +
    '        // Target directory may not exist for a fresh skill name — create it\r\n' +
    '        // first or the write fails with ENOENT (R29 verification found this\r\n' +
    '        // live: create_skill on a new name → os error 3). fs_create_dir builds\r\n' +
    '        // the chain; "already exists" is tolerated below.\r\n' +
    '        try {\r\n' +
    '          await native.createDir(skillDir);\r\n' +
    '        } catch {\r\n' +
    '          // Directory may already exist from a prior run — the write below is\r\n' +
    '          // the real arbiter.\r\n' +
    '        }\r\n';
  c = c.replace(needle, replacement);
  fs.writeFileSync(p, c, 'utf8');
  console.log('Patched createSkill.ts (create dir before write)');
}

// Patch 2: importRules.ts — same fix
{
  const p = 'src/modules/ai/tools/importRules.ts';
  let c = fs.readFileSync(p, 'utf8');
  const needle =
    '          const skillDir = `${workspaceRoot.replace(/\\/$/, "")}/skills`;\r\n' +
    '          const safeName = parsed.name\r\n' +
    '            .toLowerCase()\r\n' +
    '            .replace(/[^a-z0-9_-]/g, "-")\r\n' +
    '            .replace(/^-+/, "");\r\n' +
    '          const filePath = `${skillDir}/${safeName}/skill.json`;\r\n';
  if (!c.includes(needle)) {
    console.error('importRules.ts: needle not found');
    process.exit(1);
  }
  const replacement =
    '          const skillDir = `${workspaceRoot.replace(/\\/$/, "")}/skills`;\r\n' +
    '          const safeName = parsed.name\r\n' +
    '            .toLowerCase()\r\n' +
    '            .replace(/[^a-z0-9_-]/g, "-")\r\n' +
    '            .replace(/^-+/, "");\r\n' +
    '          const targetDir = `${skillDir}/${safeName}`;\r\n' +
    '          const filePath = `${targetDir}/skill.json`;\r\n' +
    '          // Create the target dir first — a fresh skill name has no parent\r\n' +
    '          // directory and a bare write fails with ENOENT.\r\n' +
    '          try {\r\n' +
    '            await native.createDir(targetDir);\r\n' +
    '          } catch {\r\n' +
    '            // Already exists — the write below is the real arbiter.\r\n' +
    '          }\r\n';
  c = c.replace(needle, replacement);
  fs.writeFileSync(p, c, 'utf8');
  console.log('Patched importRules.ts (create dir before write)');
}
