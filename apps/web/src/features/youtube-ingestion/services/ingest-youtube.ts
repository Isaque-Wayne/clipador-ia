import { parseYouTubeUrl } from "../../../../../../config/youtube-url.mjs";
import { object, parseIngestionResult } from "../utils/parse-ingestion-result";
import type { IngestionProgress } from "../types/ingestion";

export class IngestionError extends Error {
  constructor(message: string, public readonly id?: string, public readonly code = "INGESTION_FAILED", public readonly sourceUrl?: string) { super(message); }
}
const uuid = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const stages: IngestionProgress["status"][] = ["queued", "pending", "fetching-metadata", "downloading", "downloading-video", "downloading-audio", "merging"];
async function request(path: string, method: "GET" | "POST" | "DELETE", signal: AbortSignal, payload?: { url: string }) {
  let response: Response;
  const deadline = AbortSignal.timeout(Number(process.env["NEXT_PUBLIC_API_REQUEST_TIMEOUT_MS"] ?? 15000));
  try {
    response = await fetch(`/api/ingestions/${path}`, { method, signal: AbortSignal.any([signal, deadline]), cache: "no-store",
      ...(payload ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {}) });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new IngestionError(deadline.aborted ? "A consulta excedeu o tempo de espera. Isso não confirma falha na ingestão."
      : "Não foi possível conectar à API. A conexão será consultada novamente.", undefined, deadline.aborted ? "REQUEST_TIMEOUT" : "API_UNAVAILABLE");
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  if (!object(body) || !response.ok || body["success"] !== true) {
    const record = object(body) ? body["ingestion"] : undefined;
    throw new IngestionError(object(body) && typeof body["message"] === "string" ? body["message"] : "Não foi possível importar o vídeo.",
      object(record) && typeof record["id"] === "string" ? record["id"] : undefined,
      object(body) && typeof body["code"] === "string" ? body["code"] : !object(body) && response.status >= 502 ? "API_UNAVAILABLE" : "INGESTION_FAILED");
  }
  return body["ingestion"];
}
export async function waitForIngestion(id: string, signal: AbortSignal, onUpdate?: (progress: IngestionProgress) => void) {
  if (!uuid(id)) throw new IngestionError("ID da ingestão inválido.");
  let last: IngestionProgress = { id, status: "queued" };
  while (true) {
    signal.throwIfAborted();
    try {
      const value = await request(id, "GET", signal);
      if (!object(value) || value["id"] !== id) throw new IngestionError("Status de ingestão inválido.", id);
      if (value["status"] === "downloaded") return parseIngestionResult(value);
      if (value["status"] === "failed") throw new IngestionError(typeof value["message"] === "string" ? value["message"] : "A ingestão falhou.", id,
        typeof value["code"] === "string" ? value["code"] : "INGESTION_FAILED",
        object(value["video"]) && typeof value["video"]["url"] === "string" ? value["video"]["url"] : undefined);
      if (!stages.some(stage => stage === value["status"])) throw new IngestionError("Etapa de ingestão inválida.", id);
      last = { id, status: value["status"] as IngestionProgress["status"] };
      const progress = value["progress"];
      if (object(progress)) for (const key of ["bytesReceived", "estimatedBytes"] as const) {
        const bytes = progress[key];
        if (typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes >= 0) last[key] = bytes;
      }
      onUpdate?.(last);
    } catch (error) {
      if (!(error instanceof IngestionError) || !["REQUEST_TIMEOUT", "API_UNAVAILABLE"].includes(error.code)) throw error;
      onUpdate?.({ ...last, warning: error.message });
    }
    await new Promise<void>(resolve => {
      const timer = setTimeout(done, 1500);
      function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
      signal.addEventListener("abort", done, { once: true });
      if (signal.aborted) done();
    });
  }
}
export async function ingestYouTube(value: string, signal: AbortSignal, onUpdate?: (progress: IngestionProgress) => void) {
  const reference = parseYouTubeUrl(value);
  const started = await request("youtube", "POST", signal, { url: reference.url });
  if (!object(started) || typeof started["id"] !== "string" || !uuid(started["id"])) throw new IngestionError("A API retornou um job inválido.");
  if (started["status"] === "downloaded") return parseIngestionResult(started);
  onUpdate?.({ id: started["id"], status: "queued" });
  return waitForIngestion(started["id"], signal, onUpdate);
}
export async function cancelIngestion(id: string, signal: AbortSignal) {
  if (!uuid(id)) throw new IngestionError("ID da ingestão inválido.");
  return request(id, "DELETE", signal);
}
export async function retryYouTubeIngestion(id: string, signal: AbortSignal, onUpdate?: (progress: IngestionProgress) => void, sourceUrl?: string) {
  if (!uuid(id)) throw new IngestionError("ID da ingestão inválido.");
  // A URL canônica da tentativa permanece no formulário mesmo se a API reiniciar e esquecer a falha.
  if (sourceUrl) return ingestYouTube(sourceUrl, signal, onUpdate);
  const previous = await request(id, "GET", signal);
  if (!object(previous) || previous["status"] !== "failed" || !object(previous["video"]) || typeof previous["video"]["url"] !== "string")
    throw new IngestionError("Não foi possível recuperar uma tentativa falhada. Envie novamente o link do YouTube.", id);
  return ingestYouTube(previous["video"]["url"], signal, onUpdate);
}
