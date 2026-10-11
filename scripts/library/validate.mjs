import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { selectPortfolio } from "../../apps/api/dist/features/portfolio/services/portfolio-provider.js";
import { clipByteBudget } from "../../apps/api/dist/features/editing/rendering/ffmpeg-plan.js";
const api = "http://127.0.0.1:3001", web = "http://127.0.0.1:3000";
const root = resolve("apps/api/.data/library-validation", `real-${new Date().toISOString().replaceAll(":", "-")}`); await mkdir(root, { recursive: true });
async function request(path, base = api) { const response = await fetch(`${base}${path}`); assert.equal(response.status, 200, `${base}${path}`); return response.json(); }
async function checksum(path) { const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }
const before = await request("/storage/usage"), list = await request("/projects");
const inventory = [];
for (const project of list.projects) {
  const detail = (await request(`/projects/${project.id}`)).project;
  const clips = (await request(`/projects/${project.id}/outputs`)).clips; assert.equal(clips.length, detail.clipCount);
  let originalChecksum = null;
  if (detail.metadata && detail.originalUrl) {
    originalChecksum = await checksum(resolve("apps/api/.data/uploads", project.id, `video${detail.metadata.extension}`)); assert.equal(originalChecksum, detail.metadata.checksum.value);
  }
  for (const clip of clips) {
    const path = resolve("apps/api/.data/clips", project.id, clip.batchId, `${clip.id}.mp4`);
    assert.equal(await checksum(path), clip.checksum);
    const response = await fetch(`${api}${clip.url.replace("/api", "")}`, { headers: { Range: "bytes=0-31" } }); assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 32);
  }
  let estimates = null;
  if (detail.hasAnalysis && detail.metadata) {
    try {
      const stored = JSON.parse(await readFile(resolve("apps/api/.data/uploads", project.id, "portfolio.json"), "utf8"));
      estimates = Object.fromEntries(["auto", "few", "normal", "many", "maximum"].map(mode => {
        const candidates = selectPortfolio(stored.report, mode);
        return [mode, { count: candidates.length, oldBatchEstimate: candidates.reduce((sum, candidate) => sum + clipByteBudget(candidate.duration), 0) + 16 * 1024 ** 2 }];
      }));
    } catch { /* Legacy projects do not necessarily have a portfolio. */ }
  }
  inventory.push({ ...project, originalChecksum, verifiedClips: clips.length, estimates });
}
const after = await request("/storage/usage");
const { freeDiskBytes: _beforeFree, ...beforeMetrics } = before.usage, { freeDiskBytes: _afterFree, ...afterMetrics } = after.usage;
assert.deepEqual(afterMetrics, beforeMetrics);
const pages = {};
for (const path of ["/library", ...list.projects.map(project => `/library/${project.id}`)]) {
  const response = await fetch(web + path); pages[path] = response.status; assert.equal(response.status, 200);
}
assert.equal((await request("/api/projects", web)).projects.length, list.projects.length);
const result = { recordedAt: new Date().toISOString(), storage: before.usage, inventory, webPages: pages, apiHealth: await request("/health"), noRealDeletion: true, noInteractivePlayback: true, outputWorkEntries: await readdir(resolve("apps/api/.data/clips/.work")) };
await writeFile(join(root, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ root, projects: inventory.length, clips: inventory.reduce((sum, project) => sum + project.verifiedClips, 0), usage: before.usage, estimates: inventory.filter(project => project.estimates).map(project => ({ id: project.id, estimates: project.estimates })), webPages: pages }, null, 2));
