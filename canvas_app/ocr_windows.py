"""[Codex] OCR PDF pages locally with PDFium and the Windows OCR service.

Runs only in the bounded subprocess started by ocr.py. Each completed page is
emitted immediately so an interrupted batch can retain earlier results.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

MAX_IMAGE_DIMENSION = 2048
MAX_SOURCE_BYTES = 128 * 1024 * 1024


def render_page(document, number, limit):
    import pypdfium2 as pdfium

    page = document[number - 1]
    width, height = page.get_size()
    if width <= 0 or height <= 0:
        raise ValueError('Invalid PDF page dimensions')
    scale = min(2.0, limit / max(width, height))
    try:
        bitmap = page.render(scale=scale, force_bitmap_format=pdfium.raw.FPDFBitmap_BGRA)
    finally:
        page.close()
    if bitmap.stride != bitmap.width * 4 or bitmap.width > limit or bitmap.height > limit:
        bitmap.close()
        raise ValueError('Unexpected PDF raster dimensions')
    return bitmap


def software_bitmap(pdf_bitmap):
    from winrt.windows.graphics.imaging import BitmapPixelFormat, SoftwareBitmap
    from winrt.windows.storage.streams import DataWriter

    writer = DataWriter()
    try:
        writer.write_bytes(bytes(pdf_bitmap.buffer))
        buffer = writer.detach_buffer()
    finally:
        writer.close()
    result = SoftwareBitmap(BitmapPixelFormat.BGRA8, pdf_bitmap.width, pdf_bitmap.height)
    try:
        result.copy_from_buffer(buffer)
    except Exception:
        result.close()
        raise
    return result


async def recognize(path: Path, pages: list[int]) -> int:
    import pypdfium2 as pdfium
    from winrt.windows.media.ocr import OcrEngine

    engine = OcrEngine.try_create_from_user_profile_languages()
    if engine is None:
        raise RuntimeError('No Windows OCR language is installed')
    limit = min(MAX_IMAGE_DIMENSION, OcrEngine.max_image_dimension)
    if limit < 1:
        raise RuntimeError('Windows OCR cannot process PDF images')
    document = pdfium.PdfDocument(path)
    try:
        for number in pages:
            if number < 1 or number > len(document):
                record = {'page': number, 'text': '', 'error': 'Page outside PDF'}
            else:
                bitmap = None
                image = None
                try:
                    bitmap = render_page(document, number, limit)
                    image = software_bitmap(bitmap)
                    result = await engine.recognize_async(image)
                    record = {'page': number, 'text': result.text[:100_000]}
                except Exception as exc:
                    record = {'page': number, 'text': '', 'error': type(exc).__name__}
                finally:
                    if image is not None:
                        image.close()
                    if bitmap is not None:
                        bitmap.close()
            print(json.dumps(record, ensure_ascii=False), flush=True)
    finally:
        document.close()
    return 0


def main() -> int:
    if sys.platform != 'win32':
        raise RuntimeError('Windows OCR helper requires Windows')
    path = Path(sys.argv[1])
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError('PDF exceeds OCR size limit')
    pages = sorted(set(int(value) for value in sys.argv[2].split(',')))[:100]
    return asyncio.run(recognize(path, pages))


if __name__ == '__main__':
    raise SystemExit(main())
