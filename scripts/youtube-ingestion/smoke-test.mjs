import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { createServer } from "../../apps/api/dist/server/create-server.js";
import { createYouTubeDownloader } from "../../apps/api/dist/features/youtube-ingestion/services/youtube-downloader.js";
import { summarizeFormats, selectProgressive } from "../../apps/api/dist/features/youtube-ingestion/utils/video-formats.js";
import { parseYouTubeUrl } from "../../config/youtube-url.mjs";
import { selectInput } from "../../apps/api/dist/features/youtube-ingestion/utils/select-input.js";

const workspace = resolve(import.meta.dirname, "../..");
const urls = process.argv.slice(2);
if (!urls.length) urls.push("https://www.youtube.com/watch?v=JOhiWY7XmoY");
if (urls.length > 3) throw new Error("Use no máximo três vídeos por smoke test.");
const references = urls.map(parseYouTubeUrl);
const root = join(workspace, "apps/api/.data/youtube-smoke", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(root, { recursive: true });

function baseUrl(server) {
  return `http://127.0.0.1:${server.server.address().port}`;
}
for (const reference of references) {
  const directory = join(root, reference.videoId, "uploads");
  const evidence = join(root, reference.videoId, "result.json");
  const result = { videoUrl: reference.url, diagnostics: [], formats: [], transfers: [], states: [] };
  const real = createYouTubeDownloader(
    (text) => result.diagnostics.push(text.replace(/https?:\/\/[^\s]+/g, "[URL omitida]")),
    (info) => {
      result.metadata = { title: info.title, durationSeconds: info.duration, availability: info.availability };
      result.formats = summarizeFormats(info);
      try { const selected = selectProgressive(info); result.selectedFormat = result.formats.find((format) => format.id === selected.format_id); }
      catch { result.selectedFormat = null; }
      try {
        const selection = selectInput(info);
        result.selection = selection.mode === "progressive" ? { mode: selection.mode, container: selection.extension }
          : { mode: selection.mode, container: selection.extension, video: selection.video, audio: selection.audio };
      } catch { result.selection = null; }
    }, (summary) => {
      result.transfer = { ...summary, stderr: summary.stderr.replace(/https?:\/\/[^\s]+/g, "[URL omitida]") };
      result.transfers.push({ stage: result.states.at(-1) ?? "progressive", ...result.transfer });
    });
  const downloader = { async prepare(reference, signal, onStatus) {
    const started = performance.now();
    const input = await real.prepare(reference, signal, (status) => { result.states.push(status); onStatus?.(status); });
    result.metadataMs = performance.now() - started;
    return { ...input, open: async (signal, context) => {
      const started = performance.now();
      const opened = await input.open(signal, context);
      opened.content.once("end", () => { result.downloadMs = performance.now() - started; });
      return opened;
    } };
  } };
  const server = createServer({ directory }, { downloader });
  const started = performance.now();
  try {
    await server.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(`${baseUrl(server)}/ingestions/youtube`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: reference.url }) });
    const body = await response.json();
    Object.assign(result, { statusCode: response.status, elapsedMs: performance.now() - started, body });
    const id = body.ingestion?.id;
    if (id) {
      const queried = await fetch(`${baseUrl(server)}/ingestions/${id}`);
      const queriedBody = await queried.json();
      result.getById = { statusCode: queried.status, status: queriedBody.ingestion?.status };
      assert.equal(queried.status, 200);
      assert.equal(queriedBody.ingestion.status, body.ingestion.status);
    }
    if (response.ok) {
      const upload = body.ingestion.upload;
      const path = join(directory, upload.id, `video${upload.extension}`);
      const persisted = JSON.parse(await readFile(join(directory, upload.id, "metadata.json"), "utf8"));
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      assert.equal(hash.digest("hex"), upload.checksum.value);
      assert.deepEqual(persisted.checksum, upload.checksum);
      assert.equal((await stat(path)).size, upload.file.size);
      result.storageVerified = true;
      result.bytesStored = upload.file.size;
      const queried = await fetch(`${baseUrl(server)}/uploads/${id}`);
      assert.equal(queried.status, 200);
      result.getUploadStatusCode = queried.status;
      await server.close();
      const restored = createServer({ directory });
      try {
        await restored.listen({ host: "127.0.0.1", port: 0 });
        const queried = await fetch(`${baseUrl(restored)}/ingestions/${upload.id}`);
        assert.equal(queried.status, 200);
        assert.deepEqual((await queried.json()).ingestion.upload.checksum, upload.checksum);
        result.recovered = true;
        result.recoveryGetStatusCode = queried.status;
      } finally { await restored.close(); }
    } else {
      process.exitCode = 1;
      result.storageEntries = await readdir(directory);
      result.bytesStored = 0;
      if (id) {
        const queried = await fetch(`${baseUrl(server)}/uploads/${id}`);
        result.getUploadStatusCode = queried.status;
        assert.equal(queried.status, 404);
        if (result.storageEntries.includes(id)) assert.deepEqual(await readdir(join(directory, id)), []);
      }
    }
  } catch (error) {
    result.testError = error.message;
    process.exitCode = 1;
  } finally {
    await server.close();
    await writeFile(evidence, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, formats: { count: result.formats.length,
      compatible: result.formats.filter((format) => format.compatible) } }, null, 2));
    console.log(`EVIDENCE ${evidence}`);
  }
}
