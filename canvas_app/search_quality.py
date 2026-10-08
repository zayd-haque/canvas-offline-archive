"""[Codex] Bounded offline retrieval and ranking; no model, network, or course vocabulary."""
import html
import re
import sqlite3
import time
import unicodedata
from pathlib import Path

try:
    from .archive import safe_path
except ImportError:
    from archive import safe_path

MAX_RESULTS = 1000
MAX_CANDIDATES = 2000


def normalize(text):
    return ''.join(c for c in unicodedata.normalize('NFKD', text.casefold()) if not unicodedata.combining(c))


def parse_query(query):
    """Quote every FTS operand: operators/punctuation are never executable syntax."""
    parts = []
    for phrase, word in re.findall(r'"([^"\n]+)"|(\w+)', query[:512], re.UNICODE):
        tokens = re.findall(r'[^\W_]+', normalize(phrase or word), re.UNICODE)
        if tokens:
            if phrase:
                parts.append((' '.join(tokens), True))
            else:
                parts.extend((token, False) for token in tokens)
    return parts[:32]


def expression(parts, prefix=False):
    return ' AND '.join('"' + term + '"' + ('*' if prefix and not quoted and not term.isdecimal() else '') for term, quoted in parts)


def edit_distance(left, right, maximum=1):
    """Bounded Damerau-Levenshtein distance (including adjacent transpositions)."""
    if abs(len(left) - len(right)) > maximum:
        return maximum + 1
    previous, before = list(range(len(right) + 1)), None
    for i, a in enumerate(left, 1):
        current = [i]
        for j, b in enumerate(right, 1):
            cost = min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (a != b))
            if before is not None and i > 1 and j > 1 and a == right[j - 2] and left[i - 2] == b:
                cost = min(cost, before[j - 2] + 1)
            current.append(cost)
        if min(current) > maximum:
            return maximum + 1
        before, previous = previous, current
    return previous[-1]


def ocr_key(term):
    return term.replace('rn', 'm').replace('0', 'o').replace('1', 'l')


def corrected_expression(conn, parts):
    """Expand OCR equivalents and correct absent words with strict work limits.

    FTS5 vocab uses the index's Porter stems. Alternatives remain quoted prefixes
    so a suggested stem also retrieves its inflections. Quotes never get corrected.
    """
    if any(quoted for _, quoted in parts) or len(parts) > 8:
        return None, [], False
    conn.execute('CREATE VIRTUAL TABLE IF NOT EXISTS temp.search_vocabulary USING fts5vocab(main, doc_pages_fts, row)')
    conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS temp.query_tokens USING fts5(content, tokenize='porter unicode61')")
    conn.execute('CREATE VIRTUAL TABLE IF NOT EXISTS temp.query_vocabulary USING fts5vocab(temp, query_tokens, row)')
    expanded, corrections, truncated = [], [], False
    deadline = time.monotonic() + 0.12
    for term, _ in parts:
        exact = conn.execute('SELECT 1 FROM doc_pages_fts WHERE doc_pages_fts MATCH ? LIMIT 1', ('"' + term + '"*',)).fetchone()
        if len(term) < 4 or len(term) > 48 or not term.isalnum():
            expanded.append(expression([(term, False)], prefix=True))
            continue
        if time.monotonic() > deadline:
            truncated = True
            expanded.append(expression([(term, False)], prefix=True))
            continue
        canonical = ocr_key(term)
        if canonical != term and conn.execute(
                'SELECT 1 FROM doc_pages_fts WHERE doc_pages_fts MATCH ? LIMIT 1',
                ('"' + canonical + '"*',)).fetchone():
            expanded.append('(' + expression([(term, False)], prefix=True) + ' OR "' + canonical + '"*)')
            corrections.append({'term': term, 'alternatives': [canonical]})
            continue
        conn.execute('DELETE FROM query_tokens')
        conn.execute('INSERT INTO query_tokens(content) VALUES (?)', (term,))
        stems = [row['term'] for row in conn.execute('SELECT term FROM query_vocabulary')]
        stem = stems[0] if len(stems) == 1 else term
        # A typo can prevent Porter from removing a suffix (factorail/factorial).
        # Stem bounded adjacent-transposition variants before vocabulary matching.
        transposed_stems = set()
        if not exact:
            variants = [term[:i] + term[i + 1] + term[i] + term[i + 2:]
                        for i in range(len(term) - 1) if term[i] != term[i + 1]]
            conn.execute('DELETE FROM query_tokens')
            conn.execute('INSERT INTO query_tokens(content) VALUES (?)', (' '.join(variants),))
            transposed_stems = {row['term'] for row in conn.execute('SELECT term FROM query_vocabulary')}
        # Prefer the matching initial, then spend remaining capacity on first-letter
        # OCR errors/typos. Both scans share the SQLite deadline and candidate cap.
        first, after = term[0], chr(ord(term[0]) + 1)
        rows = conn.execute(
            'SELECT term, doc FROM search_vocabulary WHERE term >= ? AND term < ? '
            'AND length(term) BETWEEN ? AND ? LIMIT ?',
            (first, after, min(len(term), len(stem)) - 2, max(len(term), len(stem)) + 2, MAX_CANDIDATES + 1)).fetchall()
        if len(rows) <= MAX_CANDIDATES:
            rows += conn.execute(
                'SELECT term, doc FROM search_vocabulary WHERE (term < ? OR term >= ?) '
                'AND length(term) BETWEEN ? AND ? LIMIT ?',
                (first, after, min(len(term), len(stem)) - 2, max(len(term), len(stem)) + 2, MAX_CANDIDATES + 1 - len(rows))).fetchall()
        truncated |= len(rows) > MAX_CANDIDATES
        candidates = []
        for row in rows[:MAX_CANDIDATES]:
            if time.monotonic() > deadline:
                truncated = True
                break
            candidate = row['term']
            if len(candidate) < 3 or min(abs(len(term) - len(candidate)), abs(len(stem) - len(candidate))) > 2:
                continue
            ocr_match = ocr_key(term) == ocr_key(candidate) or ocr_key(stem) == ocr_key(candidate)
            distance = min(edit_distance(term, candidate, 1), edit_distance(stem, candidate, 1))
            if candidate in transposed_stems:
                distance = min(distance, 1)
            if candidate not in (term, stem) and (ocr_match or (not exact and distance <= 1)):
                candidates.append((0 if ocr_match else distance, -row['doc'], candidate))
        alternatives = [item[2] for item in sorted(candidates)[:3]]
        if alternatives:
            expanded.append('(' + ' OR '.join('"' + alternative + '"*' for alternative in [term, *alternatives]) + ')')
            corrections.append({'term': term, 'alternatives': alternatives})
        else:
            expanded.append(expression([(term, False)], prefix=True))
    return (' AND '.join(expanded) if corrections else None), corrections, truncated


