export const ASR_SAMPLE_RATE = 16000;
export const ASR_BYTES_PER_SECOND = ASR_SAMPLE_RATE * 2;
export function inspectionArguments(path: string, kind: "video" | "audio" = "video"): string[] {
  return ["-v", "error", "-protocol_whitelist", "file", "-format_whitelist", kind === "video" ? "mov,matroska,webm" : "wav",
    "-show_streams", "-show_format", "-of", "json", path];
}
export function descriptorInspectionArguments(): string[] {
  return ["-v", "error", "-protocol_whitelist", "fd", "-fd", "0", "-format_whitelist", "mov,matroska,webm",
    "-show_streams", "-show_format", "-of", "json", "fd:"];
}
export function audioArguments(): string[] {
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "fd,pipe", "-fd", "0", "-format_whitelist", "mov,matroska,webm", "-i", "fd:",
    "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "1", "-ar", String(ASR_SAMPLE_RATE),
    "-af", "aresample=async=1:first_pts=0",
    "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"];
}
