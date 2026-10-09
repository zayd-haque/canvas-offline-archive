# canvas_organizer.py
# AI-powered file organizer: builds course knowledge base, classifies files,
# and moves them to structured folders using local Ollama LLM.

import os
import re
import json
import time
import shutil
from functools import lru_cache
from safety import validate_hierarchy, validate_tree, resolve_course_root, contained_path, move_unique, bounded_pdf_text, atomic_generated_text
import signal
import logging

import requests
from llm_client import query_llm, ProviderError
from knowledge import build_comprehensive_course_knowledge
from sorter import sort_gigantic_folders
from canvas_blueprint import CourseBlueprint

# Silence pypdf warnings
logging.getLogger("pypdf").setLevel(logging.CRITICAL)
logging.getLogger("pypdf._reader").setLevel(logging.CRITICAL)
logging.disable(logging.WARNING)

DEFAULT_FOLDER = "Other Materials"

# Default folder structure used when config.json has no disk_hierarchy/custom_folders.
# Matches the original hardcoded category_map. Each entry has:
#   name: folder path (may include / for nesting)
#   parent: "study_materials" or "student_work" (routing target)
#   types: semantic type tags for keyword matching
#   description: detailed guidance injected into the AI classification prompt
DEFAULT_FOLDERS = [
    {
        "id": "syllabus", "name": "Syllabus And Admin",
        "parent": "study_materials", "types": ["syllabus", "admin"],
        "description": "Course syllabus, grading policies, schedules, instructor details, office hours, Zoom links, academic announcements."
    },
    {
        "id": "hw_assign", "name": "Homework Assignments",
        "parent": "study_materials", "types": ["assignments", "homework"],
        "description": "Active homework problem sets, student assignment prompts, online homework (InQuizitive, WebAssign). (Must NOT contain answers/solutions)."
    },
    {
        "id": "hw_solutions", "name": "Homework Solutions",
        "parent": "study_materials", "types": ["solutions", "keys"],
        "description": "Official answer keys, rubrics, and solution sheets for homework."
    },
    {
        "id": "disc_ws", "name": "Discussion Worksheets",
        "parent": "study_materials", "types": ["discussions", "worksheets"],
        "description": "Blank recitation worksheets, exercise problem sets, question sheets distributed in discussion. (Must NOT contain answers/solutions; NOT presentation slides)."
    },
    {
        "id": "disc_sol", "name": "Discussion Worksheets/Discussion Solutions",
        "parent": "study_materials", "types": ["discussion_solutions"],
        "description": "Official answer keys and solutions for discussion worksheets."
    },
    {
        "id": "lecture", "name": "Lecture Slides",
        "parent": "study_materials", "types": ["slides", "lectures"],
        "description": "Main professor course lecture slides, PPT/PDF presentation decks, chapter summaries, textbook readings, lecture notes."
    },
    {
        "id": "disc_slides", "name": "Discussion Slides",
        "parent": "study_materials", "types": ["discussion_slides"],
        "description": "Presentation slides, slide decks, PowerPoint, or instructional slideshows used in discussion sections to explain concepts."
    },
    {
        "id": "prac_exam", "name": "Exams And Quizzes/Practice Exams",
        "parent": "study_materials", "types": ["practice_exams"],
        "description": "ANY exam, quiz, or midterm from a PAST quarter or PAST year (e.g. Summer 2025, Fall 2024, Spring 2023, previous years), sample midterms, mock finals, review questions. (Must NOT contain answers/solutions)."
    },
    {
        "id": "prac_exam_sol", "name": "Exams And Quizzes/Practice Exams/Practice Exam Solutions",
        "parent": "study_materials", "types": ["practice_exam_solutions"],
        "description": "Answer keys and solutions for past/sample/practice exams."
    },
    {
        "id": "cur_exam", "name": "Exams And Quizzes/Current Exams",
        "parent": "study_materials", "types": ["current_exams"],
        "description": "Midterms, quizzes, and finals for the ACTIVE, current course term without past-term/year labels."
    },
    {
        "id": "cur_exam_sol", "name": "Exams And Quizzes/Current Exams/Current Exam Solutions",
        "parent": "study_materials", "types": ["current_exam_solutions"],
        "description": "Answer keys and solutions for current term active exams."
    },
    {
        "id": "other", "name": "Other Materials",
        "parent": "study_materials", "types": ["other", "reference"],
        "description": "Campus resources, student welfare flyers, software links, general support."
    },
]


def get_folder_config(config: dict) -> list:
    """Returns the active folder configuration list.
    Reads from config['disk_hierarchy']['custom_folders'] if present,
    otherwise falls back to DEFAULT_FOLDERS."""
    hier = config.get("disk_hierarchy")
    if isinstance(hier, dict):
        custom = hier.get("custom_folders")
        if isinstance(custom, list) and custom:
            return custom
    return DEFAULT_FOLDERS


def get_work_dir(config: dict, course_name: str, output_dir: str = "") -> str:
    """Returns the absolute path to the student work directory,
    respecting the disk_hierarchy work_folder template if configured."""
    hier = config.get("disk_hierarchy") if isinstance(config, dict) else None
    template = hier.get("work_folder", "{course} Work") if isinstance(hier, dict) else "{course} Work"
    if template:
        folder_name = template.replace("{course}", course_name)
    else:
        folder_name = f"{course_name} Work"

    if output_dir:
        # [Codex] Compact layouts use the course itself as output, not its parent.
        course_root = resolve_course_root(output_dir, course_name)
        return contained_path(course_root, folder_name)

    return os.path.expanduser(os.path.join("~/Desktop", course_name, folder_name))


