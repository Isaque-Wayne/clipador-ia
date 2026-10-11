import type { AnalysisProvider } from "../contracts.js";
import type { TranscriptionService } from "../../transcription/services/transcription-service.js";
import type { UploadService } from "../../uploads/services/receive-video.js";
import { DEFAULT_UPLOAD_DIRECTORY } from "../../uploads/services/temporary-video-storage.js";
import { prepareStorageRoot, uploadPath } from "../../uploads/services/storage-paths.js";
import { LocalAnalysisProvider } from "./local-provider.js";
import { digest, readAnalysis, persistAnalysis, removeAnalysisPartial } from "./analysis-persistence.js";
import { ProcessingError } from "../../processing/services/processing-error.js";
import type { AnalysisInput } from "../contracts.js";
import type { PreparationContext } from "../../video-preparation/types/preparation.js";
import type { Transcript } from "../../transcription/types/transcript.js";
import type { ResourceGate } from "../../processing/services/resource-gate.js";
import type { AnalysisFile } from "./analysis-persistence.js";
import { withStageDeadline } from "../../pipeline/services/stage-deadline.js";

export function createAnalysisService(uploads: UploadService, transcription: TranscriptionService, directory = DEFAULT_UPLOAD_DIRECTORY, provider: AnalysisProvider = new LocalAnalysisProvider(), options: { name?: AnalysisFile; gate?: ResourceGate; enrich?: (context: PreparationContext, transcript: Transcript) => Promise<Partial<AnalysisInput>> } = {}) {
  const active = new Set<string>();
  async function input(id: string) {
    const upload = uploads.findUpload(id);
    if (!upload?.checksum) throw new ProcessingError("NOT_FOUND", "Upload não encontrado ou expirado.", 404);
    return { upload, transcript: await transcription.result(id), path: await uploadPath(await prepareStorageRoot(directory), id) };
  }
  return {
    version: provider.analysisVersion,
    async result(id: string) {
      const data = await input(id);
      const report = await readAnalysis(data.path, data.upload.checksum!.value, digest(data.transcript), provider.analysisVersion, options.name);
      if (!report) throw new ProcessingError("ANALYSIS_NOT_COMPLETED", "Análise não concluída ou versão desatualizada. Inicie a análise.", 409);
      return report;
    },
    async start(id: string, signal = new AbortController().signal) {
      if (active.has(id)) throw new ProcessingError("IN_PROGRESS", "Análise em andamento.", 409);
      const releaseProject = uploads.holdProject(id);
      active.add(id);
      try {
        const data = await input(id), sourceHash = data.upload.checksum!.value, transcriptHash = digest(data.transcript);
        return await withStageDeadline("analysis", signal, signal => uploads.prepareUpload(id, async context => {
          await removeAnalysisPartial(context.directory, options.name);
          const stored = await readAnalysis(context.directory, sourceHash, transcriptHash, provider.analysisVersion, options.name);
          if (stored) return { reused: true, report: stored };
          const release = options.gate?.acquire();
          let report;
          try { const extra = options.enrich ? await options.enrich(context, data.transcript) : {}; report = await provider.analyze({ ...extra, uploadId: id, transcript: data.transcript }, context.signal); }
          finally { release?.(); }
          if (report.analysisVersion !== provider.analysisVersion) throw new ProcessingError("INVALID_ANALYSIS", "Provider com versão incompatível.");
          await persistAnalysis(context.directory, sourceHash, transcriptHash, report, context.reserve, context.signal, options.name);
          return { reused: false, report };
        }, signal, { timeoutMs: null }));
      } finally { active.delete(id); releaseProject(); }
    },
    async status(id: string) {
      if (active.has(id)) return { uploadId: id, stage: "analyzing" };
      try { await this.result(id); return { uploadId: id, stage: "completed", analysisVersion: provider.analysisVersion }; }
      catch (error) { if (error instanceof ProcessingError && error.code === "ANALYSIS_NOT_COMPLETED") return { uploadId: id, stage: "not-started" }; throw error; }
    },
  };
}
export type AnalysisService = ReturnType<typeof createAnalysisService>;
