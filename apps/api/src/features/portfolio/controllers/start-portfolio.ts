import type { FastifyReply, FastifyRequest } from "fastify";
import type { ProcessingService } from "../../processing/services/processing-service.js";
import type { ClipBatch } from "../../clip-rendering/types.js";
import { ProcessingError } from "../../processing/services/processing-error.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import { record } from "../../video-preparation/utils/parse-inspection.js";

export function startPortfolio(service: ProcessingService) {
  return async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const body = request.body ?? {};
      if (!record(body)) throw new ProcessingError("INVALID_OPTIONS", "Opções de portfólio inválidas.", 400);
      const quantity = body["quantity"] ?? "auto", style = body["style"] ?? "AUTO", ids = body["candidateIds"];
      if (!["auto", "few", "normal", "many", "maximum"].includes(String(quantity)) || !["AUTO", "CLEAN", "DYNAMIC", "STORY", "EMOTIONAL", "EDUCATIONAL", "PODCAST"].includes(String(style))
        || ids !== undefined && (!Array.isArray(ids) || !ids.every(id => typeof id === "string"))) throw new ProcessingError("INVALID_OPTIONS", "Quantidade, estilo ou seleção inválidos.", 400);
      const preferences = { quantity, style } as NonNullable<ClipBatch["preferences"]>;
      const result = await service.start(request.params.id.toLowerCase(), ids as string[] | undefined, preferences);
      return reply.code(result.reused ? 200 : 202).send({ success: true, ...result });
    } catch (error) {
      if (error instanceof ProcessingError || error instanceof UploadValidationError) return reply.code(error.statusCode).send({ success: false, code: "code" in error ? error.code : "UPLOAD_ERROR", message: error.message });
      request.log.error(error); return reply.code(500).send({ success: false, code: "INTERNAL_ERROR", message: "Não foi possível iniciar o portfólio." });
    }
  };
}
