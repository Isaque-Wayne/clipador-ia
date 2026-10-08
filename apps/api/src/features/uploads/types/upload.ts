import type { VideoInspection } from "../../video-preparation/types/inspection.js";

export interface ReceivedVideo {
  name: string;
  size: number;
  type: string;
}

export interface UploadMetadata {
  id: string;
  file: ReceivedVideo;
  status: UploadStatus;
  nextStep: "processing";
  createdAt: string;
  extension: string;
  checksum: UploadChecksum | null;
  source?: YouTubeSource;
  inspection?: VideoInspection;
}

export interface YouTubeSource {
  provider: "youtube";
  videoId: string;
  url: string;
  title: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
}

export interface UploadChecksum {
  algorithm: "sha256";
  value: string;
}

export type UploadStatus = "uploaded" | "queued" | "processing" | "failed" | "completed";

export interface UploadOptions {
  directory?: string;
  retentionMs?: number;
  cleanupIntervalMs?: number;
  quotaBytes?: number;
  now?: () => number;
  maxConcurrentUploads?: number;
  uploadTimeoutMs?: number;
}

export interface UploadSuccess extends UploadMetadata {
  status: "uploaded";
  checksum: UploadChecksum;
  success: true;
  message: string;
  file: ReceivedVideo;
}
