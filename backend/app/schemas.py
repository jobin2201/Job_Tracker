from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, HttpUrl


Status = Literal[
    "PENDING_CONFIRMATION",
    "SAVED",
    "APPLIED",
    "SCREENING",
    "INTERVIEW",
    "TECHNICAL_INTERVIEW",
    "FINAL_INTERVIEW",
    "OFFER",
    "REJECTED",
    "WITHDRAWN",
    "NO_RESPONSE",
    "CLOSED",
]


class ApplicationCreate(BaseModel):
    company: str = Field(min_length=1, max_length=120)
    role: str = Field(min_length=1, max_length=160)
    location: str = Field(default="", max_length=160)
    source: str = Field(default="Other", max_length=80)
    job_url: Optional[HttpUrl] = None
    status: Status = "SAVED"
    applied_at: Optional[date] = None
    follow_up_at: Optional[date] = None
    contact_name: str = Field(default="", max_length=120)
    contact_email: str = Field(default="", max_length=180)
    contact_phone: str = Field(default="", max_length=50)
    contact_linkedin: str = Field(default="", max_length=1000)
    posted_text: str = Field(default="", max_length=100)
    applicants_text: str = Field(default="", max_length=100)
    work_type: str = Field(default="", max_length=80)
    employment_type: str = Field(default="", max_length=80)
    description: str = Field(default="", max_length=30000)
    notes: str = Field(default="", max_length=4000)


class ApplicationUpdate(BaseModel):
    external_job_id: Optional[str] = Field(default=None, max_length=100)
    company: Optional[str] = Field(default=None, min_length=1, max_length=120)
    role: Optional[str] = Field(default=None, min_length=1, max_length=160)
    location: Optional[str] = Field(default=None, max_length=160)
    source: Optional[str] = Field(default=None, max_length=80)
    job_url: Optional[HttpUrl] = None
    applied_at: Optional[date] = None
    follow_up_at: Optional[date] = None
    contact_name: Optional[str] = Field(default=None, max_length=120)
    contact_email: Optional[str] = Field(default=None, max_length=180)
    contact_phone: Optional[str] = Field(default=None, max_length=50)
    contact_linkedin: Optional[str] = Field(default=None, max_length=1000)
    posted_text: Optional[str] = Field(default=None, max_length=100)
    applicants_text: Optional[str] = Field(default=None, max_length=100)
    work_type: Optional[str] = Field(default=None, max_length=80)
    employment_type: Optional[str] = Field(default=None, max_length=80)
    description: Optional[str] = Field(default=None, max_length=30000)
    notes: Optional[str] = Field(default=None, max_length=4000)


class StatusUpdate(BaseModel):
    status: Status
    description: str = Field(default="", max_length=1000)


class EventCreate(BaseModel):
    event_type: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=1000)


class LinkedInContactImport(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    title: str = Field(default="", max_length=180)
    relationship: str = Field(default="", max_length=50)
    linkedin_url: str = Field(default="", max_length=1000)
    email: str = Field(default="", max_length=180)
    phone: str = Field(default="", max_length=50)
    notes: str = Field(default="", max_length=2000)


class LinkedInImport(BaseModel):
    external_job_id: str = Field(min_length=1, max_length=100)
    company: str = Field(min_length=1, max_length=120)
    role: str = Field(min_length=1, max_length=160)
    location: str = Field(default="", max_length=160)
    job_url: HttpUrl
    description: str = Field(default="", max_length=30000)
    posted_text: str = Field(default="", max_length=100)
    applicants_text: str = Field(default="", max_length=100)
    work_type: str = Field(default="", max_length=80)
    employment_type: str = Field(default="", max_length=80)
    contacts: list[LinkedInContactImport] = Field(default_factory=list, max_length=10)
    applied: bool = True
    pending_confirmation: bool = False


class FollowUpCreate(BaseModel):
    scheduled_for: date
    channel: Literal["EMAIL", "PHONE", "LINKEDIN", "OTHER"] = "EMAIL"
    contact_name: str = Field(default="", max_length=120)
    contact_detail: str = Field(default="", max_length=255)
    subject: str = Field(default="", max_length=255)
    notes: str = Field(default="", max_length=4000)


class FollowUpComplete(BaseModel):
    outcome: str = Field(default="", max_length=1000)
    completed_at: Optional[date] = None
    next_follow_up_at: Optional[date] = None


class ContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    title: str = Field(default="", max_length=180)
    relationship: str = Field(default="", max_length=50)
    email: str = Field(default="", max_length=180)
    phone: str = Field(default="", max_length=50)
    linkedin_url: str = Field(default="", max_length=1000)
    notes: str = Field(default="", max_length=2000)
