import asyncio
import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from starlette.middleware.sessions import SessionMiddleware

from .authentication import authentication_router, current_user
from .authentication.session_policy import ACCESS_SESSION_SECONDS
from .integrations.google_sheets import google_sheets_router
from .integrations.google_sheets.worker import sheets_sync_worker
from .database import get_db
from .models import Application, ApplicationContact, ApplicationEvent, FollowUp, LinkedInAccount, User
from .schemas import (
    ApplicationCreate,
    ApplicationUpdate,
    ContactCreate,
    EventCreate,
    FollowUpComplete,
    FollowUpCreate,
    LinkedInImport,
    StatusUpdate,
)


app = FastAPI(title="MyStratos API", version="0.2.0")
frontend_url = os.getenv("FRONTEND_URL", "http://127.0.0.1:5173").rstrip("/")
secure_frontend = frontend_url.startswith("https://")
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET", "local-development-only"),
    # Vercel and Render are different sites, so production credentialed API
    # requests require SameSite=None and Secure. Local HTTP development keeps
    # the existing Lax, non-Secure behavior.
    same_site="none" if secure_frontend else "lax",
    https_only=secure_frontend,
    max_age=ACCESS_SESSION_SECONDS,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        frontend_url,
        "http://localhost:5173",
        "chrome-extension://*",
    ],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth = OAuth()
if os.getenv("LINKEDIN_CLIENT_ID") and os.getenv("LINKEDIN_CLIENT_SECRET"):
    oauth.register(
        name="linkedin",
        client_id=os.environ["LINKEDIN_CLIENT_ID"],
        client_secret=os.environ["LINKEDIN_CLIENT_SECRET"],
        server_metadata_url="https://www.linkedin.com/oauth/.well-known/openid-configuration",
        client_kwargs={"scope": "openid profile email"},
    )
app.include_router(authentication_router)
app.include_router(google_sheets_router)


@app.on_event("startup")
async def start_google_sheets_worker():
    app.state.google_sheets_worker = asyncio.create_task(sheets_sync_worker())


@app.on_event("shutdown")
async def stop_google_sheets_worker():
    task = getattr(app.state, "google_sheets_worker", None)
    if task:
        task.cancel()


def serialize_event(event: ApplicationEvent) -> dict:
    return {
        "id": event.id,
        "application_id": event.application_id,
        "event_type": event.event_type,
        "old_status": event.old_status,
        "new_status": event.new_status,
        "description": event.description,
        "event_at": event.event_at,
        "created_at": event.created_at,
    }


def serialize_application(application: Application, include_events: bool = False) -> dict:
    result = {
        "id": application.id,
        "company": application.company,
        "role": application.role,
        "location": application.location,
        "source": application.source,
        "external_job_id": application.external_job_id,
        "job_url": application.job_url,
        "description": application.description,
        "posted_text": application.posted_text,
        "applicants_text": application.applicants_text,
        "work_type": application.work_type,
        "employment_type": application.employment_type,
        "status": application.status,
        "applied_at": application.applied_at,
        "follow_up_at": application.follow_up_at,
        "contact_name": application.contact_name,
        "contact_email": application.contact_email,
        "contact_phone": application.contact_phone,
        "contact_linkedin": application.contact_linkedin,
        "notes": application.notes,
        "created_at": application.created_at,
        "updated_at": application.updated_at,
    }
    if include_events:
        result["events"] = [
            serialize_event(event)
            for event in sorted(application.events, key=lambda item: item.event_at, reverse=True)
        ]
        result["follow_ups"] = [
            serialize_follow_up(item)
            for item in sorted(application.follow_ups, key=lambda value: (value.is_completed, value.scheduled_for))
        ]
        result["contacts"] = [serialize_contact(item) for item in application.contacts]
    return result


def serialize_follow_up(item: FollowUp) -> dict:
    return {
        "id": item.id, "application_id": item.application_id,
        "scheduled_for": item.scheduled_for, "completed_at": item.completed_at,
        "channel": item.channel, "contact_name": item.contact_name,
        "contact_detail": item.contact_detail, "subject": item.subject,
        "notes": item.notes, "outcome": item.outcome,
        "is_completed": item.is_completed, "created_at": item.created_at,
    }


def serialize_contact(item: ApplicationContact) -> dict:
    return {"id": item.id, "name": item.name, "title": item.title,
            "relationship": item.relationship_level, "email": item.email, "phone": item.phone,
            "linkedin_url": item.linkedin_url, "notes": item.notes, "created_at": item.created_at}


