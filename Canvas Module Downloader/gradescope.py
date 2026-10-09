# gradescope.py
# Dedicated Gradescope submission downloader:
# Authenticates using the persistent browser profile, discovers all course assignments,
# and downloads original student submissions and graded copies with rubrics into [COURSE] Work/.

import os
import re
import time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from capturer import sanitize_filename
from safety import atomic_json, contained_path, resolve_course_root, validate_component, validate_tree, unique_destination
from sleep_helper import check_internet_connection, wait_for_network_resume


def check_and_prompt_gradescope_login(page) -> bool:
    """Checks if Gradescope requires user authentication and prompts if needed."""
    current_url = page.url.lower()
    needs_login = (
        "login" in current_url or
        "shibboleth" in current_url or
        "saml" in current_url or
        page.query_selector("#session_email, form[action*='login'], .form-login")
    )
    if needs_login:
        print("\n" + "=" * 60)
        print("🔑 GRADESCOPE LOGIN REQUIRED IN THE BROWSER WINDOW.")
        print("   1. Click 'Log In' -> 'School Credentials' (e.g. UCLA) or your login method.")
        print("   2. Complete authentication.")
        print("=" * 60 + "\n")
        input("👉 Press Enter once you have logged into Gradescope in the browser...\n")
        # Ensure session and cookies are explicitly persisted to storage state
        try:
            user_data_dir = os.path.expanduser("~/.canvas_browser_profile")
            state_path = os.path.join(user_data_dir, "gradescope_state.json")
            atomic_json(state_path, page.context.storage_state())
            print("   🍪 Gradescope authentication saved to persistent profile!")
        except Exception:
            pass
        return True
    return False


def get_course_assignments(page, course_url: str, course_name: str = "") -> list:
    """Extracts all assignment items and their submission status from the Gradescope course page.
    If course_url is the general dashboard, automatically finds and navigates into the matching course."""
    print(f"\n🔍 Crawling Gradescope Course Dashboard: {course_url}...")
    page.goto(course_url, wait_until="domcontentloaded")
    try:
        page.wait_for_selector(".courseList--coursesForTerm, a.courseBox, a[href*='/courses/'], table#assignments-student-table, #session_email, form[action*='login'], .form-login", timeout=30000)
    except Exception:
        pass

    check_and_prompt_gradescope_login(page)

    # If currently on the main dashboard, find the course link matching course_name
    if "/courses/" not in page.url or page.url.rstrip("/") in ["https://www.gradescope.com", "https://gradescope.com"]:
        print("   🔍 Detecting enrolled courses on dashboard...")
        courses = page.evaluate("""() => {
            const anchors = Array.from(document.querySelectorAll(".courseList--coursesForTerm a, a.courseBox, a[href*='/courses/']"));
            return anchors.map(a => {
                const titleElem = a.querySelector(".courseBox--name, .courseBox--shortname, h3, h4") || a;
                return {
                    name: (titleElem.innerText || a.innerText).trim().replace(/\\n+/g, ' '),
                    url: a.href
                };
            }).filter(c => c.url.includes("/courses/"));
        }""")

        target_url = ""
        c_clean = re.sub(r'[^a-zA-Z0-9]', '', course_name.lower())
        for c in courses:
            name_clean = re.sub(r'[^a-zA-Z0-9]', '', c["name"].lower())
            if c_clean and (c_clean in name_clean or name_clean in c_clean):
                target_url = c["url"]
                print(f"   🎯 Auto-matched course '{c['name']}': {target_url}")
                break

        if not target_url and courses:
            print("\nEnrolled Gradescope Courses Found:")
            for idx, c in enumerate(courses, 1):
                print(f"   [{idx}] {c['name']}")
            # Auto-select the closest match or first
            target_url = courses[0]["url"]
            print(f"   Selecting: {courses[0]['name']}")

        if target_url:
            page.goto(target_url, wait_until="domcontentloaded")
            try:
                page.wait_for_selector("table#assignments-student-table, tr[role='row'], a[href*='/assignments/']", timeout=30000)
            except Exception:
                pass

    # Wait for assignment table rows to be present
    try:
        page.wait_for_selector("table#assignments-student-table tbody tr, .courseList-item, tr[role='row'], a[href*='/assignments/']", timeout=30000)
    except Exception:
        pass

    # In-browser evaluate to extract assignment table data
    assignments = page.evaluate("""() => {
        const rows = Array.from(document.querySelectorAll("table#assignments-student-table tbody tr, .courseList-item, tr[role='row']"));
        const items = [];

        for (const row of rows) {
            const titleElem = row.querySelector("th button, th a, .assignmentName, th");
            const title = titleElem ? titleElem.innerText.trim() : "";
            if (!title) continue;

            const allAnchors = Array.from(row.querySelectorAll("a[href]"));
            let href = "";
            for (const a of allAnchors) {
                const h = a.getAttribute("href") || "";
                if (h.includes("/assignments/") || h.includes("/submissions/")) {
                    href = h;
                    break;
                }
            }

            // Check if row has data attributes or button onclick
            const btn = row.querySelector("button, th button");
            const btnId = btn ? (btn.id || btn.getAttribute("data-assignment-id") || "") : "";

            // Status (e.g., Submitted, Graded, No Submission)
            const statusElem = row.querySelector(".submissionStatus, td:nth-child(2), td.status");
            const statusText = statusElem ? statusElem.innerText.trim() : "";

            // Score (e.g., 95.0 / 100.0)
            const scoreElem = row.querySelector(".submissionStatus--score, td:nth-child(3)");
            const scoreText = scoreElem ? scoreElem.innerText.trim() : "";

            items.push({
                title: title,
                url: href,
                status: statusText,
                score: scoreText,
                btn_id: btnId
            });
        }
        return items;
    }""")

    # If no table was found, try finding direct assignment links
    if not assignments:
        assignments = page.evaluate("""() => {
            const links = Array.from(document.querySelectorAll("a[href*='/assignments/']"));
            const items = [];
            const seen = new Set();
            for (const a of links) {
                const href = a.getAttribute("href") || "";
                const text = a.innerText.trim();
                if (!href || seen.has(href) || !text) continue;
                seen.add(href);
                items.push({
                    title: text,
                    url: href,
                    status: "Unknown",
                    score: ""
                });
            }
            return items;
        }""")

    cleaned = []
    base_url = "https://www.gradescope.com"
    for item in assignments:
        u = item.get("url", "")
        if u:
            full_url = u if u.startswith("http") else f"{base_url}{u}"
            item["url"] = full_url
            cleaned.append(item)

    print(f"   Found {len(cleaned)} assignments on Gradescope.")
    return cleaned