def find_matching_folder(folders: list, preferred_names: list, type_tags: list = None, fallback: str = DEFAULT_FOLDER) -> str:
    """Finds a matching folder name from folder config based on preferred names or type tags."""
    if not folders:
        return fallback
    # Pass 1: exact name match (case-insensitive)
    for f in folders:
        name = f.get("name", "")
        if any(p.lower() == name.lower() for p in preferred_names):
            return name
    # Pass 2: substring match in folder name
    for f in folders:
        name = f.get("name", "")
        if any(p.lower() in name.lower() or name.lower() in p.lower() for p in preferred_names):
            return name
    # Pass 3: type tag match
    if type_tags:
        for f in folders:
            f_types = [t.lower() for t in f.get("types", [])]
            if any(t.lower() in f_types for t in type_tags):
                return f.get("name", fallback)
    return fallback


def resolve_cat_num(category_map: dict, folders: list, preferred_names: list, type_tags: list = None, default: int = 1) -> int:
    """Resolves the category index number for a target category in category_map."""
    matched_name = find_matching_folder(folders, preferred_names, type_tags, fallback="")
    if matched_name:
        for num, name in category_map.items():
            if name == matched_name:
                return num
    return default


def folder_name_by_type(folders: list, type_tag: str) -> str:
    """Looks up a folder name from the folder config by matching a type tag.
    Returns DEFAULT_FOLDER if no match is found."""
    for f in folders:
        if type_tag in f.get("types", []):
            return f["name"]
    return DEFAULT_FOLDER


def build_category_map(folders: list) -> dict:
    """Builds a numbered category_map dict from the folder config list."""
    return {i + 1: f["name"] for i, f in enumerate(folders)}


def build_categories_prompt(folders: list) -> str:
    """Generates the CATEGORIES section of the AI prompt dynamically from folder config."""
    lines = []
    for i, f in enumerate(folders, 1):
        desc = f.get("description", ", ".join(f.get("types", [])))
        lines.append(f"{i}. {f['name']}: {desc}")
    return "\n".join(lines)


def folder_parent(folders: list, folder_name: str) -> str:
    """Returns the parent routing target ('study_materials' or 'student_work')
    for a given folder name. Defaults to 'study_materials'."""
    for f in folders:
        if f["name"] == folder_name:
            return f.get("parent", "study_materials")
    return "study_materials"


def load_config(config_path: str) -> dict:
    """Loads configuration from config.json."""
    with open(config_path, "r") as f:
        return json.load(f)


def auto_decode_text(text: str) -> str:
    """Detects if PDF extracted text is Caesar-shifted and automatically decodes it."""
    if not text or len(text) < 10:
        return text

    common_words = {"the", "and", "of", "to", "is", "in", "that", "it", "with", "for",
                    "on", "are", "as", "at", "be", "by", "have", "from", "solutions",
                    "homework", "exam", "midterm", "discussion", "lecture", "chapter"}

    words_orig = re.findall(r'[a-zA-Z]+', text.lower())
    max_matches = sum(1 for w in words_orig if w in common_words)
    if max_matches >= 3:
        return text

    # Optimize: evaluate shift scores on a 400-char sample rather than full document 93 times
    sample = text[:400]
    best_shift = 0

    for shift in range(1, 94):
        candidate_sample = "".join(
            chr(33 + (ord(c) - 33 + shift) % 94) if 33 <= ord(c) <= 126 else c
            for c in sample
        )
        words_cand = re.findall(r'[a-zA-Z]+', candidate_sample.lower())
        matches = sum(1 for w in words_cand if w in common_words)
        if matches > max_matches:
            max_matches = matches
            best_shift = shift

    if best_shift > 0:
        return "".join(
            chr(33 + (ord(c) - 33 + best_shift) % 94) if 33 <= ord(c) <= 126 else c
            for c in text
        )

    return text


def extract_file_text(file_path: str, max_pages: int = 20, max_chars: int = 8000) -> str:
    try:
        st = os.stat(file_path)
        return _cached_extract(file_path, st.st_mtime_ns, st.st_size, max_pages, max_chars)
    except OSError:
        return ""


@lru_cache(maxsize=128)
def _cached_extract(file_path, modified, size, max_pages, max_chars):
    """Extracts text from PDF or text files for AI analysis.
    For Gemini: reads up to 20 pages (15 front, 5 back) and up to 8000 chars.
    For Ollama: stays lightweight at 4 pages and 2000 chars to conserve Mac RAM/VRAM."""
    text_content = ""
    ext = os.path.splitext(file_path)[1].lower()

    try:
        if ext == ".pdf":
            text_content = bounded_pdf_text(file_path, max_pages, max_chars)
        elif ext in [".txt", ".md", ".py", ".csv"]:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                text_content = f.read(max_chars)
    except Exception:
        pass

    return auto_decode_text(text_content.strip())


def check_and_reset_ollama_ram(config: dict):
    """Checks Ollama RAM usage and force-kills Ollama runner if it exceeds max_ram_mb (6GB)."""
    if config.get("llm_provider", "gemini").lower() != "ollama":
        return
    if os.name == 'nt':
        # The Unix process-list parser cannot measure Windows RSS. Do not kill
        # unrelated Ollama processes based on a guessed measurement.
        return
    max_ram = config.get("max_ram_mb", 6000)
    try:
        import subprocess as _sp
        out = _sp.run(["ps", "-e", "-o", "pid,rss,command"], capture_output=True, text=True).stdout

        for line in out.strip().split("\n"):
            line_lower = line.lower()
            if any(k in line_lower for k in ["llama-server", "ollama", "ollama_llama_server", "ollama_runner", "qwen"]):
                parts = line.strip().split()
                if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
                    pid = int(parts[0])
                    rss_mb = int(parts[1]) / 1024.0
                    if rss_mb > max_ram:
                        print(f"\n   ⚠️ Ollama process (PID {pid}) reached {rss_mb/1024:.2f} GB (>{max_ram/1024:.1f} GB). Resetting to reclaim RAM...")
                        try:
                            ollama_url = config.get("ollama_url", "http://localhost:11434/api/generate")
                            model = config.get("ollama_model", "qwen2.5:7b")
                            requests.post(ollama_url, json={"model": model, "keep_alive": 0}, timeout=2)
                        except Exception:
                            pass
                        os.kill(pid, signal.SIGKILL)
                        time.sleep(2)
                        return
    except Exception as e:
        print(f"Memory reset error: {e}")





