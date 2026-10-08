import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { parseYouTubeUrl } from "../../../config/youtube-url.mjs";
import { UPLOAD_MAX_FILE_BYTES } from "../../../config/upload-limits.mjs";
import { metadataArguments } from "../dist/features/youtube-ingestion/services/run-ytdlp.js";
import { parseVideoInfo } from "../dist/features/youtube-ingestion/utils/parse-video-info.js";
import { isPublicIPv4, validateMediaUrl } from "../dist/features/youtube-ingestion/utils/media-url.js";
import { createMediaDownloader } from "../dist/features/youtube-ingestion/services/download-media.js";
import { verifyDownloader } from "../dist/features/youtube-ingestion/services/verify-downloader.js";

const id = "BaW_jenozKc";
const reference = parseYouTubeUrl(`https://youtu.be/${id}`);
const info = { id, ext: "mp4", protocol: "https", acodec: "aac", vcodec: "h264", filesize: 3,
  url: "https://r1.googlevideo.com/videoplayback", title: "Vídeo", duration: 10, thumbnail: "https://untrusted.test/image" };

test("watch, youtu.be e shorts viram uma URL canônica sem playlist ou parâmetros livres", () => {
  for (const value of [`https://youtube.com/watch?v=${id}&list=PL_TEST&next=http://127.0.0.1`,
    `https://youtu.be/${id}?si=test`, `https://www.youtube.com/shorts/${id}`, `https://m.youtube.com/watch?v=${id}`]) {
    assert.deepEqual(parseYouTubeUrl(value), reference);
  }
});
test("URLs inválidas, domínios falsos, credenciais, portas e entradas maliciosas são rejeitados", () => {
  for (const url of [null, "", "--exec=calc", "http://youtu.be/" + id, "https://youtube.com.evil.test/watch?v=" + id,
    "https://youtube.com@127.0.0.1/watch?v=" + id, "https://www.youtube.com:444/watch?v=" + id,
    "https://youtube.com/watch?v=short", `https://youtube.com/watch?v=${id}&v=${id}`,
    "https://youtube.com/playlist?list=abc", `https://youtu.be/${id}/../../etc/passwd`, "https://127.0.0.1",
    `https://www.youtube.com\\@evil.test/watch?v=${id}`, `https://youtu.be/${id}%0a--exec=calc`]) assert.throws(() => parseYouTubeUrl(url));
});
test("argumentos são separados e restringem extractor, plugins, configs, playlists e scripts remotos", () => {
  const args = metadataArguments(reference);
  for (const flag of ["--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-remote-components"]) assert.ok(args.includes(flag));
  assert.deepEqual(args.slice(-2), ["--", reference.url]);
  assert.equal(args[args.indexOf("--use-extractors") + 1], "youtube");
});
test("metadados são limitados e destinos externos ou formatos sem áudio são recusados", () => {
  const parsed = parseVideoInfo(info, reference);
  assert.equal(parsed.source.thumbnailUrl, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  assert.equal(parsed.source.durationSeconds, 10);
  assert.equal(parsed.estimatedSize, 3);
  assert.throws(() => parseVideoInfo({ ...info, filesize: UPLOAD_MAX_FILE_BYTES + 1 }, reference), { statusCode: 413 });
  for (const change of [{ url: "https://127.0.0.1/media" }, { url: "https://googlevideo.com.evil.test/media" },
    { url: "http://r1.googlevideo.com/media" }, { acodec: "none" }, { id: "differentID" }, { is_live: true }]) {
    assert.throws(() => parseVideoInfo({ ...info, ...change }, reference));
  }
});
test("faixas privadas, locais, especiais e IPv6 não são destinos de download", () => {
  for (const ip of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1",
    "192.168.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "::1"]) assert.equal(isPublicIPv4(ip), false);
  assert.equal(isPublicIPv4("8.8.8.8"), true);
  assert.throws(() => validateMediaUrl("https://user:pass@r1.googlevideo.com/video"));
});

function networkFor(responses, addresses = ["8.8.8.8"]) {
  const calls = [];
  return { calls, lookup: async () => addresses.map((address) => ({ address, family: 4 })),
    request(url, options, callback) {
      calls.push({ url, options });
      const req = new EventEmitter(); req.destroy = () => {};
      req.end = () => queueMicrotask(() => {
        const specification = responses.shift();
        const response = Readable.from([Buffer.from("abc")], { objectMode: false });
        response.statusCode = specification.status; response.headers = specification.headers ?? {};
        callback(response);
      });
      return req;
    } };
}
test("conexão usa IP validado e tamanho declarado; redirects externos são bloqueados", async () => {
  const network = networkFor([{ status: 200, headers: { "content-length": "3" } }]);
  const opened = await createMediaDownloader(network)(info.url, new AbortController().signal);
  assert.equal(opened.expectedSize, 3);
  const received = [];
  for await (const chunk of opened.content) received.push(chunk);
  assert.equal(Buffer.concat(received).toString(), "abc");
  network.calls[0].options.lookup("r1.googlevideo.com", {}, (error, address, family) => {
    assert.equal(error, null); assert.equal(address, "8.8.8.8"); assert.equal(family, 4);
  });
  const redirected = networkFor([{ status: 302, headers: { location: "https://127.0.0.1/private" } }]);
  await assert.rejects(createMediaDownloader(redirected)(info.url, new AbortController().signal), { statusCode: 502 });
  assert.equal(redirected.calls.length, 1);
});
test("DNS privado ou misto é recusado antes de abrir conexão; quota de bytes não depende da estimativa", async () => {
  const blocked = networkFor([], ["8.8.8.8", "127.0.0.1"]);
  await assert.rejects(createMediaDownloader(blocked)(info.url, new AbortController().signal), { statusCode: 502 });
  assert.equal(blocked.calls.length, 0);
  const oversized = networkFor([{ status: 200, headers: { "content-length": String(UPLOAD_MAX_FILE_BYTES + 1) } }]);
  await assert.rejects(createMediaDownloader(oversized)(info.url, new AbortController().signal), { statusCode: 413 });
  const invalidType = networkFor([{ status: 200, headers: { "content-type": "text/html" } }]);
  await assert.rejects(createMediaDownloader(invalidType)(info.url, new AbortController().signal, "video/mp4"), { statusCode: 502 });
});
test("redirects internos são revalidados e há limite para loops", async () => {
  const redirected = networkFor([{ status: 302, headers: { location: "https://r2.googlevideo.com/video" } }, { status: 200 }]);
  const opened = await createMediaDownloader(redirected)(info.url, new AbortController().signal);
  assert.equal(redirected.calls.length, 2); opened.dispose();
  const loop = networkFor(Array.from({ length: 4 }, () => ({ status: 302, headers: { location: info.url } })));
  await assert.rejects(createMediaDownloader(loop)(info.url, new AbortController().signal), { statusCode: 502 });
  assert.equal(loop.calls.length, 4);
});
test("SHA-256 do executável é conferido antes do uso; corrupção é recusada", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clipador-ytdlp-test-"));
  const binary = join(directory, "yt-dlp.exe");
  await writeFile(binary, "fixture");
  await writeFile(join(directory, "installation.json"), JSON.stringify({ version: "test",
    sha256: createHash("sha256").update("fixture").digest("hex"),
    source: "https://github.com/yt-dlp/yt-dlp/releases/download/test/yt-dlp.exe",
    checksumSource: "https://github.com/yt-dlp/yt-dlp/releases/download/test/SHA2-256SUMS" }));
  await verifyDownloader(binary);
  await writeFile(binary, "corrupted");
  await assert.rejects(verifyDownloader(binary), { statusCode: 503 });
});
