import { open } from "node:fs/promises";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ClipStorage } from "../services/clip-storage.js";
import { ProcessingError } from "../../processing/services/processing-error.js";
import type { UploadService } from "../../uploads/services/receive-video.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
type Request = FastifyRequest<{ Params: { id: string; batchId: string; candidateId: string }; Querystring: { download?: string } }>;
export function serveClip(storage: ClipStorage, uploads?: UploadService) {
  return async (request: Request, reply: FastifyReply) => {
    let release: (() => void) | undefined;
    let streaming = false;
    try {
      release = uploads?.holdProject(request.params.id.toLowerCase());
      const { clip, path } = await storage.file(request.params.id.toLowerCase(), request.params.batchId.toLowerCase(), request.params.candidateId);
      let start = 0, end = clip.size - 1;
      const range = request.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return reply.code(416).header("Content-Range", `bytes */${clip.size}`).send();
        if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return reply.code(416).header("Content-Range", `bytes */${clip.size}`).send(); start = Math.max(0, clip.size - suffix); }
        else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= clip.size) return reply.code(416).header("Content-Range", `bytes */${clip.size}`).send();
        reply.code(206).header("Content-Range", `bytes ${start}-${end}/${clip.size}`);
      }
      const file = await open(path, "r");
      if ((await file.stat()).size !== clip.size) { await file.close(); throw new ProcessingError("INVALID_OUTPUT", "Arquivo alterado antes da leitura.", 409); }
      reply.header("Content-Type", "video/mp4").header("Accept-Ranges", "bytes").header("Content-Length", end - start + 1).header("Cache-Control", "no-store");
      reply.header("Content-Disposition", `${request.query.download === "1" ? "attachment" : "inline"}; filename="${clip.id}.mp4"`);
      const stream = file.createReadStream({ start, end, autoClose: true });
      stream.once("close", () => release?.());
      streaming = true;
      return reply.send(stream);
    } catch (error) {
      release?.();
      if (error instanceof ProcessingError) return reply.code(error.statusCode).send({ success: false, code: error.code, message: error.message });
      if (error instanceof UploadValidationError) return reply.code(error.statusCode).send({ success: false, code: "PROJECT_BUSY", message: error.message });
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return reply.code(404).send({ success: false, code: "NOT_FOUND", message: "Arquivo de corte não encontrado." });
      request.log.error(error); return reply.code(500).send({ success: false, code: "INTERNAL_ERROR", message: "Não foi possível ler o corte." });
    } finally { if (!streaming) release?.(); }
  };
}
