import { apiUrl } from "./auth";

const SESSION_EXPIRED_EVENT = "job-tracker-session-expired";
const ACTIVITY_THROTTLE_MS = 60_000;

export function notifySessionExpired(): void {
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

export function onSessionExpired(callback: () => void): () => void {
  window.addEventListener(SESSION_EXPIRED_EVENT, callback);
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, callback);
}

export function monitorSessionActivity(): () => void {
  let lastSentAt = 0;
  let sending = false;

  const record = async () => {
    const now = Date.now();
    if (sending || now - lastSentAt < ACTIVITY_THROTTLE_MS) return;
    sending = true;
    lastSentAt = now;
    try {
      const response = await fetch(apiUrl("/api/auth/activity"), {
        method: "POST",
        credentials: "include",
      });
      if (response.status === 401) notifySessionExpired();
    } catch {
      // Normal API loading handles connectivity errors. Activity monitoring
      // must never create an unhandled browser-console rejection.
    } finally {
      sending = false;
    }
  };

  const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "scroll", "touchstart"];
  events.forEach((event) => window.addEventListener(event, record, { passive: true }));
  return () => events.forEach((event) => window.removeEventListener(event, record));
}