def application_or_404(db: Session, application_id: int, user_id: int, with_events: bool = False) -> Application:
    statement = select(Application).where(Application.id == application_id, Application.user_id == user_id)
    if with_events:
        statement = statement.options(selectinload(Application.events), selectinload(Application.follow_ups), selectinload(Application.contacts))
    application = db.scalar(statement)
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    return application


@app.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"status": "ok", "service": "job-tracker-api", "database": "postgresql"}


@app.get("/api/applications")
def list_applications(
    search: str = "",
    application_status: Optional[str] = Query(default=None, alias="status"),
    follow_ups_only: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    statement = select(Application).where(Application.user_id == user.id)
    if search.strip():
        term = f"%{search.strip()}%"
        statement = statement.where(
            or_(Application.company.ilike(term), Application.role.ilike(term), Application.location.ilike(term))
        )
    if application_status:
        statement = statement.where(Application.status == application_status)
    if follow_ups_only:
        statement = statement.where(Application.follow_up_at.is_not(None), Application.follow_up_at <= date.today())
    applications = db.scalars(statement.order_by(Application.updated_at.desc())).all()
    return [serialize_application(application) for application in applications]


@app.get("/api/applications/{application_id}")
def get_application(application_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return serialize_application(application_or_404(db, application_id, user.id, True), True)


@app.post("/api/applications", status_code=status.HTTP_201_CREATED)
def create_application(payload: ApplicationCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    data = payload.model_dump()
    data["job_url"] = str(payload.job_url) if payload.job_url else ""
    if data["status"] == "APPLIED" and not data["applied_at"]:
        data["applied_at"] = date.today()
    application = Application(user_id=user.id, **data)
    application.events.append(
        ApplicationEvent(event_type="CREATED", new_status=data["status"], description="Application added")
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return serialize_application(application_or_404(db, application.id, user.id, True), True)


@app.patch("/api/applications/{application_id}")
def update_application(application_id: int, payload: ApplicationUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    application = application_or_404(db, application_id, user.id)
    changes = payload.model_dump(exclude_unset=True)
    if "job_url" in changes:
        changes["job_url"] = str(payload.job_url) if payload.job_url else ""
    for field, value in changes.items():
        setattr(application, field, value)
    db.commit()
    return serialize_application(application_or_404(db, application_id, user.id, True), True)


@app.post("/api/applications/{application_id}/status")
def change_status(application_id: int, payload: StatusUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    application = application_or_404(db, application_id, user.id)
    old_status = application.status
    if old_status == payload.status:
        return serialize_application(application_or_404(db, application_id, user.id, True), True)
    application.status = payload.status
    if payload.status == "APPLIED" and not application.applied_at:
        application.applied_at = date.today()
    application.events.append(
        ApplicationEvent(
            event_type="STATUS_CHANGED",
            old_status=old_status,
            new_status=payload.status,
            description=payload.description.strip() or f"Status changed from {old_status.replace('_', ' ').title()} to {payload.status.replace('_', ' ').title()}",
        )
    )
    db.commit()
    return serialize_application(application_or_404(db, application_id, user.id, True), True)


@app.post("/api/applications/{application_id}/events", status_code=status.HTTP_201_CREATED)
def add_event(application_id: int, payload: EventCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    application = application_or_404(db, application_id, user.id)
    application.events.append(
        ApplicationEvent(
            event_type=payload.event_type.strip().upper().replace(" ", "_"),
            old_status=application.status,
            new_status=application.status,
            description=payload.description.strip(),
        )
    )
    db.commit()
    return serialize_application(application_or_404(db, application_id, user.id, True), True)


@app.post("/api/applications/{application_id}/follow-ups", status_code=status.HTTP_201_CREATED)
def create_follow_up(application_id: int, payload: FollowUpCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    application = application_or_404(db, application_id, user.id)
    follow_up = FollowUp(application=application, **payload.model_dump())
    application.follow_up_at = payload.scheduled_for
    application.events.append(ApplicationEvent(
        event_type="FOLLOW_UP_SCHEDULED", old_status=application.status, new_status=application.status,
        description=f"{payload.channel.title()} follow-up scheduled for {payload.scheduled_for.isoformat()}",
    ))
    db.add(follow_up)
    db.commit()
    return serialize_application(application_or_404(db, application_id, user.id, True), True)


@app.post("/api/applications/{application_id}/follow-ups/{follow_up_id}/complete")
def complete_follow_up(application_id: int, follow_up_id: int, payload: FollowUpComplete, db: Session = Depends(get_db), user: User = Depends(current_user)):
    application = application_or_404(db, application_id, user.id)
    follow_up = db.scalar(select(FollowUp).where(FollowUp.id == follow_up_id, FollowUp.application_id == application_id))
    if not follow_up:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    completed_date = payload.completed_at or date.today()
    follow_up.is_completed = True
    follow_up.completed_at = datetime.combine(completed_date, datetime.min.time(), tzinfo=timezone.utc)
    follow_up.outcome = payload.outcome.strip()
    application.events.append(ApplicationEvent(
        event_type="FOLLOW_UP_COMPLETED", old_status=application.status, new_status=application.status,
        description=f"{follow_up.channel.title()} follow-up completed" + (f": {follow_up.outcome}" if follow_up.outcome else ""),
    ))
    if payload.next_follow_up_at:
        application.follow_up_at = payload.next_follow_up_at
        application.follow_ups.append(FollowUp(
            scheduled_for=payload.next_follow_up_at, channel=follow_up.channel,
            contact_name=follow_up.contact_name, contact_detail=follow_up.contact_detail,
            subject="Next follow-up", notes="Scheduled after previous follow-up",
        ))
    else:
        next_item = db.scalar(select(FollowUp).where(
            FollowUp.application_id == application_id, FollowUp.is_completed.is_(False), FollowUp.id != follow_up_id
        ).order_by(FollowUp.scheduled_for))
        application.follow_up_at = next_item.scheduled_for if next_item else None
    db.commit()
    return serialize_application(application_or_404(db, application_id, user.id, True), True)


@app.delete("/api/applications/{application_id}/follow-ups/{follow_up_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_follow_up(application_id: int, follow_up_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    application_or_404(db, application_id, user.id)
    item = db.scalar(select(FollowUp).where(FollowUp.id == follow_up_id, FollowUp.application_id == application_id))
    if not item:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/applications/{application_id}/contacts", status_code=status.HTTP_201_CREATED)
def create_contact(application_id: int, payload: ContactCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    application = application_or_404(db, application_id, user.id)
    data = payload.model_dump()
    relationship_level = data.pop("relationship")
    contact = ApplicationContact(application=application, relationship_level=relationship_level, **data)
    db.add(contact)
    application.events.append(ApplicationEvent(
        event_type="CONTACT_ADDED", old_status=application.status, new_status=application.status,
        description=f"Contact added: {payload.name}",
    ))
    db.commit()
    return serialize_application(application_or_404(db, application_id, user.id, True), True)


@app.delete("/api/applications/{application_id}/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(application_id: int, contact_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    application_or_404(db, application_id, user.id)
    contact = db.scalar(select(ApplicationContact).where(ApplicationContact.id == contact_id, ApplicationContact.application_id == application_id))
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.delete("/api/applications/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_application(application_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    application = application_or_404(db, application_id, user.id)
    db.delete(application)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(current_user)):
    total = db.scalar(select(func.count(Application.id)).where(Application.user_id == user.id)) or 0
    status_rows = db.execute(
        select(Application.status, func.count(Application.id))
        .where(Application.user_id == user.id)
        .group_by(Application.status)
    ).all()
    follow_ups = db.scalar(
        select(func.count(Application.id)).where(
            Application.follow_up_at.is_not(None),
            Application.follow_up_at <= date.today(),
            Application.status.not_in(["REJECTED", "WITHDRAWN", "CLOSED"]),
            Application.user_id == user.id,
        )
    ) or 0
    interviews = db.scalar(
        select(func.count(Application.id)).where(
            Application.status.in_(["INTERVIEW", "TECHNICAL_INTERVIEW", "FINAL_INTERVIEW"])
            , Application.user_id == user.id
        )
    ) or 0
    offers = db.scalar(select(func.count(Application.id)).where(Application.status == "OFFER", Application.user_id == user.id)) or 0
    return {
        "total": total,
        "follow_ups_due": follow_ups,
        "interviews": interviews,
        "offers": offers,
        "by_status": {row[0]: row[1] for row in status_rows},
    }


@app.post("/api/linkedin/import")
def import_linkedin_application(payload: LinkedInImport, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = db.scalar(
        select(Application)
        .where(Application.user_id == user.id, Application.source == "LinkedIn", Application.external_job_id == payload.external_job_id)
        .options(selectinload(Application.events), selectinload(Application.contacts))
    )
    target_status = "PENDING_CONFIRMATION" if payload.pending_confirmation else ("APPLIED" if payload.applied else "SAVED")
    if existing:
        old_status = existing.status
        incoming = {
            "company": payload.company.strip(), "role": payload.role.strip(),
            "location": payload.location.strip(), "job_url": str(payload.job_url),
            "description": payload.description.strip(), "posted_text": payload.posted_text.strip(),
            "applicants_text": payload.applicants_text.strip(), "work_type": payload.work_type.strip(),
            "employment_type": payload.employment_type.strip(),
        }
        placeholder_role = lambda value: value.strip().lower() == "search" or value.strip().lower() == f"linkedin job {payload.external_job_id}".lower()
        concatenated_location = lambda value: value.replace(" ", "").lower().startswith(payload.company.replace(" ", "").lower())
        for field, value in incoming.items():
            if not value:
                continue
            if field == "role" and placeholder_role(value):
                continue
            if field == "location" and concatenated_location(value):
                continue
            setattr(existing, field, value)
        if payload.pending_confirmation and existing.status not in ["APPLIED", "PENDING_CONFIRMATION"]:
            existing.status = "PENDING_CONFIRMATION"
            existing.follow_up_at = existing.follow_up_at or date.today() + timedelta(days=1)
            existing.events.append(
                ApplicationEvent(
                    event_type="EXTERNAL_APPLICATION_STARTED",
                    old_status=old_status,
                    new_status="PENDING_CONFIRMATION",
                    description="External application started; confirmation is still needed",
                )
            )
        elif payload.applied and existing.status != "APPLIED":
            existing.status = "APPLIED"
            existing.applied_at = existing.applied_at or date.today()
            existing.events.append(
                ApplicationEvent(
                    event_type="LINKEDIN_APPLY_DETECTED",
                    old_status=old_status,
                    new_status="APPLIED",
                    description=f"Status changed from {old_status.replace('_', ' ').title()} to Applied after LinkedIn confirmation",
                )
            )
        authoritative_job_contacts = [
            contact for contact in payload.contacts
            if "listed by linkedin under meet the hiring team" in contact.notes.lower()
        ]
        if authoritative_job_contacts:
            # Replace only contacts previously created by the extension. Contacts
            # entered manually by the user have different/empty notes and remain.
            legacy_auto_notes = {"hiring contact", "job poster"}
            existing.contacts[:] = [
                contact for contact in existing.contacts
                if contact.notes.strip().lower() not in legacy_auto_notes
                and "listed by linkedin under meet the hiring team" not in contact.notes.lower()
            ]
        if placeholder_role(existing.role) and not placeholder_role(payload.role):
            existing.role = payload.role.strip()
        if concatenated_location(existing.location) and not concatenated_location(payload.location):
            existing.location = payload.location.strip()
        known_contacts = {(contact.linkedin_url.lower(), contact.name.lower()) for contact in existing.contacts}
        for contact in payload.contacts:
            key = (contact.linkedin_url.strip().lower(), contact.name.strip().lower())
            if key not in known_contacts:
                existing.contacts.append(
                    ApplicationContact(
                        name=contact.name.strip(), title=contact.title.strip(),
                        relationship_level=contact.relationship.strip(),
                        linkedin_url=contact.linkedin_url.strip(), email=contact.email.strip(),
                        phone=contact.phone.strip(), notes=contact.notes.strip(),
                    )
                )
                known_contacts.add(key)
        db.commit()
        return {"created": False, "application": serialize_application(existing, True)}

    application = Application(
        user_id=user.id,
        company=payload.company.strip(),
        role=payload.role.strip(),
        location=payload.location.strip(),
        source="LinkedIn",
        external_job_id=payload.external_job_id,
        job_url=str(payload.job_url),
        description=payload.description.strip(),
        posted_text=payload.posted_text.strip(),
        applicants_text=payload.applicants_text.strip(),
        work_type=payload.work_type.strip(),
        employment_type=payload.employment_type.strip(),
        status=target_status,
        applied_at=date.today() if payload.applied and not payload.pending_confirmation else None,
        follow_up_at=(date.today() + timedelta(days=1)) if payload.pending_confirmation else (date.today() + timedelta(days=7) if payload.applied else None),
    )
    application.events.append(
        ApplicationEvent(
            event_type="EXTERNAL_APPLICATION_STARTED" if payload.pending_confirmation else ("LINKEDIN_APPLY_DETECTED" if payload.applied else "LINKEDIN_JOB_SAVED"),
            new_status=target_status,
            description="External application started; confirmation is still needed" if payload.pending_confirmation else ("Application action captured from LinkedIn" if payload.applied else "Job captured from LinkedIn"),
        )
    )
    for contact in payload.contacts:
        application.contacts.append(
            ApplicationContact(
                name=contact.name.strip(), title=contact.title.strip(),
                relationship_level=contact.relationship.strip(),
                linkedin_url=contact.linkedin_url.strip(), email=contact.email.strip(),
                phone=contact.phone.strip(), notes=contact.notes.strip(),
            )
        )
    db.add(application)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(Application)
            .where(Application.user_id == user.id, Application.source == "LinkedIn", Application.external_job_id == payload.external_job_id)
            .options(selectinload(Application.events), selectinload(Application.contacts))
        )
        if existing:
            return {"created": False, "application": serialize_application(existing, True)}
        raise
    return {"created": True, "application": serialize_application(application_or_404(db, application.id, user.id, True), True)}


@app.post("/api/indeed/import")
def import_indeed_application(payload: LinkedInImport, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Import Indeed jobs independently without changing the LinkedIn pipeline."""
    source = "Indeed"
    existing = db.scalar(
        select(Application)
        .where(Application.user_id == user.id, Application.source == source, Application.external_job_id == payload.external_job_id)
        .options(selectinload(Application.events), selectinload(Application.contacts))
    )
    target_status = "PENDING_CONFIRMATION" if payload.pending_confirmation else ("APPLIED" if payload.applied else "SAVED")
    placeholder_role = lambda value: value.strip().lower() in {"search", f"indeed job {payload.external_job_id}".lower()}
    concatenated_location = lambda value: value.replace(" ", "").lower().startswith(payload.company.replace(" ", "").lower())

    if existing:
        old_status = existing.status
        incoming = {
            "company": payload.company.strip(), "role": payload.role.strip(),
            "location": payload.location.strip(), "job_url": str(payload.job_url),
            "description": payload.description.strip(), "posted_text": payload.posted_text.strip(),
            "applicants_text": payload.applicants_text.strip(), "work_type": payload.work_type.strip(),
            "employment_type": payload.employment_type.strip(),
        }
        for field, value in incoming.items():
            if not value:
                continue
            if field == "role" and placeholder_role(value):
                continue
            if field == "location" and concatenated_location(value):
                continue
            if field == "description" and len(value) < len(existing.description or ""):
                continue
            setattr(existing, field, value)
        if payload.pending_confirmation and existing.status not in ["APPLIED", "PENDING_CONFIRMATION"]:
            existing.status = "PENDING_CONFIRMATION"
            existing.follow_up_at = existing.follow_up_at or date.today() + timedelta(days=1)
            existing.events.append(ApplicationEvent(
                event_type="INDEED_APPLICATION_STARTED", old_status=old_status,
                new_status="PENDING_CONFIRMATION",
                description="External Indeed application started; confirmation is still needed",
            ))
        elif payload.applied and existing.status != "APPLIED":
            existing.status = "APPLIED"
            existing.applied_at = existing.applied_at or date.today()
            existing.follow_up_at = date.today() + timedelta(days=7)
            existing.events.append(ApplicationEvent(
                event_type="INDEED_APPLY_DETECTED", old_status=old_status,
                new_status="APPLIED",
                description="Indeed application confirmed",
            ))
        known_contacts = {
            (contact.linkedin_url.lower(), contact.email.lower(), contact.name.lower())
            for contact in existing.contacts
        }
        for contact in payload.contacts:
            key = (contact.linkedin_url.strip().lower(), contact.email.strip().lower(), contact.name.strip().lower())
            if key in known_contacts:
                continue
            existing.contacts.append(ApplicationContact(
                name=contact.name.strip(), title=contact.title.strip(),
                relationship_level=contact.relationship.strip(),
                linkedin_url=contact.linkedin_url.strip(), email=contact.email.strip(),
                phone=contact.phone.strip(), notes=contact.notes.strip(),
            ))
            known_contacts.add(key)
        db.commit()
        return {"created": False, "application": serialize_application(existing, True)}

    application = Application(
        user_id=user.id,
        company=payload.company.strip(), role=payload.role.strip(),
        location=payload.location.strip(), source=source,
        external_job_id=payload.external_job_id, job_url=str(payload.job_url),
        description=payload.description.strip(), posted_text=payload.posted_text.strip(),
        applicants_text=payload.applicants_text.strip(), work_type=payload.work_type.strip(),
        employment_type=payload.employment_type.strip(), status=target_status,
        applied_at=date.today() if payload.applied and not payload.pending_confirmation else None,
        follow_up_at=(date.today() + timedelta(days=1)) if payload.pending_confirmation
        else (date.today() + timedelta(days=7) if payload.applied else None),
    )
    application.events.append(ApplicationEvent(
        event_type="INDEED_APPLICATION_STARTED" if payload.pending_confirmation else "INDEED_APPLY_DETECTED",
        new_status=target_status,
        description="External Indeed application started; confirmation is still needed"
        if payload.pending_confirmation else "Application action captured from Indeed",
    ))
    for contact in payload.contacts:
        application.contacts.append(ApplicationContact(
            name=contact.name.strip(), title=contact.title.strip(),
            relationship_level=contact.relationship.strip(),
            linkedin_url=contact.linkedin_url.strip(), email=contact.email.strip(),
            phone=contact.phone.strip(), notes=contact.notes.strip(),
        ))
    db.add(application)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(Application)
            .where(Application.user_id == user.id, Application.source == source, Application.external_job_id == payload.external_job_id)
            .options(selectinload(Application.events), selectinload(Application.contacts))
        )
        if existing:
            return {"created": False, "application": serialize_application(existing, True)}
        raise
    return {"created": True, "application": serialize_application(application_or_404(db, application.id, user.id, True), True)}


@app.get("/auth/linkedin/status")
def linkedin_status(db: Session = Depends(get_db)):
    account = db.scalar(select(LinkedInAccount).order_by(LinkedInAccount.updated_at.desc()))
    return {
        "configured": bool(os.getenv("LINKEDIN_CLIENT_ID") and os.getenv("LINKEDIN_CLIENT_SECRET")),
        "connected": account is not None,
        "account": {"name": account.name, "email": account.email, "picture_url": account.picture_url} if account else None,
    }


@app.get("/auth/linkedin")
async def linkedin_login(request: Request):
    if not getattr(oauth, "linkedin", None):
        raise HTTPException(
            status_code=503,
            detail="LinkedIn OAuth is not configured. Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to backend/.env.",
        )
    redirect_uri = os.getenv("LINKEDIN_REDIRECT_URI", str(request.url_for("linkedin_callback")))
    return await oauth.linkedin.authorize_redirect(request, redirect_uri)


@app.get("/auth/linkedin/callback", name="linkedin_callback")
async def linkedin_callback(request: Request, db: Session = Depends(get_db)):
    if not getattr(oauth, "linkedin", None):
        raise HTTPException(status_code=503, detail="LinkedIn OAuth is not configured")
    try:
        token = await oauth.linkedin.authorize_access_token(request)
        userinfo = token.get("userinfo") or await oauth.linkedin.userinfo(token=token)
    except OAuthError as exc:
        raise HTTPException(status_code=400, detail=f"LinkedIn authorization failed: {exc.error}") from exc
    subject = userinfo.get("sub")
    if not subject:
        raise HTTPException(status_code=400, detail="LinkedIn did not return an account identifier")
    account = db.scalar(select(LinkedInAccount).where(LinkedInAccount.linkedin_subject == subject))
    if not account:
        account = LinkedInAccount(linkedin_subject=subject, access_token=token["access_token"])
        db.add(account)
    account.name = userinfo.get("name", "")
    account.email = userinfo.get("email", "")
    account.picture_url = userinfo.get("picture", "")
    account.access_token = token["access_token"]
    expires_at = token.get("expires_at")
    account.token_expires_at = datetime.fromtimestamp(expires_at, timezone.utc) if expires_at else None
    db.commit()
    frontend_url = os.getenv("FRONTEND_URL", "http://127.0.0.1:5173").rstrip("/")
    if not frontend_url.endswith("/app"):
        frontend_url = f"{frontend_url}/app"
    return RedirectResponse(f"{frontend_url}?linkedin=connected")
