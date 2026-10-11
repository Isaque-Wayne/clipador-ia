import type { Region } from "./types.js";

const TARGET_ASPECT = 9 / 16;
export interface VerticalFrame {
  mode: "crop" | "blur";
  sourceCrop: Region | null;
  foreground: Region;
  reason: string;
}
/** Image geometry is independent of caption/platform UI margins. No face detection is implied. */
export function safeVerticalFrame(width: number, height: number, important?: Region): VerticalFrame {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error("Invalid source dimensions");
  const aspect = width / height;
  const cropWidth = Math.min(1, TARGET_ASPECT / aspect), cropHeight = Math.min(1, aspect / TARGET_ASPECT);
  const center = important ? { x: important.x + important.width / 2, y: important.y + important.height / 2 } : { x: .5, y: .5 };
  const crop: Region = { x: Math.max(0, Math.min(1 - cropWidth, center.x - cropWidth / 2)), y: Math.max(0, Math.min(1 - cropHeight, center.y - cropHeight / 2)), width: cropWidth, height: cropHeight };
  const preservesRegion = important && important.x >= crop.x - .001 && important.y >= crop.y - .001
    && important.x + important.width <= crop.x + crop.width + .001 && important.y + important.height <= crop.y + crop.height + .001;
  if (preservesRegion || !important && cropWidth * cropHeight >= .6) return {
    mode: "crop", sourceCrop: crop, foreground: { x: 0, y: 0, width: 1, height: 1 },
    reason: important ? "Crop vertical preserva a região importante explicitamente informada." : "Crop vertical central conserva pelo menos 60% da fonte; imagem preenche a tela.",
  };
  const foregroundWidth = Math.min(1, aspect / TARGET_ASPECT), foregroundHeight = Math.min(1, TARGET_ASPECT / aspect);
  return { mode: "blur", sourceCrop: null, foreground: { x: (1 - foregroundWidth) / 2, y: (1 - foregroundHeight) / 2, width: foregroundWidth, height: foregroundHeight },
    reason: important ? "A região importante não cabe no crop 9:16; quadro inteiro grande e centralizado sobre blur." : "Crop removeria mais de 40% da fonte sem evidência visual; preservar quadro inteiro em toda a largura sobre blur." };
}
