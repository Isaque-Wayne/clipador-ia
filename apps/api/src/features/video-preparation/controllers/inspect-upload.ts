import type { FastifyReply, FastifyRequest } from "fastify";
import type { createVideoPreparation } from "../services/prepare-video.js";
import { isUploadId } from "../../uploads/utils/upload-names.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";

export function createInspectionController(service: ReturnType<typeof createVideoPreparation>) {
  return async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!isUploadId(request.params.id)) throw new UploadValidationError("ID de upload inválido.");
    const id = request.params.id.toLowerCase();
    const abort = new AbortController();
    const disconnected = () => { if (!reply.raw.writableFinished) abort.abort(new Error("Cliente desconectado.")); };
    reply.raw.once("close", disconnected);
    try {
      const inspection = await service.inspect(id, abort.signal);
      return reply.header("Cache-Control", "no-store").send({ success: true, id, inspection });
    } catch (error: unknown) {
      if (error instanceof UploadValidationError || abort.signal.aborted) throw error;
      request.log.error(error, "Falha na inspeção técnica do upload.");
      return reply.code(500).send({ success: false, message: "Não foi possível inspecionar o vídeo armazenado." });
    } finally { reply.raw.removeListener("close", disconnected); }
  };
}
