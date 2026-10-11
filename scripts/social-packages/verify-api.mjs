import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "../../apps/api/dist/server/create-server.js";
const root=resolve(process.argv[2]),result=JSON.parse(await readFile(join(root,"result.json"),"utf8"));
const server=createServer({directory:join(root,"uploads")},{},{},{directory:join(root,"outputs")});server.log.level="silent";await server.ready();
const artifactChecks=[];
try {
  const detail=await server.inject(`/projects/${result.id}`);assert.equal(detail.statusCode,200);const project=detail.json().project;assert.equal(project.clips.length,5);
  for(const clip of project.clips) {
    assert.ok(clip.socialPackage);
    for(const [key,type] of [["thumbnailUrl","image/jpeg"],["sourceFrameUrl","image/jpeg"],["metadataUrl","application/json"]]) {
      const url=clip.socialPackage[key].replace(/^\/api/,""),response=await server.inject(`${url}?download=1`);
      assert.equal(response.statusCode,200);assert.ok(response.headers["content-type"].startsWith(type));assert.match(response.headers["content-disposition"],/attachment/);
      artifactChecks.push({clipId:clip.id,artifact:key,status:response.statusCode,bytes:response.rawPayload.length});
    }
  }
} finally {await server.close();}
const live={};
for(const [base,path] of [["http://127.0.0.1:3001","/health"],["http://127.0.0.1:3000","/library"],["http://127.0.0.1:3000","/upload"],["http://127.0.0.1:3000","/api/projects"]]) {
  const response=await fetch(base+path,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);live[base+path]=response.status;
  if(path==="/library") {
    const html=await response.text(),assets=[...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+\.(?:js|css))/g)].map(match=>match[1]))];
    assert.ok(assets.length>0);
    for(const asset of assets) {const loaded=await fetch(base+asset,{signal:AbortSignal.timeout(10000)});assert.equal(loaded.status,200,asset);await loaded.arrayBuffer();}
    live.staticAssetsVerified=assets.length;
  }
}
const checks={recordedAt:new Date().toISOString(),artifactChecks,live,interactiveBrowserValidation:false};
await writeFile(join(root,"api-checks.json"),JSON.stringify(checks,null,2),{flag:"wx"});console.log(JSON.stringify(checks,null,2));
