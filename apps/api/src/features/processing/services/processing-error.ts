export class ProcessingError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 500,
    public readonly details?: { stage?: string; timeoutMs?: number; elapsedMs?: number; usedBytes?: number; limitBytes?: number; requiredBytes?: number; projectCount?: number; freedBytes?: number }) { super(message); }
}
