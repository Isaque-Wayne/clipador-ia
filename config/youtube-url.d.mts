export interface YouTubeReference { videoId: string; url: string }
export function parseYouTubeUrl(value: unknown): YouTubeReference;
