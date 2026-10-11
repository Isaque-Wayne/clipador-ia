import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { parseYouTubeUrl } from '../../../config/youtube-url.mjs';
import { selectInput } from '../dist/features/youtube-ingestion/utils/select-input.js';
import { downloadTrack } from '../dist/features/youtube-ingestion/services/download-track.js';
import { downloaderError, mediaHttpError } from '../dist/features/youtube-ingestion/utils/downloader-error.js';
import { createUploadService } from '../dist/features/uploads/services/receive-video.js';
import { createYouTubeIngestion } from '../dist/features/youtube-ingestion/services/ingest-youtube.js';
const reference = parseYouTubeUrl('https://youtu.be/ac0RGoBVzhs');
const track = { id: 'preferred', extension: 'mp4', codec: 'avc1', height: 720,
  fallbacks: [{ id: 'alternative', extension: 'mp4', codec: 'avc1', height: 480 }, { id: 'never', extension: 'mp4', codec: 'avc1' }] };
const input = text => ({ content: Readable.from([Buffer.from(text)], { objectMode: false }) });
const failed = error => ({ content: Readable.from((async function* () { yield Buffer.from('partial'); throw error; })(), { objectMode: false }) });

test('403 limpa parcial antes de um único candidato alternativo; não concatena bytes nem renova o sinal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-fallback-'));
  const reserved = [], calls = [], signals = []; let disposed = 0;
  const result = await downloadTrack(reference, 'video', track, { directory, reserveTemporaryBytes: n => reserved.push(n) }, 10,
    new AbortController().signal, async (_ref, _ext, signal, id) => {
      calls.push(id); signals.push(signal);
      return { ...(id === 'preferred' ? failed(mediaHttpError(403)) : input('complete')), dispose: async () => { disposed++; } };
    });
  assert.deepEqual(calls, ['preferred', 'alternative']);
  assert.equal(signals[0], signals[1]); assert.equal(disposed, 2);
  assert.equal((await readFile(join(directory, result.name))).toString(), 'complete');
  assert.ok(reserved.includes(10)); assert.equal(reserved.at(-1), 18);
});
test('fallback tem limite de duas tentativas e limpa todos os parciais se ambas falham', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-fallback-limit-')); const calls = [];
  await assert.rejects(downloadTrack(reference, 'audio', track, { directory, reserveTemporaryBytes() {} }, 0,
    new AbortController().signal, async (_ref, _ext, _signal, id) => { calls.push(id); return failed(mediaHttpError(403)); }), { code: 'PROVIDER_HTTP_403' });
  assert.deepEqual(calls, ['preferred', 'alternative']); assert.deepEqual(await readdir(directory), []);
});
test('as duas tentativas compartilham o prazo da faixa e timeout limpa parcial e encerra consumidor', async t => {
  const previous = process.env.DOWNLOAD_TIMEOUT_MS;
  process.env.DOWNLOAD_TIMEOUT_MS = '250';
  t.after(() => { if (previous === undefined) delete process.env.DOWNLOAD_TIMEOUT_MS; else process.env.DOWNLOAD_TIMEOUT_MS = previous; });
  const directory = await mkdtemp(join(tmpdir(), 'youtube-fallback-timeout-')); let calls = 0; let disposed = 0;
  await assert.rejects(downloadTrack(reference, 'video', track, { directory, reserveTemporaryBytes() {} }, 0,
    new AbortController().signal, async () => {
      calls++;
      if (calls === 1) { await new Promise(resolve => setTimeout(resolve, 100)); return failed(mediaHttpError(403)); }
      const content = new Readable({ read() {} }); content.push(Buffer.from('partial'));
      return { content, dispose: async () => { disposed++; content.destroy(); } };
    }), error => error.code === 'TIMEOUT' && error.stage === 'download' && error.timeoutMs === 250);
  assert.equal(calls, 2); assert.equal(disposed, 1); assert.deepEqual(await readdir(directory), []);
});
test('quota, autenticação, PO token, rate limit e cancelamento não disparam fallback', async () => {
  for (const error of [Object.assign(new Error('quota'), { code: 'UPLOAD_STORAGE_QUOTA' }), mediaHttpError(401), mediaHttpError(429),
    downloaderError('ERROR: PO Token required for this format')]) {
    const directory = await mkdtemp(join(tmpdir(), 'youtube-no-fallback-')); let calls = 0;
    await assert.rejects(downloadTrack(reference, 'video', track, { directory, reserveTemporaryBytes() {} }, 0,
      new AbortController().signal, async () => { calls++; throw error; }), e => e === error);
    assert.equal(calls, 1); assert.deepEqual(await readdir(directory), []);
  }
  const directory = await mkdtemp(join(tmpdir(), 'youtube-cancel-fallback-')); const abort = new AbortController(); let calls = 0;
  await assert.rejects(downloadTrack(reference, 'video', track, { directory, reserveTemporaryBytes() {} }, 0, abort.signal,
    async () => { calls++; abort.abort(new Error('cancelled')); throw mediaHttpError(403); }), /cancelled/);
  assert.equal(calls, 1); assert.deepEqual(await readdir(directory), []);
});
test('candidatos são derivados dos formatos compatíveis e progressivo mantém prioridade', () => {
  const video = { format_id: 'v720', protocol: 'https', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 720 };
  const audio = { format_id: 'a128', protocol: 'https', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', abr: 128 };
  const formats = [{ ...video, format_id: 'v480', height: 480 }, video, { ...video, format_id: 'wrong-codec', vcodec: 'av01' },
    { ...audio, format_id: 'a64', abr: 64 }, audio];
  const selected = selectInput({ formats });
  assert.equal(selected.video.id, 'v720'); assert.equal(selected.video.fallbacks[0].id, 'v480');
  assert.equal(selected.audio.fallbacks[0].id, 'a64');
  assert.equal(selectInput({ formats: [...formats, { ...video, acodec: 'aac', url: 'https://r1.googlevideo.com/example' }] }).mode, 'progressive');
});
test('403 isolado não prova autenticação/token; warnings não substituem a causa terminal', () => {
  assert.equal(downloaderError('WARNING: some clients require a PO Token\nERROR: HTTP Error 403: Forbidden', 'download').code, 'PROVIDER_HTTP_403');
  assert.equal(downloaderError('ERROR: Format 136 is blocked: HTTP Error 403', 'download').code, 'FORMAT_BLOCKED');
  for (const [stderr, code] of [['ERROR: PO Token required for this format', 'PO_TOKEN_REQUIRED'], ['ERROR: Sign in to confirm your age', 'VIDEO_RESTRICTED'],
    ['ERROR: Private video. Sign in', 'VIDEO_PRIVATE'], ['ERROR: Sign in to confirm you are not a bot', 'AUTH_REQUIRED'],
    ['ERROR: HTTP Error 429: Too Many Requests', 'PROVIDER_RATE_LIMIT'], ['ERROR: downloader failure', 'DOWNLOADER_FAILED']]) {
    assert.equal(downloaderError(stderr, 'download').code, code);
  }
});
test('nova ingestão após falha gera novo ID e reextrai metadata; diagnóstico fica associado à falha', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-retry-')); const uploads = createUploadService({ directory }); await uploads.initialize();
  let extractions = 0;
  const service = createYouTubeIngestion(uploads, { async prepare(ref, _signal, _status, _progress, observe) {
    extractions++;
    assert.equal(ref.url, reference.url);
    observe({ stage: 'metadata', extractor: 'youtube', stderr: 'sanitized' });
    if (extractions === 1) throw mediaHttpError(403);
    return { name: 'youtube.mp4', type: 'video/mp4', open: async () => input('complete') };
  } });
  const first = await service.ingest(reference.url, new AbortController().signal);
  assert.equal(first.body.ingestion.code, 'PROVIDER_HTTP_403');
  assert.equal(service.find(first.body.ingestion.id).video.url, reference.url);
  assert.equal(service.find(first.body.ingestion.id).diagnostics[0].extractor, 'youtube');
  const second = await service.ingest(reference.url, new AbortController().signal);
  assert.equal(extractions, 2); assert.notEqual(first.body.ingestion.id, second.body.ingestion.id);
  assert.equal(second.statusCode, 200); assert.deepEqual(await readdir(directory), [second.body.ingestion.id]);
});
