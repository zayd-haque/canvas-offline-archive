"""
formatting.py - Centralized Document & File Formatting Engine for Canvas Course Offline Web App.

Performs server-side parsing, Markdown compilation, assignment prompt extraction,
and rich HTML formatting so the frontend remains a fast, lightweight presentation layer.
Zero external library dependencies (uses Python standard library).
"""

import io
import base64
import collections
import math
import sys
import zipfile
from datetime import datetime, timezone
from html import escape as html_escape, unescape as html_unescape
from pathlib import Path
import re
from urllib.parse import quote, urlsplit, unquote
from xml.etree import ElementTree



def format_size(num_bytes: int) -> str:
    """Format file size in human-readable units."""
    if num_bytes is None:
        return "-- KB"
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if abs(num_bytes) < 1024.0:
            return f"{num_bytes:3.1f} {unit}"
        num_bytes /= 1024.0
    return f"{num_bytes:.1f} PB"


format_file_size = format_size


def linkify_text(text: str) -> str:
    """Escape text and convert bare URLs into clean HTML hyperlinks."""
    output, end = [], 0
    for match in re.finditer(r'https?://[^\s<>"\']+', text):
        output.append(html_escape(text[end:match.start()]))
        url = match.group(0).rstrip(".,;:!?)")
        if _canvas_url(url):
            output.append('<span style="color:var(--text-muted); font-size:12px;">(Canvas link archived)</span>')
        else:
            escaped = html_escape(url)
            output.append(f'<a href="{escaped}" target="_blank" rel="noopener noreferrer" class="announcement-inline-link">{escaped}</a>')
        output.append(html_escape(match.group(0)[len(url):]))
        end = match.end()
    output.append(html_escape(text[end:]))
    return ''.join(output)


def is_assignment_file(filename: str, raw_text: str) -> bool:
    """Detect whether a document is an assignment prompt text file."""
    if filename.lower().startswith("assignment - "):
        return True
    if re.search(r'---+\s*ASSIGNMENT\s+(?:INSTRUCTIONS|PROMPT)', raw_text, re.IGNORECASE):
        return True
    if re.search(r'^Title:\s+', raw_text, re.MULTILINE) and (
        re.search(r'^Due Date:\s+', raw_text, re.MULTILINE) or
        re.search(r'^Points:\s+', raw_text, re.MULTILINE)
    ):
        return True
    return False


def parse_assignment_text(raw_text: str) -> dict:
    """Extract assignment metadata headers and prompt instructions from text."""
    parts = re.split(r'---+\s*ASSIGNMENT\s+(?:INSTRUCTIONS|PROMPT)[^\n]*---+', raw_text, flags=re.IGNORECASE)
    header_part = parts[0] if len(parts) > 0 else ""
    prompt_part = "\n".join(parts[1:]) if len(parts) > 1 else ""

    meta = {
        "title": "",
        "due": "",
        "points": "",
        "submission_types": "",
        "platform": "",
        "gradescope_url": "",
        "url": "",
        "prompt": prompt_part.strip()
    }

    # Header-only exports may omit the explicit instruction separator.
    if len(parts) == 1:
        header_lines, prompt_lines = [], []
        in_prompt = False
        for line in raw_text.splitlines():
            known_header = re.match(r'^(?:Title|Due Date|Due|Points|Submission Types?|Platform|Gradescope URL|URL):', line.strip(), re.I)
            if not in_prompt and known_header:
                header_lines.append(line)
            elif line.strip():
                in_prompt = True
                prompt_lines.append(line)
            elif in_prompt:
                prompt_lines.append(line)
        header_part = "\n".join(header_lines)
        meta["prompt"] = "\n".join(prompt_lines).strip()

    current_key = None
    for line in header_part.splitlines():
        trimmed = line.strip()
        if not trimmed:
            continue
        match = re.match(r'^([A-Za-z\s]+):\s*(.*)$', trimmed)
        if match:
            current_key = match.group(1).strip().lower()
            val = match.group(2).strip()
            if current_key == "title":
                meta["title"] = val
            elif current_key in ("due date", "due"):
                meta["due"] = val
            elif current_key == "points":
                meta["points"] = val
            elif current_key in ("submission types", "submission type"):
                meta["submission_types"] = val
            elif current_key == "platform":
                meta["platform"] = val
            elif "gradescope url" in current_key:
                meta["gradescope_url"] = val
            elif current_key == "url":
                meta["url"] = val
        elif current_key and "due" in current_key:
            if trimmed not in meta["due"]:
                meta["due"] = f"{meta['due']} {trimmed}" if meta["due"] else trimmed

    if meta["due"]:
        meta["due"] = re.sub(r'^due\s+', '', meta["due"], flags=re.IGNORECASE).strip()
        words = meta["due"].split()
        half = len(words) // 2
        if half > 1 and words[:half] == words[half:]:
            meta["due"] = " ".join(words[:half])

    return meta


