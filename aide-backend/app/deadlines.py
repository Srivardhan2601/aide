"""Find deadlines, exams, meetings and payments in messages.

Rule-based on purpose: it only records a date that's actually written in the message
("report due Monday", "viva on 12th", "review Friday 11 AM", "invoice due Oct 15"),
and only when the message also says what it's for. Nothing is guessed.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta

WEEKDAYS = {"mon": 0, "monday": 0, "tue": 1, "tues": 1, "tuesday": 1, "wed": 2, "wednesday": 2,
            "thu": 3, "thur": 3, "thurs": 3, "thursday": 3, "fri": 4, "friday": 4,
            "sat": 5, "saturday": 5, "sun": 6, "sunday": 6}
MONTHS = {"jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4,
          "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9,
          "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12}
WD_FULL = "monday|tuesday|wednesday|thursday|friday|saturday|sunday"
WD_SHORT = "thurs|tues|thur|mon|tue|wed|thu|fri|sat|sun"  # only after "by/on/next…" ("I sat", "the sun")
LEAD = r"(?:on|by|before|till|until|due|dated|from)"
MON = "|".join(sorted(MONTHS, key=len, reverse=True))

# What a dated message is about. Checked in this order (exam beats everything).
KINDS = [
    ("exam", r"\b(exams?|tests?|quiz(zes)?|viva|midterms?|mid-?sems?|end-?sems?|finals|practicals?)\b"),
    ("payment", r"\b(invoice|fees?|payment|bill|rent|emi|pay)\b"),
    ("meeting", r"\b(demo|presentation|interview|appointment)\b"),  # events you attend, even "project demo"
    ("assignment", r"\b(assignments?|homework|submissions?|submit|report|project|lab record|thesis|deadline|due|done by)\b"),
    ("meeting", r"\b(meeting|review|call|standup|stand-up|interview|class|lecture|session|sync|demo|appointment|crit)\b"),
]
KIND_LABEL = {"exam": "Exam", "payment": "Payment", "assignment": "Due", "meeting": "Meeting"}


def _ordinal_day(s: str) -> int:
    return int(re.sub(r"\D", "", s))


def _safe_date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _roll_year(d: date | None, today: date, explicit_year: bool) -> date | None:
    """A date without a year that has already passed means next year (e.g. 'Jan 5' in December)."""
    if d and not explicit_year and d < today - timedelta(days=1):
        return _safe_date(d.year + 1, d.month, d.day)
    return d


def find_date(t: str, today: date) -> tuple[date, re.Match] | None:
    """First date mentioned in lowercase text `t`."""
    candidates: list[tuple[int, date, re.Match]] = []

    def add(m, d):
        if m and d:
            candidates.append((m.start(), d, m))

    add(re.search(r"\bday after tomorrow\b", t), today + timedelta(days=2))
    for m in re.finditer(r"\b(today|tonight|eod|end of (the )?day)\b", t):
        add(m, today)
    for m in re.finditer(r"\b(tomorrow|tmrw|tmr)\b", t):
        if not t[max(0, m.start() - 10):m.start()].endswith("after "):
            add(m, today + timedelta(days=1))
    weekday_patterns = (rf"\b(?:(next|this|coming)\s+)?({WD_FULL})\b",
                        rf"\b(?:{LEAD}\s+|(next|this|coming)\s+)({WD_SHORT})\b")
    for pat in weekday_patterns:
        for m in re.finditer(pat, t):
            delta = (WEEKDAYS[m.group(2)] - today.weekday()) % 7
            if delta == 0:  # "by Monday" said on a Monday means next Monday (today would be "today")
                delta = 7
            add(m, today + timedelta(days=delta))
    for m in re.finditer(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({MON})\b(?:,?\s+(\d{{4}}))?", t):
        y = int(m.group(3)) if m.group(3) else today.year
        add(m, _roll_year(_safe_date(y, MONTHS[m.group(2)], int(m.group(1))), today, bool(m.group(3))))
    for m in re.finditer(rf"\b({MON})\s+(\d{{1,2}})(?:st|nd|rd|th)?\b(?:,?\s+(\d{{4}}))?", t):
        y = int(m.group(3)) if m.group(3) else today.year
        add(m, _roll_year(_safe_date(y, MONTHS[m.group(1)], int(m.group(2))), today, bool(m.group(3))))
    # dd/mm(/yyyy), Indian order. Without a year it needs "on/by/due…" in front ("1-2 days" isn't a date).
    for m in re.finditer(rf"(?:\b{LEAD}\s+)?\b(\d{{1,2}})[/-](\d{{1,2}})(?:[/-](\d{{2,4}}))?\b", t):
        y = m.group(3)
        if not y and not re.match(LEAD, m.group(0)):
            continue
        year = (2000 + int(y) if y and len(y) == 2 else int(y)) if y else today.year
        add(m, _roll_year(_safe_date(year, int(m.group(2)), int(m.group(1))), today, bool(y)))
    # "on the 12th", "due 15th" (a bare "1st year" isn't a date)
    for m in re.finditer(rf"\b{LEAD}\s+(?:the\s+)?(\d{{1,2}})(st|nd|rd|th)\b(?!\s+(?:of\s+)?(?:{MON}))", t):
        d = _safe_date(today.year, today.month, _ordinal_day(m.group(1)))
        if d and d < today:  # "the 3rd" after the 3rd means next month
            nm = (today.month % 12) + 1
            d = _safe_date(today.year + (today.month == 12), nm, _ordinal_day(m.group(1)))
        add(m, d)
    if not candidates:
        return None
    _, d, m = min(candidates, key=lambda c: c[0])
    return d, m


def find_time(t: str) -> time | None:
    m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", t)
    if m:
        h, mi = int(m.group(1)), int(m.group(2) or 0)
        if 1 <= h <= 12 and mi < 60:
            return time((h % 12) + (12 if m.group(3) == "pm" else 0), mi)
    m = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", t)
    if m:
        return time(int(m.group(1)), int(m.group(2)))
    if re.search(r"\bnoon\b", t):
        return time(12, 0)
    if re.search(r"\b(eod|end of (the )?day|midnight)\b", t):
        return time(23, 59)
    return None


def _title(text: str) -> str:
    m = re.match(r"\s*subject:\s*(.+)", text, re.I)
    first = m.group(1) if m else re.split(r"(?<=[.!?])\s|\n", text.strip())[0]
    first = " ".join(first.split()).strip(" .")
    return first if len(first) <= 80 else first[:77].rstrip() + "…"


def extract(text: str, now: datetime | None = None) -> list[dict]:
    """Deadlines mentioned in a message: [{title, kind, due_date, due_time}] (0 or 1 for now)."""
    now = now or datetime.now()
    t = " ".join(text.lower().split())
    kind = next((k for k, pat in KINDS if re.search(pat, t)), None)
    if not kind:
        return []
    found = find_date(t, now.date())
    if not found:
        return []
    due, _ = found
    if due < now.date():
        return []
    at = find_time(t)
    return [{
        "title": _title(text),
        "kind": kind,
        "due_date": due.isoformat(),
        "due_time": at.strftime("%H:%M") if at else None,
    }]
