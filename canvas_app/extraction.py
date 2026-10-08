"""[Codex] Bounded offline extraction. PDF parsing runs in a disposable child process."""
import json
import re
import subprocess
import sqlite3
import time
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

try:
    from .ocr import recognize_pdf
except ImportError:
    from ocr import recognize_pdf


class ExtractedPages(list):
    """List-compatible extraction result with optional nonfatal diagnostics."""
    def __init__(self, pages, warning=None, ocr=None):
        super().__init__(pages)
        self.warning = warning
        self.ocr = ocr or {}


def add_pdf_ocr(path, pages):
    candidates = [number for number, text in pages if sum(c.isalnum() for c in text) < 40]
    if not candidates:
        return ExtractedPages(pages)
    try:
        recognized, warning = recognize_pdf(path, candidates)
    except (OSError, sqlite3.Error):
        return ExtractedPages(pages, 'ocr_cache_failed', {'total': len(candidates), 'completed': 0,
                              'pending': len(candidates), 'failed': 0, 'retry_at': time.time() + 300})
    merged, remaining = [], MAX_TEXT
    for number, text in pages:
        ocr_text = recognized.get(number, '')
        # Preserve existing content unless OCR recovers more readable text.
        if sum(c.isalnum() for c in ocr_text) > sum(c.isalnum() for c in text):
            text = ocr_text
        text = text[:remaining]
        merged.append((number, text))
        remaining -= len(text)
    return ExtractedPages(merged, warning, getattr(recognized, 'progress', {}))


MAX_FILE_BYTES = 128 * 1024 * 1024
MAX_TEXT = 2_000_000
MAX_PAGES = 2000
MAX_XML = 16 * 1024 * 1024
SUPPORTED = {'.pdf', '.pptx', '.docx', '.txt', '.md', '.csv', '.html'}


def extract(path):
    path = Path(path)
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError('File exceeds extraction size limit')
    ext = path.suffix.lower()
    if ext == '.pdf':
        result = subprocess.run([sys.executable, str(Path(__file__).resolve()), str(path)],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=90, check=True)
        return add_pdf_ocr(path, json.loads(result.stdout))
    if ext in {'.docx', '.pptx'}:
        pages, remaining = [], MAX_TEXT
        with zipfile.ZipFile(path) as archive:
            if ext == '.docx':
                entries = ['word/document.xml']
            else:
                entries = sorted((n for n in archive.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)),
                                 key=lambda n: int(re.search(r'(\d+)\.xml', n)[1]))
            total_xml = 0
            for index, entry in enumerate(entries[:MAX_PAGES], 1):
                info = archive.getinfo(entry)
                total_xml += info.file_size
                if info.file_size > MAX_XML or total_xml > 64 * 1024 * 1024:
                    raise ValueError('Office XML exceeds extraction limit')
                xml = archive.read(entry)
                if b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper():
                    raise ValueError('XML declarations are not supported')
                tree = ElementTree.fromstring(xml)
                text = ' '.join(node.text or '' for node in tree.iter() if node.tag.endswith('}t'))[:remaining]
                pages.append((index, text))
                remaining -= len(text)
                if remaining <= 0:
                    break
        return pages
    with path.open(encoding='utf-8', errors='replace') as source:
        return [(1, source.read(MAX_TEXT))]


def pdf_child(path):
    import pypdf
    if sys.platform != 'win32':
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (75, 75))
        # The child can be killed safely without affecting the web server.
        try:
            resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
        except (ValueError, OSError):
            # macOS may reject RLIMIT_AS. CPU/wall-time, input and output limits remain.
            pass
    pages, remaining = [], MAX_TEXT
    reader = pypdf.PdfReader(path, strict=False)
    for index, page in enumerate(reader.pages):
        if index >= MAX_PAGES or remaining <= 0:
            break
        try:
            text = ' '.join((page.extract_text() or '').split())[:remaining]
        except Exception:
            text = ''  # A damaged text layer may still rasterize successfully for OCR.
        pages.append((index + 1, text))
        remaining -= len(text)
    return pages


if __name__ == '__main__':
    print(json.dumps(pdf_child(sys.argv[1])))
