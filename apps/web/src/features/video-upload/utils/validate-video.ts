import { resolveUploadLimits } from "../../../../../../config/upload-limits.mjs";

// Acesso estático NEXT_PUBLIC permite ao Next incorporar o valor no bundle do navegador.
const limits = resolveUploadLimits({ UPLOAD_MAX_FILE_BYTES: process.env.NEXT_PUBLIC_UPLOAD_MAX_FILE_BYTES });
export const MAX_VIDEO_BYTES = limits.maxFileBytes;
export const UPLOAD_MAX_FILE_LABEL = limits.maxFileLabel;
export const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov";
const extensions: Readonly<Record<string, string>> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

export function getVideoType(file: File): string {
  if (file.type) return file.type;
  // Alguns sistemas não informam o MIME de MOV; a API repete a validação.
  return Object.entries(extensions).find(([, extension]) =>
    file.name.toLowerCase().endsWith(extension))?.[0] ?? "";
}

export function validateVideo(file: File): string | null {
  const extension = extensions[getVideoType(file)];
  if (!extension || !file.name.toLowerCase().endsWith(extension)) {
    return "Selecione um vídeo MP4, WebM ou MOV com tipo e extensão correspondentes.";
  }
  if (!file.size) return "O vídeo está vazio.";
  if (file.size > MAX_VIDEO_BYTES) return limits.sizeError;
  if (file.name.length > 255 || /[\x00-\x1f\x7f/\\]/.test(file.name)) return "O nome do arquivo é inválido.";
  return null;
}

export function formatVideoSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} MiB`;
}
