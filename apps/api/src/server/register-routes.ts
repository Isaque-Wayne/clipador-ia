import type { FastifyInstance } from "fastify";
import { registerUploadRoutes } from "../features/uploads/routes/upload-routes.js";
import type { UploadOptions } from "../features/uploads/types/upload.js";
import { createUploadService } from "../features/uploads/services/receive-video.js";
import { registerYouTubeRoutes } from "../features/youtube-ingestion/routes/ingestion-routes.js";
import type { YouTubeIngestionOptions } from "../features/youtube-ingestion/types/ingestion.js";
import { registerPreparationRoutes } from "../features/video-preparation/routes/preparation-routes.js";

export function registerRoutes(server: FastifyInstance, uploadOptions: UploadOptions = {}, youtubeOptions: YouTubeIngestionOptions = {}): void {
  void server.register(async (scoped) => {
    const uploads = createUploadService(uploadOptions);
    await registerUploadRoutes(scoped, uploads);
    await registerYouTubeRoutes(scoped, uploads, youtubeOptions);
    registerPreparationRoutes(scoped, uploads);
  });
  server.get("/health", async () => {
    return {
      status: "ok",
      project: "Clipador IA",
      message: "API funcionando corretamente.",
    };
  });

  server.get("/about", async () => {
    return {
      name: "Clipador IA",
      version: "0.1.0",
      description: "Plataforma inteligente para análise e criação de cortes de vídeos.",
    };
  });
}
