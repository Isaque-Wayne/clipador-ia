import type { summarizeFormats } from "../utils/video-formats.js";
export interface YouTubeDiagnostic {
  stage: "metadata" | "progressive" | "video" | "audio";
  attempt?: number;
  formatId?: string;
  arguments?: string[];
  extractor?: string;
  formats?: ReturnType<typeof summarizeFormats>;
  stderr?: string;
  bytesReceived?: number;
  elapsedMs?: number;
  exitCode?: number | null;
}
export type DiagnosticObserver = (event: YouTubeDiagnostic) => void;
export const sanitizeDiagnostic = (text: string) => text.replace(/https?:\/\/[^\s]+/g, "[URL omitida]").slice(-16_384);
