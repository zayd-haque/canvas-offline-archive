"""[Codex] Credential settings preserve config and never expose secret values."""
import tests
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
import subprocess
from unittest.mock import patch, AsyncMock

from canvas_app import server, archive
from tests.test_launcher_api import asgi_request


class GeminiSettingsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'config.json'
        self.secrets_dir = Path(self.directory.name) / '.secrets'
        self.secrets_path = self.secrets_dir / 'credentials.json'
        self.original = {'gemini_api_key': 'old-test-secret', 'courses': {'sample': 1}, 'provider': 'gemini'}  # pragma: allowlist secret
        self.path.write_text(json.dumps(self.original))
        patcher = patch.object(server, '_GEMINI_CONFIG_PATH', self.path)
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher_secrets_dir = patch.object(server, '_SECRETS_DIR', self.secrets_dir)
        patcher_secrets_dir.start()
        self.addCleanup(patcher_secrets_dir.stop)
        patcher_secrets = patch.object(server, '_SECRETS_PATH', self.secrets_path)
        patcher_secrets.start()
        self.addCleanup(patcher_secrets.stop)

    def request(self, method='GET', body=None, headers=None):
        return asyncio.run(asgi_request('/api/settings/gemini-key', method=method, body=body, headers=headers))

    def test_status_never_returns_key_and_is_not_cached(self):
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {'configured': True, 'tier': 'paid'})
        self.assertIn(b'no-store', headers[b'cache-control'])
        self.assertNotIn(b'old-test-secret', body)
        self.path.write_text('{}')
        self.assertEqual(json.loads(self.request()[2]), {'configured': False, 'tier': 'paid'})

    def test_replacement_preserves_configuration_and_restricts_permissions(self):
        status, _, body = self.request('PUT', {'api_key': 'new-test-secret'})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {'configured': True})
        # credentials.json must store the key with 0o600 permissions
        self.assertTrue(self.secrets_path.exists())
        self.assertEqual(json.loads(self.secrets_path.read_text()), {'gemini_api_key': 'new-test-secret'})  # pragma: allowlist secret
        self.assertEqual(self.secrets_path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.secrets_dir.stat().st_mode & 0o777, 0o700)
        # config.json must NOT store the plaintext key
        self.assertEqual(json.loads(self.path.read_text()), {**self.original, 'gemini_api_key': ''})
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.secrets_dir.glob('.credentials-*')), [])

    def test_invalid_requests_do_not_echo_or_change_secret(self):
        original = self.path.read_bytes()
        for value in ('', 'invalid secret', 'x' * 513, 123, None, {'secret': 'nested-secret'}):  # pragma: allowlist secret
            with self.subTest(value_type=type(value).__name__):
                status, _, body = self.request('PUT', {'api_key': value})
                self.assertEqual(status, 400)
                self.assertNotIn(b'invalid secret', body)
                self.assertNotIn(b'nested-secret', body)
                self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(self.request('PUT', b'{broken-secret')[0], 400)
        self.assertEqual(self.request('PUT', {'api_key': 'secret'}, {'content-type': 'text/plain'})[0], 415)  # pragma: allowlist secret
        self.assertEqual(self.request('PUT', b'x' * 4097)[0], 413)

    def test_cross_origin_write_is_denied(self):
        original = self.path.read_bytes()
        self.assertEqual(self.request('PUT', {'api_key': 'new-secret'}, {'origin': 'https://example.com'})[0], 403)  # pragma: allowlist secret
        self.assertEqual(self.path.read_bytes(), original)

    def test_malformed_configuration_is_not_overwritten(self):
        self.path.write_text('{broken-config-secret')
        for method in ('GET', 'PUT'):
            status, _, body = self.request(method, {'api_key': 'new-secret'} if method == 'PUT' else None)
            self.assertEqual(status, 503)
            self.assertNotIn(b'broken-config-secret', body)
        self.assertEqual(self.path.read_text(), '{broken-config-secret')

    def test_atomic_write_failure_preserves_original(self):
        original = self.path.read_bytes()
        with patch.object(server.os, 'replace', side_effect=OSError('private-secret')):
            status, _, body = self.request('PUT', {'api_key': 'new-secret'})
        self.assertEqual(status, 503)
        self.assertNotIn(b'private-secret', body)
        self.assertEqual(list(self.secrets_dir.glob('.credentials-*')), [])

    def test_concurrent_change_is_preserved(self):
        original_fsync = server.os.fsync
        def change_config(fd):
            original_fsync(fd)
            self.path.write_text('{"new_setting": true}')
        with patch.object(server.os, 'fsync', side_effect=change_config):
            status, _, _ = self.request('PUT', {'api_key': 'new-secret'})
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(self.path.read_text()), {'new_setting': True})
        self.assertEqual(list(self.path.parent.glob('.gemini-settings-*')), [])

    def test_gemini_tier_endpoint_updates_config_and_permissions(self):
        status, _, body = asyncio.run(asgi_request('/api/settings/gemini-tier', method='PUT', body={'tier': 'free'}))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {'configured': True, 'tier': 'free'})
        saved = json.loads(self.path.read_text())
        self.assertEqual(saved['gemini_tier'], 'free')
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

        # Update back to paid
        status, _, body = asyncio.run(asgi_request('/api/settings/gemini-tier', method='PUT', body={'tier': 'paid'}))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {'configured': True, 'tier': 'paid'})
        saved = json.loads(self.path.read_text())
        self.assertEqual(saved['gemini_tier'], 'paid')

    def test_gemini_tier_validation_rejects_invalid_values(self):
        original = self.path.read_bytes()
        for invalid in ('ultra', 'turbo', '', 123, None):
            with self.subTest(tier=invalid):
                status, _, body = asyncio.run(asgi_request('/api/settings/gemini-tier', method='PUT', body={'tier': invalid}))
                self.assertIn(status, (400, 422))
                self.assertEqual(self.path.read_bytes(), original)


class KeywordRulesSettingsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'config.json'
        self.initial_rules = [
            {
                "folder": "Exams And Quizzes/Practice Exams",
                "keywords": ["practice exam", "sample midterm"],
                "override": True
            }
        ]
        self.path.write_text(json.dumps({
            "llm_provider": "gemini",
            "category_rules": self.initial_rules
        }))
        patcher = patch.object(server, '_GEMINI_CONFIG_PATH', self.path)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_get_keyword_rules(self):
        status, _, body = asyncio.run(asgi_request("/api/settings/keyword-rules", method="GET"))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertIn("rules", data)
        self.assertEqual(data["rules"], self.initial_rules)

    def test_get_keyword_rules_default_empty(self):
        self.path.write_text(json.dumps({"llm_provider": "gemini"}))
        status, _, body = asyncio.run(asgi_request("/api/settings/keyword-rules", method="GET"))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data["rules"], [])

    def test_put_keyword_rules_success_and_atomic_update(self):
        new_rules = [
            {
                "folder": "Homework Assignments",
                "keywords": ["Homework", " PSet ", "problem set"],
                "override": False
            },
            {
                "folder": "Discussion Worksheets",
                "keywords": ["discussion", "worksheet"]
            }
        ]
        status, _, body = asyncio.run(asgi_request("/api/settings/keyword-rules", method="PUT", body={"rules": new_rules}))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertTrue(data.get("success"))
        # Keywords should be cleaned and lowercased
        expected = [
            {
                "folder": "Homework Assignments",
                "keywords": ["homework", "pset", "problem set"],
                "override": False
            },
            {
                "folder": "Discussion Worksheets",
                "keywords": ["discussion", "worksheet"]
            }
        ]
        self.assertEqual(data["rules"], expected)

        # Verify persisted configuration
        saved = json.loads(self.path.read_text())
        self.assertEqual(saved["category_rules"], expected)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_put_keyword_rules_validation_errors(self):
        original = self.path.read_bytes()
        invalid_payloads = [
            None,
            {},
            {"rules": "not-a-list"},
            {"rules": ["not-a-dict"]},
            {"rules": [{"folder": "", "keywords": ["hw"]}]},
            {"rules": [{"folder": "   ", "keywords": ["hw"]}]},
            {"rules": [{"keywords": ["hw"]}]},
            {"rules": [{"folder": "HW", "keywords": []}]},
            {"rules": [{"folder": "HW", "keywords": "not-a-list"}]},
            {"rules": [{"folder": "HW", "keywords": [""]}]},
            {"rules": [{"folder": "HW", "keywords": ["   "]}]},
            {"rules": [{"folder": "HW", "keywords": [123]}]},
        ]
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                status, _, _ = asyncio.run(asgi_request("/api/settings/keyword-rules", method="PUT", body=payload))
                self.assertIn(status, (400, 422))
                self.assertEqual(self.path.read_bytes(), original)


