import type { UploadSuccess } from "../types/upload";
import { getVideoType } from "../utils/validate-video";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUploadSuccess(value: unknown): value is UploadSuccess {
  if (!isRecord(value) || value["success"] !== true || typeof value["message"] !== "string") return false;
  const file = value["file"];
  const checksum = value["checksum"];
  return typeof value["id"] === "string" && /^[0-9a-f-]{36}$/i.test(value["id"])
    && value["status"] === "uploaded" && value["nextStep"] === "processing"
    && typeof value["createdAt"] === "string" && Number.isFinite(Date.parse(value["createdAt"]))
    && isRecord(checksum) && checksum["algorithm"] === "sha256"
    && typeof checksum["value"] === "string" && /^[0-9a-f]{64}$/.test(checksum["value"])
    && isRecord(file) && typeof file["name"] === "string"
    && typeof file["type"] === "string" && typeof file["size"] === "number"
    && Number.isFinite(file["size"]) && file["size"] > 0;
}

export async function uploadVideo(file: File): Promise<UploadSuccess> {
  let response: Response;
  try {
    response = await fetch("/api/uploads/video", {
      method: "POST",
      headers: { "Content-Type": getVideoType(file), "X-File-Name": encodeURIComponent(file.name) },
      body: file,
      signal: AbortSignal.timeout(Number(process.env["NEXT_PUBLIC_UPLOAD_TIMEOUT_MS"] ?? 1_800_000) + 30_000),
    });
  } catch {
    throw new Error("Não foi possível conectar à API ou o envio demorou demais. Confira os serviços e tente novamente.");
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("A API não retornou uma resposta válida. Confira se ela está disponível.");
  }
  if (!response.ok) {
    throw new Error(isRecord(data) && typeof data["message"] === "string"
      ? data["message"] : "Não foi possível enviar o vídeo.");
  }
  if (!isUploadSuccess(data)) throw new Error("A resposta de sucesso da API é inválida.");
  return data;
}
