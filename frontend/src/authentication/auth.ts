export type AuthUser = {
  id: number;
  email: string;
  name: string;
  picture_url: string;
};

export const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function getCurrentUser(): Promise<AuthUser> {
  const response = await fetch(apiUrl("/api/auth/me"), {
    credentials: "include",
  });

  if (!response.ok) throw new Error("Not signed in");

  return response.json();
}

export async function signOut(): Promise<void> {
  await fetch(apiUrl("/api/auth/logout"), {
    method: "POST",
    credentials: "include",
  });
}

export function googleLoginUrl(): string {
  return `${apiUrl("/auth/google")}?next=${encodeURIComponent(
    window.location.origin
  )}`;
}
