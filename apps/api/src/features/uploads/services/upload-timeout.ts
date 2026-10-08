import { UploadValidationError } from "../utils/validate-video.js";

export function createUploadTimeout(parent: AbortSignal, milliseconds: number) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new UploadValidationError("Tempo máximo de upload excedido. Tente novamente.", 408)), milliseconds);
  return { signal: AbortSignal.any([parent, timeout.signal]), dispose: () => clearTimeout(timer) };
}
