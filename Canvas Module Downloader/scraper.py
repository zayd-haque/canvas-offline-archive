# canvas_launcher.py
# Handles browser authentication, syllabus scraping, modules navigation,
# and page-to-PDF printing for pages without downloadable attachments.

import os
import re
import json
import time
import base64
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, Error as PlaywrightError
from sleep_helper import wait_for_network_resume, check_internet_connection

from capturer import sanitize_filename, print_page_to_pdf_with_fallback, normalize_canvas_download_url, verify_pdf_has_text
from comprehensive_crawlers import (
    discover_course_tabs,
    scrape_grades_and_feedback,
    scrape_all_discussions,
    scrape_unlinked_pages,
    scrape_quizzes_and_reviews,
    scrape_media_recordings,
    audit_generic_tab
)
from canvas_blueprint import CourseBlueprint
from safety import resolve_course_root, validate_tree, contained_path


def scrape_syllabus(page, course_url: str, temp_dir: str, blueprint=None) -> list:
    """Navigates to the Canvas syllabus page.
    - If an official syllabus PDF/doc attachment is found: enqueues it for download, captures a visual snapshot,
      and caches syllabus text without dumping raw Syllabus.txt into the course directory.
    - If the course uses the Canvas syllabus page directly: formats the syllabus DOM into clean Markdown (Syllabus.md)
      with tables and preserved links, and prints a clean visual PDF (Syllabus.pdf).
    """
    syllabus_downloads = []
    parsed = urlparse(course_url)
    course_match = re.search(r'(/courses/\d+)', parsed.path)
    if not course_match:
        print("   ⚠️ Could not determine course path for syllabus.")
        return syllabus_downloads

    syllabus_url = f"{parsed.scheme}://{parsed.netloc}{course_match.group(1)}/assignments/syllabus"

    print(f"\n📖 Checking for Syllabus page...")
    try:
        page.goto(syllabus_url, wait_until="domcontentloaded")
        time.sleep(2)

        # 1. Check for official syllabus PDF or doc attachments on the page
        links = page.query_selector_all("a[href], iframe[src], embed[src]")
        seen_urls = set()
        official_pdf_items = []

        course_id = course_match.group(1).replace("/courses/", "") if course_match else ""
        for link in links:
            href = link.get_attribute("href") or link.get_attribute("src") or ""
            link_text = link.inner_text().strip()
            if href and ("/files/" in href or href.lower().endswith(".pdf") or "download" in href or href.lower().endswith((".docx", ".doc"))):
                full_file_url = normalize_canvas_download_url(href, netloc=parsed.netloc, course_id=course_id)
                if full_file_url not in seen_urls:
                    seen_urls.add(full_file_url)
                    title = sanitize_filename(link_text) if link_text else ""
                    if not title or title.lower() in ("download", "view in new tab", "click here", "syllabus"):
                        title = "Course_Syllabus.pdf"
                    if not title.lower().endswith((".pdf", ".docx", ".doc")):
                        title += ".pdf"
                    official_pdf_items.append({
                        "title": title,
                        "url": full_file_url,
                        "page_title": "Course Syllabus",
                        "module_name": "Syllabus And Admin"
                    })

        # Fallback JS DOM evaluation if standard selectors missed embedded links
        if not official_pdf_items:
            try:
                js_links = page.evaluate("""() => {
                    const results = [];
                    document.querySelectorAll('a[href], iframe[src], embed[src]').forEach(el => {
                        const url = el.href || el.src || '';
                        const text = el.innerText || el.title || '';
                        if (url && (url.includes('/files/') || url.match(/\\.(pdf|docx?|pptx?)$/i))) {
                            results.push({url: url, text: text});
                        }
                    });
                    return results;
                }""")
                for jl in js_links:
                    u = normalize_canvas_download_url(jl["url"], netloc=parsed.netloc, course_id=course_id)
                    if u not in seen_urls:
                        seen_urls.add(u)
                        title = sanitize_filename(jl.get("text") or "Course_Syllabus.pdf")
                        if not title.lower().endswith((".pdf", ".docx", ".doc")):
                            title += ".pdf"
                        official_pdf_items.append({
                            "title": title,
                            "url": u,
                            "page_title": "Course Syllabus",
                            "module_name": "Syllabus And Admin"
                        })
            except Exception:
                pass

        has_official_pdf = len(official_pdf_items) > 0

        # 2. Extract clean formatted Markdown and raw text from the Syllabus DOM
        try:
            formatted = page.evaluate("""() => {
                const container = document.querySelector("#course_syllabus") || 
                                  document.querySelector(".syllabus_content") || 
                                  document.querySelector(".show-content") || 
                                  document.querySelector("#content");
                if (!container) return { markdown: "", raw_text: "" };

                const clone = container.cloneNode(true);
                const toRemove = clone.querySelectorAll(
                    '.screenreader-only, .accessibility_warning, .jump_to_today, #syllabus_actions, .header-bar, script, style, noscript, .ui-icon, .icon-paperclip'
                );
                toRemove.forEach(el => el.remove());

                clone.querySelectorAll('a').forEach(a => {
                    a.innerHTML = a.innerHTML.replace(/Links to an external site\\./gi, '').trim();
                });

                function nodeToMarkdown(node) {
                    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
                    if (node.nodeType !== Node.ELEMENT_NODE) return '';
                    const tag = node.tagName.toLowerCase();
                    if (node.style && node.style.display === 'none') return '';

                    let childrenMd = '';
                    for (const child of node.childNodes) {
                        childrenMd += nodeToMarkdown(child);
                    }

                    switch (tag) {
                        case 'h1': return `\\n\\n# ${childrenMd.trim()}\\n\\n`;
                        case 'h2': return `\\n\\n## ${childrenMd.trim()}\\n\\n`;
                        case 'h3': return `\\n\\n### ${childrenMd.trim()}\\n\\n`;
                        case 'h4': return `\\n\\n#### ${childrenMd.trim()}\\n\\n`;
                        case 'h5': return `\\n\\n##### ${childrenMd.trim()}\\n\\n`;
                        case 'h6': return `\\n\\n###### ${childrenMd.trim()}\\n\\n`;
                        case 'p':
                        case 'div': return `\\n\\n${childrenMd.trim()}\\n\\n`;
                        case 'strong':
                        case 'b': return childrenMd.trim() ? ` **${childrenMd.trim()}** ` : '';
                        case 'em':
                        case 'i': return childrenMd.trim() ? ` *${childrenMd.trim()}* ` : '';
                        case 'u': return childrenMd;
                        case 'a': {
                            const href = (node.getAttribute('href') || '').trim();
                            const text = childrenMd.trim() || href;
                            if (!href || href === '#' || href.startsWith('javascript:')) return text;
                            return `[${text}](${href})`;
                        }
                        case 'ul': {
                            const items = Array.from(node.children)
                                .filter(c => c.tagName.toLowerCase() === 'li')
                                .map(li => `- ${nodeToMarkdown(li).trim()}`)
                                .join('\\n');
                            return `\\n\\n${items}\\n\\n`;
                        }
                        case 'ol': {
                            const items = Array.from(node.children)
                                .filter(c => c.tagName.toLowerCase() === 'li')
                                .map((li, idx) => `${idx + 1}. ${nodeToMarkdown(li).trim()}`)
                                .join('\\n');
                            return `\\n\\n${items}\\n\\n`;
                        }
                        case 'li': return childrenMd.trim();
                        case 'blockquote': return `\\n\\n> ${childrenMd.trim().replace(/\\n/g, '\\n> ')}\\n\\n`;
                        case 'hr': return `\\n\\n---\\n\\n`;
                        case 'br': return `\\n`;
                        case 'table': {
                            const rows = Array.from(node.querySelectorAll('tr'));
                            if (rows.length === 0) return '';
                            const tableData = rows.map(r => {
                                const cells = Array.from(r.querySelectorAll('th, td'));
                                return cells.map(c => c.innerText.replace(/[\\r\\n\\t]+/g, ' ').trim());
                            }).filter(r => r.length > 0 && r.some(c => c.length > 0));
                            if (tableData.length === 0) return '';
                            const maxCols = Math.max(...tableData.map(r => r.length));
                            if (maxCols === 0) return '';
                            const normalized = tableData.map(r => {
                                const row = [...r];
                                while (row.length < maxCols) row.push('');
                                return row.map(c => c.replace(/\\|/g, '\\\\|'));
                            });
                            let mdTable = '\\n\\n';
                            mdTable += '| ' + normalized[0].join(' | ') + ' |\\n';
                            mdTable += '| ' + normalized[0].map(() => '---').join(' | ') + ' |\\n';
                            for (let i = 1; i < normalized.length; i++) {
                                mdTable += '| ' + normalized[i].join(' | ') + ' |\\n';
                            }
                            mdTable += '\\n\\n';
                            return mdTable;
                        }
                        default: return childrenMd;
                    }
                }

                let resultMd = nodeToMarkdown(clone);
                resultMd = resultMd.replace(/\\n{3,}/g, '\\n\\n').trim();

                const summaryTable = document.querySelector('#syllabus');
                if (summaryTable) {
                    const rows = Array.from(summaryTable.querySelectorAll('tr'));
                    const sData = rows.map(r => {
                        const cells = Array.from(r.querySelectorAll('th, td'));
                        return cells.map(c => c.innerText.replace(/[\\r\\n\\t]+/g, ' ').trim());
                    }).filter(r => r.length > 0 && r.some(c => c.length > 0));
                    if (sData.length > 1) {
                        const maxCols = Math.max(...sData.map(r => r.length));
                        const normSData = sData.map(r => {
                            const row = [...r];
                            while (row.length < maxCols) row.push('');
                            return row.map(c => c.replace(/\\|/g, '\\\\|'));
                        });
                        let sTableMd = '\\n\\n## Course Summary & Calendar\\n\\n';
                        sTableMd += '| ' + normSData[0].join(' | ') + ' |\\n';
                        sTableMd += '| ' + normSData[0].map(() => '---').join(' | ') + ' |\\n';
                        for (let i = 1; i < normSData.length; i++) {
                            sTableMd += '| ' + normSData[i].join(' | ') + ' |\\n';
                        }
                        resultMd += sTableMd;
                    }
                }

                return {
                    markdown: resultMd,
                    raw_text: container.innerText || ''
                };
            }""")
        except Exception:
            formatted = {"markdown": "", "raw_text": ""}

        syllabus_body_md = formatted.get("markdown", "").strip()
        syllabus_raw_text = formatted.get("raw_text", "").strip() or syllabus_body_md

        # 3. Branch based on whether an official PDF exists
        if has_official_pdf:
            print(f"   📄 Official syllabus PDF attachment detected ({len(official_pdf_items)} file(s)).")
            for item in official_pdf_items:
                syllabus_downloads.append(item)
                print(f"   📥 Enqueued Official Syllabus PDF: '{item['title']}'")

            # Capture visual snapshot for the web app UI toggle
            syl_pdf_path = os.path.join(temp_dir, "Syllabus_Visual_Snapshot.pdf")
            try:
                cdp = page.context.new_cdp_session(page)
                pdf_data = cdp.send("Page.printToPDF", {
                    "printBackground": True,
                    "preferCSSPageSize": True
                })
                with open(syl_pdf_path, "wb") as f:
                    f.write(base64.b64decode(pdf_data["data"]))
                cdp.detach()
                if verify_pdf_has_text(syl_pdf_path, min_chars=50):
                    syllabus_downloads.append({
                        "title": "Syllabus_Visual_Snapshot.pdf",
                        "url": syllabus_url,
                        "page_title": "Course Syllabus",
                        "module_name": "Syllabus And Admin",
                        "local_file": "Syllabus_Visual_Snapshot.pdf"
                    })
                    print(f"   🖼️ Captured visual Syllabus snapshot: 'Syllabus_Visual_Snapshot.pdf'")
            except Exception as e:
                print(f"   ℹ️ Notice capturing visual syllabus: {e}")

            # Cache extracted text for knowledge/blueprint, without generating a raw Syllabus.txt in course folder
            if syllabus_body_md or syllabus_raw_text:
                cache_path = os.path.join(temp_dir, ".syllabus_cache.txt")
                with open(cache_path, "w", encoding="utf-8") as f:
                    f.write(f"Title: Course Syllabus\nURL: {syllabus_url}\n\n{syllabus_body_md or syllabus_raw_text}")
                if blueprint:
                    blueprint.set_syllabus({"body": syllabus_body_md or syllabus_raw_text, "url": syllabus_url})

        else:
            # Course uses the Canvas syllabus page directly! Format it cleanly.
            print("   ℹ️ No official syllabus PDF attachment found. Formatting Canvas Syllabus page into Markdown & PDF...")
            if syllabus_body_md and len(syllabus_body_md) > 50:
                md_path = os.path.join(temp_dir, "Syllabus.md")
                header = f"# Course Syllabus\n\n**Course URL**: [{syllabus_url}]({syllabus_url})\n\n---\n\n"
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(header + syllabus_body_md)
                print(f"   📄 Saved formatted 'Syllabus.md' with tables and preserved links.")

                syllabus_downloads.append({
                    "title": "Syllabus.md",
                    "url": syllabus_url,
                    "page_title": "Course Syllabus",
                    "module_name": "Syllabus And Admin",
                    "local_file": "Syllabus.md"
                })

                # Print a clean visual PDF of the syllabus page
                syl_pdf_path = os.path.join(temp_dir, "Syllabus.pdf")
                try:
                    page.evaluate("""() => {
                        const toHide = document.querySelectorAll(
                            '#header, #left-side, .ic-app-header, .header-bar, #syllabus_actions, .jump_to_today, .screenreader-only'
                        );
                        toHide.forEach(el => el.style.setProperty('display', 'none', 'important'));
                        const mainContent = document.querySelector('#content, #main');
                        if (mainContent) {
                            mainContent.style.setProperty('margin', '0', 'important');
                            mainContent.style.setProperty('padding', '20px', 'important');
                        }
                    }""")
                    cdp = page.context.new_cdp_session(page)
                    pdf_data = cdp.send("Page.printToPDF", {
                        "printBackground": True,
                        "preferCSSPageSize": True
                    })
                    with open(syl_pdf_path, "wb") as f:
                        f.write(base64.b64decode(pdf_data["data"]))
                    cdp.detach()
                    if verify_pdf_has_text(syl_pdf_path, min_chars=50):
                        syllabus_downloads.append({
                            "title": "Syllabus.pdf",
                            "url": syllabus_url,
                            "page_title": "Course Syllabus",
                            "module_name": "Syllabus And Admin",
                            "local_file": "Syllabus.pdf"
                        })
                        print(f"   📑 Generated clean formatted Syllabus PDF: 'Syllabus.pdf'")
                except Exception as e:
                    print(f"   ℹ️ Notice generating syllabus PDF: {e}")

                if blueprint:
                    blueprint.set_syllabus({"body": syllabus_body_md, "url": syllabus_url})

    except Exception as e:
        print(f"   ⚠️ Could not access syllabus page: {e}")

    return syllabus_downloads


