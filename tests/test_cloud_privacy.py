"""[Codex] Synthetic personal-data reduction at the shared Gemini boundary."""
import tests
import contextlib
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

SOURCE = Path(__file__).resolve().parents[1] / 'Canvas Module Downloader'
if str(SOURCE) not in sys.path:
    sys.path.insert(0, str(SOURCE))
import llm_client
from cloud_privacy import redact_cloud_text


class CloudPrivacyTests(unittest.TestCase):
    def setUp(self):
        # [Codex] Never read saved credentials, including for local-provider calls.
        key_lookup = patch.object(llm_client, 'get_gemini_api_key', return_value='synthetic-provider-key')
        key_lookup.start()
        self.addCleanup(key_lookup.stop)

    def test_identifiers_and_labelled_records_are_removed(self):
        examples = [
            ('Email: student@example.invalid', 'student@example.invalid'),
            ('Phone: (310) 555-0123', '555-0123'),
            ('SSN: 123-45-6789', '123-45-6789'),
            ('Student ID: 123456789', '123456789'),
            ('Student name: Alex Example', 'Alex Example'),
            ('Grade: 88/100', '88/100'),
            ('Local path: /Users/alex/Desktop/History/essay.pdf', '/Users/alex'),
            (r'Local path: C:\Users\Alex\Desktop\History\essay.pdf', r'C:\Users\Alex'),
            ('https://alex:password@example.invalid/doc?token=abc-secret', 'password'),
            ('API key: synthetic-secret-value', 'synthetic-secret-value'),
        ]
        for raw, identifier in examples:
            with self.subTest(kind=raw.split(':')[0]):
                cleaned = redact_cloud_text(raw)
                self.assertNotIn(identifier, cleaned)
                self.assertIsInstance(cleaned, str)

    def test_academic_numbers_and_questions_survive(self):
        academic = 'CHEM 14D Homework 5\nWhat is the pH of 0.10 M HCl?\nE = mc^2; x = 3.14; score function f(x)=2*x\nLecture 12: SN1 and SN2 mechanisms.\nExam review: 80 practice questions, 100 points total.'
        self.assertEqual(redact_cloud_text(academic), academic)

    def test_academic_labelled_score_formula_survives(self):
        academic = "Score = f(x)\nGrade = classification(x)\nHomework 2: What is 0.10 M HCl?"
        self.assertEqual(redact_cloud_text(academic), academic)
        self.assertNotIn("88/100", redact_cloud_text("Student grade: 88/100"))
        self.assertNotIn("92%", redact_cloud_text("Score: 92%"))

    def test_active_credential_is_redacted_even_without_label(self):
        response = Mock(status_code=200)
        response.json.return_value = {"candidates": [{"content": {"parts": [{"text": "2"}]}}]}
        prompt = "Accidental footer synthetic-provider-key\nLecture 4: What is pH?"
        with patch.object(llm_client, "_wait_gemini_slot"), patch.object(llm_client._session, "post", return_value=response) as post:
            self.assertEqual(llm_client.query_llm(prompt, {"llm_provider": "gemini"}), "2")
        outbound = post.call_args.kwargs["json"]["contents"][0]["parts"][0]["text"]
        self.assertNotIn("synthetic-provider-key", outbound)
        self.assertIn("Lecture 4: What is pH?", outbound)
        self.assertEqual(post.call_args.kwargs["headers"]["x-goog-api-key"], "synthetic-provider-key")

    def test_redaction_is_idempotent(self):
        raw = 'Student name: Alex Example\nEmail: student@example.invalid\nHomework 4: calculate 0.25 mol?'
        once = redact_cloud_text(raw)
        self.assertEqual(redact_cloud_text(once), once)
        self.assertIn('Homework 4: calculate 0.25 mol?', once)

    def test_shared_gemini_query_redacts_every_request(self):
        response = Mock(status_code=200)
        response.json.return_value = {'candidates': [{'content': {'parts': [{'text': '2'}]}}]}
        config = {'llm_provider': 'gemini', 'gemini_api_key': 'synthetic-provider-key'}  # pragma: allowlist secret
        prompt = 'Student name: Alex Example\nstudent@example.invalid\nHomework 2: What is 0.5 M?'
        with patch.object(llm_client, '_wait_gemini_slot'), patch.object(llm_client._session, 'post', return_value=response) as post:
            for as_json in (False, True):
                self.assertEqual(llm_client.query_llm(prompt, config, as_json=as_json), '2')
        self.assertEqual(post.call_count, 2)
        for call in post.call_args_list:
            outbound = call.kwargs['json']['contents'][0]['parts'][0]['text']
            self.assertNotIn('Alex Example', outbound)
            self.assertNotIn('student@example.invalid', outbound)
            self.assertIn('Homework 2: What is 0.5 M?', outbound)
            self.assertEqual(call.kwargs['headers']['x-goog-api-key'], 'synthetic-provider-key')

    def test_gemini_retries_use_only_redacted_payloads(self):
        rejected = Mock(status_code=503)
        rejected.json.return_value = {"error": {"status": "UNAVAILABLE"}}
        accepted = Mock(status_code=200)
        accepted.json.return_value = {"candidates": [{"content": {"parts": [{"text": "2"}]}}]}
        prompt = "Email: student@example.invalid\nHomework 3: calculate pH?"
        with patch.object(llm_client, "_wait_gemini_slot"), patch.object(llm_client.time, "sleep"), patch.object(llm_client._session, "post", side_effect=[rejected, accepted]) as post, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(llm_client.query_llm(prompt, {"llm_provider": "gemini"}), "2")
        self.assertEqual(post.call_count, 2)
        for call in post.call_args_list:
            outbound = call.kwargs["json"]["contents"][0]["parts"][0]["text"]
            self.assertNotIn("student@example.invalid", outbound)
            self.assertIn("Homework 3: calculate pH?", outbound)

    def test_gemini_failure_does_not_log_personal_text_or_response(self):
        response = Mock(status_code=403)
        response.json.return_value = {'error': {'status': 'student@example.invalid', 'message': 'Alex Example'}}
        stream = io.StringIO()
        with patch.object(llm_client, '_wait_gemini_slot'), patch.object(llm_client._session, 'post', return_value=response), contextlib.redirect_stdout(stream):
            with self.assertRaises(llm_client.ProviderError) as error:
                llm_client.query_llm('Student name: Alex Example\nstudent@example.invalid', {'llm_provider': 'gemini', 'gemini_api_key': 'synthetic-provider-key'})  # pragma: allowlist secret
        combined = stream.getvalue() + str(error.exception)
        self.assertNotIn('Alex Example', combined)
        self.assertNotIn('student@example.invalid', combined)
        self.assertNotIn('synthetic-provider-key', combined)

    def test_local_ollama_keeps_original_prompt(self):
        prompt = 'Student name: Alex Example\nstudent@example.invalid\nHomework 2?'
        response = Mock(status_code=200)
        response.json.return_value = {'response': '2'}
        with patch.object(llm_client, 'is_ollama_online', return_value=True), patch.object(llm_client, 'resolve_ollama_model', return_value='synthetic-model'), patch.object(llm_client._session, 'post', return_value=response) as post:
            self.assertEqual(llm_client.query_llm(prompt, {'llm_provider': 'ollama'}), '2')
        self.assertEqual(post.call_args.kwargs['json']['prompt'], prompt)

    def test_rules_provider_never_posts(self):
        with patch.object(llm_client._session, 'post') as post:
            self.assertEqual(llm_client.query_llm('student@example.invalid', {'llm_provider': 'rules'}), '')
        post.assert_not_called()
