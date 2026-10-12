"""[Codex] Best-effort direct-identifier reduction for outbound cloud prompts.

This is not anonymization: unlabelled names, indirect identifiers and personal
narratives can remain. Do not use it as permission to submit confidential data.
"""
import re


def redact_cloud_text(text: str) -> str:
    """Redact recognizable identifiers without changing local files or prompts."""
    value = str(text)
    # Credentials and credential-bearing URLs must not become document context.
    value = re.sub(r"\bAIza[A-Za-z0-9_-]{20,}\b|\bsk-[A-Za-z0-9_-]{20,}\b", "[REDACTED_CREDENTIAL]", value)
    value = re.sub(r"(?im)(\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|authorization)\s*[:=]\s*)[^\r\n]+", r"\1[REDACTED_CREDENTIAL]", value)
    value = re.sub(r"https?://[^\s<>\"']+", _redact_url, value)
    value = re.sub(r"(?i)(?<![\w.+-])[\w.!#$%&'*+/=?^`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+", "[REDACTED_EMAIL]", value)
    value = re.sub(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)", "[REDACTED_SSN]", value)
    # Labels keep arbitrary academic numbers, dates and author names intact.
    labels = (
        (r"student\s*(?:id|number)|university\s*id|uid|ssn|social\s+security\s*(?:number)?", "ID"),
        (r"student\s*name|full\s*name|legal\s*name|patient\s*name|name\s+of\s+student", "NAME"),
        (r"date\s+of\s+birth|birth\s*date|dob", "DOB"),
        (r"home\s*address|mailing\s*address|street\s*address", "ADDRESS"),
        (r"phone(?:\s*number)?|mobile(?:\s*number)?|telephone", "PHONE"),
        (r"(?:student|final|course)\s*grade|grade|score", "GRADE"),
    )
    for label, kind in labels:
        pattern = rf"(?im)(\b(?:{label})\s*[:=]\s*)[^\r\n]+"
        def replacement(match):
            if kind == "GRADE":
                field = match.group(0)[len(match.group(1)):].strip()
                if not re.fullmatch(r"(?:\d+(?:\.\d+)?(?:\s*/\s*\d+(?:\.\d+)?)?\s*(?:%|points|pts)?|[ABCDF][+-]?|pass|fail)", field, re.I):
                    return match.group(0)
            return match.group(1) + f"[REDACTED_{kind}]"
        value = re.sub(pattern, replacement, value)
    value = re.sub(r"(?<![\w\d])(?:\+1[ .-]?)?(?:\(\d{3}\)[ .-]?\d{3}[ .-]\d{4}|\d{3}[.-]\d{3}[.-]\d{4})(?!\d)", "[REDACTED_PHONE]", value)
    value = re.sub(r"(?i)(?:/Users/|/home/|[A-Z]:[\\/]Users[\\/])[^\s\"'<>]+", "[REDACTED_PRIVATE_PATH]", value)
    return value


def _redact_url(match):
    url = match.group(0)
    if re.search(r"(?i)(?:[?&](?:token|access_token|refresh_token|api_key|key|password|signature|sig|auth)=|https?://[^/]*@)", url):
        return "[REDACTED_PRIVATE_URL]"
    return url
