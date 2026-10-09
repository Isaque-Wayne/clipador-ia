import { RENDER_PROFILES } from "../types.js";
import type { RenderPlan } from "./render-plan.js";
import { validateEditPlan } from "../planning/validate-edit-plan.js";
export const PLANNED_RENDER_VERSION = "editplan-ffmpeg-1.0.1";
const fixed = (value: number) => String(Math.round(value * 1000000) / 1000000);
export function clipByteBudget(duration: number) { return Math.min(128 * 1024 * 1024, Math.ceil(duration * 6_192_000 / 8 * 1.15 + 2 * 1024 * 1024)); }
export function planFilterGraph(render: RenderPlan, musicName?: string): string {
  const plan = validateEditPlan(render.edit), profile = RENDER_PROFILES[plan.renderProfile], count = plan.timeline.length;
  const filters: string[] = [];
  if (count > 1) {
    filters.push(`[0:v:0]split=${count}${plan.timeline.map((_, index) => `[vin${index}]`).join("")}`);
    filters.push(`[0:a:0]asplit=${count}${plan.timeline.map((_, index) => `[ain${index}]`).join("")}`);
  }
  plan.timeline.forEach((span, index) => {
    const start = fixed(span.sourceStart - plan.sourceRange.start), end = fixed(span.sourceEnd - plan.sourceRange.start);
    filters.push(`${count > 1 ? `[vin${index}]` : "[0:v:0]"}trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`);
    filters.push(`${count > 1 ? `[ain${index}]` : "[0:a:0]"}atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`);
  });
  filters.push(`${plan.timeline.map((_, index) => `[v${index}][a${index}]`).join("")}concat=n=${count}:v=1:a=1[video][audio]`);
  const frame = plan.framing.mode === "crop"
    ? `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${profile.width}:${profile.height},setsar=1`
    : `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:color=0x10121c,setsar=1`;
  const zoom = plan.zoomEvents.length ? `,scale=w='ceil(${profile.width}*(1+${plan.zoomEvents.map(event => `if(between(t,${fixed(event.start)},${fixed(event.end)}),${fixed(event.intensity)}*min(1,min((t-${fixed(event.start)})/0.18,(${fixed(event.end)}-t)/0.18)),0)`).join("+")})/2)*2':h=-2:eval=frame,crop=${profile.width}:${profile.height}:(iw-${profile.width})/2:(ih-${profile.height})/2` : "";
  filters.push(`[video]${frame}${zoom},ass=filename=${plan.clipId}.ass[vout]`);
  if (musicName && render.assets.music && plan.music.requested) {
    const music = plan.music, duck = music.ducking;
    filters.push("[audio]asplit=2[voice][side]");
    filters.push(`[1:a:0]atrim=duration=${fixed(plan.outputDuration)},asetpts=PTS-STARTPTS,volume=${fixed(music.volume)},afade=t=in:st=0:d=${fixed(music.fadeIn)},afade=t=out:st=${fixed(Math.max(0, plan.outputDuration - music.fadeOut))}:d=${fixed(music.fadeOut)}[music]`);
    filters.push(`[music][side]sidechaincompress=threshold=${fixed(duck.threshold)}:ratio=${fixed(duck.ratio)}:attack=${fixed(duck.attackMs)}:release=${fixed(duck.releaseMs)}[ducked]`);
    filters.push("[voice][ducked]amix=inputs=2:duration=first:normalize=0[aout]");
  } else filters.push("[audio]anull[aout]");
  return filters.join(";\n");
}
export function plannedRenderArguments(render: RenderPlan, musicName?: string): string[] {
  const plan = validateEditPlan(render.edit), profile = RENDER_PROFILES[plan.renderProfile];
  if (musicName && !/^asset-[a-f0-9]{16}\.(wav|mp3|m4a|ogg)$/.test(musicName)) throw new Error("Unsafe asset name");
  return ["-hide_banner", "-loglevel", "warning", "-nostdin", "-n", "-threads", "2", "-protocol_whitelist", "fd,file,pipe", "-fd", "0", "-format_whitelist", "mov,matroska,webm", "-ss", fixed(plan.sourceRange.start), "-i", "fd:",
    ...(musicName ? ["-stream_loop", "-1", "-protocol_whitelist", "file", "-i", musicName] : []),
    "-/filter_complex", `${plan.clipId}.ffgraph`, "-filter_complex_threads", "2", "-map", "[vout]", "-map", "[aout]", "-t", fixed(plan.outputDuration), "-sn", "-dn", "-c:v", "libopenh264", "-b:v", "4500k", "-maxrate", "6000k", "-bufsize", "9000k", "-pix_fmt", "yuv420p", "-r", String(profile.fps), "-threads:v", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-fs", String(clipByteBudget(plan.outputDuration)), "-f", "mp4", `${plan.clipId}.mp4.part`];
}
