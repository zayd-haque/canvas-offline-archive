"""[Codex] Offline, source-aware academic document classification.

Signals are generic document roles, never course-specific vocabulary. Strong
document identity outranks incidental words in body text and mixed week modules.
"""
import re
import unicodedata


def normalize(text):
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", str(text or ""))
    text = re.sub(r"([A-Za-z])(\d)|(\d)([A-Za-z])", r"\1\3 \2\4", text)
    text = unicodedata.normalize("NFKC", text).casefold()
    return re.sub(r"[_\W]+", " ", text).strip()


PATTERNS = {
    "admin": r"\b(?:syllabus|syllabi|schedule|polic(?:y|ies)|announcement|notice|office hours?|course information|grading|zoom|exam tips|trial run|respondus|logistics|administrative (?:checklist|notice|instructions)|academic (?:petition|form)|petitions?|prerequisite waiver|waiver|late add|add drop|enrollment (?:form|petition)|course petition|computer compatibility|identity verification|overview|welcome|learning outcomes|course components|required course materials|reading lists?|course bibliograph(?:y|ies)|deadline|extended|scores?|grades?|follow up|accessing textbook|extra credit opportunities|format forum|exam format|how to use|getting started|lab(?:oratory)? safety (?:agreement|contract|rules)|safety agreement|field trip (?:waiver|permission)|honor code (?:pledge|agreement)|academic integrity (?:contract|agreement|pledge)|attendance policy|absence (?:form|notice)|faqs?|frequently asked questions)\b",
    "homework": r"\b(?:homework|hw|assignment|assignments|assigment|problem sets?|pset|ps|essay|essays|project|projects|lab reports?|laboratory reports?|deliverables?|in\s*quizitive|web\s*assign|recommended problems?|review problems?|suggested review|action items?)\b",
    "discussion": r"\b(?:discussion|discussions|disc|dis|recitation|recitations|tutorial|tutorials|section worksheets?|section wkshts?|discussion sections?|lab sections?)\b",
    "worksheet": r"\b(?:worksheets?|wkshts?|ws|exercise sheets?|question sheets?|problem sheets?|review exercises|practice questions|activity scenarios|active learning)\b",
    "slides": r"\b(?:slides?|slide deck|decks?|presentations?|powerpoint|pptx?|keynote)\b",
    "lecture": r"\b(?:lectures?|lec|notes?|guided notes|lessons?|chapters?|ch|readings?|textbook|e books?|ebook|articles?|handouts?|concept maps?|reaction maps?|board work|formula\s*sheets?|equation\s*sheets?|reference\s*sheets?|cheat\s*sheets?|(?:lab|laboratory)(?:\s*(?:#|no\.?|\d+))?\s*(?:manuals?|protocols?|guides?|procedures?))\b",
    "exam": r"\b(?:exams?|examinations?|mid\s*terms?|quizzes|quiz|(?:practice|mock|sample|past) tests?|final exam|finals|final)\b",
    "solution": r"\b(?:solutions?|solns?|sol|answer keys?|answers|keys?|worked answers|rubrics?|marking (?:scheme|guide)|mark scheme|scoring guide|solved)\b",
    "practice": r"\b(?:practice|sample|past|previous|mock|old|review|study guide)\b",
    "student_submission": r"\b(?:student\s+(?:submitted\s+)?(?:quiz|exam|examination)\s+and\s+(?:quiz|exam|examination)\s+(?:work|responses?|submissions?)|student\s+(?:s\s+)?(?:submitted\s+)?(?:quiz|exam|assignment|hw|homework|lab|pset|problem set)?\s*(?:work|responses?|submissions?)|my\s+(?:quiz|exam|assignment|homework|lab|pset|problem set)?\s*submissions?|submitted\s+(?:quiz|exam|assignment|homework|lab|pset|problem set)?\s*responses?|graded\s+submissions?|submission\s+receipt)\b",
}


