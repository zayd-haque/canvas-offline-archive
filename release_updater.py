"""[Codex] Check official platform releases before launching the local app.

Only a published, SHA-256-digested GitHub release asset may replace packaged
application files. Private configuration, course archives, and .venv are never
part of the update set. Network failure leaves the installed app usable.
"""

from __future__ import annotations

import argparse
import contextlib
import stat
import hashlib
import json
import os
import re
import shutil
import socket
import ssl
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parent
REPO = "zayd-haque/canvas-offline-archive"
API = f"https://api.github.com/repos/{REPO}/releases/latest"
PACKAGE_ROOT = "canvas-offline-archive"
ASSET_NAMES = {
    "windows": "canvas-offline-archive-windows.zip",
    "macos": "canvas-offline-archive-macos.zip",
}
MAX_DOWNLOAD = 80 * 1024 * 1024
MAX_EXTRACTED = 250 * 1024 * 1024
ROOT_FILES = {
    "bootstrap.sh", "bootstrap_windows.py", "release_updater.py",
    "Open Canvas Offline Archive.command", "Open Canvas Offline Archive Windows.cmd",
    "requirements.txt", "INSTALL.md", "WINDOWS_INSTALL.md", "SECURITY.md",
    "docs/INSTALL.md", "docs/WINDOWS_INSTALL.md", "docs/SECURITY.md",
    "release_info.json",
}


def _tls_context(root: Path = ROOT) -> ssl.SSLContext:
    """Use the hash-locked certifi bundle when the app venv is installed."""
    site_packages = root / ".venv" / ("Lib" if os.name == "nt" else "lib")
    candidates = (site_packages.glob("site-packages/certifi/cacert.pem") if os.name == "nt"
                  else site_packages.glob("python*/site-packages/certifi/cacert.pem"))
    bundle = next((path for path in candidates if path.is_file()), None)
    return ssl.create_default_context(cafile=str(bundle) if bundle else None)


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _request_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "CanvasOfflineArchive-Updater"})
    with urllib.request.urlopen(request, timeout=5, context=_tls_context()) as response:
        return json.load(response)


def _asset_path(name: str) -> str:
    if "\\" in name or ":" in name or "\x00" in name:
        raise ValueError("Update archive contains an unsafe Windows path")
    path = PurePosixPath(name)
    for part in path.parts:
        if part.endswith((".", " ")) or re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", part):
            raise ValueError("Update archive contains an unsafe Windows component")
    if not name.startswith(PACKAGE_ROOT + "/") or path.is_absolute() or ".." in path.parts:
        raise ValueError("Update archive contains an unsafe path")
    relative = str(PurePosixPath(*path.parts[1:]))
    parts = PurePosixPath(relative).parts
    if relative in ROOT_FILES:
        return relative
    if len(parts) >= 2 and parts[0] == "canvas_app" and (PurePosixPath(relative).suffix.lower() in {
        ".py", ".js", ".mjs", ".css", ".html", ".json", ".wasm", ".map", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".pfb", ".bcmap", ".properties", ".ftl", ".md", ".txt", ".swift", ".pdf"
    } or PurePosixPath(relative).name.startswith("LICENSE")):
        return relative
    if len(parts) == 2 and parts[0] == "Canvas Module Downloader" and (parts[1].endswith(".py") or parts[1] == "config.example.json"):
        return relative
    raise ValueError(f"Update archive contains an unexpected file: {relative}")


def _safe_target(root: Path, relative: str) -> Path:
    if root.is_symlink() or getattr(root, "is_junction", lambda: False)():
        raise ValueError("Refusing linked application directory")
    current = root
    for component in PurePosixPath(relative).parts:
        current = current / component
        if current.is_symlink() or getattr(current, "is_junction", lambda: False)():
            raise ValueError(f"Refusing linked update path: {relative}")
    return current


def _download(url: str, destination: Path, expected_digest: str) -> None:
    if not url.startswith(f"https://github.com/{REPO}/releases/download/"):
        raise ValueError("Release asset URL is outside the official repository")
    digest = hashlib.sha256()
    size = 0
    request = urllib.request.Request(url, headers={"User-Agent": "CanvasOfflineArchive-Updater"})
    with urllib.request.urlopen(request, timeout=15, context=_tls_context()) as response, destination.open("wb") as output:
        while block := response.read(1024 * 1024):
            size += len(block)
            if size > MAX_DOWNLOAD:
                raise ValueError("Release download exceeds size limit")
            digest.update(block)
            output.write(block)
    if digest.hexdigest() != expected_digest:
        raise ValueError("Release SHA-256 does not match GitHub's published digest")


