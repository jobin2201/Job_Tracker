(() => {
  const SCRIPT_VERSION = "0.11.11";
  const INSTANCE_KEY = "__JOB_TRACKER_LINKEDIN_DETECTOR__";
  if (window[INSTANCE_KEY]) return;
  window[INSTANCE_KEY] = { version: SCRIPT_VERSION };
  document.documentElement.dataset.jobTrackerScriptVersion = SCRIPT_VERSION;
  const LOG = "[Job Tracker]";
  const EASY_APPLY = /\beasy apply\b/i;
  const EXTERNAL_APPLY = /^(?!easy\b)apply\b/i;
  const EXTERNAL_YES = /^yes$/i;
  const EXTERNAL_NO = /^no$/i;
  const SUBMIT = /^(submit application|submit)$/i;
  const CANCEL = /^(dismiss|cancel|discard|close)$/i;
  const CONFIRMATIONS = [
    /your application was sent/i,
    /application was sent/i,
    /application sent/i,
    /application submitted/i,
    /application has been submitted/i,
    /you applied/i,
  ];
  const PENDING_KEY = "jobTrackerPendingLinkedInJob";
  const EXTERNAL_PENDING_KEY = "jobTrackerPendingExternalLinkedInJob";
  const CONFIRMED_IMPORTS_KEY = "jobTrackerConfirmedImports";
  const AWAITING_KEY = "jobTrackerAwaitingLinkedInConfirmation";
  const RECORDED_PREFIX = "jobTrackerRecorded:";
  const PENDING_RECORDED_PREFIX = "jobTrackerExternalPendingRecorded:";
  const RECOVERY_PREFIX = "jobTrackerConfirmedRecovery:";
  const RECOVERY_GUARD_PREFIX = "jobTrackerRecoveryAttempted:";
  let lastUrl = location.href;
  let pendingJob = readPending();
  let externalPendingJobs = readExternalPending();
  let cachedJob = null;
  let lastKnownJobId = "";
  let awaitingConfirmation = sessionStorage.getItem(AWAITING_KEY) === "true";
  let confirmationTimers = [];
  let toastTimer = null;
  let sendInProgress = false;
  let finalizingApplication = false;

  const log = (...values) => console.info(LOG, ...values);
  const warn = (...values) => console.warn(LOG, ...values);
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const cleanDescription = (value) => (value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join("\n")
    .trim();

  function extensionAvailable() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  function storageSet(value) {
    if (!extensionAvailable()) return;
    try { chrome.storage.local.set(value); } catch { /* The tab must be refreshed after an extension reload. */ }
  }

  function storageRemove(key) {
    if (!extensionAvailable()) return;
    try { chrome.storage.local.remove(key); } catch { /* The tab must be refreshed after an extension reload. */ }
  }

  function readPending() {
    try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null"); } catch { return null; }
  }

  function readExternalPending() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(EXTERNAL_PENDING_KEY) || "{}");
      return stored?.external_job_id ? { [stored.external_job_id]: stored } : stored || {};
    } catch { return {}; }
  }

  function saveExternalPending(job) {
    const normalized = normalizeJob(job);
    externalPendingJobs[normalized.external_job_id] = normalized;
    sessionStorage.setItem(EXTERNAL_PENDING_KEY, JSON.stringify(externalPendingJobs));
    storageSet({ pendingExternalLinkedInApplications: externalPendingJobs });
  }

  function clearExternalPending(externalJobId) {
    delete externalPendingJobs[externalJobId];
    sessionStorage.setItem(EXTERNAL_PENDING_KEY, JSON.stringify(externalPendingJobs));
    storageSet({ pendingExternalLinkedInApplications: externalPendingJobs });
  }

  function currentExternalPending() {
    const id = jobId();
    return externalPendingJobs[id] || null;
  }

  function savePending(job) {
    const safeJob = normalizeJob(job);
    pendingJob = safeJob;
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(safeJob));
    storageSet({ pendingLinkedInApplication: safeJob });
  }

  function normalizeJob(job) {
    const limits = {
      external_job_id: 100, company: 120, role: 160, location: 160,
      job_url: 2000, description: 30000, posted_text: 100,
      applicants_text: 100, work_type: 80, employment_type: 80,
    };
    return Object.fromEntries(
      Object.entries(job || {}).map(([key, value]) => [
        key,
        typeof value === "string"
          ? (key === "description" ? cleanDescription(value) : clean(value)).slice(0, limits[key] || value.length)
          : value,
      ]),
    );
  }

  function mergeJob(previous, incoming) {
    if (!previous || previous.external_job_id !== incoming?.external_job_id) return normalizeJob(incoming);
    const merged = { ...previous };
    for (const [key, value] of Object.entries(incoming)) {
      if (key === "description") {
        if (cleanDescription(String(value || "")).length > cleanDescription(String(merged[key] || "")).length) merged[key] = value;
      } else if (key === "contacts" && Array.isArray(value) && value.length > (merged[key]?.length || 0)) {
        merged[key] = value;
      } else if (
        typeof value === "string" &&
        (!clean(String(merged[key] || "")) || /^LinkedIn (?:company|job \d+)$/i.test(clean(String(merged[key] || "")))) &&
        clean(value)
      ) {
        merged[key] = value;
      } else if (merged[key] === undefined && value !== undefined) {
        merged[key] = value;
      }
    }
    return normalizeJob(merged);
  }

  function clearPending() {
    pendingJob = null;
    awaitingConfirmation = false;
    confirmationTimers.forEach(clearTimeout);
    confirmationTimers = [];
    sessionStorage.removeItem(PENDING_KEY);
    sessionStorage.removeItem(AWAITING_KEY);
    storageRemove("pendingLinkedInApplication");
  }

  function firstText(...selectors) {
    for (const selector of selectors) {
      const value = clean(document.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return "";
  }

  function metaContent(...selectors) {
    for (const selector of selectors) {
      const value = clean(document.querySelector(selector)?.getAttribute("content"));
      if (value) return value;
    }
    return "";
  }

  function jsonLdJob() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || "null");
        const entries = Array.isArray(parsed) ? parsed : parsed?.["@graph"] || [parsed];
        const job = entries.find((item) => item?.["@type"] === "JobPosting");
        if (job) return job;
      } catch { /* Ignore unrelated LinkedIn metadata. */ }
    }
    return null;
  }

  function selectedCard() {
    return document.querySelector(
      '.jobs-search-results__list-item--active, .jobs-search-results__list-item[aria-selected="true"], [data-job-id][aria-current="true"], .job-card-container--clickable[aria-current="true"]'
    );
  }

  function jobId() {
    try {
      const url = new URL(window.location.href);

      // LinkedIn search pages expose the selected job in this query parameter.
      const queryId = clean(url.searchParams.get("currentJobId"));
      if (queryId) {
        lastKnownJobId = queryId;
        return queryId;
      }

      // Direct LinkedIn job details pages expose the ID in the URL path.
      const pathId = url.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];
      if (pathId) {
        lastKnownJobId = pathId;
        return pathId;
      }

      const card = selectedCard();
      const dataJobId = card?.getAttribute("data-job-id") || card?.closest("[data-job-id]")?.getAttribute("data-job-id");
      if (dataJobId) {
        lastKnownJobId = clean(dataJobId);
        return lastKnownJobId;
      }

      const cardHref = card?.querySelector('a[href*="/jobs/view/"]')?.href || "";
      const cardPathId = cardHref.match(/\/jobs\/view\/(\d+)/)?.[1];
      if (cardPathId) {
        lastKnownJobId = cardPathId;
        return cardPathId;
      }

      const canonical = document.querySelector('link[rel="canonical"]')?.href || "";
      const canonicalId = canonical.match(/\/jobs\/view\/(\d+)/)?.[1];
      if (canonicalId) {
        lastKnownJobId = canonicalId;
        return canonicalId;
      }

      // LinkedIn frequently rewrites its SPA URL during modal transitions.
      return lastKnownJobId;
    } catch (error) {
      warn("Failed to determine LinkedIn job ID", error?.message || String(error));
      return lastKnownJobId;
    }
  }

  function cardText(card, ...selectors) {
    for (const selector of selectors) {
      const value = clean(card?.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return "";
  }

  function visibleElements(root, selector) {
    return [...(root || document).querySelectorAll(selector)].filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    });
  }

  function findDetailsRoot(externalJobId) {
    const directLink = document.querySelector(`a[href*="/jobs/view/${externalJobId}"]`);
    let node = directLink;
    while (node && node !== document.body) {
      const textValue = clean(node.textContent);
      if (node.querySelector?.('[aria-label^="Company,"]') && /applicant|ago|reposted/i.test(textValue)) return node;
      node = node.parentElement;
    }
    const companyLabel = visibleElements(document, '[aria-label^="Company,"]').find((element) =>
      element.closest("main") || element.closest('[role="main"]')
    );
    return companyLabel?.closest("section") || companyLabel?.parentElement?.parentElement?.parentElement || document;
  }

  function semanticHeader(root) {
    const lines = visibleElements(root, "p, div").map((element) => clean(element.textContent));
    return lines.find((value) => value.length < 350 && /applicant/i.test(value) && /ago|reposted|day|week|month|hour/i.test(value)) || "";
  }

  function semanticTitle(root, company) {
    const values = visibleElements(root, "h1, h2, p").map((element) => clean(element.textContent));
    return values.find((value) =>
      value && value !== company && value.length < 180 &&
      !/applicant|promoted by|response insights|on-site|hybrid|remote|full-time|part-time|contract/i.test(value)
    ) || "";
  }

  function legacyDescriptionFallback() {
    const headings = visibleElements(document, "h1, h2, h3, h4, p, span");
    const heading = headings.find((element) => /^about the job$/i.test(clean(element.textContent)));
    if (!heading) return "";
    const section = heading.closest("section") || heading.parentElement?.parentElement?.parentElement;
    if (!section) return "";
    const moreText = visibleElements(section, "button, a, span").find((element) =>
      /^(show more|… more|\.\.\. more|more)$/i.test(clean(element.textContent)) || /show more/i.test(element.getAttribute("aria-label") || "")
    );
    const more = moreText?.closest("button, a, [role='button']") || moreText;
    if (more && more.getAttribute("aria-expanded") !== "true") more.click();
    return clean(section.textContent).replace(/^about the job\s*/i, "");
  }

  function findAboutJobSection() {
    const headings = visibleElements(document, "h1, h2, h3, h4, p, span").filter((element) =>
      /^about the job$/i.test(clean(element.textContent)),
    );
    for (const heading of headings) {
      let container = heading.parentElement;
      while (container && container !== document.body) {
        const boxes = [...container.querySelectorAll('[data-testid="expandable-text-box"]')];
        const followingBox = boxes.find((box) =>
          Boolean(heading.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING),
        );
        if (followingBox) return followingBox;
        container = container.parentElement;
      }
    }
    const expandableBoxes = visibleElements(document, '[data-testid="expandable-text-box"]')
      .filter((element) => clean(element.textContent).length > 200)
      .sort((a, b) => clean(b.textContent).length - clean(a.textContent).length);
    if (expandableBoxes[0]) return expandableBoxes[0];
    const known = visibleElements(document, "#job-details, .jobs-description__content, .jobs-box__html-content")[0];
    if (known) return known.closest("section") || known;
    const heading = headings[0];
    return heading?.closest("section") || heading?.parentElement?.parentElement?.parentElement || null;
  }

  function findDescriptionMoreButton(section) {
    const testButton = section?.querySelector('[data-testid="expandable-text-button"]');
    if (testButton) return testButton;
    return visibleElements(section, 'button, a, [role="button"], span').find((element) => {
      const text = clean(element.innerText || element.textContent);
      const aria = clean(element.getAttribute("aria-label"));
      return /^(show more|more|…\s*more|\.{3}\s*more)$/i.test(text) || /show more|expand.*description/i.test(aria);
    });
  }

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function extractStructuredDescription(section) {
    if (!section) return "";
    const clone = section.cloneNode(true);
    clone.querySelectorAll('button, [data-testid="expandable-text-button"]').forEach((element) => element.remove());
    clone.querySelectorAll("br").forEach((element) => element.replaceWith("\n"));
    clone.querySelectorAll("li").forEach((element) => {
      element.prepend("• ");
      element.append("\n");
    });
    clone.querySelectorAll("p, h1, h2, h3, h4, h5, h6").forEach((element) => element.append("\n"));
    return cleanDescription(clone.textContent).replace(/^about the job\s*/i, "").trim();
  }

  async function waitForTextGrowth(element, beforeLength, timeout = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      await wait(100);
      if (cleanDescription(element?.innerText || element?.textContent).length > beforeLength) return true;
    }
    return false;
  }

  async function extractFullDescription() {
    let section = findAboutJobSection();
    if (!section) return "";
    const before = extractStructuredDescription(section);
    const candidate = findDescriptionMoreButton(section);
    const clickable = candidate?.closest("button, a, [role='button']") || candidate;
    if (clickable && clickable.getAttribute("aria-expanded") !== "true") {
      clickable.click();
      await Promise.race([waitForTextGrowth(section, before.length), wait(750)]);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      section = findAboutJobSection() || section;
    }
    const after = extractStructuredDescription(section);
    return after.length >= before.length ? after : before;
  }

  function chooseBestDescription(...values) {
    return values.map(cleanDescription).filter(Boolean).sort((a, b) => b.length - a.length)[0] || "";
  }

  function validRole(value) {
    const text = clean(value);
    return Boolean(
      text &&
      text.length <= 160 &&
      !/^(search|linkedin job \d+|try premium|show match|tailor my resume|practice an interview|save|easy apply|apply now|about the job|\d+ notifications?)\b/i.test(text),
    );
  }

  function currentJobRole(externalJobId) {
    const links = visibleElements(document, `a[href*="/jobs/view/${externalJobId}"]`);
    const candidates = links.flatMap((link) => [
      clean(link.innerText || link.textContent),
      clean(link.getAttribute("aria-label")),
      clean(link.getAttribute("title")),
    ]).filter(validRole);
    return candidates.sort((a, b) => a.length - b.length)[0] || "";
  }

  function extractPatternText(root, pattern) {
    for (const element of visibleElements(root, "span, p, div")) {
      const value = clean(element.innerText || element.textContent);
      if (value.length > 250) continue;
      const match = value.match(pattern);
      if (match?.[0]) return clean(match[0]);
    }
    return "";
  }

  function extractHiringContacts() {
    const contacts = [];
    const seen = new Set();
    for (const link of visibleElements(document, 'a[href*="linkedin.com/in/"], a[href^="/in/"]')) {
      const url = new URL(link.href, location.origin).href.split("?")[0];
      if (seen.has(url)) continue;
      let container = link.parentElement;
      while (container && container !== document.body) {
        const text = clean(container.innerText || container.textContent);
        if (/job poster|hiring team|talent acquisition|recruiter|recruiting/i.test(text) && text.length <= 1800) break;
        container = container.parentElement;
      }
      container = container === document.body ? null : container;
      const context = clean(container?.innerText || container?.textContent);
      if (!/job poster|hiring team|talent acquisition|recruiter|recruiting/i.test(context)) continue;
      const name = clean(link.innerText || link.textContent).replace(/\s*[•·]\s*\d+(?:st|nd|rd|th)?\+?$/i, "");
      if (!name || name.length > 120) continue;
      const lines = (container?.innerText || "").split(/\n+/).map(clean).filter(Boolean);
      const relationship = lines.find((line) => /^(?:•\s*)?\d+(?:st|nd|rd|th)\+?$/i.test(line)) || "";
      const title = lines.find((line) =>
        line !== name &&
        line.length <= 180 &&
        !/job poster|hiring team|people you can reach|meet the hiring team|message/i.test(line) &&
        !/^[•·]?\s*\d+(?:st|nd|rd|th)\+?$/i.test(line)
      ) || "";
      contacts.push({ name, title, relationship, linkedin_url: url, notes: /job poster/i.test(context) ? "Job poster" : "Hiring contact" });
      seen.add(url);
    }
    return contacts.slice(0, 10);
  }

  function extractJobSpecificContacts(detailsRoot = document, externalJobId = "") {
    const contacts = [];
    const seen = new Set();
    const headings = visibleElements(document, "h1, h2, h3, h4, p, span").filter((element) =>
      /^(?:people you can reach out to|meet the hiring team)$/i.test(clean(element.innerText || element.textContent)),
    );
    const hiringHeading = headings.find((element) =>
      /^meet the hiring team$/i.test(clean(element.innerText || element.textContent)),
    );
    if (!hiringHeading) return contacts;

    const links = visibleElements(detailsRoot, 'a[href*="linkedin.com/in/"], a[href^="/in/"]').filter((link) => {
      let ancestor = link.parentElement;
      while (ancestor && ancestor !== detailsRoot && ancestor !== document.body) {
        const context = clean(ancestor.innerText || ancestor.textContent);
        if (/meet the hiring team/i.test(context) && /job poster/i.test(context)) {
          const jobBoundLink = ancestor.querySelector?.(`a[href*="${externalJobId}"]`);
          return !externalJobId || Boolean(jobBoundLink);
        }
        if (context.length > 5000) return false;
        ancestor = ancestor.parentElement;
      }
      return false;
    });

    for (const link of links) {
      const url = new URL(link.href, location.origin).href.split("?")[0];
      if (seen.has(url)) continue;
      let container = link.parentElement;
      while (container && container !== document.body) {
        const text = clean(container.innerText || container.textContent);
        if (/job poster/i.test(text) && text.length <= 900) break;
        container = container.parentElement;
      }
      container = container && container !== document.body ? container : link.parentElement;
      const context = clean(container.innerText || container.textContent);
      const name = clean(link.innerText || link.textContent).replace(/\s*[^\p{L}\p{N}]*\d+(?:st|nd|rd|th)?\+?$/iu, "");
      if (!name || name.length > 120) continue;
      const lines = (container.innerText || "").split(/\n+/).map(clean).filter(Boolean);
      const relationship = lines.find((line) => /^\W*\d+(?:st|nd|rd|th)\+?$/i.test(line)) || "";
      const title = lines.find((line) =>
        line !== name && line.length <= 180 &&
        !/job poster|hiring team|people you can reach|meet the hiring team|message/i.test(line) &&
        !/^\W*\d+(?:st|nd|rd|th)\+?$/i.test(line)
      ) || "";
      const isJobPoster = /job poster/i.test(context);
      contacts.push({
        name, title, relationship, linkedin_url: url,
        notes: isJobPoster
          ? "Job poster · Listed by LinkedIn under Meet the hiring team"
          : "Hiring team · Listed by LinkedIn under Meet the hiring team",
      });
      seen.add(url);
    }
    return contacts.slice(0, 5);
  }

  function rankAndDeduplicateContacts(contacts) {
    const priority = (contact) => {
      const notes = clean(contact.notes).toLowerCase();
      const title = clean(contact.title).toLowerCase();
      if (notes.includes("job poster")) return 1;
      if (notes.includes("hiring team")) return 2;
      if (/technical recruiter|talent acquisition|talent partner|recruiter/.test(title)) return 3;
      if (/hiring manager|engineering manager|head of|director|lead/.test(title)) return 4;
      if (contact.email) return 5;
      return 9;
    };
    const unique = new Map();
    for (const contact of contacts) {
      const key = clean(contact.linkedin_url).toLowerCase() || clean(contact.email).toLowerCase() || clean(contact.name).toLowerCase();
      if (!key) continue;
      const previous = unique.get(key);
      if (!previous || priority(contact) < priority(previous)) unique.set(key, contact);
    }
    return [...unique.values()].sort((a, b) => priority(a) - priority(b)).slice(0, 5);
  }

  function extractDescriptionContacts(description) {
    const emails = [...new Set((description || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])];
    return emails.slice(0, 5).map((email) => ({
      name: email,
      title: "Application contact from job description",
      relationship: "",
      linkedin_url: "",
      email,
      phone: "",
      notes: "Email address published in the LinkedIn job description",
    }));
  }

  async function extractJob(reportMissing = false) {
    const externalJobId = jobId();
    const data = jsonLdJob();
    const card = selectedCard();
    const detailsRoot = externalJobId ? findDetailsRoot(externalJobId) : document;
    const companyAria = detailsRoot.querySelector?.('[aria-label^="Company,"]')?.getAttribute("aria-label") || "";
    const semanticCompany = clean(companyAria.replace(/^Company,\s*/i, "").replace(/\.$/, ""));
    const ogTitle = metaContent('meta[property="og:title"]', 'meta[name="twitter:title"]');
    const selectedJobTitle = currentJobRole(externalJobId);
    const roleCandidates = [clean(data?.title), selectedJobTitle, semanticTitle(detailsRoot, semanticCompany), firstText(
      "h1.t-24", ".job-details-jobs-unified-top-card__job-title h1",
      ".jobs-unified-top-card__job-title", ".job-details-jobs-unified-top-card__job-title",
      ".jobs-details-top-card__job-title", "main h1"
    ), cardText(card, ".job-card-list__title--link", ".job-card-container__link"), clean(ogTitle.split(" | ")[0])];
    const role = roleCandidates.find(validRole) || "";
    const company = clean(data?.hiringOrganization?.name) || semanticCompany || firstText(
      ".job-details-jobs-unified-top-card__company-name a", ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name", ".jobs-details-top-card__company-url", 'main a[href*="/company/"]'
    ) || cardText(card, ".artdeco-entity-lockup__subtitle", ".job-card-container__primary-description") || "LinkedIn company";
    const headerText = semanticHeader(detailsRoot) || firstText(
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".job-details-jobs-unified-top-card__tertiary-description-container"
    );
    const headerLocation = clean(headerText.match(/^(.+?)\s*[·•]\s*(?:reposted\s+)?\d+\s+(?:minute|hour|day|week|month)s?\s+ago/i)?.[1]);
    const address = Array.isArray(data?.jobLocation) ? data.jobLocation[0]?.address : data?.jobLocation?.address;
    const structuredLocation = [...new Set([address?.addressLocality, address?.addressRegion, address?.addressCountry?.name || address?.addressCountry].map(clean).filter(Boolean))].join(", ");
    const headerLines = visibleElements(detailsRoot, "p, div, span").flatMap((element) =>
      (element.innerText || "").split(/\n+/).map(clean).filter((line) => line.length < 220),
    );
    const compactHeader = headerLines.find((line) => /\d+\s+(?:minute|hour|day|week|month)s?\s+ago/i.test(line) && /[·•]/.test(line)) || "";
    const compactLocation = clean(compactHeader.split(/[·•]/)[0])
      .replace(new RegExp(`^${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
      .replace(new RegExp(`^${role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "");
    const locationText = structuredLocation || headerLocation || compactLocation || firstText(
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".job-details-jobs-unified-top-card__tertiary-description-container", ".jobs-unified-top-card__bullet"
    ) || cardText(card, ".artdeco-entity-lockup__caption", ".job-card-container__metadata-item");
    const domDescription = await extractFullDescription();
    const description = chooseBestDescription(domDescription, data?.description, firstText("#job-details", ".jobs-description__content", ".jobs-box__html-content"));
    const insightTexts = visibleElements(detailsRoot,
      ".job-details-jobs-unified-top-card__job-insight, .job-details-fit-level-preferences button, .jobs-unified-top-card__job-insight"
    ).map((element) => clean(element.textContent)).filter(Boolean);
    const allShortTexts = visibleElements(detailsRoot,"span,a").map(element=>clean(element.textContent)).filter(value=>value.length<80);
    const headerParts = headerText.split(/[·•]/).map(clean);
    const postedText = clean(data?.datePosted) ||
      headerParts.find((item) => /ago|reposted/i.test(item)) ||
      extractPatternText(detailsRoot, /(?:reposted\s+)?\d+\s+(?:minute|hour|day|week|month)s?\s+ago/i);
    const applicantPattern = /(?:over\s+)?[\d,]+\+?\s+applicants?|be among the first \d+ applicants|[\d,]+\+?\s+(?:people\s+)?clicked apply/i;
    const applicantHeader = headerParts.find((item) => /applicant/i.test(item)) || "";
    const applicantsText = clean(applicantHeader.match(applicantPattern)?.[0]) ||
      extractPatternText(detailsRoot, applicantPattern);
    const workType = [...insightTexts,...allShortTexts].find((item) => /^(on-site|hybrid|remote)$/i.test(item)) || "";
    const employmentType = [...insightTexts,...allShortTexts].find((item) => /^(full-time|part-time|contract|temporary|internship)$/i.test(item)) || "";

    if (!externalJobId) {
      if (reportMissing) warn("No selected LinkedIn job was found. Select a job before opening Easy Apply.");
      return null;
    }
    const job = {
      external_job_id: externalJobId,
      company,
      role: role || `LinkedIn job ${externalJobId}`,
      location: locationText.split(/[·•]/)[0].trim(),
      job_url: `https://www.linkedin.com/jobs/view/${externalJobId}/`,
      description,
      posted_text: postedText,
      applicants_text: applicantsText,
      work_type: workType,
      employment_type: employmentType,
      contacts: rankAndDeduplicateContacts([...extractJobSpecificContacts(document, externalJobId), ...extractDescriptionContacts(description)]),
      applied: true,
    };
    return job;
  }

  async function refreshCache() {
    const job = await extractJob();
    if (job) {
      const changed = !cachedJob || cachedJob.external_job_id !== job.external_job_id;
      cachedJob = mergeJob(cachedJob, job);
      if (pendingJob?.external_job_id === cachedJob.external_job_id && !awaitingConfirmation) {
        savePending(mergeJob(pendingJob, cachedJob));
      }
      if (changed) log("Job extracted", job);
    }
    return cachedJob;
  }

  function label(element) {
    return clean([
      element?.innerText || element?.textContent,
      element?.getAttribute("aria-label"),
      element?.getAttribute("title"),
    ].filter(Boolean).join(" "));
  }

  function toast(message, kind = "success") {
    document.getElementById("job-tracker-toast")?.remove();
    clearTimeout(toastTimer);
    const node = document.createElement("div");
    node.id = "job-tracker-toast";
    node.className = `job-tracker-toast ${kind}`;
    node.innerHTML = `<strong>MyStratos</strong><span>${message}</span>`;
    document.body.appendChild(node);
    requestAnimationFrame(() => node.classList.add("visible"));
    toastTimer = setTimeout(() => node.remove(), 5000);
  }

  const recorded = (id) => sessionStorage.getItem(`${RECORDED_PREFIX}${id}`) === "true";

  function send(job) {
    if (!job || sendInProgress) return;
    if (recorded(job.external_job_id)) { clearPending(); return; }
    sendInProgress = true;
    log("Sending submitted LinkedIn application to FastAPI", job);
    if (!extensionAvailable()) {
      sendInProgress = false;
      toast("MyStratos was reloaded. Refresh this LinkedIn tab to reconnect.", "error");
      return;
    }
    try { chrome.runtime.sendMessage({ type: "IMPORT_LINKEDIN_JOB", payload: job }, (response) => {
      sendInProgress = false;
      if (chrome.runtime.lastError) {
        warn("Extension messaging failed", chrome.runtime.lastError.message);
        toast("Extension connection failed. Reload LinkedIn and try again.", "error");
      } else if (response?.ok) {
        sessionStorage.setItem(`${RECORDED_PREFIX}${job.external_job_id}`, "true");
        clearPending();
        log(response.created ? "Application created" : "Existing application updated", response.application);
        toast(response.created ? "Submitted application recorded." : "Application was already recorded.");
      } else {
        warn("FastAPI import failed", response?.error);
        toast(response?.error || "Could not reach the local MyStratos API.", "error");
      }
    }); } catch {
      sendInProgress = false;
      toast("MyStratos was reloaded. Refresh this LinkedIn tab to reconnect.", "error");
    }
  }

  function sendExternalApplication(job) {
    if (!job || sendInProgress) return;
    if (recorded(job.external_job_id)) { clearExternalPending(job.external_job_id); return; }
    if (!extensionAvailable()) {
      toast("MyStratos was reloaded. Refresh this LinkedIn tab to reconnect.", "error");
      return;
    }
    sendInProgress = true;
    log("Sending confirmed external LinkedIn application to FastAPI", job);
    try { chrome.runtime.sendMessage({ type: "IMPORT_LINKEDIN_JOB", payload: job }, (response) => {
      sendInProgress = false;
      if (chrome.runtime.lastError) {
        warn("External application messaging failed", chrome.runtime.lastError.message);
        toast("Extension connection failed. Reload LinkedIn and try again.", "error");
      } else if (response?.ok) {
        sessionStorage.setItem(`${RECORDED_PREFIX}${job.external_job_id}`, "true");
        clearExternalPending(job.external_job_id);
        log(response.created ? "External application created" : "External application updated", response.application);
        toast(response.created ? "External application recorded." : "External application was already recorded.");
      } else {
        warn("External application import failed", response?.error);
        toast(response?.error || "Could not reach the local MyStratos API.", "error");
      }
    }); } catch {
      sendInProgress = false;
      toast("MyStratos was reloaded. Refresh this LinkedIn tab to reconnect.", "error");
    }
  }

  function runtimeImport(job) {
    return new Promise((resolve, reject) => {
      if (!extensionAvailable()) {
        reject(new Error("MyStratos was reloaded. Refresh this LinkedIn tab to reconnect."));
        return;
      }
      try {
        chrome.runtime.sendMessage({ type: "IMPORT_LINKEDIN_JOB", payload: job }, (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (response?.ok) resolve(response);
          else reject(new Error(response?.error || "Could not reach the local MyStratos API."));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function recoveryKey(externalJobId) {
    return `${RECOVERY_PREFIX}${externalJobId}`;
  }

  function saveRecoverySnapshot(job, method) {
    sessionStorage.setItem(recoveryKey(job.external_job_id), JSON.stringify({ job, method, saved_at: Date.now() }));
  }

  function clearRecoverySnapshot(externalJobId) {
    sessionStorage.removeItem(recoveryKey(externalJobId));
    sessionStorage.removeItem(`${RECOVERY_GUARD_PREFIX}${externalJobId}`);
  }

  function isExtensionContextError(error) {
    return /extension context invalidated|job tracker was reloaded|could not establish connection|receiving end does not exist/i.test(
      error?.message || String(error),
    );
  }

  function reconnectOnce(job) {
    const guardKey = `${RECOVERY_GUARD_PREFIX}${job.external_job_id}`;
    if (sessionStorage.getItem(guardKey)) return false;
    sessionStorage.setItem(guardKey, String(Date.now()));
    toast("Application confirmed. MyStratos is reconnecting and will save it automatically…");
    setTimeout(() => location.reload(), 700);
    return true;
  }

  async function recoverConfirmedApplication() {
    if (!extensionAvailable()) return;
    const keys = Object.keys(sessionStorage).filter((key) => key.startsWith(RECOVERY_PREFIX));
    for (const key of keys) {
      try {
        const entry = JSON.parse(sessionStorage.getItem(key) || "null");
        if (!entry?.job?.external_job_id) continue;
        const response = await runtimeImport(entry.job);
        sessionStorage.setItem(`${RECORDED_PREFIX}${entry.job.external_job_id}`, "true");
        clearRecoverySnapshot(entry.job.external_job_id);
        clearConfirmedSnapshot(entry.job.external_job_id);
        log("Recovered confirmed application", response.application);
        toast("Confirmed application recovered and recorded.");
      } catch (error) {
        warn("Confirmed application recovery is still pending", error?.message || String(error));
      }
    }
  }

  function storeConfirmedSnapshot(job) {
    if (!extensionAvailable()) return;
    try {
      chrome.storage.local.get(CONFIRMED_IMPORTS_KEY, (stored) => {
        const items = stored?.[CONFIRMED_IMPORTS_KEY] || {};
        items[job.external_job_id] = { job, confirmed_at: new Date().toISOString() };
        storageSet({ [CONFIRMED_IMPORTS_KEY]: items });
      });
    } catch { /* The immediate FastAPI import remains authoritative. */ }
  }

  function clearConfirmedSnapshot(externalJobId) {
    if (!extensionAvailable()) return;
    try {
      chrome.storage.local.get(CONFIRMED_IMPORTS_KEY, (stored) => {
        const items = stored?.[CONFIRMED_IMPORTS_KEY] || {};
        delete items[externalJobId];
        storageSet({ [CONFIRMED_IMPORTS_KEY]: items });
      });
    } catch { /* The application has already been persisted by FastAPI. */ }
  }

  async function importConfirmedThenEnrich(job, method) {
    let frozen = JSON.parse(JSON.stringify(normalizeJob(job)));
    if (!validRole(frozen.role)) {
      for (const delay of [0, 300, 800]) {
        if (delay) await wait(delay);
        const current = await extractJob();
        if (current?.external_job_id === frozen.external_job_id) frozen = mergeJob(frozen, current);
        if (validRole(frozen.role)) break;
      }
    }
    saveRecoverySnapshot(frozen, method);
    storeConfirmedSnapshot(frozen);
    log("Confirmed application frozen", frozen.external_job_id, frozen);
    sendInProgress = true;
    try {
      log("Importing confirmed application", frozen.external_job_id);
      const initialResponse = await runtimeImport(frozen);
      sessionStorage.setItem(`${RECORDED_PREFIX}${frozen.external_job_id}`, "true");
      if (method === "external") clearExternalPending(frozen.external_job_id);
      else clearPending();
      log(initialResponse.created ? "Application created" : "Application updated", initialResponse.application);
      toast(initialResponse.created ? "Submitted application recorded." : "Application updated in MyStratos.");

      log("Enrichment started", frozen.external_job_id);
      try {
        const enriched = await enrichConfirmedApplication(frozen);
        if (JSON.stringify(enriched) !== JSON.stringify(frozen)) {
          const updateResponse = await runtimeImport(enriched);
          log("Enrichment update saved", frozen.external_job_id, updateResponse.application);
        } else {
          log("Enrichment completed; snapshot was already complete", frozen.external_job_id);
        }
      } catch (error) {
        warn("Enrichment failed after application was safely recorded", error?.message || String(error));
      }
      clearConfirmedSnapshot(frozen.external_job_id);
      clearRecoverySnapshot(frozen.external_job_id);
      return true;
    } catch (error) {
      warn("Confirmed application import failed", error?.message || String(error));
      if (isExtensionContextError(error) && reconnectOnce(frozen)) return false;
      toast(error?.message || "Could not save the confirmed application.", "error");
      return false;
    } finally {
      sendInProgress = false;
    }
  }

  function externalConfirmationVisible() {
    return /did you finish applying\??/i.test(clean(document.body?.innerText));
  }

  function recordExternalPending(job) {
    if (!job || !extensionAvailable()) return;
    const marker = `${PENDING_RECORDED_PREFIX}${job.external_job_id}`;
    if (sessionStorage.getItem(marker) === "true") return;
    sessionStorage.setItem(marker, "true");
    try {
      chrome.runtime.sendMessage({ type: "IMPORT_LINKEDIN_PENDING", payload: job }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.ok) log("External application added to Needs Attention", response.application);
        else {
          sessionStorage.removeItem(marker);
          warn("Could not add external application to Needs Attention", response?.error);
        }
      });
    } catch { sessionStorage.removeItem(marker); }
  }

  function basicExternalSnapshot() {
    const externalJobId = jobId();
    if (!externalJobId) return null;
    const data = jsonLdJob();
    const company = clean(data?.hiringOrganization?.name) || firstText(
      ".job-details-jobs-unified-top-card__company-name a",
      ".jobs-unified-top-card__company-name",
      'main a[href*="/company/"]',
    ) || "LinkedIn company";
    const role = clean(data?.title) || firstText(
      ".job-details-jobs-unified-top-card__job-title h1",
      ".jobs-unified-top-card__job-title",
      "main h1",
    ) || `LinkedIn job ${externalJobId}`;
    return normalizeJob({
      external_job_id: externalJobId,
      company,
      role,
      location: "",
      job_url: `https://www.linkedin.com/jobs/view/${externalJobId}/`,
      description: "",
      posted_text: "",
      applicants_text: "",
      work_type: "",
      employment_type: "",
      contacts: [],
      applied: true,
    });
  }

  async function captureExternalApplication() {
    const initial = cachedJob || basicExternalSnapshot();
    if (!initial) {
      toast("Could not identify this LinkedIn job before opening the company site.", "error");
      return;
    }
    saveExternalPending(initial);
    recordExternalPending(initial);
    log("External Apply opened; waiting for LinkedIn Yes confirmation", initial);
    try {
      const refreshed = await refreshCache();
      const pending = externalPendingJobs[initial.external_job_id] || initial;
      const seed = refreshed ? mergeJob(pending, refreshed) : pending;
      const enriched = await enrichConfirmedApplication(seed);
      if (externalPendingJobs[enriched.external_job_id]) {
        saveExternalPending(enriched);
        recordExternalPending(enriched);
      }
    } catch (error) {
      warn("External application capture enrichment failed", error?.message || String(error));
    }
  }

  async function confirmExternalApplication() {
    const pending = currentExternalPending();
    if (!pending || sendInProgress) return;
    log("External application confirmed with Yes");
    await importConfirmedThenEnrich(pending, "external");
  }

  function hasFinalConfirmation() {
    const text = clean(document.body?.innerText);
    return CONFIRMATIONS.some((pattern) => pattern.test(text));
  }

  function hasExternalPendingState() {
    return /job moved to in progress|did you finish applying\??|in progress under clicked apply/i.test(
      clean(document.body?.innerText),
    );
  }

  function reconcileExternalPendingState() {
    if (!hasExternalPendingState()) return;
    const snapshot = cachedJob || basicExternalSnapshot();
    if (!snapshot || recorded(snapshot.external_job_id)) return;
    if (!externalPendingJobs[snapshot.external_job_id]) saveExternalPending(snapshot);
    recordExternalPending(externalPendingJobs[snapshot.external_job_id] || snapshot);
  }

  async function enrichConfirmedApplication(job) {
    let enriched = normalizeJob(job);
    for (const delay of [0, 350, 900]) {
      if (delay) await wait(delay);
      try {
        const current = await extractJob();
        if (current?.external_job_id === enriched.external_job_id) enriched = mergeJob(enriched, current);
      } catch (error) {
        warn("Final job enrichment pass failed", error?.message || String(error));
      }
    }
    return normalizeJob(enriched);
  }

  async function checkConfirmation() {
    if (sendInProgress || finalizingApplication || !hasFinalConfirmation()) return;
    const confirmedJob = pendingJob || cachedJob || basicExternalSnapshot();
    if (!confirmedJob || recorded(confirmedJob.external_job_id)) return;
    if (hasFinalConfirmation()) {
      finalizingApplication = true;
      confirmationTimers.forEach(clearTimeout);
      confirmationTimers = [];
      log("Detected LinkedIn final confirmation");
      awaitingConfirmation = false;
      sessionStorage.removeItem(AWAITING_KEY);
      const frozen = confirmedJob;
      await importConfirmedThenEnrich(frozen, "easy_apply");
      finalizingApplication = false;
    }
  }

  function waitForConfirmation() {
    awaitingConfirmation = true;
    sessionStorage.setItem(AWAITING_KEY, "true");
    confirmationTimers.forEach(clearTimeout);
    confirmationTimers = [250, 500, 1000, 2000, 4000, 7000, 10000, 15000, 30000].map((delay) =>
      setTimeout(checkConfirmation, delay),
    );
  }

  document.addEventListener("click", async (event) => {
    const control = event.target.closest("button, a");
    if (!control) return;
    const controlLabel = label(control);
    if (EASY_APPLY.test(controlLabel)) {
      const job = await refreshCache() || cachedJob || await extractJob(true);
      if (!job) { toast("Could not identify this LinkedIn job. Keep the full job details open.", "error"); return; }
      savePending(job);
      log("Easy Apply opened; job captured temporarily", job);
    } else if (EXTERNAL_APPLY.test(controlLabel)) {
      captureExternalApplication();
    } else if (EXTERNAL_YES.test(controlLabel) && currentExternalPending() && externalConfirmationVisible()) {
      confirmExternalApplication();
    } else if (EXTERNAL_NO.test(controlLabel) && currentExternalPending() && externalConfirmationVisible()) {
      log("External application not yet confirmed; keeping it pending");
    } else if (SUBMIT.test(controlLabel) && pendingJob) {
      log("Final Submit clicked; waiting for LinkedIn confirmation");
      waitForConfirmation();
    } else if (CANCEL.test(controlLabel) && pendingJob && !awaitingConfirmation) {
      log("Easy Apply dismissed; temporary job cleared");
      clearPending();
    }
  }, true);

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      cachedJob = null;
      log("LinkedIn page state changed", lastUrl);
      [400, 1200, 2500].forEach((delay) => setTimeout(() => refreshCache().catch((error) => warn("Job extraction failed", error)), delay));
    }
    checkConfirmation();
    reconcileExternalPendingState();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  if (extensionAvailable()) {
    try { chrome.storage.local.get(
      ["pendingLinkedInApplication", "pendingExternalLinkedInApplication", "pendingExternalLinkedInApplications"],
      ({ pendingLinkedInApplication, pendingExternalLinkedInApplication, pendingExternalLinkedInApplications }) => {
      if (!pendingJob && pendingLinkedInApplication) {
        pendingJob = pendingLinkedInApplication;
        log("Restored pending LinkedIn application", pendingJob.external_job_id);
      }
      const storedExternal = pendingExternalLinkedInApplications ||
        (pendingExternalLinkedInApplication?.external_job_id
          ? { [pendingExternalLinkedInApplication.external_job_id]: pendingExternalLinkedInApplication }
          : {});
      if (Object.keys(storedExternal).length) {
        externalPendingJobs = { ...storedExternal, ...externalPendingJobs };
        sessionStorage.setItem(EXTERNAL_PENDING_KEY, JSON.stringify(externalPendingJobs));
        log("Restored pending external LinkedIn applications", Object.keys(externalPendingJobs));
      }
      if (awaitingConfirmation) checkConfirmation();
      reconcileExternalPendingState();
    }); } catch { /* The current tab belongs to an invalidated extension context. */ }
  }
  [500, 1500, 3000].forEach((delay) => setTimeout(() => {
    refreshCache()
      .then(() => {
        checkConfirmation();
        reconcileExternalPendingState();
      })
      .catch((error) => warn("Job extraction failed", error));
  }, delay));
  setTimeout(() => recoverConfirmedApplication(), 800);
  log(`LinkedIn detector v${SCRIPT_VERSION} ready. Applications record after LinkedIn confirmation.`);
})();