def render_prompt_html(prompt_text: str) -> str:
    """Format assignment prompt text into styled paragraphs and callout boxes."""
    if not prompt_text:
        return '<p style="color:var(--text-muted); font-style:italic;">No instructions provided for this assignment.</p>'

    paragraphs = re.split(r'\n\s*\n', prompt_text)
    html_out = []

    for para in paragraphs:
        trimmed = para.strip()
        if not trimmed:
            continue

        # Gradescope callout
        if re.search(r'administered and graded via Gradescope|submitted via Gradescope|Gradescope Portal', trimmed, re.IGNORECASE):
            lines = [l for l in trimmed.splitlines() if not re.search(r'direct canvas launch|canvas launch|bruinlearn\.ucla\.edu', l, re.IGNORECASE)]
            clean_notice = "\n".join(lines)
            linked = linkify_text(clean_notice).replace('\n', '<br>')
            html_out.append(
                f'<div class="assignment-callout-gradescope">'
                f'  <div style="font-weight:600; margin-bottom:6px; color:#C7D2FE; display:flex; align-items:center; gap:6px;">'
                f'    🎓 <span>Gradescope Submission Notice</span>'
                f'  </div>'
                f'  <div>{linked}</div>'
                f'</div>'
            )
            continue

        # Note or Warning callout
        if re.search(r'^(?:NOTE|Note|Important):', trimmed, re.IGNORECASE):
            linked = linkify_text(trimmed).replace('\n', '<br>')
            html_out.append(
                f'<div class="assignment-callout-note">'
                f'  <div style="font-weight:600; margin-bottom:4px; color:#F59E0B; display:flex; align-items:center; gap:6px;">'
                f'    ⚠️ <span>Important Notice</span>'
                f'  </div>'
                f'  <div>{linked}</div>'
            )
            continue

        linked = linkify_text(trimmed).replace('\n', '<br>')
        html_out.append(f'<p class="assignment-prompt-p">{linked}</p>')

    return "\n".join(html_out)


def format_assignment_preview(filename: str, file_path: str, raw_text: str, course_name: str = "") -> dict:
    """Render full assignment card HTML with metadata and instructions."""
    meta = parse_assignment_text(raw_text)
    display_title = meta["title"] or re.sub(r'^Assignment\s*-\s*', '', filename, flags=re.IGNORECASE)
    display_title = re.sub(r'\.txt$', '', display_title, flags=re.IGNORECASE)
    is_gs = bool("gradescope" in meta["platform"].lower() or meta["gradescope_url"] or re.search(r'gradescope', raw_text, re.IGNORECASE))
    icon = '🎓' if is_gs else '📄'
    gs_link = meta["gradescope_url"] if _safe_url(meta["gradescope_url"]) else "https://www.gradescope.com/"

    header_actions = ""
    if is_gs:
        header_actions = (
            f'<a href="{html_escape(gs_link)}" target="_blank" rel="noopener noreferrer" class="btn-gradescope-accent" title="Open Gradescope portal in browser">'
            f'  🎓 Open Gradescope Portal ↗'
            f'</a>'
        )

    meta_items = []
    if meta["due"]:
        meta_items.append(
            f'<div class="assignment-meta-item">'
            f'  <span class="meta-label">Due</span>'
            f'  <span class="meta-value due-highlight">{html_escape(meta["due"])}</span>'
            f'</div>'
        )
    if meta["points"]:
        meta_items.append(
            f'<div class="assignment-meta-item">'
            f'  <span class="meta-label">Points</span>'
            f'  <span class="meta-value points-badge">{html_escape(meta["points"])}</span>'
            f'</div>'
        )
    if meta["submission_types"]:
        meta_items.append(
            f'<div class="assignment-meta-item">'
            f'  <span class="meta-label">Submitting</span>'
            f'  <span class="meta-value">{html_escape(meta["submission_types"])}</span>'
            f'</div>'
        )
    if is_gs:
        meta_items.append(
            f'<div class="assignment-meta-item">'
            f'  <span class="badge-gradescope">Gradescope LTI</span>'
            f'</div>'
        )

    meta_row = f'<div class="assignment-preview-meta-row">{"".join(meta_items)}</div>' if meta_items else ""
    prompt_html = render_prompt_html(meta["prompt"])

    card_html = (
        f'<div class="assignment-preview-card">'
        f'  <div class="assignment-preview-header">'
        f'    <div class="assignment-preview-title-row">'
        f'      <div class="assignment-preview-title-wrap">'
        f'        <span class="assignment-preview-icon">{icon}</span>'
        f'        <h2 class="assignment-preview-heading">{html_escape(display_title)}</h2>'
        f'      </div>'
        f'      <div class="assignment-preview-actions">{header_actions}</div>'
        f'    </div>'
        f'    {meta_row}'
        f'  </div>'
        f'  <div class="assignment-preview-body">'
        f'    <div class="assignment-section-label">Assignment Instructions & Prompt</div>'
        f'    <div class="assignment-prompt-content">'
        f'      {prompt_html}'
        f'    </div>'
        f'  </div>'
        f'</div>'
    )

    return {
        "html": card_html,
        "meta": meta,
        "title": display_title,
        "is_gradescope": is_gs
    }


# [Codex] Safe, bounded rendering; original formatting engine by [Antigravity].
MAX_PREVIEW_BYTES = 1024 * 1024
MAX_MARKDOWN_CHARS = 256 * 1024
MAX_TEXT_CHARS = MAX_MARKDOWN_CHARS


def _safe_url(url: str) -> bool:
    """Permit explicit browser links only; never execute archive-provided schemes."""
    if not isinstance(url, str) or any(ord(c) < 33 for c in url):
        return False
    try:
        parsed = urlsplit(url)
        return parsed.scheme.lower() in ("http", "https", "mailto") and bool(
            parsed.netloc if parsed.scheme.lower() != "mailto" else parsed.path)
    except ValueError:
        return False


def _canvas_url(url: str) -> bool:
    try:
        host = (urlsplit(url).hostname or "").lower()
        return host == "bruinlearn.ucla.edu" or host == "instructure.com" or host.endswith(".instructure.com")
    except ValueError:
        return False


