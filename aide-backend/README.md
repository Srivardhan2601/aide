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
| GET | `/api/sent` | | Sent log (`transport`: `gmail` or `mock`) |
| GET | `/api/activity` | | Sent and skipped replies, newest first |
| GET | `/api/learned` | | Replies learned from your edits |
| DELETE | `/api/learned/{id}` | | Forget one |
| GET/PATCH | `/api/profile` | `{formOfAddress?, availability?}` | Edits `config/style_profile.json` |
| GET/PUT | `/api/rules` | `{auto[], ask[], never[]}` | Edits what each bucket covers in `config/rules.json` (hard rules stay fixed) |
| GET/PATCH | `/api/food/profile` | `{area, diet, spice, budgetCap, preferredApp, favorites[], avoid[], notes}` | Food preferences (`config/food_profile.json`) |
| POST | `/api/food/orders` | `{text, app?}` | Plain-language request → planned cart with checks |
| GET | `/api/food/orders` | | Carts, newest first, each with `checks` and `canApprove` |
| PATCH | `/api/food/orders/{id}` | `{items?, restaurant?, budget?, notes?, app?}` | Edit a planned cart |
| POST | `/api/food/orders/{id}/approve` | | Only if no check is blocking. Returns `handoffPrompt` for Claude |
| POST | `/api/food/orders/{id}/ordered` / `cancel` | | Track what happened |
| GET | `/api/health` | | Which drafter is active, and whether Gmail is connected |

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
- **Learning from your edits:** when you change a draft before it's sent, your version is saved in
  the `learned_examples` table (Aide's original draft is kept in `approvals.ai_draft`). The newest 8
  are added to the prompt as examples of your voice, next to `example_replies`. Unchanged replies,
  rewrites from the tone buttons, skipped drafts and "Never" (spam) replies aren't learned. You can
  see and forget them in Settings → "Learned from your edits".
- Every message lands in Approvals for now, whatever its bucket (`auto_send_enabled: false`).

## Deadlines, daily brief, quiet mode, notifications

- **Deadlines** (`app/deadlines.py`): every incoming message is checked for a written date *and*
  what it's for ("report due Monday", "DBMS viva on 12th at 9:30", "review Friday 11 AM",
  "invoice due Nov 15"). Exams, assignments, meetings and payments land on the Tasks screen.
  It's rule-based, so it never guesses: no date, or no purpose, means nothing is added. Dates in
  messages labeled "Never" (spam) are ignored. You can add, tick off and remove your own too.
- **Daily brief** (`GET /api/brief`): the "Today" card on Home shows what needs you, anything
  overdue, due today or tomorrow (exams are called out), the rest of the week, and open food carts.
- **Quiet mode** (`GET/PUT /api/quiet`): for study time. Drafting continues, but only urgent
  messages ("urgent", "asap", "emergency", "call me"…) and people on your allow list can alert
  you. Ending it tells you how many replies are waiting.
