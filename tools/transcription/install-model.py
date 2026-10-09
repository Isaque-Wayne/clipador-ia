"""Explicit setup command; never invoked by the backend."""
import hashlib
import importlib.metadata
import json
import platform
from pathlib import Path
from huggingface_hub import snapshot_download

root = Path(__file__).resolve().parent
revision = "536b0662742c02347bc0e980a01041f333bce120"
model = root / "models" / "small"
snapshot_download("Systran/faster-whisper-small", revision=revision, local_dir=str(model),
                  allow_patterns=["model.bin", "config.json", "tokenizer.json", "vocabulary.txt", "README.md"])
files = []
for name in ["model.bin", "config.json", "tokenizer.json", "vocabulary.txt", "README.md"]:
    path = model / name
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    files.append({"name": name, "bytes": path.stat().st_size, "sha256": digest.hexdigest()})
packages = []
for dist in importlib.metadata.distributions():
    packages.append({"name": dist.metadata["Name"], "version": dist.version,
        "license": dist.metadata.get("License-Expression") or dist.metadata.get("License"),
        "licenseClassifiers": [c for c in (dist.metadata.get_all("Classifier") or []) if c.startswith("License") ]})
manifest = {"python": {"version": platform.python_version(), "architecture": platform.machine(),
    "origin": "https://www.python.org/ftp/python/3.13.15/python-3.13.15-amd64.zip", "license": "PSF-2.0",
    "sha256": "6479223746cdfb79d25865110d6f524ac98de081324e119af1dc3ae36bddc7a5"},
    "engine": {"name": "faster-whisper", "version": importlib.metadata.version("faster-whisper"),
    "origin": "https://pypi.org/project/faster-whisper/1.2.1/", "license": "MIT", "device": "cpu", "computeType": "int8"},
    "model": {"name": "small", "multilingual": True, "origin": "https://huggingface.co/Systran/faster-whisper-small",
    "revision": revision, "license": "MIT", "bytes": sum(f["bytes"] for f in files), "files": files},
    "packages": sorted(packages, key=lambda p: p["name"].lower())}
(root / "installation.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps({"python": manifest["python"], "engine": manifest["engine"], "modelBytes": manifest["model"]["bytes"]}))
