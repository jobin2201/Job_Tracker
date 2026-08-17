import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from src.config import Settings  # noqa: E402
from src.database_reader import ReadOnlyJobTracker  # noqa: E402
from src.groq_summary import GroqEnricher  # noqa: E402
from src.state_store import load_json, save_json, stable_application_numbers  # noqa: E402
from src.transformer import build_sheets  # noqa: E402


def synchronize(dry_run: bool = False) -> dict:
    settings = Settings()
    settings.validate_database()
    snapshot = ReadOnlyJobTracker(settings).snapshot()
    numbers = stable_application_numbers(snapshot["applications"], load_json(settings.application_numbers_file))
    save_json(settings.application_numbers_file, {str(key): value for key, value in numbers.items()})
    enricher = GroqEnricher(settings)
    sheets = build_sheets(snapshot, numbers, None if dry_run else enricher.enrich)
    enricher.save()
    result = {
        "user": snapshot["user"]["email"],
        "applications": len(snapshot["applications"]),
        "contacts": len(snapshot["contacts"]),
        "follow_ups": len(snapshot["follow_ups"]),
        "timeline_events": len(snapshot["events"]),
    }
    if not dry_run:
        from src.sheets_client import GoogleSheetsMirror

        result["spreadsheet_url"] = GoogleSheetsMirror(settings).replace_all(sheets)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mirror one Job Tracker account to Google Sheets")
    parser.add_argument("--dry-run", action="store_true", help="Read and transform PostgreSQL without contacting Google")
    arguments = parser.parse_args()
    print(json.dumps(synchronize(dry_run=arguments.dry_run), indent=2))
