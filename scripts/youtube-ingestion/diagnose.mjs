import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseYouTubeUrl } from "../../config/youtube-url.mjs";
import { createYtdlpRunner } from "../../apps/api/dist/features/youtube-ingestion/services/run-ytdlp.js";
import { summarizeFormats } from "../../apps/api/dist/features/youtube-ingestion/utils/video-formats.js";

const references = process.argv.slice(2).map(parseYouTubeUrl);
if (references.length < 1 || references.length > 3) throw new Error("Informe de uma a três URLs YouTube.");
const directory = resolve(import.meta.dirname, "../../apps/api/.data/youtube-diagnostics", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(directory, { recursive: true });
const results = [];
for (const reference of references) {
  const started = performance.now();
  const diagnostics = [];
  const runner = createYtdlpRunner((text) => diagnostics.push(text.replace(/https?:\/\/[^\s]+/g, "[URL omitida]")));
  try {
    const info = await runner(reference, AbortSignal.timeout(45_000));
    results.push({ url: reference.url, title: info.title, durationSeconds: info.duration,
      availability: info.availability, formats: summarizeFormats(info), diagnostics, elapsedMs: performance.now() - started });
  } catch (error) {
    results.push({ url: reference.url, error: error.message, statusCode: error.statusCode, diagnostics, elapsedMs: performance.now() - started });
  }
}
await writeFile(join(directory, "result.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
console.log(`EVIDENCE ${directory}`);
