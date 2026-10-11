import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseYouTubeUrl } from '../../config/youtube-url.mjs';
import { metadataArguments } from '../../apps/api/dist/features/youtube-ingestion/services/run-ytdlp.js';
import { downloaderExecutable, trackArguments, downloadArguments } from '../../apps/api/dist/features/youtube-ingestion/services/downloader-command.js';
import { verifyDownloader } from '../../apps/api/dist/features/youtube-ingestion/services/verify-downloader.js';
import { summarizeFormats } from '../../apps/api/dist/features/youtube-ingestion/utils/video-formats.js';
import { selectInput } from '../../apps/api/dist/features/youtube-ingestion/utils/select-input.js';
import { terminateProcessTree } from '../../apps/api/dist/features/pipeline/services/terminate-process-tree.js';

const id = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(id ?? '')) throw new Error('Informe o UUID da tentativa.');
const response = await fetch(`http://127.0.0.1:3001/ingestions/${id}`);
if (!response.ok) throw new Error(`Tentativa indisponível: HTTP ${response.status}`);
const original = await response.json();
const reference = parseYouTubeUrl(original.ingestion.video.url);
const root = resolve('apps/api/.data/youtube-diagnostics', `${new Date().toISOString().replace(/[:.]/g, '-')}-403`);
await mkdir(root, { recursive: true });
await writeFile(join(root, 'original-attempt.json'), JSON.stringify(original, null, 2));
const executable = downloaderExecutable();
await verifyDownloader(executable);
const args = metadataArguments(reference).filter(arg => arg !== '--quiet');
args.unshift('--verbose');
const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = ''; let stderr = ''; let failure;
const timer = setTimeout(() => { failure = 'Diagnóstico excedeu 120 segundos'; void terminateProcessTree(child); }, 120_000);
child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 2 * 1024 * 1024) { failure = 'Metadata excedeu 2 MiB'; void terminateProcessTree(child); } });
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-128 * 1024); });
child.on('error', error => { failure = error.message; });
const exitCode = await new Promise(resolve => child.on('close', resolve));
clearTimeout(timer);
const redact = value => value.replace(/https?:\/\/[^\s'"<>]+/g, '[URL omitida]');
const result = { originalAttemptId: id, url: reference.url, executable, metadataArguments: args,
  note: 'Consulta nova; não recupera a lista exata nem stderr descartado da tentativa original.', exitCode, failure, stderr: redact(stderr) };
if (exitCode === 0 && !failure) {
  const info = JSON.parse(stdout);
  result.metadata = { id: info.id, title: info.title, durationSeconds: info.duration, availability: info.availability,
    extractor: info.extractor, extractorKey: info.extractor_key };
  result.formats = summarizeFormats(info);
  try {
    const selected = selectInput(info);
    result.selection = selected.mode === 'separate' ? selected : { mode: selected.mode, extension: selected.extension, id: selected.format.format_id };
    result.transferArguments = selected.mode === 'separate' ? { video: trackArguments(reference, selected.video.id), audio: trackArguments(reference, selected.audio.id) }
      : { progressive: downloadArguments(reference, selected.extension) };
  } catch (error) { result.selectionError = error.message; }
}
await writeFile(join(root, 'fresh-format-query.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
console.log(`EVIDENCE ${root}`);
