export type AuthUser = {
  id: number;
  email: string;
  name: string;
  picture_url: string;
};

const AUTH_TOKEN_KEY = "job_tracker_auth_token";

export const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function authToken(): string {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const returnedToken = fragment.get("auth_token");
  if (returnedToken) {
    sessionStorage.setItem(AUTH_TOKEN_KEY, returnedToken);
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  return returnedToken || sessionStorage.getItem(AUTH_TOKEN_KEY) || "";
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  const token = authToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(apiUrl(path), { ...options, headers, credentials: "include" });
}

export async function getCurrentUser(): Promise<AuthUser> {
  const response = await apiFetch("/api/auth/me");

  if (!response.ok) {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    throw new Error("Not signed in");
  }

  return response.json();
}

export async function signOut(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } finally {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

export function googleLoginUrl(): string {
  return `${apiUrl("/auth/google")}?next=${encodeURIComponent(
    window.location.origin
  )}`;
}
