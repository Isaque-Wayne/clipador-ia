import assert from "node:assert/strict";
import test from "node:test";
import { ingestYouTube, waitForIngestion, cancelIngestion } from "../src/features/youtube-ingestion/services/ingest-youtube.ts";
import { parseProcessingStatus } from "../src/features/processing/services/processing-api.ts";

const id = "d980f6a4-4f49-4a89-8974-bdf95a27c7bb";
const completed = { id, status: "downloaded", createdAt: new Date().toISOString(), upload: { id, status: "uploaded", file: { name: "video.mp4", size: 3, type: "video/mp4" }, checksum: { algorithm: "sha256", value: "0".repeat(64) } } };
test("web inicia job, guarda ID e consulta resultado por GET sem request longa", async t => {
  const calls: string[] = [], statuses: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    calls.push(`${options?.method} ${url}`);
    return Response.json({ success: true, ingestion: options?.method === "POST" ? { id, status: "queued" } : completed }, { status: options?.method === "POST" ? 202 : 200 });
  });
  const result = await ingestYouTube("https://youtu.be/BaW_jenozKc", new AbortController().signal, progress => statuses.push(progress.status));
  assert.equal(result.id, id); assert.deepEqual(statuses, ["queued"]);
  assert.deepEqual(calls, ["POST /api/ingestions/youtube", `GET /api/ingestions/${id}`]);
});
test("polling diferencia timeout real da etapa e mantém a mensagem do backend", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, ingestion: { id, status: "failed", code: "TIMEOUT", message: "O download excedeu o limite de tempo configurado." } }));
  await assert.rejects(waitForIngestion(id, new AbortController().signal), { code: "TIMEOUT", message: "O download excedeu o limite de tempo configurado." });
});
test("consulta offline sinaliza conexão e abortar polling não envia DELETE", async t => {
  const abort = new AbortController(), methods: string[] = [], warnings: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => { methods.push(options?.method ?? "GET"); throw new TypeError("offline"); });
  await assert.rejects(waitForIngestion(id, abort.signal, progress => { warnings.push(progress.warning ?? ""); abort.abort(); }), { name: "AbortError" });
  assert.deepEqual(methods, ["GET"]); assert.match(warnings[0]!, /conectar à API/);
});
test("cancelamento explícito tem request própria e ID validado", async t => {
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(String(url), `/api/ingestions/${id}`); assert.equal(options?.method, "DELETE");
    return Response.json({ success: true, ingestion: { id, status: "failed", code: "CANCELLED" } });
  });
  assert.equal((await cancelIngestion(id, new AbortController().signal) as { code: string }).code, "CANCELLED");
  await assert.rejects(cancelIngestion("../escape", new AbortController().signal));
});
test("status de transcrição valida contagem real e tempo processado sem percentual", () => {
  const status = parseProcessingStatus({ uploadId: id, stage: "transcribing", progress: { segmentsProcessed: 100, processedThroughSeconds: 3500 } }, id);
  assert.equal(status.progress?.processedThroughSeconds, 3500);
  assert.throws(() => parseProcessingStatus({ uploadId: id, stage: "transcribing", progress: { segmentsProcessed: -1, processedThroughSeconds: Infinity } }, id));
});
