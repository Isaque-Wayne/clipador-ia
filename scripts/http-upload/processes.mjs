import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function startApi(workspace, options, log, samples) {
  const output = createWriteStream(log, { flags: "a" });
  const child = spawn(process.execPath, [join(workspace, "scripts/http-upload/api-process.mjs"), JSON.stringify(options)],
    { cwd: workspace, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  child.stdout.pipe(output); child.stderr.pipe(output);
  child.on("message", (message) => { if (message.kind === "memory") samples.push(message); });
  const ready = new Promise((resolve, reject) => {
    child.on("message", (message) => { if (message.kind === "ready") resolve(); });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`API encerrou antes de ficar pronta: ${code}`)));
  });
  return { child, ready };
}

export async function stopApi(child) {
  if (child.exitCode !== null) return;
  child.send("stop");
  await once(child, "exit");
}

export async function startWeb(workspace, log) {
  const output = createWriteStream(log, { flags: "a" });
  const child = spawn(process.execPath, [join(workspace, "apps/web/node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3010"],
    { cwd: join(workspace, "apps/web"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, API_BASE_URL: "http://127.0.0.1:3011" } });
  child.stdout.pipe(output); child.stderr.pipe(output);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("Web não iniciou; confira o log.");
    try { if ((await fetch("http://127.0.0.1:3010/upload")).ok) return child; } catch {}
    await delay(200);
  }
  child.kill();
  throw new Error("Web não ficou disponível.");
}

