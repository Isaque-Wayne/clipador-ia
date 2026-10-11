import { escapeAss } from "../clip-rendering/subtitles/ass.js";
import type { GlassOverlay, Region } from "./types.js";
import { fitHeadline } from "../thumbnails/headline.js";
const time = (seconds: number) => { const ticks = Math.round(seconds * 100); return `${Math.floor(ticks / 360000)}:${String(Math.floor(ticks / 6000) % 60).padStart(2, "0")}:${String(Math.floor(ticks / 100) % 60).padStart(2, "0")}.${String(ticks % 100).padStart(2, "0")}`; };
export function assHeader(width: number, height: number) {
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,76,&H00FFFFFF,&H00FFFFFF,&H00101724,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
}
function roundedRect(w: number, h: number, radius = 24) {
  const r = Math.min(radius, w / 2, h / 2), k = Math.round(r * .55);
  return `m ${r} 0 l ${w-r} 0 b ${w-r+k} 0 ${w} ${r-k} ${w} ${r} l ${w} ${h-r} b ${w} ${h-r+k} ${w-r+k} ${h} ${w-r} ${h} l ${r} ${h} b ${r-k} ${h} 0 ${h-r+k} 0 ${h-r} l 0 ${r} b 0 ${r-k} ${r-k} 0 ${r} 0`;
}
export function glassPanel(region: Region, width: number, height: number, duration: number, opacity = .62, layer = 2) {
  const x = Math.round(region.x * width), y = Math.round(region.y * height), w = Math.round(region.width * width), h = Math.round(region.height * height);
  const alpha = Math.round((1-opacity)*255).toString(16).padStart(2,"0");
  return `Dialogue: ${layer},0:00:00.00,${time(duration)},Default,,0,0,0,,{\\an7\\pos(${x},${y})\\p1\\bord1\\shad0\\1c&H241710&\\1a&H${alpha}&\\3c&HE9D7A0&\\3a&HBB&}${roundedRect(w,h)}{\\p0}\n`;
}
export function headlineEvent(text: string, region: Region, width: number, height: number, duration: number, preferred = 76, layer = 4) {
  const fitted = fitHeadline(escapeAss(text), region.width * width - 48, preferred);
  const x = Math.round(region.x * width + 24), y = Math.round(region.y * height + (region.height*height - fitted.lines.length*fitted.fontSize*1.18)/2);
  return `Dialogue: ${layer},0:00:00.00,${time(duration)},Default,,0,0,0,,{\\an7\\pos(${x},${y})\\fs${fitted.fontSize}\\bord2\\shad1\\c&HFFFFFF&}${fitted.lines.map(escapeAss).join("\\N")}\n`;
}
export function visualOverlayEvents(overlays: GlassOverlay[], width: number, height: number, duration: number) {
  return overlays.map(overlay => glassPanel(overlay.region,width,height,duration,overlay.opacity) + headlineEvent(overlay.text,overlay.region,width,height,duration,68)).join("");
}
