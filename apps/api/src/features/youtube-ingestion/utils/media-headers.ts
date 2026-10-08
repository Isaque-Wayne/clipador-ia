import { UploadValidationError } from "../../uploads/utils/validate-video.js";

// Apenas headers de negociação; nunca Host, Cookie, Authorization ou headers de roteamento.
export function mediaHeaders(value: unknown): Record<string, string> {
  const headers: Record<string, string> = { "user-agent": "Mozilla/5.0", "accept-encoding": "identity" };
  if (value === undefined || value === null) return headers;
  if (typeof value !== "object" || Array.isArray(value)) throw new UploadValidationError("Headers de mídia inválidos.", 502);
  for (const [key, item] of Object.entries(value)) {
    const name = key.toLowerCase();
    if (!["user-agent", "accept", "accept-language"].includes(name)) continue;
    if (typeof item !== "string" || item.length > 2048 || /[^\x20-\x7e]/.test(item))
      throw new UploadValidationError("Headers de mídia inválidos.", 502);
    headers[name] = item;
  }
  return headers;
}
