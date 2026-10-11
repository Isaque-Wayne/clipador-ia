import { readFile, lstat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { runRenderProcess } from "../../apps/api/dist/features/clip-rendering/services/render-process.js";
import { openMediaInput } from "../../apps/api/dist/features/video-preparation/services/open-media-input.js";
import { mediaTool } from "../../apps/api/dist/features/youtube-ingestion/services/ffmpeg-runner.js";
const root=resolve(process.argv[2]),result=JSON.parse(await readFile(join(root,"result.json"),"utf8")),signal=new AbortController().signal;
for(const clip of result.checks) {
  const pkg=JSON.parse(await readFile(join(root,clip.paths.metadata),"utf8"));
  const group=pkg.editPlan.captions.groups.find(group=>group.words.length>=4)??pkg.editPlan.captions.groups[0];
  const timestamp=Math.min(pkg.duration-.1,group.start+.14),path=join(root,clip.paths.video),input=await openMediaInput({path,identity:await lstat(path,{bigint:true})});
  const file=`qa-video-${clip.id}.jpg`;
  try {await runRenderProcess({executable:await mediaTool("ffmpeg"),cwd:root,inputFd:input.fd,timeoutMs:15000,args:["-hide_banner","-loglevel","error","-nostdin","-n","-protocol_whitelist","fd,file,pipe","-fd","0","-ss",timestamp.toFixed(3),"-i","fd:","-frames:v","1","-an","-vf","scale=540:960","-q:v","3","-f","image2","-update","1",file]},signal);}
  finally {await input.close();}
  console.log(JSON.stringify({clipId:clip.id,file:join(root,file),timestamp,words:group.words.map(word=>word.text).join(" ")}));
}
