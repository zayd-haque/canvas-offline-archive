#!/usr/bin/env python3
"""
Canvas Course Offline Web App - Asset Bundler & Modularizer
Maintains domain-specific CSS and JS modules in:
  - canvas_app/static/css/modules/*.css  -> canvas_app/static/css/canvas.css
  - canvas_app/static/js/src/*.js        -> canvas_app/static/js/app.js

Ensures zero-CDN 100% offline operation and preserves automated test compatibility.
"""
import sys
import os
import tempfile
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
CSS_DIR = STATIC / "css"
CSS_MODULES_DIR = CSS_DIR / "modules"
JS_DIR = STATIC / "js"
JS_SRC_DIR = JS_DIR / "src"


def _bundle(source, target, extension, comment):
    """[Codex] Preserve unchanged mtimes; publish complete bundles atomically."""
    modules = sorted(source.glob('*.' + extension))
    if not modules:
        if target.is_file():
            return target.read_text(encoding='utf-8')
        raise FileNotFoundError(f'No {extension} source modules or existing bundle')
    parts = []
    for module in modules:
        content = module.read_text(encoding='utf-8').strip()
        if content:
            header = f'/* --- Module: {module.name} --- */' if comment == 'css' else f'// --- Module: {module.name} ---'
            parts.append(f'{header}\n{content}\n')
    bundled = '\n'.join(parts)
    if not bundled:
        raise ValueError(f'Empty {extension} bundle')
    if target.exists() and target.read_text(encoding='utf-8') == bundled:
        return bundled
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent, delete=False) as output:
            temporary = output.name
            output.write(bundled)
        os.replace(temporary, target)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    return bundled


def bundle_css():
    return _bundle(CSS_MODULES_DIR, CSS_DIR / 'canvas.css', 'css', 'css')


def bundle_js():
    return _bundle(JS_SRC_DIR, JS_DIR / 'app.js', 'js', 'js')


def build_all():
    """Builds both CSS and JS bundles."""
    print("Bundling modular CSS files...")
    css = bundle_css()
    print("Bundling modular JS files...")
    js = bundle_js()
    index = STATIC / 'index.html'
    html = index.read_text(encoding='utf-8')
    for asset, content in (('css/canvas.css', css), ('js/app.js', js)):
        version = hashlib.sha256(content.encode('utf-8')).hexdigest()[:12]
        html = re.sub(r'(/static/' + re.escape(asset) + r')\?v=[^"\']+',
                      lambda match: match.group(1) + '?v=' + version, html)
    if html != index.read_text(encoding='utf-8'):
        index.write_text(html, encoding='utf-8')
    print("Build complete.")


if __name__ == "__main__":
    build_all()
