import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  ExternalLink,
  FileText,
  Inbox,
  LayoutDashboard,
  Mail,
  MapPin,
  Menu,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Save,
  Search,
  Send,
  Sparkles,
  Target,
  Trash2,
  UserRound,
  X,
  Moon,
  Sun,
  PanelLeftClose,
  SlidersHorizontal,
} from "lucide-react";
import {
  AccountCard,
  AuthGate,
  apiUrl,
  getCurrentUser,
  monitorSessionActivity,
  notifySessionExpired,
  onSessionExpired,
  signOut,
  type AuthUser,
} from "./authentication";
import { GoogleSheetsCard } from "./integrations/google-sheets/GoogleSheetsCard";

const STATUSES = [
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
] as const;
const FINISHED_STATUSES: Status[] = ["REJECTED", "WITHDRAWN", "CLOSED"];
type Status = (typeof STATUSES)[number];
type TimelineEvent = {
  id: number;
  event_type: string;
  description: string;
  event_at: string;
  old_status: string | null;
  new_status: string | null;
};
type FollowUp = {
  id: number;
  scheduled_for: string;
  completed_at: string | null;
  channel: string;
  contact_name: string;
  contact_detail: string;
  subject: string;
  notes: string;
  outcome: string;
  is_completed: boolean;
};
type Application = {
  id: number;
  company: string;
  role: string;
  location: string;
  source: string;
  external_job_id?: string;
  job_url: string;
  description: string;
  posted_text: string;
  applicants_text: string;
  work_type: string;
  employment_type: string;
  status: Status;
  applied_at: string | null;
  follow_up_at: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  contact_linkedin: string;
  notes: string;
  created_at: string;
  updated_at: string;
  events?: TimelineEvent[];
  follow_ups?: FollowUp[];
  contacts?: Contact[];
};
type Contact = {
  id: number;
  name: string;
  title: string;
  relationship: string;
  email: string;
  phone: string;
  linkedin_url: string;
  notes: string;
};
type Dashboard = {
  total: number;
  follow_ups_due: number;
  interviews: number;
  offers: number;
  by_status: Record<string, number>;
};
type Theme = "light" | "dark";
function ThemeButton({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      <span>
        <Sun size={14} />
        <Moon size={14} />
        <i className={theme} />
      </span>
    </button>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const emptyApplication = {
  company: "",
  role: "",
  location: "",
  source: "LinkedIn",
  job_url: "",
  description: "",
  posted_text: "",
  applicants_text: "",
  work_type: "",
  employment_type: "",
  status: "APPLIED" as Status,
  applied_at: today(),
  follow_up_at: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  contact_linkedin: "",
  notes: "",
};
const emptyFollowUp = {
  scheduled_for: "",
  channel: "EMAIL",
  contact_name: "",
  contact_detail: "",
  subject: "",
  notes: "",
};
const label = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
const initials = (company: string) =>
  company
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(value.length === 10 ? `${value}T00:00:00` : value))
    : "Not set";
const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
const scrollPageTop = () =>
  window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (response.status === 401) notifySessionExpired();
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Something went wrong");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function ApplicationWorkspace({
  application,
  onClose,
  onRefresh,
  onDelete,
  theme,
  onTheme,
}: {
  application: Application;
  onClose: () => void;
  onRefresh: (app: Application) => void;
  onDelete: () => void;
  theme: Theme;
  onTheme: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({
    ...application,
    applied_at: application.applied_at || "",
    follow_up_at: application.follow_up_at || "",
  });
  const [follow, setFollow] = useState(emptyFollowUp);
  const [showFollow, setShowFollow] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [contact, setContact] = useState({
    name: "",
    title: "",
    relationship: "",
    email: "",
    phone: "",
    linkedin_url: "",
    notes: "",
  });
  const [outcomes, setOutcomes] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(
    () =>
      setDraft({
        ...application,
        applied_at: application.applied_at || "",
        follow_up_at: application.follow_up_at || "",
      }),
    [application],
  );
  const saveDetails = async () => {
    setSaving(true);
    try {
      const payload = {
        ...draft,
        applied_at: draft.applied_at || null,
        follow_up_at: draft.follow_up_at || null,
        job_url: draft.job_url || null,
      };
      delete (payload as Partial<Application>).events;
      delete (payload as Partial<Application>).follow_ups;
      delete (payload as Partial<Application>).contacts;
      const updated = await api<Application>(
        `/api/applications/${application.id}`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      onRefresh(updated);
      setEdit(false);
    } finally {
      setSaving(false);
    }
  };
  const changeStatus = async (status: Status) => {
    if (status === application.status) return;
    const confirmed = window.confirm(
      `Change status from ${label(application.status)} to ${label(status)}?`,
    );
    if (!confirmed) return;
    const updated = await api<Application>(
      `/api/applications/${application.id}/status`,
      {
        method: "POST",
        body: JSON.stringify({
          status,
          description: `Status changed from ${label(application.status)} to ${label(status)}`,
        }),
      },
    );
    onRefresh(updated);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Application status updated", {
        body: `${application.role} at ${application.company}: ${label(application.status)} → ${label(status)}`,
      });
    }
  };
  const addContact = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = await api<Application>(
      `/api/applications/${application.id}/contacts`,
      { method: "POST", body: JSON.stringify(contact) },
    );
    onRefresh(updated);
    setContact({
      name: "",
      title: "",
      relationship: "",
      email: "",
      phone: "",
      linkedin_url: "",
      notes: "",
    });
    setShowContact(false);
  };
  const removeContact = async (id: number) => {
    await api(`/api/applications/${application.id}/contacts/${id}`, {
      method: "DELETE",
    });
    onRefresh(await api<Application>(`/api/applications/${application.id}`));
  };
  const schedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api<Application>(
        `/api/applications/${application.id}/follow-ups`,
        { method: "POST", body: JSON.stringify(follow) },
      );
      onRefresh(updated);
      setFollow(emptyFollowUp);
      setShowFollow(false);
    } finally {
      setSaving(false);
    }
  };
  const complete = async (item: FollowUp) => {
    const next = window.prompt(
      "Next follow-up date (YYYY-MM-DD), or leave blank:",
      "",
    );
    const updated = await api<Application>(
      `/api/applications/${application.id}/follow-ups/${item.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          outcome: outcomes[item.id] || "Followed up",
          next_follow_up_at: next || null,
        }),
      },
    );
    onRefresh(updated);
  };
  const field = (key: keyof typeof draft, title: string, type = "text") => (
    <label>
      <span>{title}</span>
      <input
        type={type}
        value={String(draft[key] ?? "")}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </label>
  );
  const pending = (application.follow_ups || []).filter(
    (item) => !item.is_completed,
  );
  const completed = (application.follow_ups || []).filter(
    (item) => item.is_completed,
  );

  return (
    <div className="workspace-overlay">
      <div className="application-workspace">
        <header className="workspace-topbar">
          <button className="back-button" onClick={onClose}>
            <ArrowLeft size={18} /> Back to applications
          </button>
          <div className="workspace-actions">
            <ThemeButton theme={theme} onToggle={onTheme} />
            {edit ? (
              <>
                <button
                  className="secondary-button"
                  onClick={() => setEdit(false)}
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  onClick={saveDetails}
                  disabled={saving}
                >
                  <Save size={16} />
                  Save changes
                </button>
              </>
            ) : (
              <button
                className="secondary-button"
                onClick={() => setEdit(true)}
              >
                <Pencil size={15} />
                Edit details
              </button>
            )}
          </div>
        </header>
        <div className="workspace-body">
          <section className="application-banner">
            <span className={`company-logo xl tone-${application.id % 5}`}>
              {initials(application.company)}
            </span>
            <div>
              <p className="eyebrow">{application.company}</p>
              <h1>{application.role}</h1>
              <p>
                <MapPin size={14} />
                {application.location || "Location not specified"}
              </p>
              <div className="job-chips">
                {application.work_type && <span>{application.work_type}</span>}
                {application.employment_type && (
                  <span>{application.employment_type}</span>
                )}
                {application.posted_text && (
                  <span>{application.posted_text}</span>
                )}
                {application.applicants_text && (
                  <span>{application.applicants_text}</span>
                )}
              </div>
            </div>
            <div className="banner-side">
              <select
                value={application.status}
                onChange={(e) => changeStatus(e.target.value as Status)}
              >
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              {application.job_url && (
                <a href={application.job_url} target="_blank" rel="noreferrer">
                  {application.source === "Indeed"
                    ? "Indeed listing"
                    : application.source === "LinkedIn"
                      ? "LinkedIn listing"
                      : "Job listing"}{" "}
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </section>
          <div className="workspace-columns">
            <div className="workspace-primary">
              <section className="content-card">
                <div className="card-title">
                  <div>
                    <span className="section-icon">
                      <FileText size={17} />
                    </span>
                    <h2>Application details</h2>
                  </div>
                  {edit && <small>All fields are editable</small>}
                </div>
                {edit ? (
                  <div className="edit-grid">
                    {field("company", "Company")}
                    {field("role", "Role")}
                    {field("location", "Location")}
                    {field("applied_at", "Applied date", "date")}
                    {field("posted_text", "Posted")}
                    {field("applicants_text", "Applicants")}
                    {field("work_type", "Work arrangement")}
                    {field("employment_type", "Employment type")}
                    <label className="wide">
                      <span>Job description</span>
                      <textarea
                        rows={10}
                        value={draft.description}
                        onChange={(e) =>
                          setDraft({ ...draft, description: e.target.value })
                        }
                      />
                    </label>
                    <label className="wide">
                      <span>Personal notes</span>
                      <textarea
                        rows={4}
                        value={draft.notes}
                        onChange={(e) =>
                          setDraft({ ...draft, notes: e.target.value })
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <>
                    <div className="facts-row">
                      <div>
                        <small>Applied</small>
                        <strong>{formatDate(application.applied_at)}</strong>
                      </div>
                      <div>
                        <small>Next follow-up</small>
                        <strong>{formatDate(application.follow_up_at)}</strong>
                      </div>
                      <div>
                        <small>Source</small>
                        <strong>{application.source}</strong>
                      </div>
                      <div>
                        <small>LinkedIn job ID</small>
                        <strong>{application.external_job_id || "—"}</strong>
                      </div>
                    </div>
                    {application.notes && (
                      <div className="note-box">
                        <strong>Your notes</strong>
                        <p>{application.notes}</p>
                      </div>
                    )}
                    <div className="description">
                      <h3>About the job</h3>
                      <p>
                        {application.description ||
                          "No job description was captured. Use Edit details to paste it here for later analysis."}
                      </p>
                    </div>
                  </>
                )}
              </section>
              <section className="content-card">
                <div className="card-title">
                  <div>
                    <span className="section-icon amber">
                      <CalendarClock size={17} />
                    </span>
                    <h2>Follow-up planner</h2>
                  </div>
                  <button
                    className="primary-button small"
                    onClick={() => setShowFollow(!showFollow)}
                  >
                    <Plus size={15} />
                    Schedule
                  </button>
                </div>
                {showFollow && (
                  <form className="follow-form" onSubmit={schedule}>
                    <label>
                      <span>Date *</span>
                      <input
                        required
                        type="date"
                        min={today()}
                        value={follow.scheduled_for}
                        onChange={(e) =>
                          setFollow({
                            ...follow,
                            scheduled_for: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Channel</span>
                      <select
                        value={follow.channel}
                        onChange={(e) =>
                          setFollow({ ...follow, channel: e.target.value })
                        }
                      >
                        <option>EMAIL</option>
                        <option>PHONE</option>
                        <option>LINKEDIN</option>
                        <option>OTHER</option>
                      </select>
                    </label>
                    <label>
                      <span>Contact person</span>
                      <input
                        value={follow.contact_name}
                        onChange={(e) =>
                          setFollow({ ...follow, contact_name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Email / phone used</span>
                      <input
                        value={follow.contact_detail}
                        onChange={(e) =>
                          setFollow({
                            ...follow,
                            contact_detail: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="wide">
                      <span>Subject / purpose</span>
                      <input
                        value={follow.subject}
                        onChange={(e) =>
                          setFollow({ ...follow, subject: e.target.value })
                        }
                      />
                    </label>
                    <label className="wide">
                      <span>Plan or message notes</span>
                      <textarea
                        rows={3}
                        value={follow.notes}
                        onChange={(e) =>
                          setFollow({ ...follow, notes: e.target.value })
                        }
                      />
                    </label>
                    <div className="wide form-end">
                      <button className="primary-button" disabled={saving}>
                        Save follow-up
                      </button>
                    </div>
                  </form>
                )}
                {!pending.length && !completed.length ? (
                  <div className="mini-empty">
                    <Clock3 size={24} />
                    <p>
                      No follow-ups yet. Schedule one so this opportunity never
                      gets lost.
                    </p>
                  </div>
                ) : (
                  <div className="follow-list">
                    {pending.map((item) => (
                      <article className="follow-card" key={item.id}>
                        <span className="channel-icon">
                          {item.channel === "PHONE" ? (
                            <Phone size={17} />
                          ) : item.channel === "EMAIL" ? (
                            <Mail size={17} />
                          ) : (
                            <MessageSquare size={17} />
                          )}
                        </span>
                        <div>
                          <small>
                            {item.channel} · {formatDate(item.scheduled_for)}
                          </small>
                          <strong>
                            {item.subject || "Application follow-up"}
                          </strong>
                          <p>
                            {item.contact_name || "Contact not specified"}
                            {item.contact_detail
                              ? ` · ${item.contact_detail}`
                              : ""}
                          </p>
                          {item.notes && <p className="muted">{item.notes}</p>}
                        </div>
                        <div className="follow-complete">
                          <input
                            placeholder="What happened?"
                            value={outcomes[item.id] || ""}
                            onChange={(e) =>
                              setOutcomes({
                                ...outcomes,
                                [item.id]: e.target.value,
                              })
                            }
                          />
                          <button onClick={() => complete(item)}>
                            <Check size={15} />
                            Mark done
                          </button>
                        </div>
                      </article>
                    ))}
                    {completed.map((item) => (
                      <article className="follow-card completed" key={item.id}>
                        <span className="channel-icon">
                          <Check size={17} />
                        </span>
                        <div>
                          <small>
                            COMPLETED · {formatDate(item.completed_at)}
                          </small>
                          <strong>
                            {item.subject || `${label(item.channel)} follow-up`}
                          </strong>
                          <p>
                            {item.contact_detail ||
                              item.contact_name ||
                              "No recipient recorded"}
                          </p>
                          {item.outcome && (
                            <p className="outcome">Outcome: {item.outcome}</p>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
            <aside className="workspace-sidebar">
              <section className="content-card compact">
                <div className="card-title">
                  <div>
                    <span className="section-icon">
                      <UserRound size={17} />
                    </span>
                    <div className="contact-heading-copy">
                      <h2>People you can reach out to</h2>
                      <small>
                        {application.contacts?.filter((item) =>
                          /job poster|hiring team/i.test(item.notes),
                        ).length || 0}{" "}
                        from this job
                      </small>
                    </div>
                  </div>
                </div>
                <button
                  className="mini-add contact-add"
                  onClick={() => setShowContact((value) => !value)}
                >
                  <Plus size={14} />
                  Add another contact
                </button>
                {showContact && (
                  <form className="contact-form" onSubmit={addContact}>
                    <input
                      required
                      placeholder="Name"
                      value={contact.name}
                      onChange={(e) =>
                        setContact({ ...contact, name: e.target.value })
                      }
                    />
                    <input
                      placeholder="Title"
                      value={contact.title}
                      onChange={(e) =>
                        setContact({ ...contact, title: e.target.value })
                      }
                    />
                    <input
                      placeholder="Relationship (e.g. 3rd+)"
                      value={contact.relationship}
                      onChange={(e) =>
                        setContact({ ...contact, relationship: e.target.value })
                      }
                    />
                    <input
                      type="email"
                      placeholder="Email"
                      value={contact.email}
                      onChange={(e) =>
                        setContact({ ...contact, email: e.target.value })
                      }
                    />
                    <input
                      type="tel"
                      placeholder="Phone"
                      value={contact.phone}
                      onChange={(e) =>
                        setContact({ ...contact, phone: e.target.value })
                      }
                    />
                    <input
                      type="url"
                      placeholder="LinkedIn URL"
                      value={contact.linkedin_url}
                      onChange={(e) =>
                        setContact({ ...contact, linkedin_url: e.target.value })
                      }
                    />
                    <button className="primary-button">Save contact</button>
                  </form>
                )}
                {!!application.contacts?.length && (
                  <div className="contacts-list">
                    {application.contacts.map((item) => (
                      <article className="contact-card" key={item.id}>
                        <span className="contact-avatar">
                          {initials(item.name)}
                        </span>
                        <div>
                          <strong>{item.name}</strong>
                          {item.relationship && (
                            <small>{item.relationship}</small>
                          )}
                          <p>{item.title || "Hiring contact"}</p>
                          {item.notes && (
                            <span className="contact-source">{item.notes}</span>
                          )}
                          <div>
                            {item.linkedin_url && (
                              <a href={item.linkedin_url} target="_blank">
                                <ExternalLink size={13} />
                                LinkedIn
                              </a>
                            )}
                            {item.email && (
                              <a href={`mailto:${item.email}`}>
                                <Mail size={13} />
                                Email
                              </a>
                            )}
                            {item.phone && (
                              <a href={`tel:${item.phone}`}>
                                <Phone size={13} />
                                Call
                              </a>
                            )}
                          </div>
                        </div>
                        <button
                          className="contact-remove"
                          onClick={() => removeContact(item.id)}
                        >
                          <X size={13} />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
                <div className="contact-discovery">
                  <strong>Find more relevant people</strong>
                  <p>
                    Search recruiters and hiring managers at {application.company}
                    directly on LinkedIn.
                  </p>
                  <a
                    href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
                      `${application.company} recruiter talent acquisition hiring manager ${application.role}`,
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Search size={13} />
                    Find more people on LinkedIn
                  </a>
                </div>
                {edit ? (
                  <div className="edit-stack">
                    {field("contact_name", "Name")}
                    {field("contact_email", "Email", "email")}
                    {field("contact_phone", "Phone", "tel")}
                    {field("contact_linkedin", "LinkedIn URL", "url")}
                  </div>
                ) : application.contact_name ||
                  application.contact_email ||
                  application.contact_phone ||
                  application.contact_linkedin ? (
                  <div className="contact-view">
                    <strong>
                      {application.contact_name || "Primary contact"}
                    </strong>
                    {application.contact_email && (
                      <a href={`mailto:${application.contact_email}`}>
                        <Mail size={14} />
                        {application.contact_email}
                      </a>
                    )}
                    {application.contact_phone && (
                      <a href={`tel:${application.contact_phone}`}>
                        <Phone size={14} />
                        {application.contact_phone}
                      </a>
                    )}
                    {application.contact_linkedin && (
                      <a href={application.contact_linkedin} target="_blank">
                        <ExternalLink size={14} />
                        LinkedIn profile
                      </a>
                    )}{" "}
                    {!application.contact_email &&
                      !application.contact_phone &&
                      !application.contact_linkedin &&
                      !application.contacts?.length && (
                        <p>
                          Edit this application to save the recruiter’s email,
                          phone, or LinkedIn profile.
                        </p>
                      )}
                  </div>
                ) : null}
              </section>
              <section className="content-card compact">
                <div className="card-title">
                  <div>
                    <span className="section-icon green">
                      <Sparkles size={17} />
                    </span>
                    <h2>Application health</h2>
                  </div>
                </div>
                <div className="health-list">
                  <div>
                    <span>Details captured</span>
                    <strong>
                      {
                        [
                          application.location,
                          application.description,
                          application.employment_type,
                        ].filter(Boolean).length
                      }
                      /3
                    </strong>
                  </div>
                  <div>
                    <span>Contact available</span>
                    <strong>
                      {application.contact_email ||
                      application.contact_phone ||
                      application.contacts?.length
                        ? "Yes"
                        : "No"}
                    </strong>
                  </div>
                  <div>
                    <span>Follow-up planned</span>
                    <strong>{pending.length ? "Yes" : "No"}</strong>
                  </div>
                </div>
              </section>
              <section className="content-card compact timeline-card">
                <div className="card-title">
                  <div>
                    <span className="section-icon">
                      <Clock3 size={17} />
                    </span>
                    <h2>Timeline</h2>
                  </div>
                </div>
                {[...(application.events || [])]
                  .sort((a, b) => b.event_at.localeCompare(a.event_at))
                  .map((event) => (
                  <div className="timeline-event" key={event.id}>
                    <span />
                    <div>
                      <strong>{event.description}</strong>
                      <small>{formatDateTime(event.event_at)}</small>
                    </div>
                  </div>
                  ))}
              </section>
              <button className="danger-button full" onClick={onDelete}>
                <Trash2 size={16} />
                Delete application
              </button>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null | undefined>(undefined);
  const [applications, setApplications] = useState<Application[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>({
    total: 0,
    follow_ups_due: 0,
    interviews: 0,
    offers: 0,
    by_status: {},
  });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [locationFilter, setLocationFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("NEWEST");
  const [roleFilter, setRoleFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeMetric, setActiveMetric] = useState<string | null>(null);
  const [selected, setSelected] = useState<Application | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyApplication });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nav, setNav] = useState(() => matchMedia("(max-width: 1024px)").matches);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationMutedUntil, setNotificationMutedUntil] = useState(
    () => Number(localStorage.getItem("trajectory-notifications-seen-until") || 0),
  );
  const [navCollapsed, setNavCollapsed] = useState(
    () => localStorage.getItem("trajectory-nav") === "collapsed",
  );
  const [theme, setTheme] = useState<Theme>(
    () =>
      (localStorage.getItem("trajectory-theme") as Theme) ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
  useEffect(() => {
    getCurrentUser()
      .then(setAuthUser)
      .catch(() => setAuthUser(null));
  }, []);
  useEffect(() => {
    if (!authUser) return;
    const stopMonitoring = monitorSessionActivity();
    const stopListening = onSessionExpired(() => {
      setAuthUser(null);
      setApplications([]);
      setSelected(null);
      setError("");
    });
    return () => {
      stopMonitoring();
      stopListening();
    };
  }, [authUser]);
  useEffect(() => {
    const responsiveNav = matchMedia("(max-width: 1024px)");
    const adaptNavigation = (event: MediaQueryListEvent) => setNav(event.matches);
    responsiveNav.addEventListener("change", adaptNavigation);
    return () => responsiveNav.removeEventListener("change", adaptNavigation);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("trajectory-theme", theme);
  }, [theme]);
  useEffect(
    () =>
      localStorage.setItem(
        "trajectory-nav",
        navCollapsed ? "collapsed" : "expanded",
      ),
    [navCollapsed],
  );
  const toggleTheme = () =>
    setTheme((value) => (value === "light" ? "dark" : "light"));
  const attentionCount =
    dashboard.follow_ups_due + (dashboard.by_status.PENDING_CONFIRMATION || 0);
  const notificationsMuted = notificationMutedUntil > Date.now();
  const visibleAttentionCount = notificationsMuted ? 0 : attentionCount;
  useEffect(() => {
    if (!notificationsMuted) return;
    const timer = window.setTimeout(
      () => setNotificationMutedUntil(0),
      Math.max(0, notificationMutedUntil - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [notificationMutedUntil, notificationsMuted]);
  const markNotificationsSeen = () => {
    const until = Date.now() + 60 * 60 * 1000;
    localStorage.setItem("trajectory-notifications-seen-until", String(until));
    setNotificationMutedUntil(until);
  };
  const toggleNotifications = () => {
    setNotificationsOpen((value) => !value);
    if (!notificationsOpen && attentionCount) markNotificationsSeen();
  };
  const showDashboardGroup = (value: string) => {
    setActiveMetric(value);
    setFilter(value);
    setSearch("");
    setLocationFilter("ALL");
    setDateFilter("ALL");
    setRoleFilter("");
    setFiltersOpen(false);
    scrollPageTop();
  };
  useEffect(() => {
    const clearMetricHighlight = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest(".stat-card")) setActiveMetric(null);
    };
    document.addEventListener("click", clearMetricHighlight);
    return () => document.removeEventListener("click", clearMetricHighlight);
  }, []);
  const enableNotifications = async () => {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    if (permission === "granted" && attentionCount) {
      new Notification("Job Tracker reminders", {
        body: `${attentionCount} application${attentionCount === 1 ? " needs" : "s need"} your attention.`,
      });
      markNotificationsSeen();
    }
  };
  useEffect(() => {
    if (!attentionCount || notificationsMuted || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const signature = `${attentionCount}:${dashboard.follow_ups_due}:${dashboard.by_status.PENDING_CONFIRMATION || 0}`;
    if (localStorage.getItem("trajectory-last-notification") === signature) return;
    new Notification("Job Tracker reminders", {
      body: `${attentionCount} application${attentionCount === 1 ? " needs" : "s need"} your attention.`,
    });
    localStorage.setItem("trajectory-last-notification", signature);
  }, [attentionCount, dashboard.follow_ups_due, dashboard.by_status.PENDING_CONFIRMATION, notificationsMuted]);
  useEffect(() => {
    const button = document.createElement("button");
    button.className = "floating-theme-toggle";
    button.type = "button";
    button.setAttribute("aria-label", "Toggle light and dark mode");
    button.onclick = toggleTheme;
    document.body.appendChild(button);
    return () => button.remove();
  }, []);
  useEffect(() => {
    const button = document.querySelector<HTMLButtonElement>(
      ".floating-theme-toggle",
    );
    if (button) {
      button.textContent = theme === "light" ? "☾" : "☀";
      button.title = `Switch to ${theme === "light" ? "dark" : "light"} mode`;
    }
  }, [theme]);
  const load = useCallback(async () => {
    if (!authUser) return;
    try {
      const [apps, stats] = await Promise.all([
        api<Application[]>("/api/applications"),
        api<Dashboard>("/api/dashboard"),
      ]);
      setApplications(apps);
      setDashboard(stats);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  }, [authUser]);
  useEffect(() => {
    if (authUser) load();
  }, [load]);
  useEffect(() => {
    const refresh = () => load();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    const interval = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load, authUser]);
  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "granted" || !attentionCount) return;
    const key = `trajectory-notified-${today()}-${attentionCount}`;
    if (localStorage.getItem(key)) return;
    new Notification("Job Tracker needs your attention", {
      body: `${dashboard.by_status.PENDING_CONFIRMATION || 0} pending confirmation and ${dashboard.follow_ups_due} follow-up reminder(s).`,
    });
    localStorage.setItem(key, "true");
  }, [attentionCount, dashboard.by_status.PENDING_CONFIRMATION, dashboard.follow_ups_due]);
  const open = async (app: Application) => {
    setSelected(await api<Application>(`/api/applications/${app.id}`));
    scrollPageTop();
  };
  const closeWorkspace = () => {
    setSelected(null);
    scrollPageTop();
  };
  const selectApplicationFilter = (value: string) => {
    setFilter(value);
    setActiveMetric(null);
    if (matchMedia("(max-width: 1024px)").matches) setNav(false);
    scrollPageTop();
  };
  const refresh = async (app: Application) => {
    setSelected(app);
    await load();
  };
  const remove = async () => {
    if (
      selected &&
      confirm(`Delete ${selected.role} at ${selected.company}?`)
    ) {
      await api(`/api/applications/${selected.id}`, { method: "DELETE" });
      closeWorkspace();
      await load();
    }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api("/api/applications", {
      method: "POST",
      body: JSON.stringify({
        ...form,
        job_url: form.job_url || null,
        follow_up_at: form.follow_up_at || null,
      }),
    });
    setShowForm(false);
    setForm({ ...emptyApplication });
    await load();
  };
  const locations = useMemo(
    () =>
      [...new Set(applications.map((a) => a.location).filter(Boolean))].sort(),
    [applications],
  );
  const visible = useMemo(() => {
    const now = new Date();
    const cutoff =
      dateFilter === "7"
        ? new Date(now.getTime() - 7 * 86400000)
        : dateFilter === "30"
          ? new Date(now.getTime() - 30 * 86400000)
          : null;
    return applications
      .filter((a) => {
        const applied = a.applied_at
          ? new Date(`${a.applied_at}T00:00:00`)
          : null;
        return (
          (filter === "ALL" ||
            (filter === "FOLLOW_UP" &&
              a.follow_up_at &&
              a.follow_up_at <= today() &&
              !FINISHED_STATUSES.includes(a.status)) ||
            (filter === "INTERVIEW" &&
              ["INTERVIEW", "TECHNICAL_INTERVIEW", "FINAL_INTERVIEW"].includes(a.status)) ||
            a.status === filter) &&
          (locationFilter === "ALL" || a.location === locationFilter) &&
          (!cutoff || Boolean(applied && applied >= cutoff)) &&
          (!roleFilter ||
            a.role.toLowerCase().includes(roleFilter.toLowerCase())) &&
          `${a.company} ${a.role} ${a.location}`
            .toLowerCase()
            .includes(search.toLowerCase())
        );
      })
      .sort((a, b) =>
        sortBy === "COMPANY_ASC"
          ? a.company.localeCompare(b.company)
          : sortBy === "COMPANY_DESC"
            ? b.company.localeCompare(a.company)
            : sortBy === "ROLE_ASC"
              ? a.role.localeCompare(b.role)
              : sortBy === "FOLLOW_UP"
                ? (a.follow_up_at || "9999").localeCompare(
                    b.follow_up_at || "9999",
                  )
                : b.created_at.localeCompare(a.created_at) ||
                  b.id - a.id,
      );
  }, [
    applications,
    filter,
    search,
    locationFilter,
    dateFilter,
    roleFilter,
    sortBy,
  ]);
  if (!authUser) return <AuthGate user={authUser} />;
  if (selected)
    return (
      <ApplicationWorkspace
        application={selected}
        onClose={closeWorkspace}
        onRefresh={refresh}
        onDelete={remove}
        theme={theme}
        onTheme={toggleTheme}
      />
    );
  return (
    <div className={`app-shell ${navCollapsed ? "nav-collapsed" : ""}`}>
      <aside className={`sidebar ${nav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <button
            className="brand-mark"
            onClick={() => navCollapsed && setNavCollapsed(false)}
            title={navCollapsed ? "Expand navigation" : undefined}
            aria-label={navCollapsed ? "Expand navigation" : "Trajectory"}
          >
            <Target size={21} />
          </button>
          <span>Trajectory</span>
          {!navCollapsed && (
            <button
              className="collapse-nav"
              onClick={() => setNavCollapsed(true)}
              title="Collapse navigation"
              aria-label="Collapse navigation"
            >
              <PanelLeftClose size={18} />
            </button>
          )}
          <button className="mobile-close" onClick={() => setNav(false)}>
            <X />
          </button>
        </div>
        <nav>
          <button className={`nav-item ${filter === "ALL" ? "active" : ""}`} onClick={() => selectApplicationFilter("ALL")}>
            <LayoutDashboard size={18} />
            Overview
          </button>
          <button className={`nav-item ${filter === "INTERVIEW" ? "active" : ""}`} onClick={() => selectApplicationFilter("INTERVIEW")}>
            <Send size={18} />
            Interviews <span>{dashboard.interviews}</span>
          </button>
          <button className={`nav-item ${filter === "FOLLOW_UP" ? "active" : ""}`} onClick={() => selectApplicationFilter("FOLLOW_UP")}>
            <CalendarClock size={18} />
            Follow-ups <span>{dashboard.follow_ups_due}</span>
          </button>
          <GoogleSheetsCard />
        </nav>
        <div className="sidebar-spacer" />
        <AccountCard user={authUser} onSignOut={async () => { await signOut(); setAuthUser(null); }} />
        <div className="tip-card">
          <Sparkles size={18} />
          <strong>Your search, organized</strong>
          <p>
            Every application has its own workspace for notes, contacts and
            follow-ups.
          </p>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setNav(true)}>
            <Menu />
          </button>
          <div className="global-search">
            <Search size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, role, or location..."
            />
          </div>
          <div className="topbar-actions">
            <ThemeButton theme={theme} onToggle={toggleTheme} />
            <button
              className="notification-button"
              onClick={toggleNotifications}
              aria-label="Open notifications"
              title="Notifications"
            >
              <Bell size={17} />
              {visibleAttentionCount > 0 && <span>{visibleAttentionCount}</span>}
            </button>
            <button
              className="primary-button"
              onClick={() => setShowForm(true)}
            >
              <Plus size={18} />
              Add application
            </button>
          </div>
        </header>
        <div className="page-content">
          {notificationsOpen && (
            <section className="notification-panel">
              <div>
                <strong>Notifications</strong>
                <button onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><X size={15} /></button>
              </div>
              <p>
                <b>{dashboard.by_status.PENDING_CONFIRMATION || 0}</b> external application(s) need confirmation.
              </p>
              <p>
                <b>{dashboard.follow_ups_due}</b> follow-up reminder(s) are due.
              </p>
              {"Notification" in window && Notification.permission !== "granted" && (
                <button className="primary-button" onClick={enableNotifications}>Enable desktop notifications</button>
              )}
            </section>
          )}
          <section className="page-heading">
            <div>
              <p className="eyebrow">YOUR JOB SEARCH</p>
              <h1>Applications, clearly organized.</h1>
              <p>Plan every next move and keep a complete history.</p>
            </div>
            <span className="today-pill">
              <CircleDot size={14} />
              {formatDate(today())}
            </span>
          </section>
          {error && <div className="error-banner">{error}</div>}
          <section className="stats-grid">
            {[
              ["Total applications", dashboard.total, <BriefcaseBusiness />, "ALL"],
              ["Follow-ups due", dashboard.follow_ups_due, <CalendarClock />, "FOLLOW_UP"],
              ["Active interviews", dashboard.interviews, <Send />, "INTERVIEW"],
              ["Offers", dashboard.offers, <Check />, "OFFER"],
            ].map(([title, value, icon, target], i) => (
              <button type="button" className={`stat-card ${activeMetric === target ? "selected" : ""}`} key={String(title)} onClick={() => showDashboardGroup(String(target))}>
                <div>
                  <span>{title}</span>
                  <strong>{value}</strong>
                  <small>
                    {i === 1
                      ? "Ready for your attention"
                      : "Across your pipeline"}
                  </small>
                </div>
                <span
                  className={`stat-icon ${["blue", "amber", "violet", "green"][i]}`}
                >
                  {icon}
                </span>
              </button>
            ))}
          </section>
          <section className="workspace-card" id="applications-workspace">
            <div className="workspace-header">
              <div>
                <h2>Applications</h2>
                <p>Open any card for the complete workspace</p>
              </div>
              <div className="filter-tabs">
                {["ALL", "PENDING_CONFIRMATION", "APPLIED", "INTERVIEW", "FOLLOW_UP", "CLOSED"].map((v) => (
                  <button
                    key={v}
                    className={filter === v ? "active" : ""}
                    onClick={() => selectApplicationFilter(v)}
                  >
                    {v === "FOLLOW_UP"
                      ? "Needs follow-up"
                      : v === "PENDING_CONFIRMATION"
                        ? "Needs attention"
                        : label(v)}
                  </button>
                ))}
                <button
                  className={
                    filtersOpen ? "active filter-trigger" : "filter-trigger"
                  }
                  onClick={() => setFiltersOpen((value) => !value)}
                >
                  <SlidersHorizontal size={13} />
                  Filters
                </button>
              </div>
            </div>
            {filtersOpen && (
              <div className="advanced-filters">
                <label>
                  <span>Location</span>
                  <select
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                  >
                    <option value="ALL">All locations</option>
                    {locations.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Applied date</span>
                  <select
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                  >
                    <option value="ALL">All time</option>
                    <option value="7">Last 7 days</option>
                    <option value="30">Last 30 days</option>
                  </select>
                </label>
                <label>
                  <span>Role contains</span>
                  <input
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    placeholder="e.g. Python"
                  />
                </label>
                <label>
                  <span>Sort</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="NEWEST">Newest applied</option>
                    <option value="COMPANY_ASC">Company A–Z</option>
                    <option value="COMPANY_DESC">Company Z–A</option>
                    <option value="ROLE_ASC">Role A–Z</option>
                    <option value="FOLLOW_UP">Next follow-up</option>
                  </select>
                </label>
                <button
                  className="clear-filters"
                  onClick={() => {
                    setLocationFilter("ALL");
                    setDateFilter("ALL");
                    setRoleFilter("");
                    setSortBy("NEWEST");
                  }}
                >
                  Clear
                </button>
              </div>
            )}
            {loading ? (
              <div className="empty-state">
                <span className="loader" />
              </div>
            ) : !visible.length ? (
              <div className="empty-state">
                <span className="empty-illustration">
                  <Inbox />
                </span>
                <h3>No applications in this view</h3>
                <p>Add an application or choose another filter.</p>
              </div>
            ) : (
              <div className="application-cards">
                {visible.map((a) => (
                  <button
                    className="application-card"
                    key={a.id}
                    onClick={() => open(a)}
                  >
                    <div className="application-card-top">
                      <span className={`company-logo tone-${a.id % 5}`}>
                        {initials(a.company)}
                      </span>
                      <span
                        className={`status-badge status-${a.status.toLowerCase()}`}
                      >
                        {label(a.status)}
                      </span>
                    </div>
                    <h3>{a.role}</h3>
                    <p className="company-name">{a.company}</p>
                    <p className="location-line">
                      <MapPin size={13} />
                      {a.location || "Location not specified"}
                    </p>
                    <div className="application-card-footer">
                      <span>
                        <small>APPLIED</small>
                        {formatDate(a.applied_at)}
                      </span>
                      <span>
                        <small>NEXT FOLLOW-UP</small>
                        {formatDate(a.follow_up_at)}
                      </span>
                      <ChevronRight />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
      {showForm && (
        <div className="modal-backdrop" onMouseDown={() => setShowForm(false)}>
          <section className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">NEW OPPORTUNITY</p>
                <h2>Add an application</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowForm(false)}
              >
                <X />
              </button>
            </div>
            <form onSubmit={create}>
              <div className="form-grid">
                {(["company", "role", "location"] as const).map((k) => (
                  <label key={k}>
                    <span>{label(k)}</span>
                    <input
                      required={k !== "location"}
                      value={form[k]}
                      onChange={(e) =>
                        setForm({ ...form, [k]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  <span>Status</span>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value as Status })
                    }
                  >
                    {STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Applied date</span>
                  <input
                    type="date"
                    value={form.applied_at}
                    onChange={(e) =>
                      setForm({ ...form, applied_at: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span>First follow-up</span>
                  <input
                    type="date"
                    value={form.follow_up_at}
                    onChange={(e) =>
                      setForm({ ...form, follow_up_at: e.target.value })
                    }
                  />
                </label>
                <label className="full-width">
                  <span>LinkedIn URL</span>
                  <input
                    type="url"
                    value={form.job_url}
                    onChange={(e) =>
                      setForm({ ...form, job_url: e.target.value })
                    }
                  />
                </label>
                <label className="full-width">
                  <span>Notes</span>
                  <textarea
                    rows={4}
                    value={form.notes}
                    onChange={(e) =>
                      setForm({ ...form, notes: e.target.value })
                    }
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
                <button className="primary-button">Save application</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
