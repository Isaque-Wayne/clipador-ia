import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPendingVideoJob } from "../dist/jobs/video-job.js";
import { prepareVideoProcessing } from "../dist/processors/video-processor.js";

test("job referencia upload e permanece pendente sem processamento", () => {
  const uploadId = randomUUID();
  const job = createPendingVideoJob(uploadId);
  assert.equal(job.uploadId, uploadId);
  assert.equal(job.status, "pending");
  assert.equal(job.kind, "process-video");
  assert.notEqual(job.id, createPendingVideoJob(uploadId).id);
  assert.ok(Number.isFinite(Date.parse(job.createdAt)));
  const result = prepareVideoProcessing(job);
  assert.equal(result.processingEnabled, false);
  assert.deepEqual(result.job, job);
  assert.equal(job.status, "pending");
  assert.throws(() => createPendingVideoJob("../../video.mp4"), /inválido/);
});
