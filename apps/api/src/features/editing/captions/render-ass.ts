import { escapeAss } from "../../clip-rendering/subtitles/ass.js";
import { RENDER_PROFILES } from "../types.js";
import type { EditPlan, CaptionGroup } from "../types.js";
function timestamp(seconds: number) { const ticks = Math.max(0, Math.round(seconds * 100)); return `${Math.floor(ticks / 360000)}:${String(Math.floor(ticks / 6000) % 60).padStart(2, "0")}:${String(Math.floor(ticks / 100) % 60).padStart(2, "0")}.${String(ticks % 100).padStart(2, "0")}`; }
export function renderCaptionAss(plan: EditPlan): string {
  const profile = RENDER_PROFILES[plan.renderProfile], captions = plan.captions;
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${profile.width}\nPlayResY: ${profile.height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,${captions.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,${Math.round(profile.width * captions.safeArea.left)},${Math.round(profile.width * captions.safeArea.right)},${Math.round(profile.height * captions.safeArea.bottom)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const text = (group: CaptionGroup, active = -1) => group.words.map((word, index) => `{\\c${index === active ? "&H00E9D7A0&" : "&H00FFFFFF&"}\\fs${word.emphasis ? captions.fontSize + 4 : captions.fontSize}}${escapeAss(word.text)}`).join(" ");
  const event = (layer: number, start: number, end: number, group: CaptionGroup, active = -1) => `Dialogue: ${layer},${timestamp(start)},${timestamp(end)},Default,,0,0,0,,{\\pos(${Math.round(group.position.x * profile.width)},${Math.round(group.position.y * profile.height)})}${text(group, active)}\n`;
  return header + captions.groups.map(group => event(0, group.start, group.end, group) + (group.activeWord ? group.words.map((word, index) => word.end > word.start ? event(1, word.start, word.end, group, index) : "").join("") : "")).join("");
}
