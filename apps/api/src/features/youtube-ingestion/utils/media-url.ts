import { isIP } from "node:net";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";

export function validateMediaUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new UploadValidationError("Destino de mídia inválido.", 502); }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".googlevideo.com")
    || url.username || url.password || url.port || value.length > 16_384) {
    throw new UploadValidationError("Destino de mídia não permitido.", 502);
  }
  return url;
}

export function isPublicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}
