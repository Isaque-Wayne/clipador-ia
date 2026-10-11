import assert from "node:assert/strict";
import test from "node:test";
import { parsePackagePreview } from "../src/features/social-packages/parse-package";
const base="/api/uploads/11111111-1111-1111-1111-111111111111/clips/22222222-2222-2222-2222-222222222222/c_0123456789abcdef";
const summary={template:"HEADLINE_TOP",thumbnailStyle:"DYNAMIC",headline:"Uma ideia clara",platforms:["youtube-shorts","instagram-reels","tiktok"],frameTimestamp:10,selectionReason:"Hook e frame nítido"};
test("preview deriva rotas internas, sem aceitar destinos externos",()=> {
  const parsed=parsePackagePreview(summary,base);assert.equal(parsed.thumbnailUrl,`${base}/thumbnail`);assert.equal(parsed.metadataUrl,`${base}/metadata`);
  assert.throws(()=>parsePackagePreview({...summary,thumbnailUrl:"https://outside.example/image.jpg"},base));
  assert.throws(()=>parsePackagePreview({...summary,metadataUrl:`${base}/../secret`},base));
});
test("preview rejeita plano/estilo/plataforma e timestamp inválidos",()=> {
  for(const invalid of [{template:"unknown"},{thumbnailStyle:"random"},{platforms:["tiktok"]},{frameTimestamp:NaN},{frameTimestamp:-1}]) assert.throws(()=>parsePackagePreview({...summary,...invalid},base));
});
