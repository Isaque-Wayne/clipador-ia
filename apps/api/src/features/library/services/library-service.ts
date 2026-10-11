import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { UploadService } from "../../uploads/services/receive-video.js";
import type { ClipStorage } from "../../clip-rendering/services/clip-storage.js";
import type { UploadMetadata } from "../../uploads/types/upload.js";
import type { ProcessingService } from "../../processing/services/processing-service.js";
import { parseUploadMetadata } from "../../uploads/utils/parse-upload-metadata.js";
import { isUploadId } from "../../uploads/utils/upload-names.js";
import { readTranscript } from "../../transcription/services/transcript-persistence.js";
import { digest, parseReport } from "../../analysis/services/analysis-persistence.js";
import type { AnalysisReport } from "../../analysis/contracts.js";
import { record } from "../../video-preparation/utils/parse-inspection.js";
import { ProcessingError } from "../../processing/services/processing-error.js";
import { absent, projectFiles, projectIds, removeProjectFiles, safeDirectory } from "./library-files.js";

async function json(path: string, maximum = 16 * 1024 * 1024): Promise<unknown> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error("Invalid persisted file");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
const warningText = (error: unknown) => error instanceof Error ? error.message : "Arquivo persistido inválido.";
const assertId = (id: string) => { if (!isUploadId(id)) throw new ProcessingError("INVALID_ID", "ID de projeto inválido.", 400); };

