import json
import os
import tempfile
from pathlib import Path

import pytest

# Make sure importing app.main (which builds a module-level app) never touches the real DB
# or the real API, whatever the developer's shell has set.
_tmp = Path(__file__).resolve().parent.parent / ".pytest_tmp" / "import"
_tmp.mkdir(parents=True, exist_ok=True)
os.environ["AIDE_DB"] = str(Path(_tmp) / "import.db")
os.environ.pop("ANTHROPIC_API_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.drafter import MockDrafter  # noqa: E402
from app.main import create_app  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures" / "sample_messages.json"
UNDO_SECONDS = 0.6  # short window so the tests run fast; the real default is 5s


@pytest.fixture
def samples():
    return json.loads(FIXTURES.read_text(encoding="utf-8"))


@pytest.fixture
def client(tmp_path):
    settings = Settings(db_path=tmp_path / "test.db", undo_seconds=UNDO_SECONDS)
    app = create_app(settings, drafter=MockDrafter())
    with TestClient(app) as c:  # runs the lifespan, so the background sender is live
        c.app_ref = app
        yield c
