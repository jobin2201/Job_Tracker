from collections import Counter
from datetime import date, datetime, timedelta
import re
from typing import Any, Callable


SHEET_ORDER = ["Dashboard", "Applications", "Application Details", "Contacts", "Follow-ups", "Timeline"]
DISPLAY_STATUSES = [
    "APPLIED", "PENDING_CONFIRMATION", "SCREENING", "INTERVIEW", "TECHNICAL_INTERVIEW",
    "FINAL_INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN", "NO_RESPONSE", "CLOSED", "SAVED",
]


def text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def summary(description: str, limit: int = 260) -> str:
    cleaned = re.sub(r"\s+", " ", description or "").strip()
    return cleaned if len(cleaned) <= limit else cleaned[: limit - 1].rstrip() + "…"


def _dashboard(snapshot: dict) -> list[list[Any]]:
    applications = snapshot["applications"]
    statuses = Counter(item["status"] for item in applications)
    sources = Counter(item["source"] for item in applications)
    today = date.today()
    week_end = today + timedelta(days=7)
    pending = [item for item in snapshot["follow_ups"] if not item["is_completed"] and item["scheduled_for"]]
    rows = [
        ["JOB TRACKER OVERVIEW"],
        [snapshot["user"]["email"]],
        ["Last synchronized", datetime.now().astimezone().isoformat(timespec="seconds")],
        [],
        ["Metric", "Count"],
        ["Total applications", len(applications)],
        ["Follow-ups due", sum(item["scheduled_for"] <= today for item in pending)],
        ["Follow-ups this week", sum(today <= item["scheduled_for"] <= week_end for item in pending)],
        [],
        ["Status", "Count"],
    ]
    rows.extend([[status.replace("_", " ").title(), statuses.get(status, 0)] for status in DISPLAY_STATUSES])
    rows.extend([[], ["Source", "Count"]])
    rows.extend([[source, count] for source, count in sorted(sources.items())])
    return rows


def build_sheets(
    snapshot: dict,
    application_numbers: dict[int, str] | None = None,
    enrich: Callable[[dict], dict[str, str]] | None = None,
) -> dict[str, list[list[Any]]]:
    applications = snapshot["applications"]
    numbers = application_numbers or {item["id"]: f"{index:03d}" for index, item in enumerate(reversed(applications), 1)}
    enrichment: dict[int, dict[str, str]] = {}
    for item in applications:
        enrichment[item["id"]] = enrich(item) if enrich else {"summary": summary(item["description"], 320), "skills": ""}

    application_rows = [[
        "Application #", "Company", "Job Title", "Location", "Status", "Applied Date",
        "Next Follow-up", "Source", "Job Summary", "Job URL",
    ]]
    detail_rows = [[
        "Application #", "Database ID", "Company", "Job Title", "Job ID", "Job URL",
        "About the Job", "Skills", "Employment Type", "Work Type", "Applicants", "Posted", "Source", "Notes",
    ]]
    for item in applications:
        number = numbers[item["id"]]
        ai = enrichment[item["id"]]
        application_rows.append([
            number, item["company"], item["role"], item["location"], item["status"], text(item["applied_at"]),
            text(item["follow_up_at"]), item["source"], ai["summary"], item["job_url"],
        ])
        detail_rows.append([
            number, item["id"], item["company"], item["role"], item["external_job_id"], item["job_url"],
            ai["summary"], ai["skills"], item["employment_type"], item["work_type"],
            item["applicants_text"], item["posted_text"], item["source"], item["notes"],
        ])

    contact_rows = [[
        "Application #", "Contact Name", "Company", "Job Title", "Contact Role", "Email", "Phone",
        "LinkedIn", "Relationship", "Notes",
    ]] + [[
        numbers[item["application_id"]], item["name"], item["company"], item["role"], item["title"],
        item["email"], item["phone"], item["linkedin_url"], item["relationship"], item["notes"],
    ] for item in snapshot["contacts"]]

    follow_up_rows = [[
        "Application #", "Company", "Job Title", "Follow-up Date", "Status", "Channel", "Contact",
        "Subject", "Notes", "Completed At", "Outcome",
    ]] + [[
        numbers[item["application_id"]], item["company"], item["role"], text(item["scheduled_for"]),
        "COMPLETED" if item["is_completed"] else "PENDING", item["channel"], item["contact_name"],
        item["subject"], item["notes"], text(item["completed_at"]), item["outcome"],
    ] for item in snapshot["follow_ups"]]

    timeline_rows = [[
        "Application #", "Date / Time", "Event", "Source", "Old Status", "New Status", "Details",
    ]] + [[
        numbers[item["application_id"]], text(item["event_at"]), item["event_type"], item["source"],
        item["old_status"], item["new_status"], item["description"],
    ] for item in snapshot["events"]]

    return {
        "Dashboard": _dashboard(snapshot),
        "Applications": application_rows,
        "Application Details": detail_rows,
        "Contacts": contact_rows,
        "Follow-ups": follow_up_rows,
        "Timeline": timeline_rows,
    }