export function createLibraryService(uploads: UploadService, storage: ClipStorage, processing: ProcessingService[] = []) {
  async function get(id: string, detail = true) {
    assertId(id);
    const warnings: string[] = [];
    const root = await uploads.storageRoot(), directory = join(root, id);
    let metadata: UploadMetadata | undefined;
    let uploadBytes = 0, originalBytes = 0, temporaryBytes = 0, artifactBytes = 0, exists = false;
    let processingStateBytes = 0;
    try {
      await safeDirectory(directory);
      const names = await readdir(directory);
      exists = names.includes("metadata.json");
      for (const name of names) {
        const stat = await lstat(join(directory, name));
        if (!stat.isFile() || stat.isSymbolicLink()) { warnings.push("Entrada insegura no upload; gerenciamento bloqueado."); continue; }
        uploadBytes += stat.size;
        if (/^processing-(legacy|portfolio)\.json(?:\.part)?$/.test(name)) processingStateBytes += stat.size;
        if (/^video\.(mp4|mov|webm)$/.test(name)) originalBytes += stat.size;
        else if (name.endsWith(".part")) temporaryBytes += stat.size;
        else artifactBytes += stat.size;
      }
      if (exists) metadata = parseUploadMetadata(await json(join(directory, "metadata.json"), 4096), id);
      if (exists && !metadata) warnings.push("Metadata do projeto inválida.");
      if (metadata && originalBytes !== metadata.file.size) warnings.push("Vídeo original ausente ou com tamanho divergente.");
    } catch (error) { if (!absent(error)) { exists = true; warnings.push(warningText(error)); } }
    const clips = [];
    let outputBytes = 0;
    let partial = false;
    try {
      const plan = await projectFiles(storage.root(), id, true);
      outputBytes = plan.bytes; exists ||= outputBytes > 0;
      for (const batchId of await storage.batches(id)) {
        try {
          const batch = await storage.read(id, batchId, false);
          partial ||= Boolean(batch.requestedIds && batch.requestedIds.length > batch.clips.length);
          for (const clip of batch.clips) {
            const stat = await lstat(join(storage.root(), id, batchId, clip.file));
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== clip.size) { warnings.push(`Corte ${clip.id} ausente ou inválido.`); continue; }
            clips.push({ id: clip.id, batchId, title: clip.candidate.title, duration: clip.duration, score: clip.finalQuality?.finalScore ?? clip.candidate.score.value,
              profile: clip.candidate.profile ?? "standard", family: clip.candidate.familyId ?? null, style: clip.editPlan?.style ?? "CLEAN", status: "completed" as const,
              size: clip.size, checksum: clip.checksum, createdAt: batch.createdAt, url: `/api/uploads/${id}/clips/${batchId}/${clip.id}/file`,
              ...(clip.socialPackage ? { socialPackage: { template: clip.socialPackage.template, thumbnailStyle: clip.socialPackage.thumbnailStyle, headline: clip.socialPackage.headline,
                platforms: clip.socialPackage.platforms, frameTimestamp: clip.socialPackage.frameTimestamp, selectionReason: clip.socialPackage.selectionReason,
                thumbnailUrl: `/api/uploads/${id}/clips/${batchId}/${clip.id}/thumbnail`, metadataUrl: `/api/uploads/${id}/clips/${batchId}/${clip.id}/metadata`, sourceFrameUrl: `/api/uploads/${id}/clips/${batchId}/${clip.id}/source-frame` } } : {}) });
          }
        } catch (error) { warnings.push(`Lote ${batchId}: ${warningText(error)}`); }
      }
    } catch (error) { if (!absent(error)) { exists = true; warnings.push(warningText(error)); } }
    if (!exists) throw new ProcessingError("NOT_FOUND", "Projeto não encontrado. Temporários sem metadata não são projetos válidos.", 404);
    if (!metadata && outputBytes > 0) warnings.push("Original/metadata do upload ausentes. Os cortes salvos continuam acessíveis, mas re-renderizar exige o original.");
    let transcript = null;
    let report: AnalysisReport | null = null;
    if (metadata) {
      try { transcript = (await readTranscript(directory, metadata.checksum))?.transcript ?? null; } catch (error) { warnings.push(warningText(error)); }
      for (const name of ["portfolio.json", "analysis.json"]) {
        try {
          const value = await json(join(directory, name));
          if (!record(value) || value["schemaVersion"] !== 1 || value["sourceHash"] !== metadata.checksum?.value || !transcript || value["transcriptHash"] !== digest(transcript) || digest(value["report"]) !== value["checksum"]) throw new Error("Análise corrompida/incompatível.");
          report = parseReport(value["report"]); break;
        } catch (error) { if (!absent(error)) warnings.push(warningText(error)); }
      }
    }
    let failure: { code: string; message: string } | undefined;
    for (const service of processing) {
      try { const status = service.currentStatus(id) ?? await service.savedStatus(id); if (status?.stage === "failed" && status.error) failure = status.error; }
      catch (error) { warnings.push(warningText(error)); }
    }
    const active = uploads.isActive(id);
    if (partial && !failure && !active) failure = { code: "INTERRUPTED", message: "Há cortes salvos e cortes pendentes. Tente novamente para continuar." };
    const status = active ? "processing" : warnings.length || failure || partial || metadata?.status === "failed" ? "failed" : clips.length ? "completed" : "uploaded";
    return { id, title: metadata?.source?.title || metadata?.file.name || `Projeto incompleto ${id.slice(0, 8)}`,
      origin: metadata?.source ? "YouTube" : "Upload", thumbnail: metadata?.source?.thumbnailUrl ?? null,
      duration: metadata?.inspection?.durationSeconds ?? metadata?.source?.durationSeconds ?? null,
      createdAt: metadata?.createdAt ?? clips[0]?.createdAt ?? null, status, active,
      originalBytes, outputBytes, outputDeletionBytes: outputBytes + processingStateBytes, uploadBytes, temporaryBytes, artifactBytes, totalBytes: uploadBytes + outputBytes, clipCount: clips.length,
      hasTranscript: Boolean(transcript), hasAnalysis: Boolean(report), warnings, ...(failure ? { error: failure } : {}),
      ...(detail ? { metadata: metadata ?? null, originalUrl: metadata && originalBytes === metadata.file.size ? `/api/projects/${id}/original` : null,
        transcript, candidates: report?.candidates ?? [], clips } : {}) };
  }
  async function list() {
    const ids = new Set([...await projectIds(await uploads.storageRoot()), ...await projectIds(storage.root())]);
    const projects = [];
    for (const id of ids) {
      try { projects.push(await get(id, false)); } catch (error) { if (!(error instanceof ProcessingError && error.code === "NOT_FOUND")) throw error; }
    }
    return projects.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }
  async function usage() {
    let originalBytes = 0, artifactBytes = 0, temporaryBytes = 0, unclassifiedBytes = 0;
    const root = await uploads.storageRoot();
    const warnings: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) { warnings.push("Link ignorado no storage de uploads."); continue; }
      if (entry.isFile()) { unclassifiedBytes += (await lstat(join(root, entry.name))).size; continue; }
      if (!entry.isDirectory() || !isUploadId(entry.name)) { warnings.push("Diretório desconhecido preservado."); continue; }
      await safeDirectory(join(root, entry.name));
      for (const file of await readdir(join(root, entry.name), { withFileTypes: true })) {
        const stat = await lstat(join(root, entry.name, file.name));
        if (!stat.isFile() || stat.isSymbolicLink()) { warnings.push("Entrada insegura preservada."); continue; }
        if (/^video\.(mp4|mov|webm)$/.test(file.name)) originalBytes += stat.size;
        else if (file.name.endsWith(".part")) temporaryBytes += stat.size;
        else artifactBytes += stat.size;
      }
    }
    const outputs = await storage.usage();
    return { originalBytes, artifactBytes, temporaryBytes: temporaryBytes + outputs.temporaryBytes, outputBytes: outputs.bytes - outputs.temporaryBytes,
      unclassifiedBytes, uploadUsedBytes: originalBytes + artifactBytes + temporaryBytes + unclassifiedBytes, outputUsedBytes: outputs.bytes,
      totalBytes: originalBytes + artifactBytes + temporaryBytes + unclassifiedBytes + outputs.bytes,
      uploadLimitBytes: uploads.quotaBytes, outputLimitBytes: storage.quotaBytes, freeDiskBytes: outputs.freeDiskBytes,
      projectCount: (await list()).length, warnings };
  }
  async function remove(id: string, scope: "project" | "outputs") {
    assertId(id);
    return uploads.manageProject(id, async () => {
      await get(id, false);
      // Validate BOTH trees before deleting anything, even for an incomplete project.
      const outputs = await projectFiles(storage.root(), id, true);
      const source = await projectFiles(await uploads.storageRoot(), id, false);
      const stateFiles = { files: source.files.filter(file => /^processing-(legacy|portfolio)\.json(?:\.part)?$/.test(file.name)), directories: [], bytes: 0 };
      let result;
      try { result = await removeProjectFiles([outputs, scope === "project" ? source : stateFiles]); }
      finally { for (const service of processing) service.forget(id); }
      return { id, scope, ...result };
    });
  }
  async function retry(id: string) {
    assertId(id); await get(id, false);
    const latest = await storage.latest(id);
    const service = latest && !latest.report.portfolio ? processing[0] : processing[1];
    if (!service) throw new ProcessingError("NOT_SUPPORTED", "Retry indisponível neste contexto.", 409);
    return service.retry(id);
  }
  return { get, list, usage, remove, retry };
}
export type LibraryService = ReturnType<typeof createLibraryService>;
