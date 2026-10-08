import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request } from "node:https";
import type { IncomingMessage } from "node:http";
import type { OpenedVideo } from "../../uploads/services/persist-video-input.js";
import { validateVideoSize, UploadValidationError } from "../../uploads/utils/validate-video.js";
import { isPublicIPv4, validateMediaUrl } from "../utils/media-url.js";
import { mediaHttpError, mediaConnectionError } from "../utils/downloader-error.js";
import { mediaHeaders } from "../utils/media-headers.js";

interface MediaNetwork { lookup: (hostname: string) => Promise<LookupAddress[]>; request: typeof request }
async function resolvePublicAddress(hostname: string, signal: AbortSignal, network: MediaNetwork): Promise<string> {
  signal.throwIfAborted();
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    void network.lookup(hostname).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
  signal.throwIfAborted();
  const first = addresses[0];
  if (!first || addresses.some((item) => !isPublicIPv4(item.address))) {
    throw new UploadValidationError("Destino de rede não permitido.", 502);
  }
  return first.address;
}

export function createMediaDownloader(network: MediaNetwork = { lookup: (hostname) => lookup(hostname, { family: 4, all: true }), request }) {
  async function download(value: string, signal: AbortSignal, expectedType?: string,
    suppliedHeaders?: Record<string, string>, redirects = 0): Promise<OpenedVideo> {
    const url = validateMediaUrl(value);
    let address: string;
    try { address = await resolvePublicAddress(url.hostname, signal, network); }
    catch (error) {
      if (signal.aborted) throw signal.reason;
      throw error instanceof UploadValidationError ? error : mediaConnectionError(error);
    }
    return new Promise((resolve, reject) => {
      const req = network.request(url, { method: "GET", signal, family: 4, agent: false,
        // Conexão fixada ao IPv4 validado; TLS continua conferindo o hostname original.
        lookup: (_hostname, _options, callback) => callback(null, address, 4),
        headers: mediaHeaders(suppliedHeaders) }, (response: IncomingMessage) => {
        response.on("error", () => {}); // O leitor de storage recebe o erro; evita erro solto antes de conectar.
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          req.destroy();
          if (!response.headers.location || redirects >= 3) return reject(new UploadValidationError("Redirect de mídia recusado.", 502));
          let next: URL;
          try { next = validateMediaUrl(new URL(response.headers.location, url).href); } catch (error) { reject(error); return; }
          void download(next.href, signal, expectedType, suppliedHeaders, redirects + 1).then(resolve, reject);
          return;
        }
        if (status !== 200) { req.destroy(); reject(mediaHttpError(status)); return; }
        try {
          const contentType = response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
          if (expectedType && contentType && contentType !== expectedType && contentType !== "application/octet-stream") {
            throw new UploadValidationError("O servidor de mídia retornou um tipo de arquivo inesperado.", 502);
          }
          const rawSize = response.headers["content-length"];
          const expectedSize = rawSize === undefined ? undefined : Number(rawSize);
          if (expectedSize !== undefined) validateVideoSize(expectedSize);
          resolve({ content: response, ...(expectedSize === undefined ? {} : { expectedSize }), dispose: () => { req.destroy(); } });
        } catch (error) { req.destroy(); reject(error); }
      });
      req.once("error", (error) => reject(signal.aborted ? signal.reason : mediaConnectionError(error)));
      req.end();
    });
  }
  return download;
}
export const downloadMedia = createMediaDownloader();
