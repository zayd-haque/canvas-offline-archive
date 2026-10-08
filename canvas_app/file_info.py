"""[Codex] Bounded file metadata probing; expensive PDF parsing is isolated."""
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

MAX_PROBE_BYTES = 128 * 1024 * 1024
MAX_TEXT_CHARS = 500_000


def probe_file(path):
    path = Path(path)
    result = dict(page_count=None, slide_count=None, word_count=None, char_count=None, stats_truncated=False)
    if path.stat().st_size > MAX_PROBE_BYTES:
        return dict(result, stats_truncated=True)
    try:
        if path.suffix.lower() == '.pdf':
            process = subprocess.run([sys.executable, str(Path(__file__).resolve()), str(path)],
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=8, check=True)
            result['page_count'] = json.loads(process.stdout)['page_count']
        elif path.suffix.lower() == '.pptx':
            with zipfile.ZipFile(path) as archive:
                count = sum(bool(re.fullmatch(r'ppt/slides/slide\d+\.xml', name)) for name in archive.namelist())
                result.update(page_count=count, slide_count=count)
        elif path.suffix.lower() in {'.txt', '.md', '.csv', '.html'}:
            with path.open(encoding='utf-8', errors='replace') as source:
                text = source.read(MAX_TEXT_CHARS + 1)
            truncated = len(text) > MAX_TEXT_CHARS
            text = text[:MAX_TEXT_CHARS]
            result.update(word_count=len(text.split()), char_count=len(text), page_count=1, stats_truncated=truncated)
    except (OSError, ValueError, zipfile.BadZipFile, subprocess.SubprocessError):
        result['stats_unavailable'] = True
    return result


if __name__ == '__main__':
    import pypdf
    if sys.platform != 'win32':
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (6, 6))
        try:
            resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
        except (ValueError, OSError):
            pass
    print(json.dumps({'page_count': len(pypdf.PdfReader(sys.argv[1], strict=False).pages)}))
