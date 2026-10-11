import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LibraryService } from "../services/library-service.js";
import type { UploadService } from "../../uploads/services/receive-video.js";
import { ProcessingError } from "../../processing/services/processing-error.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import { serveOriginal } from "../controllers/serve-original.js";
import { record } from "../../video-preparation/utils/parse-inspection.js";

export function registerLibraryRoutes(server: FastifyInstance, library: LibraryService, uploads: UploadService) {
  const run = (operation: (request: FastifyRequest<{ Params: { id: string } }>) => Promise<unknown>) => async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    try { return { success: true, ...await operation(request) as Record<string, unknown> }; }
    catch (error) {
      if (error instanceof ProcessingError || error instanceof UploadValidationError) return reply.code(error.statusCode).send({ success: false, code: error instanceof ProcessingError ? error.code : "PROJECT_BUSY", message: error.message, ...(error instanceof ProcessingError && error.details ? { details: error.details } : {}) });
      request.log.error(error); return reply.code(500).send({ success: false, code: "STORAGE_ERROR", message: "Não foi possível consultar o storage. Nenhum dado foi apagado automaticamente." });
    }
  };
  server.get("/projects", run(async () => ({ projects: await library.list() })));
  server.get("/storage/usage", run(async () => ({ usage: await library.usage() })));
  server.get("/projects/:id", run(async request => ({ project: await library.get(request.params.id) })));
  server.get("/projects/:id/outputs", run(async request => ({ clips: (await library.get(request.params.id)).clips ?? [] })));
  server.post("/projects/:id/retry", run(async request => ({ ...await library.retry(request.params.id) })));
  server.get("/projects/:id/original", serveOriginal(uploads));
  for (const scope of ["project", "outputs"] as const) server.delete(scope === "project" ? "/projects/:id" : "/projects/:id/outputs", { bodyLimit: 1024 }, run(async request => {
    if (!record(request.body) || request.body["confirm"] !== true) throw new ProcessingError("CONFIRM_REQUIRED", "Confirme explicitamente a exclusão.", 400);
    return { deletion: await library.remove(request.params.id, scope) };
  }));
}
