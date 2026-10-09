import type { EditPlan, AssetResolution } from "../types.js";
import type { MusicProvider } from "../music/music-provider.js";
import type { BRollProvider } from "../broll/broll-provider.js";
export async function resolveAssets(plan: EditPlan, music: MusicProvider, broll: BRollProvider, signal: AbortSignal): Promise<AssetResolution> {
  const result: AssetResolution = { warnings: [] };
  if (plan.music.requested) {
    try { const asset = await music.resolve(plan.music.mood, signal); if (asset) result.music = asset; else result.warnings.push("Sem música licenciada disponível: render com voz original."); }
    catch { signal.throwIfAborted(); result.warnings.push("Asset musical indisponível/corrompido: render sem música."); }
  }
  for (const cue of plan.bRollEvents) {
    try {
      const asset = await broll.resolve(cue, signal);
      result.warnings.push(asset ? "B-roll aprovado encontrado, mas compositor de B-roll ainda indisponível: quadro original preservado." : "Sem cutaway do source aprovado/contextual: B-roll omitido.");
    } catch { signal.throwIfAborted(); result.warnings.push("B-roll opcional indisponível: quadro original preservado."); }
  }
  if (plan.soundEffects.events.length) result.warnings.push("Sound effects ainda sem executor/assets aprovados: omitidos.");
  return result;
}
