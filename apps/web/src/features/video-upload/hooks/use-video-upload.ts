"use client";

import { useRef, useState } from "react";
import { uploadVideo } from "../services/upload-video";
import type { UploadState } from "../types/upload";
import { validateVideo } from "../utils/validate-video";

export function useVideoUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const sending = useRef(false);

  function selectFile(selected: File | null): void {
    if (sending.current) return;
    const error = selected ? validateVideo(selected) : null;
    setFile(error ? null : selected);
    setState(error ? { status: "error", message: error } : { status: "idle" });
  }

  async function submit(): Promise<void> {
    if (sending.current) return;
    if (!file) {
      setState({ status: "error", message: "Selecione um vídeo antes de enviar." });
      return;
    }
    const error = validateVideo(file);
    if (error) {
      setState({ status: "error", message: error });
      return;
    }
    sending.current = true;
    setState({ status: "uploading" });
    try {
      setState({ status: "success", result: await uploadVideo(file) });
    } catch (error: unknown) {
      setState({ status: "error", message: error instanceof Error ? error.message : "Erro ao enviar o vídeo." });
    } finally {
      sending.current = false;
    }
  }

  return { file, state, selectFile, submit };
}
