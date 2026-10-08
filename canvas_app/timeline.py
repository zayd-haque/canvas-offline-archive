"""[Codex] Timezone-aware timeline projection, keeping archived records unchanged."""
import re
from datetime import datetime, timezone

_EXAM = re.compile(r'\b(?:exam|midterm|final|test|quiz)(?:s)?\b', re.I)


def timestamp(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        value = datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
        # Downloader date-only and naive values have no offset; use UTC consistently.
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        return None


def project_timeline(course_name, records, *, type=None, status=None, group=None, q=None, limit=100, offset=0, now=None):
    now = now or datetime.now(timezone.utc)
    type, status, group, q = (value.strip().casefold() if value else None for value in (type, status, group, q))
    summary = dict(total_events=0, upcoming_count=0, past_count=0, missing_count=0,
                   submitted_count=0, exam_count=0, assignment_count=0, announcement_count=0, quiz_count=0)
    events = []
    for position, record in enumerate(records):
        if not isinstance(record, dict):
            continue
        summary['total_events'] += 1
        event_type = str(record.get('type') or 'event').casefold()
        title = str(record.get('title') or '')
        event_group = str(record.get('group') or '')
        submission = str(record.get('submission_status') or 'unsubmitted').casefold()
        due = timestamp(record.get('date_due'))
        assigned = timestamp(record.get('date_assigned'))
        date = due or assigned
        past = bool(date and date < now)
        upcoming = bool(date and date >= now)
        submitted = submission in ('submitted', 'graded')
        # An assignment's publication date alone does not establish a missed deadline.
        missing = submission == 'missing' or bool(due and due < now and not submitted and event_type in ('assignment', 'quiz'))
        exam = event_type == 'quiz' or bool(_EXAM.search(title + ' ' + event_group))
        for key, condition in [('past_count', past), ('upcoming_count', upcoming), ('missing_count', missing),
                               ('submitted_count', submitted), ('exam_count', exam)]:
            summary[key] += int(condition)
        if event_type in ('assignment', 'announcement', 'quiz'):
            summary[event_type + '_count'] += 1
        if type and ((type.casefold() == 'exam' and not exam) or (type.casefold() != 'exam' and event_type != type.casefold())):
            continue
        states = {'past': past, 'upcoming': upcoming, 'missing': missing, 'submitted': submitted, 'unsubmitted': not submitted}
        if status and not states.get(status.casefold(), False):
            continue
        if group and group.casefold() not in event_group.casefold():
            continue
        if q and q.casefold() not in f"{title} {event_group} {record.get('details') or ''} {record.get('author') or ''}".casefold():
            continue
        enriched = dict(record, is_exam=exam, time_status='past' if past else 'upcoming' if upcoming else 'undated',
                        is_overdue=bool(missing and due and due < now))
        events.append((date or datetime.max.replace(tzinfo=timezone.utc), position, enriched))
    events.sort(key=lambda item: (item[0], item[1]))
    return dict(course_name=course_name, summary=summary, filtered_count=len(events), limit=limit, offset=offset,
                events=[item[2] for item in events[offset:offset + limit]])
