# category_manager.py
# Course category management and selection for selective downloads.

import re
from typing import Set, Tuple, List, Dict

# Ordered list of all 11 course categories: (key, title, description)
COURSE_CATEGORIES: List[Tuple[str, str, str]] = [
    ("modules", "Modules", "Lecture slides, discussion files, handouts, worksheets"),
    ("syllabus", "Course Syllabus", "Text, PDF attachment, visual snapshot"),
    ("announcements", "Announcements", "Chronological posts, homework report, attachments"),
    ("assignments", "Assignments", "Prompts, rubrics, native student submissions"),
    ("discussions", "Discussions", "Full threads, TA replies, attached worksheets"),
    ("quizzes", "Quizzes", "Prompts, graded submission reviews with answers"),
    ("grades", "Grades & Feedback", "Official gradebook snapshot & comments PDF"),
    ("files", "Files Repository", "Unlinked instructor files & nested subfolders"),
    ("pages", "Standalone Pages", "Unlinked wiki pages outside of modules"),
    ("media", "Media & Zoom", "Lecture video recordings catalog"),
    ("gradescope", "Gradescope Submissions", "Originals & graded copies -> Work/"),
]

ALL_CATEGORY_KEYS: Set[str] = {cat[0] for cat in COURSE_CATEGORIES}

NUM_TO_KEY: Dict[int, str] = {idx: cat[0] for idx, cat in enumerate(COURSE_CATEGORIES, 1)}
KEY_TO_NUM: Dict[str, int] = {cat[0]: idx for idx, cat in enumerate(COURSE_CATEGORIES, 1)}

# Common alias mapping
CATEGORY_ALIASES: Dict[str, str] = {
    "module": "modules",
    "modules": "modules",
    "slides": "modules",
    "syllabus": "syllabus",
    "syl": "syllabus",
    "announcement": "announcements",
    "announcements": "announcements",
    "notices": "announcements",
    "assignment": "assignments",
    "assignments": "assignments",
    "hw": "assignments",
    "homework": "assignments",
    "discussion": "discussions",
    "discussions": "discussions",
    "forum": "discussions",
    "quiz": "quizzes",
    "quizzes": "quizzes",
    "exams": "quizzes",
    "grade": "grades",
    "grades": "grades",
    "feedback": "grades",
    "gradebook": "grades",
    "file": "files",
    "files": "files",
    "page": "pages",
    "pages": "pages",
    "wiki": "pages",
    "media": "media",
    "zoom": "media",
    "video": "media",
    "videos": "media",
    "kaltura": "media",
    "panopto": "media",
    "recordings": "media",
    "gradescope": "gradescope",
    "gs": "gradescope",
}


def resolve_category_token(token: str) -> str:
    """Resolves a number string or name alias to a canonical category key."""
    token = token.strip().lower()
    if token.isdigit():
        num = int(token)
        return NUM_TO_KEY.get(num, "")
    return CATEGORY_ALIASES.get(token, "")


