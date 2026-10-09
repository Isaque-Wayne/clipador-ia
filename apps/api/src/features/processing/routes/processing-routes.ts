import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { UploadService } from "../../uploads/services/receive-video.js";
import type { TranscriptionService } from "../../transcription/services/transcription-service.js";
import type { ProcessingOptions } from "../../clip-rendering/types.js";
import type { ResourceGate } from "../services/resource-gate.js";
import { createAnalysisService } from "../../analysis/services/analysis-service.js";
import { createClipStorage } from "../../clip-rendering/services/clip-storage.js";
import { createProcessingService } from "../services/processing-service.js";
import { processingController } from "../controllers/processing-controller.js";
import { serveClip } from "../../clip-rendering/controllers/serve-clip.js";
import { PortfolioAnalysisProvider, selectPortfolio } from "../../portfolio/services/portfolio-provider.js";
import { readAudioSignals } from "../../portfolio/services/audio-signals.js";
import { startPortfolio } from "../../portfolio/controllers/start-portfolio.js";
import { PLANNED_RENDER_VERSION } from "../../editing/rendering/ffmpeg-plan.js";
import { createResourceGate } from "../services/resource-gate.js";

export function registerProcessingRoutes(server: FastifyInstance, uploads: UploadService, transcription: TranscriptionService, gate: ResourceGate, uploadDirectory: string | undefined, options: ProcessingOptions) {
  const analysis = createAnalysisService(uploads, transcription, uploadDirectory, options.analysisProvider);
  const storage = createClipStorage(options.directory ?? (uploadDirectory ? resolve(`${uploadDirectory}-clips`) : resolve(process.cwd(), ".data", "clips")), options.quotaBytes);
  const admission = createResourceGate();
  const diagnostic = (message: string) => server.log.error({ renderDiagnostic: message }, "Diagnóstico do processamento.");
  const service = createProcessingService(uploads, transcription, analysis, storage, gate, options.renderTimeoutMs, diagnostic, { admission });
  const portfolioAnalysis = createAnalysisService(uploads, transcription, uploadDirectory, new PortfolioAnalysisProvider(), {
    name: "portfolio.json", gate, enrich: async (context, transcript) => ({ audio: await readAudioSignals(context, transcript.duration, diagnostic) }),
  });
  const portfolioService = createProcessingService(uploads, transcription, portfolioAnalysis, storage, gate, options.renderTimeoutMs, diagnostic, {
    portfolio: true, admission, renderVersion: PLANNED_RENDER_VERSION, select: selectPortfolio, ...(options.musicDirectory ? { musicDirectory: options.musicDirectory } : {}),
  });
  server.addHook("onReady", () => storage.initialize());
  server.addHook("onClose", () => service.close());
  server.addHook("onClose", () => portfolioService.close());
  server.post("/uploads/:id/portfolio", processingController(portfolioService, portfolioAnalysis, "analyze"));
  server.get("/uploads/:id/portfolio", processingController(portfolioService, portfolioAnalysis, "candidates"));
  server.get("/uploads/:id/portfolio/status", processingController(portfolioService, portfolioAnalysis, "analysis-status"));
  server.get("/uploads/:id/portfolio/candidates/:candidateId", processingController(portfolioService, portfolioAnalysis, "candidate"));
  server.post("/uploads/:id/portfolio/process", startPortfolio(portfolioService));
  server.get("/uploads/:id/portfolio/process/status", processingController(portfolioService, portfolioAnalysis, "status"));
  server.delete("/uploads/:id/portfolio/process", processingController(portfolioService, portfolioAnalysis, "cancel"));
  server.get("/uploads/:id/portfolio/clips", processingController(portfolioService, portfolioAnalysis, "result"));
  server.post("/uploads/:id/process", processingController(service, analysis, "start"));
  server.get("/uploads/:id/process/status", processingController(service, analysis, "status"));
  server.delete("/uploads/:id/process", processingController(service, analysis, "cancel"));
  server.post("/uploads/:id/analysis", processingController(service, analysis, "analyze"));
  server.get("/uploads/:id/analysis/status", processingController(service, analysis, "analysis-status"));
  server.get("/uploads/:id/analysis", processingController(service, analysis, "candidates"));
  server.get("/uploads/:id/analysis/candidates/:candidateId", processingController(service, analysis, "candidate"));
  server.post("/uploads/:id/analysis/select", processingController(service, analysis, "select"));
  server.get("/uploads/:id/clips", processingController(service, analysis, "result"));
  server.get("/uploads/:id/clips/:batchId/:candidateId/file", serveClip(storage));
}
