"""Verify native Windows OCR-to-search and launcher without global Python."""
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
assert sys.platform == 'win32', 'This verification requires real Windows'
with tempfile.TemporaryDirectory(prefix='canvas-native-') as temporary:
    root = Path(temporary)
    course = root / 'Synthetic Course'
    course.mkdir()
    os.environ['CANVAS_CACHE_DIR'] = str(root / 'cache')
    os.environ['CANVAS_OCR'] = '1'
    bmp = root / 'scan.bmp'
    ps = root / 'draw.ps1'
    ps.write_text('''Add-Type -AssemblyName System.Drawing
$b = New-Object System.Drawing.Bitmap 1200,400
$g = [System.Drawing.Graphics]::FromImage($b)
$g.Clear([System.Drawing.Color]::White)
$f = New-Object System.Drawing.Font 'Arial',40
$g.DrawString('WINDOWS OCR TEST 4827',$f,[System.Drawing.Brushes]::Black,30,120)
$b.Save($args[0],[System.Drawing.Imaging.ImageFormat]::Bmp)
$f.Dispose(); $g.Dispose(); $b.Dispose()
''')
    subprocess.run(['powershell.exe', '-NoProfile', '-File', str(ps), str(bmp)], check=True)
    data = bmp.read_bytes()
    offset = struct.unpack_from('<I', data, 10)[0]
    width, height, planes, bits = struct.unpack_from('<iiHH', data, 18)
    assert bits in (24, 32) and height > 0
    channels = bits // 8
    stride = ((width * bits + 31) // 32) * 4
    rgb = bytearray()
    for y in reversed(range(height)):
        row = data[offset+y*stride:offset+(y+1)*stride]
        for x in range(width):
            b,g,r = row[x*channels:x*channels+3]
            rgb.extend((r,g,b))
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject, NumberObject
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=200)
    image = DecodedStreamObject()
    image.set_data(bytes(rgb))
    image.update({NameObject('/Type'):NameObject('/XObject'), NameObject('/Subtype'):NameObject('/Image'),
                  NameObject('/Width'):NumberObject(width), NameObject('/Height'):NumberObject(height),
                  NameObject('/ColorSpace'):NameObject('/DeviceRGB'), NameObject('/BitsPerComponent'):NumberObject(8)})
    ref = writer._add_object(image)
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/XObject'):DictionaryObject({NameObject('/Scan'):ref})})
    content = DecodedStreamObject(); content.set_data(b'q 600 0 0 200 0 0 cm /Scan Do Q')
    page[NameObject('/Contents')] = writer._add_object(content)
    with (course / 'scan.pdf').open('wb') as handle: writer.write(handle)
    from canvas_app import ocr
    assert ocr.capability()['available'], ocr.capability()
    from canvas_app.search_engine import SearchEngine
    engine = SearchEngine('Synthetic Course', course, root / 'search-cache')
    engine.index_course(force=True)
    result = engine.search('4827')
    assert result.get('results'), json.dumps({'result':result, 'status':engine.status()})
    assert any(hit.get('path') == 'scan.pdf' for hit in result['results']), result
    print('WINDOWS_NATIVE_OCR_TO_SEARCH_PASS')

    launcher = root / 'Launcher With Spaces'
    launcher.mkdir()
    subprocess.run([sys.executable, '-m', 'venv', '--without-pip', str(launcher / '.venv')], check=True)
    shutil.copyfile(ROOT / 'Open Canvas Offline Archive Windows.cmd', launcher / 'Open.cmd')
    (launcher / 'bootstrap_windows.py').write_text("from pathlib import Path\nPath('venv-used.txt').write_text('ok')\n")
    env = os.environ.copy(); env['PATH'] = ''
    subprocess.run([os.environ['COMSPEC'], '/d', '/c', str(launcher / 'Open.cmd')], cwd=launcher, env=env, check=True, timeout=30)
    assert (launcher / 'venv-used.txt').read_text() == 'ok'
    print('WINDOWS_LAUNCHER_WITHOUT_PATH_PYTHON_PASS')
