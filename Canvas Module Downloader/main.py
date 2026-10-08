#!/usr/bin/env python3
# main.py
# CLI Orchestrator for Canvas Course Module Downloader & Organizer
# Coordinates the launcher, downloader, and organizer modules.

import os
import sys
import json
import time
import argparse
import subprocess
import atexit
import shutil
from safety import (validate_component, validate_hierarchy, resolve_course_root, contained_path,
                    course_output, validate_tree, unique_destination, atomic_json, move_unique)

# Keep macOS awake while script is running
CAFFEINATE_PROC = None
if sys.platform == "darwin":
    try:
        CAFFEINATE_PROC = subprocess.Popen(["caffeinate", "-dims", "-w", str(os.getpid())])
        print("☕ Mac Anti-Sleep Mode (caffeinate) enabled.")
    except Exception:
        pass


def cleanup_caffeinate():
    global CAFFEINATE_PROC
    if CAFFEINATE_PROC:
        try:
            CAFFEINATE_PROC.terminate()
        except Exception:
            pass

atexit.register(cleanup_caffeinate)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.json")


def load_config() -> dict:
    """Loads configuration from config.json, bootstrapping from config.example.json if needed."""
    if not os.path.exists(CONFIG_PATH):
        example_path = os.path.join(SCRIPT_DIR, "config.example.json")
        if os.path.exists(example_path):
            with open(example_path, "r", encoding="utf-8") as template:
                atomic_json(CONFIG_PATH, json.load(template))
    contained_path(SCRIPT_DIR, "config.json")
    with open(CONFIG_PATH, "r") as f:
        return json.load(f)


def save_config(config: dict):
    """Saves configuration to config.json."""
    atomic_json(CONFIG_PATH, config)


def display_rules(config: dict):
    """Displays current category sorting rules."""
    print("\n" + "=" * 60)
    print("⚙️  CURRENT CATEGORY SORTING RULES & KEYWORDS")
    print("=" * 60)
    rules = config.get("category_rules", [])
    for idx, rule in enumerate(rules, start=1):
        kws = ", ".join(f"'{k}'" for k in rule["keywords"])
        print(f"  {idx}. Folder: [{rule['folder']}]")
        print(f"     Keywords: {kws}\n")


def manage_rules(config: dict) -> dict:
    """Interactive CLI menu to customize sorting rules & keywords."""
    while True:
        display_rules(config)
        print("Options:")
        print("  [1] Add keywords to an existing folder")
        print("  [2] Create a brand new folder & keywords")
        print("  [3] Remove keywords from a folder")
        print("  [4] Reset to default rules")
        print("  [0] Done - Return to main menu")

        choice = input("\n👉 Select an option (or press Enter for 0): ").strip()

        if choice == "" or choice == "0":
            break

        if choice == "1":
            try:
                rules = config.get("category_rules", [])
                folder_num = int(input("Enter folder number to modify: ")) - 1
                if 0 <= folder_num < len(rules):
                    target = rules[folder_num]
                    new_kws = input(f"Enter new keywords for '{target['folder']}' (comma-separated): ").strip()
                    added = [k.strip().lower() for k in new_kws.split(",") if k.strip()]
                    target["keywords"].extend(added)
                    save_config(config)
                    print(f"✅ Added keywords to {target['folder']}: {added}")
                else:
                    print("❌ Invalid folder number.")
            except ValueError:
                print("❌ Invalid input.")

        elif choice == "2":
            folder_name = input("Enter new folder name (e.g. Lab Reports): ").strip()
            if folder_name:
                kws_str = input(f"Enter keywords for '{folder_name}' (comma-separated): ").strip()
                kws = [k.strip().lower() for k in kws_str.split(",") if k.strip()]
                config.setdefault("category_rules", []).insert(0, {"folder": folder_name, "keywords": kws})
                save_config(config)
                print(f"✅ Created folder '{folder_name}' with keywords: {kws}")

        elif choice == "3":
            try:
                rules = config.get("category_rules", [])
                folder_num = int(input("Enter folder number to modify: ")) - 1
                if 0 <= folder_num < len(rules):
                    target = rules[folder_num]
                    print(f"   Current keywords: {target['keywords']}")
                    remove_kws = input("Enter keywords to remove (comma-separated): ").strip()
                    to_remove = [k.strip().lower() for k in remove_kws.split(",") if k.strip()]
                    target["keywords"] = [k for k in target["keywords"] if k not in to_remove]
                    save_config(config)
                    print(f"✅ Removed keywords from {target['folder']}: {to_remove}")
                else:
                    print("❌ Invalid folder number.")
            except ValueError:
                print("❌ Invalid input.")

        elif choice == "4":
            # Reload defaults from a fresh config
            print("🔄 Resetting rules to defaults requires re-downloading config.json from the repo.")
            print("   For now, you can manually edit config.json.")

    return config


