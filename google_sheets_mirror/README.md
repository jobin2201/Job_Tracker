# Google Sheets Mirror

This standalone service creates a one-way, per-user Google Sheets mirror of Job Tracker data.

```text
PostgreSQL (source of truth) -> Google Sheets (view-only mirror)
```

It is not imported by FastAPI, the browser extension, LinkedIn, Indeed, or the frontend. Database connections are explicitly read-only. If Google is unavailable, the mirror logs the error and retries without affecting application capture or PostgreSQL.

The standalone mirror must connect as `jobtracker_sheets_reader`, never as the
PostgreSQL administrator. That role is restricted to `SELECT` on `users`,
`applications`, `application_contacts`, `follow_ups`, and
`application_events`. It cannot read OAuth-token tables and cannot insert,
update, or delete application data.

New users should use the authenticated **Connect Google Sheets** control in the
Job Tracker dashboard. The standalone watcher remains available for the
existing personal mirror only.

## Sheets

- Dashboard
- Applications
- Application Details
- Contacts
- Follow-ups
- Timeline

Every application receives a permanent display number (`001`, `002`, ...). The
mapping is stored under ignored local `state/` data, is reused across every tab,
and never reuses a deleted application's number. The PostgreSQL ID is retained
in a hidden details column for diagnostics.

When `GROQ_API_KEY` and `GROQ_MODEL` are configured, job descriptions receive a
short AI summary and skills list. Results are cached by description hash, so an
unchanged job is not sent to Groq again. Groq failures fall back to a local
summary and never block spreadsheet synchronization.

The workbook applies frozen headers, tab colors, alternating rows, wrapped job
descriptions, readable column widths, and Dashboard charts for status and source.

## Google setup

1. In Google Cloud, enable **Google Sheets API**.
2. Create an OAuth client of type **Desktop app**.
3. Download the JSON file to `credentials/client_secret.json`.
4. Copy `.env.example` to `.env`, use the `jobtracker_sheets_reader` credentials,
   and fill in `MIRROR_USER_EMAIL`.

Credential files, tokens, state, and `.env` are ignored by Git.

## Install

```powershell
conda activate jtrack
python -m pip install -r requirements.txt
```

## Safe database-only test

```powershell
python sync.py --dry-run
```

This reads and transforms the selected user's data without contacting Google.

## Create or update the spreadsheet

```powershell
python sync.py
```

The first run opens Google OAuth. Sign in using the same account configured in `MIRROR_USER_EMAIL`. The spreadsheet ID is stored locally and subsequent runs update the same six tabs.

## Silent periodic synchronization

```powershell
python watch.py
```

The default interval is five minutes and can be changed with `SYNC_INTERVAL_SECONDS`. The watcher replaces the mirror contents from the latest PostgreSQL snapshot; it never writes back to PostgreSQL.
