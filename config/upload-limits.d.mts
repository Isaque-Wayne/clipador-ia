export const UPLOAD_MAX_FILE_BYTES: number;
export const UPLOAD_QUOTA_BYTES: number;
export function resolveUploadLimits(environment?: Readonly<Record<string, string | undefined>>): {
  maxFileBytes: number;
  quotaBytes: number;
  maxFileLabel: string;
  sizeError: string;
};
