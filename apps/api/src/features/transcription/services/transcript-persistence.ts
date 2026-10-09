import { createHash } from "node:crypto";
import { lstat, open, readFile, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { UploadChecksum } from "../../uploads/types/upload.js";
import type { Transcript } from "../types/transcript.js";
import type { TranscriptionStatus } from "../types/status.js";
import { normalizeTranscript } from "./normalize-transcript.js";
import { TranscriptionError } from "./transcription-error.js";
import { record } from "../../video-preparation/utils/parse-inspection.js";
import { MAX_ENGINE_BYTES } from "./python-runner.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export interface StoredTranscript { status: TranscriptionStatus; transcript: Transcript }
export async function removePartial(directory: string, name: "transcript.json.part" | "audio-asr.wav.part"): Promise<void> {
  const path = join(directory, name);
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new TranscriptionError("UNSAFE_STORAGE", "Temporário de transcrição inseguro.", 409);
    await unlink(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}
export async function readTranscript(directory: string, checksum: UploadChecksum | null): Promise<StoredTranscript | null> {
  const path = join(directory, "transcript.json");
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ENGINE_BYTES)
      throw new TranscriptionError("INVALID_RESULT", "Transcrição persistida insegura ou inválida.", 409);
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!record(value) || value["schemaVersion"] !== 1 || !record(value["sourceChecksum"])
      || !checksum || value["sourceChecksum"]["value"] !== checksum.value || value["sourceChecksum"]["algorithm"] !== checksum.algorithm
      || !record(value["status"]) || value["status"]["stage"] !== "completed" || !record(value["transcript"])
      || typeof value["checksum"] !== "string" || hash(JSON.stringify(value["transcript"])) !== value["checksum"])
      throw new Error("Invalid stored envelope");
    const status = value["status"];
    if (typeof status["uploadId"] !== "string" || typeof status["startedAt"] !== "string"
      || typeof status["finishedAt"] !== "string" || !Number.isFinite(Date.parse(status["startedAt"])) || !Number.isFinite(Date.parse(status["finishedAt"])))
      throw new Error("Invalid persisted status");
    const transcript = normalizeTranscript(value["transcript"]);
    if (JSON.stringify(transcript) !== JSON.stringify(value["transcript"])) throw new Error("Noncanonical transcript");
    return { status: { uploadId: status["uploadId"], stage: "completed", startedAt: status["startedAt"], finishedAt: status["finishedAt"] }, transcript };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    if (error instanceof TranscriptionError) throw error;
    throw new TranscriptionError("INVALID_RESULT", "Transcrição persistida corrompida ou incompatível.", 409);
  }
}
export async function persistTranscript(directory: string, sourceChecksum: UploadChecksum, status: TranscriptionStatus,
  transcript: Transcript, reserve: (bytes: number) => void, signal: AbortSignal): Promise<void> {
  const data = JSON.stringify({ schemaVersion: 1, engine: { name: "faster-whisper", model: "small", device: "cpu", computeType: "int8" },
    sourceChecksum, status, checksum: hash(JSON.stringify(transcript)), transcript });
  const bytes = Buffer.byteLength(data);
  if (bytes > MAX_ENGINE_BYTES) throw new TranscriptionError("INVALID_RESULT", "Transcrição excedeu o limite de persistência.");
  const audio = await lstat(join(directory, "audio-asr.wav.part"));
  reserve(audio.size + bytes * 2);
  const partial = join(directory, "transcript.json.part");
  const file = await open(partial, "wx", 0o600);
  try {
    await file.writeFile(data); await file.sync(); await file.close();
    signal.throwIfAborted();
    await link(partial, join(directory, "transcript.json"));
  } finally { await file.close(); await removePartial(directory, "transcript.json.part"); }
}
