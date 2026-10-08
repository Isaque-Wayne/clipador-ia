import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { UPLOAD_MAX_FILE_BYTES, UPLOAD_QUOTA_BYTES, resolveUploadLimits } from "../../../config/upload-limits.mjs";
import { storagePolicy } from "../dist/features/uploads/config/storage-policy.js";
import { assertStorageQuota } from "../dist/features/uploads/services/storage-quota.js";

test("padrões de 4 GiB por arquivo e 16 GiB de quota comportam dois uploads máximos e JSON", () => {
  assert.equal(UPLOAD_MAX_FILE_BYTES, 4 * 1024 ** 3);
  assert.equal(UPLOAD_QUOTA_BYTES, 16 * 1024 ** 3);
  assert.equal(storagePolicy({}).quotaBytes, UPLOAD_QUOTA_BYTES);
  assert.doesNotThrow(() => assertStorageQuota(0, 2 * UPLOAD_MAX_FILE_BYTES + 2 * 4096, UPLOAD_QUOTA_BYTES));
});

test("limites de ambiente geram tamanho, quota e mensagens coerentes", () => {
  assert.deepEqual(resolveUploadLimits({ UPLOAD_MAX_FILE_BYTES: String(2 * 1024 ** 2), UPLOAD_QUOTA_BYTES: "1000" }),
    { maxFileBytes: 2 * 1024 ** 2, quotaBytes: 1000, maxFileLabel: "2 MiB",
      sizeError: "O vídeo deve ter no máximo 2 MiB." });
  assert.equal(resolveUploadLimits({ UPLOAD_MAX_FILE_BYTES: "123" }).maxFileLabel, "123 bytes");
});

test("variáveis inválidas falham sem enfraquecer os limites", () => {
  for (const name of ["UPLOAD_MAX_FILE_BYTES", "UPLOAD_QUOTA_BYTES"]) {
    for (const value of ["", "0", "-1", "1.5", "4 GiB", "9007199254740992"]) {
      assert.throws(() => resolveUploadLimits({ [name]: value }), new RegExp(name));
    }
  }
});

test("API aplica limite e quota configurados na inicialização", async () => {
  const validation = new URL("../dist/features/uploads/utils/validate-video.js", import.meta.url).href;
  const policy = new URL("../dist/features/uploads/config/storage-policy.js", import.meta.url).href;
  const code = `import assert from 'node:assert/strict';
    const validation = await import(${JSON.stringify(validation)});
    const { storagePolicy } = await import(${JSON.stringify(policy)});
    assert.equal(validation.MAX_VIDEO_BYTES, Number(process.env.UPLOAD_MAX_FILE_BYTES));
    assert.equal(storagePolicy({}).quotaBytes, Number(process.env.UPLOAD_QUOTA_BYTES));
    validation.validateVideoSize(validation.MAX_VIDEO_BYTES);
    assert.throws(() => validation.validateVideoSize(validation.MAX_VIDEO_BYTES + 1),
      { statusCode: 413, message: 'O vídeo deve ter no máximo 2 MiB.' });`;
  await promisify(execFile)(process.execPath, ["--input-type=module", "-e", code], {
    windowsHide: true,
    env: { ...process.env, UPLOAD_MAX_FILE_BYTES: String(2 * 1024 ** 2), UPLOAD_QUOTA_BYTES: String(8 * 1024 ** 2) },
  });
});
