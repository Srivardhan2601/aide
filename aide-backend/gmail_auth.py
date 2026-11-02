"""One-time Gmail sign-in for Aide.

1. Put the OAuth client file from Google Cloud at  aide-backend/secrets/credentials.json
   (step-by-step in GMAIL_SETUP.md).
2. Run:  python gmail_auth.py
3. A browser window opens. Sign in and allow Aide to read your inbox and send replies.

This saves aide-backend/secrets/token.json. Both files are private: they're git-ignored,
so never move them out of the secrets folder or share them.
"""
import sys

from app.gmail import CREDENTIALS_FILE, SCOPES, SECRETS_DIR, TOKEN_FILE


def main() -> int:
    if not CREDENTIALS_FILE.exists():
        print(f"Missing {CREDENTIALS_FILE}\nDownload your OAuth client (Desktop app) from Google Cloud and save it there.\nSee GMAIL_SETUP.md.")
        return 1
    from google_auth_oauthlib.flow import InstalledAppFlow

    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
    creds = flow.run_local_server(port=0, prompt="consent")
    SECRETS_DIR.mkdir(exist_ok=True)
    TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
    print(f"Signed in. Saved {TOKEN_FILE}.\nNow start Aide with Gmail on:  $env:AIDE_GMAIL = 'on'; uvicorn app.main:app --port 8000")
    return 0


if __name__ == "__main__":
    sys.exit(main())
