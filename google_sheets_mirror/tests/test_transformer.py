from src.transformer import build_sheets, summary


def test_summary_is_compact():
    assert summary("A   role\nwith spacing") == "A role with spacing"
    assert len(summary("x" * 400)) == 260


def test_six_tabs_are_built():
    snapshot = {"user": {"email": "user@example.com"}, "applications": [], "contacts": [], "follow_ups": [], "events": []}
    sheets = build_sheets(snapshot)
    assert list(sheets) == ["Dashboard", "Applications", "Application Details", "Contacts", "Follow-ups", "Timeline"]
    assert sheets["Applications"][0][0] == "Application #"
