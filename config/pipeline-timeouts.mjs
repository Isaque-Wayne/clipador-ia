// Independent stage budgets. Request deadlines only bound starting/querying a job.
export const PIPELINE_TIMEOUT_DEFAULTS = Object.freeze({
  metadata: 120_000,
  download: 3_600_000,
  ffmpeg: 1_200_000,
  ffprobe: 120_000,
  transcription: 3_600_000,
  analysis: 900_000,
  render: 3_600_000,
  renderClip: 300_000,
  preparation: 1_200_000,
  storage: 300_000,
  upload: 1_800_000,
  request: 15_000,
});
const variables = {
  metadata: "METADATA_TIMEOUT_MS", download: "DOWNLOAD_TIMEOUT_MS",
  ffmpeg: "FFMPEG_TIMEOUT_MS", ffprobe: "FFPROBE_TIMEOUT_MS",
  transcription: "TRANSCRIPTION_TIMEOUT_MS", analysis: "ANALYSIS_TIMEOUT_MS",
  render: "RENDER_TIMEOUT_MS", renderClip: "RENDER_CLIP_TIMEOUT_MS",
  preparation: "VIDEO_PREPARATION_TIMEOUT_MS", storage: "STORAGE_TIMEOUT_MS",
  upload: "UPLOAD_TIMEOUT_MS", request: "API_REQUEST_TIMEOUT_MS",
};
export function resolvePipelineTimeouts(environment = process.env) {
  return Object.fromEntries(Object.entries(PIPELINE_TIMEOUT_DEFAULTS).map(([stage, fallback]) => {
    const variable = variables[stage], raw = environment[variable];
    const value = raw === undefined ? fallback : Number(raw);
    if (raw !== undefined && !/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
      throw new Error(`${variable} deve ser um inteiro positivo de até 2147483647 ms.`);
    return [stage, value];
  }));
}
