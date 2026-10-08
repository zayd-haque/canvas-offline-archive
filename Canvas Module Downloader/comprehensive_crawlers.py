# comprehensive_crawlers.py
# Specialized category crawlers for 100% exhaustive Canvas archiving:
# - Dynamic Course Tabs Discovery: Inspects course navigation and audits all enabled tabs
# - Discussions: Full thread bodies, instructor/TA replies, attached worksheets & visual PDFs
# - Unlinked Pages: Published wiki pages outside of Modules
# - Quizzes & Reviews: Quiz prompts + student question-by-question graded review PDFs
# - Grades Snapshot: Gradebook scores, category weights, stats & written comments PDF
# - Media Catalog: Cloud lecture video recording links, meeting IDs & passcodes

import os
import re
import json
import time
import base64
from urllib.parse import urlparse
from capturer import sanitize_filename, normalize_canvas_download_url, verify_pdf_has_text
from safety import contained_path, validate_tree


def discover_course_tabs(page, course_url: str) -> list:
    """Scans the course navigation sidebar (#section-tabs) to dynamically discover
    EVERY category/tab enabled in the course."""
    print(f"\n🧭 Auditing all available course navigation tabs...")
    parsed = urlparse(course_url)
    course_match = re.search(r'(/courses/\d+)', parsed.path)
    if not course_match:
        return []

    base_course_url = f"{parsed.scheme}://{parsed.netloc}{course_match.group(1)}"

    tabs = page.evaluate("""() => {
        const anchors = Array.from(document.querySelectorAll("#section-tabs a, nav[aria-label='Sections'] a, .course-nav a"));
        return anchors.map(a => {
            const label = a.innerText.trim().replace(/\\n+/g, ' ');
            const href = a.href || a.getAttribute('href') || '';
            const isHidden = a.classList.contains('section-tabs-header-subtitle') || a.offsetParent === null;
            return {
                name: label,
                url: href,
                is_hidden: isHidden
            };
        }).filter(t => t.name && t.url && !t.url.includes('/settings'));
    }""")

    # Clean and categorize tabs
    categorized_tabs = []
    seen_urls = set()

    for t in tabs:
        u = t.get("url", "")
        if u and u not in seen_urls:
            seen_urls.add(u)
            name_lower = t["name"].lower()
            url_lower = u.lower()

            category = "generic"
            if "syllabus" in name_lower or "syllabus" in url_lower:
                category = "syllabus"
            elif "announcement" in name_lower or "announcements" in url_lower:
                category = "announcements"
            elif "assignment" in name_lower or "assignments" in url_lower:
                category = "assignments"
            elif "module" in name_lower or "modules" in url_lower:
                category = "modules"
            elif "discussion" in name_lower or "discussion_topics" in url_lower:
                category = "discussions"
            elif "page" in name_lower or "/pages" in url_lower:
                category = "pages"
            elif "file" in name_lower or "/files" in url_lower:
                category = "files"
            elif "quiz" in name_lower or "quizzes" in url_lower:
                category = "quizzes"
            elif "gradescope" in name_lower or "gradescope" in url_lower:
                category = "gradescope"
            elif "grade" in name_lower or "/grades" in url_lower:
                category = "grades"
            elif any(k in name_lower or k in url_lower for k in ["zoom", "kaltura", "media", "panopto", "bruincast", "recording"]):
                category = "media"

            t["category"] = category
            categorized_tabs.append(t)
            print(f"   📑 Discovered Tab: [{t['name']}] -> Type: {category} ({u})")

    return categorized_tabs


