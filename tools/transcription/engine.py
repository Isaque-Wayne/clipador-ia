"""Single local ASR entrypoint. JSON goes to stdout; diagnostics to stderr."""
import argparse
import json
import os
import sys
import time
import ctypes
from pathlib import Path

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
sys.stdout.reconfigure(encoding="utf-8", errors="strict")
sys.stderr.reconfigure(encoding="utf-8", errors="strict")

def main():
    started = time.perf_counter()
    cpu_started = time.process_time()
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    audio = Path(args.audio).resolve(strict=True)
    model_path = Path(args.model).resolve(strict=True)
    if not audio.is_file() or not model_path.is_dir():
        raise ValueError("Controlled audio/model paths are invalid")
    from faster_whisper import WhisperModel
    model = WhisperModel(str(model_path), device="cpu", compute_type="int8",
                         cpu_threads=min(4, os.cpu_count() or 1), num_workers=1, local_files_only=True)
    segments, info = model.transcribe(str(audio), beam_size=5, word_timestamps=True, vad_filter=True)
    result = {"language": info.language, "languageProbability": info.language_probability,
              "duration": info.duration, "segments": []}
    for segment in segments:
        result["segments"].append({"id": segment.id, "start": segment.start, "end": segment.end,
            "text": segment.text, "words": [{"word": word.word, "start": word.start,
            "end": word.end, "probability": word.probability} for word in (segment.words or [])]})
        print("CLIPADOR_PROGRESS " + json.dumps({"segmentsProcessed": len(result["segments"]),
              "processedThroughSeconds": segment.end}, allow_nan=False), file=sys.stderr, flush=True)
    peak_bytes = None
    if os.name == "nt":
        class MemoryCounters(ctypes.Structure):
            _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong)] + [
                (name, ctypes.c_size_t) for name in ["PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage"]]
        counters = MemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        get_current = ctypes.windll.kernel32.GetCurrentProcess
        get_current.restype = ctypes.c_void_p
        get_memory = ctypes.windll.psapi.GetProcessMemoryInfo
        get_memory.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
        if get_memory(get_current(), ctypes.byref(counters), counters.cb):
            peak_bytes = counters.PeakWorkingSetSize
    result["metrics"] = {"engineSeconds": time.perf_counter() - started,
        "cpuSeconds": time.process_time() - cpu_started, "peakWorkingSetBytes": peak_bytes}
    print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