def fetch_hits(conn, query):
    # Materialize before aggregation: auxiliary FTS functions cannot run after GROUP BY.
    return conn.execute('''WITH hits AS MATERIALIZED (
        SELECT file_path, filename, folder, page_num,
            snippet(doc_pages_fts, 4, char(1), char(2), '...', 24) AS snippet,
            bm25(doc_pages_fts, 0, 3, 0.25, 0, 1) AS relevance
        FROM doc_pages_fts WHERE doc_pages_fts MATCH ?)
        SELECT file_path, filename, folder, page_num, snippet, MIN(relevance) AS rank
        FROM hits GROUP BY file_path ORDER BY rank, file_path LIMIT ?''', (query, MAX_RESULTS)).fetchall()


def filename_quality(name, parts):
    """Unicode-folded token matches; quoted phrases must be contiguous whole tokens."""
    tokens = re.findall(r'[^\W_]+', normalize(name))
    padded = ' ' + ' '.join(tokens) + ' '
    quality = 2
    for term, quoted in parts:
        if ' ' + term + ' ' in padded:
            continue
        if quoted or term.isdecimal() or not any(token.startswith(term) for token in tokens):
            return 0
        quality = 1
    return quality


def escaped_highlight(text, terms):
    # Escape all source HTML, and only add our own fixed markup.
    pattern = re.compile('|'.join(re.escape(t) for t in sorted(set(terms), key=len, reverse=True)), re.I)
    if not terms:
        return html.escape(text)
    chunks, start = [], 0
    for match in pattern.finditer(text):
        chunks.extend((html.escape(text[start:match.start()]), '<mark>', html.escape(match[0]), '</mark>'))
        start = match.end()
    return ''.join(chunks) + html.escape(text[start:])


