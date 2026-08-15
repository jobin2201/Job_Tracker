const API_URL = "http://127.0.0.1:8000";
const CONFIRMED_IMPORTS_KEY = "jobTrackerConfirmedImports";
const RECOVERY_DELAY_MS = 1000;
let recoveryTimer = null;

function scheduleConfirmedImportRecovery() {
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(retryConfirmedImports, RECOVERY_DELAY_MS);
}

async function retryConfirmedImports() {
  const stored = await chrome.storage.local.get(CONFIRMED_IMPORTS_KEY);
  const items = stored?.[CONFIRMED_IMPORTS_KEY] || {};
  let changed = false;
  for (const [externalJobId, entry] of Object.entries(items)) {
    try {
      const response = await fetch(`${API_URL}/api/linkedin/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.job),
      });
      // A 409 from an older/racing backend means the same unique LinkedIn job
      // is already safely stored, so recovery is complete for this snapshot.
      if (!response.ok && response.status !== 409) continue;
      delete items[externalJobId];
      changed = true;
      console.info(
        response.status === 409
          ? "[Job Tracker] Recovery found existing application"
          : "[Job Tracker] Recovered confirmed application",
        externalJobId,
      );
    } catch { /* Keep the snapshot for the next service-worker wake-up. */ }
  }
  if (changed) await chrome.storage.local.set({ [CONFIRMED_IMPORTS_KEY]: items });
}

chrome.runtime.onStartup.addListener(scheduleConfirmedImportRecovery);
chrome.runtime.onInstalled.addListener(scheduleConfirmedImportRecovery);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[CONFIRMED_IMPORTS_KEY]?.newValue) scheduleConfirmedImportRecovery();
});
scheduleConfirmedImportRecovery();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  scheduleConfirmedImportRecovery();
  if (message.type === "TEST_API_CONNECTION") {
    fetch(`${API_URL}/health`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || "Health check failed");
        sendResponse({ ok: true, body });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (!["IMPORT_LINKEDIN_JOB", "IMPORT_LINKEDIN_PENDING"].includes(message.type)) return false;
  const payload = message.type === "IMPORT_LINKEDIN_PENDING"
    ? { ...message.payload, applied: false, pending_confirmation: true }
    : message.payload;
  console.info(
    message.type === "IMPORT_LINKEDIN_PENDING"
      ? "[Job Tracker] Sending pending external application to FastAPI"
      : "[Job Tracker] Sending confirmed LinkedIn application to FastAPI",
    payload,
  );
  fetch(`${API_URL}/api/linkedin/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error("[Job Tracker] FastAPI rejected import", {
          status: response.status,
          statusText: response.statusText,
          body,
        });
        let detail = body?.detail;
        if (Array.isArray(detail)) {
          detail = detail
            .map((item) => {
              if (typeof item === "string") return item;
              const location = Array.isArray(item?.loc) ? item.loc.join(".") : "";
              return [location && `field=${location}`, item?.msg, item?.type].filter(Boolean).join(" | ");
            })
            .join("; ");
        } else if (detail && typeof detail === "object") {
          detail = JSON.stringify(detail);
        }
        throw new Error(detail || body?.message || `Job Tracker rejected the import (${response.status})`);
      }
      return body;
    })
    .then((body) => {
      console.info("[Job Tracker] FastAPI import succeeded", body);
      chrome.storage.local.set({ lastImport: { ok: true, at: Date.now(), application: body.application } });
      sendResponse({ ok: true, ...body });
    })
    .catch((error) => {
      console.error("[Job Tracker] FastAPI import failed", error);
      chrome.storage.local.set({ lastImport: { ok: false, at: Date.now(), error: error.message } });
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});
