import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";

const INTERVAL_MS = 5 * 60_000; // 5 minutes
const SCRIPT = "./s-sync.mjs";
const LOCK_FILE = "./statusphere.lock";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function isLockStale(lockPath, maxAgeMs = 15 * 60_000) {
  try {
    const stat = fs.statSync(lockPath);
    return (Date.now() - stat.mtimeMs) > maxAgeMs;
  } catch {
    return false;
  }
}
async function runOnce() {
  // Prevent overlap
  if (fs.existsSync(LOCK_FILE)) {
  if (isLockStale(LOCK_FILE)) {
    console.log("🧹 Stale lock detected. Removing lock.");
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  } else {
    console.log("🔒 Lock exists, skipping this cycle.");
    return;
  }
}

  fs.writeFileSync(LOCK_FILE, String(Date.now()));

  try {
    console.log("▶ Starting s-sync.mjs at", new Date().toISOString());

    await new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT], {
        windowsHide: true,                   // ✅ hide new console window
        stdio: ["ignore", "pipe", "pipe"],   // ✅ no console attach
        env: process.env,
        cwd: process.cwd(),
        shell: false,
      });

      // pipe logs back to pm2 logs
      child.stdout.on("data", (d) => process.stdout.write(d));
      child.stderr.on("data", (d) => process.stderr.write(d));

      child.on("close", (code) => {
        console.log("⏹ s-sync.mjs finished with code:", code);
        resolve();
      });
    });
  } finally {
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  }
}



async function main() {
  while (true) {
    const started = Date.now();
    await runOnce();

    // Start-to-start cadence
    const elapsed = Date.now() - started;
    const wait = Math.max(0, INTERVAL_MS - elapsed);
    console.log(`⏳ Sleeping ${Math.round(wait / 1000)}s...`);
    await sleep(wait);
  }
}

main().catch((e) => {
  console.error("Runner crashed:", e);
  process.exit(1);
});