def signals(text):
    text = normalize(text)
    # [Codex] Negated answer evidence is not a supplied answer document.
    text = re.sub(r"\b(?:no|without|not including|not providing|does not include|does not provide)\s+(?:(?:supplied|provided|worked|official)\s+)?(?:answer keys?|answers?|solutions?|keys?)\b", " ", text)
    found = {key: bool(re.search(pattern, text)) for key, pattern in PATTERNS.items()}
    # Final deliverables and conceptual answer/key words are not examinations/keys.
    if (found["homework"] or re.search(r"\bfinal (?:project|essay|paper|report|draft|presentation)\b", text)) and not re.search(r"\b(?:exams?|examinations?|mid\s*terms?|quizzes|quiz|(?:practice|mock|sample|past) tests?)\b", text):
        found["exam"] = False
        found["homework"] = True
    if re.search(r"\b(?:key (?:concepts|terms|ideas|points)|(?:answer|answers) (?:the|each|these|following)|(?:write|record|put|enter|provide)\s+(?:all|your|the)?\s*answers?|all\s+answers\b|(?:solutions?|solution)\s+(?:chemistry|concentration|equilibrium))\b", text) and not re.search(r"\b(?:answer key|worked solutions?|solutions? manual|(?:hw|homework|worksheet|exam|midterm|quiz) \d+ solutions?)\b", text):
        found["solution"] = False
    if re.search(r"\b(?:api|license|product|activation|ssh|public|private)\s+keys?\b", text):
        found["solution"] = False
    if found["lecture"] and not (found["homework"] or found["worksheet"] or found["solution"] or found["discussion"] or re.search(r"\b(?:syllabus|announcement|notice|schedule|deadline|scores?|grades?|follow up|overview|outcomes|materials)\b", text)):
        found["exam"] = False
        found["admin"] = False
    return found


TAGS = {
    "admin": ["syllabus", "admin"], "homework": ["homework", "assignments", "deliverables", "student_work"],
    "homework_solution": ["solutions", "keys"], "discussion": ["worksheets", "discussions"],
    "discussion_solution": ["discussion_solutions", "discussions", "worksheets", "solutions"],
    "discussion_slides": ["discussion_slides", "slides", "lectures"],
    "lecture": ["lectures", "slides", "readings", "notes"],
    "practice_exam": ["practice_exams", "exams", "quizzes"],
    "practice_exam_solution": ["practice_exam_solutions", "exam_solutions", "exams", "quizzes", "solutions"],
    "current_exam": ["current_exams", "exams", "quizzes"],
    "current_exam_solution": ["current_exam_solutions", "exam_solutions", "exams", "quizzes", "solutions"],
    "other": ["other", "reference"],
    "student_quiz": ["student_quizzes", "student_work", "current_exams", "exams", "quizzes"],
}


def syllabus_term(syllabus):
    """Use only a single consistent explicit academic term in syllabus headers."""
    if not isinstance(syllabus, dict):
        return ""
    source = str(syllabus.get("pdf_file", "")) + " " + re.sub(r"<[^>]*>", " ", str(syllabus.get("body", "")))[:500]
    terms = re.findall(r"\b(winter|spring|summer|fall|autumn)\s*(?:quarter\s*|semester\s*|term\s*)?(20\d{2})\b", normalize(source))
    unique = {(season.replace("autumn", "fall"), year) for season, year in terms}
    return " ".join(next(iter(unique))).title() if len(unique) == 1 else ""


def role(sig):
    if sig.get("student_submission"):
        if sig["exam"]:
            return "student_quiz"
        return "homework"
    if sig["admin"] and not (sig["solution"] or sig["worksheet"]):
        return "admin"
    if sig["exam"]:
        base = "practice_exam" if sig["practice"] else "current_exam"
        return base + ("_solution" if sig["solution"] else "")
    if sig["discussion"] or sig["worksheet"]:
        return "discussion_slides" if sig["slides"] else "discussion_solution" if sig["solution"] else "discussion"
    if sig["solution"]:
        return "homework_solution"
    if sig["homework"]:
        return "homework"
    if sig["worksheet"]:
        return "discussion"
    if sig["lecture"] or sig["slides"]:
        return "lecture"
    return "other"