from category_manager import (
    COURSE_CATEGORIES,
    ALL_CATEGORY_KEYS,
    manage_course_categories,
    parse_selection_input,
)


def run_full_scrape(course_url: str, output_dir: str, course_name: str, selected_categories: set = None, headless: bool = False):
    """Runs the full pipeline: launcher -> downloader -> organizer."""
    from scraper import launch
    from downloader import download_all
    from organizer import organize

    if selected_categories is not None:
        total = len(ALL_CATEGORY_KEYS)
        sel_count = len(selected_categories)
        if sel_count == total:
            scope_desc = "All 11 Categories (100% Exhaustive Scrape)"
        else:
            scope_desc = f"{sel_count}/{total} Categories: " + ", ".join(sorted(selected_categories))
        print(f"\n🎯 Active Download Scope: {scope_desc}")

    print("\n" + "=" * 60)
    print("🚀 PHASE 1: Browser Authentication & Dynamic Category Scanning")
    print("=" * 60)
    resolve_course_root(output_dir, course_name)
    validate_tree(output_dir)
    cookies = []
    num_items = launch(course_url, output_dir, course_name=course_name, headless=headless, selected_categories=selected_categories, cookie_sink=cookies)

    if num_items > 0:
        print("\n" + "=" * 60)
        print("📥 PHASE 2: Fast File Downloads")
        print("=" * 60)
        download_all(output_dir, cookies=cookies)

    print("\n" + "=" * 60)
    print("🤖 PHASE 3: AI Classification & Organization")
    print("=" * 60)
    organize(output_dir, course_name, CONFIG_PATH)

    # Check if Gradescope sync is enabled and course was detected
    if selected_categories is None or "gradescope" in selected_categories:
        temp_dir = os.path.join(output_dir, ".temp_downloads")
        gs_json_path = os.path.join(temp_dir, ".gradescope_info.json")
        if not os.path.exists(gs_json_path):
            gs_json_path = os.path.join(output_dir, ".gradescope_info.json")

        if os.path.exists(gs_json_path):
            try:
                with open(gs_json_path, "r", encoding="utf-8") as f:
                    gs_info = json.load(f)
                cid = gs_info.get("course_id")
                if cid:
                    print("\n" + "=" * 60)
                    print(f"🎓 PHASE 4: Gradescope Submissions Auto-Sync (Course ID: {cid})")
                    print("=" * 60)
                    from gradescope import sync_gradescope_course
                    sync_gradescope_course(cid, course_name, output_dir=output_dir)
            except Exception as e:
                print(f"   ℹ️ Gradescope auto-sync notice: {e}")


