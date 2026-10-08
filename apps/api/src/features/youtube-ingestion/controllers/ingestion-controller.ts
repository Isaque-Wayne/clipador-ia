import type { FastifyReply, FastifyRequest } from "fastify";
import type { createYouTubeIngestion } from "../services/ingest-youtube.js";
import { isUploadId } from "../../uploads/utils/upload-names.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";

type IngestionService = ReturnType<typeof createYouTubeIngestion>;
export function createIngestController(service: IngestionService) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const body: unknown = request.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)
      || Object.keys(body).some((key) => key !== "url")) throw new UploadValidationError("Envie somente o campo URL do YouTube.");
    const abort = new AbortController();
    const disconnected = () => { if (!reply.raw.writableFinished) abort.abort(); };
    reply.raw.once("close", disconnected);
    if (reply.raw.destroyed) abort.abort();
    try {
      const result = await service.ingest((body as Record<string, unknown>)["url"], abort.signal);
      if (!abort.signal.aborted) return await reply.code(result.statusCode).send(result.body);
    } finally { reply.raw.removeListener("close", disconnected); }
  };
}

export function createIngestionQueryController(service: IngestionService) {
  return async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!isUploadId(request.params.id)) throw new UploadValidationError("ID da ingestão inválido.");
    const ingestion = service.find(request.params.id);
    if (!ingestion) throw new UploadValidationError("Ingestão não encontrada ou expirada.", 404);
    return reply.header("Cache-Control", "no-store").send({ success: true, ingestion });
  };
}
