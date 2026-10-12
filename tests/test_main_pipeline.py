# tests/test_main_pipeline.py
# Unit tests for programmatic course pipeline execution and non-interactive CLI flags.

import os
import sys
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
APP_DIR = os.path.join(PROJECT_DIR, "Canvas Module Downloader")
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)
if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)
import tests

from main import run_course_pipeline, run_full_scrape


class TestMainPipeline(unittest.TestCase):

    def test_existing_archive_output_preserves_custom_root(self):
        # [Codex] Maintenance must never append course or lectures folder names.
        from main import existing_archive_output
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "custom library" / "archive-name"
            root.mkdir(parents=True)
            marker = root / "notes.txt"
            marker.write_text("synthetic notes")
            self.assertEqual(existing_archive_output(root), str(root.resolve()))
            self.assertEqual(list(root.iterdir()), [marker])

    def test_existing_archive_output_missing_does_not_create(self):
        # [Codex] A stale course location fails safely instead of creating folders.
        from main import existing_archive_output
        with tempfile.TemporaryDirectory() as td:
            missing = Path(td) / "missing archive"
            with self.assertRaisesRegex(ValueError, "missing"):
                existing_archive_output(missing)
            self.assertFalse(missing.exists())

    @patch("main.run_local_reclassify")
    @patch("main.load_config")
    def test_existing_archive_pipeline_ignores_default_and_subfolder(self, mock_load, mock_reclassify):
        # [Codex] Verify the actual maintenance call, not only its path helper.
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "custom library" / "archive-name"
            root.mkdir(parents=True)
            mock_load.return_value = {"llm_provider": "rules", "default_course_dir": str(Path(td) / "wrong-default")}
            result = run_course_pipeline(course_name="archive-name", action="3", existing_course_dir=str(root), subfolder="Wrong Lectures")
            self.assertEqual(result["output_dir"], str(root.resolve()))
            mock_reclassify.assert_called_once_with(str(root.resolve()), "archive-name")
            self.assertFalse((Path(td) / "wrong-default").exists())

    @patch("main.run_full_scrape")
    @patch("main.save_config")
    @patch("main.load_config")
    def test_run_course_pipeline_full_scrape(self, mock_load, mock_save, mock_scrape):
        mock_load.return_value = {"llm_provider": "gemini", "gemini_model": "gemini-3.6-flash"}

        res = run_course_pipeline(
            course_url="https://canvas.example.edu/courses/123",
            course_name="PHYSICS 5C",
            provider="ollama",
            model="qwen2.5:7b",
            headless=True,
            selected_categories={"modules", "syllabus"},
        )

        self.assertEqual(res["status"], "success")
        self.assertEqual(res["course_name"], "PHYSICS 5C")
        self.assertEqual(res["action"], "1")
        mock_save.assert_called()
        mock_scrape.assert_called_once()
        args, kwargs = mock_scrape.call_args
        self.assertEqual(args[0], "https://canvas.example.edu/courses/123")
        self.assertEqual(args[2], "PHYSICS 5C")
        self.assertEqual(kwargs["selected_categories"], {"modules", "syllabus"})
        self.assertTrue(kwargs["headless"])

    @patch("main.run_local_reclassify")
    @patch("main.load_config")
    def test_run_course_pipeline_reclassify(self, mock_load, mock_reclassify):
        mock_load.return_value = {"llm_provider": "rules", "use_rule_engine": True}

        res = run_course_pipeline(
            course_name="CHEM 14D",
            action="3",
        )

        self.assertEqual(res["status"], "success")
        self.assertEqual(res["action"], "3")
        mock_reclassify.assert_called_once()

    @patch("main.load_config")
    def test_run_course_pipeline_gradescope(self, mock_load):
        mock_load.return_value = {"llm_provider": "gemini"}
        mock_gs_mod = MagicMock()

        with patch.dict(sys.modules, {"gradescope": mock_gs_mod}):
            res = run_course_pipeline(
                course_name="CHEM 14D",
                action="4",
                gradescope_target="https://www.gradescope.com/courses/456",
            )

            self.assertEqual(res["status"], "success")
            self.assertEqual(res["action"], "4")
            mock_gs_mod.sync_gradescope_course.assert_called_once_with(
                "https://www.gradescope.com/courses/456", "CHEM 14D", output_dir=res["output_dir"])

    def test_run_course_pipeline_invalid_action(self):
        res = run_course_pipeline(
            course_name="CHEM 14D",
            action="99",
        )
        self.assertEqual(res["status"], "error")
        self.assertIn("Unsupported action", res["error"])

    @patch("main.run_full_scrape")
    @patch("main.save_config")
    @patch("main.load_config")
    def test_cli_non_interactive_flags(self, mock_load, mock_save, mock_scrape):
        from main import main
        mock_load.return_value = {"llm_provider": "gemini"}

        test_argv = [
            "main.py",
            "--url", "https://canvas.example.edu/courses/999",
            "--course", "CS 31",
            "--provider", "ollama",
            "--model", "qwen2.5:3b",
            "--headless",
            "--include", "modules,syllabus,grades",
        ]
        with patch.object(sys, "argv", test_argv):
            main()

        mock_scrape.assert_called_once()
        args, kwargs = mock_scrape.call_args
        self.assertEqual(args[0], "https://canvas.example.edu/courses/999")
        self.assertEqual(args[2], "CS 31")
        self.assertEqual(kwargs["selected_categories"], {"modules", "syllabus", "grades"})
        self.assertTrue(kwargs["headless"])


if __name__ == "__main__":
    unittest.main()
