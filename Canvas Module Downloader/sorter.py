# sorter.py
# Dedicated Subfolder Sorter: uses AI to dynamically cluster
# gigantic category folders (>= 35 files) into course-specific sub-directories.

import os
import json
import shutil
from collections import Counter
from llm_client import query_llm, ProviderError
from safety import validate_component, validate_hierarchy, validate_tree, contained_path, move_unique, resolve_course_root


def generate_ai_subfolders_for_dir(files: list, config: dict) -> dict:
    """Asks AI to inspect filenames in a gigantic folder and generate clean subfolder clusters."""
    files = [f for f in files if not any(w in f.lower() for w in ('submission', 'grades', 'feedback', 'graded', 'student'))] if config.get('llm_provider', 'gemini') == 'gemini' else files
    file_list_str = "\n".join(f"- {f}" for f in files[:100])

    prompt = f"""You are an academic document organizer.
We have a large folder containing the following course files:

FILES LIST:
---
{file_list_str}
---

INSTRUCTIONS:
Analyze these filenames and cluster them into 3 to 5 logical subfolders based on document type and content (e.g., "Lecture Decks & Slides", "InQuizitive Textbook Activities", "Guided Notes & Readings", "Practice & Scenarios").

Output ONLY a JSON object mapping each exact filename to its assigned subfolder name.

EXAMPLE OUTPUT FORMAT:
{{
  "assignments": {{
    "100B Lecture 1.pdf": "Lecture Decks & Slides",
    "InQuizitive Chapter 1.pdf": "InQuizitive Textbook Activities"
  }}
}}

Return ONLY valid JSON. No conversational text."""

    try:
        resp_text = query_llm(prompt, config, timeout=25, as_json=True)
        if resp_text:
            data = json.loads(resp_text)
            if "assignments" in data and isinstance(data["assignments"], dict):
                return data["assignments"]
            elif isinstance(data, dict):
                return data
    except ProviderError:
        raise
    except Exception as e:
        print(f"   ⚠️ AI subfolder clustering notice: {e}")

    return {}


def _get_work_dir(config: dict, course_name: str, output_dir: str = "") -> str:
    """Returns the absolute path to the student work directory,
    respecting the disk_hierarchy work_folder template if configured."""
    hier = config.get("disk_hierarchy") if isinstance(config, dict) else None
    template = hier.get("work_folder", "{course} Work") if isinstance(hier, dict) else "{course} Work"
    folder_name = template.replace("{course}", course_name) if template else f"{course_name} Work"
    if output_dir:
        # [Codex] Compact layouts use the course itself as output, not its parent.
        course_root = resolve_course_root(output_dir, course_name)
        return contained_path(course_root, folder_name)
    return os.path.expanduser(os.path.join("~/Desktop", course_name, folder_name))


