"""[Codex] Explicit Gemini and local-provider classification choices; synthetic only."""
import tests
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'Canvas Module Downloader'
if str(SOURCE) not in sys.path:
    sys.path.insert(0, str(SOURCE))
import organizer


class CloudSelectionFollowupTests(unittest.TestCase):
    def classify(self, provider, *, private_reclassification=False, module_name='Work'):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            document = root / 'essay.txt'
            document.write_text('SYNTHETIC STUDENT COURSEWORK CONTENT', encoding='utf-8')
            config = {
                'llm_provider': provider,
                'gemini_api_key': 'dummy-test-credential',  # pragma: allowlist secret
                '_private_reclassification': private_reclassification,
                'ollama_model': 'synthetic-local-model',
            }
            # [Codex] Local classification now uses the constrained JSON contract.
            response = '{"category":2}' if provider == 'ollama' else '2'
            with patch.object(organizer, 'query_llm', return_value=response) as query, \
                 patch.object(organizer, 'check_and_reset_ollama_ram'), \
                 patch('llm_client.resolve_ollama_model', return_value='synthetic-local-model'):
                organizer.categorize_with_ai(str(document), 'Essay 1', directory, config,
                                             'TEST 101', [], module_name=module_name)
            self.assertEqual(query.call_count, 1)
            prompt, submitted_config = query.call_args.args[:2]
            self.assertIs(submitted_config, config)
            self.assertIn('SYNTHETIC STUDENT COURSEWORK CONTENT', prompt)
            # [Codex] Check target module data without coupling cloud/local
            # prompts to the same label typography.
            self.assertRegex(prompt, r'(?m)^\s*(?:-\s*)?(?:Canvas )?Module:\s*"?Work"?\s*$')
            if provider == 'ollama':
                self.assertTrue(query.call_args.kwargs['deterministic'])
                self.assertIn('category', query.call_args.kwargs['json_schema']['properties'])
            return submitted_config['llm_provider']

    def test_selected_gemini_classifies_submitted_coursework(self):
        self.assertEqual(self.classify('gemini'), 'gemini')

    def test_selected_gemini_classifies_previous_course_files(self):
        self.assertEqual(self.classify('gemini', private_reclassification=True), 'gemini')

    def test_selected_ollama_keeps_coursework_local(self):
        self.assertEqual(self.classify('ollama'), 'ollama')
