import type { FastifyInstance } from "fastify";
import type { UploadService } from "../../uploads/services/receive-video.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import type { YouTubeIngestionOptions } from "../types/ingestion.js";
import { createYouTubeDownloader } from "../services/youtube-downloader.js";
import { createYouTubeIngestion } from "../services/ingest-youtube.js";
import { createIngestController, createIngestionQueryController } from "../controllers/ingestion-controller.js";

export async function registerYouTubeRoutes(server: FastifyInstance, uploads: UploadService, options: YouTubeIngestionOptions) {
  await server.register(async (scoped) => {
    const service = createYouTubeIngestion(uploads, options.downloader ?? createYouTubeDownloader(
      (message) => scoped.log.warn({ downloader: message.replace(/https?:\/\/[^\s]+/g, "[URL omitida]") }, "Diagnóstico do downloader YouTube.")));
    scoped.setErrorHandler((error, _request, reply) => {
      if (error instanceof UploadValidationError) return reply.code(error.statusCode).send({ success: false, message: error.message });
      const status = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode : 500;
      if (status >= 500) scoped.log.error(error);
      return reply.code(status).send({ success: false, message: status === 413
        ? "O pedido de ingestão deve ter no máximo 4 KiB." : "Pedido de ingestão inválido ou indisponível." });
    });
    scoped.post("/ingestions/youtube", { bodyLimit: 4096 }, createIngestController(service));
    scoped.get<{ Params: { id: string } }>("/ingestions/:id", createIngestionQueryController(service));
  });
}
