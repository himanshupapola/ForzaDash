const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const exePath = path.join(root, "dist", "ForzaDash.exe");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log("Stopping running ForzaDash instances...");
spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "Get-Process ForzaDash -ErrorAction SilentlyContinue | Stop-Process -Force",
  ],
  { stdio: "inherit", windowsHide: true },
);

console.log("Building portable EXE...");
run("npm.cmd", ["run", "dist:win"]);

if (!fs.existsSync(exePath)) {
  console.error("Build finished, but dist\\ForzaDash.exe was not found.");
  process.exit(1);
}

const stat = fs.statSync(exePath);
console.log(`Ready: ${exePath}`);
console.log(`Size: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
