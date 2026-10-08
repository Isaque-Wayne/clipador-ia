import { join } from "node:path";

export function mergeArguments(directory: string): string[] {
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    "-protocol_whitelist", "file", "-f", "mov", "-i", join(directory, "track-video.part"),
    "-protocol_whitelist", "file", "-f", "mov", "-i", join(directory, "track-audio.part"),
    "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-map_metadata", "-1", "-map_chapters", "-1",
    "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"];
}
export function probeArguments(path: string): string[] {
  return ["-v", "error", "-protocol_whitelist", "file", "-f", "mov", "-i", path,
    "-show_entries", "stream=codec_type,codec_name:format=duration,size", "-of", "json"];
}
