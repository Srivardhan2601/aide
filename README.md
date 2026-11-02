# Aide

A personal assistant that drafts replies to your messages in your own voice and waits for your OK before sending anything.

- **`aide-ui/`**: the app (Home, Approvals, Chat, Activity, Apps…). Plain HTML/CSS/JS, installable on your phone. See [aide-ui/README.md](aide-ui/README.md).
- **`aide-backend/`**: FastAPI + SQLite server. It drafts replies with Claude using your style profile and rules, keeps the approval queue, and sends after a 5-second undo window (sending is mocked for now). See [aide-backend/README.md](aide-backend/README.md).

## Quick start

**Double-click `start.cmd`.** The first run sets everything up, then the app opens at
http://localhost:8000. Use `start-with-gmail.cmd` once Gmail is connected
(see [aide-backend/GMAIL_SETUP.md](aide-backend/GMAIL_SETUP.md)).

### Manual start (PowerShell)

```bash
cd aide-backend
```
```bash
python -m venv .venv
```
```bash
.\.venv\Scripts\Activate.ps1
```
```bash
pip install -r requirements.txt
```
```bash
uvicorn app.main:app --port 8000
```

Open http://localhost:8000. Without `ANTHROPIC_API_KEY` set, a built-in mock drafter is used. To load the 10 sample messages, run `python seed.py` in a second terminal.

Your API key is read from the `ANTHROPIC_API_KEY` environment variable only. Never commit it.
