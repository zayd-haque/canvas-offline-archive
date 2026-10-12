"""[Codex] Synthetic role quality gates and isolated provider payload contracts."""
import tests
import unittest
import tempfile
import json
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch
from tests.organization_benchmark import evaluate, organizer
import llm_client


class OrganizationQualityTests(unittest.TestCase):
    def test_synthetic_tuning_accuracy(self):
        report = evaluate(organizer.classify_document, 'tune')
        self.assertGreaterEqual(report['accuracy'], .9, report['failures'])

    def test_synthetic_heldout_accuracy(self):
        report = evaluate(organizer.classify_document, 'heldout')
        self.assertGreaterEqual(report['accuracy'], .9, report['failures'])

    def test_custom_folder_type_tags(self):
        config = {'disk_hierarchy': {'custom_folders': [
            {'id': 'a', 'name': 'Instructor Decks', 'types': ['slides', 'lectures']},
            {'id': 'b', 'name': 'Exercises', 'types': ['homework', 'assignments']},
            {'id': 'c', 'name': 'Worked Examples', 'types': ['solutions']},
            {'id': 'd', 'name': 'Policies', 'types': ['admin', 'syllabus']},
            {'id': 'e', 'name': 'Miscellaneous', 'types': ['other']},
        ]}}
        for filename, expected in [('HW03.pdf', 'Exercises'), ('HW03_solutions.pdf', 'Worked Examples'),
                                   ('Lecture09.pptx', 'Instructor Decks'), ('syllabus.pdf', 'Policies')]:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', '', '', config), expected)

    def test_rules_provider_never_invokes_model_for_unknown_material(self):
        for config in ({'llm_provider': 'rules'}, {'llm_provider': 'gemini', 'use_rule_engine': True}):
            with self.subTest(config=config), patch.object(organizer, 'query_llm') as model:
                folder = organizer.categorize_with_ai('/nonexistent/campus_map.pdf', '', '/nonexistent',
                                                     config, 'SYNTHETIC 101', [], '')
                self.assertEqual(folder, organizer.DEFAULT_FOLDER)
                model.assert_not_called()

    def test_explicit_course_term_distinguishes_current_and_past(self):
        config = {'course_term': 'Fall 2026'}
        for filename, expected in [('midterm_Fall_2026.pdf', 'Exams And Quizzes/Current Exams'),
                                   ('midterm_Spring_2026.pdf', 'Exams And Quizzes/Practice Exams'),
                                   ('midterm_Fall_2025_key.pdf', 'Exams And Quizzes/Practice Exams/Practice Exam Solutions')]:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', '', '', config), expected)

    def test_custom_keyword_override_precedes_default_role(self):
        config = {'category_rules': [{'keywords': ['studio portfolio'], 'folder': 'Portfolio'}],
                  'disk_hierarchy': {'custom_folders': [{'id': 'portfolio', 'name': 'Portfolio', 'types': ['other']},
                                                        {'id': 'slides', 'name': 'Lecture Slides', 'types': ['slides']}]}}
        self.assertEqual(organizer.classify_document('studio_portfolio_lecture.pdf', '', '', '', config), 'Portfolio')

    def test_marking_guide_is_solution_document(self):
        self.assertEqual(organizer.classify_document('problem_set_5_marking_guide.pdf', '', '',
                         'Homework 5 marking guide\nWorked solutions.', {}), 'Homework Solutions')

    def test_topic_terms_do_not_change_document_role(self):
        for filename, content in [('lecture_solution_chemistry.pdf', 'Lecture notes\nSolution chemistry and concentration.'),
                                  ('lecture_key_terms.pdf', 'Lecture notes\nKey terms in linguistics.')]:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', '', content, {}), 'Lecture Slides')
        self.assertEqual(organizer.classify_document('final_project.pdf', '', '',
                         'Final project assignment\nSubmit a code repository and report.', {}), 'Homework Assignments')

    def test_fresh_synthetic_challenge_accuracy(self):
        from tests.organization_challenge import evaluate_challenge
        report = evaluate_challenge(organizer.classify_document)
        self.assertGreaterEqual(report['accuracy'], .9, report['failures'])

    def test_office_document_content_drives_rules_without_model(self):
        with tempfile.TemporaryDirectory() as directory:
            cases = [('.docx', 'word/document.xml',
                      '<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>Homework 16</w:t></w:r></w:p>'
                      '<w:p><w:r><w:t>Submit your analysis.</w:t></w:r></w:p></w:body></w:document>', 'Homework Assignments'),
                     ('.pptx', 'ppt/slides/slide1.xml',
                      '<p:sld xmlns:p="urn:test" xmlns:a="urn:text"><a:p><a:r><a:t>Discussion slides</a:t></a:r></a:p>'
                      '<a:p><a:r><a:t>Section review.</a:t></a:r></a:p></p:sld>', 'Discussion Slides')]
            for extension, member, xml, expected in cases:
                with self.subTest(extension=extension):
                    path = Path(directory) / ('download' + extension)
                    with zipfile.ZipFile(path, 'w') as archive:
                        archive.writestr(member, xml)
                    with patch.object(organizer, 'query_llm') as model:
                        self.assertEqual(organizer.categorize_with_ai(str(path), '', directory,
                                         {'llm_provider': 'rules'}, 'SYNTHETIC 101', [], ''), expected)
                        model.assert_not_called()

    def test_office_entity_documents_are_rejected(self):
        xml = '<?xml version="1.0"?><!DOCTYPE doc [<!ENTITY injected "Homework answer key">]><doc><p><t>&injected;</t></p></doc>'
        with tempfile.TemporaryDirectory() as directory:
            for encoding in ('utf-8', 'utf-16'):
                with self.subTest(encoding=encoding):
                    path = Path(directory) / (encoding + '.docx')
                    with zipfile.ZipFile(path, 'w') as archive:
                        archive.writestr('word/document.xml', xml.encode(encoding))
                    self.assertEqual(organizer.extract_file_text(str(path)), '')

    def test_blueprint_term_roundtrip_preserves_exam_context(self):
        from canvas_blueprint import CourseBlueprint
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'canvas_course.json'
            blueprint = CourseBlueprint('SYNTHETIC 101', '', directory)
            blueprint.term = 'Fall 2026'
            path.write_text(json.dumps(blueprint.to_dict()), encoding='utf-8')
            restored = CourseBlueprint.load(str(path))
            self.assertEqual(restored.term, 'Fall 2026')
            self.assertEqual(restored.to_dict()['term'], 'Fall 2026')
            self.assertEqual(organizer.classify_document('exam_Spring_2026.pdf', '', '', '',
                             {'course_term': restored.term}), 'Exams And Quizzes/Practice Exams')
            for invalid in (123, None, {'season': 'Fall'}):
                path.write_text(json.dumps(dict(blueprint.to_dict(), term=invalid)), encoding='utf-8')
                restored = CourseBlueprint.load(str(path))
                self.assertFalse(hasattr(restored, 'term'))

    def test_empty_input_uses_other(self):
        self.assertEqual(organizer.classify_document('', '', '', '', {}), organizer.DEFAULT_FOLDER)


