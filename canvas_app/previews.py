"""Private, content-versioned Quick Look previews with atomic publication."""
import atexit
import hashlib
import os
import shutil
import subprocess
import tempfile
import threading
import time
import sys
from pathlib import Path

try:
    from .archive import signature
except ImportError:
    from archive import signature

# Per-server private directory: no shared /tmp symlink or cross-user cache risks.
PREVIEW_CACHE_DIR = Path(tempfile.mkdtemp(prefix='canvas-previews-'))
atexit.register(shutil.rmtree, PREVIEW_CACHE_DIR, ignore_errors=True)
_LOCK = threading.Lock()
MAX_CACHE_BYTES = 512 * 1024 * 1024


def prune():
    total = 0
    for entry in sorted(PREVIEW_CACHE_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not entry.is_dir() or entry.is_symlink():
            continue
        size = sum(p.stat().st_size for p in entry.rglob('*') if p.is_file() and not p.is_symlink())
        total += size
        if total > MAX_CACHE_BYTES or time.time() - entry.stat().st_mtime > 86400:
            shutil.rmtree(entry, ignore_errors=True)


def generate_document_preview(target_file):
    if sys.platform != 'darwin':
        return None
    try:
        initial = signature(target_file)
        if initial[2] > 128 * 1024 * 1024:
            return None
        key = hashlib.sha256((str(target_file) + repr(initial)).encode()).hexdigest()
        destination = PREVIEW_CACHE_DIR / key
        # [Codex] Completed previews do not queue behind unrelated native work.
        # Revalidate the source after checking the entry: its version may have
        # changed since the initial stat used to derive this cache key.
        def cached_preview():
            if (destination / 'Preview.html').is_file() and signature(target_file) == initial:
                return f'/api/preview-cache/{key}/Preview.html'
            return None

        cached = cached_preview()
        if cached:
            return cached
        # Bound simultaneous native work and the waiting request queue.
        if not _LOCK.acquire(timeout=1):
            return None
        try:
            cached = cached_preview()
            if cached:
                return cached
            prune()
            deadline = time.monotonic() + 30
            with tempfile.TemporaryDirectory(dir=PREVIEW_CACHE_DIR, prefix='work-') as work:
                subprocess.run(['qlmanage', '-p', '-o', work, str(target_file)],
                               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
                candidates = list(Path(work).glob('*.qlpreview'))
                if not candidates:
                    return None
                output = candidates[0]
                page = output / 'Preview.html'
                if not page.is_file() or any(p.is_symlink() for p in output.rglob('*')):
                    return None
                assets = list(output.rglob('*'))
                if sum(p.stat().st_size for p in assets if p.is_file()) > MAX_CACHE_BYTES:
                    return None
                content = page.read_text(encoding='utf-8', errors='replace')
                for pdf in list(output.glob('*.pdf'))[:50]:
                    if time.monotonic() >= deadline:
                        break
                    png = pdf.with_suffix('.png')
                    result = subprocess.run(['sips', '-s', 'format', 'png', str(pdf), '--out', str(png)],
                                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=max(0.1, min(5, deadline - time.monotonic())))
                    if result.returncode == 0 and png.exists():
                        content = content.replace(f'src="{pdf.name}"', f'src="{png.name}"')
                slide_center_style = (
                    '<style id="canvas-slide-center-style">'
                    'html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; min-height: 100% !important; background: #525659 !important; }'
                    'body { display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: flex-start !important; padding: 24px 0 !important; box-sizing: border-box !important; }'
                    'div.slide, div.loading-slide { margin-left: auto !important; margin-right: auto !important; margin-top: 20px !important; margin-bottom: 20px !important; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4) !important; flex-shrink: 0 !important; }'
                    'div.slide:first-of-type { margin-top: 0 !important; }'
                    '</style>'
                )
                if '</head>' in content:
                    content = content.replace('</head>', f'{slide_center_style}</head>', 1)
                else:
                    content = slide_center_style + content
                page.write_text(content, encoding='utf-8')
                if signature(target_file) != initial:
                    return None
                os.replace(output, destination)
            return f'/api/preview-cache/{key}/Preview.html'
        finally:
            _LOCK.release()
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