def format_markdown(md_text: str, file_path_map: dict = None, course_name: str = "") -> str:
    """Render archive Markdown without ever reparsing generated HTML as Markdown."""
    if not md_text:
        return ""
    truncated = len(md_text) > MAX_MARKDOWN_CHARS
    md_text = md_text[:MAX_MARKDOWN_CHARS].replace("\r\n", "\n")
    file_path_map = {k: v for k, v in (file_path_map or {}).items()
                     if isinstance(k, str) and isinstance(v, str)}
    paths = set(file_path_map.values())
    token = re.compile(r"(`+)(.+?)\1|\[([^]\n]+)\]\(([^)\n]+)\)|https?://[^\s<>\"']+|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|(?<!\*)\*([^*\n]+)\*(?!\*)|(?<![\w_])_([^_\n]+)_(?![\w_])")

    def inline(text):
        # One pass over source tokens: attributes and generated tags are never scanned.
        if len(text) > 8192 or any(text.count(c) > 256 for c in "[`*_"):
            return html_escape(text)
        out, end = [], 0
        for m in token.finditer(text):
            out.append(html_escape(text[end:m.start()]))
            if m.group(1):
                out.append('<code class="inline-code">' + html_escape(m.group(2)) + '</code>')
            elif m.group(3) is not None:
                anchor, url = m.group(3), m.group(4).strip()
                decoded = unquote(url)
                target = decoded if decoded in paths else file_path_map.get(decoded)
                if not target:
                    clean_decoded = html_unescape(decoded).lstrip("./")
                    target = clean_decoded if clean_decoded in paths else file_path_map.get(clean_decoded)
                    if not target:
                        raw_base = Path(decoded).name
                        clean_base = Path(clean_decoded).name
                        if raw_base in file_path_map:
                            target = file_path_map[raw_base]
                        elif clean_base in file_path_map:
                            target = file_path_map[clean_base]

                canonical_target = html_unescape(str(target)).replace("\\", "/") if target else None
                if canonical_target and not (canonical_target.startswith(("/", "\\")) or ".." in Path(canonical_target).parts):
                    href = f"/api/courses/{quote(course_name, safe='')}/files/{quote(canonical_target, safe='/')}" if course_name else "#"
                    out.append(f'<a href="{href}" class="announcement-inline-link inline-file-btn" data-filepath="{html_escape(canonical_target)}" data-title="{html_escape(anchor)}">{html_escape(anchor)}</a>')
                elif _safe_url(url):
                    out.append(linkify_anchor(anchor, url))
                else:
                    out.append(html_escape(anchor))
            elif m.group(0).startswith(('http://', 'https://')):
                url = m.group(0).rstrip(".,;:!?)")
                out.append(linkify_anchor(url, url) + html_escape(m.group(0)[len(url):]))
            else:
                value = next(g for g in m.groups()[4:] if g is not None)
                tag = 'strong' if m.group(5) is not None or m.group(6) is not None else 'del' if m.group(7) is not None else 'em'
                out.append(f'<{tag}>{html_escape(value)}</{tag}>')
            end = m.end()
        out.append(html_escape(text[end:]))
        return ''.join(out)

    def linkify_anchor(anchor, url):
        if _canvas_url(url):
            return '<span style="color:var(--text-muted); font-size:12px;">(Canvas link archived)</span>'
        return f'<a href="{html_escape(url)}" target="_blank" rel="noopener noreferrer" class="announcement-inline-link">{html_escape(anchor)}</a>'

    def cells(line):
        return [c.strip().replace(r'\|', '|') for c in re.split(r'(?<!\\)\|', line.strip().strip('|'))]

    lines, out, i = md_text.splitlines(), [], 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        fence = re.match(r'^\s{0,3}(`{3,}|~{3,})([^`]*)$', line)
        if fence:
            marker, language = fence.groups()
            language = language.strip().split()[0] if language.strip() else ''
            code = []
            i += 1
            while i < len(lines) and not re.fullmatch(r'\s{0,3}' + re.escape(marker[0]) + '{' + str(len(marker)) + r',}\s*', lines[i]):
                code.append(lines[i]); i += 1
            out.append(f'<pre class="code-block"><code class="language-{html_escape(language)}">{html_escape(chr(10).join(code))}</code></pre>')
            i += 1
            continue
        if '|' in line and i + 1 < len(lines):
            headers, separators = cells(line), cells(lines[i + 1])
            if len(headers) == len(separators) and all(re.fullmatch(r':?-{3,}:?', c) for c in separators):
                rows = []
                i += 2
                while i < len(lines) and '|' in lines[i] and lines[i].strip():
                    row = (cells(lines[i]) + [''] * len(headers))[:len(headers)]
                    rows.append('<tr>' + ''.join('<td>' + inline(c) + '</td>' for c in row) + '</tr>'); i += 1
                out.append('<div class="rich-table-wrapper"><table class="rich-table"><thead><tr>' + ''.join('<th>' + inline(c) + '</th>' for c in headers) + '</tr></thead><tbody>' + ''.join(rows) + '</tbody></table></div>')
                continue
        heading = re.match(r'^(#{1,6})\s+(.+)$', line)
        if heading:
            level = len(heading.group(1))
            out.append(f'<h{level} class="rich-h{level}">{inline(heading.group(2))}</h{level}>')
        elif re.fullmatch(r'\s*(?:-{3,}|\*{3,}|_{3,})\s*', line):
            out.append('<hr class="rich-hr">')
        elif line.startswith('>'):
            out.append('<blockquote class="rich-blockquote">' + inline(line[1:].lstrip()) + '</blockquote>')
        elif re.match(r'^\s*(?:[-*+] |\d+\. )', line):
            ordered = bool(re.match(r'^\s*\d+\.', line))
            pattern = r'^\s*\d+\.\s+(.+)' if ordered else r'^\s*[-*+]\s+(.+)'
            items = []
            while i < len(lines):
                item = re.match(pattern, lines[i])
                if not item: break
                items.append('<li>' + inline(item.group(1)) + '</li>'); i += 1
            tag = 'ol' if ordered else 'ul'
            out.append(f'<{tag} class="rich-{tag}">' + ''.join(items) + f'</{tag}>')
            continue
        else:
            if '?' in line and i + 1 < len(lines) and re.match(r'^(?:Yes|No|Sure)\b', lines[i + 1].strip()):
                answer = []
                i += 1
                while i < len(lines) and lines[i].strip():
                    answer.append(inline(lines[i])); i += 1
                out.append('<p>' + inline(line) + '</p><div class="announcement-qa-answer">' + '<br>'.join(answer) + '</div>')
                continue
            # Separate paragraphs keep following headings/lists structurally valid.
            out.append('<p>' + inline(line) + '</p>')
        i += 1
    if truncated:
        out.append('<p class="preview-truncated">Preview truncated; open the original file to view the remainder.</p>')
    return '\n'.join(out)


