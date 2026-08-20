from collections import Counter
from datetime import date, datetime, timedelta
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models import Application, ApplicationContact, ApplicationEvent, FollowUp, User


SHEET_ORDER = ["Dashboard", "Applications", "Application Details", "Contacts", "Follow-ups", "Timeline"]
DISPLAY_STATUSES = [
    "APPLIED", "PENDING_CONFIRMATION", "SCREENING", "INTERVIEW", "TECHNICAL_INTERVIEW",
    "FINAL_INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN", "NO_RESPONSE", "CLOSED", "SAVED",
]


def _text(value) -> str:
    return value.isoformat() if isinstance(value, (date, datetime)) else str(value or "")


def _summary(value: str, limit: int = 320) -> str:
    cleaned = re.sub(r"\s+", " ", value or "").strip()
    return cleaned if len(cleaned) <= limit else cleaned[: limit - 1].rstrip() + "…"


def build_user_sheets(db: Session, user: User) -> dict[str, list[list]]:
    applications = list(db.scalars(
        select(Application).where(Application.user_id == user.id).order_by(Application.created_at.desc(), Application.id.desc())
    ))
    application_ids = [item.id for item in applications]
    contacts = list(db.scalars(
        select(ApplicationContact).where(ApplicationContact.application_id.in_(application_ids)).order_by(ApplicationContact.id.desc())
    )) if application_ids else []
    follow_ups = list(db.scalars(
        select(FollowUp).where(FollowUp.application_id.in_(application_ids)).order_by(FollowUp.scheduled_for, FollowUp.id)
    )) if application_ids else []
    events = list(db.scalars(
        select(ApplicationEvent).where(ApplicationEvent.application_id.in_(application_ids)).order_by(ApplicationEvent.event_at.desc(), ApplicationEvent.id.desc())
    )) if application_ids else []
    by_id = {item.id: item for item in applications}
    number = {item.id: f"{item.id:03d}" for item in applications}
    statuses = Counter(item.status for item in applications)
    sources = Counter(item.source for item in applications)
    today = date.today()
    week_end = today + timedelta(days=7)
    pending = [item for item in follow_ups if not item.is_completed and item.scheduled_for]

    dashboard = [
        ["MYSTRATOS OVERVIEW"], [user.email],
        ["Last synchronized", datetime.now().astimezone().isoformat(timespec="seconds")], [],
        ["Metric", "Count"], ["Total applications", len(applications)],
        ["Follow-ups due", sum(item.scheduled_for <= today for item in pending)],
        ["Follow-ups this week", sum(today <= item.scheduled_for <= week_end for item in pending)], [],
        ["Status", "Count"],
        *[[status.replace("_", " ").title(), statuses.get(status, 0)] for status in DISPLAY_STATUSES],
        [], ["Source", "Count"], *[[source, count] for source, count in sorted(sources.items())],
    ]
    application_rows = [[
        "Application #", "Company", "Job Title", "Location", "Status", "Applied Date",
        "Next Follow-up", "Source", "Job Summary", "Job URL",
    ]]
    detail_rows = [[
        "Application #", "Database ID", "Company", "Job Title", "Job ID", "Job URL",
        "About the Job", "Employment Type", "Work Type", "Applicants", "Posted", "Source", "Notes",
    ]]
    for item in applications:
        summary = _summary(item.description)
        application_rows.append([
            number[item.id], item.company, item.role, item.location, item.status, _text(item.applied_at),
            _text(item.follow_up_at), item.source, summary, item.job_url,
        ])
        detail_rows.append([
            number[item.id], item.id, item.company, item.role, item.external_job_id, item.job_url,
            summary, item.employment_type, item.work_type, item.applicants_text, item.posted_text,
            item.source, item.notes,
        ])
    contact_rows = [[
        "Application #", "Contact Name", "Company", "Job Title", "Contact Role", "Email", "Phone",
        "LinkedIn", "Relationship", "Notes",
    ]] + [[
        number[item.application_id], item.name, by_id[item.application_id].company,
        by_id[item.application_id].role, item.title, item.email, item.phone, item.linkedin_url,
        item.relationship_level, item.notes,
    ] for item in contacts]
    follow_up_rows = [[
        "Application #", "Company", "Job Title", "Follow-up Date", "Status", "Channel", "Contact",
        "Subject", "Notes", "Completed At", "Outcome",
    ]] + [[
        number[item.application_id], by_id[item.application_id].company, by_id[item.application_id].role,
        _text(item.scheduled_for), "COMPLETED" if item.is_completed else "PENDING", item.channel,
        item.contact_name, item.subject, item.notes, _text(item.completed_at), item.outcome,
    ] for item in follow_ups]
    timeline_rows = [[
        "Application #", "Date / Time", "Event", "Source", "Old Status", "New Status", "Details",
    ]] + [[
        number[item.application_id], _text(item.event_at), item.event_type, by_id[item.application_id].source,
        item.old_status, item.new_status, item.description,
    ] for item in events]
    return {
        "Dashboard": dashboard, "Applications": application_rows, "Application Details": detail_rows,
        "Contacts": contact_rows, "Follow-ups": follow_up_rows, "Timeline": timeline_rows,
    }
