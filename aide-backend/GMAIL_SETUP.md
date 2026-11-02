# Connect Gmail to Aide

About 10 minutes, once. After this, new emails show up in Approvals as drafts, and approved
replies are sent from your Gmail in the original thread.

**What Aide can and can't do with your Gmail**
- Reads unread mail in your Primary inbox from the last 2 days, checking every minute.
  Promotions, Social and Updates are skipped.
- Sends a reply **only after you approve it**, after the 5-second undo window.
- Can't delete, archive, label or mark anything as read. It only asks for "read" and "send" access.

## 1. Create a Google Cloud project (free)

1. Go to https://console.cloud.google.com and sign in with the Gmail account you want Aide to use.
2. At the top, click the project picker, then **New project**. Name it `Aide` and click **Create**.

## 2. Turn on the Gmail API

1. Open **APIs & Services → Library**.
2. Search for **Gmail API**, open it, and click **Enable**.

## 3. Set up the consent screen

1. Open **APIs & Services → OAuth consent screen** (it may be called **Google Auth Platform**).
2. Click **Get started**. App name: `Aide`. Support email: your Gmail. Audience: **External**.
   Contact email: your Gmail. Agree and click **Create**.
3. Under **Audience → Test users**, click **Add users** and add your own Gmail address.

## 4. Create the sign-in file

1. Open **APIs & Services → Credentials**.
2. Click **Create credentials → OAuth client ID**.
3. Application type: **Desktop app**. Name: `Aide`. Click **Create**.
4. Click **Download JSON**.
5. Create the folder `aide-backend\secrets` and save the file there as **`credentials.json`**.

The `secrets` folder is git-ignored, so it never goes to GitHub. Don't share it with anyone.

## 5. Sign in once

In PowerShell, from the `aide-backend` folder:

```bash
.\.venv\Scripts\python.exe gmail_auth.py
```

A browser window opens. Pick your account. Google will say **"Google hasn't verified this app"**:
that's expected, because it's your own private app. Click **Continue**, then allow access.

This saves `aide-backend\secrets\token.json`.

## 6. Start Aide with Gmail on

Double-click **`start-with-gmail.cmd`** in the main `aide` folder, or run:

```bash
.\start.ps1 -Gmail
```

New emails appear in Approvals within a minute. Check the terminal for `Gmail: connected`.

## If something goes wrong

- **"token.json is missing"**: you skipped step 5.
- **"Gmail sign-in has expired"**: while the app is in "Testing" mode, Google expires the sign-in
  after 7 days. Run step 5 again. (Publishing the app removes this limit, but needs Google's review.)
- **Nothing shows up**: only *unread* Primary-inbox mail from the last 2 days is picked up.
- **To disconnect**: delete `aide-backend\secrets\token.json`, and remove Aide's access at
  https://myaccount.google.com/permissions