def format_markdown_preview(filename: str, raw_text: str, file_path_map: dict = None, course_name: str = "") -> dict:
    """Format a Markdown document into a .text-reader-card container."""
    body_html = format_markdown(raw_text, file_path_map=file_path_map, course_name=course_name)
    line_count = len(raw_text.splitlines())
    html_out = (
        f'<div class="text-reader-card">'
        f'  <div class="text-reader-header">'
        f'    <span style="font-size:13px; font-weight:600; color:var(--text-main); display:flex; align-items:center; gap:8px;">'
        f'      📄 {html_escape(filename)}'
        f'    </span>'
        f'    <span style="font-size:12px; color:var(--text-muted);">{line_count} lines</span>'
        f'  </div>'
        f'  <div class="markdown-reader-content">'
        f'    {body_html}'
        f'  </div>'
        f'</div>'
    )
    return {
        "html": html_out,
        "lines": line_count
    }


def format_text_file(filename: str, raw_text: str, ext: str) -> dict:
    """Format a code or plain text file into a styled .text-reader-card container."""
    line_count = len(raw_text.splitlines())
    escaped_text = html_escape(raw_text)
    html_out = (
        f'<div class="text-reader-card">'
        f'  <div class="text-reader-header">'
        f'    <span style="font-size:13px; font-weight:600; color:var(--text-main); display:flex; align-items:center; gap:8px;">'
        f'      📄 {html_escape(filename)}'
        f'    </span>'
        f'    <span style="font-size:12px; color:var(--text-muted);">{line_count} lines</span>'
        f'  </div>'
        f'  <pre class="text-reader-content">{escaped_text}</pre>'
        f'</div>'
    )
    return {
        "html": html_out,
        "lines": line_count
    }


def format_image_preview(filename: str, file_url: str) -> dict:
    """Format an image into a centered viewer container."""
    html_out = (
        f'<div class="image-preview-container" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; min-height:350px;">'
        f'  <img src="{html_escape(file_url)}" alt="{html_escape(filename)}" style="max-width:100%; max-height:75vh; border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,0.3); object-fit:contain;">'
        f'  <div style="margin-top:16px; font-size:13px; color:var(--text-muted);">{html_escape(filename)}</div>'
        f'</div>'
    )
    return {
        "html": html_out
    }


DOCX_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
DOCX_R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
DOCX_A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
DOCX_V_NS = "urn:schemas-microsoft-com:vml"

MAX_DOCX_FILE_BYTES = 64 * 1024 * 1024
MAX_DOCX_XML_BYTES = 16 * 1024 * 1024
MAX_DOCX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_DOCX_SINGLE_IMAGE = 8 * 1024 * 1024
MAX_DOCX_PARAGRAPHS = 4000
MAX_DOCX_OUTPUT_BYTES = 8 * 1024 * 1024
MAX_DOCX_NODES = 50_000
MAX_DOCX_IMAGE_REFERENCES = 256


class DocxPreviewLimit(ValueError):
    """[Codex] A document exceeded the bounded in-process rendering budget."""


class _DocxBudget:
    def __init__(self):
        self.remaining = MAX_DOCX_OUTPUT_BYTES
        self.references = 0

    def charge(self, size, *, image=False):
        if image:
            self.references += 1
        self.remaining -= size
        if self.remaining < 0 or self.references > MAX_DOCX_IMAGE_REFERENCES:
            raise DocxPreviewLimit("Word preview exceeds the output safety limit")

    def text(self, value):
        self.charge(len(value.encode("utf-8")))
        return value


DOCX_MIME_MAP = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
}


def _extract_docx_drawing(elem, image_map: dict, budget) -> str:
    """Extract embedded image data URI from drawing or pict elements."""
    for blip in elem.findall(f'.//{{{DOCX_A_NS}}}blip'):
        rid = blip.get(f'{{{DOCX_R_NS}}}embed') or blip.get('embed')
        if rid in image_map:
            budget.charge(len(image_map[rid]) + 180, image=True)
            return f'<div class="docx-image-wrapper"><img src="{image_map[rid]}" class="docx-embedded-image" alt="Embedded Document Image" /></div>'
    for img_data in elem.findall(f'.//{{{DOCX_V_NS}}}imagedata'):
        rid = img_data.get(f'{{{DOCX_R_NS}}}id') or img_data.get('id')
        if rid in image_map:
            budget.charge(len(image_map[rid]) + 180, image=True)
            return f'<div class="docx-image-wrapper"><img src="{image_map[rid]}" class="docx-embedded-image" alt="Embedded Document Image" /></div>'
    return ''


