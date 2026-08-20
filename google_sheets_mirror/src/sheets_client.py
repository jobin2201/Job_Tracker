import json
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from .config import Settings
from .transformer import SHEET_ORDER


SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


class GoogleSheetsMirror:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.service = build("sheets", "v4", credentials=self._credentials(), cache_discovery=False)

    def _credentials(self) -> Credentials:
        credentials = None
        if self.settings.token_file.exists():
            credentials = Credentials.from_authorized_user_file(str(self.settings.token_file), SCOPES)
        if credentials and credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())
        if not credentials or not credentials.valid:
            if not self.settings.client_secrets_file.exists():
                raise FileNotFoundError(f"Missing Google OAuth file: {self.settings.client_secrets_file}")
            flow = InstalledAppFlow.from_client_secrets_file(str(self.settings.client_secrets_file), SCOPES)
            credentials = flow.run_local_server(port=0)
        self.settings.token_file.parent.mkdir(parents=True, exist_ok=True)
        self.settings.token_file.write_text(credentials.to_json(), encoding="utf-8")
        return credentials

    def _saved_spreadsheet_id(self) -> str:
        if self.settings.spreadsheet_id:
            return self.settings.spreadsheet_id
        if self.settings.state_file.exists():
            return json.loads(self.settings.state_file.read_text(encoding="utf-8")).get("spreadsheet_id", "")
        return ""

    def _save_spreadsheet_id(self, spreadsheet_id: str) -> None:
        self.settings.state_file.parent.mkdir(parents=True, exist_ok=True)
        self.settings.state_file.write_text(json.dumps({"spreadsheet_id": spreadsheet_id}, indent=2), encoding="utf-8")

    def spreadsheet(self) -> tuple[str, str]:
        spreadsheet_id = self._saved_spreadsheet_id()
        if not spreadsheet_id:
            result = self.service.spreadsheets().create(body={
                "properties": {"title": f"MyStratos — {self.settings.user_email}"},
                "sheets": [{"properties": {"title": title}} for title in SHEET_ORDER],
            }).execute()
            spreadsheet_id = result["spreadsheetId"]
            self._save_spreadsheet_id(spreadsheet_id)
            return spreadsheet_id, result["spreadsheetUrl"]
        metadata = self.service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        title = f"MyStratos — {self.settings.user_email}"
        if metadata.get("properties", {}).get("title") != title:
            self.service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": [{
                    "updateSpreadsheetProperties": {
                        "properties": {"title": title},
                        "fields": "title",
                    },
                }]},
            ).execute()
        existing = {sheet["properties"]["title"] for sheet in metadata["sheets"]}
        missing = [title for title in SHEET_ORDER if title not in existing]
        if missing:
            self.service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": [{"addSheet": {"properties": {"title": title}}} for title in missing]},
            ).execute()
        return spreadsheet_id, f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}"

    def replace_all(self, sheets: dict[str, list[list]]) -> str:
        spreadsheet_id, spreadsheet_url = self.spreadsheet()
        ranges = [f"'{title}'!A:Z" for title in SHEET_ORDER]
        self.service.spreadsheets().values().batchClear(
            spreadsheetId=spreadsheet_id, body={"ranges": ranges}
        ).execute()
        data = [{"range": f"'{title}'!A1", "values": sheets[title]} for title in SHEET_ORDER]
        self.service.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"valueInputOption": "RAW", "data": data},
        ).execute()
        self._format(spreadsheet_id, sheets)
        return spreadsheet_url

    def _format(self, spreadsheet_id: str, sheets: dict[str, list[list]]) -> None:
        metadata = self.service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets(properties(sheetId,title),charts(chartId),bandedRanges(bandedRangeId))",
        ).execute()
        info = {sheet["properties"]["title"]: sheet for sheet in metadata["sheets"]}
        requests = []
        palette = {
            "Dashboard": {"red": 0.10, "green": 0.29, "blue": 0.24},
            "Applications": {"red": 0.16, "green": 0.46, "blue": 0.36},
            "Application Details": {"red": 0.17, "green": 0.36, "blue": 0.55},
            "Contacts": {"red": 0.43, "green": 0.31, "blue": 0.62},
            "Follow-ups": {"red": 0.80, "green": 0.48, "blue": 0.13},
            "Timeline": {"red": 0.25, "green": 0.31, "blue": 0.42},
        }
        for title in SHEET_ORDER:
            sheet = info[title]
            sheet_id = sheet["properties"]["sheetId"]
            row_count = max(len(sheets[title]), 1)
            column_count = max((len(row) for row in sheets[title]), default=1)
            for chart in sheet.get("charts", []):
                requests.append({"deleteEmbeddedObject": {"objectId": chart["chartId"]}})
            for banding in sheet.get("bandedRanges", []):
                requests.append({"deleteBanding": {"bandedRangeId": banding["bandedRangeId"]}})
            requests.extend([
                {"updateSheetProperties": {
                    "properties": {
                        "sheetId": sheet_id,
                        "tabColorStyle": {"rgbColor": palette[title]},
                        "gridProperties": {"frozenRowCount": 0 if title == "Dashboard" else 1, "frozenColumnCount": 1},
                    },
                    "fields": "tabColorStyle,gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
                }},
                {"repeatCell": {
                    "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": row_count, "startColumnIndex": 0, "endColumnIndex": column_count},
                    "cell": {"userEnteredFormat": {
                        "verticalAlignment": "MIDDLE",
                        "wrapStrategy": "WRAP",
                        "textFormat": {"fontFamily": "Arial", "fontSize": 10},
                    }},
                    "fields": "userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)",
                }},
                {"autoResizeDimensions": {"dimensions": {
                    "sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": column_count,
                }}},
            ])
            if title != "Dashboard":
                requests.append({"repeatCell": {
                    "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": column_count},
                    "cell": {"userEnteredFormat": {
                        "backgroundColorStyle": {"rgbColor": palette[title]},
                        "horizontalAlignment": "CENTER",
                        "textFormat": {"foregroundColor": {"red": 1, "green": 1, "blue": 1}, "bold": True, "fontSize": 10},
                    }},
                    "fields": "userEnteredFormat(backgroundColorStyle,horizontalAlignment,textFormat)",
                }})
                if row_count > 1:
                    requests.append({"addBanding": {"bandedRange": {
                        "range": {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": row_count, "startColumnIndex": 0, "endColumnIndex": column_count},
                        "rowProperties": {
                            "firstBandColor": {"red": 0.97, "green": 0.98, "blue": 0.98},
                            "secondBandColor": {"red": 0.91, "green": 0.95, "blue": 0.94},
                        },
                    }}})
        dashboard_id = info["Dashboard"]["properties"]["sheetId"]
        requests.extend(self._dashboard_requests(dashboard_id, len(sheets["Dashboard"])))
        details_id = info["Application Details"]["properties"]["sheetId"]
        requests.extend([
            {"updateDimensionProperties": {"range": {"sheetId": details_id, "dimension": "COLUMNS", "startIndex": 1, "endIndex": 2}, "properties": {"hiddenByUser": True}, "fields": "hiddenByUser"}},
            {"updateDimensionProperties": {"range": {"sheetId": details_id, "dimension": "COLUMNS", "startIndex": 6, "endIndex": 7}, "properties": {"pixelSize": 380}, "fields": "pixelSize"}},
            {"updateDimensionProperties": {"range": {"sheetId": details_id, "dimension": "COLUMNS", "startIndex": 7, "endIndex": 8}, "properties": {"pixelSize": 280}, "fields": "pixelSize"}},
        ])
        applications_id = info["Applications"]["properties"]["sheetId"]
        requests.append({"updateDimensionProperties": {"range": {"sheetId": applications_id, "dimension": "COLUMNS", "startIndex": 8, "endIndex": 9}, "properties": {"pixelSize": 420}, "fields": "pixelSize"}})
        if requests:
            self.service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": requests}).execute()

    @staticmethod
    def _dashboard_requests(sheet_id: int, row_count: int) -> list[dict]:
        dark = {"red": 0.10, "green": 0.29, "blue": 0.24}
        requests = [
            {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 1}, "properties": {"pixelSize": 230}, "fields": "pixelSize"}},
            {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 1, "endIndex": 2}, "properties": {"pixelSize": 110}, "fields": "pixelSize"}},
            {"repeatCell": {
                "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 2},
                "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": dark}, "textFormat": {"foregroundColor": {"red": 1, "green": 1, "blue": 1}, "bold": True, "fontSize": 18}}},
                "fields": "userEnteredFormat(backgroundColorStyle,textFormat)",
            }},
        ]
        for header_row in (4, 9, 23):
            requests.append({"repeatCell": {
                "range": {"sheetId": sheet_id, "startRowIndex": header_row, "endRowIndex": header_row + 1, "startColumnIndex": 0, "endColumnIndex": 2},
                "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": dark}, "textFormat": {"foregroundColor": {"red": 1, "green": 1, "blue": 1}, "bold": True}}},
                "fields": "userEnteredFormat(backgroundColorStyle,textFormat)",
            }})
        if row_count >= 22:
            requests.append({"addChart": {"chart": {
                "spec": {"title": "Applications by status", "basicChart": {
                    "chartType": "BAR", "legendPosition": "NO_LEGEND",
                    "domains": [{"domain": {"sourceRange": {"sources": [{"sheetId": sheet_id, "startRowIndex": 9, "endRowIndex": 22, "startColumnIndex": 0, "endColumnIndex": 1}]}}}],
                    "series": [{"series": {"sourceRange": {"sources": [{"sheetId": sheet_id, "startRowIndex": 9, "endRowIndex": 22, "startColumnIndex": 1, "endColumnIndex": 2}]}}, "targetAxis": "BOTTOM_AXIS"}],
                    "headerCount": 1,
                }},
                "position": {"overlayPosition": {"anchorCell": {"sheetId": sheet_id, "rowIndex": 1, "columnIndex": 3}, "widthPixels": 650, "heightPixels": 360}},
            }}})
        if row_count > 24:
            requests.append({"addChart": {"chart": {
                "spec": {"title": "Applications by source", "pieChart": {
                    "legendPosition": "RIGHT_LEGEND", "threeDimensional": False,
                    "domain": {"sourceRange": {"sources": [{"sheetId": sheet_id, "startRowIndex": 23, "endRowIndex": row_count, "startColumnIndex": 0, "endColumnIndex": 1}]}},
                    "series": {"sourceRange": {"sources": [{"sheetId": sheet_id, "startRowIndex": 23, "endRowIndex": row_count, "startColumnIndex": 1, "endColumnIndex": 2}]}},
                }},
                "position": {"overlayPosition": {"anchorCell": {"sheetId": sheet_id, "rowIndex": 20, "columnIndex": 3}, "widthPixels": 650, "heightPixels": 340}},
            }}})
        return requests
