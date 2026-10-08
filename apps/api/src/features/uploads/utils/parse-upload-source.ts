import { parseYouTubeUrl } from "../../../../../../config/youtube-url.mjs";
import type { YouTubeSource } from "../types/upload.js";

export function parseUploadSource(value: unknown): YouTubeSource | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const source = value as Record<string, unknown>;
  try {
    const reference = parseYouTubeUrl(source["url"]);
    const title = source["title"];
    const duration = source["durationSeconds"];
    const thumbnail = source["thumbnailUrl"];
    if (source["provider"] !== "youtube" || source["videoId"] !== reference.videoId || source["url"] !== reference.url
      || (title !== null && (typeof title !== "string" || title.length > 200))
      || (duration !== null && (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0))
      || (thumbnail !== null && thumbnail !== `https://i.ytimg.com/vi/${reference.videoId}/hqdefault.jpg`)) return undefined;
    return { provider: "youtube", ...reference, title, durationSeconds: duration, thumbnailUrl: thumbnail };
  } catch { return undefined; }
}
