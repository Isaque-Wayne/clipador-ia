import { UploadValidationError } from "../../uploads/utils/validate-video.js";

// yt-dlp não fornece um contrato JSON para erros de extração. Nunca devolva stderr bruto.
export function downloaderError(stderr: string, phase: "metadata" | "download" = "metadata", exitCode?: number): UploadValidationError {
  stderr = stderr.split(/\r?\n/).filter((line) => line.startsWith("ERROR:")).at(-1) ?? stderr;
  if (/requested format.*not available|no video formats|no suitable formats/i.test(stderr))
    return new UploadValidationError("Não há formato de vídeo compatível disponível sem FFmpeg.", 422);
  if (/private video|video is private/i.test(stderr))
    return new UploadValidationError("O vídeo do YouTube é privado.", 422);
  const http = /HTTP Error (\d{3})/i.exec(stderr);
  if (phase === "download" && http) return mediaHttpError(Number(http[1]));
  if (/confirm you.re not a bot|HTTP Error (403|429)|too many requests/i.test(stderr))
    return new UploadValidationError("O YouTube bloqueou a consulta do downloader (acesso ou limite do provedor).", 502);
  if (/age.restricted|confirm your age|sign in|members.only|not available in your country|geo.restricted/i.test(stderr))
    return new UploadValidationError("O vídeo do YouTube tem restrição de acesso.", 422);
  if (/timed out|timeout/i.test(stderr))
    return new UploadValidationError(phase === "download" ? "O download do YouTube excedeu o tempo limite."
      : "A consulta ao YouTube excedeu o tempo limite.", 504);
  if (/video unavailable|video is unavailable|video has been removed|video does not exist|this video is not available/i.test(stderr))
    return new UploadValidationError("O vídeo do YouTube está indisponível ou foi removido.", 422);
  if (http) return new UploadValidationError(`O provedor recusou a consulta do downloader (HTTP ${http[1]}).`, 502);
  return new UploadValidationError(phase === "download" ? `O downloader de mídia falhou${exitCode === undefined ? "" : ` (código ${exitCode})`}.`
    : "O downloader falhou ao consultar o YouTube.", 502);
}

export function mediaConnectionError(error: unknown): UploadValidationError {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return new UploadValidationError(code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT"
    ? "A transferência da mídia do YouTube excedeu o tempo limite."
    : "Falha de conexão durante a transferência da mídia do YouTube.", code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" ? 504 : 502);
}

export function mediaHttpError(status: number): UploadValidationError {
  return new UploadValidationError([401, 403, 429].includes(status)
    ? `O provedor bloqueou a transferência da mídia (HTTP ${status}).`
    : `A transferência da mídia foi recusada pelo provedor (HTTP ${status}).`, 502);
}
