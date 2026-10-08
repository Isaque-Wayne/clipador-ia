import { parseYouTubeUrl } from "../../../../../../config/youtube-url.mjs";
import { object, parseIngestionResult } from "../utils/parse-ingestion-result";

export class IngestionError extends Error {
  constructor(message: string, public readonly id?: string) { super(message); }
}
export async function ingestYouTube(value: string, signal: AbortSignal) {
  const reference = parseYouTubeUrl(value);
  let response: Response;
  try {
    response = await fetch("/api/ingestions/youtube", { method: "POST", signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: reference.url }) });
  } catch { throw new IngestionError("A ingestão foi interrompida ou a API está indisponível."); }
  const body: unknown = await response.json();
  if (!object(body) || !response.ok || body["success"] !== true) {
    const record = object(body) ? body["ingestion"] : undefined;
    throw new IngestionError(object(body) && typeof body["message"] === "string" ? body["message"] : "Não foi possível importar o vídeo.",
      object(record) && typeof record["id"] === "string" ? record["id"] : undefined);
  }
  return parseIngestionResult(body["ingestion"]);
}