def run_local_reclassify(output_dir: str, course_name: str):
    """Runs the organizer only on existing local files."""
    import shutil
    from organizer import organize

    # [Codex] Stage copies; originals survive cancellation/provider failure.
    course_root = resolve_course_root(output_dir, course_name)
    validate_tree(course_root)
    if not any(os.path.isfile(contained_path(folder, "canvas_course.json")) for folder in (course_root, output_dir)):
        raise ValueError("Reclassification requires an existing course blueprint")
    temp_dir = contained_path(output_dir, ".temp_downloads")
    if os.path.exists(temp_dir) and os.listdir(temp_dir):
        raise ValueError("Existing staging files must be recovered before reclassification")
    os.makedirs(temp_dir, mode=0o700, exist_ok=True)
    staged = []
    for root, dirs, files in os.walk(course_root):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for name in files:
            if name.startswith('.') or name in {"canvas_course.json", "course_knowledge.md", "Assignments_and_Milestones_Timeline.md"}:
                continue
            source = contained_path(course_root, os.path.relpath(os.path.join(root, name), course_root))
            target = unique_destination(contained_path(temp_dir, name))
            shutil.copy2(source, target)
            staged.append((source, os.stat(source)))
    # Preserve source identity and privacy when filenames lack sensitive keywords.
    atomic_json(contained_path(temp_dir, ".reclassify_manifest.json"), {"sources": [p for p, _ in staged]})
    try:
        organize(output_dir, course_name, CONFIG_PATH)
    except BaseException:
        print("Reclassification interrupted; original files are preserved.")
        raise
    # Retain originals in a recovery directory, including files filtered by the organizer.
    backup = contained_path(course_root, ".reclassification-backup")
    os.makedirs(backup, mode=0o700, exist_ok=True)
    # [Codex] Each completed run retains its own immutable recovery namespace.
    import tempfile
    backup = tempfile.mkdtemp(prefix="run-", dir=backup)
    recovery = {}
    atomic_json(contained_path(backup, "recovery-manifest.json"), recovery)
    for source, signature in staged:
        if os.path.exists(source) and os.stat(source) == signature:
            relative = os.path.relpath(source, course_root)
            destination = contained_path(backup, relative)
            os.makedirs(os.path.dirname(destination), mode=0o700, exist_ok=True)
            saved = move_unique(source, destination)
            recovery[relative] = os.path.relpath(saved, backup)
            atomic_json(contained_path(backup, "recovery-manifest.json"), recovery)
    # Publish the final inventory after original paths have moved to recovery storage.
    from canvas_blueprint import CourseBlueprint
    blueprint_path = contained_path(output_dir, "canvas_course.json")
    if not os.path.isfile(blueprint_path):
        blueprint_path = contained_path(course_root, "canvas_course.json")
    blueprint = CourseBlueprint.load(blueprint_path)
    blueprint.file_path_map.clear()
    blueprint.scan_course_directory(course_root)
    blueprint.save(output_dir, course_root=course_root)


def run_course_pipeline(
    course_url: str = "",
    course_name: str = "Canvas Course",
    subfolder: str = None,
    action: str = "1",
    provider: str = None,
    model: str = None,
    headless: bool = False,
    selected_categories: set = None,
    gradescope_target: str = None,
    output_root: str = None,
) -> dict:
    """Programmatic entrypoint for running course scraping, classification, or sync tasks.
    Designed for zero-hang backend automation, background worker threads, or CLI runners."""
    if action not in {"1", "3", "4"}:
        return {"status": "error", "course_name": course_name, "error": f"Unsupported action '{action}'"}
    validate_component(course_name)
    config = load_config()
    validate_hierarchy(config)
    updated_config = False

    if provider:
        p = provider.lower()
        if p == "rules":
            config["use_rule_engine"] = True
            config["llm_provider"] = "rules"
        else:
            config["llm_provider"] = p
            config["use_rule_engine"] = False
        updated_config = True

    if model:
        curr_p = config.get("llm_provider", "gemini").lower()
        if curr_p == "ollama":
            config["ollama_model"] = model
        elif curr_p == "gemini":
            config["gemini_model"] = model
        updated_config = True

    if updated_config:
        save_config(config)

    resolved_categories = selected_categories if selected_categories is not None else set(ALL_CATEGORY_KEYS)
    hier_template = config.get("disk_hierarchy", {}).get("lectures_folder") if isinstance(config.get("disk_hierarchy"), dict) else None
    default_sub = hier_template.replace("{course}", course_name).strip() if hier_template else f"{course_name} Lectures & Resources"
    subfolder_name = subfolder or default_sub
    base_root = output_root or config.get("default_course_dir") or "~/Desktop"
    output_dir = course_output(base_root, course_name, subfolder_name)

    print(f"\n🚀 Pipeline Invoked | Action: {action} | Course: {course_name} | Output: {output_dir}")
    sys.stdout.flush()

    try:
        if action == "1":
            run_full_scrape(course_url, output_dir, course_name, selected_categories=resolved_categories, headless=headless)
        elif action == "3":
            run_local_reclassify(output_dir, course_name)
        elif action == "4":
            from gradescope import sync_gradescope_course
            gs_url = gradescope_target or course_url or "https://www.gradescope.com"
            sync_gradescope_course(gs_url, course_name, output_dir=output_dir)
        else:
            raise ValueError(f"Unsupported action '{action}' for programmatic pipeline execution.")
        return {"status": "success", "course_name": course_name, "output_dir": output_dir, "action": action}
    except Exception as e:
        print(f"\n❌ Pipeline Execution Error: {e}", file=sys.stderr)
        sys.stderr.flush()
        return {"status": "error", "course_name": course_name, "error": str(e), "action": action}


