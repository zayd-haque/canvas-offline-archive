import tests  # Required test randomizer hook
import unittest
import os
import sys
import json
import tempfile
import shutil
from unittest.mock import patch, MagicMock

# Add Canvas Module Downloader to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Canvas Module Downloader")))

import organizer
import sorter


class TestCustomFoldersOrganizer(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.course_name = "TEST 101"
        # [Codex] Match the supported named course root containment contract.
        self.course_root = os.path.join(self.temp_dir, self.course_name)
        self.output_dir = os.path.join(self.course_root, f"{self.course_name} Lectures & Resources")
        os.makedirs(self.output_dir, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_get_folder_config_default_fallback(self):
        config_empty = {}
        folders = organizer.get_folder_config(config_empty)
        self.assertEqual(folders, organizer.DEFAULT_FOLDERS)

        config_no_custom = {"disk_hierarchy": {"preset": "standard"}}
        folders2 = organizer.get_folder_config(config_no_custom)
        self.assertEqual(folders2, organizer.DEFAULT_FOLDERS)

    def test_get_folder_config_custom(self):
        custom = [
            {"id": "c1", "name": "Professor Slides", "parent": "study_materials", "types": ["slides"]},
            {"id": "c2", "name": "Homework Submissions", "parent": "student_work", "types": ["assignments"]}
        ]
        config = {"disk_hierarchy": {"custom_folders": custom}}
        folders = organizer.get_folder_config(config)
        self.assertEqual(folders, custom)

    def test_build_category_map(self):
        custom = [
            {"id": "c1", "name": "Slides", "parent": "study_materials"},
            {"id": "c2", "name": "Projects", "parent": "student_work"}
        ]
        cat_map = organizer.build_category_map(custom)
        self.assertEqual(cat_map, {1: "Slides", 2: "Projects"})

    def test_build_categories_prompt(self):
        custom = [
            {"id": "c1", "name": "Slides", "types": ["slides"], "description": "Lecture slides and decks."},
            {"id": "c2", "name": "Worksheets", "types": ["discussions"]}
        ]
        prompt = organizer.build_categories_prompt(custom)
        # [Codex] Every category exposes both configured purpose tags and
        # descriptive guidance, including categories without a description.
        lines = prompt.splitlines()
        self.assertTrue(lines[0].startswith("1. Slides:"))
        self.assertIn("slides", lines[0].lower())
        self.assertIn("Lecture slides and decks.", lines[0])
        self.assertTrue(lines[1].startswith("2. Worksheets:"))
        self.assertIn("discussions", lines[1])

    def test_find_matching_folder(self):
        custom = [
            {"id": "c1", "name": "Lecture Decks", "types": ["slides", "lectures"]},
            {"id": "c2", "name": "Lab Reports", "types": ["assignments"]}
        ]
        # Match by name
        self.assertEqual(organizer.find_matching_folder(custom, ["Lecture Decks"]), "Lecture Decks")
        # Match by substring
        self.assertEqual(organizer.find_matching_folder(custom, ["Decks"]), "Lecture Decks")
        # Match by type tag
        self.assertEqual(organizer.find_matching_folder(custom, ["Unmatched"], ["assignments"]), "Lab Reports")
        # Fallback
        self.assertEqual(organizer.find_matching_folder(custom, ["Nonexistent"], fallback="Other"), "Other")

    def test_resolve_cat_num(self):
        custom = [
            {"id": "c1", "name": "Lecture Slides", "types": ["slides"]},
            {"id": "c2", "name": "Exams & Quizzes", "types": ["exams"]}
        ]
        cat_map = organizer.build_category_map(custom)
        num = organizer.resolve_cat_num(cat_map, custom, ["Exams & Quizzes"])
        self.assertEqual(num, 2)

    def test_folder_parent(self):
        custom = [
            {"id": "c1", "name": "Lecture Slides", "parent": "study_materials"},
            {"id": "c2", "name": "Assignments", "parent": "student_work"}
        ]
        self.assertEqual(organizer.folder_parent(custom, "Lecture Slides"), "study_materials")
        self.assertEqual(organizer.folder_parent(custom, "Assignments"), "student_work")
        self.assertEqual(organizer.folder_parent(custom, "Unknown"), "study_materials")

    def test_categorize_by_keywords_with_custom_folders(self):
        custom = [
            {"id": "c1", "name": "My Slides", "types": ["slides", "lectures"]},
            {"id": "c2", "name": "My Worksheets", "types": ["worksheets", "discussions"]},
            {"id": "c3", "name": "My Homework", "types": ["homework", "assignments"]},
            {"id": "c4", "name": "My Admin", "types": ["syllabus", "admin"]}
        ]
        config = {"disk_hierarchy": {"custom_folders": custom}}
        # Syllabus keyword
        res = organizer.categorize_by_keywords("Course syllabus and schedule.pdf", config)
        self.assertEqual(res, "My Admin")
        # Lecture keyword
        res_lec = organizer.categorize_by_keywords("Week 1 lecture slides.pdf", config)
        self.assertEqual(res_lec, "My Slides")
        # Homework keyword
        res_hw = organizer.categorize_by_keywords("Homework 1 problem set.pdf", config)
        self.assertEqual(res_hw, "My Homework")

    @patch("organizer.query_llm")
    def test_categorize_with_ai_custom_folders(self, mock_llm):
        mock_llm.return_value = "2"
        custom = [
            {"id": "c1", "name": "Course Readings", "parent": "study_materials", "types": ["readings"]},
            {"id": "c2", "name": "Lab Deliverables", "parent": "student_work", "types": ["deliverables"]}
        ]
        config = {
            "llm_provider": "gemini",
            "gemini_api_key": "test_key",  # pragma: allowlist secret
            "disk_hierarchy": {"custom_folders": custom}
        }
        test_file = os.path.join(self.temp_dir, "lab1.pdf")
        with open(test_file, "w") as f:
            f.write("Lab 1 Deliverable")

        result = organizer.categorize_with_ai(
            file_path=test_file,
            fallback_title="Lab 1",
            output_dir=self.output_dir,
            config=config,
            course_name=self.course_name,
            module_titles=[]
        )
        self.assertEqual(result, "Lab Deliverables")
        # Verify prompt had (1-2)
        sent_prompt = mock_llm.call_args[0][0]
        self.assertIn("Select the single best category number (1-2)", sent_prompt)
        self.assertIn("1. Course Readings:", sent_prompt)
        self.assertIn("2. Lab Deliverables:", sent_prompt)

    @patch("sorter.query_llm")
    def test_sorter_moves_regular_files_and_respects_custom_work(self, mock_llm):
        # Create a gigantic folder with 40 dummy files
        folder = os.path.join(self.output_dir, "Large Folder")
        os.makedirs(folder, exist_ok=True)
        files = []
        for i in range(40):
            fn = f"lecture_notes_{i}.pdf"
            fp = os.path.join(folder, fn)
            with open(fp, "w") as f:
                f.write("content")
            files.append(fn)

        # Also add a student submission
        sub_fn = "hw1_submission.pdf"
        with open(os.path.join(folder, sub_fn), "w") as f:
            f.write("student response")

        # Mock AI to assign files to a subfolder
        ai_resp = {f: "Lecture Decks & Presentations" for f in files}
        mock_llm.return_value = json.dumps({"assignments": ai_resp})

        custom = [
            {"id": "c1", "name": "Lecture Slides", "parent": "study_materials", "types": ["slides"]},
            {"id": "c2", "name": "Assignments", "parent": "student_work", "types": ["assignments", "homework"]}
        ]
        config = {
            "llm_provider": "gemini",
            "gemini_api_key": "test_key",  # pragma: allowlist secret -- synthetic test credential
            "disk_hierarchy": {
                "custom_folders": custom,
                "work_folder": "{course} Work"
            }
        }

        sorter.sort_gigantic_folders(self.output_dir, self.course_name, config, threshold=35)

        # 1. Verify regular files were moved into the AI-generated subfolder (dead code bug fixed!)
        subfolder_path = os.path.join(folder, "Lecture Decks & Presentations")
        self.assertTrue(os.path.exists(subfolder_path))
        self.assertTrue(os.path.exists(os.path.join(subfolder_path, "lecture_notes_0.pdf")))

        # 2. Verify student submission was rerouted to the Work directory
        work_dir = os.path.join(self.course_root, f"{self.course_name} Work", f"{self.course_name} Assignments")
        self.assertTrue(os.path.exists(os.path.join(work_dir, sub_fn)))


if __name__ == "__main__":
    unittest.main()
