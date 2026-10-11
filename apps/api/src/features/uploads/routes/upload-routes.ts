import type { FastifyInstance } from "fastify";
import { createUploadVideoController } from "../controllers/upload-video.js";
import { createGetUploadController } from "../controllers/get-upload.js";
import type { UploadService } from "../services/receive-video.js";
import { MAX_VIDEO_BYTES, VIDEO_EXTENSIONS, UploadValidationError, UPLOAD_SIZE_ERROR } from "../utils/validate-video.js";
import { UploadStorageQuotaError } from "../services/storage-quota.js";

export async function registerUploadRoutes(server: FastifyInstance, service: UploadService): Promise<void> {
  const recovered = await service.initialize();
  const incomplete = recovered.uploads.filter((upload) => !upload.metadata).length;
  if (incomplete) server.log.warn({ incomplete }, "Uploads sem metadados válidos preservados até a retenção.");
  let cleaning = false;
  const timer = setInterval(() => {
    if (cleaning) return;
    cleaning = true;
    void service.cleanup()
      .catch((error: unknown) => server.log.error(error, "Falha na limpeza de uploads temporários."))
      .finally(() => { cleaning = false; });
  }, service.cleanupIntervalMs);
  timer.unref();
  server.addHook("onClose", async () => { clearInterval(timer); await service.drain(); });
  server.get<{ Params: { id: string } }>("/uploads/:id", createGetUploadController(service));
  // Parser e tratamento de erros ficam restritos à feature.
  server.addContentTypeParser(Object.keys(VIDEO_EXTENSIONS), (_request, stream, done) => done(null, stream));

  server.setErrorHandler((error, request, reply) => {
    if (!request.raw.complete) reply.header("Connection", "close");
    if (error instanceof UploadValidationError) {
      return reply.code(error.statusCode).send({ success: false, message: error.message, ...(error instanceof UploadStorageQuotaError ? { code: error.code, details: error.details } : {}) });
    }
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    const statusCode = error instanceof Error && "statusCode" in error
      && typeof error.statusCode === "number" ? error.statusCode : 500;
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(413).send({ success: false, message: UPLOAD_SIZE_ERROR });
    }
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        success: false,
        message: statusCode === 415
          ? "Tipo não suportado. Envie um vídeo MP4, WebM ou MOV."
          : "Requisição de upload inválida.",
      });
    }
    request.log.error(error);
    return reply.code(500).send({ success: false, message: "Não foi possível receber o vídeo. Tente novamente." });
  });

  server.post("/uploads/video", {
    bodyLimit: MAX_VIDEO_BYTES,
    onRequest: async (request) => {
      const type = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!Object.hasOwn(VIDEO_EXTENSIONS, type)) {
        throw new UploadValidationError("Tipo não suportado. Envie um vídeo MP4, WebM ou MOV.", 415);
      }
    },
  }, createUploadVideoController(service));
}
