export class TranscriptionError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 422) { super(message); }
}
export function cancellation(): TranscriptionError {
  return new TranscriptionError("CANCELLED", "Transcrição cancelada.", 409);
}
