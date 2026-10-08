import { UploadValidationError } from "../utils/validate-video.js";

export function createUploadConcurrency(limit: number) {
  let active = 0;
  return {
    acquire(): () => void {
      if (active >= limit) throw new UploadValidationError("Limite de uploads simultâneos atingido. Tente novamente em instantes.", 429);
      active++;
      let released = false;
      return () => { if (!released) { released = true; active--; } };
    },
  };
}
