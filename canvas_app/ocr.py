"""[Codex] Local macOS/Windows OCR. Never downloads models or modifies PDFs."""
import hashlib
import json
import os
import shutil
import sqlite3
from contextlib import closing
import subprocess
import sys
import tempfile
import threading
import time
from functools import lru_cache
from pathlib import Path

try:
    from .cache import ensure_private_directory, validate_cache_database
except ImportError:
    from cache import ensure_private_directory, validate_cache_database

MAX_OCR_PAGES = 100
OCR_TIMEOUT = 90
_COMPILE_LOCK = threading.Lock()
_compile_error = None
_retry_after = 0


def enabled():
    return os.environ.get('CANVAS_OCR', '1').lower() not in {'0', 'false', 'off'}


def _binary():
    source = Path(__file__).with_suffix('.swift')
    digest = hashlib.sha256(source.read_bytes()).hexdigest()[:20]
    cache = Path(os.environ.get('CANVAS_CACHE_DIR', Path.home() / '.canvas_search_cache')) / 'ocr'
    return source, cache / f'vision-{digest}'


@lru_cache(maxsize=1)
def _windows_available():
    try:
        import pypdfium2  # noqa: F401 - confirms the local PDF renderer is installed
        from winrt.windows.media.ocr import OcrEngine
        from winrt.windows.graphics.imaging import SoftwareBitmap  # noqa: F401
        from winrt.windows.storage.streams import DataWriter  # noqa: F401
        return OcrEngine.try_create_from_user_profile_languages() is not None
    except Exception:
        return False


def _engine_version():
    return 'windows-ocr-v1' if sys.platform == 'win32' else 'vision-v2'


def capability():
    if sys.platform == 'win32':
        available = _windows_available()
        return {'engine': 'windows-ocr', 'enabled': enabled(), 'available': available,
                'ready': available, 'last_error': None if available else 'OCR language or runtime unavailable',
                'max_pages_per_document': MAX_OCR_PAGES}
    source, binary = _binary()
    available = sys.platform == 'darwin' and (binary.is_file() or shutil.which('swiftc') is not None)
    return {'engine': 'apple-vision', 'enabled': enabled(), 'available': available,
            'ready': binary.is_file(), 'last_error': _compile_error,
            'max_pages_per_document': MAX_OCR_PAGES}


def cache_version():
    # Existing PDF entries are revisited when OCR support is enabled or installed.
    info = capability()
    return f"{_engine_version()}:{int(info['enabled'])}:{int(info['available'])}"


def _ensure_binary():
    global _compile_error, _retry_after
    source, binary = _binary()
    with _COMPILE_LOCK:
        ensure_private_directory(binary.parent.parent)
        ensure_private_directory(binary.parent)
        if binary.is_symlink():
            raise PermissionError('OCR executable must not be a symbolic link')
        if binary.is_file():
            if binary.stat().st_uid != os.getuid():
                raise PermissionError('OCR executable must belong to the current user')
            return binary
        if time.monotonic() < _retry_after:
            raise RuntimeError('OCR compiler unavailable; retry deferred')
        try:
            with tempfile.TemporaryDirectory(dir=binary.parent, prefix='build-') as work:
                output = Path(work) / 'vision-ocr'
                subprocess.run([shutil.which('swiftc') or 'swiftc', '-O', str(source), '-o', str(output),
                                '-module-cache-path', str(Path(work) / 'modules')],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               timeout=90, check=True)
                os.replace(output, binary)
            _compile_error = None
            return binary
        except (OSError, subprocess.SubprocessError) as exc:
            _compile_error = type(exc).__name__
            _retry_after = time.monotonic() + 300
            raise


class BatchPages(dict):
    """Only emitted records prove a page was processed by the native helper."""
    def __init__(self):
        super().__init__()
        self.attempted = set()


def _recognize_batch(path, page_numbers):
    """Return recognized pages plus a nonfatal diagnostic (including partial OCR)."""
    if not enabled():
        return {}, None
    if not capability()['available']:
        return {}, 'ocr_unavailable'
    selected = list(page_numbers)[:MAX_OCR_PAGES]
    if not selected:
        return {}, None
    if sys.platform == 'win32':
        command = [sys.executable, str(Path(__file__).with_name('ocr_windows.py'))]
    else:
        try:
            binary = _ensure_binary()
        except (OSError, subprocess.SubprocessError, RuntimeError):
            return {}, 'ocr_build_failed'
        command = [str(binary)]
    warning = 'ocr_page_limit' if len(page_numbers) > MAX_OCR_PAGES else None
    try:
        result = subprocess.run([*command, str(path), ','.join(map(str, selected))],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=OCR_TIMEOUT, check=False)
        output = result.stdout
        if result.returncode:
            warning = 'ocr_failed'
    except subprocess.TimeoutExpired as exc:
        output = exc.stdout or b''
        warning = 'ocr_timeout'
    except OSError:
        return {}, 'ocr_failed'
    recognized = BatchPages()
    seen = set()
    for line in output.splitlines():
        try:
            record = json.loads(line)
            page, text = record['page'], record['text']
            if page not in selected or not isinstance(text, str):
                continue
            seen.add(page)
            recognized.attempted.add(page)
            if record.get('error'):
                warning = warning or 'ocr_page_failed'
            else:
                recognized[page] = text[:100_000]  # Blank pages are completed too.
        except (ValueError, KeyError, TypeError):
            continue
    if len(seen) < len(selected):
        warning = warning or 'ocr_incomplete'
    return recognized, warning