def _format_docx_run(r, image_map: dict, budget) -> str:
    """Format a single Word run element with inline styling."""
    rPr = r.find(f'{{{DOCX_W_NS}}}rPr')
    b = rPr is not None and (rPr.find(f'{{{DOCX_W_NS}}}b') is not None)
    i = rPr is not None and (rPr.find(f'{{{DOCX_W_NS}}}i') is not None)
    u = rPr is not None and (rPr.find(f'{{{DOCX_W_NS}}}u') is not None)
    s = rPr is not None and (rPr.find(f'{{{DOCX_W_NS}}}strike') is not None)

    vert = rPr.find(f'{{{DOCX_W_NS}}}vertAlign') if rPr is not None else None
    vert_val = (vert.get(f'{{{DOCX_W_NS}}}val') or '').lower() if vert is not None else ''
    is_sup = vert_val == 'superscript'
    is_sub = vert_val == 'subscript'

    # Check drawing inside run
    dw = r.find(f'{{{DOCX_W_NS}}}drawing')
    if dw is not None:
        dw_html = _extract_docx_drawing(dw, image_map, budget)
        if dw_html:
            return dw_html
    pict = r.find(f'{{{DOCX_W_NS}}}pict')
    if pict is not None:
        dw_html = _extract_docx_drawing(pict, image_map, budget)
        if dw_html:
            return dw_html

    run_txt = []
    for child in r:
        ctag = child.tag.split('}')[-1]
        if ctag == 't':
            run_txt.append(child.text or '')
        elif ctag == 'br':
            run_txt.append('\n')
        elif ctag == 'tab':
            run_txt.append('\t')

    t_str = ''.join(run_txt)
    if not t_str:
        return ''
    esc = html_escape(t_str)
    if '\n' in esc:
        esc = esc.replace('\n', '<br>')
    if '\t' in esc:
        esc = esc.replace('\t', '&emsp;')
    if is_sub:
        esc = f'<sub>{esc}</sub>'
    if is_sup:
        esc = f'<sup>{esc}</sup>'
    if b:
        esc = f'<strong>{esc}</strong>'
    if i:
        esc = f'<em>{esc}</em>'
    if u:
        esc = f'<u>{esc}</u>'
    if s:
        esc = f'<s>{esc}</s>'
    return budget.text(esc)


def _format_docx_p_content(p_elem, image_map: dict, hyperlink_rels: dict, file_path_map: dict = None, course_name: str = "", budget=None) -> str:
    """Extract and format paragraph contents into HTML."""
    budget = budget or _DocxBudget()
    budget.charge(128)
    parts = []
    enc_course = quote(course_name, safe='') if course_name else ''
    for child in p_elem:
        tag = child.tag.split('}')[-1]
        if tag == 'r':
            parts.append(_format_docx_run(child, image_map, budget))
        elif tag == 'hyperlink':
            r_id = child.get(f'{{{DOCX_R_NS}}}id') or child.get('id')
            url = hyperlink_rels.get(r_id, '')
            budget.charge(256 + 6 * len(url.encode("utf-8")))
            link_content = ''.join(_format_docx_run(r, image_map, budget) for r in child.findall(f'.//{{{DOCX_W_NS}}}r'))
            if url and link_content:
                clean_url = unquote(url).strip()
                matched_path = None
                if file_path_map:
                    clean_decoded = html_unescape(clean_url).lstrip("./")
                    raw_base = Path(clean_url).name
                    clean_base = Path(clean_decoded).name
                    if clean_url in file_path_map:
                        matched_path = file_path_map[clean_url]
                    elif clean_decoded in file_path_map:
                        matched_path = file_path_map[clean_decoded]
                    elif raw_base in file_path_map:
                        matched_path = file_path_map[raw_base]
                    elif clean_base in file_path_map:
                        matched_path = file_path_map[clean_base]

                if matched_path and enc_course:
                    budget.charge(12 * len(str(matched_path).encode("utf-8")) + 3 * len(enc_course) + 256)
                    canonical_path = html_unescape(str(matched_path)).replace("\\", "/")
                    enc_path = quote(canonical_path, safe='/')
                    safe_title = html_escape(Path(canonical_path).name)
                    safe_path = html_escape(canonical_path)
                    parts.append(f'<a href="/api/courses/{enc_course}/files/{enc_path}" class="docx-link inline-file-btn" data-filepath="{safe_path}" data-title="{safe_title}">{link_content}</a>')
                elif _canvas_url(url):
                    parts.append(f'{link_content} <span style="color:var(--text-muted); font-size:12px;">(Canvas link archived)</span>')
                elif _safe_url(url):
                    safe_url = html_escape(url)
                    parts.append(f'<a href="{safe_url}" target="_blank" rel="noopener noreferrer" class="docx-link">{link_content}</a>')
                else:
                    parts.append(link_content)
            elif link_content:
                parts.append(link_content)
        elif tag == 'drawing':
            img_html = _extract_docx_drawing(child, image_map, budget)
            if img_html:
                parts.append(img_html)
        elif tag in ('sdt', 'smartTag'):
            for r in child.findall(f'.//{{{DOCX_W_NS}}}r'):
                parts.append(_format_docx_run(r, image_map, budget))
    return ''.join(parts)


