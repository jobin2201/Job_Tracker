export type AuthUser = {
  id: number;
  email: string;
  name: string;
  picture_url: string;
};

export async function getCurrentUser(): Promise<AuthUser> {
  const response = await fetch("/api/auth/me", { credentials: "include" });
  if (!response.ok) throw new Error("Not signed in");
  return response.json();
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}

export function googleLoginUrl(): string {
  return `http://127.0.0.1:8000/auth/google?next=${encodeURIComponent(window.location.origin)}`;
}
