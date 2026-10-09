export class ProcessingError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 500,
    public readonly details?: { stage?: string; timeoutMs?: number; elapsedMs?: number }) { super(message); }
}
