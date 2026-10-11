import type { Project, ProjectDetail, StorageUsage } from "../types";
import { parsePackagePreview } from "../../social-packages/parse-package";
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const bytes = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export async function libraryRequest(path: string, method = "GET", signal?: AbortSignal) {
  let response: Response;
  try { response = await fetch(`/api/${path}`, { method, cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    ...(method === "DELETE" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) } : {}) }); }
  catch (error) { if (signal?.aborted) throw error; throw new Error("Não foi possível consultar a API. Verifique se está ativa e tente novamente."); }
  const value: unknown = await response.json().catch(() => null);
  if (!record(value) || !response.ok || value["success"] !== true) {
    const freed = record(value) && record(value["details"]) && bytes(value["details"]["freedBytes"]) ? ` Espaço já liberado: ${formatBytes(value["details"]["freedBytes"])}.` : "";
    throw new Error((record(value) && typeof value["message"] === "string" ? value["message"] : `Falha ao consultar a Biblioteca (HTTP ${response.status}).`) + freed);
  }
  return value;
}
function parseProject(value: unknown): Project {
  if (!record(value) || !uuid(value["id"]) || typeof value["title"] !== "string" || !["Upload", "YouTube"].includes(String(value["origin"])) || !["uploaded", "processing", "completed", "failed"].includes(String(value["status"]))
    || typeof value["active"] !== "boolean" || !["originalBytes", "outputBytes", "totalBytes", "clipCount"].every(key => bytes(value[key]))
    || typeof value["hasTranscript"] !== "boolean" || typeof value["hasAnalysis"] !== "boolean" || !Array.isArray(value["warnings"]) || !value["warnings"].every(item => typeof item === "string")
    || !(value["createdAt"] === null || typeof value["createdAt"] === "string" && Number.isFinite(Date.parse(value["createdAt"])))
    || !(value["duration"] === null || typeof value["duration"] === "number" && Number.isFinite(value["duration"]) && value["duration"] >= 0)
    || !(value["thumbnail"] === null || typeof value["thumbnail"] === "string" && value["thumbnail"].startsWith("https://"))) throw new Error("Projeto inválido na resposta da API.");
  if (value["outputDeletionBytes"] !== undefined && !bytes(value["outputDeletionBytes"])) throw new Error("Estimativa de exclusão inválida.");
  const error = value["error"];
  if (error !== undefined) {
    if (!record(error) || typeof error["code"] !== "string" || typeof error["message"] !== "string") throw new Error("Erro de projeto inválido.");
    for (const key of ["usedBytes", "limitBytes", "requiredBytes", "projectCount"]) if (error[key] !== undefined && !bytes(error[key])) throw new Error("Detalhes de quota inválidos.");
  }
  return value as unknown as Project;
}
export function parseProjects(value: unknown) { if (!Array.isArray(value)) throw new Error("Lista inválida."); return value.map(parseProject); }
export function parseUsage(value: unknown): StorageUsage {
  if (!record(value) || !["originalBytes", "artifactBytes", "temporaryBytes", "outputBytes", "totalBytes", "uploadUsedBytes", "outputUsedBytes", "uploadLimitBytes", "outputLimitBytes", "freeDiskBytes", "unclassifiedBytes", "projectCount"].every(key => bytes(value[key])) || !Array.isArray(value["warnings"]) || !value["warnings"].every(item => typeof item === "string")) throw new Error("Uso de armazenamento inválido.");
  return value as unknown as StorageUsage;
}
export function parseDetail(value: unknown): ProjectDetail {
  const project = parseProject(value);
  if (!record(value) || !(value["originalUrl"] === null || value["originalUrl"] === `/api/projects/${project.id}/original`) || !(value["metadata"] === null || record(value["metadata"])) || !Array.isArray(value["clips"]) || !Array.isArray(value["candidates"])) throw new Error("Detalhes inválidos.");
  for (const clip of value["clips"]) {
    if (!record(clip) || typeof clip["id"] !== "string" || !/^c_[a-f0-9]{16}$/.test(clip["id"]) || !uuid(clip["batchId"]) || clip["url"] !== `/api/uploads/${project.id}/clips/${clip["batchId"]}/${clip["id"]}/file` || !bytes(clip["size"]) || typeof clip["title"] !== "string" || typeof clip["duration"] !== "number" || !Number.isFinite(clip["duration"]) || typeof clip["score"] !== "number" || !Number.isFinite(clip["score"]) || typeof clip["profile"] !== "string" || typeof clip["style"] !== "string" || typeof clip["checksum"] !== "string") throw new Error("Corte inválido.");
    if (clip["socialPackage"] !== undefined) clip["socialPackage"] = parsePackagePreview(clip["socialPackage"], `/api/uploads/${project.id}/clips/${clip["batchId"]}/${clip["id"]}`);
  }
  const transcript = value["transcript"];
  if (transcript !== null && (!record(transcript) || typeof transcript["text"] !== "string" || typeof transcript["language"] !== "string" || !Array.isArray(transcript["segments"]))) throw new Error("Transcrição inválida.");
  for (const candidate of value["candidates"]) if (!record(candidate) || typeof candidate["id"] !== "string" || typeof candidate["title"] !== "string" || typeof candidate["duration"] !== "number" || !record(candidate["score"]) || typeof candidate["score"]["value"] !== "number" || typeof candidate["reason"] !== "string") throw new Error("Candidato inválido.");
  return value as unknown as ProjectDetail;
}
export function formatBytes(bytes: number) { const units = ["B", "KiB", "MiB", "GiB", "TiB"]; let value = bytes, unit = 0; while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; } return `${value.toLocaleString("pt-BR", { maximumFractionDigits: unit ? 2 : 0 })} ${units[unit]}`; }
export function formatDuration(seconds: number | null) { if (seconds === null) return "Duração indisponível"; const time = Math.floor(seconds); return `${Math.floor(time / 3600) ? `${Math.floor(time / 3600)}h ` : ""}${Math.floor(time % 3600 / 60)}min ${time % 60}s`; }
export const statusLabels = { uploaded: "Vídeo salvo", processing: "Em processamento", completed: "Concluído", failed: "Falhou / requer atenção" };