def _publish(root: Path, relative: str, source: Path) -> None:
    """[Codex] Publish through an exclusively created sibling; never truncate links."""
    target = _safe_target(root, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".canvas-update-", dir=target.parent)
    replacement = Path(temporary)
    try:
        with os.fdopen(fd, "wb") as output, source.open("rb") as input_file:
            shutil.copyfileobj(input_file, output)
            output.flush()
            os.fsync(output.fileno())
        shutil.copymode(source, replacement)
        _safe_target(root, relative)
        os.replace(replacement, target)
    finally:
        replacement.unlink(missing_ok=True)


@contextlib.contextmanager
def _update_lock(root: Path):
    """[Codex] Kernel-held lock; a stopped process cannot leave a stale lock."""
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        lock = _safe_target(root, ".canvas-update.lock")
        fd = os.open(lock, flags, 0o600)
    except (OSError, ValueError) as exc:
        raise RecoveryError("Cannot safely lock updater; app launch blocked: " + str(exc)) from exc
    acquired = False
    try:
        info = os.fstat(fd)
        current = lock.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                or (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino)
                or lock.is_symlink() or getattr(lock, "is_junction", lambda: False)()):
            raise RecoveryError("Refusing unsafe updater lock file")
        if os.name == "nt":
            import msvcrt
            if info.st_size == 0:
                os.write(fd, b"0")
            os.lseek(fd, 0, os.SEEK_SET)
            try:
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise RecoveryError("Another launcher is updating or recovering the app; retry when it finishes") from exc
        else:
            import fcntl
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise RecoveryError("Another launcher is updating or recovering the app; retry when it finishes") from exc
        acquired = True
        yield
    finally:
        if acquired:
            if os.name == "nt":
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def _install_archive(root: Path, archive: Path, platform: str, tag: str) -> None:
    with _update_lock(root):
        _recover_pending_unlocked(root)
        _install_archive_unlocked(root, archive, platform, tag)


def _install_archive_unlocked(root: Path, archive: Path, platform: str, tag: str) -> None:
    with zipfile.ZipFile(archive) as zipped:
        entries = {}
        folded = set()
        total = 0
        for item in zipped.infolist():
            if item.is_dir():
                continue
            relative = _asset_path(item.filename)
            if relative.casefold() in folded or item.external_attr >> 16 & 0o170000 == 0o120000:
                raise ValueError("Update archive contains duplicate or linked files")
            total += item.file_size
            if total > MAX_EXTRACTED:
                raise ValueError("Release archive exceeds extracted size limit")
            folded.add(relative.casefold())
            entries[relative] = item
        if not {"requirements.txt", "release_updater.py", "canvas_app/run.py", "canvas_app/static/index.html"}.issubset(entries):
            raise ValueError("Release archive is incomplete")
        if platform == "windows" and "bootstrap_windows.py" not in entries:
            raise ValueError("Windows launcher is missing")
        if platform == "macos" and "bootstrap.sh" not in entries:
            raise ValueError("Mac launcher is missing")
        info = json.loads(zipped.read(entries["release_info.json"]))
        if info.get("platform") != platform or info.get("tag") != tag or info.get("repository") != REPO:
            raise ValueError("Release metadata does not match the selected platform and tag")
        targets = {name: _safe_target(root, name) for name in entries}
        with tempfile.TemporaryDirectory(prefix="canvas-update-") as temporary:
            stage = Path(temporary)
            backups = stage / "backups"
            payload = stage / "payload"
            for relative, item in entries.items():
                staged = payload / relative
                staged.parent.mkdir(parents=True, exist_ok=True)
                with zipped.open(item) as source, staged.open("wb") as output:
                    shutil.copyfileobj(source, output)
                if os.name != "nt":
                    mode = (item.external_attr >> 16) & 0o777
                    if mode:
                        staged.chmod(mode)
            for relative, target in targets.items():
                if target.exists():
                    backup = backups / relative
                    backup.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(target, backup)
            # [Codex] Persist every original before the first application write.
            recovery = Path(tempfile.mkdtemp(prefix=".canvas-recovery-", dir=root))
            originals = recovery / "originals"
            originals.mkdir()
            present = []
            for relative, target in targets.items():
                if target.exists():
                    saved = originals / relative
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    with target.open("rb") as source, saved.open("xb") as output:
                        shutil.copyfileobj(source, output)
                        output.flush()
                        os.fsync(output.fileno())
                    shutil.copymode(target, saved)
                    present.append(relative)
            manifest = {"files": list(targets), "present": present}
            marker = recovery / "pending.json"
            with marker.open("x", encoding="utf-8") as output:
                json.dump(manifest, output)
                output.flush()
                os.fsync(output.fileno())
            try:
                for relative, target in targets.items():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    _publish(root, relative, payload / relative)
                os.replace(marker, recovery / "completed.json")
            except Exception:
                _recover_transaction(root, recovery)
                raise