def build_custom_keywords_prompt(config: dict) -> str:
    """Builds a dynamic prompt section from custom keywords in config.json."""
    rules = config.get("category_rules", [])
    if not rules:
        return ""

    lines = ["\nCUSTOM KEYWORD MAPPINGS (from user configuration):"]
    for rule in rules:
        folder = rule["folder"]
        keywords = ", ".join(f"'{k}'" for k in rule["keywords"])
        lines.append(f"  - If filename/title contains any of [{keywords}], it likely belongs in '{folder}'.")
    return "\n".join(lines)


def categorize_by_keywords(text: str, config: dict) -> str:
    """Keyword-based rule engine that evaluates text against category rules and folder config."""
    text_lower = text.lower()
    rules = config.get("category_rules", [])
    folders = get_folder_config(config)

    is_admin = any(k in text_lower for k in ["syllabus", "schedule", "policy", "rubric", "information", "announcement", "notice", "office hour", "zoom", "grade"])
    is_discussion = any(k in text_lower for k in ["discussion", "worksheet", "recitation"])
    is_disc_slides = ("discussion" in text_lower or "recitation" in text_lower) and any(k in text_lower for k in ["slide", "slides", "presentation", "ppt", "deck"])
    is_homework = any(k in text_lower for k in ["homework", "assignment", "assigment", "problem set", "pset", "suggested review", "recommended problem", "review problems", "alm"]) or bool(re.search(r'\bhw\b', text_lower))
    is_exam = any(k in text_lower for k in ["exam", "midterm", "final", "quiz"])
    is_solution = any(k in text_lower for k in ["solution", "soln", "answer key"]) or bool(re.search(r'\b(sol|key|solved)\b', text_lower))
    is_practice = any(k in text_lower for k in ["practice", "sample", "past", "previous", "mock"]) or bool(re.search(r'(summer|fall|winter|spring)\s*\d{2,4}|\b20[0-4]\d\b', text_lower))
    is_notes = any(k in text_lower for k in ["notes", "chapter", "reading", "readings", "slides", "presentation"]) or bool(re.search(r'\bch\s*\d+', text_lower))

    # 0. Admin announcements and syllabus
    if is_admin and not (is_solution or (is_homework and not any(k in text_lower for k in ["announcement", "notice"])) or (is_discussion and not any(k in text_lower for k in ["announcement", "notice"]))):
        return find_matching_folder(folders, ["Syllabus And Admin", "Syllabus & Admin", "Syllabus", "Admin"], ["syllabus", "admin"], "Syllabus And Admin")

    # 1. Exam Solutions
    if is_exam and is_solution:
        if is_practice:
            return find_matching_folder(folders, ["Exams And Quizzes/Practice Exams/Practice Exam Solutions", "Practice Exam Solutions", "Exam Solutions", "Exams & Quizzes", "Exams"], ["practice_exam_solutions", "solutions", "exams"], "Exams And Quizzes/Practice Exams/Practice Exam Solutions")
        else:
            return find_matching_folder(folders, ["Exams And Quizzes/Current Exams/Current Exam Solutions", "Current Exam Solutions", "Exam Solutions", "Exams & Quizzes", "Exams"], ["current_exam_solutions", "solutions", "exams"], "Exams And Quizzes/Current Exams/Current Exam Solutions")

    # 2. Practice Exams
    if is_exam and is_practice:
        return find_matching_folder(folders, ["Exams And Quizzes/Practice Exams", "Practice Exams", "Exams & Quizzes", "Exams"], ["practice_exams", "exams"], "Exams And Quizzes/Practice Exams")

    # 3. Current Exams
    if is_exam:
        return find_matching_folder(folders, ["Exams And Quizzes/Current Exams", "Current Exams", "Exams & Quizzes", "Quizzes", "Exams"], ["current_exams", "quizzes", "exams"], "Exams And Quizzes/Current Exams")

    # 4. Discussion Slides
    if is_disc_slides:
        return find_matching_folder(folders, ["Discussion Slides", "Lecture Slides", "Slides"], ["discussion_slides", "slides"], "Discussion Slides")

    # 5. Discussion Solutions
    if is_discussion and is_solution:
        return find_matching_folder(folders, ["Discussion Worksheets/Discussion Solutions", "Discussion Solutions", "Homework Solutions"], ["discussion_solutions", "solutions"], "Discussion Worksheets/Discussion Solutions")

    # 6. Discussion Worksheets
    if is_discussion:
        return find_matching_folder(folders, ["Discussion Worksheets", "Worksheets", "Assignments"], ["discussions", "worksheets"], "Discussion Worksheets")

    # 6. Homework Solutions & Generic Solutions
    if is_solution:
        return find_matching_folder(folders, ["Homework Solutions", "Solutions"], ["solutions", "keys"], "Homework Solutions")

    # 7. Homework Assignments
    if is_homework:
        return find_matching_folder(folders, ["Homework Assignments", "Assignments"], ["assignments", "homework"], "Homework Assignments")

    # 8. Lecture Slides & Notes
    if is_notes:
        return find_matching_folder(folders, ["Lecture Slides", "Slides"], ["slides", "lectures"], "Lecture Slides")

    # Fallback to configured keyword list
    for rule in rules:
        for kw in rule["keywords"]:
            if kw in text_lower:
                return rule["folder"]

    return find_matching_folder(folders, ["Other Materials", "Other"], ["other", "reference"], DEFAULT_FOLDER)


