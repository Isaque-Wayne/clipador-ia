import type { UploadMetadata, UploadOptions, UploadStatus } from "../types/upload.js";
import { storagePolicy } from "../config/storage-policy.js";
import { DEFAULT_UPLOAD_DIRECTORY } from "./temporary-video-storage.js";
import { prepareStorageRoot } from "./storage-paths.js";
import { scanUploadStorage } from "./scan-upload-storage.js";
import { cleanupUploadStorage } from "./cleanup-upload-storage.js";
import { assertStorageQuota } from "./storage-quota.js";
import { createUploadIndex } from "./upload-index.js";
import { updateUploadMetadata } from "./update-upload-metadata.js";
import { assertUploadTransition } from "../utils/upload-state.js";
import { UploadValidationError } from "../utils/validate-video.js";
import type { VideoInspection } from "../../video-preparation/types/inspection.js";
import { parseInspection } from "../../video-preparation/utils/parse-inspection.js";

export function createUploadCoordinator(options: UploadOptions) {
  const policy = storagePolicy(options);
  const index = createUploadIndex();
  const writing = new Set<string>();
  const consuming = new Map<string, UploadMetadata>();
  const reservations = new Map<string, number>();
  let storedBytes = 0;
  let pending: Promise<unknown> = Promise.resolve();

  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  }
  const root = () => prepareStorageRoot(options.directory ?? DEFAULT_UPLOAD_DIRECTORY);
  const find = (id: string) => index.find(id, policy.now(), policy.retentionMs);

  function reserve(id: string, bytes: number): void {
    const previous = reservations.get(id) ?? 0;
    if (bytes <= previous) return;
    const used = storedBytes + [...reservations.values()].reduce((sum, value) => sum + value, 0);
    assertStorageQuota(used, bytes - previous, policy.quotaBytes);
    reservations.set(id, bytes);
  }

  async function refresh() {
    const directory = await root();
    const snapshot = await scanUploadStorage(directory, writing, new Set(consuming.keys()));
    await cleanupUploadStorage(directory, snapshot.uploads, policy.now(), policy.retentionMs, new Set(consuming.keys()));
    const remaining = await scanUploadStorage(directory, writing, new Set(consuming.keys()));
    storedBytes = remaining.bytes;
    index.rebuild(remaining.uploads, policy.now(), policy.retentionMs);
    return remaining;
  }

  async function begin(id: string, bytes: number): Promise<void> {
    await exclusive(async () => { await refresh(); reserve(id, bytes); writing.add(id); });
  }

  async function finish(id: string, metadata?: UploadMetadata): Promise<void> {
    await exclusive(async () => {
      if (metadata) {
        storedBytes += metadata.file.size + Buffer.byteLength(JSON.stringify(metadata));
        index.set(metadata);
      }
      reservations.delete(id); writing.delete(id);
      if (!metadata) await refresh();
    });
  }

  async function commitMetadata(metadata: UploadMetadata, updated: UploadMetadata): Promise<UploadMetadata> {
    const difference = Buffer.byteLength(JSON.stringify(updated)) - Buffer.byteLength(JSON.stringify(metadata));
    const used = storedBytes + [...reservations.values()].reduce((sum, value) => sum + value, 0);
    assertStorageQuota(used, Math.max(0, difference), policy.quotaBytes);
    await updateUploadMetadata(await root(), updated);
    storedBytes += difference; index.set(updated);
    if (consuming.has(updated.id)) consuming.set(updated.id, updated);
    return updated;
  }

  async function persistInspection(id: string, inspection: VideoInspection): Promise<void> {
    await exclusive(async () => {
      const metadata = consuming.get(id);
      const parsed = parseInspection(inspection);
      if (!metadata || !parsed) throw new UploadValidationError("Inspeção inválida ou upload fora de uso.", 409);
      await commitMetadata(metadata, { ...metadata, inspection: parsed });
    });
  }

  async function transition(id: string, status: UploadStatus, internal = false): Promise<UploadMetadata> {
    return exclusive(async () => {
      const metadata = internal ? consuming.get(id) ?? find(id) : find(id);
      if (!metadata) throw new UploadValidationError("Upload não encontrado ou expirado.", 404);
      if (consuming.has(id) && !internal) throw new UploadValidationError("Upload em uso.", 409);
      assertUploadTransition(metadata.status, status);
      return commitMetadata(metadata, { ...metadata, status });
    });
  }

  async function pin(id: string): Promise<UploadMetadata> {
    return exclusive(async () => {
      const metadata = find(id);
      if (!metadata) throw new UploadValidationError("Upload não encontrado ou expirado.", 404);
      if (metadata.status === "failed" || consuming.has(id)) throw new UploadValidationError("Upload indisponível para consumo.", 409);
      consuming.set(id, metadata);
      return structuredClone(metadata);
    });
  }

  return { policy, root, begin, reserve, finish, find, transition, pin, persistInspection,
    reservePreparation: (id: string, bytes: number) => {
      if (!consuming.has(id)) throw new Error("Reserva fora do consumo protegido.");
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Reserva inválida.");
      reserve(id, bytes);
    },
    unpin: (id: string) => { consuming.delete(id); reservations.delete(id); },
    refresh: () => exclusive(refresh), drain: async () => { await pending; } };
}

export type UploadCoordinator = ReturnType<typeof createUploadCoordinator>;
