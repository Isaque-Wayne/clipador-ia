import assert from "node:assert/strict";
import test from "node:test";
import { parseYouTubeUrl } from "../../../config/youtube-url.mjs";
import { parseIngestionResult } from "../src/features/youtube-ingestion/utils/parse-ingestion-result.ts";
import { POST } from "../src/app/api/ingestions/youtube/route.ts";

test("validação compartilhada canonicaliza links antes do envio e recusa domínios falsos", () => {
  assert.equal(parseYouTubeUrl("https://youtu.be/BaW_jenozKc?si=test").url, "https://www.youtube.com/watch?v=BaW_jenozKc");
  assert.throws(() => parseYouTubeUrl("https://youtube.com.evil.test/watch?v=BaW_jenozKc"));
});
test("resultado valida checksum e nunca exibe thumbnail arbitrária", () => {
  const id = "d980f6a4-4f49-4a89-8974-bdf95a27c7bb";
  const value = { id, status: "downloaded", createdAt: new Date().toISOString(),
    video: { url: "https://youtu.be/BaW_jenozKc", title: "Teste", durationSeconds: 10, thumbnailUrl: "http://127.0.0.1/private" },
    upload: { id, status: "uploaded", file: { name: "video.mp4", size: 3, type: "video/mp4" },
      checksum: { algorithm: "sha256", value: "0".repeat(64) } } };
  assert.equal(parseIngestionResult(value).video?.thumbnailUrl, null);
  assert.equal(parseIngestionResult(value).video?.title, "Teste");
  assert.throws(() => parseIngestionResult({ ...value, upload: { ...value.upload, checksum: { algorithm: "sha256", value: "bad" } } }));
});
test("proxy YouTube encaminha JSON, stream e cancelamento sem aceitar destino livre", async (t) => {
  const abort = new AbortController();
  const request = new Request("http://localhost/api/ingestions/youtube", { method: "POST", body: JSON.stringify({ url: "https://youtu.be/BaW_jenozKc" }), signal: abort.signal });
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(String(url), "http://127.0.0.1:3001/ingestions/youtube");
    assert.equal(options?.body, request.body);
    assert.equal(options?.redirect, "error");
    abort.abort(); assert.equal(options?.signal?.aborted, true);
    return Response.json({ success: false, message: "Quota excedida." }, { status: 507 });
  });
  assert.equal((await POST(request)).status, 507);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  assert.equal((await POST(new Request("http://localhost/api/ingestions/youtube", { method: "POST", body: "{}" }))).status, 502);
});
