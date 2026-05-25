const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const iconPath = path.join(context.packager.projectDir, "dist", ".icon-ico", "icon.ico");
  const rceditPath = path.join(
    context.packager.projectDir,
    "node_modules",
    "electron-winstaller",
    "vendor",
    "rcedit.exe",
  );

  if (!fs.existsSync(exePath) || !fs.existsSync(iconPath) || !fs.existsSync(rceditPath)) {
    return;
  }

  execFileSync(rceditPath, [exePath, "--set-icon", iconPath], { stdio: "inherit" });
};