def corroborated_purpose(content):
    """[Codex] Resolve positive leading-purpose evidence, not topical nouns.

    Assessment + requested intellectual work + delivery is a task signature;
    navigation and administrative instructions require their own positive cues.
    Returned exam responses and official keys retain their specific identity.
    """
    lines = [normalize(line) for line in str(content or "").splitlines() if line.strip()]
    heading = lines[0] if lines else ""
    body = normalize(str(content or "")[:1800])
    declared = signals(heading)
    if declared["student_submission"] or declared["solution"]:
        return None
    action = bool(re.search(r"\b(?:write|compose|create|design|analy[sz]e|compare|calculate|evaluate|develop|interpret|argue|justify|perform|record)\b", body))
    delivery = bool(re.search(r"\b(?:submit|upload|hand in)\b", body))
    assessed = bool(re.match(r"^(?:assessed|graded)\b", heading))
    task = (assessed or re.match(r"^(?:assignment|homework|assigned task)\b", heading)) and action and delivery
    if task and not declared["exam"]:
        return "homework"
    administrative = bool(re.search(r"\b(?:administrative|logistics|navigation)\b", heading))
    course_help = bool(re.match(r"^course\b", heading) and re.search(r"\b(?:help|guide|instructions|announcement|notice)\b", heading))
    if (administrative or course_help) and not action and not any(
            declared[key] for key in ("worksheet", "solution", "student_submission")):
        return "admin"
    laboratory_reference = bool(re.match(r"^(?:lab|laboratory)\b", heading) and re.search(
        r"\b(?:protocol|procedure|manual|reference|operating)\b", heading))
    if laboratory_reference and not task:
        return "lecture"
    return None


def folder_description_role(description):
    """[Codex] A blank response space is not submitted student work."""
    meaning = re.sub(r"\b(?:must\s+not|not|no|without|excluding|exclude)\b[^.;\n)]*",
                     " ", str(description or ""), flags=re.I)
    sig = signals(meaning)
    if sig["worksheet"] and re.search(r"\bblank\b", normalize(meaning)) and not re.search(
            r"\b(?:submitted|returned|graded|completed)\b", normalize(meaning)):
        sig["student_submission"] = False
    return role(sig)


def folder_for_role(category, folders):
    # Type tags outrank substrings: a parent 'Practice Exams' must not steal
    # 'Practice Exam Solutions', and renamed folders remain usable.
    specific_tags = {
        "admin": ["syllabus", "admin"],
        "homework": ["homework", "assignments", "deliverables", "student_work"],
        "homework_solution": ["homework_solutions"],
        "discussion": ["worksheets", "discussions"],
        "discussion_solution": ["discussion_solutions"],
        "discussion_slides": ["discussion_slides"],
        "discussion_slide": ["discussion_slides"],
        "lecture": ["lectures", "readings", "notes", "slides"],
        "practice_exam": ["practice_exams"],
        "practice_exam_solution": ["practice_exam_solutions"],
        "current_exam": ["current_exams"],
        "current_exam_solution": ["current_exam_solutions"],
        "other": ["other", "reference"],
        "student_quiz": ["student_quizzes", "student_work"],
    }
    for tag in specific_tags[category]:
        for folder in folders:
            if tag in [str(t).casefold() for t in folder.get("types", [])]:
                return folder["name"]
    for folder in folders:
        if folder.get("description") and folder_description_role(folder["description"]) == category:
            return folder["name"]
    # [Codex] Explicit destination guidance outranks inherited path words.
    # An Exams/Reading bin can hold readings when its description says so;
    # the parent directory must not turn every sibling into an examination.
    for folder in folders:
        name = str(folder.get("name", "")).replace("\\", "/").rsplit("/", 1)[-1]
        if role(signals(name)) == category:
            return folder["name"]
    # Only after checking a dedicated destination, collapse an unavailable
    # subtype into a configured broader group (e.g. all assessment keys).
    for tag in TAGS[category]:
        for folder in folders:
            if tag in [str(t).casefold() for t in folder.get("types", [])]:
                return folder["name"]
    # Only configured destinations are returned, including reduced hierarchies.
    for folder in folders:
        if "other" in folder.get("types", []):
            return folder["name"]
    for folder in folders:
        if role(signals(folder.get("name", ""))) == "other":
            return folder["name"]
    return folders[-1]["name"] if folders else "Other Materials"


