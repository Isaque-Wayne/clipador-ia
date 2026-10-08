import type { FastifyInstance } from "fastify";
import type { UploadService } from "../../uploads/services/receive-video.js";
import { createVideoPreparation } from "../services/prepare-video.js";
import { createInspectionController } from "../controllers/inspect-upload.js";

export function registerPreparationRoutes(server: FastifyInstance, uploads: UploadService): void {
  server.post<{ Params: { id: string } }>("/uploads/:id/inspect", createInspectionController(createVideoPreparation(uploads)));
}
