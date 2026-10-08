# canvas_capturer.py
# Dedicated Document Capturer: handles multi-file extraction, CDP visual PDF printing,
# Canvas Ally Alternative Formats ('A↓') downloads, and text fallbacks.

import os
import re
import time
import base64
from urllib.parse import urlparse, unquote
from safety import contained_path, unique_destination, bounded_pdf_text

try:
    import pypdf
except ImportError:
    pypdf = None


def sanitize_filename(name: str) -> str:
    """Remove characters and device names unsafe on macOS or Windows."""
    name = unquote(name)
    name = re.sub(r'[\\/*?:"<>|\x00-\x1f]', '_', name)
    name = re.sub(r'_+', '_', name)  # Collapse multiple underscores
    name = (name.strip().rstrip(". ") or "document")[:150]
    if re.match(r'(?i)^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', name):
        name = '_' + name
    return name


def verify_pdf_has_text(pdf_path: str, min_chars: int = 30) -> bool:
    """Checks if a generated PDF contains meaningful text content."""
    return len(bounded_pdf_text(pdf_path, 3, max(min_chars, 400)).strip()) >= min_chars


def normalize_canvas_download_url(url: str, netloc: str = "bruinlearn.ucla.edu", course_id: str = "") -> str:
    """Normalizes Canvas file download URLs, preventing double '/download/download'
    and ensuring proper course path structure."""
    if not url:
        return ""
    full = url if url.startswith("http") else f"https://{netloc}{url}"
    base = full.split("?")[0].rstrip("/")
    while base.endswith("/download"):
        base = base[:-9].rstrip("/")

    if "/files/" in base:
        if course_id and f"/courses/{course_id}" not in base:
            m = re.search(r'/files/(\d+)', base)
            if m:
                from urllib.parse import urlparse
                host = urlparse(base).netloc or netloc
                base = f"https://{host}/courses/{course_id}/files/{m.group(1)}"
        return base + "/download"
    return full


def extract_multi_file_links(page, item_title: str) -> list:
    """Tier 1: Multi-file extraction - finds ALL downloadable file links on a page."""
    file_urls = []
    links = page.query_selector_all("a[href]")
    seen = set()
    netloc = urlparse(page.url).netloc

    for link in links:
        href = link.get_attribute("href") or ""
        link_text = link.inner_text().strip()
        if "/files/" in href or re.search(r'\.(pdf|docx?|pptx?|xlsx?|zip|py|mat|csv|epub)$', href, re.IGNORECASE):
            full_url = normalize_canvas_download_url(href, netloc=netloc)
            if full_url not in seen:
                seen.add(full_url)
                file_urls.append({
                    "url": full_url,
                    "title": link_text or item_title,
                    "page_title": item_title
                })

    return file_urls


def try_canvas_ally_alternative_format(page, title: str, temp_dir: str) -> str:
    """Tier 3: Attempts to download page via Canvas Ally Alternative Formats button ('A↓')."""
    clean_name = sanitize_filename(title)
    ally_selectors = [
        "a.alloy-alt-formats-btn",
        "button[title*='Alternative']",
        "a[title*='Alternative']",
        ".instructure_file_link",
        "a:has-text('Alternative formats')",
        "button:has-text('Alternative formats')"
    ]

    ally_btn = None
    for sel in ally_selectors:
        try:
            if page.query_selector(sel):
                ally_btn = page.locator(sel).first
                break
        except Exception:
            pass

    if not ally_btn:
        return ""

    print(f"   🎯 Tier 3: Found Canvas Ally 'Alternative Formats' button for '{clean_name}'. Clicking...")
    try:
        ally_btn.click(timeout=3000)
        time.sleep(2)

        # Look for ePub or Tagged PDF options in Ally modal
        option_selectors = [
            "input[value*='epub']",
            "label:has-text('ePub')",
            "label:has-text('Tagged PDF')",
            "input[value*='pdf']",
            "button:has-text('Download')"
        ]

        for opt_sel in option_selectors:
            if page.query_selector(opt_sel):
                page.locator(opt_sel).first.click(timeout=2000)
                break

        # Click Download inside modal
        download_btn = page.locator("button:has-text('Download'), input[type='submit'][value*='Download']").first
        with page.expect_download(timeout=10000) as download_info:
            download_btn.click()

        download = download_info.value
        downloaded_path = unique_destination(contained_path(temp_dir, sanitize_filename(f"{clean_name}_{download.suggested_filename}")))
        download.save_as(downloaded_path)
        print(f"   📥 Tier 3 Success: Downloaded Ally Alternative Format: '{os.path.basename(downloaded_path)}'")
        return downloaded_path
    except Exception as e:
        print(f"   ℹ️ Canvas Ally download skipped or timed out: {e}")
        return ""


def print_page_to_pdf_with_fallback(page, title: str, temp_dir: str) -> str:
    """4-Tier Universal Document Capture Pipeline:
    Tier 1: Direct File Downloads & Multi-File Extraction
    Tier 2: CDP Visual Page-to-PDF Print (captures full images & visual layout)
    Tier 3: Canvas Ally Alternative Formats ('A↓') Auto-Download
    Tier 4: Clean Page Text (.txt) Fallback
    """
    clean_name = sanitize_filename(title)
    pdf_path = unique_destination(contained_path(temp_dir, f"{clean_name}.pdf"))
    txt_path = unique_destination(contained_path(temp_dir, f"{clean_name}.txt"))

    # Extract raw page text for validation comparison
    try:
        raw_text = page.inner_text(".show-content, #content, body")
    except Exception:
        raw_text = ""

    # Tier 2: CDP Visual Page-to-PDF Print (captures full visual layout & images)
    try:
        cdp = page.context.new_cdp_session(page)
        try:
            pdf_data = cdp.send("Page.printToPDF", {
                "printBackground": True,
                "preferCSSPageSize": True,
                "displayHeaderFooter": False
            })
        finally:
            try:
                cdp.detach()
            except Exception:
                pass

        with open(pdf_path, "wb") as f:
            f.write(base64.b64decode(pdf_data["data"]))

        if verify_pdf_has_text(pdf_path, min_chars=30):
            print(f"   🖼️ Tier 2 Success: Saved visual page PDF with images: '{clean_name}.pdf'")
            return pdf_path
        else:
            # Clean up rejected PDF without text so downstream doesn't process blank file
            try:
                if os.path.exists(pdf_path):
                    os.remove(pdf_path)
            except Exception:
                pass
    except Exception as e:
        print(f"   ℹ️ Tier 2 CDP print notice: {e}")

    # Tier 3: Canvas Ally Alternative Formats ('A↓')
    ally_file = try_canvas_ally_alternative_format(page, title, temp_dir)
    if ally_file:
        return ally_file

    # Tier 4: Text Fallback (.txt)
    if raw_text and len(raw_text.strip()) > 20:
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(f"Title: {title}\n")
            f.write(f"URL: {page.url}\n\n")
            f.write(raw_text.strip())
        print(f"   📄 Tier 4 Success: Saved page text content: '{clean_name}.txt'")
        return txt_path

    return ""
