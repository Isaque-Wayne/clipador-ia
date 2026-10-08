import assert from "node:assert/strict";
import test from "node:test";
import { UPLOAD_MAX_FILE_BYTES, resolveUploadLimits } from "../../../config/upload-limits.mjs";
import { validateVideo, MAX_VIDEO_BYTES } from "../src/features/video-upload/utils/validate-video.ts";
import nextConfig from "../next.config.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const { sizeError: UPLOAD_SIZE_ERROR } = resolveUploadLimits();
// Apenas o contrato consultado pelo validador: não alocar um File de 4 GiB no teste.
const video = (size: number) => ({ name: "video.mp4", type: "video/mp4", size }) as File;

test("web e proxy usam o limite central de 4 GiB", () => {
  assert.equal(MAX_VIDEO_BYTES, UPLOAD_MAX_FILE_BYTES);
  assert.equal(nextConfig.experimental?.proxyClientMaxBodySize, UPLOAD_MAX_FILE_BYTES);
  assert.equal(nextConfig.env?.["NEXT_PUBLIC_UPLOAD_MAX_FILE_BYTES"], String(UPLOAD_MAX_FILE_BYTES));
  assert.equal(validateVideo(video(UPLOAD_MAX_FILE_BYTES)), null);
  assert.equal(validateVideo(video(UPLOAD_MAX_FILE_BYTES + 1)), UPLOAD_SIZE_ERROR);
  assert.equal(validateVideo(video(0)), "O vídeo está vazio.");
});

test("configuração do Next expõe ao navegador o mesmo limite configurado para o proxy", async () => {
  const config = new URL("../next.config.ts", import.meta.url).href;
  const validation = new URL("../src/features/video-upload/utils/validate-video.ts", import.meta.url).href;
  const code = `import assert from 'node:assert/strict';
    const { default: config } = await import(${JSON.stringify(config)});
    assert.equal(config.experimental.proxyClientMaxBodySize, Number(process.env.UPLOAD_MAX_FILE_BYTES));
    process.env.NEXT_PUBLIC_UPLOAD_MAX_FILE_BYTES = config.env.NEXT_PUBLIC_UPLOAD_MAX_FILE_BYTES;
    const validation = await import(${JSON.stringify(validation)});
    assert.equal(validation.MAX_VIDEO_BYTES, config.experimental.proxyClientMaxBodySize);
    assert.equal(validation.UPLOAD_MAX_FILE_LABEL, '2 MiB');
    assert.equal(validation.validateVideo({ name: 'video.mp4', type: 'video/mp4', size: validation.MAX_VIDEO_BYTES }), null);
    assert.equal(validation.validateVideo({ name: 'video.mp4', type: 'video/mp4', size: validation.MAX_VIDEO_BYTES + 1 }),
      'O vídeo deve ter no máximo 2 MiB.');`;
  await promisify(execFile)(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code], {
    windowsHide: true,
    env: { ...process.env, UPLOAD_MAX_FILE_BYTES: String(2 * 1024 ** 2) },
  });
});
