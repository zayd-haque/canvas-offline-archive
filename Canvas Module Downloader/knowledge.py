from safety import bounded_pdf_text, atomic_generated_text
# knowledge.py
# Dedicated Knowledge Base Builder: generates comprehensive chapter-by-chapter
# course reference guides (course_knowledge.md) from syllabus and module details.

import os
from llm_client import ProviderError


def build_comprehensive_course_knowledge(output_dir: str, config: dict, course_name: str, module_titles: list, temp_dir: str):
    """Builds a comprehensive, chapter-by-chapter course knowledge base in course_knowledge.md."""
    md_path = os.path.join(output_dir, "course_knowledge.md")

    # Read Syllabus text from Syllabus.md, .syllabus_cache.txt, Syllabus.txt, or downloaded Syllabus PDF files
    syllabus_text_parts = []
    
    for s_name in ["Syllabus.md", ".syllabus_cache.txt", "Syllabus.txt"]:
        syl_path = os.path.join(temp_dir, s_name)
        if os.path.exists(syl_path):
            try:
                with open(syl_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read(3000)
                    if content:
                        syllabus_text_parts.append(content)
                        break
            except Exception:
                pass

    # Extract text from downloaded Syllabus PDF files
    if os.path.exists(temp_dir):
        try:
            import pypdf
        except ImportError:
            pypdf = None

        total_extracted_len = sum(len(p) for p in syllabus_text_parts)
        if pypdf and total_extracted_len < 6000:
            for f in os.listdir(temp_dir):
                if "syllabus" in f.lower() and f.endswith(".pdf"):
                    pdf_path = os.path.join(temp_dir, f)
                    try:
                        pdf_text = bounded_pdf_text(pdf_path, 20, max(0, 6000 - total_extracted_len))
                        if pdf_text:
                            syllabus_text_parts.append(pdf_text)
                            total_extracted_len += len(pdf_text)
                            if total_extracted_len >= 6000:
                                break
                    except Exception:
                        pass

    syllabus_text = "\n\n".join(syllabus_text_parts)

    # Gather module titles & document previews
    modules_summary = "\n".join(f"- {t}" for t in module_titles[:70]) if module_titles else "No module map available."

    prompt = f"""You are an expert academic curriculum coordinator.
Create an in-depth, comprehensive course reference guide for '{course_name}'.

COURSE MODULES & CONTENT TITLES:
---
{modules_summary}
---

SYLLABUS & COURSE DOCUMENTS:
---
{syllabus_text[:6000] if syllabus_text else "No syllabus text available."}
---

INSTRUCTIONS:
Format the guide in clean Markdown with the following exact sections:

# {course_name} Knowledge Base

## 📋 Course Overview & Grading
- **Instructor & Office Hours**: [Full details]
- **Grading Weights**: [Percentages for all components]
- **Required Textbooks & Materials**: [Full list]

## 📚 Comprehensive Chapter & Module Breakdown
Provide a rich, highly detailed breakdown for EVERY chapter, module, and major topic in the course. For each chapter:
- Describe the core concepts, theories, and methodologies taught.
- List specific subtopics, key terms, and learning objectives.
- Detail relevant assignments, labs, or readings associated with the chapter.

## 📅 Exam Dates & Key Deadlines
- List midterms, finals, quizzes, labs, and major project deadlines in chronological order.

Do not write any introductory or conversational text. Output ONLY the Markdown document."""

    os.makedirs(output_dir, exist_ok=True)
    summary = ''
    try:
        from llm_client import query_llm
        summary = query_llm(prompt, config, timeout=35)
    except ProviderError:
        raise
    except Exception as e:
        print(f"⚠️ Could not generate AI course knowledge base: {e}")

    if summary and len(summary) > 50:
        atomic_generated_text(md_path, summary)
        print("📝 Built comprehensive course_knowledge.md (Chapter & Topic Breakdown)!")
        return

    # Fallback template
    default_content = f"""# {course_name} Knowledge Base

## 📋 Course Overview & Grading
- Syllabus scanned into course folder.

## 📚 Comprehensive Chapter & Module Breakdown
{modules_summary}

## 📅 Exam Dates & Key Deadlines
- See syllabus and announcement files for specific exam dates.
"""
    atomic_generated_text(md_path, default_content)
    print("📝 Initialized baseline course_knowledge.md")