def download_single_submission(page, assign_item: dict, work_dir: str) -> list:
    """Visits a single Gradescope assignment, downloads student submission and/or graded copy."""
    assign_title = sanitize_filename(assign_item.get("title", "Assignment"))
    assign_url = assign_item.get("url", "")
    downloaded_files = []

    if not assign_url:
        return downloaded_files

    print(f"   Inspecting: '{assign_title}' ({assign_item.get('status', '')}) -> URL: {assign_url}")
    if not check_internet_connection():
        wait_for_network_resume()

    try:
        if assign_url:
            page.goto(assign_url, wait_until="domcontentloaded")
        else:
            # If no URL, click the assignment button in the table
            print(f"      🔍 Clicking table entry for '{assign_title}'...")
            page.click(f"button:has-text('{assign_title}'), a:has-text('{assign_title}')")

        # Explicitly wait up to 30 seconds for submission content or action buttons to appear on the page
        try:
            page.wait_for_selector(
                ".actionBar, button:has-text('Download Original'), button:has-text('Download Submission'), "
                "button:has-text('Download Graded Copy'), .submissionOutlineQuestion, .submissionView, "
                "#question-view, .pdf-viewer, embed, iframe",
                timeout=30000
            )
        except Exception:
            pass

        print(f"      📄 Current Submission URL: {page.url}")

        # 1. Check for action bar or direct download links on the page
        links_info = page.evaluate("""() => {
            const allLinks = Array.from(document.querySelectorAll("a, button, [role='button']"));
            const downloadLinks = [];
            for (const el of allLinks) {
                const text = el.innerText.trim();
                const href = el.href || el.getAttribute('href') || '';
                const aria = el.getAttribute('aria-label') || '';
                const combined = (text + ' ' + aria + ' ' + href).toLowerCase();

                if (combined.includes('download') || combined.includes('submission') || combined.includes('graded') || combined.includes('export')) {
                    downloadLinks.push({
                        text: text || aria || 'Download',
                        href: href,
                        is_btn: el.tagName === 'BUTTON' || el.getAttribute('role') === 'button',
                        selector: el.id ? '#' + el.id : (el.className ? '.' + el.className.split(' ').join('.') : '')
                    });
                }
            }
            return downloadLinks;
        }""")

        # Option A: Click "Download Original" or "Download Graded Copy"
        submission_btn_selector = "button:has-text('Download Original'), a:has-text('Download Original'), button:has-text('Download Submission'), a:has-text('Download Submission'), a[href*='download=true'], .js-downloadSubmission"
        graded_btn_selector = "button:has-text('Download Graded Copy'), a:has-text('Download Graded Copy'), button:has-text('Download PDF'), a:has-text('Download PDF')"

        # Try original submission download (30s timeout)
        btn_orig = page.query_selector(submission_btn_selector)
        if btn_orig:
            try:
                with page.expect_download(timeout=30000) as download_info:
                    btn_orig.click()
                download = download_info.value
                ext = os.path.splitext(sanitize_filename(download.suggested_filename))[1] or ".pdf"
                out_filename = f"{assign_title}_Submission{ext}"
                out_path = unique_destination(contained_path(work_dir, sanitize_filename(out_filename)))
                download.save_as(out_path)
                print(f"      📥 Downloaded original submission: '{out_filename}'")
                downloaded_files.append(out_path)
            except Exception as e:
                print(f"      ℹ️ Direct download original notice: {e}")

        # Try graded copy download (handles background PDF generation modal if present, 30s timeout)
        btn_graded = page.query_selector(graded_btn_selector)
        if btn_graded:
            try:
                with page.expect_download(timeout=30000) as download_info:
                    btn_graded.click()
                    # Wait up to 10s for modal export dialog if present
                    try:
                        modal_download = page.wait_for_selector(".modal button:has-text('Download'), .modal a:has-text('Download'), button.js-exportPdf, .modal button.tiiBtn-primary", timeout=10000)
                        if modal_download:
                            modal_download.click()
                    except Exception:
                        pass
                download = download_info.value
                ext = os.path.splitext(sanitize_filename(download.suggested_filename))[1] or ".pdf"
                out_filename = f"{assign_title}_Graded_Copy{ext}"
                out_path = unique_destination(contained_path(work_dir, sanitize_filename(out_filename)))
                download.save_as(out_path)
                print(f"      📥 Downloaded graded copy with rubrics: '{out_filename}'")
                downloaded_files.append(out_path)
            except Exception as e:
                print(f"      ℹ️ Graded copy notice: {e}")

        # Option B: Fallback - capture PDF from viewer or CDP print if submission is visible
        if not downloaded_files:
            # Check for embedded PDF in iframe/object/embed
            pdf_src = page.evaluate("""() => {
                const embed = document.querySelector(".pdf-viewer embed, embed[type='application/pdf'], iframe[src*='.pdf'], iframe[src*='blob:']");
                return embed ? (embed.src || embed.getAttribute('src') || '') : '';
            }""")
            if pdf_src and pdf_src.startswith("http"):
                out_filename = f"{assign_title}_Submission.pdf"
                out_path = unique_destination(contained_path(work_dir, sanitize_filename(out_filename)))
                try:
                    # [Codex] Stream with the same HTTPS, cookie-scope, size and
                    # atomic publication rules as regular course downloads.
                    from downloader import create_session, download_file
                    with create_session(cookies=page.context.cookies()) as session:
                        downloaded_name = download_file(session, pdf_src, out_filename, work_dir)
                    if downloaded_name:
                        out_path = contained_path(work_dir, downloaded_name)
                        print(f"      📥 Captured viewer submission PDF: '{out_filename}'")
                        downloaded_files.append(out_path)
                except Exception as e:
                    print(f"      ℹ️ Failed to fetch viewer PDF: {e}")

            # Option C: High-fidelity visual PDF snapshot of the student submission & rubric view
            if not downloaded_files:
                has_submission_view = page.query_selector(".submissionView, .grading-dashboard, .submission-content, #question-view, .submissionOutlineQuestion")
                if has_submission_view:
                    import base64
                    out_filename = f"{assign_title}_Graded_View.pdf"
                    out_path = unique_destination(contained_path(work_dir, sanitize_filename(out_filename)))
                    try:
                        cdp = page.context.new_cdp_session(page)
                        pdf_data = cdp.send("Page.printToPDF", {
                            "printBackground": True,
                            "preferCSSPageSize": True
                        })
                        with open(out_path, "wb") as f:
                            f.write(base64.b64decode(pdf_data["data"]))
                        print(f"      🖼️ Captured visual graded submission & rubric PDF: '{out_filename}'")
                        downloaded_files.append(out_path)
                        cdp.detach()
                    except Exception as e:
                        print(f"      ℹ️ Visual snapshot notice: {e}")

    except Exception as e:
        print(f"      ⚠️ Error checking assignment '{assign_title}': {e}")

    return downloaded_files


