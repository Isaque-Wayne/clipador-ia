import type { Readable } from "node:stream";
import type { UploadMetadata, UploadSuccess, YouTubeSource } from "../types/upload.js";
import type { UploadCoordinator } from "./upload-coordinator.js";
import { createTemporaryVideoStorage } from "./temporary-video-storage.js";
import { validateVideoDetails, validateVideoSize, VIDEO_EXTENSIONS, MAX_VIDEO_BYTES } from "../utils/validate-video.js";
import { sanitizeFilename } from "../utils/upload-names.js";

export interface OpenedVideo { content: Readable; expectedSize?: number; dispose?: () => void | Promise<void> }
export interface StagingContext { directory: string; reserveTemporaryBytes: (bytes: number) => void }
export interface PreparedVideo {
  name: string;
  type: string;
  estimatedSize?: number;
  source?: YouTubeSource;
  workspace?: boolean;
  validateOutput?: (path: string, signal: AbortSignal) => Promise<void>;
  open: (signal: AbortSignal, context?: StagingContext) => Promise<OpenedVideo>;
}

export async function persistVideoInput(input: PreparedVideo, id: string, signal: AbortSignal,
  coordinator: UploadCoordinator, storage: ReturnType<typeof createTemporaryVideoStorage>): Promise<UploadSuccess> {
  validateVideoDetails(input.name, input.type);
  if (input.estimatedSize !== undefined) validateVideoSize(input.estimatedSize);
  const metadata: UploadMetadata = {
    id, file: { name: sanitizeFilename(input.name), size: 0, type: input.type },
    status: "uploaded", nextStep: "processing", createdAt: new Date(coordinator.policy.now()).toISOString(),
    extension: VIDEO_EXTENSIONS[input.type] ?? "", checksum: null,
    ...(input.source ? { source: input.source } : {}),
  };
  const metadataBytes = Buffer.byteLength(JSON.stringify({ ...metadata, file: { ...metadata.file, size: MAX_VIDEO_BYTES },
    checksum: { algorithm: "sha256", value: "0".repeat(64) } }));
  await coordinator.begin(id, metadataBytes + (input.estimatedSize ?? 1));
  let opened: OpenedVideo | undefined;
  let sourceError: unknown;
  const captureError = (error: Error) => { sourceError = error; };
  let committed = false;
  let temporaryBytes = 0;
  let disposed = false;
  const dispose = async () => { if (!disposed) { disposed = true; await opened?.dispose?.(); } };
  try {
    signal.throwIfAborted();
    const directory = input.workspace ? await storage.createWorkspace(id) : undefined;
    opened = await input.open(signal, directory ? { directory, reserveTemporaryBytes: (bytes) => {
      temporaryBytes = bytes;
      coordinator.reserve(id, metadataBytes + bytes);
    } } : undefined);
    opened.content.on("error", captureError);
    signal.throwIfAborted();
    if (opened.expectedSize !== undefined) {
      validateVideoSize(opened.expectedSize);
      coordinator.reserve(id, metadataBytes + opened.expectedSize);
    }
    if (sourceError || opened.content.errored) throw sourceError ?? opened.content.errored;
    const complete = await storage.save(opened.content, metadata, MAX_VIDEO_BYTES, signal, opened.expectedSize,
      (size) => coordinator.reserve(id, metadataBytes + temporaryBytes + size), Boolean(directory), async (path) => {
        await input.validateOutput?.(path, signal);
        if (directory) await dispose(); // Retirar faixas antes do marcador de commit.
      });
    await coordinator.finish(id, complete);
    committed = true;
    return { ...complete, status: "uploaded", success: true, message: "Vídeo enviado e salvo temporariamente com sucesso." };
  } finally {
    try { await dispose(); } finally {
      try { if (!committed) await coordinator.finish(id); }
      finally { opened?.content.removeListener("error", captureError); }
    }
  }
}
