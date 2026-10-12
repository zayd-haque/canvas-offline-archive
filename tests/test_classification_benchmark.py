"""[Codex] Corpus scoring distinguishes model agreement from gold accuracy."""
import tests
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from tests.organization_benchmark import organizer
import classification_benchmark as benchmark
from llm_client import ProviderError


class ClassificationBenchmarkTests(unittest.TestCase):
    def records(self):
        return [{'id': str(i), 'filename': 'hw1.pdf', 'content': '', 'expected': 'Homework Assignments'} for i in range(3)]

    def test_relative_gold_accuracy_is_not_agreement(self):
        records = self.records()
        records[0]['gemini_label'] = 'Homework Assignments'
        records[1]['gemini_label'] = 'Homework Assignments'
        records[2]['gemini_label'] = 'Lecture Slides'
        report = benchmark.measure(records, ['Homework Assignments', 'Lecture Slides', 'Homework Assignments'])
        self.assertAlmostEqual(report['accuracy'], 2/3)
        self.assertAlmostEqual(report['gemini_gold_accuracy'], 2/3)
        self.assertAlmostEqual(report['gemini_agreement'], 1/3)
        self.assertEqual(report['relative_gold_accuracy'], 1)

    def test_zero_gemini_correct_is_undefined_ratio(self):
        records = self.records()
        for record in records:
            record['gemini_label'] = 'Lecture Slides'
        report = benchmark.measure(records, ['Homework Assignments'] * 3)
        self.assertIsNone(report['relative_gold_accuracy'])
        self.assertEqual(report['gemini_gold_accuracy'], 0)

    def test_provider_failure_is_scored_and_recorded(self):
        with patch.object(organizer, 'load_config', side_effect=AssertionError('Personal config access forbidden')), \
                patch.object(organizer, 'categorize_with_ai', side_effect=ProviderError('synthetic failure')):
            report = benchmark.evaluate(self.records(), 'ollama', 'installed-synthetic-model')
        self.assertEqual(report['failures'], 3)
        self.assertEqual(report['accuracy'], 0)
        self.assertTrue(all(row['prediction'] is None and row['error'] == 'provider_failure' for row in report['results']))

    def test_cli_validation_and_default_local_rules(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'corpus.jsonl'
            path.write_text('\n'.join(json.dumps(record) for record in self.records()), encoding='utf-8')
            with patch.object(organizer, 'query_llm') as model, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(benchmark.main([str(path)]), 0)
                self.assertEqual(benchmark.main([str(path), '--require-gemini-parity']), 2)
                self.assertEqual(benchmark.main([str(path), '--provider', 'ollama']), 2)
                model.assert_not_called()

    def test_local_providers_never_require_or_inherit_personal_config(self):
        for provider in ('rules', 'ollama'):
            with self.subTest(provider=provider), \
                    patch.object(organizer, 'load_config', side_effect=FileNotFoundError('Missing local config')) as load, \
                    patch.object(organizer, 'classify_document', return_value='Homework Assignments') as rules, \
                    patch.object(organizer, 'categorize_with_ai', return_value='Homework Assignments') as model:
                report = benchmark.evaluate(self.records(), provider, 'installed-synthetic-model' if provider == 'ollama' else None)
                self.assertEqual(report['failures'], 0)
                self.assertEqual(report['accuracy'], 1)
                load.assert_not_called()
                config = rules.call_args.args[-1] if provider == 'rules' else model.call_args.args[3]
                self.assertEqual(config['llm_provider'], provider)
                self.assertNotIn('disk_hierarchy', config)
                self.assertNotIn('file_classification_rules', config)

    def test_duplicate_ids_and_invalid_content_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'corpus.jsonl'
            for records in ([dict(self.records()[0]), dict(self.records()[0])],
                            [dict(self.records()[0], content={'invalid': True})]):
                path.write_text('\n'.join(json.dumps(record) for record in records), encoding='utf-8')
                with self.assertRaises(ValueError):
                    benchmark.load_records(path)

    def test_oversized_line_is_rejected_before_json_parsing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'oversized.jsonl'
            path.write_text(' ' * 100001, encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'line size limit'):
                benchmark.load_records(path)

    def test_course_term_is_forwarded_to_each_provider(self):
        record = dict(self.records()[0], course_term='Fall 2026')
        with patch.object(organizer, 'classify_document', return_value='Homework Assignments') as classify:
            benchmark.evaluate([record], 'rules')
        self.assertEqual(classify.call_args.args[-1]['course_term'], 'Fall 2026')
        with patch.object(organizer, 'categorize_with_ai', return_value='Homework Assignments') as classify:
            benchmark.evaluate([record], 'ollama', 'installed-synthetic-model')
        self.assertEqual(classify.call_args.args[3]['course_term'], 'Fall 2026')
