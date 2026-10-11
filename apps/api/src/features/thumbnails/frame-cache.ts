import { createHash } from "node:crypto";
import { lstat, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { MediaInput } from "../video-preparation/types/preparation.js";
import { openMediaInput } from "../video-preparation/services/open-media-input.js";
import { runRenderProcess } from "../clip-rendering/services/render-process.js";
import { mediaTool } from "../youtube-ingestion/services/ffmpeg-runner.js";
export function frameCacheKey(videoId: string, timestamp: number, resolution: string) { return createHash("sha256").update(`${videoId}:${Math.round(timestamp*1000)}:${resolution}`).digest("hex").slice(0,24); }
export function createFrameCache(input: MediaInput, videoId: string, directory: string, signal: AbortSignal) {
  const entries = new Map<string,Promise<string>>();
  async function extract(timestamp: number, format: "gray"|"jpg") {
    if(!Number.isFinite(timestamp)||timestamp<0) throw new Error("Invalid frame timestamp");
    const resolution=format==="gray" ? "160x90" : "1280x720", key=frameCacheKey(videoId,timestamp,resolution);
    const existing=entries.get(key); if(existing) return existing;
    const promise=(async()=> {
      signal.throwIfAborted(); const name=`frame-${key}.${format}`, source=await openMediaInput(input);
      try { await runRenderProcess({ executable:await mediaTool("ffmpeg"), cwd:directory,inputFd:source.fd,timeoutMs:15000,
        args:["-hide_banner","-loglevel","error","-nostdin","-n","-threads","2","-protocol_whitelist","fd,file,pipe","-fd","0","-format_whitelist","mov,matroska,webm","-ss",(Math.round(timestamp*1000)/1000).toFixed(3),"-i","fd:","-frames:v","1","-an","-sn","-dn","-filter_threads","1", "-vf",format==="gray" ? "scale=160:90,format=gray" : "scale=1280:720:force_original_aspect_ratio=decrease", ...(format==="gray" ? ["-pix_fmt","gray","-f","rawvideo"] : ["-q:v","3","-f","image2","-update","1"]),name] },signal); }
      finally { await source.close(); }
      const path=join(directory,name), stat=await lstat(path);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>1024*1024) throw new Error("Invalid extracted frame");
      return path;
    })();
    entries.set(key,promise); return promise;
  }
  return { sample:async(timestamp:number)=>new Uint8Array(await readFile(await extract(timestamp,"gray"))), image:(timestamp:number)=>extract(timestamp,"jpg"),
    async cleanup() { for(const promise of entries.values()) { try { await unlink(await promise); } catch { /* Outer controlled work cleanup covers incomplete extracts. */ } } entries.clear(); }, count:()=>entries.size };
}
