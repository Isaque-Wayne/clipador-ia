import { resolveUploadLimits } from "../../../../../../config/upload-limits.mjs";

const limits = resolveUploadLimits(process.env);
export const MAX_VIDEO_BYTES = limits.maxFileBytes;
export const UPLOAD_SIZE_ERROR = limits.sizeError;

export const VIDEO_EXTENSIONS: Readonly<Record<string, string>> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

export class UploadValidationError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export function validateVideo(name: string, type: string, size: number): void {
  validateVideoDetails(name, type);
  validateVideoSize(size);
}

export function validateVideoDetails(name: string, type: string): void {
  validateFilename(name);
  const extension = VIDEO_EXTENSIONS[type];
  if (!extension || !name.toLowerCase().endsWith(extension)) {
    throw new UploadValidationError("Envie um vídeo MP4, WebM ou MOV com tipo e extensão correspondentes.", 415);
  }
}

export function validateVideoSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) throw new UploadValidationError("O tamanho do vídeo é inválido.");
  if (size === 0) throw new UploadValidationError("O vídeo está vazio.");
  if (size > MAX_VIDEO_BYTES) {
    throw new UploadValidationError(UPLOAD_SIZE_ERROR, 413);
  }
}

export function decodeFilename(header: string | string[] | undefined): string {
  if (typeof header !== "string") {
    throw new UploadValidationError("Informe o nome do arquivo no cabeçalho X-File-Name.");
  }
  let name: string;
  try {
    name = decodeURIComponent(header);
  } catch {
    throw new UploadValidationError("O nome do arquivo é inválido.");
  }
  validateFilename(name);
  return name;
}

function validateFilename(name: string): void {
  if (!name.trim() || name.length > 255 || /[\x00-\x1f\x7f/\\]/.test(name)) {
    throw new UploadValidationError("O nome do arquivo é inválido.");
  }
}
