import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const root = resolve("apps/api/.data/long-video-validation", new Date().toISOString().replace(/[:.]/g, "-")); await mkdir(root, { recursive: true });
const base = "http://127.0.0.1:3000/api/ingestions", evidence = { root, processesBefore: [], processesAfter: [] };
async function processes() {
  const command = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'yt-dlp.exe' -and $_.CommandLine -like '*clipador ia*' } | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress";
  const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let text = "", diagnostic = ""; child.stdout.on("data", chunk => { text += chunk; }); child.stderr.on("data", chunk => { diagnostic += chunk; });
  await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", code => code === 0 ? resolve() : reject(new Error(diagnostic))); });
  if (!text.trim()) return []; const value = JSON.parse(text); return Array.isArray(value) ? value : [value];
}
try {
  const started = performance.now();
  const response = await fetch(`${base}/youtube`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://www.youtube.com/watch?v=ac0RGoBVzhs" }) });
  assert.equal(response.status, 202); const posted = await response.json(); evidence.id = posted.ingestion.id; evidence.postMilliseconds = performance.now() - started;
  for (let i = 0; i < 10; i++) { evidence.processesBefore = await processes(); if (evidence.processesBefore.length) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(evidence.processesBefore.length, "Observe a real yt-dlp process before cancellation");
  const cancelStarted = performance.now(); const cancelled = await fetch(`${base}/${evidence.id}`, { method: "DELETE" }); const result = await cancelled.json();
  assert.equal(cancelled.status, 200); assert.equal(result.ingestion.code, "CANCELLED"); evidence.status = result.ingestion;
  evidence.cancelMilliseconds = performance.now() - cancelStarted; evidence.processesAfter = await processes();
  assert.ok(!evidence.processesAfter.some(after => evidence.processesBefore.some(before => before.ProcessId === after.ProcessId)));
  assert.equal((await fetch(`http://127.0.0.1:3001/uploads/${evidence.id}`)).status, 404);
  try { evidence.files = await readdir(resolve("apps/api/.data/uploads", evidence.id)); } catch (error) { if (error.code !== "ENOENT") throw error; evidence.files = []; }
  assert.deepEqual(evidence.files, []); evidence.cleanup = true;
} catch (error) { evidence.error = error.stack ?? error.message; process.exitCode = 1; }
finally { await writeFile(join(root, "cancel-result.json"), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence)); }
