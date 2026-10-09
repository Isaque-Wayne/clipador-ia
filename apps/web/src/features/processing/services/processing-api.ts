import type { ClipCard, ProcessingStatus, DurationProfile } from "../types";
const PROCESSING_STAGES = ["not-started", "preparing-audio", "transcribing", "transcribed", "analyzing", "selecting-clips", "planning-edits", "resolving-assets", "rendering-subtitles", "rendering-clips", "completed", "failed"] as const satisfies readonly ProcessingStatus["stage"][];
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const uuid = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export class ProcessingApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export async function processingRequest(id: string, path: string, method: "GET" | "POST" | "DELETE", signal: AbortSignal) {
  if (!uuid(id)) throw new ProcessingApiError("INVALID_ID", "Identificação do vídeo inválida.");
  let response: Response;
  const deadline = AbortSignal.timeout(Number(process.env["NEXT_PUBLIC_API_REQUEST_TIMEOUT_MS"] ?? 15000));
  try { response = await fetch(`/api/uploads/${id}/${path}`, { method, signal: AbortSignal.any([signal, deadline]), cache: "no-store" }); }
  catch (error) {
    if (signal.aborted) throw error;
    if (deadline.aborted) throw new ProcessingApiError("REQUEST_TIMEOUT", "A consulta à API excedeu o tempo de espera. O processamento pode continuar; tente consultar novamente.");
    throw new ProcessingApiError("API_UNAVAILABLE", "Não foi possível conectar à API. Verifique se o serviço está ativo.");
  }
  let value: unknown;
  try { value = await response.json(); } catch { value = null; }
  if (!response.ok) {
    if (record(value) && typeof value["code"] === "string" && typeof value["message"] === "string") throw new ProcessingApiError(value["code"], value["message"]);
    throw new ProcessingApiError(response.status === 502 || response.status === 503 ? "API_UNAVAILABLE" : "HTTP_ERROR", `Não foi possível consultar o processamento (HTTP ${response.status}).`);
  }
  if (!record(value) || value["success"] !== true) throw new ProcessingApiError("INVALID_RESPONSE", "A API retornou um resultado inesperado.");
  return value;
}
export function parseProcessingStatus(value: unknown, uploadId: string): ProcessingStatus {
  if (!record(value) || value["uploadId"] !== uploadId || !PROCESSING_STAGES.some(stage => stage === value["stage"])) throw new ProcessingApiError("INVALID_RESPONSE", "Status de processamento inválido.");
  const status: ProcessingStatus = { uploadId, stage: value["stage"] as ProcessingStatus["stage"] };
  for (const key of ["renderedCount", "selectedCount"] as const) if (value[key] !== undefined) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0 || Number(value[key]) > 1280) throw new ProcessingApiError("INVALID_RESPONSE", "Contagem de cortes inválida.");
    status[key] = Number(value[key]);
  }
  if (value["error"] !== undefined) {
    const error = value["error"];
    if (!record(error) || typeof error["code"] !== "string" || typeof error["message"] !== "string") throw new ProcessingApiError("INVALID_RESPONSE", "Erro de processamento inválido.");
    status.error = { code: error["code"], message: error["message"] };
  }
  if (value["progress"] !== undefined) {
    const progress = value["progress"];
    if (!record(progress) || typeof progress["segmentsProcessed"] !== "number" || !Number.isSafeInteger(progress["segmentsProcessed"]) || progress["segmentsProcessed"] < 0 || progress["segmentsProcessed"] > 100000
      || typeof progress["processedThroughSeconds"] !== "number" || !Number.isFinite(progress["processedThroughSeconds"]) || progress["processedThroughSeconds"] < 0 || progress["processedThroughSeconds"] > 86400) throw new ProcessingApiError("INVALID_RESPONSE", "Progresso da transcrição inválido.");
    status.progress = { segmentsProcessed: progress["segmentsProcessed"], processedThroughSeconds: progress["processedThroughSeconds"] };
  }
  return status;
}
export function parseClipCards(value: unknown, uploadId: string): ClipCard[] {
  if (!record(value) || value["uploadId"] !== uploadId || typeof value["batchId"] !== "string" || !uuid(value["batchId"]) || !Array.isArray(value["clips"]) || value["clips"].length < 1 || value["clips"].length > 1280) throw new ProcessingApiError("INVALID_RESPONSE", "Resultado de cortes inválido.");
  const batchId = value["batchId"];
  return value["clips"].map(clip => {
    if (!record(clip) || typeof clip["id"] !== "string" || !/^c_[a-f0-9]{16}$/.test(clip["id"]) || clip["status"] !== "completed" || typeof clip["duration"] !== "number" || !Number.isFinite(clip["duration"]) || clip["duration"] <= 0 || !record(clip["candidate"])) throw new ProcessingApiError("INVALID_RESPONSE", "Corte inválido.");
    const candidate = clip["candidate"], score = candidate["score"];
    if (typeof candidate["title"] !== "string" || typeof candidate["reason"] !== "string" || !record(score) || typeof score["value"] !== "number" || !Number.isFinite(score["value"]) || score["value"] < 0 || score["value"] > 100) throw new ProcessingApiError("INVALID_RESPONSE", "Dados do corte inválidos.");
    const card: ClipCard = { id: clip["id"], title: candidate["title"], duration: clip["duration"], score: score["value"], reason: candidate["reason"], url: `/api/uploads/${uploadId}/clips/${batchId}/${clip["id"]}/file` };
    if (candidate["profile"] !== undefined) {
      if (!["micro", "short", "standard", "extended"].includes(String(candidate["profile"])) || typeof candidate["familyId"] !== "string" || !/^f_[a-f0-9]{16}$/.test(candidate["familyId"]) || !record(candidate["hookScore"]) || typeof candidate["hookScore"]["value"] !== "number" || !Number.isFinite(candidate["hookScore"]["value"]) || candidate["hookScore"]["value"] < 0 || candidate["hookScore"]["value"] > 100
        || !record(candidate["emotion"]) || !record(candidate["emotion"]["semantic"]) || !Array.isArray(candidate["emotion"]["semantic"]["labels"])) throw new ProcessingApiError("INVALID_RESPONSE", "Perfil do corte inválido.");
      card.profile = candidate["profile"] as DurationProfile; card.familyId = candidate["familyId"]; card.hookScore = candidate["hookScore"]["value"];
      const labels = candidate["emotion"]["semantic"]["labels"];
      if (!labels.every(label => record(label) && typeof label["name"] === "string" && typeof label["strength"] === "number" && Number.isFinite(label["strength"]) && label["strength"] >= 0 && label["strength"] <= 1)) throw new ProcessingApiError("INVALID_RESPONSE", "Sinais emocionais inválidos.");
      card.emotions = labels.map(label => String(label["name"])); card.emotionalStrength = Math.max(0, ...labels.map(label => Number(label["strength"])));
      if (Array.isArray(score["dimensions"])) {
        const education = score["dimensions"].find(item => record(item) && item["name"] === "informationValue");
        if (record(education) && typeof education["value"] === "number" && Number.isFinite(education["value"])) card.educationalScore = education["value"];
      }
    }
    if (record(clip["editPlan"]) && typeof clip["editPlan"]["style"] === "string") card.editStyle = clip["editPlan"]["style"];
    return card;
  });
}
