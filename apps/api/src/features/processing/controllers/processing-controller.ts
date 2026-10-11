import type { FastifyReply, FastifyRequest } from "fastify";
import type { ProcessingService } from "../services/processing-service.js";
import type { AnalysisService } from "../../analysis/services/analysis-service.js";
import { ProcessingError } from "../services/processing-error.js";
import { TranscriptionError } from "../../transcription/services/transcription-error.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import { record } from "../../video-preparation/utils/parse-inspection.js";

type Request = FastifyRequest<{ Params: { id: string; candidateId?: string } }>;
export function processingController(processing: ProcessingService, analysis: AnalysisService, action: "start" | "status" | "cancel" | "result" | "analyze" | "analysis-status" | "candidates" | "candidate" | "select") {
  return async (request: Request, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const id = request.params.id.toLowerCase();
      if (action === "start" || action === "select") {
        let ids: string[] | undefined;
        if (action === "select") {
          const body = request.body;
          if (!record(body) || !Array.isArray(body["candidateIds"]) || !body["candidateIds"].every(value => typeof value === "string")) throw new ProcessingError("INVALID_SELECTION", "Informe candidateIds como lista de IDs.", 400);
          ids = body["candidateIds"];
        }
        const result = await processing.start(id, ids);
        return reply.code(result.reused ? 200 : 202).send({ success: true, ...result });
      }
      if (action === "analyze") return { success: true, ...await analysis.start(id) };
      if (action === "analysis-status") return { success: true, status: await analysis.status(id) };
      if (action === "candidates" || action === "candidate") {
        const report = await analysis.result(id);
        if (action === "candidates") return { success: true, report };
        const candidate = report.candidates.find(item => item.id === request.params.candidateId);
        if (!candidate) throw new ProcessingError("NOT_FOUND", "Candidato não encontrado.", 404);
        return { success: true, candidate };
      }
      if (action === "result") return { success: true, batch: await processing.result(id) };
      return { success: true, status: await processing[action](id) };
    } catch (error) {
      if (error instanceof ProcessingError || error instanceof TranscriptionError || error instanceof UploadValidationError) return reply.code(error.statusCode).send({ success: false, code: "code" in error ? error.code : "UPLOAD_ERROR", message: error.message, ...(error instanceof ProcessingError && error.details ? { details: error.details } : {}) });
      request.log.error(error); return reply.code(500).send({ success: false, code: "INTERNAL_ERROR", message: "Não foi possível acessar o processamento." });
    }
  };
}
