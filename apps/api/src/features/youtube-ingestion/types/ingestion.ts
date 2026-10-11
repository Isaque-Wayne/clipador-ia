import type { PreparedVideo } from "../../uploads/services/persist-video-input.js";
import type { UploadMetadata, YouTubeSource } from "../../uploads/types/upload.js";
import type { YouTubeReference } from "../../../../../../config/youtube-url.mjs";
import type { DiagnosticObserver, YouTubeDiagnostic } from "./diagnostic.js";

export type IngestionStatus = "queued" | "pending" | "fetching-metadata" | "downloading" | "downloading-video" | "downloading-audio" | "merging" | "downloaded" | "failed";
export interface IngestionRecord {
  id: string;
  createdAt: string;
  status: IngestionStatus;
  video?: YouTubeSource;
  upload?: UploadMetadata;
  message?: string;
  code?: string;
  finishedAt?: string;
  progress?: { bytesReceived: number; estimatedBytes?: number };
  diagnostics?: YouTubeDiagnostic[];
  error?: { code: string; message: string; stage: string; timeoutMs?: number; elapsedMs?: number };
}
export interface YouTubeDownloader {
  prepare(reference: YouTubeReference, signal: AbortSignal, onStatus?: (status: IngestionStatus) => void,
    onProgress?: (bytesReceived: number) => void, observe?: DiagnosticObserver): Promise<PreparedVideo>;
}
export interface YouTubeIngestionOptions { downloader?: YouTubeDownloader }
