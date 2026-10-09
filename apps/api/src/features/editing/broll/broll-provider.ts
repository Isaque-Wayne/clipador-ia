import type { BRollCue } from "../types.js";
export interface BRollAsset { id: string; source: "original-video" | "user" | "licensed-stock" | "external" | "generated-image" | "generated-video"; start: number; end: number; license: string }
export interface BRollProvider { resolve(cue: BRollCue, signal: AbortSignal): Promise<BRollAsset | null> }
export class SourceBRollProvider implements BRollProvider {
  constructor(private readonly approvedScenes: { id: string; start: number; end: number; description: string }[] = [], private readonly excludedSourceRange?: { start: number; end: number }) {}
  async resolve(cue: BRollCue, signal: AbortSignal): Promise<BRollAsset | null> {
    signal.throwIfAborted();
    const tokens = cue.query.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
    const excluded = this.excludedSourceRange;
    const scene = excluded && this.approvedScenes.find(item => tokens.some(token => item.description.toLowerCase().includes(token)) && (item.end <= excluded.start || item.start >= excluded.end));
    return scene ? { id: scene.id, source: "original-video", start: scene.start, end: scene.end, license: "Mesmo source autorizado; cena descrita/aprovada previamente." } : null;
  }
}
