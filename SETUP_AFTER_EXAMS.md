# Aide setup checklist (after exams)

About 20 minutes in total. Steps 1–3 make the biggest difference; 4–6 are optional.
Nothing here sends a message or places an order: every reply still waits for your OK.

---

## 1. Tell Aide about you (1 min)

1. Double-click **`start.cmd`**. The app opens at http://localhost:8000.
2. Go to **Settings → About you**.
3. Check how Aide should address you and when you're usually free (both say *Please confirm*),
   then tap **Save**.

## 2. Add your Claude key (3 min)

Without it, drafts come from simple templates. With it, they sound like you.

1. Get a key at https://console.anthropic.com → **API Keys** → **Create key**. Copy it.
2. In Windows, press Start and type **"environment variables"**, then open
   **Edit environment variables for your account**.
3. Under *User variables*, click **New**:
   - Name: `ANTHROPIC_API_KEY`
   - Value: paste your key
4. Click **OK** twice. Close any open Aide window and double-click `start.cmd` again.
5. Check: the black Aide window should **not** say "ANTHROPIC_API_KEY is not set".

Never paste the key into a file in the `aide` folder, a chat, or GitHub.
To spend about half as much, add a second variable `AIDE_MODEL` = `claude-sonnet-5-5`.

## 3. Use Aide on your phone (5 min)

1. Phone and laptop on the **same home Wi-Fi** (not public or college Wi-Fi).
2. Double-click **`start-phone.cmd`**. If Windows asks about the firewall, allow
   **Private networks** only.
3. On the laptop: **Settings → Use on your phone**. Scan the QR code with your phone.
4. The phone will warn that the link "isn't private". That's expected the first time. Fix it once:
   - Open **"Seeing a not private warning? Fix it once"** (just under the QR code) and download
     **aide-home-ca.crt** on the phone.
   - **Android:** Settings → search "CA certificate" → Install anyway → pick the file.
   - **iPhone:** Settings → Profile Downloaded → Install. Then General → About →
     Certificate Trust Settings → turn on "Aide home CA".
   - The certificate only works for addresses on your home network, so it can't be used to
     fake real websites.
5. Reopen the link and enter the 6-digit PIN shown on the laptop.
6. Optional: in the browser menu, **Add to Home screen**, so Aide opens like an app.

**Try the voice:** tap the 🎤 at the top and say "What's on today?". If the mic doesn't work,
make sure the address starts with `https://` and the browser has microphone permission.

## 4. Connect Gmail (10 min, optional)

Follow [aide-backend/GMAIL_SETUP.md](aide-backend/GMAIL_SETUP.md). Then start with
**`start-with-gmail.cmd`**.

To use Gmail **and** your phone together, open PowerShell in the `aide` folder and run:

```bash
.\start.ps1 -Gmail -Phone
```

## 5. Order food through Claude (2 min, optional)

In Claude: **Settings → Connectors → add Swiggy** (`https://mcp.swiggy.com/food`).
Aide plans and checks the cart; Claude shows you the real cart and orders only after you say
"yes, place it". Swiggy orders through this are cash on delivery and can't be cancelled.

## 6. Teach Aide your style (5 min, optional)

Aide already learns from every draft you edit before sending. To get there faster, add 5–10
real replies you've sent to `example_replies` in `aide-backend/config/style_profile.json`.

---

### If something looks wrong

- **The app doesn't open:** look at the black Aide window for a red error line.
- **Phone can't connect:** the laptop's Wi-Fi address may have changed. Reopen
  Settings → Use on your phone and scan the new code.
- **Gmail stopped working:** run `.\.venv\Scripts\python.exe gmail_auth.py` again from the
  `aide-backend` folder (see GMAIL_SETUP.md).
- **Something broke after an update:** Settings → Backup has a copy of your data. Download one
  before big changes.
