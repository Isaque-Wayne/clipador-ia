import type { UploadMetadata } from "../types/upload.js";
import type { StoredUpload } from "./scan-upload-storage.js";

export function createUploadIndex() {
  const uploads = new Map<string, UploadMetadata>();
  return {
    rebuild(stored: StoredUpload[], now: number, retentionMs: number): void {
      uploads.clear();
      for (const upload of stored) {
        if (upload.metadata && now - Date.parse(upload.metadata.createdAt) < retentionMs) {
          uploads.set(upload.id, upload.metadata);
        }
      }
    },
    set(metadata: UploadMetadata): void { uploads.set(metadata.id, structuredClone(metadata)); },
    find(id: string, now: number, retentionMs: number): UploadMetadata | undefined {
      const upload = uploads.get(id);
      return upload && now - Date.parse(upload.createdAt) < retentionMs ? structuredClone(upload) : undefined;
    },
  };
}
