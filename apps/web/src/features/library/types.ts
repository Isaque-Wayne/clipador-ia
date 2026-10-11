import type { PackagePreview } from "../social-packages/types";
export interface Project {
  id: string; title: string; origin: string; thumbnail: string | null; duration: number | null; createdAt: string | null;
  status: "uploaded" | "processing" | "completed" | "failed"; active: boolean;
  originalBytes: number; outputBytes: number; totalBytes: number; clipCount: number;
  outputDeletionBytes?: number;
  hasTranscript: boolean; hasAnalysis: boolean; warnings: string[];
  error?: { code: string; message: string; usedBytes?: number; limitBytes?: number; requiredBytes?: number; projectCount?: number };
}
export interface LibraryClip {
  id: string; batchId: string; title: string; duration: number; score: number; profile: string; family: string | null;
  style: string; status: string; size: number; checksum: string; createdAt: string; url: string;
  socialPackage?: PackagePreview;
}
export interface ProjectDetail extends Project {
  originalUrl: string | null; metadata: Record<string, unknown> | null; clips: LibraryClip[];
  transcript: { text: string; language: string; segments: { id: number; start: number; end: number; text: string }[] } | null;
  candidates: { id: string; title: string; duration: number; profile?: string; score: { value: number }; reason: string }[];
}
export interface StorageUsage {
  originalBytes: number; artifactBytes: number; temporaryBytes: number; outputBytes: number; totalBytes: number;
  uploadUsedBytes: number; outputUsedBytes: number; uploadLimitBytes: number; outputLimitBytes: number;
  freeDiskBytes: number; unclassifiedBytes: number; projectCount: number; warnings: string[];
}
