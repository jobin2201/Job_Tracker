export type AuthUser = {
  id: number;
  email: string;
  name: string;
  picture_url: string;
};

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export async function getCurrentUser(): Promise<AuthUser> {
  const response = await fetch("/api/auth/me", {
    credentials: "include",
  });

  if (!response.ok) throw new Error("Not signed in");

  return response.json();
}

export async function signOut(): Promise<void> {
  await fetch(`${API_BASE_URL}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export function googleLoginUrl(): string {
  return `${API_BASE_URL}/auth/google?next=${encodeURIComponent(
    window.location.origin
  )}`;
}