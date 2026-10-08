import type { PreparedVideo } from "../../uploads/services/persist-video-input.js";
import type { UploadMetadata, YouTubeSource } from "../../uploads/types/upload.js";
import type { YouTubeReference } from "../../../../../../config/youtube-url.mjs";

export type IngestionStatus = "pending" | "fetching-metadata" | "downloading" | "downloading-video" | "downloading-audio" | "merging" | "downloaded" | "failed";
export interface IngestionRecord {
  id: string;
  createdAt: string;
  status: IngestionStatus;
  video?: YouTubeSource;
  upload?: UploadMetadata;
  message?: string;
}
export interface YouTubeDownloader {
  prepare(reference: YouTubeReference, signal: AbortSignal, onStatus?: (status: IngestionStatus) => void): Promise<PreparedVideo>;
}
export interface YouTubeIngestionOptions { downloader?: YouTubeDownloader }
