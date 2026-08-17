from datetime import datetime, timezone

from src.state_store import stable_application_numbers


def test_numbers_are_stable_and_deleted_numbers_are_not_reused():
    applications = [
        {"id": 12, "created_at": datetime(2026, 1, 2, tzinfo=timezone.utc)},
        {"id": 11, "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc)},
    ]
    first = stable_application_numbers(applications, {})
    assert first == {11: "001", 12: "002"}
    later = stable_application_numbers(
        [{"id": 13, "created_at": datetime(2026, 1, 3, tzinfo=timezone.utc)}],
        {"11": "001", "12": "002"},
    )
    assert later[13] == "003"