def _format_docx_table(tbl_elem, image_map: dict, hyperlink_rels: dict, file_path_map: dict = None, course_name: str = "", budget=None) -> str:
    """Format a Word table into a responsive HTML table."""
    budget = budget or _DocxBudget()
    budget.charge(256)
    rows_html = []
    for tr in tbl_elem.findall(f'{{{DOCX_W_NS}}}tr'):
        budget.charge(32)
        cells_html = []
        for tc in tr.findall(f'{{{DOCX_W_NS}}}tc'):
            budget.charge(128)
            colspan = ''
            grid_span = tc.find(f'.//{{{DOCX_W_NS}}}gridSpan')
            if grid_span is not None:
                val = grid_span.get(f'{{{DOCX_W_NS}}}val')
                if val and val.isdigit() and int(val) > 1:
                    colspan = f' colspan="{val}"'

            cell_p_parts = []
            for p in tc.findall(f'{{{DOCX_W_NS}}}p'):
                p_text = _format_docx_p_content(p, image_map, hyperlink_rels, file_path_map=file_path_map, course_name=course_name, budget=budget)
                if p_text:
                    cell_p_parts.append(p_text)
            cell_content = '<br>'.join(cell_p_parts) if cell_p_parts else '&nbsp;'
            cells_html.append(f'<td{colspan}>{cell_content}</td>')
        if cells_html:
            rows_html.append(f'<tr>{" ".join(cells_html)}</tr>')
    if rows_html:
        return f'<div class="docx-table-wrapper"><table class="docx-table"><tbody>{" ".join(rows_html)}</tbody></table></div>'
    return ''


def _parse_docx_xml(data):
    """[Codex] Reject excessive XML work while the tree is being built."""
    count = depth = 0
    parser = ElementTree.iterparse(io.BytesIO(data), events=('start', 'end'))
    for event, _ in parser:
        if event == 'start':
            count += 1
            depth += 1
            if count > MAX_DOCX_NODES or depth > 64:
                raise DocxPreviewLimit('Word XML exceeds structural limits')
        else:
            depth -= 1
    return parser.root


def _read_docx_xml(archive, name):
    """[Codex] Reject expansion before allocation, including relationship XML."""
    if archive.getinfo(name).file_size > MAX_DOCX_XML_BYTES:
        raise ValueError('Word document XML exceeds safety limit')
    with archive.open(name) as stream:
        data = stream.read(MAX_DOCX_XML_BYTES + 1)
    if len(data) > MAX_DOCX_XML_BYTES:
        raise ValueError('Word document XML exceeds safety limit')
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('XML declarations are not supported')
    return data


def format_docx_preview(filename: str, target_file: Path, course_name: str = "", file_path_map: dict = None) -> dict:
    """
    Format a Microsoft Word (.docx) document into a rich, dark-theme-styled HTML document.
    Extracts text, typography, headings, tables, hyperlinks, and embedded images as data URIs.
    """
    if target_file.stat().st_size > MAX_DOCX_FILE_BYTES:
        raise ValueError('Word document exceeds preview file size limit')

    with zipfile.ZipFile(target_file) as z:
        namelist = set(z.namelist())
        if 'word/document.xml' not in namelist:
            raise ValueError('Invalid Word document: missing document.xml')

        image_rels = {}
        hyperlink_rels = {}
        if 'word/_rels/document.xml.rels' in namelist:
            rels_xml = _read_docx_xml(z, 'word/_rels/document.xml.rels')
            if b'<!DOCTYPE' in rels_xml.upper() or b'<!ENTITY' in rels_xml.upper():
                raise ValueError('XML declarations are not supported')
            rels_tree = _parse_docx_xml(rels_xml)
            for rel in rels_tree:
                rid = rel.get('{http://schemas.openxmlformats.org/package/2006/relationships}Id') or rel.get('Id')
                target = rel.get('Target')
                rtype = rel.get('Type') or ''
                if rid and target:
                    if 'hyperlink' in rtype.lower():
                        hyperlink_rels[rid] = target
                    elif 'image' in rtype.lower() or target.startswith('media/'):
                        clean_target = 'word/' + target.lstrip('/') if not target.startswith('word/') else target
                        image_rels[rid] = clean_target

        image_map = {}
        total_img = 0
        for rid, target in image_rels.items():
            if target in namelist:
                ext = Path(target).suffix.lower()
                if ext in DOCX_MIME_MAP:
                    info = z.getinfo(target)
                    if info.file_size <= MAX_DOCX_SINGLE_IMAGE and (total_img + info.file_size) <= MAX_DOCX_IMAGE_BYTES:
                        data = z.read(target)
                        total_img += len(data)
                        b64 = base64.b64encode(data).decode('ascii')
                        image_map[rid] = f'data:{DOCX_MIME_MAP[ext]};base64,{b64}'

        xml_bytes = _read_docx_xml(z, 'word/document.xml')
        if b'<!DOCTYPE' in xml_bytes.upper() or b'<!ENTITY' in xml_bytes.upper():
            raise ValueError('XML declarations are not supported')
        if len(xml_bytes) > MAX_DOCX_XML_BYTES:
            raise ValueError('Word document XML exceeds safety limit')

        tree = _parse_docx_xml(xml_bytes)
        if sum(1 for _ in tree.iter()) > MAX_DOCX_NODES:
            raise DocxPreviewLimit("Word preview has too many document elements")
        budget = _DocxBudget()
        budget.charge(2048)
        body = tree.find(f'{{{DOCX_W_NS}}}body')
        if body is None:
            raise ValueError('Word document body is missing')

        html_blocks = []
        para_count = 0
        table_count = 0

        for child in body:
            tag = child.tag.split('}')[-1]
            if tag == 'p':
                para_count += 1
                if para_count > MAX_DOCX_PARAGRAPHS:
                    html_blocks.append('<p class="preview-truncated">Preview truncated; open the original file to view the remainder.</p>')
                    break

                jc = child.find(f'.//{{{DOCX_W_NS}}}jc')
                align = jc.get(f'{{{DOCX_W_NS}}}val') if jc is not None else None
                budget.charge(128)
                align_style = f' style="text-align:{align};"' if align in ('center', 'right', 'justify') else ''

                pStyle = child.find(f'.//{{{DOCX_W_NS}}}pStyle')
                sval = (pStyle.get(f'{{{DOCX_W_NS}}}val') or '').lower() if pStyle is not None else ''

                tag_name = 'p'
                if 'heading1' in sval: tag_name = 'h2'
                elif 'heading2' in sval: tag_name = 'h3'
                elif 'heading3' in sval: tag_name = 'h4'
                elif 'title' in sval: tag_name = 'h1'

                content = _format_docx_p_content(child, image_map, hyperlink_rels, file_path_map=file_path_map, course_name=course_name, budget=budget)
                numPr = child.find(f'.//{{{DOCX_W_NS}}}numPr')

                if not content.strip():
                    html_blocks.append('<p class="docx-empty-p">&nbsp;</p>')
                elif numPr is not None:
                    html_blocks.append(f'<div class="docx-list-item"{align_style}><span class="docx-bullet">•</span><div>{content}</div></div>')
                else:
                    html_blocks.append(f'<{tag_name}{align_style}>{content}</{tag_name}>')

            elif tag == 'tbl':
                table_count += 1
                tbl_html = _format_docx_table(child, image_map, hyperlink_rels, file_path_map=file_path_map, course_name=course_name, budget=budget)
                if tbl_html:
                    html_blocks.append(tbl_html)

        html_body = '\n'.join(html_blocks)
        html_out = (
            f'<div class="text-reader-card docx-reader-card">'
            f'  <div class="text-reader-header">'
            f'    <span style="font-size:13px; font-weight:600; color:var(--text-main); display:flex; align-items:center; gap:8px;">'
            f'      📄 {html_escape(filename)}'
            f'    </span>'
            f'    <span style="font-size:12px; color:var(--text-muted);">{para_count} paragraphs · Word Document</span>'
            f'  </div>'
            f'  <div class="docx-reader-content">'
            f'    {html_body}'
            f'  </div>'
            f'</div>'
        )

        return {
            "html": html_out,
            "paragraphs": para_count,
            "images": len(image_map),
            "tables": table_count
        }


