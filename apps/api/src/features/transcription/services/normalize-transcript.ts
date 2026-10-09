import type { Transcript, TranscriptSegment, TranscriptWord } from "../types/transcript.js";
import { record } from "../../video-preparation/utils/parse-inspection.js";

const time = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
function text(value: unknown): string {
  if (typeof value !== "string" || value.includes("\uFFFD")) throw new Error("Texto da transcrição inválido.");
  return value.replace(/\s+/gu, " ").trim();
}
export function normalizeTranscript(value: unknown): Transcript {
  if (!record(value) || typeof value["language"] !== "string" || !time(value["duration"])
    || value["duration"] <= 0 || !Array.isArray(value["segments"])) throw new Error("Contrato de transcrição inválido.");
  const language = value["language"].trim().toLowerCase();
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(language)) throw new Error("Idioma da transcrição inválido.");
  const duration = value["duration"];
  const languageProbability = value["languageProbability"] ?? null;
  if (!(languageProbability === null || (time(languageProbability) && languageProbability <= 1)))
    throw new Error("Probabilidade de idioma inválida.");
  let previousStart = 0;
  const segments: TranscriptSegment[] = (value["segments"] as unknown[]).map((segment, index) => {
    if (!record(segment) || !time(segment["start"]) || !time(segment["end"])
      || segment["start"] < previousStart || segment["end"] <= segment["start"]
      || segment["end"] > duration || !Array.isArray(segment["words"])) throw new Error("Timestamps de segmento inválidos.");
    const start = segment["start"], end = segment["end"];
    const id = segment["id"] ?? index;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) throw new Error("ID de segmento inválido.");
    previousStart = start;
    let previousWord = start;
    const words: TranscriptWord[] = (segment["words"] as unknown[]).map((word) => {
      if (!record(word) || !time(word["start"]) || !time(word["end"]) || word["start"] < previousWord
        || word["end"] < word["start"] || word["end"] > end
        || !(word["probability"] === undefined || word["probability"] === null || (time(word["probability"]) && word["probability"] <= 1)))
        throw new Error("Timestamps ou probabilidade por palavra inválidos.");
      previousWord = word["start"];
      const normalized = text(word["word"]);
      if (!normalized) throw new Error("Palavra vazia na transcrição.");
      return { word: normalized, start: word["start"], end: word["end"], probability: (word["probability"] ?? null) as number | null };
    });
    const normalized = text(segment["text"]);
    if (normalized && words.length === 0) throw new Error("A engine não forneceu timestamps por palavra.");
    return { id, start, end, text: normalized, words };
  });
  if (new Set(segments.map(segment => segment.id)).size !== segments.length) throw new Error("IDs de segmento duplicados.");
  return { language, languageProbability, duration, text: segments.map(segment => segment.text).filter(Boolean).join(" "), segments };
}
