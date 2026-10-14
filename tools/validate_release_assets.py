"""[Codex] Reject stale or mismatched release assets before publication."""
from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path, PurePosixPath

REPOSITORY = 'zayd-haque/canvas-offline-archive'
PACKAGE_ROOT = 'canvas-offline-archive'


def validate_package(path: Path, platform: str, tag: str, *, allow_preview: bool = False) -> dict:
    if not tag.strip():
        raise ValueError('Publishing requires an explicit release tag')
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate archive entries')
        for name in names:
            parts = PurePosixPath(name).parts
            if not parts or parts[0] != PACKAGE_ROOT or '..' in parts or '\\' in name:
                raise ValueError('Unsafe release archive path')
        prefix = PACKAGE_ROOT + '/'
        # [Codex] Both platforms retain compatibility with existing flat ZIPs.
        bootstrap = 'bootstrap.sh' if platform == 'macos' else 'bootstrap_windows.py'
        launcher_name = ('Open Canvas Offline Archive.command' if platform == 'macos'
                         else 'Open Canvas Offline Archive Windows.cmd')
        if prefix + 'App Files/' + bootstrap in names:
            if prefix + launcher_name not in names:
                raise ValueError('Double-click launcher is missing')
            for item in archive.infolist():
                if item.is_dir():
                    continue
                relative = item.filename[len(prefix):]
                if relative != launcher_name and not relative.startswith('App Files/'):
                    raise ValueError('Only the platform launcher may be outside App Files')
            launcher = archive.getinfo(prefix + launcher_name)
            if platform == 'macos' and not (launcher.external_attr >> 16) & 0o111:
                raise ValueError('Mac double-click launcher must be executable')
            if platform == 'windows' and prefix + 'App Files/bootstrap_windows.ps1' not in names:
                raise ValueError('Windows automatic Python setup is missing')
            prefix += 'App Files/'
        required = {'requirements.txt', 'release_updater.py', 'canvas_app/run.py',
                    'canvas_app/static/index.html', 'release_info.json'}
        required.add(bootstrap)
        if not all(prefix + name in names for name in required):
            raise ValueError('Release archive is incomplete')
        entry = archive.getinfo(prefix + 'release_info.json')
        if entry.file_size > 4096:
            raise ValueError('Release metadata exceeds size limit')
        metadata = json.loads(archive.read(entry))
        expected = {'repository': REPOSITORY, 'platform': platform, 'tag': tag}
        if not isinstance(metadata, dict) or any(metadata.get(k) != v for k, v in expected.items()):
            raise ValueError(f'Release metadata must match {REPOSITORY}, {platform}, {tag}')
        if metadata.get('preview') is True and not allow_preview:
            raise ValueError('Preview packages cannot be published as official releases')
        return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('assets', nargs='+', type=Path)
    args = parser.parse_args()
    for path in args.assets:
        platforms = {f'canvas-offline-archive-{p}.zip': p for p in ('macos', 'windows')}
        if path.name not in platforms:
            parser.error(f'Unexpected release asset name: {path.name}')
        try:
            validate_package(path, platforms[path.name], args.tag)
        except (OSError, ValueError, KeyError, zipfile.BadZipFile) as exc:
            parser.error(str(exc))
        print(f'Validated {path.name} for {args.tag}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
