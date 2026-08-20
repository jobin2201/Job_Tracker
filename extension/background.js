importScripts("config.js", "authentication/auth.js");

const CONFIRMED_IMPORTS_KEY = "jobTrackerConfirmedImports";
const RECOVERY_DELAY_MS = 1000;
let recoveryTimer = null;

async function showReadyNotification() {
  const key = "jobTrackerReadyNotificationAt";
  const stored = await chrome.storage.local.get(key);
  if (Date.now() - Number(stored[key] || 0) < 10000) return;
  await chrome.storage.local.set({ [key]: Date.now() });
  await chrome.notifications.create("job-tracker-ready", {
    type: "basic",
    iconUrl: "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128'%3E%3Crect width='128' height='128' rx='28' fill='%2328765d'/%3E%3Ccircle cx='64' cy='64' r='39' fill='none' stroke='white' stroke-width='8'/%3E%3Ccircle cx='64' cy='64' r='20' fill='none' stroke='white' stroke-width='8'/%3E%3Ccircle cx='64' cy='64' r='6' fill='white'/%3E%3C/svg%3E",
    title: "MyStratos is connected",
    message: "Open LinkedIn or Indeed to start tracking applications.",
  });
}

async function showConnectionToast(tabId, platform) {
  const user = await JobTrackerAuth.currentUser().catch(() => null);
  const identity = user?.email ? ` as ${user.email}` : " — sign in from the extension popup";
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (site, account) => {
        document.getElementById("job-tracker-connection-toast")?.remove();
        const toast = document.createElement("div");
        toast.id = "job-tracker-connection-toast";
        toast.setAttribute("role", "status");
        toast.style.cssText = "position:fixed;right:22px;bottom:22px;z-index:2147483647;max-width:360px;padding:14px 17px;border:1px solid rgba(255,255,255,.2);border-radius:14px;color:#fff;background:linear-gradient(135deg,#174f3d,#28765d);box-shadow:0 16px 45px rgba(13,45,35,.35);font:600 13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;opacity:0;transform:translateY(12px);transition:opacity .25s,transform .25s";
        toast.innerHTML = `<div style="font-size:14px;font-weight:800">✓ MyStratos connected to ${site}</div><div style="margin-top:3px;opacity:.82;font-size:11px"></div>`;
        toast.lastElementChild.textContent = account;
        document.documentElement.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = "1"; toast.style.transform = "translateY(0)"; });
        setTimeout(() => {
          toast.style.opacity = "0";
          toast.style.transform = "translateY(12px)";
          setTimeout(() => toast.remove(), 300);
        }, 5000);
      },
      args: [platform, identity],
    });
  } catch (error) {
    console.warn("[Job Tracker] Could not show connection confirmation", error?.message || error);
  }
}

async function reconnectOpenJobPages() {
  const tabs = await chrome.tabs.query({});
  let connected = 0;
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    const linkedin = /^https:\/\/www\.linkedin\.com\/jobs\//i.test(tab.url);
    const indeed = /^https:\/\/[^/]*indeed\.(com|co\.in)\//i.test(tab.url);
    if (!linkedin && !indeed) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (key) => { delete window[key]; },
        args: [linkedin ? "__JOB_TRACKER_LINKEDIN_DETECTOR__" : "__JOB_TRACKER_INDEED_DETECTOR__"],
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [linkedin ? "linkedin/content.js" : "indeed/content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: [linkedin ? "linkedin/content.css" : "indeed/content.css"],
      });
      await showConnectionToast(tab.id, linkedin ? "LinkedIn" : "Indeed");
      connected += 1;
    } catch (error) {
      console.warn("[Job Tracker] Could not reconnect job tab", tab.id, error?.message || error);
    }
  }
  return connected;
}

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
      const response = await JobTrackerAuth.authenticatedFetch("/api/linkedin/import", {
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
chrome.runtime.onInstalled.addListener(() => {
  scheduleConfirmedImportRecovery();
  reconnectOpenJobPages();
  showReadyNotification().catch(() => {});
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  const linkedin = /^https:\/\/www\.linkedin\.com\/jobs\//i.test(details.url);
  const indeed = /^https:\/\/[^/]*indeed\.(com|co\.in)\//i.test(details.url);
  if (linkedin || indeed) showConnectionToast(details.tabId, linkedin ? "LinkedIn" : "Indeed");
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[CONFIRMED_IMPORTS_KEY]?.newValue) scheduleConfirmedImportRecovery();
});
scheduleConfirmedImportRecovery();
showReadyNotification().catch(() => {});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  scheduleConfirmedImportRecovery();
  if (message.type === "TEST_API_CONNECTION") {
    Promise.all([JobTrackerAuth.authenticatedFetch("/health"), JobTrackerAuth.currentUser()])
      .then(async ([response, user]) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || "Health check failed");
        if (!user) throw new Error("Extension is not authenticated");
        sendResponse({ ok: true, body, user });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "RECONNECT_JOB_PAGES") {
    reconnectOpenJobPages()
      .then((count) => sendResponse({ ok: true, count }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (["IMPORT_INDEED_JOB", "IMPORT_INDEED_PENDING"].includes(message.type)) {
    const payload = message.type === "IMPORT_INDEED_PENDING"
      ? { ...message.payload, applied: false, pending_confirmation: true }
      : message.payload;
    console.info(
      message.type === "IMPORT_INDEED_PENDING"
        ? "[Job Tracker] Sending pending Indeed application to FastAPI"
        : "[Job Tracker] Sending confirmed Indeed application to FastAPI",
      payload,
    );
    JobTrackerAuth.authenticatedFetch("/api/indeed/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          let detail = body?.detail;
          if (Array.isArray(detail)) detail = detail.map((item) => item?.msg || String(item)).join("; ");
          throw new Error(detail || body?.message || `MyStratos rejected the Indeed import (${response.status})`);
        }
        return body;
      })
      .then((body) => {
        chrome.storage.local.set({ lastIndeedImport: { ok: true, at: Date.now(), application: body.application } });
        sendResponse({ ok: true, ...body });
      })
      .catch((error) => {
        console.error("[Job Tracker] Indeed import failed", error);
        chrome.storage.local.set({ lastIndeedImport: { ok: false, at: Date.now(), error: error.message } });
        sendResponse({ ok: false, error: error.message });
      });
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
  JobTrackerAuth.authenticatedFetch("/api/linkedin/import", {
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
        throw new Error(detail || body?.message || `MyStratos rejected the import (${response.status})`);
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