class OllamaAndCacheSettingsTests(unittest.TestCase):
    def test_ollama_status_when_online(self):
        mock_payload = json.dumps({"models": [{"name": "qwen2.5:7b"}, {"name": "llama3.2:latest"}]}).encode("utf-8")
        class MockResponse:
            status = 200
            def read(self):
                return mock_payload
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass

        with patch("urllib.request.urlopen", return_value=MockResponse()):
            status, _, body = asyncio.run(asgi_request("/api/settings/ollama-status", method="GET"))
            self.assertEqual(status, 200)
            data = json.loads(body)
            self.assertTrue(data.get("running"))
            self.assertEqual(data.get("installed_models"), ["qwen2.5:7b", "llama3.2:latest"])

    def test_ollama_status_when_offline(self):
        with patch("urllib.request.urlopen", side_effect=OSError("Connection refused")):
            status, _, body = asyncio.run(asgi_request("/api/settings/ollama-status", method="GET"))
            self.assertEqual(status, 200)
            data = json.loads(body)
            self.assertFalse(data.get("running"))
            self.assertEqual(data.get("installed_models"), [])

    def test_cache_status_and_clear_lifecycle(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            with patch.object(server, "_SLIDE_PREVIEWS_CACHE_DIR", temp_path):
                # Empty cache
                status, _, body = asyncio.run(asgi_request("/api/settings/cache-status", method="GET"))
                self.assertEqual(status, 200)
                data = json.loads(body)
                self.assertEqual(data["file_count"], 0)
                self.assertEqual(data["byte_size"], 0)

                # Populate with mock cache files
                subdir = temp_path / "deck1"
                subdir.mkdir()
                f1 = subdir / "Preview.html"
                f1.write_text("<html>hello slide 1</html>")
                f2 = subdir / "slide_1.png"
                f2.write_bytes(b"x" * 1024)

                status, _, body = asyncio.run(asgi_request("/api/settings/cache-status", method="GET"))
                self.assertEqual(status, 200)
                data = json.loads(body)
                self.assertEqual(data["file_count"], 2)
                expected_bytes = len("<html>hello slide 1</html>") + 1024
                self.assertEqual(data["byte_size"], expected_bytes)
                self.assertIn("KB", data["formatted_size"])

                # Clear cache
                status, _, body = asyncio.run(asgi_request("/api/settings/cache-clear", method="POST"))
                self.assertEqual(status, 200)
                clear_data = json.loads(body)
                self.assertEqual(clear_data["freed_bytes"], expected_bytes)
                self.assertIn("KB", clear_data["freed_size"])

                # Verify files were removed
                status, _, body = asyncio.run(asgi_request("/api/settings/cache-status", method="GET"))
                self.assertEqual(status, 200)
                data = json.loads(body)
                self.assertEqual(data["file_count"], 0)
                self.assertEqual(data["byte_size"], 0)


class DirectorySettingsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.config_path = Path(self.directory.name) / 'config.json'
        # [Codex] Directory discovery intentionally prunes missing roots; keep
        # this fixture independent of the real or disposable HOME Desktop.
        self.course_root = Path(self.directory.name) / 'courses'
        self.course_root.mkdir()
        self.config_path.write_text(json.dumps({
            'search_dirs': [str(self.course_root)],
            'default_course_dir': str(self.course_root)
        }))
        patcher = patch.object(server, '_GEMINI_CONFIG_PATH', self.config_path)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_get_directories_settings(self):
        status, _, body = asyncio.run(asgi_request("/api/settings/directories", method="GET"))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertIn("search_dirs", data)
        self.assertIn("default_dir", data)
        self.assertIn("courses_by_dir", data)
        self.assertIsInstance(data["search_dirs"], list)
        self.assertEqual(data["search_dirs"], [str(self.course_root)])
        self.assertEqual(data["default_dir"], str(self.course_root))

    def test_put_directories_settings_and_permissions(self):
        custom_root1 = Path(self.directory.name) / "courses1"
        custom_root1.mkdir()
        custom_root2 = Path(self.directory.name) / "courses2"
        custom_root2.mkdir()

        payload = {
            "search_dirs": [str(custom_root1), str(custom_root2)],
            "default_dir": str(custom_root1)
        }
        status, _, body = asyncio.run(asgi_request("/api/settings/directories", method="PUT", body=payload))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(len(data["search_dirs"]), 2)
        expected_display = server._to_display_path(custom_root1)
        self.assertEqual(data["default_dir"], expected_display)

        # Verify config.json file and permissions
        saved = json.loads(self.config_path.read_text())
        self.assertIn(expected_display, saved["search_dirs"])
        self.assertEqual(saved["default_course_dir"], expected_display)
        self.assertEqual(self.config_path.stat().st_mode & 0o777, 0o600)

    def test_put_directories_validation_rejects_missing_paths(self):
        nonexistent = str(Path(self.directory.name) / "does_not_exist_xyz")
        status, _, body = asyncio.run(asgi_request("/api/settings/directories", method="PUT", body={
            "search_dirs": [nonexistent],
            "default_dir": nonexistent
        }))
        self.assertEqual(status, 400)
        err = json.loads(body)
        self.assertIn("does not exist", err.get("detail", ""))

    def test_put_directories_accepts_empty_without_fallback_scan(self):
        previous_roots = list(server.SEARCH_DIRS)
        self.addCleanup(lambda: server.SEARCH_DIRS.__setitem__(slice(None), previous_roots))
        course = Path(self.directory.name) / 'EXAMPLE 101'
        course.mkdir()
        (course / 'canvas_course.json').write_text(json.dumps({'course_name': 'EXAMPLE 101', 'modules': []}))
        status, _, _ = asyncio.run(asgi_request("/api/settings/directories", method="PUT", body={
            "search_dirs": [self.directory.name],
            "default_dir": self.directory.name
        }))
        self.assertEqual(status, 200)
        self.assertIn('EXAMPLE 101', server.discover_courses())
        status, _, body = asyncio.run(asgi_request("/api/settings/directories", method="PUT", body={
            "search_dirs": [],
            "default_dir": ""
        }))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['search_dirs'], [])
        self.assertEqual(json.loads(self.config_path.read_text())['search_dirs'], [])
        self.assertEqual(server._read_configured_directories()[0], [])
        self.assertEqual(server.get_effective_search_dirs(), [])
        self.assertEqual(server.discover_courses(), {})
        scan_status, _, scan_body = asyncio.run(asgi_request("/api/settings/directories/scan", method="POST"))
        self.assertEqual(scan_status, 200)
        self.assertEqual(json.loads(scan_body)['directories_scanned'], 0)

    def test_scan_directories_endpoint(self):
        custom_root = Path(self.directory.name) / "scan_courses"
        custom_root.mkdir()
        c_dir = custom_root / "MATH 33A"
        c_dir.mkdir()
        (c_dir / "canvas_course.json").write_text(json.dumps({
            "course_name": "MATH 33A",
            "course_url": "https://canvas.ucla.edu/courses/33333"
        }))

        with patch.object(server, 'SEARCH_DIRS', [custom_root]):
            status, _, body = asyncio.run(asgi_request("/api/settings/directories/scan", method="POST"))
            self.assertEqual(status, 200)
            data = json.loads(body)
            self.assertTrue(data.get("success"))
            self.assertGreaterEqual(data.get("course_count", 0), 1)
            self.assertGreaterEqual(data.get("directories_scanned", 0), 1)

    @patch('canvas_app.native.sys.platform', 'darwin')
    def test_browse_directory_success(self):
        selected_dir = Path(self.directory.name) / "SelectedCourseDir"
        selected_dir.mkdir()

        mock_res = subprocess.CompletedProcess(
            args=["osascript", "-e", 'POSIX path of (choose folder with prompt "Select Course Directory")'],
            returncode=0,
            stdout=str(selected_dir) + "\n",
            stderr=""
        )

        with patch("subprocess.run", return_value=mock_res) as mock_run:
            status, _, body = asyncio.run(asgi_request("/api/settings/directories/browse", method="POST"))
            self.assertEqual(status, 200)
            data = json.loads(body)
            self.assertTrue(data.get("success"))
            self.assertEqual(data.get("path"), str(selected_dir.resolve()))
            self.assertEqual(data.get("display_path"), server._to_display_path(selected_dir))
            mock_run.assert_called_once()
            args, kwargs = mock_run.call_args
            self.assertEqual(args[0][0], "osascript")
            self.assertIn('choose folder with prompt "Select Course Directory"', args[0][2])

    @patch('canvas_app.native.sys.platform', 'darwin')
    def test_browse_directory_custom_prompt(self):
        selected_dir = Path(self.directory.name) / "CustomPromptDir"
        selected_dir.mkdir()

        mock_res = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=str(selected_dir) + "/\n",
            stderr=""
        )

        with patch("subprocess.run", return_value=mock_res) as mock_run:
            status, _, body = asyncio.run(asgi_request("/api/settings/directories/browse", method="POST", body={
                "prompt": "Pick your lecture slides"
            }))
            self.assertEqual(status, 200)
            data = json.loads(body)
            self.assertTrue(data.get("success"))
            self.assertEqual(data.get("path"), str(selected_dir.resolve()))
            mock_run.assert_called_once()
            args, _ = mock_run.call_args
            self.assertIn('choose folder with prompt "Pick your lecture slides"', args[0][2])

    @patch('canvas_app.native.sys.platform', 'darwin')
    def test_browse_directory_canceled(self):
        mock_res = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="execution error: User canceled. (-128)\n"
        )

        with patch("subprocess.run", return_value=mock_res):
            status, _, body = asyncio.run(asgi_request("/api/settings/directories/browse", method="POST"))
            self.assertEqual(status, 200)
            data = json.loads(body)
            self.assertTrue(data.get("success"))
            self.assertTrue(data.get("canceled"))

    @patch('canvas_app.native.sys.platform', 'darwin')
    def test_browse_directory_timeout(self):
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd=["osascript"], timeout=120)):
            status, _, body = asyncio.run(asgi_request("/api/settings/directories/browse", method="POST"))
            self.assertEqual(status, 408)
            err = json.loads(body)
            self.assertIn("timed out", err.get("detail", "").lower())

    @patch('canvas_app.native.sys.platform', 'darwin')
    def test_browse_directory_execution_failure(self):
        mock_res = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="execution error: System Events got an error: Access denied. (1000)\n"
        )

        with patch("subprocess.run", return_value=mock_res):
            status, _, body = asyncio.run(asgi_request("/api/settings/directories/browse", method="POST"))
            self.assertEqual(status, 500)
            err = json.loads(body)
            self.assertIn("failed", err.get("detail", "").lower())

    @patch('canvas_app.native.sys.platform', 'darwin')
    def test_browse_directory_not_a_directory(self):
        fake_file = Path(self.directory.name) / "some_file.txt"
        fake_file.write_text("not a folder")

        mock_res = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=str(fake_file) + "\n",
            stderr=""
        )

        with patch("subprocess.run", return_value=mock_res):
            status, _, body = asyncio.run(asgi_request("/api/settings/directories/browse", method="POST"))
            self.assertEqual(status, 400)
            err = json.loads(body)
            self.assertIn("not a directory", err.get("detail", "").lower())

    def test_import_course_directory_success_root_blueprint(self):
        external_root = Path(self.directory.name) / "external_drive"
        external_root.mkdir()
        course_dir = external_root / "PHYSICS 1A"
        course_dir.mkdir()
        (course_dir / "canvas_course.json").write_text(json.dumps({
            "course_name": "PHYSICS 1A",
            "course_url": "https://canvas.ucla.edu/courses/10001"
        }))

        status, _, body = asyncio.run(asgi_request("/api/settings/directories/import", method="POST", body={
            "course_path": str(course_dir)
        }))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("course_name"), "PHYSICS 1A")

        # Verify parent directory was appended to config.json
        saved = json.loads(self.config_path.read_text())
        self.assertTrue(any(Path(d).expanduser().resolve() == external_root.resolve() for d in saved["search_dirs"]))

    def test_import_course_directory_success_subfolder_blueprint(self):
        external_root = Path(self.directory.name) / "custom_share"
        external_root.mkdir()
        course_dir = external_root / "STATS 20"
        course_dir.mkdir()
        lectures_dir = course_dir / "STATS 20 Lectures & Resources"
        lectures_dir.mkdir()
        (lectures_dir / "canvas_course.json").write_text(json.dumps({
            "course_name": "STATS 20"
        }))

        status, _, body = asyncio.run(asgi_request("/api/settings/directories/import", method="POST", body={
            "course_path": str(course_dir)
        }))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("course_name"), "STATS 20")

    def test_import_course_directory_validation_errors(self):
        # Nonexistent path
        status, _, body = asyncio.run(asgi_request("/api/settings/directories/import", method="POST", body={
            "course_path": str(Path(self.directory.name) / "fake_dir")
        }))
        self.assertEqual(status, 400)

        # Directory without canvas_course.json
        empty_course = Path(self.directory.name) / "EMPTY_COURSE"
        empty_course.mkdir()
        status, _, body = asyncio.run(asgi_request("/api/settings/directories/import", method="POST", body={
            "course_path": str(empty_course)
        }))
        self.assertEqual(status, 400)
        err = json.loads(body)
        self.assertIn("canvas_course.json", err.get("detail", ""))

    def test_import_course_directory_auto_synthesizes_legacy_course(self):
        # Academic candidate directory without existing canvas_course.json
        legacy_course = Path(self.directory.name) / "MATH 32A"
        legacy_course.mkdir()
        (legacy_course / "Lecture 1.pdf").write_text("Calculus")
        (legacy_course / "Lecture 2.pdf").write_text("Vectors")

        status, _, body = asyncio.run(asgi_request("/api/settings/directories/import", method="POST", body={
            "course_path": str(legacy_course)
        }))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertTrue(data.get("success"))
        self.assertTrue(data.get("synthesized"))
        self.assertEqual(data.get("course_name"), "MATH 32A")
        self.assertTrue((legacy_course / "canvas_course.json").exists())

    def test_scan_legacy_courses_endpoint(self):
        scan_root = Path(self.directory.name) / "past_classes"
        scan_root.mkdir()
        bio_dir = scan_root / "Fall 2023 - BIO 1A"
        bio_dir.mkdir()
        (bio_dir / "Syllabus_Bio1A.pdf").write_text("Bio")
        (bio_dir / "Week1_Notes.pdf").write_text("Cells")

        empty_dir = scan_root / "Notes"
        empty_dir.mkdir()

        status, _, body = asyncio.run(asgi_request("/api/settings/courses/scan-legacy", method="POST", body={
            "root_path": str(scan_root),
            "max_depth": 3
        }))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("count"), 1)
        cand = data["candidates"][0]
        self.assertEqual(cand["inferred_name"], "BIO 1A")
        self.assertEqual(cand["detected_term"], "Fall 2023")
        self.assertTrue(cand["has_syllabus"])
        self.assertEqual(cand["file_count"], 2)

    def test_synthesize_course_endpoint(self):
        art_dir = Path(self.directory.name) / "ArtClass"
        art_dir.mkdir()
        (art_dir / "Slide1.pdf").write_text("Art")

        status, _, body = asyncio.run(asgi_request("/api/settings/courses/synthesize", method="POST", body={
            "course_path": str(art_dir),
            "course_name": "Art History 10",
            "term": "Spring 2024"
        }))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("course_name"), "Art History 10")
        self.assertEqual(data.get("term"), "Spring 2024")

        bp_file = art_dir / "canvas_course.json"
        self.assertTrue(bp_file.exists())
        bp_data = json.loads(bp_file.read_text())
        self.assertEqual(bp_data.get("course_name"), "Art History 10")
        self.assertEqual(bp_data.get("term"), "Spring 2024")
        self.assertTrue(bp_data.get("is_synthesized"))

    def test_launcher_daemon_forwards_output_dir(self):
        custom_out = Path(self.directory.name) / "custom_downloads"
        custom_out.mkdir()

        req = server.LauncherStartRequest(
            course_url="https://canvas.ucla.edu/courses/123",
            course_name="ASTRON 3",
            mode="full",
            output_dir=str(custom_out)
        )
        job = {
            "job_id": "test_output_dir_job",
            "course_name": req.course_name,
            "status": "pending",
            "events": [],
            "subscribers": set()
        }

        captured_args = []

        class DummyProc:
            class DummyStdout:
                async def readline(self):
                    return b""
            stdout = DummyStdout()
            returncode = 0
            async def wait(self):
                return 0

        async def fake_exec(*args, **kwargs):
            captured_args.extend(args)
            return DummyProc()

        with patch("canvas_app.server.terminate_pipeline_process", new=AsyncMock()), patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
            asyncio.run(server._run_launcher_daemon(job, req))

        self.assertIn("--output-dir", captured_args)
        idx = captured_args.index("--output-dir")
        self.assertEqual(captured_args[idx + 1], str(custom_out.resolve()))

    def test_launcher_daemon_falls_back_to_configured_default_dir(self):
        custom_default = Path(self.directory.name) / "configured_default"
        custom_default.mkdir()
        self.config_path.write_text(json.dumps({
            "search_dirs": [str(custom_default)],
            "default_course_dir": str(custom_default)
        }))

        req = server.LauncherStartRequest(
            course_url="https://canvas.ucla.edu/courses/123",
            course_name="BIOCHEM 153A",
            mode="full"
        )
        job = {
            "job_id": "test_default_dir_job",
            "course_name": req.course_name,
            "status": "pending",
            "events": [],
            "subscribers": set()
        }

        captured_args = []

        class DummyProc:
            class DummyStdout:
                async def readline(self):
                    return b""
            stdout = DummyStdout()
            returncode = 0
            async def wait(self):
                return 0

        async def fake_exec(*args, **kwargs):
            captured_args.extend(args)
            return DummyProc()

        with patch("canvas_app.server.terminate_pipeline_process", new=AsyncMock()), patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
            asyncio.run(server._run_launcher_daemon(job, req))

        self.assertIn("--output-dir", captured_args)
        idx = captured_args.index("--output-dir")
        self.assertEqual(captured_args[idx + 1], str(custom_default.resolve()))

    def test_nested_search_directories_deduplication(self):
        parent_root = Path(self.directory.name) / "nest_parent"
        parent_root.mkdir()
        child_root = parent_root / "Desktop"
        child_root.mkdir()
        course_dir = child_root / "CHEM 14D"
        course_dir.mkdir()
        (course_dir / "canvas_course.json").write_text(json.dumps({
            "course_name": "CHEM 14D",
            "course_url": "https://canvas.ucla.edu/courses/14"
        }))

        # 1. Verify get_effective_search_dirs() prunes child_root when parent_root is configured
        with patch.object(server, 'SEARCH_DIRS', [child_root, parent_root]):
            effective = server.get_effective_search_dirs()
            self.assertEqual(effective, [parent_root.resolve()])
            courses = server.discover_courses()
            self.assertIn("CHEM 14D", courses)
            self.assertEqual(list(courses.keys()), ["CHEM 14D"])

        # 2. Verify ArchiveCatalog._scan directly called with overlapping roots without server pruning
        catalog = archive.ArchiveCatalog(ttl=0)
        courses_direct = catalog.discover([child_root, parent_root])
        self.assertIn("CHEM 14D", courses_direct)
        self.assertEqual(list(courses_direct.keys()), ["CHEM 14D"])
        self.assertEqual(len(courses_direct), 1)

        # 3. Verify in reverse order [parent_root, child_root]
        catalog2 = archive.ArchiveCatalog(ttl=0)
        courses_direct_rev = catalog2.discover([parent_root, child_root])
        self.assertIn("CHEM 14D", courses_direct_rev)
        self.assertEqual(list(courses_direct_rev.keys()), ["CHEM 14D"])
        self.assertEqual(len(courses_direct_rev), 1)


class HierarchySettingsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.config_path = Path(self.directory.name) / 'config.json'
        self.config_path.write_text(json.dumps({
            'search_dirs': ['~/Desktop'],
            'default_course_dir': '~/Desktop'
        }))
        patcher = patch.object(server, '_GEMINI_CONFIG_PATH', self.config_path)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_get_hierarchy_settings_default(self):
        status, _, body = asyncio.run(asgi_request("/api/settings/hierarchy", method="GET"))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertTrue(data.get("ok"))
        hier = data.get("disk_hierarchy", {})
        self.assertEqual(hier.get("preset"), "standard")
        self.assertEqual(hier.get("lectures_folder"), "{course} Lectures & Resources")
        self.assertTrue(hier.get("enable_work_folder"))
        self.assertEqual(hier.get("work_folder"), "{course} Work")
        self.assertEqual(hier.get("timeline_file"), "{course} Assignments_and_Milestones_Timeline.md")
        self.assertEqual(hier.get("categorization_style"), "standard")

    def test_put_hierarchy_settings_and_permissions(self):
        payload = {
            "preset": "compact",
            "lectures_folder": "Lectures",
            "enable_work_folder": True,
            "work_folder": "Work",
            "timeline_file": "Timeline.md",
            "categorization_style": "minimal"
        }
        status, _, body = asyncio.run(asgi_request("/api/settings/hierarchy", method="PUT", body=payload))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertTrue(data.get("ok"))
        self.assertEqual(data["disk_hierarchy"]["preset"], "compact")
        self.assertEqual(data["disk_hierarchy"]["lectures_folder"], "Lectures")

        # Verify on disk config.json and 0600 permissions
        saved = json.loads(self.config_path.read_text())
        self.assertEqual(saved["disk_hierarchy"]["preset"], "compact")
        self.assertEqual(saved["disk_hierarchy"]["lectures_folder"], "Lectures")
        self.assertEqual(self.config_path.stat().st_mode & 0o777, 0o600)

        # GET confirms persistence
        status_get, _, body_get = asyncio.run(asgi_request("/api/settings/hierarchy", method="GET"))
        self.assertEqual(status_get, 200)
        self.assertEqual(json.loads(body_get)["disk_hierarchy"]["lectures_folder"], "Lectures")

    def test_put_hierarchy_validation(self):
        original = self.config_path.read_bytes()
        # Invalid preset
        status, _, _ = asyncio.run(asgi_request("/api/settings/hierarchy", method="PUT", body={
            "preset": "unsupported_preset",
            "lectures_folder": "Lectures"
        }))
        self.assertEqual(status, 422)

        # Empty lectures folder
        status, _, _ = asyncio.run(asgi_request("/api/settings/hierarchy", method="PUT", body={
            "preset": "standard",
            "lectures_folder": ""
        }))
        self.assertEqual(status, 422)

        # Verify config was not modified
        self.assertEqual(self.config_path.read_bytes(), original)

    def test_put_hierarchy_with_custom_folders(self):
        custom_subfolders = [
            {"id": "c1", "name": "Prof Lectures", "parent": "study_materials", "types": ["slides"]},
            {"id": "c2", "name": "Lab Projects", "parent": "student_work", "types": ["assignments"]}
        ]
        payload = {
            "preset": "custom",
            "lectures_folder": "{course} Content",
            "enable_work_folder": True,
            "work_folder": "{course} Submissions",
            "timeline_file": "Timeline.md",
            "categorization_style": "minimal",
            "custom_folders": custom_subfolders
        }
        status, _, body = asyncio.run(asgi_request("/api/settings/hierarchy", method="PUT", body=payload))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data["disk_hierarchy"]["custom_folders"], custom_subfolders)

        # Confirm GET returns custom_folders
        status_get, _, body_get = asyncio.run(asgi_request("/api/settings/hierarchy", method="GET"))
        self.assertEqual(status_get, 200)
        self.assertEqual(json.loads(body_get)["disk_hierarchy"]["custom_folders"], custom_subfolders)

    def test_put_hierarchy_with_main_folders(self):
        main_folders = [
            {"id": "main_lectures", "name": "{course} Course Materials", "role": "study_materials"},
            {"id": "main_work", "name": "{course} Submissions & Homework", "role": "student_work"},
            {"id": "main_labs", "name": "{course} Lab Notebooks", "role": "labs"}
        ]
        payload = {
            "preset": "custom",
            "timeline_file": "Timeline.md",
            "categorization_style": "minimal",
            "main_folders": main_folders
        }
        status, _, body = asyncio.run(asgi_request("/api/settings/hierarchy", method="PUT", body=payload))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertTrue(data.get("ok"))
        self.assertEqual(data["disk_hierarchy"]["main_folders"], main_folders)
        # Backward compatibility mapping for lectures_folder and work_folder
        self.assertEqual(data["disk_hierarchy"]["lectures_folder"], "{course} Course Materials")
        self.assertEqual(data["disk_hierarchy"]["work_folder"], "{course} Submissions & Homework")
        self.assertTrue(data["disk_hierarchy"]["enable_work_folder"])

        # Verify on disk config.json and 0600 permissions
        saved = json.loads(self.config_path.read_text())
        self.assertEqual(saved["disk_hierarchy"]["main_folders"], main_folders)
        self.assertEqual(saved["disk_hierarchy"]["lectures_folder"], "{course} Course Materials")
        self.assertEqual(saved["disk_hierarchy"]["work_folder"], "{course} Submissions & Homework")
        self.assertEqual(self.config_path.stat().st_mode & 0o777, 0o600)

        # GET confirms persistence
        status_get, _, body_get = asyncio.run(asgi_request("/api/settings/hierarchy", method="GET"))
        self.assertEqual(status_get, 200)
        data_get = json.loads(body_get)
        self.assertEqual(data_get["disk_hierarchy"]["main_folders"], main_folders)
        self.assertEqual(data_get["disk_hierarchy"]["lectures_folder"], "{course} Course Materials")

    def test_put_hierarchy_main_folders_validation(self):
        original = self.config_path.read_bytes()
        # Empty main_folders list
        status, _, _ = asyncio.run(asgi_request("/api/settings/hierarchy", method="PUT", body={
            "preset": "custom",
            "main_folders": []
        }))
        self.assertEqual(status, 400)

        # Main folder with empty name
        status, _, _ = asyncio.run(asgi_request("/api/settings/hierarchy", method="PUT", body={
            "preset": "custom",
            "main_folders": [{"id": "m1", "name": "   "}]
        }))
        self.assertEqual(status, 400)

        self.assertEqual(self.config_path.read_bytes(), original)

    def test_archive_scan_discovers_course_with_arbitrary_main_folders(self):
        # Configure 3 main folders in config.json
        self.config_path.write_text(json.dumps({
            "disk_hierarchy": {
                "preset": "custom",
                "main_folders": [
                    {"id": "m1", "name": "{course} Lectures", "role": "study_materials"},
                    {"id": "m2", "name": "{course} Work", "role": "student_work"},
                    {"id": "m3", "name": "{course} Lab Archive", "role": "labs"}
                ]
            }
        }))

        custom_root = Path(self.directory.name) / "main_folders_root"
        custom_root.mkdir()
        c_dir = custom_root / "CHEM 30B"
        c_dir.mkdir()
        # Place blueprint inside the 3rd main folder
        lab_dir = c_dir / "CHEM 30B Lab Archive"
        lab_dir.mkdir()
        (lab_dir / "canvas_course.json").write_text(json.dumps({
            "course_name": "CHEM 30B",
            "course_url": "https://canvas.ucla.edu/courses/302"
        }))

        with patch.object(server, 'SEARCH_DIRS', [custom_root]):
            courses = server.discover_courses()
            self.assertIn("CHEM 30B", courses)
            self.assertEqual(courses["CHEM 30B"]["folder_name"], "CHEM 30B")

    def test_archive_scan_discovers_course_with_custom_hierarchy(self):
        # Configure custom hierarchy template in config.json
        self.config_path.write_text(json.dumps({
            "disk_hierarchy": {
                "preset": "custom",
                "lectures_folder": "{course} Materials"
            }
        }))

        custom_root = Path(self.directory.name) / "scan_root"
        custom_root.mkdir()
        c_dir = custom_root / "MATH 101"
        c_dir.mkdir()
        materials_dir = c_dir / "MATH 101 Materials"
        materials_dir.mkdir()
        (materials_dir / "canvas_course.json").write_text(json.dumps({
            "course_name": "MATH 101",
            "course_url": "https://canvas.ucla.edu/courses/101"
        }))

        with patch.object(server, 'SEARCH_DIRS', [custom_root]):
            courses = server.discover_courses()
            self.assertIn("MATH 101", courses)

    def test_archive_scan_discovers_course_with_compact_lectures(self):
        custom_root = Path(self.directory.name) / "compact_root"
        custom_root.mkdir()
        c_dir = custom_root / "PHYSICS 10"
        c_dir.mkdir()
        lectures_dir = c_dir / "Lectures"
        lectures_dir.mkdir()
        (lectures_dir / "canvas_course.json").write_text(json.dumps({
            "course_name": "PHYSICS 10",
            "course_url": "https://canvas.ucla.edu/courses/10"
        }))

        with patch.object(server, 'SEARCH_DIRS', [custom_root]):
            courses = server.discover_courses()
            self.assertIn("PHYSICS 10", courses)

    def test_launcher_daemon_forwards_custom_subfolder(self):
        self.config_path.write_text(json.dumps({
            "disk_hierarchy": {
                "preset": "custom",
                "lectures_folder": "{course} Study Materials"
            }
        }))

        req = server.LauncherStartRequest(
            course_url="https://canvas.ucla.edu/courses/30",
            course_name="CHEM 30A",
            mode="full"
        )
        job = {
            "job_id": "test_subfolder_job",
            "course_name": req.course_name,
            "status": "pending",
            "events": [],
            "subscribers": set()
        }

        captured_args = []

        class DummyProc:
            class DummyStdout:
                async def readline(self):
                    return b""
            stdout = DummyStdout()
            returncode = 0
            async def wait(self):
                return 0

        async def fake_exec(*args, **kwargs):
            captured_args.extend(args)
            return DummyProc()

        with patch("canvas_app.server.terminate_pipeline_process", new=AsyncMock()), patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
            asyncio.run(server._run_launcher_daemon(job, req))

        self.assertIn("--subfolder", captured_args)
        idx = captured_args.index("--subfolder")
        self.assertEqual(captured_args[idx + 1], "CHEM 30A Study Materials")

    def test_import_course_directory_with_custom_hierarchy(self):
        self.config_path.write_text(json.dumps({
            "search_dirs": ["~/Desktop"],
            "disk_hierarchy": {
                "preset": "custom",
                "lectures_folder": "{course} Archive"
            }
        }))

        external_root = Path(self.directory.name) / "custom_import"
        external_root.mkdir()
        course_dir = external_root / "ENGIN 100"
        course_dir.mkdir()
        archive_dir = course_dir / "ENGIN 100 Archive"
        archive_dir.mkdir()
        (archive_dir / "canvas_course.json").write_text(json.dumps({
            "course_name": "ENGIN 100"
        }))

        status, _, body = asyncio.run(asgi_request("/api/settings/directories/import", method="POST", body={
            "course_path": str(course_dir)
        }))
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("course_name"), "ENGIN 100")