def categorize_with_ai(file_path: str, fallback_title: str, output_dir: str,
                       config: dict, course_name: str, module_titles: list,
                       module_name: str = "") -> str:
    """Holistic AI Classifier: Evaluates file text (expanded 20-page for Gemini, lightweight 4-page for Ollama)."""
    file_name = os.path.basename(file_path)
    use_rule_engine = config.get("use_rule_engine", False)
    folders = get_folder_config(config)
    category_map = build_category_map(folders)
    num_categories = len(folders)

    # If rule engine is explicitly enabled in config.json
    if use_rule_engine:
        kw_folder = categorize_by_keywords(f"{file_name} {fallback_title}", config)
        if kw_folder != DEFAULT_FOLDER:
            print(f"   🎯 Rule Engine: Matched [{file_name}] -> [{kw_folder}]")
            return kw_folder

    provider = config.get("llm_provider", "gemini").lower()
    gemini_key = config.get("gemini_api_key", "").strip()
    is_ollama = (provider == "ollama")

    # Unified high-fidelity reading depth and prompt limits (matching Gemini Flash Lite):
    # 20 pages sampled (15 front, 5 back), 8000 max text chars, 3500 prompt chars
    extracted_text = extract_file_text(file_path, max_pages=20, max_chars=8000) if os.path.exists(file_path) else ""
    content_preview = extracted_text[:3500] if extracted_text else "No text extracted."

    # If using local Ollama, verify service is running and monitor RAM
    if is_ollama:
        check_and_reset_ollama_ram(config)

    # Read course knowledge base
    course_context = "No course knowledge guide available."
    md_path = os.path.join(output_dir, "course_knowledge.md")
    if os.path.exists(md_path):
        try:
            with open(md_path, "r", encoding="utf-8", errors="ignore") as f:
                course_context = f.read(2500).strip()
        except Exception:
            pass

    # Custom keyword overrides to inject into prompt context
    custom_keywords_prompt = build_custom_keywords_prompt(config)
    categories_prompt = build_categories_prompt(folders)

    prompt = f"""You are an academic course document classifier.
Select the single best category number (1-{num_categories}) for the document below.

DOCUMENT DETAILS:
- Filename: "{file_name}"
- Page Title: "{fallback_title}"
- Canvas Module: "{module_name or 'General / Unspecified'}"
- Content Preview:
---
{content_preview}
---
- Course Knowledge Context:
---
{course_context[:1500]}
---

CATEGORIES:
{categories_prompt}

CRITICAL CLASSIFICATION RULES:
1. CANVAS MODULE WEIGHTING:
   - Strong Signal: Give strong weight to the Canvas Module name. If the module is clearly dedicated to a category (e.g. 'Discussion Worksheets', 'Discussion Slides', 'Lecture Slides', 'Practice Exams'), strongly weight that category.
   - Mixed Modules: If the module is organized by topic/chapter/week (e.g. 'Chapter 12', 'Week 3') or contains mixed items (e.g. worksheets mixed with solutions or slides), evaluate each file individually by its filename and content to place it in its respective folder.
2. DISCUSSION SLIDES vs WORKSHEETS: Slide decks, presentations, and slideshows explaining material in discussion go to Discussion Slides. Blank exercise sheets and problem worksheets go to Discussion Worksheets.
3. PAST EXAMS vs CURRENT EXAMS: Any exam labeled with a past quarter or past year (e.g. Summer 2025, Fall 2024, Spring 2023, previous years) or labeled 'sample/practice' MUST go to Practice Exams or Practice Exam Solutions. Current term exams go to Current Exams.
4. SOLUTIONS vs QUESTIONS: Any document containing worked solutions, answer keys, or rubrics goes to the appropriate Solutions category.
{custom_keywords_prompt}

Respond ONLY with the single category number (1 to {num_categories}). Do not write any other text."""

    try:
        ai_result = query_llm(prompt, config, timeout=20, num_ctx=4096)
        from llm_client import resolve_ollama_model
        ollama_url = config.get("ollama_url", "http://localhost:11434/api/generate")
        active_model = resolve_ollama_model(config, ollama_url) if is_ollama else config.get("gemini_model", "gemini-flash-lite-latest")
        model_name = "Qwen AI" if "qwen" in active_model.lower() else "Local Ollama"
        provider_name = f"{model_name} ({active_model})" if is_ollama else "Gemini AI"
        match = re.search(r'\b(\d+)\b', ai_result)
        if match:
            parsed_num = int(match.group(1))
            if 1 <= parsed_num <= num_categories:
                cat_num = parsed_num

                # Targeted guardrails: if AI categorized as generic/admin/other, refine using clear filename cues
                fn_lower = file_name.lower()
                mod_lower = module_name.lower()

                # Practice Exams: if filename has past terms or sample/practice/past, ensure it goes to Practice Exams
                if any(k in fn_lower for k in ["practice", "sample", "past", "mock"]) or re.search(r'(summer|fall|winter|spring)\s*\d{2,4}|\b20[0-4]\d\b', fn_lower):
                    if any(k in fn_lower for k in ["solution", "sol", "key", "answers", "with answers"]):
                        cat_num = resolve_cat_num(category_map, folders, ["Practice Exam Solutions", "Exams And Quizzes/Practice Exams/Practice Exam Solutions", "Exam Solutions", "Exams & Quizzes", "Exams"], ["practice_exam_solutions", "solutions", "exams"], cat_num)
                    elif any(k in fn_lower for k in ["exam", "midterm", "quiz", "final"]):
                        cat_num = resolve_cat_num(category_map, folders, ["Practice Exams", "Exams And Quizzes/Practice Exams", "Exams & Quizzes", "Exams"], ["practice_exams", "exams"], cat_num)
                else:
                    curr_name = category_map.get(cat_num, "").lower()
                    is_admin_or_other = (cat_num in (1, num_categories)) or any(k in curr_name for k in ["admin", "syllabus", "other", "general"])
                    if is_admin_or_other:
                        # Discussion Slides
                        if ("discussion" in fn_lower or "disc" in fn_lower) and any(k in fn_lower for k in ["slide", "slides", "presentation", "ppt", "deck"]):
                            cat_num = resolve_cat_num(category_map, folders, ["Discussion Slides", "Lecture Slides"], ["discussion_slides", "slides"], cat_num)
                        # Quizzes that got misclassified as Admin or Other
                        elif "quiz" in fn_lower:
                            if any(k in fn_lower for k in ["solution", "sol", "key", "answers"]):
                                cat_num = resolve_cat_num(category_map, folders, ["Current Exam Solutions", "Exams And Quizzes/Current Exams/Current Exam Solutions", "Exam Solutions", "Exams & Quizzes", "Quizzes"], ["current_exam_solutions", "solutions", "quizzes"], cat_num)
                            else:
                                cat_num = resolve_cat_num(category_map, folders, ["Current Exams", "Exams And Quizzes/Current Exams", "Exams & Quizzes", "Quizzes", "Exams"], ["current_exams", "quizzes", "exams"], cat_num)
                        # Worksheets that got misclassified as Admin or Other
                        elif "worksheet" in fn_lower or "discussion" in fn_lower:
                            if any(k in fn_lower for k in ["solution", "sol", "key", "answers"]):
                                cat_num = resolve_cat_num(category_map, folders, ["Discussion Solutions", "Discussion Worksheets/Discussion Solutions", "Homework Solutions"], ["discussion_solutions", "solutions"], cat_num)
                            else:
                                cat_num = resolve_cat_num(category_map, folders, ["Discussion Worksheets", "Worksheets", "Assignments"], ["discussions", "worksheets"], cat_num)

                if cat_num in category_map:
                    chosen_folder = category_map[cat_num]
                    print(f"   🤖 {provider_name} Selected Category [{cat_num}]: [{chosen_folder}]")
                    return chosen_folder
    except ProviderError:
        raise
    except Exception as e:
        print(f"   ⚠️ AI inference error: {e}")

    # Fallback to keyword match if AI output couldn't be parsed
    sample_text = f"{file_name} {fallback_title} {extracted_text[:500]}"
    kw_fallback = categorize_by_keywords(sample_text, config)
    print(f"   ⚠️ AI output unparseable, using keyword fallback: [{kw_fallback}]")
    return kw_fallback