class OCRPages(dict):
    """Recognized text plus durable page progress; compatible with dict callers."""
    def __init__(self, text=(), **progress):
        super().__init__(text)
        self.progress = progress


def _cache_identity(path):
    path = Path(path).resolve()
    stat = path.stat()
    version = f'{stat.st_mtime_ns}:{stat.st_ctime_ns}:{stat.st_size}:{stat.st_ino}:{_engine_version()}'
    root = Path(os.environ.get('CANVAS_CACHE_DIR', Path.home() / '.canvas_search_cache')) / 'ocr-pages'
    ensure_private_directory(root.parent)
    ensure_private_directory(root)
    name = hashlib.sha256(str(path).encode()).hexdigest()
    return root / (name + '.db'), version


def recognize_pdf(path, page_numbers):
    """Resume at unfinished pages; persist blanks, text, retries, and source version.

    Each call does at most one bounded native batch. Index sweeps revisit pending
    documents. Repeated page failures back off and stop after three attempts.
    """
    if not enabled():
        return OCRPages(), None
    candidates = sorted(set(page_numbers))
    if not candidates:
        return OCRPages(), None
    if not capability()['available']:
        return OCRPages(total=len(candidates), completed=0, pending=0, failed=len(candidates),
                        retry_at=0), 'ocr_unavailable'
    try:
        cache, version = _cache_identity(path)
    except OSError:
        # Preserve the adapter contract for missing/unreadable inputs.
        return OCRPages(total=len(candidates), completed=0, pending=0, failed=len(candidates)), 'ocr_source_unavailable'
    validate_cache_database(cache)
    with closing(sqlite3.connect(cache, timeout=5)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute('CREATE TABLE IF NOT EXISTS pages (version TEXT, page INTEGER PRIMARY KEY, text TEXT, done INTEGER, attempts INTEGER, retry_at REAL)')
        with conn:
            conn.execute('DELETE FROM pages WHERE version != ?', (version,))
        rows = {r['page']: dict(r) for r in conn.execute('SELECT * FROM pages')}
        now = time.time()
        due = [p for p in candidates if p not in rows or
               (not rows[p]['done'] and rows[p]['attempts'] < 3 and rows[p]['retry_at'] <= now)]
        # Never let a repeatedly failing early page prevent later pages being tried.
        due.sort(key=lambda p: (rows.get(p, {}).get('attempts', 0), p))
        selected = due[:MAX_OCR_PAGES]
        warning = None
        if selected:
            recognized, warning = _recognize_batch(path, selected)
            # Do not publish OCR generated while an archive was being replaced.
            try:
                if _cache_identity(path)[1] != version:
                    return OCRPages(total=len(candidates), completed=0, pending=len(candidates), failed=0,
                                    retry_at=now + 5), 'ocr_source_changed'
            except OSError:
                return OCRPages(), 'ocr_source_unavailable'
            attempted = set(getattr(recognized, 'attempted', recognized.keys()))
            missing = [number for number in selected if number not in attempted]
            if missing and warning in {'ocr_timeout', 'ocr_failed', 'ocr_incomplete'}:
                # Native processing is sequential. Only the first unreported page
                # may have been interrupted; later pages have not been attempted.
                attempted.add(missing[0])
            with conn:
                for number in selected:
                    if number not in attempted and warning != 'ocr_build_failed':
                        continue
                    attempts = rows.get(number, {}).get('attempts', 0) + 1
                    done = number in recognized
                    # Build failures are environment issues, not bad-page attempts.
                    if warning == 'ocr_build_failed':
                        attempts -= 1
                    retry = 0 if done else now + (300 if warning == 'ocr_build_failed' else min(300, 30 * 2 ** max(0, attempts - 1)))
                    record = dict(version=version, page=number, text=recognized.get(number, ''),
                                  done=int(done), attempts=attempts, retry_at=retry)
                    conn.execute('INSERT OR REPLACE INTO pages VALUES (:version, :page, :text, :done, :attempts, :retry_at)', record)
                    rows[number] = record
        completed = [p for p in candidates if rows.get(p, {}).get('done')]
        failed = [p for p in candidates if p in rows and not rows[p]['done'] and rows[p]['attempts'] >= 3]
        pending = [p for p in candidates if p not in completed and p not in failed]
        retry_at = min((rows.get(p, {}).get('retry_at', 0) for p in pending), default=0)
        text = {p: rows[p]['text'] for p in completed if rows[p]['text'].strip()}
        progress = OCRPages(text, total=len(candidates), completed=len(completed), pending=len(pending),
                            failed=len(failed), retry_at=retry_at)
        if pending:
            warning = warning or 'ocr_pending'
        elif failed:
            warning = warning or 'ocr_page_failed'
        else:
            warning = None
        return progress, warning


def retry_failed(path):
    """An explicit index rebuild retries failed pages without re-OCRing successes."""
    cache, _ = _cache_identity(path)
    if not cache.exists():
        return
    with closing(sqlite3.connect(cache, timeout=5)) as conn:
        if conn.execute("SELECT 1 FROM sqlite_master WHERE name='pages'").fetchone():
            with conn:
                conn.execute('DELETE FROM pages WHERE done=0')
