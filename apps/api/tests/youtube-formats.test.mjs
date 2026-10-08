import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseYouTubeUrl } from "../../../config/youtube-url.mjs";
import { parseVideoInfo } from "../dist/features/youtube-ingestion/utils/parse-video-info.js";
import { summarizeFormats } from "../dist/features/youtube-ingestion/utils/video-formats.js";
import { downloaderError } from "../dist/features/youtube-ingestion/utils/downloader-error.js";
import { createMediaDownloader } from "../dist/features/youtube-ingestion/services/download-media.js";
import { metadataArguments } from "../dist/features/youtube-ingestion/services/run-ytdlp.js";
import { PROGRESSIVE_FORMAT } from "../dist/features/youtube-ingestion/services/downloader-command.js";
import { createServer } from "../dist/server/create-server.js";

const reference = parseYouTubeUrl("https://youtu.be/JOhiWY7XmoY");
const progressive = { format_id: "18", ext: "mp4", protocol: "https", acodec: "aac", vcodec: "h264",
  filesize: 3, url: "https://r1.googlevideo.com/videoplayback?secret=signed" };
const info = { id: reference.videoId, title: "Teste", duration: 90, formats: [progressive] };

test("extração retorna JSON mesmo sem formato combinado; não solicita merge ou formato fixo", () => {
  const args = metadataArguments(reference);
  assert.equal(args[args.indexOf("--format") + 1], PROGRESSIVE_FORMAT);
  assert.ok(args.includes("--ignore-no-formats-error"));
  assert.ok(args.includes("--dump-single-json"));
  assert.ok(args.includes("--skip-download"));
  assert.ok(!args.includes("--no-warnings"));
});
test("seleciona progressivo disponível entre vídeo, áudio e formatos segmentados", () => {
  const formats = [{ ...progressive, acodec: "none" }, progressive,
    { ...progressive, vcodec: "none" }, { ...progressive, protocol: "m3u8_native" }];
  const parsed = parseVideoInfo({ ...info, formats }, reference);
  assert.equal(parsed.type, "video/mp4");
  assert.ok(!("mediaUrl" in parsed));
  assert.equal(parsed.estimatedSize, 3);
});
test("múltiplos progressivos seguem preferência estruturada do yt-dlp, sem forçar MP4", () => {
  const webm = { ...progressive, ext: "webm", format_id: "43", filesize: 4 };
  const parsed = parseVideoInfo({ ...info, formats: [progressive, webm] }, reference);
  assert.equal(parsed.type, "video/webm");
  assert.equal(parsed.estimatedSize, 4);
});
test("sem progressivo não aceita áudio isolado, vídeo isolado, HLS, codecs desconhecidos ou lista vazia", () => {
  for (const formats of [[], [{ ...progressive, acodec: "none" }, { ...progressive, vcodec: "none" }],
    [{ ...progressive, protocol: "m3u8_native" }], [{ ...progressive, acodec: "unknown" }]]) {
    assert.throws(() => parseVideoInfo({ ...info, formats }, reference), (error) =>
      error.statusCode === 422 && /progressivo/.test(error.message) && !/privado/.test(error.message));
  }
});
test("diagnóstico estruturado não publica URL assinada nem headers", () => {
  const result = summarizeFormats(info);
  assert.equal(result[0].id, "18");
  assert.equal(result[0].compatible, true);
  assert.ok(!JSON.stringify(result).includes("signed"));
});
test("headers e URLs assinadas ficam com o yt-dlp e não entram no contrato preparado do Node", () => {
  const parsed = parseVideoInfo({ ...info, http_headers: { "User-Agent": "Extractor UA", Cookie: "secret", Host: "localhost" },
    formats: [{ ...progressive, http_headers: { "Accept-Language": "en-US", "User-Agent": "Format UA" } }] }, reference);
  assert.ok(!("headers" in parsed));
  assert.ok(!JSON.stringify(parsed).includes("secret"));
  assert.ok(!JSON.stringify(parsed).includes("signed"));
});

const errors = [
  ["ERROR: [youtube] jNQXAC9IVRw: Requested format is not available. Use --list-formats for a list of available formats", 422, /formato.*compatível/],
  ["ERROR: [youtube] BaW_jenozKc: This video is unavailable", 422, /indisponível/],
  ["ERROR: [youtube] id: Private video. Sign in if you've been granted access", 422, /privado/],
  ["ERROR: [youtube] id: Sign in to confirm your age", 422, /restrição/],
  ["ERROR: [youtube] id: Sign in to confirm you're not a bot", 502, /bloqueou/],
  ["ERROR: HTTP Error 403: Forbidden", 502, /bloqueou/],
  ["ERROR: HTTP Error 503: Service Unavailable", 502, /HTTP 503/],
  ["ERROR: request timed out", 504, /tempo limite/],
  ["ERROR: unexpected extractor failure", 502, /downloader falhou/],
];
test("stderr real e categorias distintas são mapeados sem confundir formato com disponibilidade", () => {
  for (const [stderr, status, message] of errors) {
    const error = downloaderError(`WARNING: Requested format is not available\n${stderr}`);
    assert.equal(error.statusCode, status);
    assert.match(error.message, message);
    assert.ok(!error.message.includes("ERROR:"));
  }
});
test("API mantém mensagens distintas de downloader e não registra uploads incompletos", async (t) => {
  for (const [stderr, status, message] of errors) {
    const directory = await mkdtemp(join(tmpdir(), "clipador-youtube-errors-"));
    const server = createServer({ directory }, { downloader: { prepare: async () => { throw downloaderError(stderr); } } });
    t.after(() => server.close());
    const response = await server.inject({ method: "POST", url: "/ingestions/youtube", payload: { url: reference.url } });
    assert.equal(response.statusCode, status);
    assert.match(response.json().message, message);
    assert.equal((await server.inject(`/uploads/${response.json().ingestion.id}`)).statusCode, 404);
    assert.deepEqual(await readdir(directory), []);
  }
});
function network(status, error) {
  let options;
  return { get options() { return options; }, lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    request(_url, supplied, callback) {
      options = supplied;
      const req = new EventEmitter(); req.destroy = () => {};
      req.end = () => queueMicrotask(() => {
        if (error) return req.emit("error", error);
        const response = Readable.from([Buffer.from("abc")], { objectMode: false });
        response.statusCode = status; response.headers = { "content-length": "3" }; callback(response);
      });
      return req;
    } };
}
test("transferência usa UA correto e expõe recusa HTTP sem URL assinada", async () => {
  const successful = network(200);
  const opened = await createMediaDownloader(successful)(progressive.url, new AbortController().signal, "video/mp4", { "User-Agent": "Extractor UA" });
  assert.equal(successful.options.headers["user-agent"], "Extractor UA");
  opened.dispose();
  for (const status of [401, 403, 429, 404, 500]) {
    await assert.rejects(createMediaDownloader(network(status))(progressive.url, new AbortController().signal), (error) => {
      assert.equal(error.statusCode, 502);
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.equal(/bloqueou/.test(error.message), [401, 403, 429].includes(status));
      assert.ok(!error.message.includes("signed")); return true;
    });
  }
});
test("erro de conexão e timeout da mídia têm mensagens distintas", async () => {
  for (const [code, status, message] of [["ECONNRESET", 502, /Falha de conexão/], ["ETIMEDOUT", 504, /tempo limite/]]) {
    await assert.rejects(createMediaDownloader(network(0, Object.assign(new Error("network"), { code })))(progressive.url,
      new AbortController().signal), (error) => error.statusCode === status && message.test(error.message));
  }
});
