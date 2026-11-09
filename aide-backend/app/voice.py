"""Talk to Aide: understand short spoken requests and reply-by-voice commands.

Rule-based on purpose: it's instant, free, and never invents anything. Every answer is
built from your own data (brief, deadlines, study plan, approval queue) in app/main.py.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time

from . import deadlines as deadlines_mod


def norm(text: str) -> str:
    """Lowercase, straighten quotes, drop punctuation speech engines like to add."""
    t = text.lower().replace("’", "'")
    return " ".join(re.sub(r"[^\w\s':/-]", " ", t).split())


# ----- talk mode -------------------------------------------------------------
# Checked in order: the first match wins ("what should I study today" is about study, not the brief).
TALK_INTENTS = [
    ("stop", r"^(thanks|thank you|ok thanks|okay thanks|bye|goodbye|stop|that's all|that is all|nothing)\b"),
    ("replies", r"\b(go through|read( out)?|handle|review|start|do|check)\b.*\b(messages?|replies|drafts?|inbox|queue)\b"
                r"|\bhands[- ]?free\b|\breply mode\b"),
    ("food", r"^(please )?(order|get me)\b|\b(swiggy|zomato)\b"),
    ("add", r"^(please )?(remind me|add|note down|note|set a reminder|create a (task|deadline|reminder))\b"),
    ("study", r"\b(study|studying|revise|revision|prepare|preparation)\b"),
    ("exam", r"\b(exams?|viva|quiz|tests?|midterms?|mid-?sems?|end-?sems?)\b"),
    ("due", r"\b(due|deadlines?|assignments?|submissions?|tasks?|homework)\b"),
    ("messages", r"\b(messages?|replies|drafts?|texted|messaged|emailed|mailed|inbox|anyone)\b"),
    ("brief", r"\b(today|my day|brief|summary|what's up|whats up|what's on|whats on|what's new|whats new|"
              r"plan|schedule|morning|update)\b"),
    ("help", r"\b(help|what can you do|what can i say|commands|options)\b"),
]


def talk_intent(text: str) -> str:
    t = norm(text)
    return next((name for name, pat in TALK_INTENTS if re.search(pat, t)), "unknown")


ADD_PREFIX = re.compile(r"^\s*(?:please\s+)?(?:remind me (?:to|about|that)?|add (?:a )?(?:task|deadline|reminder)?(?: to| for)?|"
                        r"add|note down|note|set a reminder (?:to|for)?|create a (?:task|deadline|reminder)(?: to| for)?)\s*",
                        re.I)
TIME_WORDS = re.compile(r"\b(?:at|by|before)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:at|by)\s+(?:noon|midnight)\b|\beod\b", re.I)


def parse_reminder(text: str, now: datetime | None = None) -> dict | None:
    """'remind me to submit the lab record on Friday at 5 pm' ->
    {title: 'Submit the lab record', kind: 'assignment', due_date, due_time}. None without a date."""
    now = now or datetime.now()
    body = ADD_PREFIX.sub("", text.strip(), count=1).strip()
    t = " ".join(body.lower().split())
    found = deadlines_mod.find_date(t, now.date())
    if not found:
        return None
    due, m = found
    if due < now.date():
        return None
    at = deadlines_mod.find_time(t)
    kind = next((k for k, pat in deadlines_mod.KINDS if re.search(pat, t)), "other")
    # Title: what's left once the date and time words are taken out.
    words = " ".join(body.split())
    start, end = m.span()
    title = (words[:start] + " " + words[end:]) if len(words) == len(t) else words
    title = TIME_WORDS.sub(" ", title)
    title = re.sub(r"\b(on|by|before|due|until|till|for|at)\s*$", "", " ".join(title.split()), flags=re.I).strip(" ,.-")
    title = re.sub(r"^(on|by|before|due)\b\s*", "", title, flags=re.I).strip(" ,.-")
    if not title:
        return None
    return {"title": (title[0].upper() + title[1:])[:120], "kind": kind,
            "due_date": due.isoformat(), "due_time": at.strftime("%H:%M") if at else None}


# ----- hands-free replies ----------------------------------------------------
REPLY_COMMANDS = [
    ("stop", r"^(stop|exit|quit|that's all|that is all|enough|i'm done|im done|done for now|bye|end)\b"),
    ("repeat", r"\b(repeat|say (that|it) again|read (it|that|again)|again|pardon|what did (he|she|they) say|come again)\b"),
    ("next", r"^(next|skip|pass|move on|not now|leave it|later on|go on)\b(?! (it )?(until|till|to))"),
    ("reject", r"\b(ignore|dismiss|reject|delete|don't reply|do not reply|no reply|don't send|do not send|never mind)\b"),
    ("edit", r"^(say|tell|add|mention|make|change|rewrite|write|reply|use|be|sound|more|less|shorter|longer|"
             r"remove|drop|instead|ask|also|put|keep|start|end|sign)\b"),
    ("later", r"\b(later|snooze|remind me|after (my|the) (exam|test)|tomorrow|tonight|this evening|in an hour|in 1 hour|"
              r"in (a few|three|3) days)\b"),
    ("send", r"\b(send|approve|looks good|sounds good|go ahead|ship it|that's fine|that's good|perfect)\b"),
]
YES = re.compile(r"^(yes|yeah|yep|yup|ya|yah|sure|confirm|confirmed|ok|okay|do it|send|send it|go ahead|haan|ha|correct|right)\b")
NO = re.compile(r"^(no|nope|nah|cancel|don't|do not|wait|stop|hold on|not yet)\b")


def reply_command(text: str) -> dict:
    """What you said while Aide reads you a reply: {cmd, instruction?, when?}."""
    t = norm(text)
    if not t:
        return {"cmd": "unknown"}
    cmd = next((name for name, pat in REPLY_COMMANDS if re.search(pat, t)), "unknown")
    out: dict = {"cmd": cmd}
    if cmd == "edit":
        bare = re.fullmatch(r"(change|edit|rewrite|make changes|change it|edit it|rewrite it)( it| that| the (draft|reply))?", t)
        out["instruction"] = "" if bare else " ".join(text.split())
    if cmd == "later":
        out["when"] = ("exam" if re.search(r"\b(exam|test)\b", t) else "hour" if re.search(r"\bhour\b", t)
                       else "evening" if re.search(r"\b(tonight|evening)\b", t)
                       else "days" if re.search(r"\bdays\b", t) else "tomorrow")
    return out


def confirm_answer(text: str) -> str:
    """'yes' / 'no' / 'unknown' for 'Send this to Rahul?'"""
    t = norm(text)
    if NO.search(t):
        return "no"
    if YES.search(t):
        return "yes"
    return "unknown"


# ----- phrasing --------------------------------------------------------------
def when_words(d: date, today: date) -> str:
    delta = (d - today).days
    if delta < 0:
        return "overdue since " + ("yesterday" if delta == -1 else d.strftime("%A") if delta > -7 else d.strftime("%b %d").replace(" 0", " "))
    if delta == 0:
        return "today"
    if delta == 1:
        return "tomorrow"
    if delta < 7:
        return "on " + d.strftime("%A")
    return "on " + d.strftime("%A, %b %d").replace(" 0", " ")


def time_words(hhmm: str | None) -> str:
    if not hhmm:
        return ""
    t = time.fromisoformat(hhmm)
    if t == time(23, 59):
        return " by end of day"
    h = t.hour % 12 or 12
    return f" at {h}{'' if t.minute == 0 else f':{t.minute:02d}'} {'AM' if t.hour < 12 else 'PM'}"


def minutes_words(m: int) -> str:
    h, r = divmod(int(m), 60)
    if not h:
        return f"{r} minutes"
    hours = "1 hour" if h == 1 else f"{h} hours"
    return hours if not r else f"{hours} {r} minutes" if h > 1 or r != 30 else "an hour and a half"


def join_words(items: list[str]) -> str:
    items = [i for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def greeting(now: datetime | None = None) -> str:
    h = (now or datetime.now()).hour
    return "Good morning." if h < 12 else "Good afternoon." if h < 17 else "Good evening."


HELP = ("You can ask: what's on today, what should I study, when's my next exam, what's due this week, "
        "or any new messages. Say go through my replies to handle them by voice, or remind me to, and a task with a day.")
