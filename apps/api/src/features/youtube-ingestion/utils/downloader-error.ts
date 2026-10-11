import { UploadValidationError } from "../../uploads/utils/validate-video.js";

export class YouTubeDownloaderError extends UploadValidationError {
  constructor(message: string, public readonly code: string, statusCode = 502, public readonly providerStatus?: number) { super(message, statusCode); }
}

// yt-dlp não fornece um contrato JSON para erros de extração. Nunca devolva stderr bruto.
export function downloaderError(stderr: string, phase: "metadata" | "download" = "metadata", exitCode?: number): UploadValidationError {
  stderr = stderr.split(/\r?\n/).filter((line) => line.startsWith("ERROR:")).at(-1) ?? stderr;
  if (/requested format.*not available|no video formats|no suitable formats/i.test(stderr))
    return new YouTubeDownloaderError("O formato solicitado não está disponível nesta consulta ao YouTube.", "FORMAT_UNAVAILABLE", 422);
  if (/private video|video is private/i.test(stderr))
    return new YouTubeDownloaderError("O vídeo do YouTube é privado.", "VIDEO_PRIVATE", 422);
  if (/requires?.*(?:PO.?Token|proof.of.origin)|(?:PO.?Token|proof.of.origin).*required/i.test(stderr))
    return new YouTubeDownloaderError("O downloader informou que este acesso exige PO Token. Nenhum token foi adicionado.", "PO_TOKEN_REQUIRED", 422);
  if (/confirm you.re not a bot|sign in|login required|authentication required/i.test(stderr) && !/confirm your age/i.test(stderr))
    return new YouTubeDownloaderError("O YouTube bloqueou o acesso e solicitou autenticação. Nenhuma conta foi utilizada.", "AUTH_REQUIRED", 422);
  const http = /HTTP Error (\d{3})/i.exec(stderr);
  if (/format.{0,100}(?:is blocked|was blocked|is forbidden)/i.test(stderr))
    return new YouTubeDownloaderError("O downloader informou que o formato solicitado está bloqueado pelo provedor.", "FORMAT_BLOCKED", 502,
      http ? Number(http[1]) : undefined);
  if (phase === "download" && http) return mediaHttpError(Number(http[1]));
  if (/HTTP Error 429|too many requests/i.test(stderr))
    return new YouTubeDownloaderError("O YouTube limitou as solicitações (HTTP 429). Aguarde antes de tentar novamente.", "PROVIDER_RATE_LIMIT");
  if (/HTTP Error 403/i.test(stderr))
    return new YouTubeDownloaderError("O YouTube bloqueou a consulta do downloader (HTTP 403). A razão da recusa não foi informada.", "PROVIDER_HTTP_403");
  if (/age.restricted|confirm your age|sign in|members.only|not available in your country|geo.restricted/i.test(stderr))
    return new YouTubeDownloaderError("O vídeo do YouTube tem restrição de acesso.", "VIDEO_RESTRICTED", 422);
  if (/timed out|timeout/i.test(stderr))
    return new UploadValidationError(phase === "download" ? "O download do YouTube excedeu o tempo limite."
      : "A consulta ao YouTube excedeu o tempo limite.", 504);
  if (/video unavailable|video is unavailable|video has been removed|video does not exist|this video is not available/i.test(stderr))
    return new UploadValidationError("O vídeo do YouTube está indisponível ou foi removido.", 422);
  if (http) return new UploadValidationError(`O provedor recusou a consulta do downloader (HTTP ${http[1]}).`, 502);
  return new YouTubeDownloaderError(phase === "download" ? `O downloader de mídia falhou${exitCode === undefined ? "" : ` (código ${exitCode})`}.`
    : "O downloader falhou ao consultar o YouTube.", "DOWNLOADER_FAILED");
}

export function mediaConnectionError(error: unknown): UploadValidationError {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return new UploadValidationError(code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT"
    ? "A transferência da mídia do YouTube excedeu o tempo limite."
    : "Falha de conexão durante a transferência da mídia do YouTube.", code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" ? 504 : 502);
}

export function mediaHttpError(status: number): UploadValidationError {
  if (status === 403) return new YouTubeDownloaderError("O provedor bloqueou a transferência da mídia (HTTP 403). A razão da recusa não foi informada.", "PROVIDER_HTTP_403", 502, 403);
  if (status === 401) return new YouTubeDownloaderError("O provedor bloqueou a transferência e solicitou autenticação (HTTP 401).", "AUTH_REQUIRED");
  if (status === 429) return new YouTubeDownloaderError("O provedor bloqueou a transferência por limite de solicitações (HTTP 429).", "PROVIDER_RATE_LIMIT");
  return new UploadValidationError([401, 403, 429].includes(status)
    ? `O provedor bloqueou a transferência da mídia (HTTP ${status}).`
    : `A transferência da mídia foi recusada pelo provedor (HTTP ${status}).`, 502);
}
