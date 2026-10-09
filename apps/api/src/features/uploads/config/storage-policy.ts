import type { UploadOptions } from "../types/upload.js";
import { resolveUploadLimits } from "../../../../../../config/upload-limits.mjs";
import { resolvePipelineTimeouts } from "../../../../../../config/pipeline-timeouts.mjs";

function positiveInteger(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error("Política de armazenamento deve usar inteiros positivos.");
  return result;
}

function environmentInteger(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error(`Configuração ${name} inválida.`);
  return positiveInteger(Number(raw), 1);
}

export function storagePolicy(options: UploadOptions) {
  const policy = {
    retentionMs: positiveInteger(options.retentionMs, environmentInteger("UPLOAD_RETENTION_MS") ?? 86_400_000),
    cleanupIntervalMs: positiveInteger(options.cleanupIntervalMs, environmentInteger("UPLOAD_CLEANUP_INTERVAL_MS") ?? 900_000),
    quotaBytes: positiveInteger(options.quotaBytes, resolveUploadLimits(process.env).quotaBytes),
    now: options.now ?? Date.now,
    maxConcurrentUploads: positiveInteger(options.maxConcurrentUploads, environmentInteger("UPLOAD_MAX_CONCURRENT") ?? 2),
    uploadTimeoutMs: positiveInteger(options.uploadTimeoutMs, resolvePipelineTimeouts().upload),
  };
  if (policy.cleanupIntervalMs > 2_147_483_647) throw new Error("Intervalo de limpeza excede o limite de temporizadores do Node.js.");
  if (policy.uploadTimeoutMs > 2_147_483_647) throw new Error("Timeout excede o limite de temporizadores do Node.js.");
  return policy;
}
