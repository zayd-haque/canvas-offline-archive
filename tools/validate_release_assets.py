"""[Codex] Reject stale or mismatched release assets before publication."""
from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path, PurePosixPath

REPOSITORY = 'zayd-haque/canvas-offline-archive'
PACKAGE_ROOT = 'canvas-offline-archive'


def validate_package(path: Path, platform: str, tag: str) -> dict:
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
        required = {'requirements.txt', 'release_updater.py', 'canvas_app/run.py',
                    'canvas_app/static/index.html', 'release_info.json'}
        required.add('bootstrap_windows.py' if platform == 'windows' else 'bootstrap.sh')
        if not all(prefix + name in names for name in required):
            raise ValueError('Release archive is incomplete')
        entry = archive.getinfo(prefix + 'release_info.json')
        if entry.file_size > 4096:
            raise ValueError('Release metadata exceeds size limit')
        metadata = json.loads(archive.read(entry))
        expected = {'repository': REPOSITORY, 'platform': platform, 'tag': tag}
        if not isinstance(metadata, dict) or any(metadata.get(k) != v for k, v in expected.items()):
            raise ValueError(f'Release metadata must match {REPOSITORY}, {platform}, {tag}')
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