def parse_date_to_iso(date_raw: str) -> str:
    """Converts Canvas date strings (e.g. 'Sep 10, 2026', 'Sep 10 at 3:15pm') to YYYY-MM-DD."""
    if not date_raw:
        return time.strftime("%Y-%m-%d")
    iso_match = re.search(r'(\d{4}-\d{2}-\d{2})', date_raw)
    if iso_match:
        return iso_match.group(1)

    months = {"jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
              "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12"}
    m_match = re.search(r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:[,\s]+(\d{4}))?', date_raw, re.IGNORECASE)
    if m_match:
        m_name = m_match.group(1).lower()[:3]
        month = months.get(m_name, "01")
        day = f"{int(m_match.group(2)):02d}"
        year = m_match.group(3) or time.strftime("%Y")
        return f"{year}-{month}-{day}"

    return time.strftime("%Y-%m-%d")


def extract_announcement_author(raw_author: str, body_text: str, title: str = "") -> str:
    """Infers the actual instructor or TA name from DOM author elements and announcement signoffs.
    Strictly generalized across all courses: zero hardcoding.
    """
    clean = re.sub(r'(AUTHORTEACHER|TEACHER|TA|INSTRUCTOR)', '', raw_author or "").strip()
    if clean and clean.lower() not in ("course instructor", "instructor", "author", "teacher", "admin", ""):
        return clean

    # Inspect signoffs near bottom of text (last 6 lines)
    lines = [line.strip() for line in (body_text or "").splitlines() if line.strip()]
    signoff_triggers = (
        "best", "thanks", "thank you", "sincerely", "warmly", "regards",
        "best regards", "cheers", "all the best", "yours", "yours truly",
        "with gratitude", "take care", "blessings"
    )

    for i in range(len(lines) - 1, max(-1, len(lines) - 7), -1):
        line = lines[i]
        line_clean = line.rstrip(",.:!").lower()
        if any(line_clean.startswith(trig) for trig in signoff_triggers):
            if i + 1 < len(lines):
                candidate = lines[i + 1].strip()
                if re.match(r'^(?:Dr\.|Prof\.|Professor\s+)?[A-Z][A-Za-z\.\s&,/-]+$', candidate) and len(candidate.split()) <= 6:
                    return candidate

        # Check single line signoff, e.g. "Best, Dr. Smith" or "Thanks, Jane"
        m = re.match(r'^(?:Best|Thanks|Thank\s+you|Sincerely|Warmly|Regards|Cheers|Yours)[,\s]+((?:Dr\.|Prof\.|Professor\s+)?[A-Z][A-Za-z\.\s&,/-]+)$', line, re.IGNORECASE)
        if m:
            cand = m.group(1).strip()
            if len(cand.split()) <= 6:
                return cand

        # Check direct title lines at the end, e.g. "Dr. Smith" or "Professor Doe"
        m_title = re.match(r'^(?:Dr\.|Prof\.|Professor)\s+([A-Z][A-Za-z\.\s&,/-]+)$', line)
        if m_title and len(line.split()) <= 6:
            return line

        # Check line indicating role, e.g. "Hanshika (TA)" or "Alex (Teaching Assistant)"
        m_ta = re.match(r'^([A-Z][A-Za-z\s]+)\s*\((?:TA|Teaching\s+Assistant|Instructor|Professor)\)$', line)
        if m_ta:
            return line

    # Inspect mentions near top of announcement or title
    for line in lines[:3] + [title]:
        m_top = re.search(r'\b((?:Dr\.|Prof\.|Professor)\s+[A-Z][A-Za-z\.\s&]+)', line)
        if m_top:
            cand = m_top.group(1).strip()
            if len(cand.split()) <= 5:
                return cand

    return clean or "Course Instructor"


