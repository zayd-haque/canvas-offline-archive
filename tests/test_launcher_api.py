import tests
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, AsyncMock

from canvas_app import server


async def asgi_request(url_path, method='GET', headers=None, body=None, _bootstrap=False):
    """Executes an in-memory ASGI request against server.app."""
    if '?' in url_path:
        path, qs = url_path.split('?', 1)
    else:
        path, qs = url_path, ''
    messages = []
    finished = asyncio.Event()
    delivered = False

    async def receive():
        nonlocal delivered
        if not delivered:
            delivered = True
            body_bytes = json.dumps(body).encode() if (body is not None and not isinstance(body, bytes)) else (body or b'')
            return {'type': 'http.request', 'body': body_bytes, 'more_body': False}
        await finished.wait()
        return {'type': 'http.disconnect'}

    async def send(message):
        messages.append(message)
        if message['type'] == 'http.response.body' and not message.get('more_body'):
            finished.set()

    from tests.local_session import session_cookie
    cookie = '' if _bootstrap else await session_cookie(server, asgi_request)
    all_headers = {'host': '127.0.0.1:8000', 'content-type': 'application/json',
                   'cookie': cookie, **(headers or {})}
    await server.app({
        'type': 'http',
        'asgi': {'version': '3.0', 'spec_version': '2.4'},
        'http_version': '1.1',
        'scheme': 'http',
        'method': method,
        'path': path,
        'raw_path': path.encode(),
        'query_string': qs.encode(),
        'root_path': '',
        'headers': [(k.encode(), v.encode()) for k, v in all_headers.items()],
        'client': ('127.0.0.1', 1234),
        'server': ('127.0.0.1', 8000)
    }, receive, send)
    start = next(m for m in messages if m['type'] == 'http.response.start')
    return start['status'], dict(start['headers']), b''.join(m.get('body', b'') for m in messages)