def classify(filename, title, module_name, content, config, folders):
    # Canvas labels many learning resources as assignments. The wrapper is
    # metadata, while the specific lecture/reading title identifies the file.
    title = re.sub(r"^\s*assignment\s*[:\-]\s*(?=(?:lecture|weekly reading|reading|chapter|slides)\b)", "", title, flags=re.I)
    # File extensions describe format; Keynote's .key is not an answer key.
    document_name = re.sub(r"\.(?:pdf|docx?|pptx?|key|epub|xlsx?|csv|txt|md|html?)$", "", filename, flags=re.I)
    identity = normalize(document_name + " " + title)
    # Explicit user mappings take precedence, but match tokens rather than
    # arbitrary substrings ("lab" must not match "syllabus").
    allowed = {f["name"] for f in folders}
    matched_rules = []
    for rule in config.get("category_rules", []):
        if rule.get("folder") in allowed:
            for keyword in rule.get("keywords", []):
                needle = normalize(keyword)
                if needle and re.search(r"(?<!\w)" + re.escape(needle) + r"(?!\w)", identity):
                    matched_rules.append(rule)
                    break
    primary = signals(identity)
    if re.search(r"\.(?:pptx?|key)$", filename, re.I):
        primary["slides"] = True
    module = signals(module_name)
    lines = [line.strip() for line in str(content or "").splitlines() if line.strip()]
    heading = signals(lines[0][:250] if lines else "")
    body = signals(str(content or "")[:8000])
    # Capture filenames encode announcement source: ISO date + topic ID/name.
    if (re.match(r"^\d{4}-\d{2}-\d{2}\s*-\s*\d{4,}\s*-", filename)
            or (re.match(r"^\d{4}-\d{2}-\d{2}\s*-", filename)
                and re.search(r"(?:announcement|discussion_topics|^Author:|^Posted:)", str(content or "")[:1500], re.I | re.M))):
        primary = {key: key == "admin" for key in primary}
    selected = primary.copy()
    # An assignment prompt/deliverable with an attached rubric is homework, not a key.
    if primary["homework"] and re.search(r"\b(?:prompt|assignment prompt|essay prompt|project specs?|deliverables?)\b", identity):
        selected["solution"] = False
    # Explicit notes/readings/slides are teaching documents even when their topic is
    # a quiz review or public policy. Worksheet/solution identity still wins.
    if (primary["lecture"] or primary["slides"]) and not (primary["homework"] or primary["worksheet"] or primary["solution"]) and not re.search(r"\b(?:syllabus|announcement|notice|deadline|office hours|grading|schedule|policy|policies)\b", identity):
        selected["exam"] = False
        selected["admin"] = False
    has_meaningful_content = len(re.findall(r"[a-zA-Z]{2,}", str(content or ""))) >= 4
    if role(primary) == "other":
        selected = heading if role(heading) != "other" else body if role(body) != "other" else module if not has_meaningful_content else primary
    # Module is useful for discussion subtype and practice/current split;
    # 'Week 3' and topic modules cannot turn an explicit worksheet into notes.
    if not primary["admin"]:
        if primary["slides"] or primary["worksheet"]:
            selected = selected.copy()
            selected["discussion"] |= module["discussion"] or heading["discussion"]
        if primary["homework"] and not primary["solution"] and heading["worksheet"] and module["discussion"]:
            selected = selected.copy()
            selected["homework"] = False
            selected["worksheet"] = selected["discussion"] = True
        if selected["exam"]:
            selected = selected.copy()
            selected["practice"] |= module["practice"]
        # A title such as hw2 has no solution cue; a solution heading does.
        if (selected["homework"] or selected["worksheet"] or selected["discussion"] or selected["exam"]) and heading["solution"]:
            selected = selected.copy()
            selected["solution"] = True
    # Dates alone do not imply historical material. Compare against the
    # explicit current term when supplied; no machine-date/course assumptions.
    current_term = config.get("course_term", config.get("current_term", ""))
    term_pattern = r"\b(summer|fall|autumn|winter|spring)\s*(\d{2}|\d{4})\b"
    terms = re.findall(term_pattern, identity)
    active = re.findall(term_pattern, normalize(current_term))
    if selected["exam"] and terms and active:
        order = {"winter": 0, "spring": 1, "summer": 2, "fall": 3, "autumn": 3}
        def stamp(t):
            return (int(t[1]) + (2000 if len(t[1]) == 2 else 0), order[t[0]])
        if any(stamp(t) < stamp(active[0]) for t in terms):
            selected = selected.copy()
            selected["practice"] = True
    selected_role = role(selected)
    # [Codex] Document purpose can be stronger than a delivery wrapper or an
    # incidental word deep in the text. These cues are discipline independent.
    front = normalize(str(content or "")[:1800])
    full = normalize(str(content or "")[:8000])
    # [Codex] A specific worksheet heading is stronger than 'handout',
    # which only describes the delivery format.
    if heading["worksheet"] and re.search(r"\bhandouts?\b", identity) and not any(primary[k] for k in ("homework", "exam", "solution")):
        selected_role = role(heading)
    # Distinguish administrative exam instructions from the actual paper.
    if primary["exam"] and not primary["solution"] and re.search(r"\b(?:instructions|policies|logistics)\b", identity) and heading["admin"]:
        selected_role = "admin"
    # Explicit personal/noninstructional identity prevents incidental notes,
    # schedule or policy words from manufacturing an academic purpose.
    personal_identity = re.search(r"\b(?:personal|household|family|holiday|travel itinerary|transit|bus schedule|train schedule|shuttle schedule|insurance (?:invoice|claim|policy)|tax (?:return|form|document)|w-?2|1099|lease agreement|rental agreement|medical (?:bill|invoice|record)|bank statement|pay stub|utility bill|resume|curriculum vitae|software license|license key|product key|activation key)\b", identity + " " + front[:250])
    academic_heading = re.search(r"\b(?:lecture|syllabus|homework|assignment|worksheet|recitation|exam|quiz|chapter|textbook|research article)\b", front[:250])
    if personal_identity and not academic_heading:
        selected_role = "other"
    if not str(content or "").strip() and re.search(r"\b(?:empty|untitled) (?:notes?|document|file)\b", identity):
        selected_role = "other"
    # [Codex] Identify exercise sheets by repeated response prompts, and
    # explanatory teaching documents by corroborating prose. These require
    # multiple signals rather than discipline-specific topic dictionaries.
    response_prompts = len(re.findall(
        r"(?im)^\s*(?:\d+[.)]\s*)?(?:propose|predict|draw|label|calculate|identify|derive|devise|explain|compare|evaluate)\b",
        str(content or "")[:8000]))
    explanation_cues = sum(bool(re.search(pattern, front)) for pattern in (
        r"\b(?:we learned|we will learn|learning objectives|learning goals)\b",
        r"\b(?:due to|because|for example|is driven by)\b",
        r"\b(?:introduction|overview|patterns|principles|properties)\b"))
    if heading["worksheet"] and primary["solution"] and not primary["exam"]:
        selected_role = "discussion_solution"
    elif role(primary) == "other" and explanation_cues >= 2:
        selected_role = "lecture"
    elif response_prompts >= 2 and not any(primary[k] for k in ("admin", "homework", "exam", "lecture", "slides")):
        selected_role = "discussion_solution" if primary["solution"] else "discussion"
    # 'Final practice' can refer to practice of a subject, not an exam.
    # Positive paper evidence is required when final is the only exam word.
    if primary["exam"] and re.search(r"\bfinal\b", identity) and not re.search(r"\b(?:exam|examination|midterm|quiz)\b", identity + " " + front):
        if response_prompts and re.search(r"\bpractice problems\b", full):
            selected_role = "homework"
    if primary["admin"] and re.search(r"\b(?:try|complete|solve|work through)\b", full) and len(re.findall(r"\b\d+\.\d+(?:\s*[-–]\s*\d+)?", str(content or ""))) >= 4:
        selected_role = "homework"
    if re.search(r"\b(?:browser check|testing browser|exam access|quiz access)\b", identity):
        selected_role = "admin"
    if not any(primary[k] for k in ("exam", "solution", "lecture", "slides", "worksheet")) and re.search(r"\bsubmit (?:your|the|a) (?:report|analysis|essay|observations)\b", full):
        selected_role = "homework"
    if not any(primary[k] for k in ("admin", "exam", "solution", "lecture", "slides", "worksheet")) and re.search(r"\b(?:assignment prompt|assigned\b.{0,90}\btask)\b", front[:500]) and re.search(r"\bsubmit\b", front):
        selected_role = "homework"
    # [Codex] Numbered class/session captures need corroborating instructional
    # evidence: a generic class roster, class policy or unrelated "class" file
    # is not automatically a lecture. In-class questions remain slide content.
    numbered_session = bool(re.search(r"\b(?:class|session)\s*\d+\b", identity))
    session_heading = bool(re.search(r"\b(?:class|session)\s*\d+\s*[a-z]?\b", front[:700]))
    teaching_cues = bool(re.search(r"\b(?:clicker|i clicker|iclicker|groupwork|group work|learning objectives|learning goals|today we|in this lesson|worked example|concepts? explained)\b", front))
    session_lecture = (numbered_session and session_heading and teaching_cues
                       and not heading["admin"]
                       and not re.search(r"\b(?:roster|attendance list|classroom policy|class rules)\b", identity + " " + front[:500])
                       and not any(primary[tag] for tag in ("admin", "homework", "worksheet", "exam", "solution")))
    forum = ("search entries or author" in front and
             ("view split screen" in front or "discussion forum" in front))
    if session_lecture:
        selected_role = "lecture"
    elif forum:
        selected_role = "admin"
    elif re.search(r"\b(?:instructional team|teaching team|instructor contact|drop in hours)\b", identity):
        selected_role = "admin"
    elif re.search(r"\b(?:student resources master\s*list|note taking (?:strategies|tips)|wellness resources)\b", identity):
        selected_role = "other"
    elif re.search(r"\b(?:research opportunities|research opporunities|care package|self care resources)\b", identity):
        selected_role = "other"
    elif re.search(r"\bextra credit\b", identity) and not re.search(r"\b(?:opportunities|information|instructions|policy)\b", identity):
        selected_role = "homework"
    elif re.search(r"\b(?:research article|abstract)\b", front) and re.search(r"\b(?:participants|experiments?|methods?|results|study)\b", full) and not re.search(r"\blab reports?\b", identity):
        selected_role = "lecture"
    elif re.search(r"\b(?:type answer here|your answer here|write your answer|fill in the blank)\b", full) and not primary["exam"]:
        selected_role = "discussion" if primary["lecture"] or module["discussion"] else selected_role
    elif re.search(r"\bblank\b", identity) and primary["lecture"] and not primary["exam"]:
        selected_role = "discussion"
    elif re.search(r"\breview\s+(?:and\s+)?walkthrough\b", front) and not primary["solution"]:
        selected_role = "discussion_slides" if primary["discussion"] or module["discussion"] else "lecture"
    elif primary["exam"] and primary["practice"] and re.search(r"\b(?:presented by|slides by|agenda)\b", front) and not primary["solution"]:
        selected_role = "lecture"
    elif module["discussion"] and not primary["exam"] and not primary["admin"]:
        if primary["solution"]:
            selected_role = "discussion_solution"
        elif re.search(r"\b(?:\d+ (?:label|predict|propose|draw|identify|evaluate)|answer (?:the|each|these|following))\b", full):
            selected_role = "discussion"
    elif re.search(r"\bchap ter \d+\b", identity):
        selected_role = "lecture"
    elif re.search(r"\b(?:lesson outline|as reviewed in lecture|material up to|content covered)\b", front + " " + identity) and not primary["solution"]:
        selected_role = "lecture"
    elif primary["admin"] and re.search(r"\boverview\b", identity) and module["lecture"] and not re.search(r"\b(?:course|week|weekly|syllabus)\b", identity):
        selected_role = "lecture"
    elif role(primary) == "other":
        # Explanatory readings often mention 'solutions' or 'key' in prose;
        # a reference answer document needs evidence near its heading.
        if selected_role != "admin" and not heading["admin"] and re.search(r"\b(?:section overview|learning objectives|understand the|chapter \d+|scientific explanations|key principle)\b", front):
            selected_role = "lecture"
        elif selected_role == "homework_solution" and not re.search(r"\b(?:answer key|worked solutions|worked answers|solutions manual|marking guide|scoring guide|official\b.{0,80}\b(?:rubric|solutions)|homework solutions|assignment solutions)\b", front):
            selected_role = "other"
        elif selected_role == "discussion" and re.search(r"\bdiscussion of\b", front) and not re.search(r"\b(?:worksheet|recitation|tutorial|question sheet|discussion questions)\b", identity + " " + front):
            selected_role = "other"
    # [Codex] Specific leading purpose evidence refines generic labels such as
    # "answers", "overview" or "grading criteria" without rewriting named tasks.
    if heading["exam"] and heading["solution"] and not any(
            primary[k] for k in ("homework", "worksheet", "lecture", "slides", "admin")):
        refined_heading = heading.copy()
        refined_heading["practice"] |= selected["practice"] or module["practice"]
        selected_role = role(refined_heading)
    elif heading["homework"] and heading["solution"] and re.match(
            r"^(?:official|instructor)\b", normalize(lines[0] if lines else "")) and not re.search(
            r"\b(?:prompt|brief|deliverable|project specs)\b", identity):
        selected_role = "homework_solution"
    if heading["lecture"] and re.match(r"^(?:assigned|academic|required|weekly) readings?\b",
                                     normalize(lines[0] if lines else "")) and not re.search(
            r"\b(?:syllabus|course overview|orientation|announcement|notice|schedule|policy|policies)\b", identity):
        selected_role = "lecture"
    # [Codex] Technical upload/access guidance is administration, not a task.
    leading_heading = normalize(lines[0] if lines else "")
    if re.search(r"\b(?:submission|upload|portal)\b", identity + " " + leading_heading) and re.search(
            r"\b(?:guide|instructions|tutorial|help|access|confirmation steps)\b", identity + " " + leading_heading) and re.search(
            r"\b(?:upload menu|confirmation (?:page|receipt|message)|website navigation|submission button|log in|login|sign in|file types?|portal)\b", front) and not re.search(
            r"\b(?:write|compose|design|analy[sz]e|compare|calculate)\b", front):
        selected_role = "admin"
    # [Codex] Course website help and course visit permissions are admin,
    # while substantive learning tasks and unrelated travel remain distinct.
    if re.match(r"^course (?:website|site|platform) (?:instructions|help|guide)\b", leading_heading) and re.search(
            r"\b(?:open|navigate|click|view)\b", front) and not re.search(
            r"\b(?:write|compose|design|analy[sz]e|compare|calculate)\b", front):
        selected_role = "admin"
    if re.match(r"^course\b.{0,60}\b(?:visit|trip|observation)\b.{0,40}\b(?:consent|permission|waiver)\b", leading_heading):
        selected_role = "admin"
    # [Codex] Resolve corroborated evidence after all incidental body overrides.
    # A returned student's responses are not an instructor key or blank paper.
    if primary["student_submission"] or heading["student_submission"]:
        selected_role = "student_quiz" if (primary["exam"] or heading["exam"]) else "homework"
    # [Codex] A leading assignment heading plus a deliverable outranks a
    # topical title such as policy analysis, not an actual policy notice.
    elif re.match(r"^(?:assignment|homework|assigned task)\b", leading_heading) and re.search(
            r"\b(?:submit|upload|hand in)\b", front) and not heading["solution"]:
        selected_role = "discussion" if module["discussion"] else "homework"
    # An assessed brief can identify a task without the word "assignment".
    elif re.search(r"\b(?:assessed|graded)\s+(?:\w+\s+){0,2}(?:brief|proposal|portfolio|report|analysis|critique|reflection)\b", front[:500]) and re.search(r"\b(?:submit|upload|hand in)\b", full):
        selected_role = "homework"
    elif not any(primary[k] for k in ("exam", "solution", "lecture", "slides", "worksheet")) and re.search(
            r"\bsubmit\s+(?:a|your|the)\s+(?:\w+\s+){0,2}(?:essay|report|analysis|portfolio|proposal)\b", front):
        selected_role = "homework"
    # [Codex] Leading explicit practice-paper evidence refines a generic quiz
    # title. A negated current-paper reference cannot undo that identity.
    if primary["exam"] and heading["exam"] and heading["practice"] and re.match(
            r"^(?:practice|sample|mock|past|previous)\s+(?:quiz|exam|examination|midterm|test)\b", leading_heading):
        selected_role = "practice_exam_solution" if selected["solution"] or heading["solution"] else "practice_exam"
    if re.match(r"^(?:lecture notes?|main lecture|lecture slides?)\b", leading_heading) and not any(
            primary[k] for k in ("homework", "exam", "solution", "worksheet")) and not module["discussion"]:
        selected_role = "lecture"
    # "Discussion of" names a topic; dedicated discussion sections still win.
    if re.search(r"\bdiscussion of\b", identity) and heading["lecture"] and not module["discussion"]:
        selected_role = "lecture"
    # [Codex] Resolve corroborated leading purpose separately from incidental
    # topic words. Preserve dedicated discussion assignments and exact keys.
    strong_purpose = corroborated_purpose(content)
    if strong_purpose:
        selected_role = "discussion" if strong_purpose == "homework" and module["discussion"] else strong_purpose
    if not str(content or "").strip() and re.search(r"\bnotes?\b", identity) and not re.search(
            r"\b(?:lecture|lec|lesson|chapter|ch|reading|textbook|guided|study|class|session|discussion|recitation)\b", identity + " " + normalize(module_name)):
        selected_role = "other"
    first_heading = normalize(lines[0][:250] if lines else "")
    explicit_academic_heading = bool(re.search(
        r"^(?:(?:official|student|current|practice|mock|sample|assigned|academic|required|weekly|course)\s+){0,2}(?:lectures?|readings?|syllabus|homework|assignment|worksheet|recitation|exam|examination|quiz|chapter|textbook|research article)\b",
        first_heading))
    nonacademic_identity = bool(re.search(
        r"\b(?:invoices?|purchase receipts?|bookstore (?:purchase )?receipts?|(?:club|community|neighborhood|association)\b.{0,50}\bminutes)\b",
        identity + " " + first_heading))
    explicitly_unrelated = bool(re.search(r"\b(?:not a course document|unrelated to (?:any|the|this) course|nonacademic\b.{0,60}\b(?:minutes|document|receipt))\b", front))
    if (personal_identity or nonacademic_identity or explicitly_unrelated) and not explicit_academic_heading:
        selected_role = "other"
    if not str(content or "").strip() and re.search(r"\b(?:blank|empty|untitled|unfilled) notes?\b", identity) and not re.search(r"\bguided\b", identity):
        selected_role = "other"
    # Published built-in category keyword lists are hints, not stronger than a
    # solutions heading or a specific document purpose. Renamed/custom targets
    # remain explicit overrides, as do rules marked override=true.
    canonical_names = {"Syllabus And Admin", "Homework Assignments", "Homework Solutions",
                       "Discussion Worksheets", "Discussion Worksheets/Discussion Solutions",
                       "Lecture Slides", "Discussion Slides", "Exams And Quizzes/Practice Exams",
                       "Exams And Quizzes/Practice Exams/Practice Exam Solutions",
                       "Exams And Quizzes/Current Exams", "Exams And Quizzes/Current Exams/Current Exam Solutions",
                       "Other Materials"}
    for rule in matched_rules:
        if rule.get("override") or rule["folder"] not in canonical_names or selected_role == "other":
            return rule["folder"]
    return folder_for_role(selected_role, folders)