def scrape_all_announcements(page, course_url: str, temp_dir: str) -> tuple:
    """Navigates to Announcements, visits each announcement page individually, extracts full content,
    attachments, and saves .announcements.json for AI homework scanning."""
    parsed = urlparse(course_url)
    course_match = re.search(r'(/courses/\d+)', parsed.path)
    if not course_match:
        return [], []

    announcements_url = f"{parsed.scheme}://{parsed.netloc}{course_match.group(1)}/announcements"
    print(f"\n📢 Checking Canvas Course Announcements: {announcements_url}...")

    announcements_data = []
    downloadable_attachments = []

    try:
        page.goto(announcements_url, wait_until="domcontentloaded")
        time.sleep(2)

        # Check if Announcements tab is disabled or unauthorized
        current_url = page.url.lower()
        if "unauthorized" in current_url or page.query_selector("#unauthorized_holder"):
            print("   ℹ️ Announcements tab is hidden or disabled by instructor.")
            return [], []

        # Find announcement rows / links
        try:
            page.wait_for_selector(".ic-announcement-row, .discussion-topic, tr.discussionTopic, div.discussion-topic, a[href*='/announcements/'], a[href*='/discussion_topics/']", timeout=5000)
        except Exception:
            pass

        # Extract announcement links and timestamps in a single high-speed evaluate call
        try:
            announcement_links = page.evaluate("""() => {
                const rows = Array.from(document.querySelectorAll(".ic-announcement-row, .discussion-topic, tr.discussionTopic, div.discussion-topic, a[href*='/announcements/'], a[href*='/discussion_topics/']"));
                const results = [];
                const seen = new Set();
                for (const r of rows) {
                    const a = r.tagName === 'A' ? r : r.querySelector("a[href*='/announcements/'], a[href*='/discussion_topics/']");
                    if (!a) continue;
                    const href = a.href;
                    const title = a.innerText.trim();
                    if (!href || !title || href.endsWith('/announcements') || href.endsWith('/announcements/')) continue;
                    if (seen.has(href)) continue;
                    seen.add(href);
                    const timeElem = r.querySelector ? r.querySelector("time, .discussion-pubdate, .message-header time") : null;
                    const rawDate = timeElem ? (timeElem.getAttribute("datetime") || timeElem.innerText.trim()) : "";
                    results.push({ title, url: href, raw_date: rawDate });
                }
                return results;
            }""")
        except Exception as e:
            print(f"   ⚠️ Announcement link extraction notice: {e}")
            announcement_links = []

        if not announcement_links:
            print("   ℹ️ No announcements found on the Announcements page.")
            return [], []

        print(f"   Found {len(announcement_links)} announcements. Visiting each detail page...")

        course_id = course_match.group(1).replace("/courses/", "") if course_match else ""
        seen_att_urls = set()

        for idx, ann in enumerate(announcement_links, start=1):
            raw_title = ann["title"]
            clean_title = re.sub(r'^(unread|read)\s*,\s*', '', raw_title, flags=re.IGNORECASE).strip()
            clean_title = re.sub(r'[\r\n\t]+', ' ', clean_title).strip()
            ann_url = ann["url"]
            topic_id_match = re.search(r'/(?:discussion_topics|announcements)/(\d+)', ann_url)
            topic_id = topic_id_match.group(1) if topic_id_match else str(idx)

            print(f"   [{idx}/{len(announcement_links)}] Reading announcement: '{clean_title}' (ID: {topic_id})")

            try:
                page.goto(ann_url, wait_until="domcontentloaded")
                time.sleep(1)

                # Extract accurate post date
                time_node = page.query_selector("time, .discussion-pubdate, .posted-at, [data-testid='post-date']")
                date_str = ""
                if time_node:
                    date_str = time_node.get_attribute("datetime") or time_node.inner_text().strip()
                if not date_str:
                    date_str = ann["raw_date"]
                iso_date = parse_date_to_iso(date_str)

                # Extract clean body text, preserving hyperlinks as Markdown [text](url) and stripping screenreader junk
                content_info = page.evaluate("""() => {
                    const userContent = document.querySelector(".message_wrapper .user_content, article .user_content, .discussion-section .user_content, .user_content, [data-testid='message-content'], .message");
                    if (!userContent) return { text: "", has_images: false, img_urls: [] };

                    const imgs = Array.from(userContent.querySelectorAll("img"));
                    const contentImgs = imgs.filter(img => {
                        const src = img.src || "";
                        const w = img.naturalWidth || img.width || 0;
                        const h = img.naturalHeight || img.height || 0;
                        return !src.includes("avatar") && !src.includes("icon") && !src.includes("blank.png") && (w > 60 || h > 60 || w === 0);
                    });

                    const clone = userContent.cloneNode(true);
                    // Remove screenreader junk, external link indicators, scripts, styles, discussion controls
                    clone.querySelectorAll("script, style, .screenreader-only, .ui-icon-extlink, [aria-hidden='true'], .discussion-fyi, .discussion-entry-controls").forEach(el => el.remove());

                    // Convert links to Markdown [anchor](href) before taking text content
                    const links = Array.from(clone.querySelectorAll("a"));
                    links.forEach(a => {
                        const href = a.href || a.getAttribute("href") || "";
                        let text = a.innerText.trim();
                        text = text.replace(/Links to an external site\\.?/gi, "").trim();
                        if (text && href && !href.startsWith("javascript:")) {
                            const mdText = document.createTextNode(` [${text}](${href}) `);
                            a.parentNode.replaceChild(mdText, a);
                        }
                    });

                    let text = clone.innerText ? clone.innerText.trim() : "";
                    text = text.replace(/Links to an external site\\.?/gi, "").trim();
                    const uiJunk = [
                        /^View Split Screen/gm,
                        /^Collapse Threads/gm,
                        /^Filter by/gm,
                        /^Search entries or author\\.\\.\\./gm,
                        /^Sort by/gm,
                        /^Manage Discussion/gm,
                        /^Unsubscribed/gm,
                        /^This topic is closed for comments\\./gm,
                        /^Discussion Topic: .*/gm
                    ];
                    for (const pattern of uiJunk) {
                        text = text.replace(pattern, '').trim();
                    }

                    return {
                        text: text,
                        has_images: contentImgs.length > 0,
                        img_urls: contentImgs.map(i => i.src)
                    };
                }""")

                clean_body = content_info.get("text", "").strip()

                # Extract and clean author name with signoff inference
                author_node = page.query_selector(".author, .discussion-author, .user_name, [data-testid='author-name']")
                raw_author = author_node.inner_text().strip() if author_node else ""
                clean_author = extract_announcement_author(raw_author, clean_body, clean_title)

                # Look for file attachments & embedded file links on this announcement
                raw_att_links = page.evaluate("""() => {
                    const links = Array.from(document.querySelectorAll("a[href*='/files/'], a.instructure_file_link, a.attachment, a[href*='/download'], .discussion_entry_attachment a, a.icon-paperclip"));
                    return links.map(a => ({
                        href: a.href,
                        text: a.innerText.trim() || a.title || ''
                    }));
                }""")

                ann_attachments = []
                for att in raw_att_links:
                    att_href = att.get("href", "")
                    att_text = att.get("text", "")
                    if att_href:
                        norm_url = normalize_canvas_download_url(att_href, netloc=parsed.netloc, course_id=course_id)
                        if norm_url and norm_url not in seen_att_urls:
                            seen_att_urls.add(norm_url)
                            att_name = att_text if (att_text and not att_text.lower().startswith("download") and not att_text.lower().startswith("preview")) else os.path.basename(norm_url.split("?")[0].replace("/download", ""))
                            att_name = re.sub(r'^(download|preview)\s*', '', att_name, flags=re.IGNORECASE).strip()
                            if not att_name.lower().endswith((".pdf", ".docx", ".pptx", ".xlsx", ".zip", ".png", ".jpg", ".jpeg")):
                                att_name = f"{att_name}.pdf"
                            downloadable_attachments.append({
                                "title": att_name,
                                "url": norm_url,
                                "page_title": clean_title,
                                "module_name": "Announcements"
                            })
                            ann_attachments.append({
                                "title": att_name,
                                "url": norm_url
                            })
                            print(f"      📎 Found attachment: '{att_name}'")

                # If announcement contains rich images/diagrams, capture as visual PDF via CDP
                if content_info.get("has_images"):
                    import base64
                    ann_pdf_filename = f"{iso_date} - {topic_id} - {sanitize_filename(clean_title)}.pdf"
                    ann_pdf_path = os.path.join(temp_dir, ann_pdf_filename)
                    try:
                        cdp = page.context.new_cdp_session(page)
                        try:
                            pdf_data = cdp.send("Page.printToPDF", {
                                "printBackground": True,
                                "preferCSSPageSize": True,
                                "displayHeaderFooter": False
                            })
                            with open(ann_pdf_path, "wb") as f:
                                f.write(base64.b64decode(pdf_data["data"]))
                            print(f"      🖼️ Captured visual PDF for announcement with images: '{ann_pdf_filename}'")
                        finally:
                            try:
                                cdp.detach()
                            except Exception:
                                pass
                    except Exception as e:
                        print(f"      ℹ️ Visual PDF print notice: {e}")

                # Save clean, non-colliding announcement Markdown file with topic ID
                filename = f"{iso_date} - {topic_id} - {sanitize_filename(clean_title)}.md"
                md_path = os.path.join(temp_dir, filename)

                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(f"# {clean_title}\n\n")
                    f.write(f"- **Date Posted:** {iso_date}\n")
                    f.write(f"- **Author:** {clean_author}\n")
                    f.write(f"- **Canvas URL:** [{ann_url}]({ann_url})\n\n")
                    f.write("---\n\n")
                    f.write(clean_body if clean_body else "*(No body text provided)*\n")
                    if ann_attachments:
                        f.write("\n\n### Attachments\n\n")
                        for att_item in ann_attachments:
                            f.write(f"- 📎 [{att_item['title']}]({att_item['url']})\n")

                announcements_data.append({
                    "id": topic_id,
                    "title": clean_title,
                    "date": iso_date,
                    "posted_at": date_str if "T" in date_str else f"{iso_date}T00:00:00Z",
                    "author": clean_author,
                    "body": clean_body,
                    "url": ann_url,
                    "file_name": filename,
                    "attachments": ann_attachments
                })

            except Exception as e:
                print(f"      ⚠️ Could not read announcement '{ann_title}': {e}")

        # Save all announcements data to JSON in temp_dir
        json_path = os.path.join(temp_dir, ".announcements.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(announcements_data, f, indent=2)
        print(f"   ✅ Saved {len(announcements_data)} announcements to .announcements.json.")

    except Exception as e:
        print(f"   ⚠️ Could not access announcements page: {e}")

    return announcements_data, downloadable_attachments


def scrape_all_assignments(page, course_url: str, temp_dir: str) -> tuple[list, list]:
    """Deep-scrapes the Canvas Assignments tab (/assignments).
    Navigates into each individual assignment page, extracts assignment details,
    due dates, points, prompts (saving clean text and visual PDFs if images are present),
    and discovers prompt file attachments and student-uploaded submissions."""
    parsed = urlparse(course_url)
    course_match = re.search(r'(/courses/\d+)', parsed.path)
    if not course_match:
        return [], []

    course_id = course_match.group(1).replace("/courses/", "")
    assignments_url = f"{parsed.scheme}://{parsed.netloc}{course_match.group(1)}/assignments"
    print(f"\n📝 Checking Course Assignments page: {assignments_url}...")

    assignments_data = []
    downloadable_attachments = []
    seen_att_urls = set()

    try:
        page.goto(assignments_url, wait_until="domcontentloaded")
        time.sleep(2)

        # Check if Assignments tab is hidden or unauthorized
        current_url = page.url.lower()
        if "unauthorized" in current_url or page.query_selector("#unauthorized_holder, .unauthorized_message"):
            print("   ℹ️ Assignments tab (/assignments) is hidden or disabled by instructor.")
            return [], []

        try:
            page.wait_for_selector(".assignment_group, .ig-row, a[href*='/assignments/']", timeout=4000)
        except Exception:
            pass

        # Extract all assignment item links
        raw_assignments = page.evaluate("""() => {
            const links = Array.from(document.querySelectorAll("a[href*='/assignments/']"));
            const items = [];
            const seen = new Set();
            for (const a of links) {
                const href = a.href || a.getAttribute("href") || "";
                let text = a.innerText.trim();
                if (!href || href.includes("/assignments/syllabus") || href.endsWith("/assignments")) continue;
                if (!href.match(/\\/assignments\\/\\d+/)) continue;
                if (seen.has(href)) continue;
                seen.add(href);

                // Find parent container to inspect due date / points if visible
                const row = a.closest(".ig-row, .assignment");
                let dueInfo = "";
                let pointsInfo = "";
                if (row) {
                    const dueElem = row.querySelector(".assignment-date-due, .due_date, [data-testid='due-date']");
                    if (dueElem) dueInfo = dueElem.innerText.trim();
                    const ptsElem = row.querySelector(".assignment-points, .points, [data-testid='points']");
                    if (ptsElem) pointsInfo = ptsElem.innerText.trim();
                }

                items.push({
                    title: text || "Assignment",
                    url: href,
                    due: dueInfo,
                    points: pointsInfo
                });
            }
            return items;
        }""")

        if not raw_assignments:
            print("   ℹ️ No assignment items found on the Assignments page.")
            return [], []

        print(f"   Found {len(raw_assignments)} assignment items. Crawling assignment details...")

        for idx, assign in enumerate(raw_assignments, start=1):
            assign_title = assign.get("title", f"Assignment {idx}")
            assign_url = assign.get("url", "")
            if not assign_url:
                continue

            print(f"   [{idx}/{len(raw_assignments)}] Inspecting assignment: '{assign_title}'")
            if not check_internet_connection():
                wait_for_network_resume()

            try:
                page.goto(assign_url, wait_until="domcontentloaded")
                time.sleep(1.5)

                # Extract title, points, due date, submission details from assignment detail page
                assign_meta = page.evaluate("""() => {
                    const titleElem = document.querySelector("h1.title, .assignment-title, h1");
                    const title = titleElem ? titleElem.innerText.trim() : "";

                    const dueElem = document.querySelector(".data_due_at, .assignment-due-date, [data-testid='assignment-due-date']");
                    const due = dueElem ? dueElem.innerText.trim() : "";

                    const ptsElem = document.querySelector(".points_possible, .assignment-points, [data-testid='assignment-points']");
                    const points = ptsElem ? ptsElem.innerText.trim() : "";

                    const subTypesElem = document.querySelector(".submission_types, .assignment-submission-types");
                    const subTypes = subTypesElem ? subTypesElem.innerText.trim() : "";

                    // Extract detailed assignment dates (Available from, Until, Due)
                    const datesTable = document.querySelector(".assignment_dates, .dates, table.table-striped");
                    let availableFrom = "";
                    let until = "";
                    if (datesTable) {
                        const rows = Array.from(datesTable.querySelectorAll("tbody tr, tr"));
                        for (const r of rows) {
                            const tds = Array.from(r.querySelectorAll("td"));
                            if (tds.length >= 4) {
                                availableFrom = tds[2] ? tds[2].innerText.trim() : "";
                                until = tds[3] ? tds[3].innerText.trim() : "";
                            }
                        }
                    }

                    // Extract submission status and submission timestamp
                    const subHeader = document.querySelector(".submission-details-header, .submission_details, [data-testid='submission-status']");
                    let subStatus = subHeader ? subHeader.innerText.trim() : "unsubmitted";
                    const submittedAtElem = document.querySelector(".submission-details-header time, .submission-details .time");
                    let submittedAt = submittedAtElem ? (submittedAtElem.getAttribute("datetime") || submittedAtElem.innerText.trim()) : "";

                    return { title, due, points, subTypes, availableFrom, until, subStatus, submittedAt };
                }""")

                clean_title = sanitize_filename(assign_meta.get("title") or assign_title)
                due_str = assign_meta.get("due") or assign.get("due", "Not specified")
                points_str = assign_meta.get("points") or assign.get("points", "")
                sub_types_str = assign_meta.get("subTypes", "")
                avail_from_str = assign_meta.get("availableFrom", "")
                until_str = assign_meta.get("until", "")
                sub_status_str = assign_meta.get("subStatus", "unsubmitted")
                submitted_at_str = assign_meta.get("submittedAt", "")

                # Extract prompt text and check for images
                content_info = page.evaluate("""() => {
                    const desc = document.querySelector(".description.user_content, #assignment_show .user_content, .user_content, [data-testid='assignment-description']");
                    if (!desc) return { text: "", has_images: false };

                    const imgs = Array.from(desc.querySelectorAll("img"));
                    const contentImgs = imgs.filter(img => {
                        const src = img.src || "";
                        const w = img.naturalWidth || img.width || 0;
                        const h = img.naturalHeight || img.height || 0;
                        return !src.includes("avatar") && !src.includes("icon") && !src.includes("blank.png") && (w > 60 || h > 60 || w === 0);
                    });

                    const clone = desc.cloneNode(true);
                    clone.querySelectorAll("script, style, .screenreader-only").forEach(el => el.remove());
                    let text = clone.innerText ? clone.innerText.trim() : "";

                    return {
                        text: text,
                        has_images: contentImgs.length > 0
                    };
                }""")

                # Check if assignment links to Gradescope LTI
                gs_info = page.evaluate("""() => {
                    const frames = Array.from(document.querySelectorAll("iframe"));
                    for (const f of frames) {
                        const src = f.src || f.getAttribute("src") || "";
                        if (src.includes("gradescope.com")) return src;
                    }
                    const ltiLinks = Array.from(document.querySelectorAll("a[href*='gradescope.com'], a[href*='external_tools']"));
                    for (const a of ltiLinks) {
                        if (a.href.includes("gradescope.com") || (a.innerText && a.innerText.toLowerCase().includes("gradescope"))) {
                            return a.href;
                        }
                    }
                    return null;
                }""")
                if gs_info:
                    print(f"      🎓 Detected Gradescope LTI tool: {gs_info[:80]}...")
                    gs_course_match = re.search(r'courses/(\d+)', gs_info)
                    if gs_course_match:
                        gs_json_path = os.path.join(temp_dir, ".gradescope_info.json")
                        with open(gs_json_path, "w", encoding="utf-8") as f:
                            json.dump({"course_id": gs_course_match.group(1), "url": gs_info}, f, indent=2)

                # Look for downloadable files & prompt attachments on the page
                raw_files = page.evaluate("""() => {
                    const links = Array.from(document.querySelectorAll("a[href*='/files/'], a.instructure_file_link, a.attachment, a[href*='/download'], a.view_online_submission_button"));
                    return links.map(a => ({
                        href: a.href,
                        text: a.innerText.trim() || a.title || '',
                        is_submission: !!(a.closest(".submission-details, .submission_details, #sidebar_content, .file-upload-submission") || a.classList.contains("view_online_submission_button"))
                    }));
                }""")

                for file_item in raw_files:
                    href = file_item.get("href", "")
                    link_txt = file_item.get("text", "")
                    is_sub = file_item.get("is_submission", False)
                    if href:
                        norm_url = normalize_canvas_download_url(href, netloc=parsed.netloc, course_id=course_id)
                        if norm_url and norm_url not in seen_att_urls:
                            seen_att_urls.add(norm_url)
                            clean_fname = link_txt if (link_txt and not link_txt.lower().startswith("download") and not link_txt.lower().startswith("preview")) else os.path.basename(norm_url.split("?")[0].replace("/download", ""))
                            if not clean_fname.lower().endswith((".pdf", ".docx", ".pptx", ".xlsx", ".zip", ".png", ".jpg", ".jpeg", ".py")):
                                clean_fname = f"{clean_fname}.pdf"

                            if is_sub:
                                mod_tag = "Work"
                                print(f"      📤 Found student submission file: '{clean_fname}'")
                            else:
                                mod_tag = "Homework Assignments"
                                print(f"      📎 Found assignment file attachment: '{clean_fname}'")

                            downloadable_attachments.append({
                                "title": clean_fname,
                                "url": norm_url,
                                "page_title": clean_title,
                                "module_name": mod_tag
                            })

                # If assignment description contains rich images/diagrams, capture visual PDF via CDP
                if content_info.get("has_images"):
                    import base64
                    assign_pdf_filename = f"Assignment - {clean_title}.pdf"
                    assign_pdf_path = os.path.join(temp_dir, assign_pdf_filename)
                    try:
                        cdp = page.context.new_cdp_session(page)
                        try:
                            pdf_data = cdp.send("Page.printToPDF", {
                                "printBackground": True,
                                "preferCSSPageSize": True,
                                "displayHeaderFooter": False
                            })
                            with open(assign_pdf_path, "wb") as f:
                                f.write(base64.b64decode(pdf_data["data"]))
                            print(f"      🖼️ Captured visual PDF for assignment with images: '{assign_pdf_filename}'")
                        finally:
                            try:
                                cdp.detach()
                            except Exception:
                                pass
                    except Exception as e:
                        print(f"      ℹ️ Visual PDF print notice: {e}")

                # Check for native Canvas student submission link (Submission Details)
                try:
                    sub_href = page.evaluate("""() => {
                        const link = document.querySelector("a.submission_details_link, a[href*='/submissions/'], a:has-text('Submission Details')");
                        return link ? (link.href || '') : '';
                    }""")
                    if sub_href and sub_href.startswith("http") and "/submissions/" in sub_href:
                        print(f"      🔍 Checking student submission page: {sub_href[:65]}...")
                        sub_page = page.context.new_page()
                        try:
                            sub_page.goto(sub_href, wait_until="domcontentloaded", timeout=15000)
                            time.sleep(1)
                            sub_files = sub_page.evaluate("""() => {
                                const files = [];
                                document.querySelectorAll("#sidebar_content a[href*='/files/'], .submission-details a[href*='/files/'], a.view_online_submission_button, a[href*='/download']").forEach(a => {
                                    const href = a.href || '';
                                    const text = a.innerText.trim();
                                    if (href && (href.includes('/files/') || href.includes('/download'))) {
                                        files.push({ href, text });
                                    }
                                });
                                return files;
                            }""")
                            for sf in sub_files:
                                sf_url = normalize_canvas_download_url(sf["href"], netloc=parsed.netloc, course_id=course_id)
                                if sf_url not in seen_att_urls:
                                    seen_att_urls.add(sf_url)
                                    clean_sf_name = sf.get("text") or f"{clean_title}_Submission.pdf"
                                    if not clean_sf_name.lower().endswith((".pdf", ".docx", ".pptx", ".xlsx", ".zip", ".png", ".jpg", ".jpeg", ".py")):
                                        clean_sf_name = f"{clean_sf_name}.pdf"
                                    downloadable_attachments.append({
                                        "title": clean_sf_name,
                                        "url": sf_url,
                                        "page_title": clean_title,
                                        "module_name": "Work"
                                    })
                                    print(f"      📤 Captured native submission file: '{clean_sf_name}'")
                        finally:
                            sub_page.close()
                except Exception as e:
                    print(f"      ℹ️ Notice on native submission details: {e}")

                # Save clean assignment prompt text file
                clean_body = content_info.get("text", "").strip()
                is_gradescope = bool(gs_info or "gradescope" in clean_body.lower() or "gradescope" in sub_types_str.lower())
                gradescope_url = gs_info or ("https://www.gradescope.com/" if is_gradescope else "")

                if clean_body or due_str or points_str:
                    txt_filename = f"Assignment - {clean_title}.txt"
                    txt_path = os.path.join(temp_dir, txt_filename)
                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write(f"Title: {clean_title}\n")
                        f.write(f"Due Date: {due_str}\n")
                        if points_str:
                            f.write(f"Points: {points_str}\n")
                        if sub_types_str:
                            f.write(f"Submission Types: {sub_types_str}\n")
                        if is_gradescope:
                            f.write(f"Platform: Gradescope (External LTI)\n")
                            if gradescope_url:
                                f.write(f"Gradescope URL: {gradescope_url}\n")
                        f.write(f"URL: {assign_url}\n\n")
                        f.write(f"--- ASSIGNMENT INSTRUCTIONS & PROMPT ---\n\n")
                        if is_gradescope:
                            f.write(f"Note: This assignment is submitted via Gradescope.\nDirect Launch: {assign_url}\n\n")
                        f.write(clean_body if clean_body else "(No text prompt provided)")

                assignments_data.append({
                    "title": clean_title,
                    "url": assign_url,
                    "due": due_str,
                    "due_date": due_str,
                    "available_from": avail_from_str,
                    "until": until_str,
                    "points": points_str,
                    "submission_types": sub_types_str,
                    "submission_status": sub_status_str,
                    "submitted_at": submitted_at_str,
                    "body": clean_body,
                    "is_gradescope": is_gradescope,
                    "gradescope_url": gradescope_url
                })

            except Exception as e:
                print(f"      ⚠️ Could not read assignment '{assign_title}': {e}")

        # Save all assignments data to JSON in temp_dir
        json_path = os.path.join(temp_dir, ".assignments.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(assignments_data, f, indent=2)
        print(f"   ✅ Saved {len(assignments_data)} assignments to .assignments.json.")

    except Exception as e:
        print(f"   ⚠️ Could not access assignments page: {e}")

    return assignments_data, downloadable_attachments


def check_files_repository(page, course_url: str, known_urls: set) -> list:
    """Navigates to the Canvas /files page if accessible, and discovers unlinked files."""
    parsed = urlparse(course_url)
    course_match = re.search(r'(/courses/\d+)', parsed.path)
    if not course_match:
        return []

    files_url = f"{parsed.scheme}://{parsed.netloc}{course_match.group(1)}/files"
    print(f"\n📁 Checking Course Files repository: {files_url}...")

    unlinked_items = []
    try:
        page.goto(files_url, wait_until="domcontentloaded")
        time.sleep(2)

        # Check if Files tab is disabled or unauthorized
        current_url = page.url.lower()
        if "unauthorized" in current_url or page.query_selector("#unauthorized_holder, .unauthorized_message"):
            print("   ℹ️ Course Files repository (/files) is hidden or disabled by instructor.")
            return []

        try:
            page.wait_for_selector(".ef-item-row, a[href*='/files/'], .ef-name-col__link", timeout=4000)
        except Exception:
            pass

        # Extract file repository links in a single high-speed evaluate call
        raw_files = page.evaluate("""() => {
            const links = Array.from(document.querySelectorAll("a[href*='/files/'], .ef-name-col__link, [data-testid='file-name']"));
            const files = [];
            const seen = new Set();
            for (const a of links) {
                const href = a.href || a.getAttribute("href") || "";
                const text = a.innerText.trim();
                if (!href || !text) continue;
                if (!href.includes("/files/")) continue;
                if (seen.has(href)) continue;
                seen.add(href);
                files.push({ url: href, title: text });
            }
            return files;
        }""")

        known_file_ids = {m.group(1) for u in known_urls for m in [re.search(r'/files/(\d+)', u)] if m}

        for item in raw_files:
            link_text = item["title"]
            full_file_url = normalize_canvas_download_url(
                item["url"],
                netloc=parsed.netloc,
                course_id=course_match.group(1).replace("/courses/", "")
            )

            # Check if this URL or file ID was already in modules
            file_id_match = re.search(r'/files/(\d+)', full_file_url)
            file_id = file_id_match.group(1) if file_id_match else ""

            already_known = (file_id and file_id in known_file_ids) or full_file_url in known_urls
            if not already_known:
                known_urls.add(full_file_url)
                if file_id:
                    known_file_ids.add(file_id)
                unlinked_items.append({
                    "title": link_text,
                    "url": full_file_url,
                    "page_title": "Files Repository",
                    "module_name": "Files Repository"
                })
                print(f"   📥 Found unlinked file in Files repository: '{link_text}'")

        # Check for subfolders in Files
        try:
            subfolders = page.evaluate("""() => {
                const folders = Array.from(document.querySelectorAll("a[href*='/files/folder/'], a[href*='/folders/']"));
                return folders.map(a => ({ url: a.href, name: a.innerText.trim() })).filter(f => f.url && f.name);
            }""")
            for sf in subfolders:
                try:
                    print(f"   📁 Crawling Files subfolder: '{sf['name']}'...")
                    page.goto(sf["url"], wait_until="domcontentloaded")
                    time.sleep(1)
                    sf_files = page.evaluate("""() => {
                        const links = Array.from(document.querySelectorAll("a[href*='/files/'], .ef-name-col__link, [data-testid='file-name']"));
                        return links.map(a => ({ url: a.href || '', title: a.innerText.trim() })).filter(x => x.url && x.url.includes('/files/'));
                    }""")
                    for sff in sf_files:
                        full_u = normalize_canvas_download_url(sff["url"], netloc=parsed.netloc, course_id=course_match.group(1).replace("/courses/", ""))
                        if full_u not in known_urls:
                            known_urls.add(full_u)
                            unlinked_items.append({
                                "title": sff["title"],
                                "url": full_u,
                                "page_title": f"Files: {sf['name']}",
                                "module_name": "Files Repository"
                            })
                            print(f"      📎 Found subfolder file: '{sff['title']}'")
                except Exception:
                    pass
        except Exception:
            pass

        print(f"   Discovered {len(unlinked_items)} unlinked files from Canvas Files repository.")
    except Exception as e:
        print(f"   ℹ️ Could not check Files repository: {e}")

    return unlinked_items


def navigate_to_modules(page, course_url: str):
    """Navigates to the Modules page via sidebar or direct URL."""
    print("\n🔍 Navigating to Modules page...")
    
    if "/modules" in page.url:
        print("   ✅ Already on the Modules page.")
        return
    
    # Try clicking the Modules link in the sidebar
    try:
        modules_selector = "a.modules, a[href*='/modules'], a:has-text('Modules')"
        page.wait_for_selector(modules_selector, timeout=5000)
        modules_link = page.locator(modules_selector).first
        print("   🔍 Clicking Modules link in sidebar...")
        modules_link.click()
        page.wait_for_load_state("domcontentloaded")
        time.sleep(2)
    except Exception:
        # Fallback: navigate directly
        parsed = urlparse(course_url)
        course_match = re.search(r'(/courses/\d+)', parsed.path)
        if course_match:
            modules_url = f"{parsed.scheme}://{parsed.netloc}{course_match.group(1)}/modules"
            print(f"   🔍 Direct navigation to: {modules_url}")
            page.goto(modules_url, wait_until="domcontentloaded")
            time.sleep(2)


def scrape_module_links(page, temp_dir: str = None) -> list:
    """Extracts all module item links and their parent module names from the Modules page.
    Also extracts the complete hierarchical module tree (headers, items, types, indents)
    and saves .modules_tree.json for 1:1 Canvas LMS recreation."""
    print("🔍 Extracting item links and module headers from Modules...")
    
    # Wait for module items to appear
    try:
        page.wait_for_selector(".context_module, .context_module_item, .module-item, a[href*='/items/']", timeout=10000)
    except Exception:
        print("   ⚠️ Standard module selector timed out, attempting broad link search...")
    
    module_links = []
    structured_modules = []
    current_url = page.url
    
    # Extract module containers and items in a single high-speed in-browser evaluate call
    try:
        data = page.evaluate("""() => {
            const validKeys = ["/items/", "/pages/", "/assignments/", "/files/", "/quizzes/", "/discussion_topics/", "/announcements/"];
            const results = [];
            const structured = [];
            const seenUrls = new Set();
            const containers = Array.from(document.querySelectorAll(".context_module, div[data-module-id]"));
            
            if (containers.length > 0) {
                for (const mod of containers) {
                    let modTitle = "";
                    const nameElem = mod.querySelector(".name, .ig-header-title, .module-title, h2, h3, [data-module-name]");
                    if (nameElem) modTitle = nameElem.innerText.trim();
                    if (!modTitle) {
                        const aria = mod.getAttribute("aria-label") || "";
                        if (aria) modTitle = aria.replace("Module:", "").trim();
                    }
                    if (!modTitle) modTitle = "General Materials";
                    modTitle = modTitle.replace(/[\\r\\n]+/g, ' ').trim();

                    const modId = mod.getAttribute("data-module-id") || mod.id || `mod_${structured.length + 1}`;
                    const moduleItems = [];

                    // Extract all items and subheaders inside this module container
                    const elements = Array.from(mod.querySelectorAll(".context_module_item, .context_module_sub_header"));
                    for (const el of elements) {
                        const isSubHeader = el.classList.contains("context_module_sub_header") || el.querySelector(".context_module_sub_header");
                        if (isSubHeader) {
                            const hText = el.innerText.trim();
                            if (hText) {
                                moduleItems.push({
                                    type: "header",
                                    title: hText,
                                    indent: 0
                                });
                            }
                            continue;
                        }

                        const a = el.tagName === 'A' ? el : el.querySelector("a");
                        if (!a) continue;
                        const title = a.innerText.trim();
                        const href = a.getAttribute("href") || "";
                        if (!href || !title) continue;

                        const isExternal = (href.startsWith("http://") || href.startsWith("https://")) && !href.includes("/courses/");
                        const isCanvasTool = href.includes("/external_tools/");
                        const isValidInternal = validKeys.some(k => href.includes(k));
                        if (!isValidInternal && !isExternal && !isCanvasTool) continue;

                        let indent = 0;
                        for (let i = 1; i <= 5; i++) {
                            if (el.classList.contains(`indent_${i}`)) { indent = i; break; }
                        }

                        let itemType = "generic";
                        if (el.classList.contains("attachment_holder") || href.includes("/files/")) itemType = "file";
                        else if (el.classList.contains("wiki_page") || href.includes("/pages/")) itemType = "page";
                        else if (el.classList.contains("assignment") || href.includes("/assignments/")) itemType = "assignment";
                        else if (el.classList.contains("quiz") || href.includes("/quizzes/")) itemType = "quiz";
                        else if (el.classList.contains("discussion_topic") || href.includes("/discussion_topics/")) itemType = "discussion";
                        else if (isExternal || isCanvasTool) itemType = "external_url";

                        const fullUrl = a.href;
                        moduleItems.push({
                            type: itemType,
                            title: title,
                            url: fullUrl,
                            indent: indent,
                            is_external: isExternal || isCanvasTool
                        });

                        if (!seenUrls.has(fullUrl)) {
                            seenUrls.add(fullUrl);
                            results.push({
                                title: title,
                                url: fullUrl,
                                module_name: modTitle,
                                is_external: isExternal || isCanvasTool
                            });
                        }
                    }

                    structured.push({
                        id: modId,
                        title: modTitle,
                        items: moduleItems
                    });
                }
            }

            if (results.length === 0) {
                const items = document.querySelectorAll(".context_module_item, .module_item_title a, a[href*='/courses/']");
                for (const item of items) {
                    const a = item.tagName === 'A' ? item : item.querySelector("a");
                    if (!a) continue;
                    const title = a.innerText.trim();
                    const href = a.getAttribute("href") || "";
                    if (!href || !title) continue;
                    const isExternal = (href.startsWith("http://") || href.startsWith("https://")) && !href.includes("/courses/");
                    const isCanvasTool = href.includes("/external_tools/");
                    const isValidInternal = validKeys.some(k => href.includes(k));
                    if (!isValidInternal && !isExternal && !isCanvasTool) continue;

                    const fullUrl = a.href;
                    if (!seenUrls.has(fullUrl)) {
                        seenUrls.add(fullUrl);
                        results.push({
                            title: title,
                            url: fullUrl,
                            module_name: "General Materials",
                            is_external: isExternal || isCanvasTool
                        });
                    }
                }
            }
            return { flat_links: results, structured_modules: structured };
        }""")
        module_links = data.get("flat_links", [])
        structured_modules = data.get("structured_modules", [])
    except Exception as e:
        print(f"   ⚠️ Module extraction error: {e}")
        module_links = []
        structured_modules = []
    
    # Save structured modules tree if temp_dir provided
    if temp_dir and structured_modules:
        try:
            tree_path = os.path.join(temp_dir, ".modules_tree.json")
            with open(tree_path, "w", encoding="utf-8") as f:
                json.dump(structured_modules, f, indent=2)
            print(f"   📋 Saved structured Canvas modules tree ({len(structured_modules)} modules).")
        except Exception as e:
            print(f"   ⚠️ Could not save .modules_tree.json: {e}")

    print(f"   Found {len(module_links)} module pages/items across {len(structured_modules)} modules.")
    return module_links

def process_text_only_pages(page, module_links: list, temp_dir: str) -> list:
    """Visits each module page. For pages with no file attachments, saves content as text.
    Returns a filtered list of items that have downloadable file links."""
    downloadable_items = []
    
    print("\n🔍 Scanning module pages for downloadable content...")
    
    for index, item_info in enumerate(module_links, start=1):
        item_title = item_info["title"]
        item_url = item_info["url"]
        mod_name = item_info.get("module_name", "General Materials")
        
        # Direct file download links don't need page visits
        if "/files/" in item_url and "/download" in item_url:
            downloadable_items.append(item_info)
            continue
        
        print(f"   [{index}/{len(module_links)}] Checking: '{item_title}' (Module: '{mod_name}')")
        
        if not check_internet_connection():
            wait_for_network_resume()
            
        try:
            page.goto(item_url, wait_until="domcontentloaded")
            time.sleep(1)
            
            # Look for downloadable file links on the page in a single evaluate call
            file_urls = page.evaluate("""() => {
                const fileExtRegex = /\\.(pdf|docx?|pptx?|xlsx?|zip|py|mat|csv)$/i;
                const links = Array.from(document.querySelectorAll("a[href]"));
                const files = [];
                const seen = new Set();
                for (const a of links) {
                    const href = a.getAttribute("href") || "";
                    const text = a.innerText.trim();
                    if (href.includes("/files/") || fileExtRegex.test(href)) {
                        let full = a.href;
                        if (full.includes("/files/") && !full.includes("/download")) {
                            const parts = full.split("?");
                            full = parts[0].replace(/\\/+$/, '') + "/download" + (parts[1] ? "?" + parts[1] : "");
                        }
                        if (!seen.has(full)) {
                            seen.add(full);
                            files.push({ url: full, title: text });
                        }
                    }
                }
                return files;
            }""")
            for f in file_urls:
                if not f["title"]:
                    f["title"] = item_title
            
            if file_urls:
                # This page has downloadable files
                for file_info in file_urls:
                    downloadable_items.append({
                        "title": file_info["title"],
                        "url": file_info["url"],
                        "page_title": item_title,
                        "module_name": mod_name
                    })
            else:
                # No downloadable files - save page content as text
                saved_path = print_page_to_pdf_with_fallback(page, item_title, temp_dir)
                if saved_path:
                    downloadable_items.append({
                        "title": item_title,
                        "url": item_url,
                        "page_title": item_title,
                        "module_name": mod_name,
                        "local_file": os.path.basename(saved_path)
                    })
        
        except Exception as e:
            print(f"   ⚠️ Error reading page '{item_title}': {e}")
    
    return downloadable_items


def _login_required(page):
    """[Codex] Inspect auth paths and forms without matching return-URL query text."""
    parsed = urlparse(page.url)
    auth_path = re.search(r'/(?:login|signin|shibboleth|saml|cas)(?:/|$)', parsed.path, re.I)
    auth_host = (parsed.hostname or '').split('.')[0].lower() in {'sso', 'idp', 'shibboleth', 'shb'}
    return bool(auth_path or auth_host or page.query_selector('#login_form, #username, input[type="password"]'))


def check_and_prompt_login(page, timeout: int = 240, course_url: str = "") -> bool:
    """[Codex] Pump Playwright events while awaiting verified Canvas navigation.

    False means no login was needed, True means login completed. Failure raises,
    preventing callers from scraping a login page after the deadline.
    """
    if not _login_required(page):
        return False
    print("\n🔑 SESSION EXPIRED / LOGIN REQUIRED IN THE BROWSER WINDOW.", flush=True)
    print("   Complete login and 2FA in the browser window opened by this app.", flush=True)
    print("   Auto-detecting login completion; waiting for Canvas to appear...", flush=True)
    expected = urlparse(course_url) if course_url else None
    deadline = time.monotonic() + timeout
    next_notice = time.monotonic() + 15
    while time.monotonic() < deadline:
        if page.is_closed():
            raise RuntimeError('Login browser was closed before authentication completed. Start the course download again.')
        try:
            # A cached page.url read plus time.sleep starves the sync API dispatcher.
            # This protocol-backed wait processes navigation events as they arrive.
            page.wait_for_timeout(min(500, max(1, (deadline - time.monotonic()) * 1000)))
            current = urlparse(page.url)
            on_canvas = not expected or (current.scheme, current.netloc) == (expected.scheme, expected.netloc)
            if on_canvas and not _login_required(page) and page.query_selector(
                '#global_nav_profile_link, #section-tabs, #dashboard_header_container'
            ):
                print('   ✅ Login detected! Continuing automatically...', flush=True)
                return True
        except PlaywrightError:
            # Redirects may briefly replace the execution context. Retry until deadline.
            if page.is_closed():
                raise RuntimeError('Login browser was closed before authentication completed.')
        if time.monotonic() >= next_notice:
            print('   Still waiting for Canvas in the login window; finish any remaining sign-in or 2FA prompts.', flush=True)
            next_notice = time.monotonic() + 15
    raise TimeoutError(f'Canvas login was not detected within {timeout} seconds. Complete login in the app-opened browser and retry.')


def prepare_course_directories(output_dir: str, course_name: str):
    """Check both course destinations before creating crawl directories."""
    validate_tree(output_dir)
    course_root = resolve_course_root(output_dir, course_name)
    validate_tree(course_root)
    work_dir = contained_path(course_root, f"{course_name} Work")
    temp_dir = contained_path(output_dir, ".temp_downloads")
    os.makedirs(temp_dir, mode=0o700, exist_ok=True)
    os.makedirs(work_dir, exist_ok=True)
    return course_root, work_dir, temp_dir


def launch(course_url: str, output_dir: str, course_name: str = "", headless: bool = False, selected_categories: set = None, cookie_sink=None):
    """Main launcher function: authenticates, discovers all course navigation tabs,
    and exhaustively scrapes materials from every category based on selected_categories."""

    parsed_course = urlparse(course_url)
    if parsed_course.scheme != 'https' or not parsed_course.hostname or parsed_course.username or parsed_course.password:
        raise ValueError('Canvas requires an HTTPS URL without embedded credentials')

    if not course_name:
        parent = os.path.dirname(output_dir.rstrip("/\\"))
        course_name = os.path.basename(parent) if parent and os.path.basename(parent) != "Desktop" else os.path.basename(output_dir)

    course_root, work_dir, temp_dir = prepare_course_directories(output_dir, course_name)
    
    user_data_dir = os.path.expanduser("~/.canvas_browser_profile")
    contained_path(user_data_dir)
    os.makedirs(user_data_dir, mode=0o700, exist_ok=True)
    os.chmod(user_data_dir, 0o700)
    
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir,
            headless=headless,
            viewport={'width': 1280, 'height': 800},
            accept_downloads=True
        )
        page = context.pages[0] if context.pages else context.new_page()
        
        # Open Canvas and wait for login if session is expired
        print(f"\n🌐 Opening Canvas: {course_url}")
        try:
            page.goto(course_url, wait_until="networkidle")
        except Exception:
            page.goto(course_url, wait_until="domcontentloaded")
        
        # If headless and login is required, switch to headed
        login_needed = _login_required(page)
        if login_needed and headless:
            print("🔑 Login or 2FA required. Opening browser window for authentication...")
            context.close()
            context = p.chromium.launch_persistent_context(
                user_data_dir,
                headless=False,
                viewport={'width': 1280, 'height': 800},
                accept_downloads=True
            )
            page = context.pages[0] if context.pages else context.new_page()
            try:
                page.goto(course_url, wait_until="domcontentloaded")
            except Exception:
                pass
            check_and_prompt_login(page, course_url=course_url)
        elif login_needed:
            check_and_prompt_login(page, course_url=course_url)
        else:
            print("✅ Already logged in (session restored)! Proceeding automatically...")
        
        parsed = urlparse(course_url)
        course_match = re.search(r'(/courses/\d+)', parsed.path)
        course_id = course_match.group(1).replace("/courses/", "") if course_match else ""

        # Initialize Course Blueprint for 1:1 Canvas recreation and timeline
        blueprint = CourseBlueprint(course_name=course_name, course_url=course_url, output_dir=output_dir)

        # Dynamic Discovery of all enabled tabs in the course
        discovered_tabs = discover_course_tabs(page, course_url)
        blueprint.set_tabs(discovered_tabs)
        tab_categories = {t.get("category") for t in discovered_tabs}
        print(f"📋 Discovered Tab Categories: {', '.join(sorted(tab_categories)) if tab_categories else 'Standard'}")

        if selected_categories is not None:
            print(f"🎯 Category Scope: {', '.join(sorted(selected_categories))}")

        downloadable_items = []
        module_links = []

        def should_crawl(category: str) -> bool:
            return selected_categories is None or category in selected_categories

        # 1. Syllabus
        if should_crawl("syllabus"):
            syllabus_items = scrape_syllabus(page, course_url, temp_dir, blueprint=blueprint)
            if syllabus_items:
                downloadable_items.extend(syllabus_items)
            for s_name in ["Syllabus.md", ".syllabus_cache.txt", "Syllabus.txt"]:
                syl_path = os.path.join(temp_dir, s_name)
                if os.path.exists(syl_path):
                    try:
                        with open(syl_path, "r", encoding="utf-8") as f:
                            blueprint.set_syllabus({"body": f.read(), "url": course_url})
                            break
                    except Exception:
                        pass
        else:
            print("   ⏭️ Skipping Syllabus (excluded by user scope)")

        # 2. Announcements
        if should_crawl("announcements"):
            if "announcements" in tab_categories or not discovered_tabs:
                announcements_data, announcement_attachments = scrape_all_announcements(page, course_url, temp_dir)
                if announcement_attachments:
                    downloadable_items.extend(announcement_attachments)
                for ann in announcements_data:
                    blueprint.add_announcement(ann)
        else:
            print("   ⏭️ Skipping Announcements (excluded by user scope)")

        # 3. Assignments
        if should_crawl("assignments"):
            if "assignments" in tab_categories or not discovered_tabs:
                assignments_data, assignment_attachments = scrape_all_assignments(page, course_url, temp_dir)
                if assignment_attachments:
                    downloadable_items.extend(assignment_attachments)
                for assign in assignments_data:
                    blueprint.add_assignment(assign)
        else:
            print("   ⏭️ Skipping Assignments (excluded by user scope)")

        # 4. Modules
        if should_crawl("modules"):
            if "modules" in tab_categories or not discovered_tabs:
                navigate_to_modules(page, course_url)
                check_and_prompt_login(page, course_url=course_url)
                print(f"✅ Active location: {page.url}")
                module_links = scrape_module_links(page, temp_dir)
                module_links.sort(key=lambda x: 0 if any(k in x["title"].lower() for k in ["syllabus", "syl"]) else 1)

                # Load structured modules into blueprint
                tree_path = os.path.join(temp_dir, ".modules_tree.json")
                if os.path.exists(tree_path):
                    try:
                        with open(tree_path, "r", encoding="utf-8") as f:
                            s_mods = json.load(f)
                        for sm in s_mods:
                            blueprint.add_module(sm.get("id", ""), sm.get("title", ""), sm.get("items", []))
                    except Exception as e:
                        print(f"   ⚠️ Notice loading modules tree: {e}")

                module_items = process_text_only_pages(page, module_links, temp_dir)
                if module_items:
                    downloadable_items.extend(module_items)
        else:
            print("   ⏭️ Skipping Modules (excluded by user scope)")

        # 5. Discussions
        if should_crawl("discussions"):
            if "discussions" in tab_categories:
                disc_items, disc_attachments = scrape_all_discussions(page, course_url, temp_dir)
                if disc_items:
                    downloadable_items.extend(disc_items)
                if disc_attachments:
                    downloadable_items.extend(disc_attachments)
                for d in disc_items:
                    blueprint.add_discussion(d)
        else:
            print("   ⏭️ Skipping Discussions (excluded by user scope)")

        # 6. Standalone / Unlinked Pages
        if should_crawl("pages"):
            if "pages" in tab_categories:
                known_page_urls = {item["url"] for item in downloadable_items if item.get("url")}
                unlinked_pages = scrape_unlinked_pages(page, course_url, known_page_urls, temp_dir)
                if unlinked_pages:
                    downloadable_items.extend(unlinked_pages)
        else:
            print("   ⏭️ Skipping Standalone Pages (excluded by user scope)")

        # 7. Quizzes & Submission Reviews
        if should_crawl("quizzes"):
            if "quizzes" in tab_categories:
                quiz_items = scrape_quizzes_and_reviews(page, course_url, work_dir, temp_dir)
                if quiz_items:
                    downloadable_items.extend(quiz_items)
                for q in quiz_items:
                    blueprint.add_quiz(q)
        else:
            print("   ⏭️ Skipping Quizzes & Reviews (excluded by user scope)")

        # 8. Canvas Grades & Feedback Snapshot
        if should_crawl("grades"):
            if "grades" in tab_categories:
                grades_file = scrape_grades_and_feedback(page, course_url, course_name, work_dir)
                if grades_file:
                    blueprint.set_grades({"local_file": os.path.basename(grades_file), "path": grades_file})
        else:
            print("   ⏭️ Skipping Grades & Feedback (excluded by user scope)")

        # 9. Media & Zoom Recordings Catalog
        if should_crawl("media"):
            if "media" in tab_categories or any("zoom" in t.get("name", "").lower() for t in discovered_tabs):
                scrape_media_recordings(page, course_url, course_name, output_dir)
        else:
            print("   ⏭️ Skipping Media & Zoom Recordings (excluded by user scope)")

        # 10. Canvas Files Repository Cross-Check
        if should_crawl("files"):
            if "files" in tab_categories or not discovered_tabs:
                known_urls = {item["url"] for item in downloadable_items if item.get("url")}
                unlinked_files = check_files_repository(page, course_url, known_urls)
                if unlinked_files:
                    downloadable_items.extend(unlinked_files)
        else:
            print("   ⏭️ Skipping Files Repository (excluded by user scope)")

        # 11. Custom / Generic Sidebar Tabs
        for tab in discovered_tabs:
            if tab.get("category") == "generic":
                gen_items = audit_generic_tab(page, tab, temp_dir, parsed.netloc, course_id)
                if gen_items:
                    downloadable_items.extend(gen_items)
            elif tab.get("category") == "gradescope":
                if should_crawl("gradescope"):
                    try:
                        gs_info = {"url": tab["url"], "course_id": None}
                        match = re.search(r'/courses/(\d+)', tab["url"])
                        if match:
                            gs_info["course_id"] = match.group(1)
                        with open(os.path.join(temp_dir, ".gradescope_info.json"), "w", encoding="utf-8") as f:
                            json.dump(gs_info, f, indent=2)
                    except Exception:
                        pass

        # [Codex] Keep scoped authentication in memory, outside course archives.
        if cookie_sink is not None:
            cookie_sink.extend(context.cookies([course_url]))

        # Compile External Web Links Catalog if any external links were discovered in Modules
        external_links = [m for m in module_links if m.get("is_external")]
        if external_links:
            ext_catalog_path = os.path.join(output_dir, f"{course_name} External_Web_Links.md")
            ext_lines = [
                f"# {course_name} External Web Links & Resources Catalog",
                f"**Generated**: {time.strftime('%B %d, %Y')}\n",
                "## External Course Materials & Links by Module:"
            ]
            by_mod = {}
            for el in external_links:
                mname = el.get("module_name", "General Materials")
                by_mod.setdefault(mname, []).append(el)
            for mname, items in by_mod.items():
                ext_lines.append(f"\n### {mname}")
                for it in items:
                    ext_lines.append(f"- [{it['title']}]({it['url']})")
            try:
                with open(ext_catalog_path, "w", encoding="utf-8") as f:
                    f.write("\n".join(ext_lines) + "\n")
                print(f"   🌐 Saved external web links catalog: '{os.path.basename(ext_catalog_path)}'")
            except Exception as e:
                print(f"   ℹ️ Notice saving external links catalog: {e}")

        # Save modules map for downloader and organizer
        modules_map_path = os.path.join(output_dir, ".modules_map.json")
        unique_module_titles = []
        for item in module_links:
            m = item.get("module_name", "").strip()
            if m and m not in unique_module_titles:
                unique_module_titles.append(m)

        # Deduplicate downloadable items
        deduped_items = []
        seen_keys = set()
        for it in downloadable_items:
            key = it.get("url") or it.get("local_file") or it.get("title")
            if key and key not in seen_keys:
                seen_keys.add(key)
                deduped_items.append(it)

        with open(modules_map_path, "w", encoding="utf-8") as f:
            json.dump({
                "course_url": course_url,
                "module_titles": unique_module_titles,
                "item_titles": [item["title"] for item in module_links],
                "downloadable_items": deduped_items
            }, f, indent=2)
        print(f"📋 Modules map saved ({len(deduped_items)} downloadable items across {len(unique_module_titles)} modules).")

        # Save initial course blueprint for offline Web App
        if external_links:
            blueprint.external_links = external_links
        try:
            blueprint.save(output_dir, course_root=course_root)
        except Exception as e:
            print(f"   ℹ️ Notice saving initial course blueprint: {e}")

        context.close()

    print("\n✅ Launcher complete! Browser closed.")
    return len(deduped_items)


if __name__ == "__main__":
    # Standalone testing
    url = input("Course URL: ").strip()
    out = os.path.expanduser("~/Desktop/test_course")
    launch(url, out)
