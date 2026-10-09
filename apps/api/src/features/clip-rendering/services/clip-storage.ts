import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ClipBatch, RenderedClip } from "../types.js";
import { digest, isCandidateId, parseCandidate, parseReport } from "../../analysis/services/analysis-persistence.js";
import { isUploadId } from "../../uploads/utils/upload-names.js";
import { record } from "../../video-preparation/utils/parse-inspection.js";
import { ProcessingError } from "../../processing/services/processing-error.js";
import { MAX_CLIP_BYTES } from "./render-commands.js";
import { validateEditPlan } from "../../editing/planning/validate-edit-plan.js";
import { RENDER_PROFILES } from "../../editing/types.js";

const hashPattern = /^[a-f0-9]{64}$/;
export async function fileChecksum(path: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new ProcessingError("UNSAFE_STORAGE", "Arquivo de corte inseguro.", 409);
  const file = await open(path, "r");
  try {
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest("hex");
  } finally { await file.close(); }
}
async function safeDirectory(path: string, create = false) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new ProcessingError("UNSAFE_STORAGE", "Diretório de cortes inseguro.", 409);
  return path;
}
export function parseBatch(value: unknown): ClipBatch {
  if (!record(value) || value["schemaVersion"] !== 1 || typeof value["uploadId"] !== "string" || !isUploadId(value["uploadId"])
    || typeof value["batchId"] !== "string" || !isUploadId(value["batchId"]) || typeof value["createdAt"] !== "string" || !Number.isFinite(Date.parse(value["createdAt"]))
    || typeof value["analysisVersion"] !== "string" || typeof value["renderVersion"] !== "string"
    || typeof value["sourceHash"] !== "string" || !hashPattern.test(value["sourceHash"]) || typeof value["analysisHash"] !== "string" || !hashPattern.test(value["analysisHash"])
    || !Array.isArray(value["clips"]) || value["clips"].length < 1 || value["clips"].length > 1280) throw new Error("Invalid batch");
  const report = parseReport(value["report"]);
  if (digest(report) !== value["analysisHash"] || report.analysisVersion !== value["analysisVersion"]) throw new Error("Invalid report hash");
  const clips: RenderedClip[] = value["clips"].map(item => {
    if (!record(item) || typeof item["id"] !== "string" || !isCandidateId(item["id"]) || item["file"] !== `${item["id"]}.mp4` || item["status"] !== "completed"
      || !Object.values(RENDER_PROFILES).some(profile => profile.width === item["width"] && profile.height === item["height"]) || typeof item["checksum"] !== "string" || !hashPattern.test(item["checksum"])
      || typeof item["size"] !== "number" || !Number.isSafeInteger(item["size"]) || item["size"] <= 0 || item["size"] > MAX_CLIP_BYTES
      || typeof item["duration"] !== "number" || !Number.isFinite(item["duration"]) || item["duration"] <= 0 || item["duration"] > 180.5
      || !record(item["metadata"])) throw new Error("Invalid clip");
    const candidate = parseCandidate(item["candidate"]), metadata = item["metadata"];
    const plan = item["editPlan"] === undefined ? undefined : validateEditPlan(item["editPlan"]);
    if (plan && (plan.clipId !== candidate.id || plan.sourceRange.start !== candidate.start || plan.sourceRange.end !== candidate.end || RENDER_PROFILES[plan.renderProfile].width !== item["width"] || RENDER_PROFILES[plan.renderProfile].height !== item["height"])) throw new Error("Mismatched edit plan");
    if (item["assets"] !== undefined && (!record(item["assets"]) || !Array.isArray(item["assets"]["warnings"]) || !item["assets"]["warnings"].every(warning => typeof warning === "string"))) throw new Error("Invalid asset summary");
    if (candidate.id !== item["id"] || item["start"] !== candidate.start || item["end"] !== candidate.end || Math.abs(item["duration"] - (plan?.outputDuration ?? candidate.duration)) > .3
      || !report.candidates.some(entry => digest(entry) === digest(candidate)) || metadata["videoCodec"] !== "h264" || metadata["audioCodec"] !== "aac" || metadata["subtitlesBurned"] !== true
      || !["crop", "padding"].includes(String(metadata["layout"])) || !Number.isSafeInteger(metadata["cueCount"]) || Number(metadata["cueCount"]) < 1
      || typeof metadata["renderSeconds"] !== "number" || !Number.isFinite(metadata["renderSeconds"]) || metadata["renderSeconds"] < 0) throw new Error("Invalid clip metadata");
    return item as unknown as RenderedClip;
  });
  if (new Set(clips.map(item => item.id)).size !== clips.length) throw new Error("Duplicate clips");
  const preferences = value["preferences"];
  if (preferences !== undefined && (!record(preferences) || !["auto", "few", "normal", "many", "maximum"].includes(String(preferences["quantity"])) || !["AUTO", "CLEAN", "DYNAMIC", "STORY", "EMOTIONAL", "EDUCATIONAL", "PODCAST"].includes(String(preferences["style"])))) throw new Error("Invalid preferences");
  return { schemaVersion: 1, uploadId: value["uploadId"], batchId: value["batchId"], createdAt: value["createdAt"], analysisVersion: value["analysisVersion"], renderVersion: value["renderVersion"], sourceHash: value["sourceHash"], analysisHash: value["analysisHash"], report, clips,
    ...(preferences ? { preferences: preferences as unknown as NonNullable<ClipBatch["preferences"]> } : {}) };
}
export function createClipStorage(directory: string, quotaBytes = 4 * 1024 ** 3) {
  let root = resolve(directory), workRoot = join(root, ".work");
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1) throw new Error("Invalid clip quota");
  async function work(batchId: string, create = false) {
    if (!isUploadId(batchId)) throw new ProcessingError("INVALID_ID", "ID de processamento inválido.", 400);
    return safeDirectory(join(await safeDirectory(workRoot, create), batchId), create);
  }
  async function clearWork(batchId: string) {
    const path = await work(batchId);
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^(c_[a-f0-9]{16}\.(ass|ffgraph|mp4(?:\.part)?)|asset-[a-f0-9]{16}\.(wav|mp3|m4a|ogg)|manifest\.json(?:\.part)?)$/.test(entry.name)) throw new ProcessingError("UNSAFE_STORAGE", "Temporário de corte desconhecido. Cleanup bloqueado.", 409);
      await unlink(join(path, entry.name));
    }
    await rmdir(path);
  }
  async function batches(uploadId: string) {
    if (!isUploadId(uploadId)) throw new ProcessingError("INVALID_ID", "ID de upload inválido.", 400);
    const path = join(root, uploadId);
    try { await safeDirectory(path); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
    const ids: string[] = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !isUploadId(entry.name)) throw new ProcessingError("UNSAFE_STORAGE", "Entrada inesperada nos cortes.", 409);
      ids.push(entry.name);
    }
    return ids;
  }
  async function batchPath(uploadId: string, batchId: string) {
    if (!isUploadId(uploadId) || !isUploadId(batchId)) throw new ProcessingError("INVALID_ID", "ID de corte inválido.", 400);
    return safeDirectory(join(await safeDirectory(join(root, uploadId)), batchId));
  }
  async function read(uploadId: string, batchId: string, verifyFiles = true) {
    const path = await batchPath(uploadId, batchId), manifest = join(path, "manifest.json"), stat = await lstat(manifest);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new ProcessingError("INVALID_OUTPUT", "Manifesto de cortes inválido.", 409);
    try {
      const envelope: unknown = JSON.parse(await readFile(manifest, "utf8"));
      if (!record(envelope) || digest(envelope["batch"]) !== envelope["checksum"]) throw new Error("Invalid manifest hash");
      const batch = parseBatch(envelope["batch"]);
      if (batch.uploadId !== uploadId || batch.batchId !== batchId) throw new Error("Mismatched batch IDs");
      if (verifyFiles) for (const clip of batch.clips) {
        const file = join(path, clip.file), fileStat = await lstat(file);
        if (fileStat.size !== clip.size || await fileChecksum(file) !== clip.checksum) throw new Error("Invalid clip checksum");
      }
      return batch;
    } catch { throw new ProcessingError("INVALID_OUTPUT", "Resultado persistido corrompido ou incompatível.", 409); }
  }
  return {
    async initialize() {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const stat = await lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProcessingError("UNSAFE_STORAGE", "Diretório de cortes inseguro.", 409);
      // Windows may supply the user's temporary directory using an 8.3 alias.
      root = await realpath(root); workRoot = join(root, ".work");
      await safeDirectory(workRoot, true);
      for (const entry of await readdir(workRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !isUploadId(entry.name)) throw new ProcessingError("UNSAFE_STORAGE", "Entrada insegura em temporários de cortes.", 409);
        await clearWork(entry.name);
      }
    },
    async reserve(bytes: number) {
      let used = 0;
      for (const upload of await readdir(root, { withFileTypes: true })) {
        if (upload.name === ".work") continue;
        if (!upload.isDirectory() || upload.isSymbolicLink() || !isUploadId(upload.name)) throw new ProcessingError("UNSAFE_STORAGE", "Entrada insegura no storage de cortes.", 409);
        for (const batchId of await batches(upload.name)) {
          const path = await batchPath(upload.name, batchId);
          for (const file of await readdir(path, { withFileTypes: true })) {
            const stat = await lstat(join(path, file.name));
            if (!file.isFile() || file.isSymbolicLink() || !/^(manifest\.json|c_[a-f0-9]{16}\.mp4)$/.test(file.name)) throw new ProcessingError("UNSAFE_STORAGE", "Arquivo desconhecido nos outputs.", 409);
            used += stat.size;
          }
        }
      }
      if (!Number.isSafeInteger(bytes) || bytes < 0 || used + bytes > quotaBytes) throw new ProcessingError("OUTPUT_QUOTA", "Espaço reservado para cortes esgotado. Os outputs concluídos foram preservados.", 507);
    },
    work, clearWork, read,
    async latest(uploadId: string, matches: (batch: ClipBatch) => boolean = () => true) {
      let latest: ClipBatch | null = null;
      // Bounded memory: do not load every historical manifest in parallel.
      for (const id of await batches(uploadId)) {
        const batch = await read(uploadId, id, false);
        if (matches(batch) && (!latest || batch.createdAt > latest.createdAt || batch.createdAt === latest.createdAt && batch.batchId > latest.batchId)) latest = batch;
      }
      return latest ? read(uploadId, latest.batchId) : null;
    },
    async publish(batch: ClipBatch) {
      parseBatch(batch);
      const path = await work(batch.batchId), partial = join(path, "manifest.json.part");
      if (Buffer.byteLength(JSON.stringify(batch)) > 16 * 1024 * 1024 - 128) throw new ProcessingError("OUTPUT_TOO_LARGE", "Manifesto excedeu o orçamento seguro.");
      const file = await open(partial, "wx", 0o600);
      try { await file.writeFile(JSON.stringify({ checksum: digest(batch), batch })); await file.sync(); }
      finally { await file.close(); }
      await rename(partial, join(path, "manifest.json"));
      const parent = await safeDirectory(join(root, batch.uploadId), true);
      const destination = join(parent, batch.batchId);
      try { await lstat(destination); throw new ProcessingError("OUTPUT_EXISTS", "Resultado já existe.", 409); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
      await rename(path, destination);
    },
    async file(uploadId: string, batchId: string, clipId: string) {
      if (!isCandidateId(clipId)) throw new ProcessingError("INVALID_ID", "ID de candidato inválido.", 400);
      const batch = await read(uploadId, batchId), clip = batch.clips.find(item => item.id === clipId);
      if (!clip) throw new ProcessingError("NOT_FOUND", "Corte não encontrado.", 404);
      return { clip, path: join(await batchPath(uploadId, batchId), clip.file) };
    },
  };
}
export type ClipStorage = ReturnType<typeof createClipStorage>;
