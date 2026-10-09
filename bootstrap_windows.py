"""[Codex] Set up and start the Windows source release with a private venv."""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import venv
from pathlib import Path
from release_updater import maybe_update, RecoveryError, recover_pending


ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
PYTHON = VENV / "Scripts" / "python.exe"


def _reject_link(path: Path, parser: argparse.ArgumentParser) -> None:
    """Fail before setup can follow a symlink or Windows junction."""
    is_junction = getattr(path, "is_junction", lambda: False)
    if path.is_symlink() or is_junction():
        parser.error(f"Refusing linked setup path: {path}")


def run(*args: str) -> None:
    subprocess.run(args, check=True, cwd=ROOT)


def _write_marker(marker: Path, digest: str) -> None:
    """[Codex] Replace the marker without following a pre-existing file link."""
    fd, temporary = tempfile.mkstemp(prefix=".deps-", dir=marker.parent)
    try:
        with os.fdopen(fd, "w") as output:
            output.write(digest)
        os.replace(temporary, marker)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--setup-only", action="store_true")
    parser.add_argument("--reinstall", action="store_true")
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("Use bootstrap.sh on macOS; this launcher is for Windows")
    if sys.version_info[:2] != (3, 14):
        parser.error("Python 3.14 is required for the hash-locked release")
    config = ROOT / "Canvas Module Downloader" / "config.json"
    _reject_link(VENV, parser)
    _reject_link(config.parent, parser)
    _reject_link(config, parser)
    recover_pending(ROOT)
    os.environ['PYTHONIOENCODING'] = 'utf-8'
    if args.reinstall and VENV.exists():
        shutil.rmtree(VENV)
    if not PYTHON.is_file():
        venv.create(VENV, with_pip=True)
    version = subprocess.check_output([str(PYTHON), "-c", "import sys; print(sys.version_info[:2])"], text=True).strip()
    if version != "(3, 14)":
        parser.error("Existing .venv uses another Python; run with --reinstall")
    lock = ROOT / 'requirements.txt'
    marker = VENV / '.deps_installed'
    digest = hashlib.sha256(lock.read_bytes()).hexdigest()
    needs_install = not marker.exists() or marker.read_text() != digest
    try:
        run(str(PYTHON), "-c", "import fastapi, uvicorn, pypdf, requests, playwright, pypdfium2; from winrt.windows.media.ocr import OcrEngine; from winrt.windows.graphics.imaging import SoftwareBitmap; from winrt.windows.storage.streams import DataWriter")
    except subprocess.CalledProcessError:
        needs_install = True
    if needs_install:
        run(str(PYTHON), "-m", "pip", "install", "--require-hashes", "-r", str(ROOT / "requirements.txt"))
        _write_marker(marker, digest)
    if not args.reinstall:
        try:
            print("Checking for Canvas Offline Archive updates...")
            if maybe_update(ROOT, "windows"):
                updated_digest = hashlib.sha256(lock.read_bytes()).hexdigest()
                if updated_digest != digest:
                    run(str(PYTHON), "-m", "pip", "install", "--require-hashes", "-r", str(lock))
                    _write_marker(marker, updated_digest)
        except (subprocess.CalledProcessError, RecoveryError):
            # [Codex] New source must not launch with a failed dependency upgrade.
            raise
        except Exception as exc:
            print(f"Update check skipped: {exc}. Starting the installed version.")
    try:
        run(str(PYTHON), "-c", "from playwright.sync_api import sync_playwright; p=sync_playwright().start(); b=p.chromium.launch(headless=True); b.close(); p.stop()")
    except subprocess.CalledProcessError:
        run(str(PYTHON), "-m", "playwright", "install", "chromium")
    example = ROOT / "Canvas Module Downloader" / "config.example.json"
    _reject_link(config.parent, parser)
    _reject_link(config, parser)
    if not config.exists():
        with example.open("rb") as source, config.open("xb") as target:
            shutil.copyfileobj(source, target)
    if not args.setup_only:
        run(str(PYTHON), str(ROOT / "canvas_app" / "run.py"))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"Setup or launch failed (exit code {exc.returncode}).", file=sys.stderr)
        raise SystemExit(exc.returncode)