def detect_exam_subfolders(module_titles: list) -> dict:
    """Detects exam clusters (Midterm 1, Midterm 2, Final) from module titles."""
    potential_clusters = {
        "midterm 1": "Midterm 1", "midterm 2": "Midterm 2", "midterm 3": "Midterm 3",
        "final": "Final",
        "quiz 1": "Quiz 1", "quiz 2": "Quiz 2", "quiz 3": "Quiz 3", "quiz 4": "Quiz 4"
    }

    cluster_counts = {key: 0 for key in potential_clusters}
    for title in module_titles:
        title_lower = title.lower()
        for key in potential_clusters:
            if key in title_lower:
                cluster_counts[key] += 1

    exams_map = {}
    for key, label in potential_clusters.items():
        if cluster_counts[key] > 2:
            exams_map[key] = label

    if exams_map:
        labels = ", ".join(f"'{v}'" for v in exams_map.values())
        print(f"📁 Detected exam clusters for auto-subfolder: {labels}")

    return exams_map


def process_announcements_for_homework(output_dir: str, course_name: str, config: dict):
    """Inspects course announcements for assigned homework, extracting:
    1. Day Assigned (announcement date / post date)
    2. Day Due (submission deadline)
    3. The Assignment Itself (problem numbers, reading chapters, instructions)
    Outputs a dedicated Markdown file to ~/Desktop/[COURSE]/[COURSE] Work/
    and integrates into course_knowledge.md."""
    temp_dir = os.path.join(output_dir, ".temp_downloads")
    json_path = os.path.join(temp_dir, ".announcements.json")
    if not os.path.exists(json_path):
        json_path = os.path.join(output_dir, ".announcements.json")
    if not os.path.exists(json_path):
        return

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            announcements = json.load(f)
    except Exception:
        return

    if not announcements:
        return

    print(f"\n📢 Scanning {len(announcements)} course announcements for assigned homework & deadlines...")

    provider = config.get("llm_provider", "gemini").lower()
    is_ollama = (provider == "ollama")

    # Build structured announcement feed
    ann_blocks = []
    for a in announcements:
        body = a.get("body", "")
        preview_body = body[:3000]
        ann_blocks.append(
            f"--- ANNOUNCEMENT ---\n"
            f"Title: {a.get('title')}\n"
            f"Date Posted: {a.get('date')}\n"
            f"Author: {a.get('author')}\n"
            f"Content:\n{preview_body}\n"
        )
    combined_ann = "\n\n".join(ann_blocks)
    content_limit = 25000 if is_ollama else 40000

    prompt = f"""You are an academic course assistant for '{course_name}'.
Review the following course announcements carefully.
Determine if ANY homework, problem sets, textbook exercises, reading assignments, or submission tasks were assigned in these announcements.

ANNOUNCEMENTS ARCHIVE:
===
{combined_ann[:content_limit]}
===

INSTRUCTIONS:
For every assigned task or homework mentioned, extract:
1. **Day Assigned**: The date the announcement was posted or date it was assigned (YYYY-MM-DD).
2. **Day Due**: The due date / deadline stated by the instructor (or 'Not specified' if unstated).
3. **The Assignment Itself**: Detailed description of what must be done (textbook chapter, specific problem numbers, prompt questions, submission instructions).

FORMAT REQUIREMENTS:
Output in clean Markdown format:
# {course_name} Assigned Homework from Announcements

| Day Assigned | Day Due | Assignment Details | Source Announcement |
| :--- | :--- | :--- | :--- |
| YYYY-MM-DD | YYYY-MM-DD | Problem numbers, chapter exercises, instructions | Title of Announcement |

Below the table, provide an expanded section with full detailed instructions for each assignment if needed.
If NO homework was assigned in any of the announcements, respond strictly with:
# {course_name} Assigned Homework from Announcements
*No homework or problem sets were assigned in course announcements.*

Do NOT include any conversational preamble or pleasantries. Output only the Markdown."""

    try:
        hw_report = query_llm(prompt, config, timeout=30, num_ctx=8192)
    except ProviderError:
        raise
    except Exception as e:
        print(f"   ⚠️ Could not extract homework from announcements: {e}")
        hw_report = ""

    if not hw_report or len(hw_report.strip()) < 20:
        hw_report = f"# {course_name} Assigned Homework from Announcements\n\n*No homework assigned via announcements.*"

    # Save directly to ~/Desktop/[COURSE]/[COURSE] Work/[COURSE] Announcements_Assigned_Homework.md
    work_dir = get_work_dir(config, course_name, output_dir)
    os.makedirs(work_dir, exist_ok=True)
    report_path = os.path.join(work_dir, f"{course_name} Announcements_Assigned_Homework.md")

    atomic_generated_text(report_path, hw_report.strip() + "\n")
    print(f"   📝 Saved: '{course_name} Announcements_Assigned_Homework.md' -> '{os.path.basename(work_dir)}/'")

    # Merge into course_knowledge.md in Lectures & Resources
    md_path = os.path.join(output_dir, "course_knowledge.md")
    if os.path.exists(md_path) and "*No homework" not in hw_report:
        try:
            with open(md_path, "r", encoding="utf-8") as f:
                ck_content = f.read()
            marker = "## Assigned Homework & Deadlines from Announcements"
            if marker in ck_content:
                ck_content = ck_content.split(marker)[0].strip()
            new_ck = ck_content + f"\n\n{marker}\n\n{hw_report.strip()}\n"
            atomic_generated_text(md_path, new_ck)
            print("   📅 Merged announcement homework into course_knowledge.md")
        except Exception:
            pass