class TestLauncherAPI(unittest.TestCase):
    def setUp(self):
        # Clear jobs before each test
        server._launcher_jobs.clear()
        server._TEST_LAUNCHER_RUNNER = None

    def tearDown(self):
        server._launcher_jobs.clear()
        server._TEST_LAUNCHER_RUNNER = None

    def test_get_hardware_profile(self):
        status, headers, body = asyncio.run(asgi_request('/api/launcher/hardware-profile'))
        self.assertEqual(status, 200)
        data = json.loads(body.decode())
        self.assertIn("chip", data)
        self.assertIn("ram_gb", data)
        self.assertIn("is_apple_silicon", data)
        self.assertIn("tier", data)
        self.assertIn("recommended_model", data)
        self.assertIsInstance(data["ram_gb"], (int, float))
        self.assertIsInstance(data["is_apple_silicon"], bool)

    def test_progress_never_moves_backwards(self):
        job = {"events": [], "subscribers": set()}
        for pct in (20, 48, 25, 35, 75, 100):
            server._broadcast_launcher_event(job, {"type": "step", "step": 2, "pct": pct})
        self.assertEqual([e["pct"] for e in job["events"]], [20, 48, 48, 48, 75, 100])

    def test_launcher_start_validation(self):
        # Missing course_name
        status, _, body = asyncio.run(asgi_request('/api/launcher/start', method='POST', body={
            "course_url": "https://canvas.ucla.edu/courses/123",
            "course_name": ""
        }))
        self.assertEqual(status, 400)

        # Missing course_url in full mode for new / non-existent course
        status, _, body = asyncio.run(asgi_request('/api/launcher/start', method='POST', body={
            "course_url": "",
            "course_name": "NONEXISTENT_COURSE_999",
            "mode": "full"
        }))
        self.assertEqual(status, 400)

        # organize_only does not require course_url
        async def dummy_runner(job, req):
            job["status"] = "done"
        server._TEST_LAUNCHER_RUNNER = dummy_runner

        status, _, body = asyncio.run(asgi_request('/api/launcher/start', method='POST', body={
            "course_name": "CHEM 14D",
            "mode": "organize_only"
        }))
        self.assertEqual(status, 200)
        data = json.loads(body.decode())
        self.assertEqual(data["status"], "started")
        self.assertIn("job_id", data)

    def test_launcher_status_and_not_found(self):
        # Non-existent job
        status, _, _ = asyncio.run(asgi_request('/api/launcher/status/non_existent_job_123'))
        self.assertEqual(status, 404)

        # Existing job
        server._launcher_jobs["test_job_1"] = {
            "job_id": "test_job_1",
            "course_name": "PHYSICS 5C",
            "mode": "full",
            "status": "running",
            "active_step": 2,
            "created_at": 1234567890.0,
            "events": [{"type": "step", "step": 1}]
        }
        status, _, body = asyncio.run(asgi_request('/api/launcher/status/test_job_1'))
        self.assertEqual(status, 200)
        data = json.loads(body.decode())
        self.assertEqual(data["course_name"], "PHYSICS 5C")
        self.assertEqual(data["status"], "running")
        self.assertEqual(data["active_step"], 2)
        self.assertEqual(data["total_events"], 1)

    def test_launcher_cancel(self):
        # Non-existent job cancel
        status, _, _ = asyncio.run(asgi_request('/api/launcher/cancel/invalid_id', method='POST'))
        self.assertEqual(status, 404)

        # Cancel running job
        server._launcher_jobs["job_to_cancel"] = {
            "job_id": "job_to_cancel",
            "course_name": "CHEM 14D",
            "mode": "full",
            "status": "running",
            "active_step": 1,
            "events": [],
            "subscribers": set(),
            "process": None
        }
        status, _, body = asyncio.run(asgi_request('/api/launcher/cancel/job_to_cancel', method='POST'))
        self.assertEqual(status, 200)
        job = server._launcher_jobs["job_to_cancel"]
        self.assertEqual(job["status"], "cancelled")
        self.assertTrue(job["cancelled"])
        # Check cancellation events were broadcast
        event_types = [e["type"] for e in job["events"]]
        self.assertIn("error", event_types)

    def test_launcher_stream_sse_and_replay(self):
        # Non-existent stream
        status, _, _ = asyncio.run(asgi_request('/api/launcher/stream/invalid_stream_id'))
        self.assertEqual(status, 404)

        # Job with pre-existing events and completed status
        server._launcher_jobs["stream_job"] = {
            "job_id": "stream_job",
            "course_name": "MATH 33A",
            "status": "done",
            "events": [
                {"type": "step", "step": 1},
                {"type": "log", "message": "Downloading slides...", "level": "download"},
                {"type": "done", "success": True, "course_name": "MATH 33A", "files_count": 10}
            ],
            "subscribers": set()
        }

        status, headers, body = asyncio.run(asgi_request('/api/launcher/stream/stream_job'))
        self.assertEqual(status, 200)
        text = body.decode()
        self.assertIn("data: ", text)
        self.assertIn('"type": "step"', text)
        self.assertIn('"type": "done"', text)
        self.assertIn('"files_count": 10', text)

    def test_launcher_daemon_mock_pipeline_execution(self):
        async def mock_runner(job, req):
            server._broadcast_launcher_event(job, {"type": "step", "step": 1})
            server._broadcast_launcher_event(job, {"type": "log", "message": "Testing step 1", "level": "info"})
            server._broadcast_launcher_event(job, {"type": "step", "step": 2})
            server._broadcast_launcher_event(job, {"type": "log", "message": "Testing step 2", "level": "download"})
            server._broadcast_launcher_event(job, {"type": "done", "success": True, "course_name": job["course_name"], "files_count": 15})
            job["status"] = "done"

        server._TEST_LAUNCHER_RUNNER = mock_runner

        status, _, body = asyncio.run(asgi_request('/api/launcher/start', method='POST', body={
            "course_url": "https://canvas.ucla.edu/courses/99999",
            "course_name": "TEST 101",
            "ai_provider": "gemini",
            "mode": "full"
        }))
        self.assertEqual(status, 200)
        data = json.loads(body.decode())
        job_id = data["job_id"]

        # Wait a moment for background task
        async def wait_done():
            for _ in range(20):
                job = server._launcher_jobs.get(job_id)
                if job and job.get("status") == "done":
                    return job
                await asyncio.sleep(0.05)
            return server._launcher_jobs.get(job_id)

        job = asyncio.run(wait_done())
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["course_name"], "TEST 101")
        types = [e["type"] for e in job["events"]]
        self.assertIn("step", types)
        self.assertIn("done", types)

    def test_launcher_daemon_venv_python_resolution(self):
        import sys
        req = server.LauncherStartRequest(
            course_url="https://canvas.ucla.edu/courses/123",
            course_name="PHYSICS 5C",
            mode="full"
        )
        job = {
            "job_id": "test_venv_job",
            "course_name": req.course_name,
            "status": "pending",
            "events": [],
            "subscribers": set()
        }

        captured_args = []
        captured_env = {}

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
            captured_env.update(kwargs.get("env", {}))
            return DummyProc()

        with patch("canvas_app.server.terminate_pipeline_process", new=AsyncMock()), patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
            asyncio.run(server._run_launcher_daemon(job, req))

        self.assertTrue(len(captured_args) > 0)
        expected_venv = Path(server.__file__).resolve().parent.parent / "venv" / "bin" / "python"
        if expected_venv.exists():
            self.assertEqual(captured_args[0], str(expected_venv))
            self.assertIn("VIRTUAL_ENV", captured_env)
        else:
            self.assertIn(captured_args[0], [sys.executable, str(Path(server.__file__).resolve().parent.parent / ".venv" / "bin" / "python")])

    def test_launcher_does_not_accept_credentials(self):
        # [Codex] Saving keys uses the dedicated bounded endpoint only.
        async def runner(job, req):
            job['status'] = 'done'
        server._TEST_LAUNCHER_RUNNER = runner
        with patch.object(server, '_store_gemini_settings') as store:
            status, _, body = asyncio.run(asgi_request('/api/launcher/start', method='POST', body={
                'course_name': 'TEST 101', 'mode': 'organize_only', 'gemini_api_key': 'test-mock-key'}))  # pragma: allowlist secret -- synthetic test credential
        self.assertEqual(status, 200)
        self.assertNotIn(b'test-mock-key', body)
        store.assert_not_called()


    def test_launcher_categories_flag_forwarding(self):
        req = server.LauncherStartRequest(
            course_url="https://canvas.ucla.edu/courses/123",
            course_name="CHEM 14D",
            mode="full",
            categories=["modules", "FILES", " assignments ", "invalid_xyz"]
        )
        job = {
            "job_id": "test_cats_job",
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

        self.assertIn("--categories", captured_args)
        cat_idx = captured_args.index("--categories")
        self.assertEqual(captured_args[cat_idx + 1], "modules,files,assignments")

        # Test empty categories does not include --categories
        req_empty = server.LauncherStartRequest(
            course_url="https://canvas.ucla.edu/courses/123",
            course_name="CHEM 14D",
            mode="full",
            categories=[]
        )
        job_empty = {"job_id": "test_empty_cats", "course_name": req_empty.course_name, "status": "pending", "events": [], "subscribers": set()}
        captured_empty_args = []
        async def fake_exec_empty(*args, **kwargs):
            captured_empty_args.extend(args)
            return DummyProc()

        with patch("canvas_app.server.terminate_pipeline_process", new=AsyncMock()), patch("asyncio.create_subprocess_exec", side_effect=fake_exec_empty):
            asyncio.run(server._run_launcher_daemon(job_empty, req_empty))

        self.assertNotIn("--categories", captured_empty_args)

    def test_launcher_granular_step_progress_events(self):
        req = server.LauncherStartRequest(
            course_url="https://canvas.ucla.edu/courses/123",
            course_name="CHEM 14D",
            mode="full"
        )
        job = {
            "job_id": "test_granular_job",
            "course_name": req.course_name,
            "status": "pending",
            "events": [],
            "subscribers": set()
        }

        stdout_lines = [
            b"Phase 1: Browser authentication initializing...\n",
            b"Active Shibboleth session detected. Login detected!\n",
            b"Phase 2: Category file downloads starting...\n",
            b"[5/10] Downloading: 'lecture_slides_5.pdf'\n",
            b"Phase 3: AI classification and sorting...\n",
            b"[2/4] Classifying: 'problem_set_1.pdf'\n",
        ]

        class DummyProc:
            def __init__(self):
                self._lines = list(stdout_lines)
            class DummyStdout:
                def __init__(self, lines):
                    self._lines = lines
                async def readline(self):
                    if self._lines:
                        return self._lines.pop(0)
                    return b""
            @property
            def stdout(self):
                return DummyProc.DummyStdout(self._lines)
            returncode = 0
            async def wait(self):
                return 0

        async def fake_exec(*args, **kwargs):
            return DummyProc()

        mock_engine = unittest.mock.MagicMock()
        with tempfile.TemporaryDirectory() as directory:
            course = Path(directory) / req.course_name
            course.mkdir()
            req.output_dir = directory
            with patch("canvas_app.server.terminate_pipeline_process", new=AsyncMock()), \
                 patch("asyncio.create_subprocess_exec", side_effect=fake_exec), \
                 patch("canvas_app.server.discover_courses", return_value={}), \
                 patch.object(server.CourseBlueprint, "hydrate_from_canvas_api"), \
                 patch("canvas_app.server.get_search_engine", return_value=mock_engine):
                asyncio.run(server._run_launcher_daemon(job, req))

        step_events = [e for e in job["events"] if e.get("type") == "step"]
        self.assertTrue(len(step_events) >= 5)

        # 1. Initial Step 1
        first_step = step_events[0]
        self.assertEqual(first_step["step"], 1)
        self.assertEqual(first_step["pct"], 10)
        self.assertEqual(first_step["phase_title"], "Authentication & Session")

        # 2. Login detected Step 1 (pct: 20)
        login_step = next((e for e in step_events if e["step"] == 1 and e.get("pct") == 20), None)
        self.assertIsNotNone(login_step)

        # 3. Step 2 start (pct: 25)
        step2_start = next((e for e in step_events if e["step"] == 2 and e.get("pct") == 25), None)
        self.assertIsNotNone(step2_start)
        self.assertEqual(step2_start["phase_title"], "Category Scraping & Downloads")

        # 4. Download progress (cur=5, total=10 => pct = 25 + int(0.5 * 25) = 37)
        dl_step = next((e for e in step_events if e["step"] == 2 and e.get("pct") == 37), None)
        self.assertIsNotNone(dl_step)
        self.assertIn("Downloading (5/10)", dl_step["message"])

        # 5. Step 3 start (pct: 52)
        step3_start = next((e for e in step_events if e["step"] == 3 and e.get("pct") == 52), None)
        self.assertIsNotNone(step3_start)
        self.assertEqual(step3_start["phase_title"], "AI Classification & Sorting")

        # 6. Classification progress (cur=2, total=4 => pct = 52 + int(0.5 * 22) = 63)
        cls_step = next((e for e in step_events if e["step"] == 3 and e.get("pct") == 63), None)
        self.assertIsNotNone(cls_step)
        self.assertIn("Classifying (2/4)", cls_step["message"])

        # 7. Step 4 (pct: 78)
        step4 = next((e for e in step_events if e["step"] == 4), None)
        self.assertIsNotNone(step4)
        self.assertEqual(step4["pct"], 78)
        self.assertEqual(step4["phase_title"], "Course Blueprint & Timeline")

        # 8. Step 5 (pct: 88 and 100)
        step5_start = next((e for e in step_events if e["step"] == 5 and e.get("pct") == 88), None)
        self.assertIsNotNone(step5_start)
        step5_done = next((e for e in step_events if e["step"] == 5 and e.get("pct") == 100), None)
        self.assertIsNotNone(step5_done)

        # 9. Done event
        done_event = next((e for e in job["events"] if e.get("type") == "done"), None)
        self.assertIsNotNone(done_event)
        self.assertTrue(done_event["success"])

    def test_launcher_auto_resolve_course_url_from_blueprint(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            course_dir = Path(td) / "PSYCH 100B"
            course_dir.mkdir()
            bp_file = course_dir / "canvas_course.json"
            bp_file.write_text(json.dumps({
                "course_name": "PSYCH 100B",
                "course_url": "https://bruinlearn.ucla.edu/courses/232169"
            }))

            async def dummy_runner(job, req):
                job["status"] = "done"
            server._TEST_LAUNCHER_RUNNER = dummy_runner

            mock_discovered = {
                "PSYCH 100B": {"path": str(course_dir), "blueprint_path": str(bp_file)}
            }
            with patch("canvas_app.server.discover_courses", return_value=mock_discovered):
                # 1. Full mode with empty course_url auto-resolves from blueprint
                status, _, body = asyncio.run(asgi_request('/api/launcher/start', method='POST', body={
                    "course_name": "PSYCH 100B",
                    "course_url": "",
                    "mode": "full",
                    "categories": ["announcements"]
                }))
                self.assertEqual(status, 200)
                data = json.loads(body.decode())
                self.assertEqual(data["status"], "started")
                job = server._launcher_jobs[data["job_id"]]
                self.assertEqual(job["course_name"], "PSYCH 100B")

                # 2. Unknown course without course_url still raises 400
                status, _, _ = asyncio.run(asgi_request('/api/launcher/start', method='POST', body={
                    "course_name": "UNKNOWN_COURSE_XYZ",
                    "course_url": "",
                    "mode": "full"
                }))
                self.assertEqual(status, 400)

    def test_launcher_non_full_modes_step_alignment(self):
        # 1. Test organize_only mode starts directly at Step 3 (pct: 50)
        req_org = server.LauncherStartRequest(
            course_name="CHEM 14D",
            mode="organize_only"
        )
        job_org = {
            "job_id": "test_org_mode",
            "course_name": req_org.course_name,
            "status": "pending",
            "events": [],
            "subscribers": set()
        }

        class DummyProc:
            class DummyStdout:
                async def readline(self):
                    return b""
            stdout = DummyStdout()
            returncode = 0
            async def wait(self):
                return 0

        async def fake_exec(*args, **kwargs):
            return DummyProc()

        mock_engine = unittest.mock.MagicMock()
        with patch("canvas_app.server.terminate_pipeline_process", new=AsyncMock()), patch("asyncio.create_subprocess_exec", side_effect=fake_exec), \
             patch("canvas_app.server.get_search_engine", return_value=mock_engine):
            asyncio.run(server._run_launcher_daemon(job_org, req_org))

        step_events_org = [e for e in job_org["events"] if e.get("type") == "step"]
        first_org_step = step_events_org[0]
        self.assertEqual(first_org_step["step"], 3)
        self.assertEqual(first_org_step["pct"], 50)
        self.assertEqual(first_org_step["phase_title"], "AI Classification & Sorting")

        # 2. Test gradescope_only mode starts directly at Step 2 (pct: 35)
        req_gs = server.LauncherStartRequest(
            course_name="CHEM 14D",
            mode="gradescope_only"
        )
        job_gs = {
            "job_id": "test_gs_mode",
            "course_name": req_gs.course_name,
            "status": "pending",
            "events": [],
            "subscribers": set()
        }
        with patch("canvas_app.server.terminate_pipeline_process", new=AsyncMock()), patch("asyncio.create_subprocess_exec", side_effect=fake_exec), \
             patch("canvas_app.server.get_search_engine", return_value=mock_engine):
            asyncio.run(server._run_launcher_daemon(job_gs, req_gs))

        step_events_gs = [e for e in job_gs["events"] if e.get("type") == "step"]
        first_gs_step = step_events_gs[0]
        self.assertEqual(first_gs_step["step"], 2)
        self.assertEqual(first_gs_step["pct"], 35)
        self.assertEqual(first_gs_step["phase_title"], "Gradescope Synchronization")

    def test_launcher_blueprint_refresh_after_reclassification(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            course_dir = Path(td) / "CS 31"
            course_dir.mkdir()
            subfolder = course_dir / "CS 31 Lectures & Resources" / "Lecture Slides"
            subfolder.mkdir(parents=True)
            new_slide = subfolder / "Week1_Intro.pdf"
            new_slide.write_text("dummy slide content")

            bp_file = course_dir / "canvas_course.json"
            bp_file.write_text(json.dumps({
                "course_name": "CS 31",
                "course_url": "https://canvas.ucla.edu/courses/31",
                "file_path_map": {}
            }))

            req = server.LauncherStartRequest(course_name="CS 31", mode="organize_only")
            job = {
                "job_id": "test_bp_refresh",
                "course_name": req.course_name,
                "status": "pending",
                "events": [],
                "subscribers": set()
            }

            class DummyProc:
                class DummyStdout:
                    async def readline(self):
                        return b""
                stdout = DummyStdout()
                returncode = 0
                async def wait(self):
                    return 0

            async def fake_exec(*args, **kwargs):
                return DummyProc()

            mock_discovered = {
                "CS 31": {"path": str(course_dir), "blueprint_path": str(bp_file)}
            }
            mock_engine = unittest.mock.MagicMock()
            with patch("canvas_app.server.terminate_pipeline_process", new=AsyncMock()), patch("asyncio.create_subprocess_exec", side_effect=fake_exec), \
                 patch("canvas_app.server.discover_courses", return_value=mock_discovered), \
                 patch("canvas_app.server.get_search_engine", return_value=mock_engine):
                server._catalog.expires = 9999999999
                asyncio.run(server._run_launcher_daemon(job, req))
                self.assertEqual(server._catalog.expires, 0)
                self.assertTrue(any(e.get("type") == "done" for e in job["events"]))
                self.assertFalse(any("100% offline index ready" in e.get("message", "") for e in job["events"]))

            refreshed_bp = json.loads(bp_file.read_text())
            self.assertIn("Week1_Intro.pdf", refreshed_bp["file_path_map"])
            self.assertIn("CS 31 Lectures & Resources/Lecture Slides/Week1_Intro.pdf", refreshed_bp["file_path_map"]["Week1_Intro.pdf"])


if __name__ == '__main__':
    unittest.main()


