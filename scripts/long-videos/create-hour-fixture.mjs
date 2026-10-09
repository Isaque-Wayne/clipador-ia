import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runRenderProcess } from "../../apps/api/dist/features/clip-rendering/services/render-process.js";
import { mediaTool } from "../../apps/api/dist/features/youtube-ingestion/services/ffmpeg-runner.js";

const source = resolve("apps/api/.data/processing-smoke/2026-10-08T18-10-13-205Z/uploads/1f5397b6-c4a3-4654-916f-1f7cb07ee477/video.mp4");
const root = resolve("apps/api/.data/long-video-fixtures", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(root, { recursive: true });
// Real Portuguese speech: five 2-minute scenes across 60 minutes. Silent gaps
// avoid another 26-minute continuous ASR run while testing the actual 1h media,
// PCM reservation, VAD/word timestamps near 1h, quotas, render and recovery.
const graph = [
  "[0:v]trim=duration=120,setpts=PTS-STARTPTS,scale=320:180,fps=1,split=5[v0][v1][v2][v3][v4]",
  "[0:a]atrim=duration=120,asetpts=PTS-STARTPTS,asplit=5[a0][a1][a2][a3][a4]",
  ...[0, 1, 2, 3].flatMap(i => [`[v${i}]tpad=stop_mode=clone:stop_duration=600,trim=duration=720[vp${i}]`, `[a${i}]apad=pad_dur=600,atrim=duration=720[ap${i}]`]),
  "[v4]tpad=start_mode=clone:start_duration=600,trim=duration=720[vp4]",
  "[a4]adelay=600000:all=1,atrim=duration=720[ap4]",
  "[vp0][ap0][vp1][ap1][vp2][ap2][vp3][ap3][vp4][ap4]concat=n=5:v=1:a=1[v][a]",
].join(";");
const output = join(root, "controlled-hour.mp4");
await runRenderProcess({ executable: await mediaTool("ffmpeg"), args: ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", source, "-filter_complex", graph,
  "-map", "[v]", "-map", "[a]", "-c:v", "libopenh264", "-b:v", "100k", "-r", "1", "-c:a", "aac", "-b:a", "32k", "-t", "3600", "-movflags", "+faststart", output], cwd: root, timeoutMs: 120000 }, new AbortController().signal);
console.log(output);
