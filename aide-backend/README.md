# Aide backend

FastAPI + SQLite backend for Aide. It drafts replies to incoming messages, puts them in an
approval queue and serves the `aide-ui` folder at `/`, so the UI and API share one origin.

**Sending:** approved Gmail replies are sent through Gmail when it's connected (off by default;
see [GMAIL_SETUP.md](GMAIL_SETUP.md)). Every other channel is mocked: `app/sender.py`
`send_reply()` writes the reply to the `sent` table and logs it.

**Easiest way to run it:** double-click `start.cmd` in the main `aide` folder (or
`start-with-gmail.cmd` once Gmail is set up). It sets everything up on first run.

## Run it (Windows, PowerShell)

> **Folder path length:** keep this project in a short path such as `D:\aide`. Windows can't load
> Python's compiled packages (pydantic-core) from very deep folders, because of its 260-character
> path limit.

```powershell
cd D:\aide\aide-backend
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Optional: real AI drafts. Without a key, a template "mock" drafter is used.
$env:ANTHROPIC_API_KEY = "<your key>"        # this terminal session only; never put it in a file
# $env:AIDE_MODEL = "claude-sonnet-5-5"      # cheaper; default is claude-opus-5-5

uvicorn app.main:app --port 8000
```

In a second terminal:

```powershell
cd D:\aide\aide-backend
.\.venv\Scripts\Activate.ps1
python seed.py            # posts the 10 sample messages
start http://localhost:8000
```

Tests (no API key needed): `python -m pytest`

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | not set: mock drafter | Claude API key. Read only from the environment |
| `AIDE_MODEL` | `claude-opus-5-5` | Model used for drafts (`claude-sonnet-5-5` costs about half) |
| `AIDE_FALLBACKS` | `default` | Server-side refusal fallback (`off` to disable) |
| `AIDE_GMAIL` | `off` | `on` to read your inbox and send approved replies via Gmail |
| `AIDE_GMAIL_POLL_SECONDS` | `60` | How often to check Gmail |
| `AIDE_UNDO_SECONDS` | `5` | Undo window after Approve |
| `AIDE_DB` | `aide-backend/aide.db` | SQLite file |
| `AIDE_UI_DIR` | `../aide-ui` | Folder served at `/` |

## API

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/messages` | `{channel, from, text}` | Stores it, drafts a reply, returns the pending approval |
| GET | `/api/approvals?status=pending` | | `status`: pending, sending, sent, rejected (optional) |
| GET | `/api/approvals/{id}` | | |
| PATCH | `/api/approvals/{id}` | `{draft}` | Edit (pending only) |
| POST | `/api/approvals/{id}/reject` | | Skip |
| POST | `/api/approvals/{id}/regenerate` | `{tone: shorter, warmer or formal}` | |
| POST | `/api/approvals/{id}/approve` | `{draft?}` | Status becomes `sending`, `sendAt` = now + 5s |
| POST | `/api/approvals/{id}/undo` | | Only before `sendAt`; back to `pending` |
| GET | `/api/stats` | | `{handledToday, pending, timeSavedMinutes, streakDays, timeSavedWeek[7]}` |
| GET | `/api/sent` | | Mock "sent" log |
| GET | `/api/health` | | Which drafter is active |

## How drafting works

- `config/style_profile.json` and `config/rules.json` are loaded on **every** draft, so edits apply
  without a restart.
- `app/classifier.py` labels each message `auto`, `ask` or `never` with rules. When Claude drafts,
  the stored label is the **stricter** of Claude's and the classifier's: the model can tighten a
  label but never loosen it.
- `app/drafter.py` builds the prompt from the profile and rules and asks Claude for structured JSON
  (`draft`, `confidence`, `bucket`, `reason`). If the API errors or declines, it falls back to a
  template draft marked low confidence.
- `app/guardrails.py` checks the draft **text** too: if Claude's reply agrees to send money, agrees
  to a deadline, commits you to something, or contains personal details (phone numbers, emails,
  addresses), it's replaced with the safe template for that kind of message and marked low
  confidence, with the reason shown on the card.
- `app/gmail.py` reads unread Primary-inbox mail into the queue and sends approved replies in the
  original thread. It only has read and send access, and never marks mail as read.
- Every message lands in Approvals for now, whatever its bucket (`auto_send_enabled: false`).

## Still needed from you

1. **5-10 real replies you've sent** → `example_replies` in `config/style_profile.json`.
   This matters most for drafts that sound like you.
2. Confirm how Aide should address you (`form_of_address`, currently "Sri Vardhan").
3. Confirm your usual availability (`availability`, currently "evenings").
4. `ANTHROPIC_API_KEY` as an environment variable (never pasted into code). To keep it set for
   every new terminal, run this once: `setx ANTHROPIC_API_KEY "<your key>"`, then open a new terminal.
5. Optional: connect Gmail by following [GMAIL_SETUP.md](GMAIL_SETUP.md) (about 10 minutes).
