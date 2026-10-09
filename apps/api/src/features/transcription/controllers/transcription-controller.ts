import type { FastifyReply, FastifyRequest } from "fastify";
import type { TranscriptionService } from "../services/transcription-service.js";
import { TranscriptionError } from "../services/transcription-error.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import { ProcessingError } from "../../processing/services/processing-error.js";

type Request = FastifyRequest<{ Params: { id: string } }>;
export function transcriptionController(service: TranscriptionService, action: "start" | "status" | "result" | "cancel") {
  return async (request: Request, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const id = request.params.id.toLowerCase();
      if (action === "start") {
        const result = await service.start(id);
        return reply.code(result.reused ? 200 : 202).send({ success: true, ...result });
      }
      if (action === "result") return { success: true, transcript: await service.result(id) };
      return { success: true, status: await service[action](id) };
    } catch (error) {
      if (error instanceof TranscriptionError || error instanceof UploadValidationError || error instanceof ProcessingError)
        return reply.code(error.statusCode).send({ success: false, code: error instanceof TranscriptionError || error instanceof ProcessingError ? error.code : "UPLOAD_ERROR", message: error.message });
      request.log.error(error);
      return reply.code(500).send({ success: false, code: "INTERNAL_ERROR", message: "Não foi possível acessar a transcrição." });
    }
  };
}
