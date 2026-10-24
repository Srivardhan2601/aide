"""Rule-based bucket classifier.

Used on its own by the mock drafter, and as a safety floor when Claude drafts:
the final bucket is whichever of the two is stricter (never > ask > auto).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .config import BUCKET_RANK


@dataclass(frozen=True)
class Classification:
    bucket: str    # auto | ask | never
    category: str  # what kind of message this is; drives the mock drafter's template
    reason: str    # short, user-facing


def _any(patterns: list[str], text: str) -> bool:
    return any(re.search(p, text) for p in patterns)


PERSONAL_INFO = [
    r"\b(home |postal |mailing )?address\b", r"\bphone( number)?\b", r"\bmobile number\b",
    r"\bbank (details|account|info)", r"\baccount number\b", r"\bifsc\b", r"\bupi (id|pin)\b",
    r"\bpassword\b", r"\botp\b", r"\bpin\b", r"\bcard (number|details)\b", r"\bcvv\b",
    r"\bssn\b", r"\baadhaa?r\b", r"\bpan (card|number)\b", r"\bpassport\b",
]
SPAM_HINTS = [r"\bprize\b", r"\blottery\b", r"\bwinner\b", r"\bclaim\b", r"\bgift card\b", r"\bcrypto\b"]
REQUEST = [r"\bsend\b", r"\bshare\b", r"\bgive\b", r"\bwhat'?s your\b", r"\bprovide\b", r"\bconfirm your\b", r"\bneed your\b"]

EMOTION = [
    r"\brough day\b", r"\bbad day\b", r"\btoo much\b", r"\boverwhelm", r"\bstress", r"\banxious\b", r"\banxiety\b",
    r"\bdepress", r"\bsad\b", r"\bupset\b", r"\blonely\b", r"\bcrying\b", r"\bheartbr", r"\bhurt(ing)?\b",
    r"\bcan'?t cope\b", r"\bexhausted\b", r"\bburn(ed|t)? out\b", r"\bmiss you\b", r"\bfeel(s|ing)? (so |really )?(bad|low|awful|terrible|down)\b",
]
MONEY = [
    r"₹", r"\$\s?\d", r"\brs\.?\s?\d", r"\binr\b", r"\brupees?\b", r"\bdollars?\b", r"\bbucks\b", r"\bmoney\b", r"\bcash\b", r"\bloan\b", r"\blend\b", r"\bborrow\b",
    r"\bpay(ment|ing)?\b", r"\binvoice\b", r"\btransfer\b", r"\bupi\b", r"\bpaypal\b", r"\bvenmo\b", r"\bfee\b", r"\brefund\b",
]
MEETING_CONFIRM = [
    r"\bconfirm\b.*\b(attend|attending|join|joining|meeting|review|call|standup|session|class|lecture|sync)\b",
    r"\b(are you|you) (still )?(coming|joining|attending)\b",
]
DEADLINE = [
    r"\bby (mon|tues|wednes|thurs|fri|satur|sun)day\b", r"\bby (tomorrow|tonight|eod|end of)\b", r"\bdeadline\b",
    r"\bdue (on|by)\b", r"\bget .* done\b", r"\bfinish .* by\b", r"\basap\b",
]
COMMITMENT = [
    r"\bcollab", r"\bpartner(ship)?\b", r"\bschedule\b", r"\bintro call\b", r"\binterview\b", r"\bset up a (call|meeting)\b",
    r"\bwould you (like|be (up|open|interested))\b", r"\bare you (free|available|up for)\b", r"\bcan you\b", r"\bcould you\b",
    r"\bwill you\b", r"\bjoin (us|our)\b", r"\bmeet (up|next|this)\b", r"\bnext (week|month)\b", r"\bthis week\b", r"\bsign up\b",
]
THANKS = [r"\bthanks?\b", r"\bthank you\b", r"\bappreciate", r"\bloved?\b", r"\bgreat (post|work|job|talk)\b", r"\bawesome\b", r"\bnice (post|work|job)\b", r"\bcongrat"]
UPDATE = [
    r"\bmoved to\b", r"\bresheduled\b", r"\brescheduled\b", r"\bpushed\b", r"\bmerged\b", r"\bdeployed\b", r"\bshipped\b",
    r"\bupdated\b", r"\bfyi\b", r"\bheads up\b", r"\bcheck (it|when|out)\b", r"\breminder\b", r"\bcancell?ed\b",
]
ACK = [r"^(ok|okay|cool|got it|sounds good|noted|sure|great|perfect)\b"]


def classify(text: str, sender: str = "") -> Classification:
    t = " ".join(text.lower().split())

    # 1. Never: requests for personal info (likely spam). Checked first, always wins.
    if _any(PERSONAL_INFO, t) and (_any(REQUEST, t) or _any(SPAM_HINTS, t)):
        return Classification("never", "personal_info", "Asks for personal info. Likely spam, so Aide will decline.")

    # 2. Ask: emotions, money, deadlines, commitments.
    if _any(EMOTION, t):
        return Classification("ask", "emotional", "Emotional message. Needs a personal touch, never auto-sent.")
    if _any(MONEY, t):
        return Classification("ask", "money", "Involves money. Aide never agrees to send money.")
    if _any(MEETING_CONFIRM, t):
        return Classification("auto", "meeting_confirmation", "Simple meeting confirmation.")
    if _any(DEADLINE, t):
        return Classification("ask", "deadline", "Asks for a deadline. Aide won't commit for you.")
    if _any(COMMITMENT, t):
        return Classification("ask", "commitment", "Asks for a commitment. Aide won't agree on your behalf.")

    # 3. Auto: thanks, status updates, acknowledgments.
    if _any(UPDATE, t):
        return Classification("auto", "update", "Status update. Just needs a quick acknowledgment.")
    if _any(THANKS, t):
        return Classification("auto", "thanks", "Low-risk thanks or compliment.")
    if _any(ACK, t):
        return Classification("auto", "ack", "Simple acknowledgment.")

    # 4. Anything else: ask, to be safe.
    return Classification("ask", "general", "No auto-handle rule matched, so it waits for you.")


def stricter(a: str, b: str) -> str:
    return a if BUCKET_RANK[a] >= BUCKET_RANK[b] else b


GROUP_PATTERNS = [
    ("professors", [r"\bprof", r"\bdr\.?\b", r"\bdean\b", r"\blecturer\b", r"\bfaculty\b"]),
    ("clients_recruiters", [r"\brecruit", r"\btalent\b", r"\bhr\b", r"\bhiring\b", r"\bclient\b", r"\bsales\b"]),
    ("team_lead", [r"\bteam lead\b", r"\blead\b", r"\bmanager\b", r"\bboss\b", r"\bsupervisor\b"]),
    ("teammates", [r"\bteammate\b", r"\bteam\b", r"\bcolleague\b", r"^#"]),
    ("friends", [r"\bfriend\b", r"\bbro\b", r"\bbuddy\b", r"\bmom\b", r"\bdad\b"]),
]


def guess_group(sender: str) -> str:
    """Best guess at which people group a sender belongs to, from the name alone."""
    s = sender.lower().strip()
    for group, pats in GROUP_PATTERNS:
        if _any(pats, s):
            return group
    return "unknown"