def prompt_offline_organization(config: dict) -> dict:
    """Prompts the user whether they want offline organization using local Ollama & Qwen 2.5,
    or cloud / rule-based organization. Dynamically tailors recommendations to computer specs.
    Never downloads models automatically."""
    print("\n" + "=" * 60)
    print("🤖 AI DOCUMENT ORGANIZATION SETUP")
    print("=" * 60)

    from llm_client import (
        is_ollama_online,
        get_available_ollama_models,
        get_system_hardware_profile,
        get_hardware_recommendations,
    )

    gemini_key = config.get("gemini_api_key", "").strip()
    profile = get_system_hardware_profile()
    recs = get_hardware_recommendations(profile, has_gemini_key=bool(gemini_key))
    tier = profile.get("tier", "mid")
    ram_gb = profile.get("ram_gb", 16.0)
    chip = profile.get("chip", "Unknown")

    device_model = profile.get("device_model", "Computer")
    is_fanless = profile.get("is_fanless", False)

    tier_labels = {
        "low": "Budget / Constrained Spec",
        "mid": "Standard Spec (12-16 GB)",
        "high": "High-Performance Workstation (16GB+ RAM)"
    }
    tier_label = tier_labels.get(tier, "Detected Spec")
    cooling_label = "Fanless Passive Cooling" if is_fanless else "Active Fan Cooling"

    print(f"💻 Hardware Profile Detected:")
    print(f"   • Device:    {device_model} ({cooling_label})")
    print(f"   • Processor: {chip}")
    print(f"   • Memory:    {ram_gb} GB RAM ({tier_label})")

    print(f"\n💡 Tailored Recommendations for Your Machine:")
    if is_fanless:
        print("   🥇 Google Gemini Flash Lite (Cloud) — Best for Fanless: 0% heat, zero thermal throttling, preserves battery.")
        print("   🥈 qwen2.5:3b (Offline - Fanless Safe) — Lightweight (~2GB RAM), stays cool without cooking the chassis.")
        print("   🥉 qwen2.5:7b (Offline - Thermal Warning) — Causes significant chassis heat & thermal throttling on fanless Air.")
    elif tier == "low":
        print("   🥇 Google Gemini Flash Lite (Cloud) — Strongly recommended: 0 MB Mac RAM, 0% CPU heat, instant.")
        print(f"   🥈 {recs['recommended_local_model']} (Offline) — Lightweight (~2GB RAM), runs cool.")
        print("   ⚠️  Notice: 7B/8B local models require >=16GB RAM and cause heavy swapping, high fan noise, and thermal throttling.")
    elif tier == "mid":
        print("   🥇 qwen2.5:7b (Offline - Recommended) — Near-Gemini classification accuracy (~4.8GB RAM).")
        print("   🥈 Google Gemini Flash Lite (Cloud) — Zero Mac RAM, instant cloud alternative.")
        print("   🥉 qwen2.5:3b (Offline - Low-Power) — Lightweight (~2GB RAM, whisper quiet).")
    else:
        print("   🥇 qwen2.5:7b (Offline - Recommended) — Maximum accuracy & reasoning (~4.8GB RAM, ideal for 16GB+ RAM).")
        print("   🥈 Google Gemini Flash Lite (Cloud) — Zero Mac RAM, instant cloud alternative.")
        print("   🥉 qwen2.5:3b (Offline - Low-Power) — Battery-saving alternative (~2GB RAM, whisper quiet).")

    current_provider = config.get("llm_provider", "gemini").lower()
    default_prompt = "y/N" if current_provider != "ollama" else "Y/n"

    ans = input(f"\n👉 Would you like to use 100% offline organization (local Ollama)? [{default_prompt}]: ").strip().lower()

    use_offline = False
    if current_provider == "ollama" and ans in ["", "y", "yes"]:
        use_offline = True
    elif ans in ["y", "yes"]:
        use_offline = True

    if use_offline:
        config["llm_provider"] = "ollama"
        ollama_url = config.get("ollama_url", "http://localhost:11434/api/generate")

        if not is_ollama_online(ollama_url):
            print(f"\n⚠️  Ollama does not appear to be running at {ollama_url.rsplit('/api/', 1)[0]}.")
            print("   Please start Ollama in another terminal ('ollama serve') to use offline organization.")
            raise RuntimeError('Selected Ollama is unavailable. Start Ollama and retry; provider will not be changed.')

        installed = get_available_ollama_models(ollama_url)
        rec_model = recs["recommended_local_model"]
        configured_model = config.get("ollama_model", "").strip()
        target_model = configured_model if (configured_model and configured_model != "auto") else rec_model

        has_target = any(target_model.lower() in m.lower() for m in installed)
        has_any_qwen = any("qwen" in m.lower() for m in installed)

        if not has_target and not has_any_qwen:
            print(f"\n📦 Recommended local model '{target_model}' is not currently installed in Ollama.")
            if installed:
                print(f"   Installed local models detected: {', '.join(installed)}")
            print("   ⚠️  We will NOT download models automatically.")
            pull_choice = input(f"👉 Would you like to download '{target_model}' now via 'ollama pull {target_model}'? [y/N]: ").strip().lower()
            if pull_choice in ["y", "yes"]:
                print(f"\n🚀 Downloading '{target_model}' via Ollama... (this may take a few minutes)")
                try:
                    import subprocess
                    ret = subprocess.run(["ollama", "pull", target_model])
                    if ret.returncode == 0:
                        print(f"✅ Successfully downloaded '{target_model}'!")
                        config["ollama_model"] = target_model
                    else:
                        print(f"⚠️ 'ollama pull {target_model}' exited with code {ret.returncode}.")
                except Exception as e:
                    print(f"⚠️ Could not invoke 'ollama pull': {e}")
            else:
                if installed:
                    fallback_model = installed[0]
                    print(f"ℹ️ Skipping download. Will use installed local model '{fallback_model}'.")
                    config["ollama_model"] = fallback_model
                elif gemini_key:
                    print("Ollama model download declined; stopping.")
                    raise RuntimeError('Selected Ollama model is unavailable. No provider fallback was attempted.')
                else:
                    print("Ollama model download declined; stopping.")
                    raise RuntimeError('Selected Ollama model is unavailable. No provider fallback was attempted.')
        else:
            active = target_model if has_target else [m for m in installed if "qwen" in m.lower()][0]
            config["ollama_model"] = active
            print(f"✅ Offline organization enabled with '{active}'.")
            if is_fanless and "7b" in active.lower():
                print("   ⚠️  Fanless Device Notice: You are using '7b' on a fanless MacBook Air.")
                print("      Place on a hard, flat surface to aid cooling, or switch to 'qwen2.5:3b' / Gemini for cool operation.")
            elif "7b" in active.lower():
                print("   💡 Tip: 'qwen2.5:3b' is also supported if you prefer whisper-quiet fans or battery-saver mode.")
    else:
        # User chose cloud or rules
        if gemini_key:
            config["llm_provider"] = "gemini"
            print(f"✅ Using Google Gemini Cloud AI ({config.get('gemini_model', 'gemini-flash-lite-latest')}) — 0 MB Mac RAM, 0% CPU heat.")
        else:
            config["use_rule_engine"] = True
            print("✅ Using fast Keyword Rule Engine (zero RAM, zero downloads).")

    save_config(config)
    return config


