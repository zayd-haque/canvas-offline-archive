"""[Codex] Synthetic checks for the shared release installer."""

import tests

import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from release_updater import _asset_path, _install_archive, _tls_context


class ReleaseUpdaterTests(unittest.TestCase):
    def test_tls_uses_installed_certifi_bundle(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / ".venv" / "Lib" / "site-packages" / "certifi" / "cacert.pem"
            bundle.parent.mkdir(parents=True)
            bundle.write_text("test bundle")
            with patch("release_updater.os.name", "nt"), patch("release_updater.ssl.create_default_context") as create:
                _tls_context(root)
            create.assert_called_once_with(cafile=str(bundle))

    def test_install_preserves_private_data_and_replaces_app(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "canvas-offline-archive"
            (root / "Canvas Module Downloader").mkdir(parents=True)
            (root / "Canvas Module Downloader" / "config.json").write_text("private")
            (root / ".venv").mkdir()
            (root / ".venv" / "keep.txt").write_text("dependencies")
            (root / "canvas_app").mkdir()
            (root / "canvas_app" / "run.py").write_text("old")
            archive = Path(temporary) / "update.zip"
            files = {
                "requirements.txt": "locked",
                "release_updater.py": "updater",
                "bootstrap_windows.py": "bootstrap",
                "canvas_app/run.py": "new",
                "canvas_app/static/index.html": "<html></html>",
                "release_info.json": json.dumps({
                    "repository": "zayd-haque/canvas-offline-archive",
                    "platform": "windows", "tag": "v-test"}),
            }
            with zipfile.ZipFile(archive, "w") as zipped:
                for name, content in files.items():
                    zipped.writestr("canvas-offline-archive/" + name, content)
            _install_archive(root, archive, "windows", "v-test")
            self.assertEqual((root / "canvas_app" / "run.py").read_text(), "new")
            self.assertEqual((root / "Canvas Module Downloader" / "config.json").read_text(), "private")
            self.assertEqual((root / ".venv" / "keep.txt").read_text(), "dependencies")

    def test_rejects_traversal_and_private_config(self):
        for name in (
            "canvas-offline-archive/../private.txt",
            "canvas-offline-archive/.venv/keep.txt",
            "canvas-offline-archive/Canvas Module Downloader/config.json",
        ):
            with self.subTest(name=name), self.assertRaises(ValueError):
                _asset_path(name)


if __name__ == "__main__":
    unittest.main()
