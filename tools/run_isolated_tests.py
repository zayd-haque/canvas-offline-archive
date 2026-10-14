#!/usr/bin/env python3
"""[Codex] Run fixtures against source export, never local config or user archives."""
import argparse
import io
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seeds', nargs='+', default=['101', '202', '303', '404', '505'])
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='canvas-tests-') as temporary:
        checkout = Path(temporary) / 'source'
        checkout.mkdir()
        archive = subprocess.check_output(['git', 'archive', 'HEAD'], cwd=root)
        with tarfile.open(fileobj=io.BytesIO(archive)) as source:
            source.extractall(checkout, filter='data')
        # Overlay only changed tracked files and non-ignored new sources.
        changed = subprocess.check_output(['git', 'diff', '--name-only', 'HEAD', '-z'], cwd=root).decode().split('\0')
        new = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=root).decode().split('\0')
        for name in set(changed + new) - {''}:
            path, target = root / name, checkout / name
            if not path.exists():
                target.unlink(missing_ok=True)
                continue
            if path.is_symlink():
                raise ValueError('Do not export symlinks into fixture workspace')
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
        fixture_home = Path(temporary) / 'home'
        fixture_home.mkdir()
        env = os.environ.copy()
        node = env.get('NODE_BINARY') or shutil.which('node')
        bundled_node = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
        if not node and bundled_node.is_file():
            node = str(bundled_node)
        if node:
            env['NODE_BINARY'] = node
            env['PATH'] = str(Path(node).parent) + os.pathsep + env.get('PATH', '')
        for key in ('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'CANVAS_CACHE_DIR', 'JOURNAL_DIR', 'JOURNAL_SOURCE', 'CANVAS_OCR'):
            env.pop(key, None)
        env.update(HOME=str(fixture_home), TEST_VERBOSE_SEED='1')
        for seed in args.seeds:
            env['TEST_SEED'] = seed
            result = subprocess.run([sys.executable, '-m', 'unittest', 'discover', 'tests'], cwd=checkout, env=env)
            if result.returncode:
                return result.returncode
    return 0


if __name__ == '__main__':
    sys.exit(main())