def search(engine, query, limit=30):
    engine.ensure_indexed()
    parts = parse_query(query.strip())
    response = {'query': query, 'total': 0, 'curriculum_matches': [], 'file_matches': [],
                'index_status': engine.status(),
                'search_info': {'corrections': [], 'partial_matches': False, 'truncated': False, 'timed_out': False, 'error': None}}
    if not parts:
        return response
    info = response['search_info']
    # Curriculum suggestions are contextual, never a substitute for a quoted phrase.
    curriculum = engine.curriculum_engine.match_curriculum(query.strip()) if not any(q for _, q in parts) else []
    response['curriculum_matches'] = curriculum
    associations = {a['path']: c for c in curriculum for a in c.get('associated_files', []) if a.get('path')}
    results, digests = {}, {}
    tiers = {'exact': 50, 'prefix': 40, 'corrected': 30, 'partial': 10, 'curriculum': 5}

    def add_hits(rows, quality):
        info['truncated'] |= len(rows) >= MAX_RESULTS
        for row in rows:
            path = row['file_path']
            if path in results:
                continue
            raw = row['snippet'] or ''
            snippet = html.escape(raw).replace('\x01', '<mark>').replace('\x02', '</mark>')
            name = row['filename']
            title_match = filename_quality(name, parts) == 2
            # Each tier has a fixed disjoint interval. BM25 only breaks ties within it.
            rank = max(0.0, -float(row['rank']))
            score = tiers[quality] + (3 if title_match else 0) + (1 if path in associations else 0) + rank / (1 + rank)
            results[path] = dict(name=name, path=path, folder=row['folder'], extension=Path(name).suffix.lower(),
                                 match_type='content', match_quality=quality, page_num=row['page_num'], snippet=snippet, score=score)

    try:
        with engine._get_connection(bounded=True) as conn:
            # Keep pages and deduplication metadata on the same WAL snapshot.
            conn.execute('BEGIN')
            revision = conn.execute("SELECT value FROM index_meta WHERE key='revision'").fetchone()
            response['index_status']['revision'] = int(revision['value']) if revision else 0
            add_hits(fetch_hits(conn, expression(parts)), 'exact')
            prefixed = expression(parts, prefix=True)
            if prefixed != expression(parts):
                add_hits(fetch_hits(conn, prefixed), 'prefix')
            if len(results) < MAX_RESULTS:
                corrected, corrections, truncated = corrected_expression(conn, parts)
                info['truncated'] |= truncated
                if corrected:
                    rows = fetch_hits(conn, corrected)
                    if rows:
                        previous_count = len(results)
                        add_hits(rows, 'corrected')
                        if len(results) > previous_count:
                            info['corrections'] = corrections
            # Includes image-only/unsupported-extraction documents with searchable names.
            conn.create_function('filename_quality', 1, lambda name: filename_quality(name, parts), deterministic=True)
            filename_rows = conn.execute(
                'SELECT file_path, filename, filename_quality(filename) AS quality FROM indexed_files '
                'WHERE filename_quality(filename) > 0 ORDER BY quality DESC, file_path LIMIT ?',
                (MAX_RESULTS,)).fetchall()
            info['truncated'] |= len(filename_rows) >= MAX_RESULTS
            for row in filename_rows:
                path, name = row['file_path'], row['filename']
                quality = 'exact' if row['quality'] == 2 else 'prefix'
                score = tiers[quality] + 3.0
                if path not in results or results[path]['score'] < score:
                    results[path] = dict(name=name, path=path, folder=str(Path(path).parent), extension=Path(name).suffix.lower(),
                                         match_type='filename', match_quality=quality, page_num=None,
                                         snippet='Filename match: ' + escaped_highlight(name, [t for t, _ in parts]), score=score)
            if not results and len(parts) > 1 and not any(quoted or term.isdecimal() for term, quoted in parts):
                add_hits(fetch_hits(conn, ' OR '.join(expression([(term, False)], prefix=True) for term, _ in parts)), 'partial')
                info['partial_matches'] = bool(results)
            for path, match in associations.items():
                if path not in results and len(results) < MAX_RESULTS:
                    name = Path(path).name
                    results[path] = dict(name=name, path=path, folder=str(Path(path).parent), extension=Path(name).suffix.lower(),
                                         match_type='curriculum', match_quality='curriculum', page_num=None,
                                         snippet=escaped_highlight(str(match.get('topic', '')), [t for t, _ in parts]), score=5.0)
            # One bounded batch lookup rather than an extra SQLite query for every hit.
            paths = list(results)
            for offset in range(0, len(paths), 400):
                batch = paths[offset:offset + 400]
                digests.update((row['file_path'], row['digest']) for row in conn.execute(
                    'SELECT file_path, digest FROM indexed_files WHERE file_path IN (' + ','.join('?' for _ in batch) + ')', batch))
    except sqlite3.OperationalError as exc:
        code = getattr(exc, 'sqlite_errorcode', None)
        interrupted = code == sqlite3.SQLITE_INTERRUPT or str(exc).lower() == 'interrupted'
        info['timed_out'] = interrupted
        info['error'] = ('query_timeout' if interrupted else
                         'index_busy' if code in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED) else
                         'index_unavailable')
    unique, seen = [], set()
    for result in sorted(results.values(), key=lambda item: (-item['score'], item['path'])):
        try:
            safe_path(engine.course_path, result['path'])
        except (ValueError, OSError):
            continue
        digest = digests.get(result['path']) or result['path']
        if digest not in seen:
            seen.add(digest)
            unique.append(result)
    response.update(total=len(unique), file_matches=unique[:max(1, min(limit, 100))])
    return response
