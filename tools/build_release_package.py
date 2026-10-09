"""[Codex] Build a source-only macOS or Windows release package.

Only explicit application paths are eligible. Git supplies the file list so
ignored local configuration, sessions, course folders, and caches are never read.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = "canvas-offline-archive"
RELEASE_FILE_OVERRIDES = {"docs/SECURITY.md": ROOT / "SECURITY.md"}
ROOT_FILES = {
    "bootstrap.sh",
    "Open Canvas Offline Archive.command",
    "bootstrap_windows.py",
    "Open Canvas Offline Archive Windows.cmd",
    "requirements.txt",
    "release_updater.py",
}
DOC_FILES = {
    "docs/INSTALL.md",
    "docs/WINDOWS_INSTALL.md",
    "docs/SECURITY.md",
}
EXACT_FILES = {
    "Canvas Module Downloader/config.example.json",
    "canvas_app/browser_lifecycle.py",
    "canvas_app/native.py",
    "canvas_app/native_windows.py",
    "canvas_app/native_policy.py",
    "canvas_app/static/js/src/16_onboarding.js",
    "canvas_app/static/js/src/17_browser_lifecycle.js",
    "canvas_app/static/css/modules/14_onboarding.css",
}
APP_SUFFIXES = {".py", ".js", ".mjs", ".css", ".html", ".json", ".wasm", ".map", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".pfb", ".bcmap", ".properties", ".ftl", ".md", ".txt", ".swift", ".pdf"}


def allowed(relative: str) -> bool:
    path = PurePosixPath(relative)
    if ".." in path.parts or path.is_absolute():
        return False
    if relative in ROOT_FILES or relative in DOC_FILES or relative in EXACT_FILES:
        return True
    if path.parts[0] == "canvas_app":
        return path.suffix.lower() in APP_SUFFIXES or path.name.startswith("LICENSE")
    if path.parts[0] == "Canvas Module Downloader":
        return len(path.parts) == 2 and path.suffix == ".py"
    return False


def package_files() -> list[tuple[str, Path]]:
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
    names = {name for name in tracked if name and allowed(name)} | ROOT_FILES | DOC_FILES | EXACT_FILES
    files = []
    for name in sorted(names):
        source = RELEASE_FILE_OVERRIDES.get(name, ROOT / name)
        if not source.is_file() or source.is_symlink() or not source.resolve().is_relative_to(ROOT):
            raise ValueError(f"Required package file is missing or unsafe: {name}")
        files.append((name, source))
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="ZIP path outside the repository")
    parser.add_argument("--platform", choices=("macos", "windows"), default="macos")
    parser.add_argument("--tag", default="", help="GitHub release tag when publishing this package")
    args = parser.parse_args()
    output = Path(os.path.abspath(args.output.expanduser()))
    if output.resolve().is_relative_to(ROOT):
        parser.error("Output must be outside the repository, away from local application data")
    if output.exists() or output.is_symlink():
        parser.error("Output already exists; choose a new ZIP path")
    output.parent.mkdir(parents=True, exist_ok=True)
    files = package_files()
    platform_excludes = ({"bootstrap.sh", "Open Canvas Offline Archive.command"}
                         if args.platform == "windows" else
                         {"bootstrap_windows.py", "Open Canvas Offline Archive Windows.cmd"})
    files = [(name, source) for name, source in files if name not in platform_excludes]
    # [Codex] Build privately, then publish without replacing an existing file
    # or following an output symlink, including one created during the build.
    fd, temporary = tempfile.mkstemp(prefix='.canvas-release-', dir=output.parent)
    try:
        with os.fdopen(fd, 'w+b') as stream:
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for name, source in files:
                    info = zipfile.ZipInfo(f"{PACKAGE_ROOT}/{name}", date_time=(2026, 10, 3, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = (0o755 if name in {"bootstrap.sh", "Open Canvas Offline Archive.command"} else 0o644) << 16
                    archive.writestr(info, source.read_bytes())
                release_info = {
                    "repository": "zayd-haque/canvas-offline-archive",
                    "platform": args.platform,
                    "tag": args.tag,
                    "built_at": datetime.now(timezone.utc).isoformat(),
                }
                archive.writestr(f"{PACKAGE_ROOT}/release_info.json", json.dumps(release_info, sort_keys=True))
            stream.flush()
            os.fsync(stream.fileno())
        if args.tag:
            try:
                from .validate_release_assets import validate_package
            except ImportError:
                from validate_release_assets import validate_package
            validate_package(Path(temporary), args.platform, args.tag)
        os.link(temporary, output)
    finally:
        os.unlink(temporary)
    print(f"Created {output} with {len(files)} source files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
