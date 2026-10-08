import type { VideoInspection } from "./inspection.js";
export interface MediaInput {
  path: string;
  identity: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint };
}
export interface PreparationContext {
  directory: string;
  path: string;
  input: MediaInput;
  signal: AbortSignal;
  reserve: (bytes: number) => void;
  persistInspection: (inspection: VideoInspection) => Promise<void>;
}
