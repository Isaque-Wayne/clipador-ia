import { ProcessingError } from "./processing-error.js";
export interface ResourceGate { acquire(): () => void }
export function createResourceGate(): ResourceGate {
  let active = false;
  return { acquire() {
    if (active) throw new ProcessingError("BUSY", "Há uma transcrição ou renderização em andamento. Tente novamente ao concluir.", 429);
    active = true;
    let released = false;
    return () => { if (!released) { released = true; active = false; } };
  } };
}
