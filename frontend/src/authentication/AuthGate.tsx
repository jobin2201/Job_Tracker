import { ExternalLink, Target, UserRound } from "lucide-react";
import type { AuthUser } from "./auth";
import { googleLoginUrl } from "./auth";
import "./authentication.css";

export function AuthGate({ user }: { user: AuthUser | null | undefined }) {
  if (user === undefined) {
    return <div className="auth-screen"><div className="auth-card"><Target size={34} /><h1>Job Tracker</h1><p>Loading your private workspace...</p></div></div>;
  }
  if (user) return null;
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <Target size={38} />
        <span className="eyebrow">YOUR PRIVATE JOB SEARCH</span>
        <h1>Welcome to Job Tracker</h1>
        <p>Sign in to keep your applications, contacts, timelines and reminders separate from every other user.</p>
        <a className="google-login" href={googleLoginUrl()}>Continue with Google</a>
      </div>
    </div>
  );
}

export function AccountCard({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  return (
    <div className="account-card">
      {user.picture_url ? <img src={user.picture_url} alt="" /> : <UserRound size={20} />}
      <div><strong>{user.name || user.email}</strong><small>{user.email}</small></div>
      <button title="Sign out" onClick={onSignOut}><ExternalLink size={15} /></button>
    </div>
  );
}
