(() => {
  const VERSION = "0.1.0";
  const INSTANCE_KEY = "__JOB_TRACKER_INDEED_DETECTOR__";
  if (window[INSTANCE_KEY]) return;
  window[INSTANCE_KEY] = { version: VERSION };

  const LOG = "[Job Tracker: Indeed]";
  const PENDING_KEY = "jobTrackerIndeedPending";
  const RECORDED_PREFIX = "jobTrackerIndeedRecorded:";
  const APPLY_PATTERN = /^(apply now|easily apply|apply on company site|continue to apply|apply)\b/i;
  const CONFIRMATION_PATTERNS = [
    /your application has been submitted/i,
    /application submitted/i,
    /your application was sent/i,
    /application successfully submitted/i,
    /the employer has received your application/i,
    /application received/i,
  ];
  let cachedJob = null;
  let pendingJob = readPending();
  let sending = false;
  let lastUrl = location.href;
  let externalApplyAwaitingAnswer = false;

  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const cleanDescription = (value) => (value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join("\n")
    .trim();
  const log = (...values) => console.info(LOG, ...values);
  const warn = (...values) => console.warn(LOG, ...values);

  function extensionAvailable() {
    try { return Boolean(chrome?.runtime?.id); } catch { return false; }
  }

  function toast(message, kind = "success") {
    document.getElementById("job-tracker-indeed-toast")?.remove();
    const node = document.createElement("div");
    node.id = "job-tracker-indeed-toast";
    node.className = `job-tracker-indeed-toast ${kind}`;
    const heading = document.createElement("strong");
    const copy = document.createElement("span");
    heading.textContent = "Job Tracker";
    copy.textContent = message;
    node.append(heading, copy);
    document.body.appendChild(node);
    requestAnimationFrame(() => node.classList.add("visible"));
    setTimeout(() => node.remove(), 5000);
  }

  function readPending() {
    try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null"); } catch { return null; }
  }

  function savePending(job, external = false) {
    pendingJob = { ...job, external_apply: external };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pendingJob));
    if (extensionAvailable()) {
      try { chrome.storage.local.set({ pendingIndeedApplication: pendingJob }); } catch { /* Reload reconnects storage. */ }
    }
  }

  function clearPending() {
    pendingJob = null;
    externalApplyAwaitingAnswer = false;
    sessionStorage.removeItem(PENDING_KEY);
    if (extensionAvailable()) {
      try { chrome.storage.local.remove("pendingIndeedApplication"); } catch { /* Nothing else to clear. */ }
    }
    document.getElementById("job-tracker-indeed-confirm")?.remove();
  }

  function jsonLdJob() {
    const visit = (value) => {
      if (!value || typeof value !== "object") return null;
      if (value["@type"] === "JobPosting" || (Array.isArray(value["@type"]) && value["@type"].includes("JobPosting"))) return value;
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) {
          for (const item of child) { const found = visit(item); if (found) return found; }
        } else if (child && typeof child === "object") {
          const found = visit(child); if (found) return found;
        }
      }
      return null;
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { const found = visit(JSON.parse(script.textContent || "null")); if (found) return found; } catch { /* Ignore unrelated metadata. */ }
    }
    return null;
  }

  function firstText(...selectors) {
    for (const selector of selectors) {
      const value = clean(document.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return "";
  }

  function indeedJobId() {
    const url = new URL(location.href);
    for (const key of ["jk", "vjk", "jobId", "jobid"]) {
      const value = clean(url.searchParams.get(key));
      if (value) return value;
    }
    const dataId = document.querySelector("[data-jk]")?.getAttribute("data-jk") ||
      document.querySelector("[data-jobkey]")?.getAttribute("data-jobkey");
    if (dataId) return clean(dataId);
    const canonical = document.querySelector('link[rel="canonical"]')?.href || "";
    return clean(new URL(canonical || location.href).searchParams.get("jk")) ||
      clean((canonical || location.href).match(/(?:jk=|\/job\/)([a-zA-Z0-9_-]{6,})/)?.[1]);
  }

  function structuredLocation(data) {
    const locations = Array.isArray(data?.jobLocation) ? data.jobLocation : [data?.jobLocation];
    const address = locations.find(Boolean)?.address || {};
    return [...new Set([
      address.addressLocality,
      address.addressRegion,
      address.addressCountry?.name || address.addressCountry,
    ].map(clean).filter(Boolean))].join(", ");
  }

  function extractJob() {
    const externalJobId = indeedJobId();
    if (!externalJobId) return null;
    const data = jsonLdJob();
    const role = clean(data?.title) || firstText(
      '[data-testid="jobsearch-JobInfoHeader-title"]',
      "h1.jobsearch-JobInfoHeader-title",
      "h1",
    );
    const company = clean(data?.hiringOrganization?.name) || firstText(
      '[data-testid="inlineHeader-companyName"]',
      '[data-testid="jobsearch-InlineCompanyRating-companyHeader"]',
      ".jobsearch-InlineCompanyRating-companyHeader",
      "[data-company-name]",
    );
    const locationText = structuredLocation(data) || firstText(
      '[data-testid="job-location"]',
      '[data-testid="jobsearch-JobInfoHeader-companyLocation"]',
      ".jobsearch-JobInfoHeader-subtitle > div:last-child",
      ".companyLocation",
    );
    const description = cleanDescription(
      document.querySelector("#jobDescriptionText")?.innerText ||
      document.querySelector('[data-testid="jobsearch-jobDescriptionText"]')?.innerText ||
      data?.description || "",
    );
    const pageText = clean(document.body?.innerText);
    const postedText = clean(pageText.match(/(?:posted\s+)?(?:today|just posted|\d+\+?\s+(?:minute|hour|day|week|month)s?\s+ago)/i)?.[0]);
    const employmentType = clean((Array.isArray(data?.employmentType) ? data.employmentType[0] : data?.employmentType) ||
      pageText.match(/\b(full-time|part-time|contract|temporary|internship)\b/i)?.[0]);
    const workType = clean(pageText.match(/\b(remote|hybrid|on-site|in-person)\b/i)?.[0]).replace(/^in-person$/i, "On-site");
    const emails = [...new Set(description.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])];
    const contacts = emails.slice(0, 5).map((email) => ({
      name: email,
      title: "Application contact from Indeed job description",
      relationship: "",
      linkedin_url: "",
      email,
      phone: "",
      notes: "Email address published in the Indeed job description",
    }));
    if (!role || !company) return null;
    return {
      external_job_id: externalJobId,
      company: company.slice(0, 120),
      role: role.replace(/\s+-\s+job post.*$/i, "").slice(0, 160),
      location: locationText.slice(0, 160),
      job_url: `https://${location.hostname}/viewjob?jk=${encodeURIComponent(externalJobId)}`,
      description: description.slice(0, 30000),
      posted_text: postedText.slice(0, 100),
      applicants_text: "",
      work_type: workType.slice(0, 80),
      employment_type: employmentType.slice(0, 80),
      contacts,
      applied: true,
    };
  }

  function refreshJob() {
    const job = extractJob();
    if (job) cachedJob = job;
    return cachedJob;
  }

  function sendMessage(type, job) {
    return new Promise((resolve, reject) => {
      if (!extensionAvailable()) { reject(new Error("Extension was reloaded. Refresh this Indeed tab.")); return; }
      try {
        chrome.runtime.sendMessage({ type, payload: job }, (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (response?.ok) resolve(response);
          else reject(new Error(response?.error || "Could not reach Job Tracker."));
        });
      } catch (error) { reject(error); }
    });
  }

  async function recordPending(job) {
    try {
      await sendMessage("IMPORT_INDEED_PENDING", job);
      log("Indeed application added to Needs Attention", job.external_job_id);
    } catch (error) { warn("Could not record pending Indeed application", error?.message || String(error)); }
  }

  async function recordConfirmed(job) {
    if (!job || sending || sessionStorage.getItem(`${RECORDED_PREFIX}${job.external_job_id}`) === "true") return;
    sending = true;
    try {
      const current = refreshJob();
      const payload = current?.external_job_id === job.external_job_id ? { ...job, ...current, applied: true } : { ...job, applied: true };
      const response = await sendMessage("IMPORT_INDEED_JOB", payload);
      sessionStorage.setItem(`${RECORDED_PREFIX}${job.external_job_id}`, "true");
      clearPending();
      toast(response.created ? "Indeed application recorded." : "Indeed application updated in Job Tracker.");
      log(response.created ? "Application created" : "Application updated", response.application);
    } catch (error) {
      warn("Confirmed Indeed application import failed", error?.message || String(error));
      toast(error?.message || "Could not record the Indeed application.", "error");
    } finally { sending = false; }
  }

  function confirmationVisible() {
    const text = clean(document.body?.innerText);
    return CONFIRMATION_PATTERNS.some((pattern) => pattern.test(text));
  }

  function showExternalConfirmation() {
    if (!pendingJob?.external_apply || document.getElementById("job-tracker-indeed-confirm")) return;
    const node = document.createElement("aside");
    node.id = "job-tracker-indeed-confirm";
    const heading = document.createElement("strong");
    const copy = document.createElement("span");
    const actions = document.createElement("div");
    const yes = document.createElement("button");
    const later = document.createElement("button");
    heading.textContent = "Did you finish applying?";
    copy.textContent = `${pendingJob.role} at ${pendingJob.company}`;
    yes.dataset.answer = "yes";
    yes.textContent = "Yes, record it";
    later.dataset.answer = "later";
    later.textContent = "Not yet";
    actions.append(yes, later);
    node.append(heading, copy, actions);
    node.addEventListener("click", (event) => {
      const answer = event.target.closest("button")?.dataset.answer;
      if (answer === "yes") recordConfirmed(pendingJob);
      if (answer === "later") node.remove();
    });
    document.body.appendChild(node);
  }

  function isExternalApply(control) {
    if (!(control instanceof HTMLAnchorElement) || !control.href) return false;
    try { return !/(^|\.)indeed\./i.test(new URL(control.href).hostname); } catch { return false; }
  }

  document.addEventListener("click", (event) => {
    const control = event.target.closest("button, a, [role='button']");
    if (!control) return;
    const label = clean(control.innerText || control.textContent || control.getAttribute("aria-label"));
    if (!APPLY_PATTERN.test(label)) return;
    const job = refreshJob();
    if (!job) { toast("Keep the full Indeed job details open before applying.", "error"); return; }
    const external = isExternalApply(control) || /company site/i.test(label);
    savePending(job, external);
    recordPending(job);
    externalApplyAwaitingAnswer = external;
    log(external ? "External Indeed Apply opened" : "Indeed Apply opened", job);
  }, true);

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; cachedJob = null; setTimeout(refreshJob, 400); }
    if (pendingJob && confirmationVisible()) recordConfirmed(pendingJob);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  window.addEventListener("focus", () => {
    refreshJob();
    if (externalApplyAwaitingAnswer || pendingJob?.external_apply) setTimeout(showExternalConfirmation, 500);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && pendingJob?.external_apply) setTimeout(showExternalConfirmation, 500);
  });

  if (extensionAvailable()) {
    try {
      chrome.storage.local.get("pendingIndeedApplication", ({ pendingIndeedApplication }) => {
        if (!pendingJob && pendingIndeedApplication) {
          pendingJob = pendingIndeedApplication;
          sessionStorage.setItem(PENDING_KEY, JSON.stringify(pendingJob));
        }
        if (pendingJob && confirmationVisible()) recordConfirmed(pendingJob);
      });
    } catch { /* Refresh after an extension reload reconnects this tab. */ }
  }
  [300, 1000, 2500].forEach((delay) => setTimeout(refreshJob, delay));
  log(`Indeed detector v${VERSION} ready.`);
})();
