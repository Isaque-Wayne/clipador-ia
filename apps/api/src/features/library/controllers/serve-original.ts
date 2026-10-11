import type { FastifyReply, FastifyRequest } from "fastify";
import type { UploadService } from "../../uploads/services/receive-video.js";
import { openVerifiedUpload } from "../../uploads/services/verify-upload-integrity.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import { isUploadId } from "../../uploads/utils/upload-names.js";

export function serveOriginal(uploads: UploadService) {
  return async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    let release: (() => void) | undefined;
    try {
      const id = request.params.id;
      if (!isUploadId(id)) return reply.code(400).send({ success: false, code: "INVALID_ID", message: "ID inválido." });
      release = uploads.holdProject(id);
      const metadata = uploads.findUpload(id);
      if (!metadata) throw new UploadValidationError("Original não encontrado.", 404);
      let start = 0, end = metadata.file.size - 1;
      const range = request.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) { release(); return reply.code(416).header("Content-Range", `bytes */${metadata.file.size}`).send(); }
        if (!match[1]) { const suffix = Number(match[2]); start = Math.max(0, metadata.file.size - suffix); if (!suffix) start = metadata.file.size; }
        else { start = Number(match[1]); end = match[2] ? Math.min(end, Number(match[2])) : end; }
        if (![start, end].every(Number.isSafeInteger) || start < 0 || start > end || start >= metadata.file.size) { release(); return reply.code(416).header("Content-Range", `bytes */${metadata.file.size}`).send(); }
        reply.code(206).header("Content-Range", `bytes ${start}-${end}/${metadata.file.size}`);
      }
      const file = await openVerifiedUpload(await uploads.storageRoot(), metadata);
      const stream = file.createReadStream({ start, end, autoClose: true });
      stream.once("close", release);
      reply.header("Content-Type", metadata.file.type).header("Accept-Ranges", "bytes").header("Content-Length", end - start + 1).header("Cache-Control", "no-store");
      return reply.send(stream);
    } catch (error) {
      release?.();
      if (error instanceof UploadValidationError) return reply.code(error.statusCode).send({ success: false, code: "INVALID_ORIGINAL", message: error.message });
      request.log.error(error); return reply.code(500).send({ success: false, code: "READ_FAILED", message: "Não foi possível ler o original." });
    }
  };
}