def sync_gradescope_course(course_url_or_id: str, course_name: str, headless: bool = True,
                           output_dir: str = "") -> int:
    """Main entrypoint for Gradescope sync.
    Takes a Gradescope course URL, ID, or blank (which uses dashboard and matches course_name),
    navigates assignments, and downloads submissions into the selected course's Work folder."""

    # Format URL
    raw_target = str(course_url_or_id or "").strip()
    if not raw_target:
        course_url = "https://www.gradescope.com"
    elif raw_target.isdigit():
        course_url = f"https://www.gradescope.com/courses/{raw_target}"
    elif raw_target.startswith("http"):
        course_url = raw_target
    else:
        m = re.search(r'courses/(\d+)', raw_target)
        if m:
            course_url = f"https://www.gradescope.com/courses/{m.group(1)}"
        else:
            course_url = "https://www.gradescope.com"

    target = urlparse(course_url)
    if target.scheme != 'https' or target.hostname not in {'gradescope.com', 'www.gradescope.com'} or target.username or target.password:
        raise ValueError('Gradescope sync requires an HTTPS Gradescope URL')
    validate_component(course_name)
    course_root = (resolve_course_root(output_dir, course_name) if output_dir else
                   contained_path(os.path.expanduser('~/Desktop'), course_name))
    work_dir = contained_path(course_root, f"{course_name} Work")
    validate_tree(work_dir)
    os.makedirs(work_dir, exist_ok=True)

    user_data_dir = os.path.expanduser("~/.canvas_browser_profile")
    state_path = os.path.join(user_data_dir, "gradescope_state.json")
    contained_path(user_data_dir)
    os.makedirs(user_data_dir, mode=0o700, exist_ok=True)
    os.chmod(user_data_dir, 0o700)
    if os.path.exists(state_path):
        contained_path(user_data_dir, "gradescope_state.json")
        os.chmod(state_path, 0o600)

    # If state file exists, run completely silent/headless so no Chrome window pops up
    is_headless = headless if os.path.exists(state_path) else False

    print("\n" + "=" * 60)
    print(f"🎓 SYNCING GRADESCOPE SUBMISSIONS FOR: {course_name}")
    print(f"📂 Destination: {work_dir}")
    print(f"🖥️ Mode: {'Silent Background (Headless)' if is_headless else 'Browser Window (Login Required)'}")
    print("=" * 60)

    total_downloaded = 0

    with sync_playwright() as p:
        browser = None
        if os.path.exists(state_path):
            browser = p.chromium.launch(
                headless=is_headless,
                args=["--no-first-run", "--no-default-browser-check"]
            )
            context = browser.new_context(
                storage_state=state_path,
                accept_downloads=True,
                viewport={'width': 1280, 'height': 800}
            )
            page = context.new_page()
        else:
            context = p.chromium.launch_persistent_context(
                user_data_dir,
                headless=is_headless,
                accept_downloads=True,
                viewport={'width': 1280, 'height': 800}
            )
            page = context.pages[0] if context.pages else context.new_page()

        assignments = get_course_assignments(page, course_url, course_name)
        if not assignments:
            print("   ℹ️ No assignments found or course page could not be accessed.")
            context.close()
            if browser:
                browser.close()
            return 0

        # Filter to assignments that indicate a submission or grade
        candidate_assignments = []
        for a in assignments:
            st = a.get("status", "").lower()
            if any(k in st for k in ["submitted", "graded", "late", "complete"]) or a.get("score") or st == "unknown" or not st:
                candidate_assignments.append(a)

        print(f"\n📥 Found {len(candidate_assignments)} submitted assignments to process.")

        for idx, assign in enumerate(candidate_assignments, start=1):
            print(f"\n[{idx}/{len(candidate_assignments)}] Processing Gradescope: {assign.get('title')}")
            files = download_single_submission(page, assign, work_dir)
            total_downloaded += len(files)

        try:
            context.storage_state(path=state_path)
        except Exception:
            pass
        context.close()
        if browser:
            browser.close()

    print(f"\n✅ Gradescope sync complete! Downloaded {total_downloaded} files to {work_dir}")
    return total_downloaded


if __name__ == "__main__":
    import sys
    target_course = sys.argv[1] if len(sys.argv) > 1 else input("Enter Gradescope Course URL or ID: ").strip()
    name = sys.argv[2] if len(sys.argv) > 2 else input("Enter Course Name (e.g. CHEM 14D): ").strip()
    sync_gradescope_course(target_course, name, headless=True)
