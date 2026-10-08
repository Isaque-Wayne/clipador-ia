import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { parseYouTubeUrl } from "../../../config/youtube-url.mjs";
import { createYtdlpStream } from "../dist/features/youtube-ingestion/services/stream-ytdlp.js";
import { downloadArguments } from "../dist/features/youtube-ingestion/services/downloader-command.js";
import { createUploadService } from "../dist/features/uploads/services/receive-video.js";
import { createServer } from "../dist/server/create-server.js";

const reference = parseYouTubeUrl("https://youtu.be/JOhiWY7XmoY");
const directory = () => mkdtemp(join(tmpdir(), "clipador-youtube-stream-"));
function fixture(code, observer) {
  let child;
  let verifies = 0;
  const open = createYtdlpStream({ verify: async () => { verifies++; }, onTransfer: observer,
    launch(_executable, args, options) {
      assert.equal(verifies, 1);
      assert.equal(options.shell, false);
      assert.deepEqual(args.slice(-2), ["--", reference.url]);
      child = spawn(process.execPath, ["-e", code], options);
      return child;
    } });
  return { open: (signal) => open(reference, "mp4", signal), get child() { return child; } };
}
const input = (download) => ({ name: "youtube.mp4", type: "video/mp4", estimatedSize: 3, open: download.open });
const waitFor = async (check) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(check(), "condição não atingida");
};

