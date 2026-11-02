"""Settings and the style profile / rules files."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = BACKEND_DIR / "config"
DEFAULT_UI_DIR = BACKEND_DIR.parent / "aide-ui"
DEFAULT_DB = BACKEND_DIR / "aide.db"

DEFAULT_MODEL = "claude-opus-5-5"  # set AIDE_MODEL=claude-sonnet-5-5 for roughly half the cost

# Channels the UI knows about (aide-ui/mock-data.js `channels`).
CHANNELS = ("gmail", "outlook", "whatsapp", "instagram", "x", "telegram", "slack", "linkedin", "calendar")

BUCKET_LABELS = {"auto": "Auto-handle", "ask": "Ask first", "never": "Never"}
BUCKET_RANK = {"auto": 0, "ask": 1, "never": 2}
MINUTES_PER_REPLY = 3


@dataclass
class Settings:
    db_path: Path = DEFAULT_DB
    ui_dir: Path = DEFAULT_UI_DIR
    undo_seconds: float = 5.0
    model: str = DEFAULT_MODEL
    # Server-side refusal fallbacks ("default" or "off"). See drafter.py.
    fallbacks: str = "default"
    # Gmail: off unless AIDE_GMAIL=on (and you've run gmail_auth.py). See GMAIL_SETUP.md.
    gmail: bool = False
    gmail_poll_seconds: float = 60.0
    cors_origins: list[str] = field(default_factory=lambda: [
        "http://localhost:8000", "http://127.0.0.1:8000",
        "http://localhost:5173", "http://127.0.0.1:5173",
    ])

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            db_path=Path(os.environ.get("AIDE_DB", DEFAULT_DB)),
            ui_dir=Path(os.environ.get("AIDE_UI_DIR", DEFAULT_UI_DIR)),
            undo_seconds=float(os.environ.get("AIDE_UNDO_SECONDS", "5")),
            model=os.environ.get("AIDE_MODEL", DEFAULT_MODEL),
            fallbacks=os.environ.get("AIDE_FALLBACKS", "default"),
            gmail=os.environ.get("AIDE_GMAIL", "off").lower() in ("on", "1", "true", "yes"),
            gmail_poll_seconds=float(os.environ.get("AIDE_GMAIL_POLL_SECONDS", "60")),
        )


def load_json(name: str) -> dict:
    with open(CONFIG_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def load_profile() -> dict:
    """Read fresh on every draft so edits to the file apply without a restart."""
    return load_json("style_profile.json")


def load_rules() -> dict:
    return load_json("rules.json")