def sort_gigantic_folders(output_dir: str, course_name: str, config: dict, threshold: int = 35):
    """Inspects all category directories for a course. If any folder has >= threshold files,
    it asks Qwen 2.5 / local Ollama LLM to dynamically generate clean subfolder clusters based on filenames."""

    validate_component(course_name)
    validate_hierarchy(config)
    validate_tree(output_dir)
    print(f"\n📁 Checking for gigantic folders (>= {threshold} files) for AI sub-clustering...")

    custom_folders = config.get("disk_hierarchy", {}).get("custom_folders", []) if isinstance(config.get("disk_hierarchy"), dict) else []
    hw_folder = "Homework Assignments"
    sol_folder = "Homework Solutions"
    if custom_folders:
        for f in custom_folders:
            f_types = [t.lower() for t in f.get("types", [])]
            if "assignments" in f_types or "homework" in f_types:
                hw_folder = f["name"]
            elif "solutions" in f_types or "keys" in f_types:
                sol_folder = f["name"]

    course_root = resolve_course_root(output_dir, course_name)
    work_base = _get_work_dir(config, course_name, output_dir)
    contained_path(course_root, os.path.relpath(work_base, course_root))

    # Pre-collect candidate directories to avoid modifying directory structure during os.walk
    gigantic_dirs = []
    for root, dirs, files in os.walk(output_dir):
        # [Codex] Recovery originals and internal metadata are never classification inputs.
        dirs[:] = [name for name in dirs if not name.startswith('.')]
        if ".temp_downloads" in root:
            dirs[:] = []
            continue
        valid_files = [f for f in files if not f.startswith(".") and f not in {"course_knowledge.md", "canvas_course.json"}]
        if len(valid_files) >= threshold:
            gigantic_dirs.append((root, valid_files))

    for root, valid_files in gigantic_dirs:
        folder_name = os.path.basename(root)
        print(f"   📦 Gigantic folder detected: '{folder_name}' ({len(valid_files)} files). Generating AI subfolders...")

        ai_mapping = generate_ai_subfolders_for_dir(valid_files, config)

        # Step 1: Normalize subfolder names (e.g. merge 'Lecture Decks & Slides' into 'Lecture Decks & Presentations')
        normalized_mapping = {}
        for file, sub in ai_mapping.items():
            try:
                validate_component(sub)
            except ValueError:
                continue
            sub_lower = sub.lower()
            if any(k in sub_lower for k in ["lecture deck", "lecture slide", "presentation deck", "lecture presentation"]):
                sub = "Lecture Decks & Presentations"
            elif any(k in sub_lower for k in ["reading", "guided note", "handout"]):
                sub = "Readings & Guided Notes"
            elif any(k in sub_lower for k in ["practice", "scenario", "review"]):
                sub = "Practice & Review Scenarios"
            normalized_mapping[file] = sub

        # Step 2: Filter out subfolders with < 4 files to prevent 1-file subfolder clutter
        counts = Counter(normalized_mapping.values())
        active_mapping = {
            file: sub for file, sub in normalized_mapping.items()
            if counts[sub] >= 4
        }

        for file in valid_files:
            f_lower = file.lower()

            # Re-route InQuizitive files directly to Work
            if "inquizitive" in f_lower:
                student_work_dir = contained_path(
                    course_root, os.path.relpath(
                        os.path.join(work_base, f"{course_name} {hw_folder}", "InQuizitive Online Homework"),
                        course_root,
                    ),
                )
                os.makedirs(student_work_dir, exist_ok=True)
                old_path = os.path.join(root, file)
                new_path = os.path.join(student_work_dir, file)
                move_unique(old_path, new_path)
                print(f"      ➡️ Moved '{file}' -> '{os.path.basename(work_base)}/{hw_folder}/InQuizitive Online Homework'")
                continue

            # Re-route all student submissions and action items directly to Work
            if any(w in f_lower for w in ["submission", "response submission", "alm response", "submitted", "action item"]):
                sub_path = sol_folder if any(k in f_lower for k in ["rubric", "key", "solution", "answers"]) else hw_folder
                student_work_dir = contained_path(
                    course_root, os.path.relpath(
                        os.path.join(work_base, f"{course_name} {sub_path}"), course_root,
                    ),
                )
                os.makedirs(student_work_dir, exist_ok=True)
                old_path = os.path.join(root, file)
                new_path = os.path.join(student_work_dir, file)
                move_unique(old_path, new_path)
                print(f"      ➡️ Moved '{file}' -> '{os.path.basename(work_base)}/{sub_path}'")
                continue

            subfolder = active_mapping.get(file, "")

            # Fallback rule if AI omitted a filename or subfolder had < 4 files
            if not subfolder:
                if any(k in f_lower for k in ["lecture", "lec", ".pptx", ".ppt"]):
                    subfolder = "Lecture Decks & Presentations"
                elif any(k in f_lower for k in ["guided note", "reading", "article"]):
                    subfolder = "Readings & Guided Notes"
                elif any(k in f_lower for k in ["practice", "scenario", "review"]):
                    subfolder = "Practice & Review Scenarios"

            if subfolder:
                target_dir = contained_path(root, subfolder)
                os.makedirs(target_dir, exist_ok=True)
                old_path = os.path.join(root, file)
                new_path = os.path.join(target_dir, file)
                move_unique(old_path, new_path)
                print(f"      ➡️ Moved '{file}' -> '{subfolder}'")


if __name__ == "__main__":
    out = input("Output directory: ").strip()
    name = input("Course name: ").strip()
    sort_gigantic_folders(out, name, {})
