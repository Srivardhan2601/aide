"""Hard-rule checks on draft *text* (not just the label)."""
import pytest

from app.classifier import classify
from app.drafter import Draft, MockDrafter, enforce_floor
from app.guardrails import violations


def claude_says(text: str, sender: str, draft: str, bucket: str = "auto") -> Draft:
    """Pretend Claude returned `draft`, then run it through the safety floor."""
    d = Draft(draft=draft, confidence="high", bucket=bucket, reason="model reason")
    return enforce_floor(d, text, sender, channel="whatsapp")


@pytest.mark.parametrize("text,sender,bad_draft", [
    ("Bro can you send me ₹2,000? I'll return it Sunday.", "Friend", "Sure bro, sending it now!"),
    ("Bro can you send me ₹2,000? I'll return it Sunday.", "Friend", "No problem, I'll transfer it tonight."),
    ("Can you get the report done by Monday?", "Team lead", "Yes, I'll have it done by Monday."),
    ("Can you get the report done by Monday?", "Team lead", "Consider it done!"),
    ("Would you like to collab next month?", "@maya.designs", "Count me in, let's do it!"),
    ("We'd like to schedule a 30-min intro call this week.", "Recruiter", "Thursday 3 PM works for me, see you then."),
    ("Hi, send me your address and phone number for the prize.", "Unknown number", "Sure! It's 42 MG Road, call me on 98765 43210."),
    ("Hi, send me your address and phone number for the prize.", "Unknown number", "Here you go, happy to help."),
])
def test_rule_breaking_drafts_are_replaced(text, sender, bad_draft):
    out = claude_says(text, sender, bad_draft)
    assert out.draft != bad_draft
    assert out.confidence == "low"
    assert "safe reply" in out.reason
    assert violations(out.draft, classify(text, sender)) == []  # the replacement itself is clean


@pytest.mark.parametrize("text,sender,good_draft", [
    ("Bro can you send me ₹2,000? I'll return it Sunday.", "Friend", "Let me check and get back to you on this."),
    ("Can you get the report done by Monday?", "Team lead", "Let me look at my plate and confirm a timeline today."),
    ("Would you like to collab next month?", "@maya.designs", "Thanks! Could you share a bit more about what you have in mind?"),
    ("Please confirm you'll attend Friday's 11 AM review.", "Professor", "Good morning Professor, I'll be there. Thank you."),
    ("Standup moved to 4 PM today.", "Teammate", "Noted, see you at 4."),
    ("Had a really rough day. Everything feels like too much.", "Close friend", "I'm so sorry. Want to talk tonight?"),
])
def test_good_drafts_are_kept(text, sender, good_draft):
    out = claude_says(text, sender, good_draft)
    assert out.draft == good_draft
    assert out.confidence == "high"


def test_label_still_only_gets_stricter():
    out = claude_says("Bro can you send me ₹2,000?", "Friend", "Let me get back to you.", bucket="auto")
    assert out.bucket == "ask"


def test_dates_and_amounts_are_not_mistaken_for_phone_numbers():
    c = classify("Standup moved to 4 PM today.", "Teammate")
    assert violations("Noted. Moved to 2026-10-24 at 16:00, budget ₹2,000.", c) == []
    assert violations("Call me at +91 98765 43210", c) == ["shares personal details"]
    assert violations("Mail me at sri@example.com", c) == ["shares personal details"]


def test_every_template_passes_its_own_rules(samples):
    """The safe replacements must never trip the check themselves, in any tone."""
    mock = MockDrafter()
    for s in samples:
        c = classify(s["text"], s["from"])
        for tone in ("default", "shorter", "warmer", "formal"):
            d = mock.draft(channel=s["channel"], sender=s["from"], text=s["text"], tone=tone)
            assert violations(d.draft, c) == [], (s["text"], tone, d.draft)