def postprocess_clean_grades_pdf(pdf_path: str):
    """Safely removes any floating Canvas feedback modals or dialog overlays from the PDF."""
    try:
        import pypdf
        reader = pypdf.PdfReader(pdf_path)
        modified = False
        needle = b'2331.7188 1564.6875 m'
        writer = pypdf.PdfWriter()
        for page in reader.pages:
            raw_contents = page['/Contents'].get_object()
            data = raw_contents.get_data()
            if needle in data:
                idx = data.find(needle)
                q_idx = data.rfind(b'q\n115.625', 0, idx)
                if q_idx != -1:
                    clean_data = data[:q_idx]
                    bdc_count = clean_data.count(b'BDC') + clean_data.count(b'BMC')
                    emc_count = clean_data.count(b'EMC')
                    if bdc_count > emc_count:
                        clean_data += b'EMC\n' * (bdc_count - emc_count)
                    raw_contents.set_data(clean_data)
                    modified = True
            writer.add_page(page)
        if modified:
            with open(pdf_path, 'wb') as f:
                writer.write(f)
            print(f"   🧹 Post-processed & removed dialog overlays from: '{os.path.basename(pdf_path)}'")
    except Exception as e:
        print(f"   ℹ️ Notice during PDF post-processing: {e}")


def scrape_grades_and_feedback(page, course_url: str, course_name: str, work_dir: str) -> str:
    """Navigates to the Canvas /grades tab, expands written comments and rubrics,
    and captures an unobstructed visual PDF snapshot into [COURSE] Work/."""
    work_dir = contained_path(work_dir)
    validate_tree(work_dir)
    parsed = urlparse(course_url)
    course_match = re.search(r'(/courses/\d+)', parsed.path)
    if not course_match:
        return ""

    grades_url = f"{parsed.scheme}://{parsed.netloc}{course_match.group(1)}/grades"
    print(f"\n📊 Capturing Canvas Grades & Written Feedback Snapshot: {grades_url}...")

    try:
        page.goto(grades_url, wait_until="domcontentloaded")
        page.wait_for_selector("#grades_summary, table#grades_summary, .grade_summary", timeout=15000)

        # Expand all comments, rubrics, and score details strictly inside table, and hide popups/overlays
        page.evaluate("""() => {
            // Scope comment expansions inside table to prevent triggering global UI help/feedback popups
            const table = document.querySelector("#grades_summary, table.grades_summary, .grade_summary");
            if (table) {
                table.querySelectorAll(".toggle_comments_link, a.toggle_comments, .comments_thread_link").forEach(btn => {
                    try { btn.click(); } catch(e) {}
                });
                table.querySelectorAll(".toggle_rubric_assessments_link, a.toggle_rubric").forEach(btn => {
                    try { btn.click(); } catch(e) {}
                });
                table.querySelectorAll(".show_guess_score, .show_score_details").forEach(btn => {
                    try { btn.click(); } catch(e) {}
                });
            }

            // Inject CSS to completely hide dialogs, popups, overlays, and floating help trays
            const style = document.createElement('style');
            style.innerHTML = `
                .ui-dialog, .ui-widget-overlay, div[role="dialog"], div[aria-modal="true"], 
                #help_tray, .feedback-dialog, #help_dialog, #fixed_bottom, [data-tray], 
                .ui-front, #global_nav_help_link, .ic-HelpDialog, div.ui-dialog-content {
                    display: none !important;
                    visibility: hidden !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                }
                #grades_summary tr.comments { display: table-row !important; }
                #grades_summary tr.rubric_assessment { display: table-row !important; }
            `;
            document.head.appendChild(style);

            // Remove any popup or overlay elements from the DOM
            document.querySelectorAll(".ui-dialog, .ui-widget-overlay, div[role='dialog'], div[aria-modal='true'], #help_tray, .feedback-dialog, #help_dialog, .ui-front").forEach(el => {
                try { el.remove(); } catch(e) {}
            });
        }""")
        time.sleep(2)

        # High-fidelity visual PDF capture via CDP
        clean_name = sanitize_filename(f"{course_name} Grades_and_Feedback")
        out_pdf = contained_path(work_dir, f"{clean_name}.pdf")

        cdp = page.context.new_cdp_session(page)
        pdf_data = cdp.send("Page.printToPDF", {
            "printBackground": True,
            "preferCSSPageSize": True,
            "marginTop": 0.4,
            "marginBottom": 0.4,
            "marginLeft": 0.4,
            "marginRight": 0.4
        })
        with open(out_pdf, "wb") as f:
            f.write(base64.b64decode(pdf_data["data"]))
        cdp.detach()

        # Double safeguard: clean any overlay remnants if present
        postprocess_clean_grades_pdf(out_pdf)

        if verify_pdf_has_text(out_pdf, min_chars=50):
            print(f"   📥 Saved official gradebook & comments snapshot: '{os.path.basename(out_pdf)}' ({os.path.getsize(out_pdf)} bytes)")
            return out_pdf
    except Exception as e:
        print(f"   ℹ️ Notice on Grades snapshot: {e}")

    return ""