test("argumentos baixam somente progressivo para stdout, sem shell, configs, plugins ou fixup", () => {
  const args = downloadArguments(reference, "mp4");
  assert.equal(args[args.indexOf("--output") + 1], "-");
  assert.equal(args[args.indexOf("--format") + 1], "b[protocol=https][ext=mp4]");
  for (const flag of ["--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-remote-components", "--no-part"]) assert.ok(args.includes(flag));
  assert.ok(!args.includes("--dump-single-json"));
  assert.equal(args[args.indexOf("--fixup") + 1], "never");
  assert.throws(() => downloadArguments({ ...reference, url: "https://127.0.0.1/" }, "mp4"));
});
test("stdout chega antes do fim do processo; hash e persistência não incluem stderr", async () => {
  const path = await directory(); const uploads = createUploadService({ directory: path }); await uploads.initialize();
  let summary;
  const download = fixture("process.stderr.write('warning diagnostic\\n'); process.stdout.write('abc'); setTimeout(() => process.exit(0), 500);", (value) => { summary = value; });
  const id = randomUUID();
  const pending = uploads.receivePreparedVideo(async () => input(download), undefined, id);
  await waitFor(() => download.child !== undefined);
  await waitFor(() => download.child.stdout.bytesRead > 0);
  assert.equal(download.child.exitCode, null);
  assert.equal(uploads.findUpload(id), undefined);
  const uploaded = await pending;
  assert.equal(uploaded.file.size, 3);
  assert.equal(uploaded.checksum.value, createHash("sha256").update("abc").digest("hex"));
  assert.equal((await readFile(join(path, id, "video.mp4"))).toString(), "abc");
  assert.match(summary.stderr, /warning diagnostic/);
  assert.equal(summary.exitCode, 0);
});
test("consumidor parado aplica backpressure e mantém buffers limitados", async () => {
  const download = fixture("const b=Buffer.alloc(65536); function pump(){while(process.stdout.write(b)){} process.stdout.once('drain',pump);} pump();");
  const opened = await download.open(new AbortController().signal);
  // Iniciar leitura uma vez, depois deixar o consumidor parado.
  opened.content.read(1);
  await waitFor(() => opened.content.readableLength > 0);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const first = download.child.stdout.bytesRead;
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(download.child.stdout.bytesRead, first);
  assert.ok(first < 2 * 1024 * 1024);
  assert.ok(opened.content.readableLength < 2 * 1024 * 1024);
  await opened.dispose();
  assert.ok(download.child.exitCode !== null || download.child.signalCode !== null);
});
test("EOF de stdout não promove parcial antes de exit zero; saída não zero limpa e libera vaga", async () => {
  const path = await directory(); const uploads = createUploadService({ directory: path, maxConcurrentUploads: 1 }); await uploads.initialize();
  const download = fixture("process.stdout.end('abc'); setTimeout(() => {process.stderr.write('ERROR: HTTP Error 403: Forbidden\\n'); process.exit(1);},500);");
  const id = randomUUID();
  const pending = uploads.receivePreparedVideo(async () => input(download), undefined, id);
  const failed = assert.rejects(pending, (error) => error.statusCode === 502 && /HTTP 403/.test(error.message));
  await waitFor(() => download.child?.stdout.readableEnded);
  assert.equal(uploads.findUpload(id), undefined);
  assert.ok(!(await readdir(join(path, id))).includes("metadata.json"));
  await failed;
  assert.deepEqual(await readdir(join(path, id)), []);
  assert.equal(uploads.findUpload(id), undefined);
  assert.equal((await uploads.receiveVideo(Readable.from([Buffer.from("ok")]), "local.mp4", "video/mp4")).status, "uploaded");
});
test("cancelamento e timeout matam processo, removem parcial e liberam quota/concorrência", async () => {
  for (const timeout of [false, true]) {
    const path = await directory(); const uploads = createUploadService({ directory: path, maxConcurrentUploads: 1,
      uploadTimeoutMs: timeout ? 250 : 5000, quotaBytes: 1200 }); await uploads.initialize();
    const download = fixture("process.stdout.write('abc'); setInterval(() => {}, 1000);");
    const abort = new AbortController(); const id = randomUUID();
    const pending = uploads.receivePreparedVideo(async () => input(download), abort.signal, id);
    const failed = assert.rejects(pending, (error) => timeout ? error.statusCode === 408 : /cancel/.test(error.message));
    if (!timeout) { await waitFor(() => download.child?.stdout.bytesRead > 0); abort.abort(new Error("client cancelled")); }
    await failed;
    assert.ok(download.child.exitCode !== null || download.child.signalCode !== null);
    assert.deepEqual(await readdir(join(path, id)), []);
    assert.equal(uploads.findUpload(id), undefined);
    assert.equal((await uploads.receiveVideo(Readable.from([Buffer.from("ok")]), "local.mp4", "video/mp4")).status, "uploaded");
  }
});
test("quota excedida encerra produtor sem acumular vídeo em RAM", async () => {
  const path = await directory(); const uploads = createUploadService({ directory: path, quotaBytes: 1200 }); await uploads.initialize();
  const download = fixture("const b=Buffer.alloc(65536); function pump(){while(process.stdout.write(b)){} process.stdout.once('drain',pump);} pump();");
  const id = randomUUID();
  await assert.rejects(uploads.receivePreparedVideo(async () => input(download), undefined, id), { statusCode: 507 });
  assert.ok(download.child.exitCode !== null || download.child.signalCode !== null);
  assert.deepEqual(await readdir(join(path, id)), []);
});
test("limite de bytes real encerra produtor e limpa parcial sem alocar arquivo inteiro", async () => {
  const streamModule = new URL("../dist/features/youtube-ingestion/services/stream-ytdlp.js", import.meta.url).href;
  const uploadsModule = new URL("../dist/features/uploads/services/receive-video.js", import.meta.url).href;
  const path = await directory();
  const script = `
    import assert from 'node:assert/strict'; import {spawn} from 'node:child_process';
    import {readdir} from 'node:fs/promises'; import {randomUUID} from 'node:crypto'; import {join} from 'node:path';
    const {createYtdlpStream} = await import(${JSON.stringify(streamModule)});
    const {createUploadService} = await import(${JSON.stringify(uploadsModule)});
    const directory = ${JSON.stringify(path)}; let child;
    const open = createYtdlpStream({verify: async()=>{}, launch: (_exe,_args,options) => {
      child=spawn(process.execPath,['-e',"process.stdout.write(Buffer.alloc(256)); setInterval(()=>{},1000);"],options); return child;
    }});
    const uploads=createUploadService({directory}); await uploads.initialize(); const id=randomUUID();
    await assert.rejects(uploads.receivePreparedVideo(async()=>({name:'test.mp4',type:'video/mp4',estimatedSize:1,
      open:(signal)=>open({videoId:'JOhiWY7XmoY',url:'https://www.youtube.com/watch?v=JOhiWY7XmoY'},'mp4',signal)}),undefined,id),{statusCode:413});
    assert.ok(child.exitCode!==null||child.signalCode!==null); assert.equal(uploads.findUpload(id),undefined);
    assert.deepEqual(await readdir(join(directory,id)),[]);
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    shell: false, windowsHide: true, env: { ...process.env, UPLOAD_MAX_FILE_BYTES: "128" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = ""; child.stdout.resume(); child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(code, 0, stderr);
});
test("falha de storage encerra processo sem registrar upload", async () => {
  const path = await directory(); const uploads = createUploadService({ directory: path }); await uploads.initialize();
  const id = randomUUID(); await mkdir(join(path, id));
  const download = fixture("process.stdout.write('abc'); setInterval(() => {}, 1000);");
  await assert.rejects(uploads.receivePreparedVideo(async () => input(download), undefined, id), { code: "EEXIST" });
  assert.ok(download.child.exitCode !== null || download.child.signalCode !== null);
  assert.equal(uploads.findUpload(id), undefined);
});
test("stderr é limitado; processo encerrado por sinal nunca cria sucesso", async (t) => {
  let summary;
  const download = fixture("process.stderr.write('x'.repeat(50000)+'\\nERROR: internal downloader failure\\n'); process.stdout.end('abc'); setInterval(()=>{},1000);", (value) => { summary = value; });
  const opened = await download.open(new AbortController().signal);
  t.after(() => opened.dispose());
  const pending = (async () => { for await (const _chunk of opened.content) {} })();
  const failed = assert.rejects(pending, /encerrado/);
  await waitFor(() => download.child.stdout.bytesRead > 0);
  download.child.kill("SIGKILL");
  await failed; await opened.dispose();
  assert.ok(summary.stderr.length <= 16384);
  assert.match(summary.stderr, /internal downloader failure/);
});
test("falha ao iniciar subprocesso é distinta de saída não zero", async () => {
  const open = createYtdlpStream({ verify: async () => {},
    launch: (_exe, _args, options) => spawn(`${process.execPath}.missing`, [], options) });
  const opened = await open(reference, "mp4", new AbortController().signal);
  try {
    await assert.rejects((async () => { for await (const _chunk of opened.content) {} })(),
      (error) => error.statusCode === 503 && /iniciar/.test(error.message));
  } finally { await opened.dispose(); }
});
test("cliente HTTP desconectado encerra downloader e não cria upload", async (t) => {
  const path = await directory(); const download = fixture("process.stdout.write('abc'); setInterval(()=>{},1000);");
  const server = createServer({ directory: path }, { downloader: { prepare: async () => input(download) } });
  t.after(() => server.close()); await server.listen({ host: "127.0.0.1", port: 0 });
  const abort = new AbortController();
  const request = fetch(`http://127.0.0.1:${server.server.address().port}/ingestions/youtube`, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ url: reference.url }), signal: abort.signal });
  const rejected = assert.rejects(request);
  await waitFor(() => download.child?.stdout.bytesRead > 0);
  abort.abort(); await rejected;
  await waitFor(() => download.child.exitCode !== null || download.child.signalCode !== null);
  await server.close();
  for (const id of await readdir(path)) assert.deepEqual(await readdir(join(path, id)), []);
});