def format_document_preview(
    target_file: Path,
    relative_path: str,
    course_name: str = "",
    file_path_map: dict = None
) -> dict:
    """
    Unified dispatcher: inspects file path and content, performs all necessary
    server-side parsing and formatting, and returns a rich JSON payload.
    """
    file_stat = target_file.stat()
    file_size = file_stat.st_size
    formatted_sz = format_size(file_size)
    ext = target_file.suffix.lower()
    enc_course = quote(course_name, safe='')
    file_url = f"/api/courses/{enc_course}/files/{quote(relative_path, safe='/')}"

    # 1. PDF Files: return viewer_url for PDF.js
    if ext == ".pdf":
        mtime = file_stat.st_mtime_ns
        viewer_url = f"/static/pdfjs/web/viewer.html?file={quote(file_url, safe='')}&t={mtime}"
        return {
            "type": "pdf",
            "url": file_url,
            "viewer_url": viewer_url,
            "extension": ext,
            "size": file_size,
            "formatted_size": formatted_sz,
            "formatted_html": None
        }

    # 2. Image formats
    if ext in [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]:
        img_res = format_image_preview(target_file.name, file_url)
        return {
            "type": "image",
            "url": file_url,
            "extension": ext,
            "size": file_size,
            "formatted_size": formatted_sz,
            "formatted_html": img_res["html"]
        }

    # 3. Text-based files: read content and determine type
    if ext in [".txt", ".md", ".py", ".json", ".csv", ".sh", ".r", ".sql", ".yaml", ".yml", ".html"]:
        try:
            with target_file.open("rb") as source:
                content = source.read(MAX_PREVIEW_BYTES + 1)
            raw_text = content[:MAX_PREVIEW_BYTES].decode("utf-8", errors="replace")
            if len(content) > MAX_PREVIEW_BYTES:
                raw_text += "\n\nPreview truncated; open the original file to view the remainder."
        except OSError:
            raise

        # Check for assignment prompt file
        if is_assignment_file(target_file.name, raw_text):
            assign_res = format_assignment_preview(target_file.name, relative_path, raw_text, course_name)
            return {
                "type": "assignment",
                "url": file_url,
                "extension": ext,
                "size": file_size,
                "formatted_size": formatted_sz,
                "formatted_html": assign_res["html"],
                "meta": assign_res["meta"],
                "title": assign_res["title"],
                "is_gradescope": assign_res["is_gradescope"]
            }

        # Markdown files
        if ext == ".md":
            md_res = format_markdown_preview(target_file.name, raw_text, file_path_map=file_path_map, course_name=course_name)
            return {
                "type": "markdown",
                "url": file_url,
                "extension": ext,
                "size": file_size,
                "formatted_size": formatted_sz,
                "formatted_html": md_res["html"],
                "lines": md_res["lines"]
            }

        # Generic code / plain text
        txt_res = format_text_file(target_file.name, raw_text, ext)
        return {
            "type": "text",
            "url": file_url,
            "extension": ext,
            "size": file_size,
            "formatted_size": formatted_sz,
            "formatted_html": txt_res["html"],
            "lines": txt_res["lines"]
        }

    # 4. Word Documents (.docx)
    if ext == ".docx":
        try:
            docx_res = format_docx_preview(
                filename=target_file.name,
                target_file=target_file,
                course_name=course_name,
                file_path_map=file_path_map
            )
            if docx_res and docx_res.get("html"):
                return {
                    "type": "docx",
                    "url": file_url,
                    "extension": ext,
                    "size": file_size,
                    "formatted_size": formatted_sz,
                    "formatted_html": docx_res["html"],
                    "paragraphs": docx_res.get("paragraphs", 0),
                    "images": docx_res.get("images", 0),
                    "tables": docx_res.get("tables", 0)
                }
        except Exception:
            # [Codex] A rejected DOCX must not bypass bounds through native preview.
            return {"type": "fallback", "url": file_url, "extension": ext,
                    "size": file_size, "formatted_size": formatted_sz,
                    "formatted_html": None}

    # 5. Presentation & Other Office Formats (PPTX/PPT/KEY/DOC)
    if ext in [".pptx", ".ppt", ".key", ".docx", ".doc"]:
        try:
            from .previews import generate_document_preview
        except ImportError:
            from previews import generate_document_preview
        preview_url = generate_document_preview(target_file)
        if preview_url:
            return {
                "type": "html_preview",
                "url": preview_url,
                "extension": ext,
                "size": file_size,
                "formatted_size": formatted_sz,
                "formatted_html": None
            }

    # 6. Fallback for binaries
    return {
        "type": "fallback",
        "url": file_url,
        "extension": ext,
        "size": file_size,
        "formatted_size": formatted_sz,
        "formatted_html": None
    }


