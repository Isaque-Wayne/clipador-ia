export interface IngestionResult {
  id: string;
  createdAt: string;
  status: "downloaded";
  video?: { title: string | null; durationSeconds: number | null; thumbnailUrl: string | null };
  upload: { id: string; status: string; file: { name: string; size: number; type: string }; checksum: { algorithm: "sha256"; value: string } };
}
export interface IngestionProgress {
  id: string;
  status: "queued" | "pending" | "fetching-metadata" | "downloading" | "downloading-video" | "downloading-audio" | "merging";
  bytesReceived?: number;
  estimatedBytes?: number;
  warning?: string;
}
export type IngestionState = { status: "idle" } | { status: "loading"; progress?: IngestionProgress }
  | { status: "success"; result: IngestionResult } | { status: "error"; message: string; id?: string; retryUrl?: string };
