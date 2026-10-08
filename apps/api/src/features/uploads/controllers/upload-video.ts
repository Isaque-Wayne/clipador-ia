import type { FastifyReply, FastifyRequest } from "fastify";
import type { UploadService } from "../services/receive-video.js";
import { decodeFilename, UploadValidationError } from "../utils/validate-video.js";
import { Readable } from "node:stream";

export function createUploadVideoController(service: UploadService) {
  return async function uploadVideo(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!(request.body instanceof Readable)) {
      throw new UploadValidationError("Envie o vídeo como corpo binário da requisição.");
    }
    const name = decodeFilename(request.headers["x-file-name"]);
    const type = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? "";
    const sizeHeader = request.headers["content-length"];
    const expectedSize = sizeHeader === undefined ? undefined : Number(sizeHeader);
    if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) {
      throw new UploadValidationError("Content-Length inválido.");
    }
    const abort = new AbortController();
    const disconnected = () => { if (!reply.raw.writableFinished) abort.abort(); };
    request.raw.once("aborted", disconnected);
    reply.raw.once("close", disconnected);
    if (request.raw.aborted || reply.raw.destroyed) abort.abort();
    try {
      const result = await service.receiveVideo(request.body, name, type, abort.signal, expectedSize);
      if (!abort.signal.aborted) await reply.code(200).send(result);
    } finally {
      request.raw.removeListener("aborted", disconnected);
      reply.raw.removeListener("close", disconnected);
    }
  };
}
