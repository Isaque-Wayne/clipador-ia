import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { join } from "node:path";

const pending = new WeakMap<ChildProcess, Promise<void>>();
// Windows venv redirectors / packaged yt-dlp may own another process. Killing
// only the launcher can leave the engine alive with the inherited pipes open.
export function terminateProcessTree(child: ChildProcess): Promise<void> {
  const existing = pending.get(child);
  if (existing) return existing;
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform !== "win32") { child.kill("SIGKILL"); return Promise.resolve(); }
  const operation = new Promise<void>(resolve => {
    const terminator = spawn(join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
    let failed = false;
    const timer = setTimeout(() => { failed = true; terminator.kill("SIGKILL"); }, 10_000);
    terminator.once("error", () => { failed = true; });
    terminator.once("close", code => {
      clearTimeout(timer);
      if ((failed || code !== 0) && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      resolve();
    });
  });
  pending.set(child, operation);
  return operation;
}