def main():
    """Main CLI entrypoint."""
    parser = argparse.ArgumentParser(description="Canvas Module File Downloader & Organizer")
    parser.add_argument("--url", help="Canvas Course URL")
    parser.add_argument("--course", help="Course Folder Name (e.g. 'PHYSICS 5C')")
    parser.add_argument("--subfolder", help="Subfolder label")
    parser.add_argument("--action", choices=["1", "2", "3", "4", "5", "6"], help="1=Full Scrape, 2=Rules, 3=Re-classify, 4=Gradescope Sync, 5=Select Categories, 6=Configure AI Mode")
    parser.add_argument("--gradescope", help="Gradescope Course URL or ID (for action 4 or direct sync)")
    parser.add_argument("--include", "--categories", dest="include", help="Comma-separated categories to include (e.g. 'modules,grades' or '1,2,7')")
    parser.add_argument("--exclude", "--skip", dest="exclude", help="Comma-separated categories to exclude (e.g. 'discussions,media' or '5,10')")
    parser.add_argument("--provider", choices=["gemini", "ollama", "rules"], help="LLM provider for organization (gemini, ollama, or rules)")
    parser.add_argument("--model", help="Specific model name (e.g. 'qwen2.5:7b', 'qwen2.5:3b', or 'gemini-flash-lite-latest')")
    parser.add_argument("--tier", choices=["free", "paid"], help="Gemini tier ('free' or 'paid')")
    parser.add_argument("--output-dir", "--dir", dest="output_dir", help="Base output directory for course downloads (defaults to configured default_course_dir or ~/Desktop)")
    parser.add_argument("--headless", action="store_true", help="Run browser automation in headless mode")
    parser.add_argument("--offline", action="store_true", help="Enable offline organization via local Ollama (never pulls models automatically)")
    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("📚 CANVAS MODULE FILE DOWNLOADER & ORGANIZER (v11.1.0 - Selective Course Archiver)")
    print("=" * 60)

    # Load config
    config = load_config()
    validate_hierarchy(config)

    # Apply CLI provider/model overrides if provided
    config_changed = False
    if args.provider:
        if args.provider == "rules":
            config["use_rule_engine"] = True
            config["llm_provider"] = "rules"
        else:
            config["llm_provider"] = args.provider
            config["use_rule_engine"] = False
        config_changed = True
    elif args.offline:
        config["llm_provider"] = "ollama"
        config["use_rule_engine"] = False
        config_changed = True

    if getattr(args, 'tier', None):
        config["gemini_tier"] = args.tier
        config_changed = True

    if args.model:
        curr_p = config.get("llm_provider", "gemini").lower()
        if curr_p == "ollama":
            config["ollama_model"] = args.model
        elif curr_p == "gemini":
            config["gemini_model"] = args.model
        config_changed = True

    if config_changed:
        save_config(config)

    provider = config.get("llm_provider", "gemini").lower()
    gemini_key = config.get("gemini_api_key", "").strip()

    if provider == "gemini" and gemini_key:
        print(f"\n✨ Google Gemini AI detected ({config.get('gemini_model', 'gemini-3.6-flash')})!")
        print("   Super-fast cloud inference enabled with 0 MB Mac RAM usage.")
    elif provider == "ollama":
        # Check Ollama
        try:
            import requests
            res = requests.get("http://localhost:11434/", timeout=2)
            if res.status_code == 200:
                ollama_model = config.get("ollama_model", "qwen2.5:7b")
                model_label = "Qwen 2.5" if "qwen" in ollama_model.lower() else ollama_model
                print(f"\n🤖 Local Ollama AI detected ({model_label})! Documents will be categorized 100% privately on your Mac.")
        except Exception:
            print("\nℹ️ Ollama not running. Script will use keyword rules only.")
    else:
        print("\n⚙️ Keyword Rule Engine active for document sorting.")

    # Initialize categories selection (defaults to all categories)
    selected_categories = set(ALL_CATEGORY_KEYS)
    if args.include:
        selected_categories = parse_selection_input(f"set {args.include}", selected_categories)
    if args.exclude:
        exclude_tokens = [f"-{t.strip().lstrip('-')}" for t in args.exclude.split(",") if t.strip()]
        selected_categories = parse_selection_input(" ".join(exclude_tokens), selected_categories)

    # If flags are provided, run non-interactively
    if ((args.url and (args.action in ["1", "2"] or not args.action)) or (args.action in ["3", "4", "5", "6"]) or args.gradescope) and args.course:
        action = args.action or "1"
        course_url = args.url or ""
        course_name = args.course
        hier_template = config.get("disk_hierarchy", {}).get("lectures_folder") if isinstance(config.get("disk_hierarchy"), dict) else None
        default_sub = hier_template.replace("{course}", course_name).strip() if hier_template else f"{course_name} Lectures & Resources"
        subfolder = args.subfolder or default_sub
        base_root = args.output_dir or config.get("default_course_dir") or "~/Desktop"
        output_dir = course_output(base_root, course_name, subfolder)
        print(f"\n📂 Non-Interactive Mode | Target: {output_dir}")
        if action == "1":
            run_full_scrape(course_url, output_dir, course_name, selected_categories=selected_categories, headless=args.headless)
        elif action == "2":
            manage_rules(config)
        elif action == "3":
            run_local_reclassify(output_dir, course_name)
        elif action == "4" or args.gradescope:
            from gradescope import sync_gradescope_course
            gs_target = args.gradescope or course_url
            sync_gradescope_course(gs_target, course_name, output_dir=output_dir)
        elif action == "5":
            selected_categories = manage_course_categories(selected_categories)
        elif action == "6":
            config = prompt_offline_organization(config)
        return

    # User setup (Interactive Mode)
    course_url = input("\n👉 Paste your Canvas Course URL (landing page or modules URL, or press Enter to skip to Gradescope):\n> ").strip()
    course_name = input("\n👉 Enter Course Folder Name (e.g., 'CHEM 14D' or press Enter for 'Canvas Course'): ").strip()
    if not course_name:
        course_name = "Canvas Course"

    hier_template = config.get("disk_hierarchy", {}).get("lectures_folder") if isinstance(config.get("disk_hierarchy"), dict) else None
    default_sub = hier_template.replace("{course}", course_name).strip() if hier_template else f"{course_name} Lectures & Resources"
    subfolder = input(f"👉 Enter subfolder label (press Enter for '{default_sub}'): ").strip()
    if not subfolder:
        subfolder = default_sub

    base_root = config.get("default_course_dir") or "~/Desktop"
    output_dir = course_output(base_root, course_name, subfolder)

    # Prompt user for offline organization preference
    config = prompt_offline_organization(config)

    # Main menu loop
    while True:
        total_cats = len(ALL_CATEGORY_KEYS)
        sel_count = len(selected_categories)
        if sel_count == total_cats:
            scope_label = "All 11 Categories"
        elif sel_count == 0:
            scope_label = "None Selected ⚠️"
        else:
            scope_label = f"{sel_count}/{total_cats} Categories Selected"

        provider_mode = config.get("llm_provider", "gemini").title()
        if provider_mode.lower() == "ollama":
            provider_mode = f"Offline ({config.get('ollama_model', 'qwen2.5:7b')})"
        elif config.get("use_rule_engine"):
            provider_mode = "Keyword Rules"
        else:
            provider_mode = f"Cloud Gemini ({config.get('gemini_model', 'gemini-flash-lite-latest')})"

        print(f"\n📂 Target: {output_dir}")
        print("\nOptions:")
        print("  [1] Full Scrape & Sort (Launcher -> Downloader -> Organizer)")
        print("  [2] Customize Category Rules & Keywords")
        print("  [3] Local Re-classify & Clean Existing Downloads")
        print("  [4] Sync Gradescope Submissions (Originals & Graded Copies -> Work/)")
        print(f"  [5] Select Course Categories to Download (Current: {scope_label})")
        print(f"  [6] Configure AI Organization Mode (Current: {provider_mode})")
        print("  [0] Exit")

        choice = input("\n👉 Select an option: ").strip()

        if choice == "0":
            break
        elif choice == "1":
            if not course_url.startswith("http"):
                course_url = input("👉 Enter Canvas Course URL: ").strip()
            run_full_scrape(course_url, output_dir, course_name, selected_categories=selected_categories)
        elif choice == "2":
            config = manage_rules(config)
        elif choice == "3":
            if os.path.exists(output_dir):
                run_local_reclassify(output_dir, course_name)
            else:
                print("❌ Output directory does not exist. Run a full scrape first.")
        elif choice == "4":
            gs_url = input("👉 Enter Gradescope Course URL or ID (press Enter to auto-detect from dashboard):\n> ").strip()
            from gradescope import sync_gradescope_course
            sync_gradescope_course(gs_url or "https://www.gradescope.com", course_name, output_dir=output_dir)
        elif choice == "5":
            selected_categories = manage_course_categories(selected_categories)
        elif choice == "6":
            config = prompt_offline_organization(config)
        else:
            print("❌ Invalid option.")

    # Cleanup
    if CAFFEINATE_PROC:
        try:
            CAFFEINATE_PROC.terminate()
        except Exception:
            pass

    print("\n👋 Goodbye!")


if __name__ == "__main__":
    main()
