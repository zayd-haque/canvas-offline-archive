"""[Codex] Published tags must match both platform package identities."""
import tests
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from tools.validate_release_assets import validate_package


class ReleaseAssetMetadataTests(unittest.TestCase):
    def package(self, root, platform='windows', tag='v1.0.7', repository='zayd-haque/canvas-offline-archive'):
        path = root / 'test.zip'
        with zipfile.ZipFile(path, 'w') as archive:
            for name in ('requirements.txt', 'release_updater.py', 'canvas_app/run.py',
                         'canvas_app/static/index.html', 'bootstrap_windows.py', 'bootstrap.sh'):
                archive.writestr('canvas-offline-archive/' + name, '')
            archive.writestr('canvas-offline-archive/release_info.json', json.dumps({
                'platform': platform, 'tag': tag, 'repository': repository}))
        return path

    def test_both_platform_identities_match_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            for platform in ('windows', 'macos'):
                path = self.package(Path(temporary), platform=platform)
                self.assertEqual(validate_package(path, platform, 'v1.0.7')['tag'], 'v1.0.7')

    def test_stale_tag_wrong_platform_and_wrong_repository_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            for kwargs in ({'tag': 'v1.0.6'}, {'platform': 'macos'}, {'repository': 'old-owner/archive'}):
                with self.subTest(kwargs=kwargs):
                    path = self.package(Path(temporary), **kwargs)
                    with self.assertRaises(ValueError):
                        validate_package(path, 'windows', 'v1.0.7')

    def test_missing_publication_tag_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(ValueError):
                validate_package(self.package(Path(temporary)), 'windows', '')
