import type { FastifyReply, FastifyRequest } from "fastify";
import type { UploadService } from "../services/receive-video.js";
import { isUploadId } from "../utils/upload-names.js";
import { UploadValidationError } from "../utils/validate-video.js";

export function createGetUploadController(service: UploadService) {
  return async function getUpload(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
    const { id } = request.params;
    if (!isUploadId(id)) throw new UploadValidationError("ID de upload inválido.");
    const upload = service.findUpload(id.toLowerCase());
    if (!upload) throw new UploadValidationError("Upload não encontrado nesta instância da API.", 404);
    await reply.header("Cache-Control", "no-store").send({ success: true, upload });
  };
}
