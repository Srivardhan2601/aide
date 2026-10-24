"""POST the 10 sample messages to a running Aide server.

Usage:  python seed.py [base_url]        (default http://localhost:8000)
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

FIXTURES = Path(__file__).parent / "tests" / "fixtures" / "sample_messages.json"


def main() -> int:
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
    samples = json.loads(FIXTURES.read_text(encoding="utf-8"))
    mismatches = 0
    for s in samples:
        body = json.dumps({"channel": s["channel"], "from": s["from"], "text": s["text"]}).encode()
        req = urllib.request.Request(f"{base}/api/messages", data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                a = json.loads(resp.read())
        except urllib.error.URLError as e:
            print(f"Couldn't reach {base}: {e}. Is the server running?")
            return 1
        ok = a["bucket"] == s["expected_bucket"]
        mismatches += not ok
        print(f"#{a['id']:<3} {s['channel']:<9} {s['from']:<15} {a['bucket']:<5} "
              f"{'ok' if ok else 'EXPECTED ' + s['expected_bucket']:<14} {a['draft'][:70]!r}")
    print(f"\nSeeded {len(samples)} messages. Bucket mismatches: {mismatches}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
