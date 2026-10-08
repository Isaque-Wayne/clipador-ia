import type { UploadOptions, UploadSuccess, UploadStatus } from "../types/upload.js";
import { createTemporaryVideoStorage } from "./temporary-video-storage.js";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { createUploadCoordinator } from "./upload-coordinator.js";
import { createUploadConcurrency } from "./upload-concurrency.js";
import { createUploadTimeout } from "./upload-timeout.js";
import { createUploadConsumer } from "./consume-upload.js";
import { persistVideoInput } from "./persist-video-input.js";
import type { PreparedVideo } from "./persist-video-input.js";
import { validateVideoDetails, validateVideoSize } from "../utils/validate-video.js";
import { UploadValidationError } from "../utils/validate-video.js";
import { join } from "node:path";
import { uploadPath } from "./storage-paths.js";
import type { PreparationContext } from "../../video-preparation/types/preparation.js";
import { preparationTimeoutMs } from "../../video-preparation/config/preparation-policy.js";

export function createUploadService(options: UploadOptions = {}) {
  const storage = createTemporaryVideoStorage(options.directory);
  const coordinator = createUploadCoordinator(options);
  const { policy } = coordinator;
  const concurrency = createUploadConcurrency(policy.maxConcurrentUploads);
  const operations = new Set<Promise<unknown>>();

  async function receivePreparedVideo(prepare: (signal: AbortSignal) => Promise<PreparedVideo>,
    signal = new AbortController().signal, id: string = randomUUID()): Promise<UploadSuccess> {
    let release: (() => void) | undefined;
    let deadline: ReturnType<typeof createUploadTimeout> | undefined;
    try {
      release = concurrency.acquire();
      deadline = createUploadTimeout(signal, policy.uploadTimeoutMs);
      signal = deadline.signal;
      signal.throwIfAborted();
      const input = await prepare(signal);
      signal.throwIfAborted();
      return await persistVideoInput(input, id, signal, coordinator, storage);
    } catch (error: unknown) {
      if (signal.aborted) throw signal.reason;
      throw error;
    } finally { deadline?.dispose(); release?.(); }
  }

  async function receiveVideo(content: Readable, name: string, type: string,
    signal = new AbortController().signal, expectedSize?: number): Promise<UploadSuccess> {
    let streamError: unknown;
    const captureError = (error: Error) => { streamError = error; };
    content.on("error", captureError);
    try {
      // Preservar validação local antes de adquirir a vaga compartilhada.
      validateVideoDetails(name, type);
      if (expectedSize !== undefined) validateVideoSize(expectedSize);
      return await receivePreparedVideo(async () => {
        if (streamError) throw streamError;
        return { name, type, ...(expectedSize === undefined ? {} : { estimatedSize: expectedSize }),
          open: async () => ({ content, ...(expectedSize === undefined ? {} : { expectedSize }) }) };
      }, signal);
    } finally { content.removeListener("error", captureError); }
  }

  function track<T>(operation: Promise<T>): Promise<T> {
    operations.add(operation);
    void operation.then(() => operations.delete(operation), () => operations.delete(operation));
    return operation;
  }

  const consume = createUploadConsumer(coordinator);
  async function prepareUpload<T>(id: string, operation: (context: PreparationContext) => Promise<T>, parent: AbortSignal): Promise<T> {
    const release = concurrency.acquire();
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      timer = setTimeout(() => abort.abort(new UploadValidationError("Tempo máximo de preparação do vídeo excedido.", 408)), preparationTimeoutMs());
      const signal = AbortSignal.any([parent, abort.signal]);
      signal.throwIfAborted();
      return await consume(id, async ({ metadata, file }) => {
        signal.throwIfAborted();
        const directory = await uploadPath(await coordinator.root(), id);
        const path = join(directory, `video${metadata.extension}`);
        const identity = await file.stat({ bigint: true });
        const result = await operation({ directory, path, input: { path, identity }, signal,
          reserve: (bytes) => coordinator.reservePreparation(id, bytes),
          persistInspection: (inspection) => coordinator.persistInspection(id, inspection) });
        signal.throwIfAborted();
        return result;
      });
    } finally {
      if (timer) clearTimeout(timer);
      try { await coordinator.refresh(); } finally { release(); }
    }
  }
  return { receiveVideo: (...args: Parameters<typeof receiveVideo>) => track(receiveVideo(...args)),
    receivePreparedVideo: (...args: Parameters<typeof receivePreparedVideo>) => track(receivePreparedVideo(...args)),
    findUpload: coordinator.find, initialize: coordinator.refresh, cleanup: coordinator.refresh,
    transitionUpload: (id: string, status: UploadStatus) => track(coordinator.transition(id, status)),
    consumeUpload: <T>(...args: Parameters<typeof consume<T>>) => track(consume<T>(...args)),
    prepareUpload: <T>(id: string, operation: (context: PreparationContext) => Promise<T>, signal = new AbortController().signal) => track(prepareUpload(id, operation, signal)),
    drain: async () => { await Promise.allSettled([...operations]); await coordinator.drain(); },
    cleanupIntervalMs: policy.cleanupIntervalMs, now: policy.now, retentionMs: policy.retentionMs };
}

export type UploadService = ReturnType<typeof createUploadService>;
