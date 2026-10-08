import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/uploads/video/route.ts";

test("proxy encaminha o próprio stream e propaga checksum e erros da API", async (t) => {
  let called = 0;
  const request = new Request("http://localhost/api/uploads/video", {
    method: "POST", body: new Blob(["abc"]), headers: { "content-type": "video/mp4", "x-file-name": "video.mp4" },
  });
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    called++;
    assert.equal(options.body, request.body, "encaminhar stream sem reconstruir ou agregar bytes");
    assert.equal(new Headers(options.headers).get("x-file-name"), "video.mp4");
    assert.equal(await new Response(options.body).text(), "abc");
    return Response.json({ success: true, checksum: { algorithm: "sha256", value: "abc123" } });
  });
  const result = await POST(request);
  assert.equal(called, 1);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).checksum.algorithm, "sha256");
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: false, message: "limite excedido" }, { status: 413 }));
  assert.equal((await POST(new Request("http://localhost/api/uploads/video", { method: "POST", body: "v" }))).status, 413);
});

test("proxy encaminha cancelamento e informa falha de conexão", async (t) => {
  const abort = new AbortController();
  const request = new Request("http://localhost/api/uploads/video", { method: "POST", body: "v", signal: abort.signal });
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    abort.abort();
    assert.equal(options.signal?.aborted, true);
    throw new Error("connection reset");
  });
  const response = await POST(request);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).success, false);
});
