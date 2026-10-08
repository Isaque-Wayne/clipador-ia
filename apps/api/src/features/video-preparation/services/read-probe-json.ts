import type { OpenedVideo } from "../../uploads/services/persist-video-input.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";

export async function readProbeJson(process: OpenedVideo): Promise<unknown> {
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.content) {
      bytes += chunk.length;
      if (bytes > 512 * 1024) throw new UploadValidationError("Informações técnicas excederam o limite seguro.", 422);
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
    catch { throw new UploadValidationError("FFprobe retornou JSON inválido.", 422); }
  } finally { await process.dispose?.(); }
}
