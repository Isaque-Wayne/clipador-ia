import type { FastifyInstance } from "fastify";
import type { UploadService } from "../../uploads/services/receive-video.js";
import type { TranscriptionOptions } from "../types/status.js";
import { createTranscriptionService } from "../services/transcription-service.js";
import type { TranscriptionService } from "../services/transcription-service.js";
import { createFasterWhisperEngine } from "../services/faster-whisper-engine.js";
import { transcriptionController } from "../controllers/transcription-controller.js";

export function registerTranscriptionRoutes(server: FastifyInstance, uploads: UploadService, directory: string | undefined, options: TranscriptionOptions): TranscriptionService {
  const service = createTranscriptionService(uploads, directory, { ...options,
    engine: options.engine ?? createFasterWhisperEngine(message => server.log.error({ engineDiagnostic: message }, "Diagnóstico da engine de transcrição.")) });
  server.addHook("onClose", () => service.close());
  server.post<{ Params: { id: string } }>("/uploads/:id/transcription", transcriptionController(service, "start"));
  server.get<{ Params: { id: string } }>("/uploads/:id/transcription/status", transcriptionController(service, "status"));
  server.get<{ Params: { id: string } }>("/uploads/:id/transcription", transcriptionController(service, "result"));
  server.delete<{ Params: { id: string } }>("/uploads/:id/transcription", transcriptionController(service, "cancel"));
  return service;
}
