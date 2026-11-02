"""Hard-rule checks on the draft text itself.

The classifier keeps the *label* safe (Claude can only make it stricter). This module
keeps the *text* safe: if a Claude draft agrees to a deadline, agrees to send money,
commits the user to something, or leaks personal info, the caller replaces it with a
safe, non-committal template. Every draft still waits for approval either way.

These are deliberately simple patterns. They catch the common ways a draft breaks a
rule; they're a safety net, not a guarantee.
"""
from __future__ import annotations

import re

from .classifier import Classification


def _hits(patterns: list[str], text: str) -> bool:
    return any(re.search(p, text) for p in patterns)


# Personal details the user's reply must never contain, whatever the message was.
LEAKS = [
    r"[\w.+-]+@[\w-]+\.[\w.]+",                     # email addresses
    r"\bmy (home |postal )?address is\b",
    r"\bmy (phone|mobile|number|upi|account|otp|password|pin)\b[^.?!]{0,20}\b(is|:)",
    r"\b(otp|pin|password|cvv)\b[^.?!]{0,10}\b(is|:)\s*\S",
]

DECLINES = [r"\b(don'?t|do not|can'?t|cannot|won'?t|will not|not comfortable)\b[^.?!]{0,30}\bshare\b",
            r"\b(sorry|no thanks|not interested)\b"]

AGREE_MONEY = [
    r"\b(i'?ll|i will|i can|i'?m going to|let me)\s+(send|transfer|pay|lend|gpay|upi|venmo|paypal)\b",
    r"\b(sending|sent|transferred|paid)\s+(it|you|the|now|over|₹|rs\.?|\$|\d)",
    r"^\W*(sure|yes|yeah|yep|of course|no problem|done|ok(ay)?)\b",
]

AGREE_DEADLINE = [
    r"\b(i'?ll|i will|will|can)\s+(have|get)\s+(it|this|that|the \w+)\s+(done|ready|finished|over|in)\b",
    r"\b(i'?ll|i will|it'?ll|it will)\s+be\s+(done|ready|finished)\b",
    r"\bconsider it done\b",
    r"^\W*(yes|yeah|yep|sure|of course|no problem|definitely|absolutely)\b",
]

AGREE_COMMITMENT = [
    r"\b(i'?m in|count me in|let'?s do it|deal|it'?s a date)\b",
    r"\b(works for me|see you (on|at|then|there))\b",
    r"\b(i'?ll|i will)\s+(be there|join|attend|come|do it)\b",
    r"\b(confirmed|booked|locked in)\b",
    r"^\W*(yes|yeah|yep|sure|absolutely|definitely)\b[^.?!]*\b(i'?d love|let'?s|i can|i'?ll)\b",
]


def _has_long_number(t: str) -> bool:
    """Phone / account-like numbers: 9+ digits, allowing spaces, dashes, dots, brackets."""
    return any(sum(ch.isdigit() for ch in m) >= 9 for m in re.findall(r"\+?\d[\d\s().-]{7,}\d", t))


def violations(draft: str, c: Classification) -> list[str]:
    """Return the hard rules this draft breaks (empty list = fine)."""
    t = " ".join(draft.lower().split())
    found = []
    if _hits(LEAKS, t) or _has_long_number(t):
        found.append("shares personal details")
    if c.category == "personal_info" and not _hits(DECLINES, t):
        found.append("doesn't decline a request for personal info")
    if c.category == "money" and _hits(AGREE_MONEY, t):
        found.append("agrees to money")
    if c.category == "deadline" and _hits(AGREE_DEADLINE, t):
        found.append("agrees to a deadline")
    if c.category == "commitment" and _hits(AGREE_COMMITMENT, t):
        found.append("commits you to something")
    return found
