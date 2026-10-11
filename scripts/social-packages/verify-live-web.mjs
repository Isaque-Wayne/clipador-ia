import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const checks=[];
for(const path of ["http://127.0.0.1:3001/health","http://127.0.0.1:3000/library","http://127.0.0.1:3000/upload","http://127.0.0.1:3000/api/projects"]){
  const response=await fetch(path,{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,path);const text=await response.text();checks.push({url:path,status:response.status});
  if(path.endsWith("/library")||path.endsWith("/upload"))for(const asset of new Set([...text.matchAll(/(?:src|href)="([^" ]+\.(?:js|css)[^" ]*)"/g)].map(match=>match[1]))){
    const url=new URL(asset,"http://127.0.0.1:3000"),loaded=await fetch(url,{signal:AbortSignal.timeout(15000)});assert.equal(loaded.status,200,url.href);checks.push({url:url.href,status:loaded.status});
  }
}
await writeFile(resolve("apps/api/.data/vertical-quality-validation/live-web-checks.json"),JSON.stringify({checks,interactiveBrowserValidation:false},null,2));console.log(JSON.stringify({checks:checks.length,status:"passed"}));