def calculate_assignment_status(assignment: dict, now: datetime = None) -> str:
    """
    Pre-calculate assignment status: 'submitted' | 'missing' | 'unsubmitted'.
    Evaluates due dates against UTC/local timestamp so the frontend doesn't need to run Date comparisons.
    """
    if not isinstance(assignment, dict):
        return "unsubmitted"

    # [Codex] Treat graded submissions as submitted, preserving the public status enum.
    sub_status = str(assignment.get("submission_status") or "").strip().lower()
    stored_status = str(assignment.get("status") or "").strip().lower()
    if sub_status in {"submitted", "graded"} or assignment.get("submitted_at") or stored_status in {"submitted", "graded"}:
        return "submitted"
    if sub_status == "missing" or stored_status == "missing":
        return "missing"

    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    # Only consult the display fallback when the canonical deadline cannot be parsed.
    due = _assignment_deadline(assignment.get("due_date"))
    if due is None:
        due = _assignment_deadline(assignment.get("due"), end_of_day=True)
    return "missing" if due is not None and due < now else "unsubmitted"


def _assignment_deadline(raw, *, end_of_day=False):
    """[Codex] Parse offset-aware ISO or archived clock text without dropping PM/offsets."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    raw = raw.strip()
    try:
        result = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if end_of_day and re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            result = result.replace(hour=23, minute=59, second=59)
    except ValueError:
        result = None
        for pattern in ("%Y-%m-%d %I:%M %p", "%Y-%m-%d %I:%M%p", "%Y-%m-%d %I:%M:%S %p"):
            try:
                result = datetime.strptime(raw, pattern)
                break
            except ValueError:
                continue
        if result is None:
            return None
    return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result


def _finite_grade(value):
    """[Codex] Untrusted numeric fields must remain valid JSON numbers."""
    if isinstance(value, bool):
        return 0.0
    try:
        value = float(value)
        return value if math.isfinite(value) else 0.0
    except (ValueError, TypeError, OverflowError):
        return 0.0


def _add_grade(total, value):
    """Keep even pathological aggregate totals representable as JSON floats."""
    result = total + value
    return result if math.isfinite(result) else math.copysign(sys.float_info.max, result)


def calculate_grade_summary(assignments: list) -> dict:
    """
    Pre-calculate grade summary metrics across assignment groups:
      - categories: List of {"name": str, "score": float, "possible": float, "formatted": str}
      - total_score: float
      - total_possible: float
      - formatted_total: e.g. "485.50 / 500.00"
      - total_assignments: int
    """
    if not isinstance(assignments, list):
        assignments = []

    groups = collections.OrderedDict()
    total_score = 0.0
    total_possible = 0.0

    for a in assignments:
        if not isinstance(a, dict):
            continue
        g = str(a.get("group") or "Assignments").strip() or "Assignments"
        if g not in groups:
            groups[g] = {"score": 0.0, "possible": 0.0}

        pts = _finite_grade(a.get("points"))
        sc = _finite_grade(a.get("score"))
        groups[g]["possible"] = _add_grade(groups[g]["possible"], pts)
        groups[g]["score"] = _add_grade(groups[g]["score"], sc)
        total_possible = _add_grade(total_possible, pts)
        total_score = _add_grade(total_score, sc)

    categories = []
    for g_name, g_data in groups.items():
        sc = round(g_data["score"], 2)
        pos = round(g_data["possible"], 2)
        categories.append({
            "name": g_name,
            "score": sc,
            "possible": pos,
            "formatted": f"{sc:.2f} / {pos:.2f}"
        })

    total_score = round(total_score, 2)
    total_possible = round(total_possible, 2)

    return {
        "categories": categories,
        "total_score": total_score,
        "total_possible": total_possible,
        "formatted_total": f"{total_score:.2f} / {total_possible:.2f}",
        "total_assignments": sum(isinstance(a, dict) for a in assignments)
    }


def format_syllabus_html(raw_body: str, file_path_map: dict = None, course_name: str = "") -> str:
    """
    Pre-compile raw syllabus text/markdown into clean, rich HTML with resolved file links
    and stripped Canvas boilerplate headers.
    """
    if not raw_body or not isinstance(raw_body, str):
        return ""
    clean_syl = raw_body
    clean_syl = re.sub(r'^(?:Title|URL):[^\r\n]*(?:\r?\n|$)', '', clean_syl, flags=re.MULTILINE)
    clean_syl = re.sub(r'Course Syllabus\s+Jump to Today', '', clean_syl, flags=re.IGNORECASE)
    clean_syl = re.sub(r'Syllabus\s+Actions', '', clean_syl, flags=re.IGNORECASE)
    clean_syl = re.sub(r'Links to an external site\.', '', clean_syl, flags=re.IGNORECASE)
    return format_markdown(clean_syl.strip(), file_path_map=file_path_map, course_name=course_name)