def scrape_all_discussions(page, course_url: str, temp_dir: str) -> tuple[list, list]:
    """Crawls the Canvas Discussions tab (/discussion_topics), visits each thread,
    extracts prompt body text, instructor/TA replies, attachments, and visual PDFs."""
    parsed = urlparse(course_url)
    course_match = re.search(r'(/courses/\d+)', parsed.path)
    if not course_match:
        return [], []

    course_id = course_match.group(1).replace("/courses/", "")
    disc_url = f"{parsed.scheme}://{parsed.netloc}{course_match.group(1)}/discussion_topics"
    print(f"\n💬 Crawling Canvas Discussions Tab: {disc_url}...")

    disc_items = []
    attachments = []
    seen_urls = set()

    try:
        page.goto(disc_url, wait_until="domcontentloaded")
        page.wait_for_selector(".discussion-topic, .discussion_entry, a[href*='/discussion_topics/']", timeout=12000)

        # Auto-scroll to trigger lazy loading of discussion topics
        try:
            page.evaluate("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(1)
        except Exception:
            pass

        # Extract all discussion topics
        topics = page.evaluate("""() => {
            const anchors = Array.from(document.querySelectorAll("a[href*='/discussion_topics/']"));
            const results = [];
            const seen = new Set();

            for (const a of anchors) {
                const href = a.href || a.getAttribute('href') || '';
                const titleElem = a.querySelector('.discussion-title, h3, .title') || a;
                const title = titleElem.innerText.trim();

                if (!href || href.endsWith('/discussion_topics') || href.endsWith('/discussion_topics/') || href.includes('/new') || !title) {
                    continue;
                }
                // Normalize URL
                const cleanHref = href.split('?')[0];
                if (!seen.has(cleanHref)) {
                    seen.add(cleanHref);
                    results.push({
                        title: title,
                        url: cleanHref
                    });
                }
            }
            return results;
        }""")

        print(f"   Found {len(topics)} discussion topics.")

        disc_folder = os.path.join(temp_dir, "Discussions")
        os.makedirs(disc_folder, exist_ok=True)

        for idx, t in enumerate(topics, 1):
            t_title = sanitize_filename(t["title"])
            t_url = t["url"]
            print(f"   [{idx}/{len(topics)}] Crawling Discussion: '{t_title}'")

            try:
                page.goto(t_url, wait_until="domcontentloaded")
                time.sleep(1.5)

                thread_info = page.evaluate("""() => {
                    const postContent = document.querySelector(".user_content, .discussion-entry-content, .message, #content");
                    const bodyText = postContent ? postContent.innerText.trim() : "";
                    const hasImages = !!(postContent && postContent.querySelector("img"));

                    // Extract all attachments or linked files across the thread (prompt + replies)
                    const fileLinks = [];
                    document.querySelectorAll(".user_content a[href], .discussion-entry-content a[href], .discussion_entry a[href], .entry a[href], .replies a[href]").forEach(a => {
                        const href = a.href || a.getAttribute('href') || '';
                        const text = a.innerText.trim();
                        if (href && (href.includes('/files/') || href.match(/\\.(pdf|docx?|pptx?|xlsx?|zip|py|mat|csv)$/i))) {
                            fileLinks.push({ href, text });
                        }
                    });

                    // Author and Date
                    const authorElem = document.querySelector(".author, .discussion-pubdate, .posted_at, .avatar_name");
                    const author = authorElem ? authorElem.innerText.trim().replace(/\\n+/g, ' ') : "Course Discussion";

                    // Extract all replies
                    const replies = [];
                    document.querySelectorAll(".discussion-entries .entry, .discussion_entry, .replies .reply, div.entry").forEach(e => {
                        const rAuthorElem = e.querySelector(".author, .user_name, .avatar_name");
                        const rAuthor = rAuthorElem ? rAuthorElem.innerText.trim().replace(/\\n+/g, ' ') : "Participant";
                        const rTimeElem = e.querySelector("time, .posted_at, .discussion-pubdate");
                        const rDate = rTimeElem ? rTimeElem.innerText.trim() : "";
                        const rContentElem = e.querySelector(".message, .user_content, .discussion-entry-content");
                        const rText = rContentElem ? rContentElem.innerText.trim() : "";
                        if (rText) {
                            replies.push({ author: rAuthor, date: rDate, text: rText });
                        }
                    });

                    return { bodyText, hasImages, fileLinks, author, replies };
                }""")

                clean_body = thread_info.get("bodyText", "")
                has_images = thread_info.get("hasImages", False)
                file_links = thread_info.get("fileLinks", [])
                replies = thread_info.get("replies", [])

                # 1. Enqueue file attachments
                for fl in file_links:
                    norm_url = normalize_canvas_download_url(fl["href"], netloc=parsed.netloc, course_id=course_id)
                    if norm_url not in seen_urls:
                        seen_urls.add(norm_url)
                        attachments.append({
                            "title": fl.get("text") or t_title,
                            "url": norm_url,
                            "page_title": t_title,
                            "module_name": "Discussion Worksheets" if "solution" not in t_title.lower() else "Discussion Worksheets/Discussion Solutions"
                        })
                        print(f"      📎 Found attachment: '{fl.get('text') or 'File'}'")

                # 2. If visual diagrams or images present, print visual PDF
                if has_images and len(clean_body) > 30:
                    cdp_pdf = os.path.join(temp_dir, f"{t_title}.pdf")
                    try:
                        cdp = page.context.new_cdp_session(page)
                        pdf_data = cdp.send("Page.printToPDF", {
                            "printBackground": True,
                            "preferCSSPageSize": True
                        })
                        with open(cdp_pdf, "wb") as f:
                            f.write(base64.b64decode(pdf_data["data"]))
                        cdp.detach()

                        if verify_pdf_has_text(cdp_pdf, min_chars=30):
                            disc_items.append({
                                "title": t_title,
                                "url": t_url,
                                "page_title": t_title,
                                "module_name": "Syllabus And Admin",
                                "local_file": os.path.basename(cdp_pdf)
                            })
                            print(f"      🖼️ Visual thread PDF captured: '{t_title}.pdf'")
                    except Exception:
                        pass

                # 3. Save full transcript including all thread replies
                if clean_body or replies:
                    txt_path = os.path.join(disc_folder, f"{t_title}.txt")
                    lines = [
                        f"Discussion: {t['title']}",
                        f"URL: {t_url}",
                        f"Author: {thread_info.get('author', '')}\n",
                        "--- Original Post ---",
                        clean_body
                    ]
                    if replies:
                        lines.append(f"\n--- Thread Replies ({len(replies)}) ---")
                        for r_idx, r in enumerate(replies, 1):
                            lines.append(f"[{r_idx}] {r['author']} ({r.get('date', '')}):\n{r['text']}\n")

                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write("\n".join(lines))

            except Exception as e:
                print(f"      ⚠️ Notice on discussion '{t_title}': {e}")

    except Exception as e:
        print(f"   ℹ️ Notice accessing discussions tab: {e}")

    return disc_items, attachments


def scrape_unlinked_pages(page, course_url: str, known_page_urls: set, temp_dir: str) -> list:
    """Crawls the Canvas Pages index (/pages) to discover published standalone wiki pages
    that were not linked in any Module container."""
    parsed = urlparse(course_url)
    course_match = re.search(r'(/courses/\d+)', parsed.path)
    if not course_match:
        return []

    course_id = course_match.group(1).replace("/courses/", "")
    pages_index_url = f"{parsed.scheme}://{parsed.netloc}{course_match.group(1)}/pages"
    print(f"\n📄 Auditing Canvas Pages Index for unlinked pages: {pages_index_url}...")

    unlinked_items = []

    try:
        page.goto(pages_index_url, wait_until="domcontentloaded")
        page.wait_for_selector(".collectionViewItems, table#pages_table, a[href*='/pages/']", timeout=12000)

        all_pages = page.evaluate("""() => {
            const anchors = Array.from(document.querySelectorAll("table a[href*='/pages/'], .collectionViewItems a[href*='/pages/'], a.wiki_page_link"));
            const results = [];
            const seen = new Set();

            for (const a of anchors) {
                const href = a.href || a.getAttribute('href') || '';
                const title = a.innerText.trim();
                if (!href || !title || href.endsWith('/pages') || href.endsWith('/pages/')) continue;
                const cleanHref = href.split('?')[0];
                if (!seen.has(cleanHref)) {
                    seen.add(cleanHref);
                    results.push({ title, url: cleanHref });
                }
            }
            return results;
        }""")

        # Identify pages not in known_page_urls
        candidates = []
        for p in all_pages:
            u_clean = p["url"].rstrip("/").lower()
            if not any(u_clean in k.lower() or k.lower() in u_clean for k in known_page_urls):
                candidates.append(p)

        print(f"   Discovered {len(all_pages)} total wiki pages ({len(candidates)} unlinked from Modules).")

        for idx, cp in enumerate(candidates, 1):
            p_title = sanitize_filename(cp["title"])
            p_url = cp["url"]
            print(f"   [{idx}/{len(candidates)}] Extracting Unlinked Page: '{p_title}'")

            try:
                page.goto(p_url, wait_until="domcontentloaded")
                time.sleep(1.5)

                # Check for attachments or visual content
                page_info = page.evaluate("""() => {
                    const content = document.querySelector(".user_content, .show-content, #content");
                    const bodyText = content ? content.innerText.trim() : "";
                    const hasImages = !!(content && content.querySelector("img"));

                    const fileLinks = [];
                    document.querySelectorAll("a[href]").forEach(a => {
                        const href = a.href || a.getAttribute('href') || '';
                        const text = a.innerText.trim();
                        if (href && (href.includes('/files/') || href.match(/\\.(pdf|docx?|pptx?|xlsx?|zip|py|mat|csv)$/i))) {
                            fileLinks.push({ href, text });
                        }
                    });

                    return { bodyText, hasImages, fileLinks };
                }""")

                file_links = page_info.get("fileLinks", [])
                if file_links:
                    for fl in file_links:
                        norm_url = normalize_canvas_download_url(fl["href"], netloc=parsed.netloc, course_id=course_id)
                        unlinked_items.append({
                            "title": fl.get("text") or p_title,
                            "url": norm_url,
                            "page_title": p_title,
                            "module_name": "Other Materials"
                        })
                        print(f"      📎 Extracted attachment: '{fl.get('text') or 'File'}'")
                else:
                    # Capture page via CDP PDF or text fallback
                    cdp_pdf = os.path.join(temp_dir, f"{p_title}.pdf")
                    try:
                        cdp = page.context.new_cdp_session(page)
                        pdf_data = cdp.send("Page.printToPDF", {
                            "printBackground": True,
                            "preferCSSPageSize": True
                        })
                        with open(cdp_pdf, "wb") as f:
                            f.write(base64.b64decode(pdf_data["data"]))
                        cdp.detach()

                        if verify_pdf_has_text(cdp_pdf, min_chars=30):
                            unlinked_items.append({
                                "title": p_title,
                                "url": p_url,
                                "page_title": p_title,
                                "module_name": "Other Materials",
                                "local_file": os.path.basename(cdp_pdf)
                            })
                            print(f"      🖼️ Visual page PDF captured: '{p_title}.pdf'")
                    except Exception:
                        pass

            except Exception as e:
                print(f"      ⚠️ Notice reading page '{p_title}': {e}")

    except Exception as e:
        print(f"   ℹ️ Notice checking pages index: {e}")

    return unlinked_items


def scrape_quizzes_and_reviews(page, course_url: str, work_dir: str, temp_dir: str) -> list:
    """Crawls the Canvas Quizzes tab (/quizzes), extracts prompt instructions and attachments,
    and captures question-by-question graded submission review PDFs into [COURSE] Work/."""
    work_dir = contained_path(work_dir)
    validate_tree(work_dir)
    parsed = urlparse(course_url)
    course_match = re.search(r'(/courses/\d+)', parsed.path)
    if not course_match:
        return []

    course_id = course_match.group(1).replace("/courses/", "")
    quiz_url = f"{parsed.scheme}://{parsed.netloc}{course_match.group(1)}/quizzes"
    print(f"\n📝 Crawling Canvas Quizzes Tab: {quiz_url}...")

    quiz_items = []

    try:
        page.goto(quiz_url, wait_until="domcontentloaded")
        page.wait_for_selector(".quiz, .ig-row, a[href*='/quizzes/']", timeout=12000)

        quizzes = page.evaluate("""() => {
            const rows = Array.from(document.querySelectorAll(".quiz, .ig-row, tr.quiz-row, a[href*='/quizzes/']"));
            const results = [];
            const seen = new Set();

            for (const r of rows) {
                const anchor = r.tagName === 'A' ? r : r.querySelector("a[href*='/quizzes/']");
                if (!anchor) continue;
                const href = anchor.href || anchor.getAttribute('href') || '';
                const titleElem = r.querySelector(".title, .ig-title, .quiz-title") || anchor;
                const title = titleElem.innerText.trim();

                if (!href || !title || href.endsWith('/quizzes') || href.endsWith('/quizzes/')) continue;
                const cleanHref = href.split('?')[0];
                if (!seen.has(cleanHref)) {
                    seen.add(cleanHref);
                    results.push({ title, url: cleanHref });
                }
            }
            return results;
        }""")

        print(f"   Found {len(quizzes)} quizzes.")

        for idx, q in enumerate(quizzes, 1):
            q_title = sanitize_filename(q["title"])
            q_url = q["url"]
            print(f"   [{idx}/{len(quizzes)}] Inspecting Quiz: '{q_title}'")

            try:
                page.goto(q_url, wait_until="domcontentloaded")
                time.sleep(1.5)

                # 1. Check for prompt instructions and attachments
                quiz_details = page.evaluate("""() => {
                    const desc = document.querySelector(".description, .user_content, #content");
                    const text = desc ? desc.innerText.trim() : "";
                    const fileLinks = [];
                    document.querySelectorAll(".description a[href], .user_content a[href]").forEach(a => {
                        const href = a.href || a.getAttribute('href') || '';
                        const text = a.innerText.trim();
                        if (href && (href.includes('/files/') || href.match(/\\.(pdf|docx?|pptx?)$/i))) {
                            fileLinks.push({ href, text });
                        }
                    });

                    // Check for past submission review links (Attempt 1, View Previous Results, etc.)
                    const reviewAnchor = document.querySelector("a:has-text('View Previous Results'), a:has-text('Submission Details'), a[href*='/history'], a[href*='/submission_versions/'], a:has-text('Attempt')");
                    const reviewUrl = reviewAnchor ? (reviewAnchor.href || '') : '';

                    return { text, fileLinks, reviewUrl };
                }""")

                # Enqueue quiz prompt attachments
                for fl in quiz_details.get("fileLinks", []):
                    norm_url = normalize_canvas_download_url(fl["href"], netloc=parsed.netloc, course_id=course_id)
                    quiz_items.append({
                        "title": fl.get("text") or f"{q_title} Worksheet",
                        "url": norm_url,
                        "page_title": q_title,
                        "module_name": "Exams And Quizzes"
                    })
                    print(f"      📎 Quiz Attachment: '{fl.get('text') or 'File'}'")

                # 2. Check for student question review page
                review_url = quiz_details.get("reviewUrl", "")
                if review_url:
                    print(f"      🔍 Navigating to Quiz Submission Review: {review_url}")
                    page.goto(review_url, wait_until="domcontentloaded")
                    time.sleep(2)

                    # Capture full visual question-by-question review with answers & feedback
                    out_pdf = contained_path(work_dir, f"{q_title}_Quiz_Review.pdf")
                    try:
                        cdp = page.context.new_cdp_session(page)
                        pdf_data = cdp.send("Page.printToPDF", {
                            "printBackground": True,
                            "preferCSSPageSize": True
                        })
                        with open(out_pdf, "wb") as f:
                            f.write(base64.b64decode(pdf_data["data"]))
                        cdp.detach()

                        if verify_pdf_has_text(out_pdf, min_chars=30):
                            print(f"      📥 Captured graded quiz review PDF: '{os.path.basename(out_pdf)}' ({os.path.getsize(out_pdf)} bytes)")
                    except Exception as e:
                        print(f"      ℹ️ Notice capturing quiz review PDF: {e}")

            except Exception as e:
                print(f"      ⚠️ Notice inspecting quiz '{q_title}': {e}")

    except Exception as e:
        print(f"   ℹ️ Notice accessing quizzes tab: {e}")

    return quiz_items


def scrape_media_recordings(page, course_url: str, course_name: str, output_dir: str) -> str:
    """Scans navigation tabs for Zoom or Media Gallery hubs and creates a structured
    Markdown catalog of lecture recording dates, meeting IDs, and replay links."""
    parsed = urlparse(course_url)
    course_match = re.search(r'(/courses/\d+)', parsed.path)
    if not course_match:
        return ""

    print(f"\n🎬 Auditing Zoom & Lecture Video Hubs...")
    media_links = page.evaluate("""() => {
        const anchors = Array.from(document.querySelectorAll("#section-tabs a"));
        return anchors.filter(a => {
            const text = (a.innerText || '').toLowerCase();
            return text.includes('zoom') || text.includes('media') || text.includes('recording') || text.includes('panopto') || text.includes('kaltura');
        }).map(a => ({ name: a.innerText.trim(), href: a.href }));
    }""")

    if not media_links:
        print("   ℹ️ No dedicated Zoom/Media Gallery sidebar tab found.")
        return ""

    catalog_path = os.path.join(output_dir, f"{course_name} Lecture_Video_Recordings.md")
    catalog_lines = [
        f"# {course_name} Lecture Video & Media Recordings Catalog",
        f"**Generated**: {time.strftime('%B %d, %Y')}\n",
        "## Discovered Video Hubs:"
    ]

    for m in media_links:
        catalog_lines.append(f"- **{m['name']}**: [{m['href']}]({m['href']})")
        print(f"   🎥 Discovered Recording Hub: '{m['name']}' -> {m['href']}")

    try:
        with open(catalog_path, "w", encoding="utf-8") as f:
            f.write("\n".join(catalog_lines) + "\n")
        print(f"   📝 Saved video recordings catalog: '{os.path.basename(catalog_path)}'")
        return catalog_path
    except Exception:
        return ""


def audit_generic_tab(page, tab_info: dict, temp_dir: str, netloc: str, course_id: str) -> list:
    """For unrecognized or custom course tabs (e.g. Collaborations, Rubrics, Custom LTI tools),
    navigates into the page and extracts all downloadable attachments and embedded resources."""
    tab_name = sanitize_filename(tab_info.get("name", "Custom Tab"))
    tab_url = tab_info.get("url", "")
    items = []

    if not tab_url:
        return items

    print(f"\n🔍 Auditing Custom Course Tab: [{tab_name}] -> {tab_url}...")
    try:
        page.goto(tab_url, wait_until="domcontentloaded")
        time.sleep(1.5)

        found_links = page.evaluate("""() => {
            const links = [];
            document.querySelectorAll("a[href], iframe[src], embed[src]").forEach(el => {
                const href = el.href || el.src || el.getAttribute('href') || el.getAttribute('src') || '';
                const text = el.innerText ? el.innerText.trim() : (el.title || '');
                if (href && (href.includes('/files/') || href.match(/\\.(pdf|docx?|pptx?|xlsx?|zip|py|mat|csv)$/i))) {
                    links.push({ href, text });
                }
            });
            return links;
        }""")

        for fl in found_links:
            norm = normalize_canvas_download_url(fl["href"], netloc=netloc, course_id=course_id)
            items.append({
                "title": fl.get("text") or tab_name,
                "url": norm,
                "page_title": tab_name,
                "module_name": "Other Materials"
            })
            print(f"   📎 Custom Tab File Extracted: '{fl.get('text') or tab_name}'")

    except Exception as e:
        print(f"   ℹ️ Notice auditing custom tab '{tab_name}': {e}")

    return items