- **Notifications** (in the app, per device): new drafts, deadlines an hour before, and the
  morning brief at your chosen time. They appear while Aide is open in a tab or as the installed
  app; turn them on in Settings → Notifications.

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/brief` | | Headline, urgent drafts, overdue/today/tomorrow/this-week deadlines, quiet mode |
| GET | `/api/deadlines?include_done=` | | Sorted by date and time |
| POST | `/api/deadlines` | `{title, kind, dueDate, dueTime?}` | `kind`: exam, assignment, meeting, payment, other |
| PATCH / DELETE | `/api/deadlines/{id}` | `{done?, title?, dueDate?, dueTime?}` | |
| GET / PUT | `/api/quiet` | `{until: ISO or null, allow?: [names]}` | `held` = non-urgent replies waiting |

## Use it on your phone (home Wi-Fi)

Start Aide with **`start-phone.cmd`** (or `start.ps1 -Phone`). If Windows asks about the
firewall, allow **Private networks** only. Then on the computer open **Settings → Use on your
phone**, scan the QR code with your phone (same Wi-Fi) and type the 6-digit PIN.

How it's protected (`app/phone.py`):
- The computer running Aide always has full access. The PIN and the list of paired phones are
  shown only there, never to a phone.
- Other devices can load the app's screens but get **no data** from `/api/*` until paired.
- The PIN is one-time (it changes after each pairing). 5 wrong PINs lock pairing for 10 minutes.
- Each phone gets its own pass (an HttpOnly, Secure cookie, 90 days). Only a hash is stored, and
  you can remove a phone from Settings at any time.
- **HTTPS** (`app/certs.py`, `app/serve.py`): the phone uses `https://<wifi address>:8443`, so its
  mic, notifications and "install as app" work. This computer keeps `http://localhost:8000`, and
  plain HTTP is no longer reachable from the network.
  - The certificate comes from a small "home CA" made on this computer (in `certs/`, git-ignored).
    It is limited to private addresses (10.x, 172.16-31.x, 192.168.x) and no real domain names, so
    even if its key leaked it couldn't be used to fake a real website.
  - Install it on the phone once to remove the "not private" warning: Settings → Use on your
    phone → "Seeing a not private warning?" has the download link and Android/iPhone steps.
  - The server certificate renews itself when your Wi-Fi address changes. Delete `certs/` to
    start over (then reinstall the new one on the phone).
- Use trusted home Wi-Fi only, never public Wi-Fi.

## Talk to Aide (voice)

The mic button at the top opens **Talk to Aide**. Speak (or type) and it answers out loud from
your own data. It's rule-based (`app/voice.py`), so it's instant, free and never makes things up.

- "What's on today?", "What should I study?", "When's my next exam?", "What's due this week?",
  "Any new messages?", "Remind me to submit the lab record Friday at 5 pm" (adds a deadline),
  "Order 2 dosa from MTR" (plans a cart; orders are never placed by voice).
- **Hands-free replies:** "Go through my replies" (or the button on Approvals) reads each
  message and draft, then listens: *send* (asks "Send this to …?" and waits for *yes*), *change
  it* / *make it shorter* / *say I'll send it tonight*, *later* / *after my exam*, *next*,
  *ignore it*, *read it again*, *stop*. Sends still get the normal undo window.
- **Change a draft by voice:** "Say a change" on any approval card, or
  `POST /api/approvals/{id}/revise {instruction}`. Claude rewrites the draft; the same safety
  checks apply. Without a key, the template drafter handles simple changes (shorter, formal,
  warmer, "say …").
- Settings → Voice: language, read answers aloud on/off, speaking speed. Speech recognition
  needs Chrome, Edge or Safari; Chrome sends your audio to Google to turn it into text.

## Conversation memory and weekly recap

- When drafting, Claude also sees the last few messages with that person on that app (theirs,
  and the replies you actually sent; unsent drafts don't count), so replies fit the conversation.
- `GET /api/weekly`: replies sent (vs last week), time saved, typical reply time, how many you
  edited or skipped, deadlines done, and who messaged most. Shown on the Activity screen.

## Food orders (Swiggy / Zomato)

Swiggy and Zomato have official AI ordering connectors, but they don't allow third-party apps
on them yet. So Aide **plans and checks** the cart, and **Claude places it** with the official
connector:

1. In Aide → Food, type what you want ("2 paneer butter masala and 3 butter naan from Punjabi
   Rasoi under 600, less spicy"). `app/food.py` turns it into an editable cart. The parser is
   rule-based, so it never invents dishes.
2. Aide checks the cart against your food preferences: diet (vegetarian/eggetarian/vegan),
   your never-include list, budget cap, and odd quantities. Red checks block approval.
3. **Approval 1 (in Aide):** "Approve cart" shows the full cart and asks you to confirm.
4. Aide copies precise instructions and opens Claude. **Approval 2 (in Claude):** Claude
   must build exactly that cart, show you the real cart with prices, point out anything
   missing or substituted, and place it only after you reply "yes, place it".

One-time setup in Claude: Settings → Connectors → add Swiggy (`https://mcp.swiggy.com/food`).
Zomato needs access requested first ([Zomato's connector page](https://github.com/Zomato/mcp-server-manifest)).
Through these connectors, Swiggy is cash on delivery and orders can't be cancelled; Zomato is paid by QR code.

## Study planner, snooze, search, people, backup, auto-send

- **Study planner** (`app/planner.py`, `/api/study…`): add an exam with its date and topics (or
  pick one Aide found in your messages). Topics are spread across the days before the exam, with a
  full revision the day before. Tick sessions off; missed ones move forward when you replan. Set
  your daily study time in the Study screen.
- **Snooze** (`POST /api/approvals/{id}/snooze`): "Later" on a draft hides it until the time you
  pick (in an hour, this evening, tomorrow morning, after your next exam…), then it comes back.
- **Search** (`GET /api/search?q=`): messages, deadlines, food carts, people and study topics.
- **People** (`/api/people`): short notes about someone ("my project guide, keep it formal").
  Claude reads them when drafting replies to that person.
- **Backup and restore** (`GET /api/backup`, `POST /api/backup/restore`, this computer only): one
  JSON file with all your data and settings. Phone pairing secrets are never included. A restore
  saves a safety copy of the current data to `backups/` first and rolls back on any error.
- **Auto-send** (off by default, this computer only): sends only simple, high-confidence, non-urgent
  replies to people you've already replied to, up to a daily cap, with the usual undo window.
- **Voice:** a mic on chat, search, quick capture, food, deadlines, study topics and people notes.
  Pick the language in Settings → Voice. Quick capture (`POST /api/capture`) routes what you say:
  "order 2 dosa from MTR" becomes a food cart, "OS lab exam on 20th at 2 pm" becomes a deadline,
  anything else goes to chat.

## Still needed from you

1. **5-10 real replies you've sent** → `example_replies` in `config/style_profile.json`.
   This matters most for drafts that sound like you.
2. Confirm how Aide should address you (`form_of_address`, currently "Sri Vardhan").
3. Confirm your usual availability (`availability`, currently "evenings").
4. `ANTHROPIC_API_KEY` as an environment variable (never pasted into code). To keep it set for
   every new terminal, run this once: `setx ANTHROPIC_API_KEY "<your key>"`, then open a new terminal.
5. Optional: connect Gmail by following [GMAIL_SETUP.md](GMAIL_SETUP.md) (about 10 minutes).