def organize(output_dir: str, course_name: str, config_path: str):
    """Main organizer function: builds knowledge base, classifies files, and moves them."""
    config = load_config(config_path)
    validate_hierarchy(config)
    course_root = resolve_course_root(output_dir, course_name)
    validate_tree(course_root)
    temp_dir = os.path.join(output_dir, ".temp_downloads")

    if not os.path.exists(temp_dir):
        print("❌ No .temp_downloads folder found. Run the launcher and downloader first.")
        return

    # Load or initialize Course Blueprint for offline Canvas LMS recreation
    blueprint_path = os.path.join(output_dir, "canvas_course.json")
    root_bp = os.path.join(course_root, "canvas_course.json")
    if os.path.exists(blueprint_path):
        try:
            blueprint = CourseBlueprint.load(blueprint_path)
        except Exception:
            blueprint = CourseBlueprint(course_name=course_name, course_url="", output_dir=output_dir)
    elif os.path.exists(root_bp):
        try:
            blueprint = CourseBlueprint.load(root_bp)
        except Exception:
            blueprint = CourseBlueprint(course_name=course_name, course_url="", output_dir=output_dir)
    else:
        blueprint = CourseBlueprint(course_name=course_name, course_url="", output_dir=output_dir)

    # Load module titles from modules map
    module_titles = []
    modules_map_path = os.path.join(output_dir, ".modules_map.json")
    if os.path.exists(modules_map_path):
        with open(modules_map_path, "r") as f:
            modules_data = json.load(f)
        module_titles = modules_data.get("module_titles", [])

    config['_private_reclassification'] = os.path.exists(os.path.join(temp_dir, '.reclassify_manifest.json'))
    if config.get('llm_provider', 'gemini') == 'gemini':
        print('Selected Gemini cloud processing sends course excerpts and filenames, including submitted coursework and reclassified files, to Google. Select Ollama to keep AI classification local.')
    # Build comprehensive course knowledge base (Chapter & Topic Breakdown)
    if not config.get("_private_reclassification"):
        build_comprehensive_course_knowledge(output_dir, config, course_name, module_titles, temp_dir)

    # Process announcements to extract assigned homework and deadlines
    if not config.get("_private_reclassification"):
        process_announcements_for_homework(output_dir, course_name, config)

    # Detect exam subfolders
    exams_subfolder_map = detect_exam_subfolders(module_titles)

    # [Codex] Flatten crawler-created subdirectories without discarding collisions.
    for root, dirs, files in os.walk(temp_dir, topdown=False):
        if root == temp_dir:
            continue
        for name in files:
            if not name.startswith('.'):
                move_unique(contained_path(temp_dir, os.path.relpath(os.path.join(root, name), temp_dir)), contained_path(temp_dir, name))
        if not os.listdir(root):
            os.rmdir(root)

    # Gather all temp files (excluding system and internal json maps)
    all_temp_files = [f for f in os.listdir(temp_dir) if not f.startswith(".") and f != "course_knowledge.md" and os.path.isfile(os.path.join(temp_dir, f))]

    # Load file metadata map (contains item titles and parent module names)
    file_metadata = {}
    meta_path = os.path.join(output_dir, ".file_metadata.json")
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                file_metadata = json.load(f)
        except Exception:
            pass

    modules_map_path = os.path.join(output_dir, ".modules_map.json")
    if os.path.exists(modules_map_path) and not file_metadata:
        try:
            with open(modules_map_path, "r", encoding="utf-8") as f:
                m_data = json.load(f)
                for item in m_data.get("downloadable_items", []):
                    t = item.get("title", "")
                    if t:
                        file_metadata[t] = item
        except Exception:
            pass

    # Step 3: Classify and organize all files
    provider = config.get("llm_provider", "gemini").lower()
    gemini_key = config.get("gemini_api_key", "").strip()
    is_ollama = (provider == "ollama")
    ollama_delay = 0.5
    if is_ollama:
        try:
            from llm_client import get_system_hardware_profile
            hw_prof = get_system_hardware_profile()
            if hw_prof.get("is_fanless"):
                ollama_delay = 0.8
        except Exception:
            pass

    print(f"\n📁 Phase 3: Classifying and organizing {len(all_temp_files)} files...")
    folders = get_folder_config(config)
    hw_target = find_matching_folder(folders, ["Homework Assignments", "Assignments"], ["assignments", "homework"], "Homework Assignments")
    hw_sol_target = find_matching_folder(folders, ["Homework Solutions", "Solutions"], ["solutions", "keys"], "Homework Solutions")
    syl_target = find_matching_folder(folders, ["Syllabus And Admin", "Syllabus & Admin", "Syllabus"], ["syllabus", "admin"], "Syllabus And Admin")
    disc_target = find_matching_folder(folders, ["Discussion Worksheets", "Worksheets"], ["discussions", "worksheets"], "Discussion Worksheets")
    cur_exam_target = find_matching_folder(folders, ["Exams And Quizzes/Current Exams", "Current Exams", "Exams & Quizzes", "Quizzes"], ["current_exams", "exams"], "Exams And Quizzes/Current Exams")
    lec_target = find_matching_folder(folders, ["Lecture Slides", "Slides"], ["slides", "lectures"], "Lecture Slides")
    prac_exam_target = find_matching_folder(folders, ["Exams And Quizzes/Practice Exams", "Practice Exams"], ["practice_exams", "exams"], "Exams And Quizzes/Practice Exams")
    prac_sol_target = find_matching_folder(folders, ["Exams And Quizzes/Practice Exams/Practice Exam Solutions", "Practice Exam Solutions", "Exam Solutions"], ["practice_exam_solutions", "solutions"], "Exams And Quizzes/Practice Exams/Practice Exam Solutions")

    for index, file in enumerate(all_temp_files, start=1):
        temp_path = os.path.join(temp_dir, file)
        if not os.path.exists(temp_path):
            continue

        f_lower = file.lower()

        # Guard: Purge Canvas system artifacts & 404 error pages
        if f_lower in ("duplicate.pdf", "edit.pdf", "build.pdf"):
            try:
                os.remove(temp_path)
                print(f"   🗑️ Purged Canvas system artifact: '{file}'")
                continue
            except Exception:
                pass

        if f_lower.endswith(".pdf") or f_lower.endswith(".txt"):
            preview_txt = extract_file_text(temp_path, max_pages=20, max_chars=8000)[:400].lower()
            if "page not found" in preview_txt and ("whoops" in preview_txt or "couldn't find that page" in preview_txt):
                try:
                    os.remove(temp_path)
                    print(f"   🗑️ Purged Canvas 404 error page: '{file}'")
                    continue
                except Exception:
                    pass

        # Guard: Suppress redundant Syllabus.txt / Syllabus.md if an official syllabus PDF exists
        if f_lower in ("syllabus.txt", "syllabus.md"):
            has_official_syl_pdf = any(
                "syllabus" in f.lower() and f.lower().endswith((".pdf", ".docx", ".doc")) and not f.lower().startswith("syllabus_visual_snapshot")
                for f in all_temp_files
            )
            if not has_official_syl_pdf and os.path.exists(output_dir):
                for root, _, files in os.walk(output_dir):
                    if any("syllabus" in f.lower() and f.lower().endswith((".pdf", ".docx", ".doc")) and not f.lower().startswith("syllabus_visual_snapshot") for f in files):
                        has_official_syl_pdf = True
                        break

            if has_official_syl_pdf:
                try:
                    os.remove(temp_path)
                    print(f"   🗑️ Suppressed redundant '{file}' since official syllabus PDF exists.")
                    continue
                except Exception:
                    pass

        print(f"[{index}/{len(all_temp_files)}] Classifying: '{file}'")

        meta = file_metadata.get(file, {})
        if not meta:
            for k, v in file_metadata.items():
                if k.lower() in file.lower() or file.lower() in k.lower():
                    meta = v
                    break

        item_module = meta.get("module_name", "")
        item_title = meta.get("page_title", meta.get("title", file))

        # Pacing delay between file classifications:
        if is_ollama:
            # Thermal pacing pause for local GPU/SoC to prevent overheating and fan blow-up
            time.sleep(ollama_delay)
        else:
            # Pacing delay to avoid burst rate limits on Gemini API
            time.sleep(0.15)

        save_folder = categorize_with_ai(temp_path, item_title, output_dir, config, course_name, module_titles, module_name=item_module)


        # Force all student submissions, action items, and InQuizitive into Work
        if "inquizitive" in f_lower:
            save_folder = f"{hw_target}/InQuizitive Online Homework"
        elif any(w in f_lower for w in ["submission", "response submission", "alm response", "submitted", "action item"]):
            if any(k in f_lower for k in ["rubric", "key", "solution", "answers"]):
                save_folder = hw_sol_target
            else:
                save_folder = hw_target

        # Force syllabus into admin
        elif "syllabus" in f_lower:
            save_folder = syl_target

        # Route assignment prompt text or visual PDF files
        elif file.startswith("Assignment - ") and (f_lower.endswith(".txt") or f_lower.endswith(".pdf")):
            if any(k in f_lower for k in ["discussion", "worksheet", "recitation"]):
                save_folder = disc_target
            elif any(k in f_lower for k in ["exam", "midterm", "quiz", "final"]):
                save_folder = cur_exam_target
            else:
                save_folder = hw_target

        # Route individual announcement text or PDF files
        elif re.match(r'^\d{4}-\d{2}-\d{2}\s*-\s*', file) and (f_lower.endswith(".txt") or f_lower.endswith(".pdf")):
            if save_folder == hw_target or any(k in f_lower for k in ["homework", "assignment", "problem set", "pset", "hw due", "hw assigned"]):
                save_folder = hw_target
            elif save_folder not in (hw_target, hw_sol_target, disc_target, lec_target):
                save_folder = f"{syl_target}/Announcements"

        # Guard: Exam tips and trial runs are admin, not actual exams
        if save_folder == cur_exam_target:
            if any(k in f_lower for k in ["tips", "trial run", "respondus"]):
                if not any(k in f_lower for k in ["solution", "key", "answers"]):
                    save_folder = syl_target
            elif any(k in f_lower for k in ["guided notes", "lesson", "lecture notes"]):
                save_folder = lec_target

        # Guard: Past-term or practice exams/solutions must not land in Current Exams
        if save_folder.startswith(cur_exam_target) or (cur_exam_target and cur_exam_target in save_folder):
            is_past_or_practice = (
                any(k in f_lower for k in ["practice", "sample", "past", "mock", "review"]) or
                bool(re.search(r'(summer|fall|winter|spring)\s*\d{2,4}|\b20[0-4]\d\b', f_lower))
            )
            if is_past_or_practice:
                if any(k in f_lower for k in ["solution", "soln", "key", "answers"]) or "solutions" in save_folder.lower():
                    save_folder = prac_sol_target
                else:
                    save_folder = prac_exam_target

        # Handle exam subfolders
        if save_folder == cur_exam_target:
            combined_str = file.lower()
            for keyword, label in exams_subfolder_map.items():
                if keyword in combined_str:
                    folder_parts = save_folder.split("/")
                    if len(folder_parts) >= 2:
                        folder_parts.insert(2, label)
                        save_folder = "/".join(folder_parts)
                    else:
                        save_folder = f"{save_folder}/{label}"
                    break

        # Handle review problem assignments
        elif save_folder == hw_target:
            combined_str = file.lower()
            if "review" in combined_str:
                for keyword, label in exams_subfolder_map.items():
                    if keyword in combined_str:
                        save_folder = f"{hw_target}/{label} Review"
                        break

        # Move file to final location:
        # Lectures & Resources gets study materials.
        # Work receives student work (or any folder marked parent: "student_work").
        is_student_submission = (
            any(w in f_lower for w in ["submission", "response submission", "alm response", "submitted work", "my submission", "student upload"])
            or "student work" in f_lower
        )
        is_work_target = (folder_parent(folders, save_folder) == "student_work") or is_student_submission
        if is_work_target:
            parent_dir = get_work_dir(config, course_name, output_dir)
        else:
            parent_dir = output_dir

        category_subpath = os.path.join(*save_folder.split("/"))
        if category_subpath.startswith(f"{course_name} "):
            prefixed_folder = category_subpath
        else:
            prefixed_folder = f"{course_name} {category_subpath}"
        target_dir = contained_path(course_root, os.path.relpath(os.path.join(parent_dir, prefixed_folder), course_root))
        os.makedirs(target_dir, exist_ok=True)

        final_path = os.path.join(target_dir, file)
        final_path = move_unique(temp_path, final_path)
        print(f"   ➡️ Moved to: '{prefixed_folder}'")

        # Map file placement relative to course root for offline Canvas recreation
        rel_placement = os.path.relpath(final_path, course_root)
        blueprint.register_file_placement(file, rel_placement)

        check_and_reset_ollama_ram(config)

    # Step 4: AI Sub-sort gigantic folders (>= 35 files) into dynamic AI-generated sub-directories
    if not config.get("_private_reclassification"):
        sort_gigantic_folders(output_dir, course_name, config, threshold=35)

    # Step 5: Cleanup
    if os.path.exists(temp_dir):
        for name in os.listdir(temp_dir):
            if name.startswith('.') and name.endswith('.json'):
                os.unlink(contained_path(temp_dir, name))
        if not os.listdir(temp_dir):
            os.rmdir(temp_dir)
            print("🧹 Removed empty temporary downloads folder.")

    # Step 6: Scan all course directories to finalize blueprint file mapping and timeline
    try:
        blueprint.scan_course_directory(course_root)
        blueprint.save(output_dir, course_root=course_root)
    except Exception as e:
        print(f"   ⚠️ Notice finalizing blueprint: {e}")

    # Unload only the explicitly selected local provider.
    try:
        if config.get("llm_provider", "gemini").lower() != "ollama":
            print("\n🎉 Organization complete!")
            return
        ollama_url = config.get("ollama_url", "http://localhost:11434/api/generate")
        from llm_client import resolve_ollama_model
        model = resolve_ollama_model(config, ollama_url)
        requests.post(ollama_url, json={"model": model, "keep_alive": 0}, timeout=3)
        print(f"🧠 Unloaded {model} from RAM.")
    except Exception:
        pass

    print("\n🎉 Organization complete!")


if __name__ == "__main__":
    out = input("Output directory: ").strip()
    name = input("Course name: ").strip()
    cfg = input("Config path: ").strip()
    organize(out, name, cfg)