class OllamaClassificationPayloadTests(unittest.TestCase):
    def ollama_call(self, **options):
        response = Mock(status_code=200)
        response.json.return_value = {'response': '{"category":2}'}
        with patch.object(llm_client, 'is_ollama_online', return_value=True), \
             patch.object(llm_client, 'resolve_ollama_model', return_value='synthetic-model'), \
             patch.object(llm_client._session, 'post', return_value=response) as post:
            llm_client.query_llm('synthetic classification', {'llm_provider': 'ollama'}, **options)
            return post.call_args.kwargs['json']

    def test_structured_deterministic_classification(self):
        schema = {'type': 'object', 'properties': {'category': {'type': 'integer', 'enum': [1, 2]}}, 'required': ['category']}
        payload = self.ollama_call(json_schema=schema, deterministic=True)
        self.assertEqual(payload['format'], schema)
        self.assertEqual(payload['options']['temperature'], 0)
        self.assertEqual(payload['options']['top_p'], 1)
        self.assertEqual(payload['options']['seed'], 0)
        self.assertEqual(payload['options']['num_predict'], 128)

    def test_general_call_preserves_sampling(self):
        payload = self.ollama_call()
        self.assertNotIn('format', payload)
        self.assertEqual(payload['options']['temperature'], .1)
        self.assertEqual(payload['options']['top_p'], .9)
        self.assertNotIn('seed', payload['options'])
        self.assertNotIn('num_predict', payload['options'])

    def test_invalid_ollama_classification_never_falls_back(self):
        for response in ('not JSON', '[]', '{"category":true}', '{"category":999}', '{"category":"2"}'):
            events = []
            def hint(*args, **kwargs):
                events.append('hint')
                return 'Lecture Slides'
            def inference(*args, **kwargs):
                events.append('model')
                return response
            with self.subTest(response=response), patch.object(organizer, 'check_and_reset_ollama_ram'), \
                 patch.object(organizer, 'query_llm', side_effect=inference) as model, \
                 patch.object(organizer, 'classify_document', side_effect=hint) as candidate:
                with self.assertRaises(llm_client.ProviderError):
                    organizer.categorize_with_ai('/nonexistent/download.pdf', '', '/nonexistent',
                                                {'llm_provider': 'ollama'}, 'SYNTHETIC 101', [], '',
                                                extracted_content='Lecture slides')
                self.assertEqual(model.call_count, 1)
                candidate.assert_called_once()
                self.assertEqual(events, ['hint', 'model'])

    def test_invalid_gemini_classification_never_falls_back(self):
        # [Codex] Selected cloud inference must fail rather than count a rules
        # classification as a successful Gemini result. No real credentials.
        for response in ('not a category', '', '0', '999'):
            with self.subTest(response=response), \
                    patch.object(llm_client, 'get_gemini_api_key', return_value='synthetic-test-only'), \
                    patch.object(organizer, 'query_llm', return_value=response) as model, \
                    patch.object(organizer, 'classify_document', side_effect=AssertionError('Rules fallback forbidden')) as rules, \
                    patch.object(organizer, 'categorize_by_keywords', side_effect=AssertionError('Keyword fallback forbidden')) as legacy:
                with self.assertRaisesRegex(llm_client.ProviderError, 'No fallback was attempted'):
                    organizer.categorize_with_ai('/nonexistent/document.pdf', '', '/nonexistent',
                                                {'llm_provider': 'gemini', 'disk_hierarchy': {'custom_folders': [
                                                    {'name': 'Reading Room', 'types': ['lectures'], 'parent': 'study_materials'},
                                                    {'name': 'Loose Leaves', 'types': ['other'], 'parent': 'study_materials'}]}},
                                                'SYNTHETIC', [], '',
                                                extracted_content='Instructional reading')
                model.assert_called_once()
                rules.assert_not_called()
                legacy.assert_not_called()

    def test_ollama_model_can_reject_the_heuristic_candidate(self):
        events = []
        def hint(*args, **kwargs):
            events.append('hint')
            return 'Lecture Slides'
        def inference(*args, **kwargs):
            events.append('model')
            return '{"category":1}'
        with patch.object(organizer, 'check_and_reset_ollama_ram'), \
             patch('llm_client.resolve_ollama_model', return_value='synthetic-model'), \
             patch.object(organizer, 'classify_document', side_effect=hint) as candidate, \
             patch.object(organizer, 'query_llm', side_effect=inference) as model:
            result = organizer.categorize_with_ai('/nonexistent/lecture.pdf', '', '/nonexistent',
                     {'llm_provider': 'ollama'}, 'SYNTHETIC 101', [], '', extracted_content='Lecture slides')
        self.assertEqual(result, 'Syllabus And Admin')
        self.assertEqual(events, ['hint', 'model'])
        candidate.assert_called_once()
        model.assert_called_once()
        self.assertIn('Lecture Slides', model.call_args.args[0])

    def test_ollama_provider_failure_after_hint_propagates_without_fallback(self):
        events = []
        def hint(*args, **kwargs):
            events.append('hint')
            return 'Lecture Slides'
        def inference(*args, **kwargs):
            events.append('model')
            raise llm_client.ProviderError('Synthetic local service failure')
        with patch.object(organizer, 'check_and_reset_ollama_ram'), \
             patch.object(organizer, 'classify_document', side_effect=hint) as candidate, \
             patch.object(organizer, 'query_llm', side_effect=inference) as model:
            with self.assertRaisesRegex(llm_client.ProviderError, 'Synthetic local service failure'):
                organizer.categorize_with_ai('/nonexistent/lecture.pdf', '', '/nonexistent',
                     {'llm_provider': 'ollama'}, 'SYNTHETIC 101', [], '', extracted_content='Lecture slides')
        self.assertEqual(events, ['hint', 'model'])
        candidate.assert_called_once()
        model.assert_called_once()

    def test_gemini_optional_flags_do_not_change_payload(self):
        response = Mock(status_code=200)
        response.json.return_value = {'candidates': [{'content': {'parts': [{'text': '2'}]}}]}
        with patch.object(llm_client, '_wait_gemini_slot'), \
             patch.object(llm_client, 'is_ollama_online') as local, \
             patch.object(llm_client._session, 'post', return_value=response) as post:
            result = llm_client.query_llm('synthetic classification', {'llm_provider': 'gemini', 'gemini_api_key': 'test-mock-key'},  # pragma: allowlist secret
                                          json_schema={'type': 'object'}, deterministic=True)
        self.assertEqual(result, '2')
        self.assertEqual(post.call_args.kwargs['json'], {'contents': [{'parts': [{'text': 'synthetic classification'}]}]})
        local.assert_not_called()

    def test_epub_document_content_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sample_book.epub'
            html = '<!DOCTYPE html><html><body><h1>Chapter 1</h1><p>Modern organic reaction mechanisms.</p></body></html>'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('OEBPS/chapter1.xhtml', html)
            extracted = organizer.extract_file_text(str(path))
            self.assertIn('Chapter 1', extracted)
            self.assertIn('Modern organic reaction mechanisms.', extracted)

    def test_academic_agreements_vs_personal_forms(self):
        cases = [
            ('lab_safety_agreement.pdf', 'Syllabus And Admin'),
            ('field_trip_waiver.pdf', 'Syllabus And Admin'),
            ('honor_code_pledge.pdf', 'Syllabus And Admin'),
            ('tax_return.pdf', 'Other Materials'),
            ('lease_agreement.docx', 'Other Materials'),
            ('license_key.txt', 'Other Materials'),
        ]
        for filename, expected in cases:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', '', '', {}), expected)

    def test_keynote_format_is_not_answer_key(self):
        self.assertEqual(organizer.classify_document('discussion_presentation.key', '', '', '', {}),
                         'Discussion Slides')

    def test_review_slides_vs_exam_papers(self):
        cases = [
            ('Midterm_1_Review_Slides.pptx', '', '', 'Lecture Slides'),
            ('Final_Review_Presentation.key', '', '', 'Lecture Slides'),
            ('Discussion_Section_Midterm_Review_Slides.pdf', '', 'Discussion Section 1', 'Discussion Slides'),
            ('Midterm_1_Exam.pdf', '', '', 'Exams And Quizzes/Current Exams'),
            ('Practice_Final_Exam.pdf', '', '', 'Exams And Quizzes/Practice Exams'),
        ]
        for filename, content, module, expected in cases:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', module, content, {}), expected)

    def test_low_text_scanned_documents_in_modules(self):
        # Low text / scanned document relies on module context
        self.assertEqual(
            organizer.classify_document('Scan_001.pdf', '', 'Week 2 Discussion Worksheets', '1\n\n2\n', {}),
            'Discussion Worksheets'
        )
        # Substantial non-academic text is not hijacked by module name
        bus_content = 'Transit bus routes schedule for campus commuters. Regular weekday departures every 15 minutes.'
        self.assertEqual(
            organizer.classify_document('bus_schedule.pdf', '', 'Week 1 Course Material', bus_content, {}),
            'Other Materials'
        )

    def test_student_submissions_vs_instructor_keys(self):
        cases = [
            ('student_submission_hw3.pdf', 'Homework Assignments'),
            ('my_midterm_submission.pdf', 'Exams And Quizzes/Current Exams'),
            ('homework_3_solutions.pdf', 'Homework Solutions'),
        ]
        for filename, expected in cases:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', '', '', {}), expected)

    def test_stem_reference_materials(self):
        cases = [
            ('formula_sheet.pdf', 'Lecture Slides'),
            ('equation_sheet.pdf', 'Lecture Slides'),
            ('lab_manual_exp1.pdf', 'Lecture Slides'),
            ('reading_list.pdf', 'Lecture Slides'),
        ]
        for filename, expected in cases:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', '', '', {}), expected)

    def test_html_document_content_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'lesson_overview.html'
            html = '''<!DOCTYPE html><html><head><script>alert("test");</script><style>body { color: red; }</style></head>
            <body><h1>Lesson 4 Overview</h1><p>Welcome to &quot;Stereochemistry&quot; &amp; conformations.</p></body></html>'''
            path.write_text(html, encoding='utf-8')
            extracted = organizer.extract_file_text(str(path))
            self.assertIn('Lesson 4 Overview', extracted)
            self.assertIn('Stereochemistry', extracted)
            self.assertNotIn('alert', extracted)
            self.assertNotIn('color: red', extracted)