class RecoveryError(RuntimeError):
    """An incomplete update could not be recovered; launching is unsafe."""


def _recover_transaction(root: Path, recovery: Path) -> None:
    try:
        _safe_target(root, recovery.name)
        marker = _safe_target(root, recovery.name + "/pending.json")
        if not marker.exists():
            return
        if marker.stat().st_size > 1024 * 1024:
            raise ValueError("Recovery manifest exceeds limit")
        manifest = json.loads(marker.read_text(encoding="utf-8"))
        files = manifest["files"]
        present = set(manifest["present"])
        if not isinstance(files, list) or len(files) > 10000 or not present.issubset(files):
            raise ValueError("Invalid recovery manifest")
        # Preserve interrupted replacements or subsequent manual edits as well.
        preserved = Path(tempfile.mkdtemp(prefix="interrupted-", dir=recovery))
        for relative in reversed(files):
            if _asset_path(PACKAGE_ROOT + "/" + relative) != relative:
                raise ValueError("Invalid recovery path")
            target = _safe_target(root, relative)
            if target.exists():
                saved = preserved / relative
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, saved)
            if relative in present:
                original = _safe_target(root, recovery.name + "/originals/" + relative)
                if not original.is_file():
                    raise ValueError("Recovery original missing")
                _publish(root, relative, original)
            else:
                target.unlink(missing_ok=True)
        os.replace(marker, recovery / "recovered.json")
        print("Recovered an interrupted update; original and interrupted files are preserved in " + recovery.name)
    except Exception as exc:
        raise RecoveryError("Interrupted update recovery failed; app launch blocked: " + str(exc)) from exc


def recover_pending(root: Path) -> None:
    """[Codex] Restore incomplete updates before deciding whether to update again."""
    with _update_lock(root):
        _recover_pending_unlocked(root)


def _recover_pending_unlocked(root: Path) -> None:
    recoveries = list(root.glob(".canvas-recovery-*"))
    if any((recovery / "pending.json").exists() for recovery in recoveries):
        try:
            with socket.create_connection(("127.0.0.1", 8000), timeout=0.2):
                raise RecoveryError("Stop the running app before recovering its interrupted update")
        except OSError:
            pass
    for recovery in recoveries:
        _recover_transaction(root, recovery)


def maybe_update(root: Path, platform: str) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 8000), timeout=0.2):
            print("An app is already listening on port 8000; skipping file updates until it stops.")
            return False
    except OSError:
        pass
    recover_pending(root)
    if os.environ.get("CANVAS_OFFLINE_NO_UPDATE") == "1" or (root / ".git").exists():
        return False
    installed = _read_json(root / "release_info.json")
    latest = _request_json(API)
    tag = latest.get("tag_name")
    published = latest.get("published_at")
    if not isinstance(tag, str) or not tag or not isinstance(published, str):
        return False
    if installed.get("tag") == tag:
        return False
    if not installed.get("tag"):
        built = installed.get("built_at")
        if isinstance(built, str) and datetime.fromisoformat(published.replace("Z", "+00:00")) <= datetime.fromisoformat(built.replace("Z", "+00:00")):
            return False
    asset = next((item for item in latest.get("assets", []) if item.get("name") == ASSET_NAMES[platform]), None)
    if not asset:
        return False
    digest = asset.get("digest", "")
    if not isinstance(digest, str) or not digest.startswith("sha256:") or len(digest) != 71:
        print("Update available, but GitHub did not provide a SHA-256 digest; keeping this installation.")
        return False
    with tempfile.TemporaryDirectory(prefix="canvas-download-") as temporary:
        archive = Path(temporary) / ASSET_NAMES[platform]
        _download(asset["browser_download_url"], archive, digest[7:])
        _install_archive(root, archive, platform, tag)
    print(f"Updated Canvas Offline Archive to {tag}.")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=tuple(ASSET_NAMES), required=True)
    parser.add_argument("--recover-only", action="store_true")
    args = parser.parse_args()
    print("Checking for Canvas Offline Archive updates...")
    try:
        if args.recover_only:
            recover_pending(ROOT)
        else:
            maybe_update(ROOT, args.platform)
    except RecoveryError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, urllib.error.URLError) as exc:
        print(f"Update check skipped: {exc}. Starting the installed version.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
