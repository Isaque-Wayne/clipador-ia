import { isCandidateId } from "../../analysis/services/analysis-persistence.js";
import type { CutCandidate } from "../../analysis/candidate.js";
import type { VideoInspection } from "../../video-preparation/types/inspection.js";
export const MAX_CLIP_BYTES = 128 * 1024 * 1024;
export const RENDER_VERSION = "legacy-vertical-quality-1.1.1";
export function composition(inspection: Pick<VideoInspection, "width" | "height">) {
  const aspect = inspection.width / inspection.height, target = 9 / 16;
  const retained = Math.min(aspect / target, target / aspect);
  return retained >= .68
    ? { layout: "crop" as const, filter: "scale=1080:1920:force_original_aspect_ratio=increase:force_divisible_by=2,crop=1080:1920,setsar=1" }
    : { layout: "padding" as const, filter: "scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x10121c,setsar=1" };
}
export function renderArguments(candidate: Pick<CutCandidate, "id" | "start" | "end">, inspection: VideoInspection): string[] {
  if (!isCandidateId(candidate.id) || !Number.isFinite(candidate.start) || !Number.isFinite(candidate.end) || candidate.start < 0 || candidate.end <= candidate.start || candidate.end - candidate.start > 90.002) throw new Error("Invalid render bounds");
  return ["-hide_banner", "-loglevel", "warning", "-nostdin", "-n", "-threads", "2", "-protocol_whitelist", "fd,file,pipe", "-fd", "0", "-format_whitelist", "mov,matroska,webm",
    "-ss", String(candidate.start), "-i", "fd:", "-t", String(candidate.end - candidate.start), "-map", "0:v:0", "-map", "0:a:0", "-sn", "-dn",
    "-vf", `${composition(inspection).filter},ass=filename=${candidate.id}.ass`, "-filter_threads", "2", "-c:v", "libopenh264", "-b:v", "4500k", "-maxrate", "6000k", "-bufsize", "9000k", "-pix_fmt", "yuv420p", "-r", String(Math.min(30, inspection.fps ?? 30)),
    "-threads:v", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-fs", String(MAX_CLIP_BYTES), "-f", "mp4", `${candidate.id}.mp4.part`];
}
