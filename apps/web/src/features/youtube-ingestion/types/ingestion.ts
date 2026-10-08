export interface IngestionResult {
  id: string;
  createdAt: string;
  status: "downloaded";
  video?: { title: string | null; durationSeconds: number | null; thumbnailUrl: string | null };
  upload: { id: string; status: string; file: { name: string; size: number; type: string }; checksum: { algorithm: "sha256"; value: string } };
}
export type IngestionState = { status: "idle" } | { status: "loading" }
  | { status: "success"; result: IngestionResult } | { status: "error"; message: string; id?: string };
