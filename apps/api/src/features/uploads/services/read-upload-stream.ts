import type { Readable } from "node:stream";
import { UploadValidationError } from "../utils/validate-video.js";

export async function* readUploadStream(source: Readable, signal: AbortSignal): AsyncGenerator<Buffer> {
  while (true) {
    signal.throwIfAborted();
    if (source.errored) throw source.errored;
    const chunk: unknown = source.read();
    if (chunk !== null) {
      if (!Buffer.isBuffer(chunk)) throw new UploadValidationError("O upload deve ser um stream binário.");
      yield chunk;
    } else if (source.readableEnded) {
      return;
    } else {
      await waitReadable(source, signal);
    }
  }
}

function waitReadable(source: Readable, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const clean = () => {
      source.removeListener("readable", ready); source.removeListener("end", ready);
      source.removeListener("error", failed); source.removeListener("close", closed);
      signal.removeEventListener("abort", aborted);
    };
    const ready = () => { clean(); resolve(); };
    const failed = (error: Error) => { clean(); reject(error); };
    const closed = () => { clean(); reject(source.errored ?? new UploadValidationError("O envio do vídeo foi interrompido.")); };
    const aborted = () => { clean(); reject(signal.reason); };
    source.once("readable", ready); source.once("end", ready);
    source.once("error", failed); source.once("close", closed);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else if (source.readableLength || source.readableEnded) ready();
    else if (source.destroyed) closed();
  });
}
