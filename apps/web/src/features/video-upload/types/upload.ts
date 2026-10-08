export interface UploadSuccess {
  success: true;
  message: string;
  file: { name: string; size: number; type: string };
  id: string;
  status: "uploaded";
  nextStep: "processing";
  createdAt: string;
  checksum: { algorithm: "sha256"; value: string };
}

export type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "error"; message: string }
  | { status: "success"; result: UploadSuccess };
