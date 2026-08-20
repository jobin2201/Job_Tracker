import os
from datetime import datetime, timezone

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from .sheet_builder import SHEET_ORDER


SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def credentials_from_token(token: dict) -> Credentials:
    expiry = token.get("expires_at")
    credentials = Credentials(
        token=token.get("access_token") or token.get("token"),
        refresh_token=token.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        scopes=SCOPES,
        # google-auth internally compares expiry with a naive UTC timestamp.
        expiry=datetime.fromtimestamp(float(expiry), timezone.utc).replace(tzinfo=None) if expiry else None,
    )
    if not credentials.valid and credentials.refresh_token:
        credentials.refresh(Request())
    if not credentials.valid:
        raise RuntimeError("Google Sheets authorization has expired; reconnect Google Sheets")
    return credentials


def refreshed_token(credentials: Credentials, original: dict) -> dict:
    return {
        "access_token": credentials.token,
        "refresh_token": credentials.refresh_token or original.get("refresh_token"),
        "expires_at": credentials.expiry.timestamp() if credentials.expiry else None,
        "scope": " ".join(SCOPES),
    }


def replace_sheet(credentials: Credentials, spreadsheet_id: str, title: str, sheets: dict[str, list[list]]) -> tuple[str, str]:
    service = build("sheets", "v4", credentials=credentials, cache_discovery=False)
    if not spreadsheet_id:
        result = service.spreadsheets().create(body={
            "properties": {"title": title},
            "sheets": [{"properties": {"title": name}} for name in SHEET_ORDER],
        }).execute()
        spreadsheet_id = result["spreadsheetId"]
    metadata = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    if metadata.get("properties", {}).get("title") != title:
        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{
                "updateSpreadsheetProperties": {
                    "properties": {"title": title},
                    "fields": "title",
                },
            }]},
        ).execute()
    existing = {item["properties"]["title"]: item["properties"]["sheetId"] for item in metadata["sheets"]}
    missing = [name for name in SHEET_ORDER if name not in existing]
    if missing:
        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{"addSheet": {"properties": {"title": name}}} for name in missing]},
        ).execute()
        metadata = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        existing = {item["properties"]["title"]: item["properties"]["sheetId"] for item in metadata["sheets"]}
    service.spreadsheets().values().batchClear(
        spreadsheetId=spreadsheet_id,
        body={"ranges": [f"'{name}'!A:Z" for name in SHEET_ORDER]},
    ).execute()
    service.spreadsheets().values().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={
            "valueInputOption": "RAW",
            "data": [{"range": f"'{name}'!A1", "values": sheets[name]} for name in SHEET_ORDER],
        },
    ).execute()
    requests = []
    colors = [
        {"red": .10, "green": .29, "blue": .24}, {"red": .16, "green": .46, "blue": .36},
        {"red": .17, "green": .36, "blue": .55}, {"red": .43, "green": .31, "blue": .62},
        {"red": .80, "green": .48, "blue": .13}, {"red": .25, "green": .31, "blue": .42},
    ]
    for index, name in enumerate(SHEET_ORDER):
        sheet_id = existing[name]
        columns = max((len(row) for row in sheets[name]), default=1)
        requests.extend([
            {"updateSheetProperties": {"properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": 1, "frozenColumnCount": 1}, "tabColorStyle": {"rgbColor": colors[index]}}, "fields": "gridProperties.frozenRowCount,gridProperties.frozenColumnCount,tabColorStyle"}},
            {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": columns}, "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": colors[index]}, "textFormat": {"foregroundColor": {"red": 1, "green": 1, "blue": 1}, "bold": True}, "horizontalAlignment": "CENTER"}}, "fields": "userEnteredFormat"}},
            {"autoResizeDimensions": {"dimensions": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": columns}}},
        ])
    service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": requests}).execute()
    return spreadsheet_id, f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}"