def parse_selection_input(user_input: str, current_selection: Set[str]) -> Set[str]:
    """
    Parses user input to update the selected categories.
    Supports:
      - 'all' / 'a' / '*' -> select all categories
      - 'none' / 'clear' -> deselect all
      - Single number '5' -> toggle category 5
      - Exclusions: '-5, -10' or '-discussions, -media' -> remove from current
      - Inclusions with '+': '+5, +10' -> add to current
      - 'only 1, 2, 7' or 'set 1, 2, 7' -> replace selection with given items
      - Positive list '1, 2, 7, 11' -> replace selection with given items
    """
    cleaned = user_input.strip()
    if not cleaned:
        return current_selection

    lowered = cleaned.lower()

    if lowered in ("all", "a", "*"):
        return set(ALL_CATEGORY_KEYS)

    if lowered in ("none", "clear"):
        return set()

    # Check for 'only' or 'set' prefix
    if lowered.startswith("only ") or lowered.startswith("set "):
        cleaned = re.sub(r'^(only|set)\s+', '', cleaned, flags=re.IGNORECASE).strip()
        tokens = [t.strip() for t in re.split(r'[, ]+', cleaned) if t.strip()]
        new_sel = set()
        for t in tokens:
            key = resolve_category_token(t)
            if key in ALL_CATEGORY_KEYS:
                new_sel.add(key)
        return new_sel

    # Split by comma or whitespace
    tokens = [t.strip() for t in re.split(r'[, ]+', cleaned) if t.strip()]
    if not tokens:
        return current_selection

    # Check if this is an exclusion list (e.g. -5, -10 or -discussions)
    if all(t.startswith("-") for t in tokens):
        new_sel = set(current_selection)
        for t in tokens:
            key = resolve_category_token(t[1:])
            if key in new_sel:
                new_sel.remove(key)
        return new_sel

    # Check if this is an explicit inclusion list (e.g. +5, +10)
    if all(t.startswith("+") for t in tokens):
        new_sel = set(current_selection)
        for t in tokens:
            key = resolve_category_token(t[1:])
            if key in ALL_CATEGORY_KEYS:
                new_sel.add(key)
        return new_sel

    # If a single number or name without prefix: TOGGLE it
    if len(tokens) == 1 and not tokens[0].startswith(("-", "+")):
        key = resolve_category_token(tokens[0])
        if key in ALL_CATEGORY_KEYS:
            new_sel = set(current_selection)
            if key in new_sel:
                new_sel.remove(key)
            else:
                new_sel.add(key)
            return new_sel

    # Multiple items without prefix (e.g. '1, 2, 7, 11' or 'modules, grades'):
    # Treat as setting the selection exclusively to those items
    new_sel = set()
    for t in tokens:
        key = resolve_category_token(t)
        if key in ALL_CATEGORY_KEYS:
            new_sel.add(key)
    return new_sel if new_sel else current_selection


def display_category_menu(current_selection: Set[str]):
    """Displays the category selection list with active checkmarks."""
    print("\n" + "=" * 65)
    print("📋 COURSE CATEGORY DOWNLOAD SCOPE")
    print("=" * 65)
    for idx, (key, title, desc) in enumerate(COURSE_CATEGORIES, 1):
        check = "[x]" if key in current_selection else "[ ]"
        print(f"  {idx:2d}. {check} {title:<22} - {desc}")
    print("=" * 65)
    total = len(COURSE_CATEGORIES)
    selected_count = len(current_selection)
    if selected_count == total:
        status = "ALL 11 Categories Enabled (100% Exhaustive Scrape)"
    elif selected_count == 0:
        status = "None Selected (All Categories Disabled)"
    else:
        status = f"{selected_count}/{total} Categories Enabled"
    print(f"Active Scope: {status}\n")


def manage_course_categories(current_selection: Set[str]) -> Set[str]:
    """Interactive loop for the user to customize which categories to scrape."""
    selection = set(current_selection) if current_selection else set(ALL_CATEGORY_KEYS)

    while True:
        display_category_menu(selection)
        print("Options:")
        print("  • Enter a single number to TOGGLE (e.g., '5' to toggle Discussions)")
        print("  • Enter numbers to set scope (e.g., '1, 2, 7, 11')")
        print("  • Enter negative numbers to EXCLUDE (e.g., '-5, -10')")
        print("  • Enter '+<num>' to INCLUDE (e.g., '+5, +10')")
        print("  • Type 'all' or 'a' to select ALL categories")
        print("  • Type 'clear' to deselect all")
        print("  • Press Enter or '0' when done (Return to Main Menu)")

        choice = input("\n👉 Enter selection or toggle (or press Enter for 0): ").strip()
        if choice in ("", "0", "done", "q", "exit"):
            break

        new_selection = parse_selection_input(choice, selection)
        if new_selection != selection:
            selection = new_selection
            print("✅ Selection updated!")
        else:
            print("ℹ️ No changes made.")

    return selection
