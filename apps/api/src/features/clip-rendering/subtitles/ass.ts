import type { SubtitleCue } from "./cues.js";
import { SUBTITLE_LAYOUT as layout } from "./layout.js";
function time(seconds: number) {
  const ticks = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(ticks / 360000)}:${String(Math.floor(ticks / 6000) % 60).padStart(2, "0")}:${String(Math.floor(ticks / 100) % 60).padStart(2, "0")}.${String(ticks % 100).padStart(2, "0")}`;
}
export function escapeAss(text: string) { return text.replace(/[\\{}\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim(); }
export function createAss(cues: SubtitleCue[]) {
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${layout.width}\nPlayResY: ${layout.height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${layout.font},${layout.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${layout.outline},1,2,${layout.marginLeft},${layout.marginRight},${layout.marginVertical},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return header + cues.map(cue => `Dialogue: 0,${time(cue.start)},${time(cue.end)},Default,,0,0,0,,${escapeAss(cue.text)}\n`).join("");
}
