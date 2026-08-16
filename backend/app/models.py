from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (
        Index("ix_applications_status", "status"),
        Index("uq_user_source_external_job", "user_id", "source", "external_job_id", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    company: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(160))
    location: Mapped[str] = mapped_column(String(160), default="")
    source: Mapped[str] = mapped_column(String(80), default="LinkedIn")
    external_job_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    job_url: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    posted_text: Mapped[str] = mapped_column(String(100), default="")
    applicants_text: Mapped[str] = mapped_column(String(100), default="")
    work_type: Mapped[str] = mapped_column(String(80), default="")
    employment_type: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(40), default="SAVED")
    applied_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    follow_up_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    contact_name: Mapped[str] = mapped_column(String(120), default="")
    contact_email: Mapped[str] = mapped_column(String(180), default="")
    contact_phone: Mapped[str] = mapped_column(String(50), default="")
    contact_linkedin: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    events: Mapped[list["ApplicationEvent"]] = relationship(
        back_populates="application", cascade="all, delete-orphan"
    )
    follow_ups: Mapped[list["FollowUp"]] = relationship(
        back_populates="application", cascade="all, delete-orphan"
    )
    contacts: Mapped[list["ApplicationContact"]] = relationship(
        back_populates="application", cascade="all, delete-orphan"
    )
    user: Mapped["User"] = relationship(back_populates="applications")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    google_subject: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(320), default="")
    name: Mapped[str] = mapped_column(String(160), default="")
    picture_url: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    applications: Mapped[list["Application"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class ApplicationEvent(Base):
    __tablename__ = "application_events"
    __table_args__ = (Index("ix_events_application_event_at", "application_id", "event_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"))
    event_type: Mapped[str] = mapped_column(String(80))
    old_status: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    new_status: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")
    event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    application: Mapped[Application] = relationship(back_populates="events")


class LinkedInAccount(Base):
    __tablename__ = "linkedin_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    linkedin_subject: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    email: Mapped[str] = mapped_column(String(255), default="")
    picture_url: Mapped[str] = mapped_column(Text, default="")
    access_token: Mapped[str] = mapped_column(Text)
    token_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class FollowUp(Base):
    __tablename__ = "follow_ups"
    __table_args__ = (Index("ix_follow_ups_application_scheduled", "application_id", "scheduled_for"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"))
    scheduled_for: Mapped[date] = mapped_column(Date)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    channel: Mapped[str] = mapped_column(String(30), default="EMAIL")
    contact_name: Mapped[str] = mapped_column(String(120), default="")
    contact_detail: Mapped[str] = mapped_column(String(255), default="")
    subject: Mapped[str] = mapped_column(String(255), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    outcome: Mapped[str] = mapped_column(String(255), default="")
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    application: Mapped[Application] = relationship(back_populates="follow_ups")


class ApplicationContact(Base):
    __tablename__ = "application_contacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(180), default="")
    relationship_level: Mapped[str] = mapped_column("relationship", String(50), default="")
    email: Mapped[str] = mapped_column(String(180), default="")
    phone: Mapped[str] = mapped_column(String(50), default="")
    linkedin_url: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    application: Mapped[Application] = relationship(back_populates="contacts")
