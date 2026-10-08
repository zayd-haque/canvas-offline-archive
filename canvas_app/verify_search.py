#!/usr/bin/env python3
"""[Codex] Opt-in real-archive search smoke test with a disposable local index.

Example: python3 canvas_app/verify_search.py --course '/path/to/archive' --query 'exam 1'
No source files or persistent app indexes are modified. OCR is opt-in because it
can take minutes on a large archive. This is separate from hermetic unit tests.
"""
import argparse
import json
import os
import tempfile
import time
from pathlib import Path

try:
    from .archive import load_blueprint
    from .search_engine import SearchEngine
except ImportError:
    from archive import load_blueprint
    from search_engine import SearchEngine


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--course', type=Path, required=True)
    parser.add_argument('--query', action='append', required=True)
    parser.add_argument('--ocr', action='store_true', help='Enable bounded OCR; subsequent sweeps may be needed')
    args = parser.parse_args()
    course = args.course.resolve()
    blueprint = load_blueprint(course / 'canvas_course.json')
    original = {key: os.environ.get(key) for key in ('CANVAS_CACHE_DIR', 'CANVAS_OCR')}
    try:
        with tempfile.TemporaryDirectory(prefix='canvas-search-check-') as tmp:
            os.environ.update(CANVAS_CACHE_DIR=tmp, CANVAS_OCR='1' if args.ocr else '0')
            engine = SearchEngine(blueprint.get('course_name') or course.name, course, tmp)
            started = time.perf_counter()
            indexed = engine.index_course()
            print(json.dumps({'index': indexed, 'seconds': round(time.perf_counter() - started, 3), 'status': engine.status()}))
            # Keep this smoke check deterministic: only the explicit pass above
            # modifies the disposable index; queries do not schedule another pass.
            engine.ensure_indexed = lambda: None
            for query in args.query:
                started = time.perf_counter()
                results = engine.search(query)
                print(json.dumps({'query': query, 'total': results['total'],
                                  'seconds': round(time.perf_counter() - started, 3),
                                  'search_info': results['search_info'],
                                  'top': [{key: hit[key] for key in ('path', 'page_num', 'match_quality')}
                                          for hit in results['file_matches'][:5]]}))
    finally:
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if __name__ == '__main__':
    main()
