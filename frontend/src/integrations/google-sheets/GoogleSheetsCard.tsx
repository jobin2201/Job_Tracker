import { useEffect, useState } from "react";
import { Check, ExternalLink, RefreshCw, Sheet } from "lucide-react";
import { notifySessionExpired } from "../../authentication";
import "./google-sheets.css";


type SheetsStatus = {
  connected: boolean;
  google_account_email?: string;
  spreadsheet_url?: string;
  last_synced_at?: string | null;
  last_sync_error?: string;
};


export function GoogleSheetsCard() {
  const [status, setStatus] = useState<SheetsStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    const response = await fetch("/api/google-sheets/status", { credentials: "include" });
    if (response.status === 401) notifySessionExpired();
    if (response.ok) setStatus(await response.json());
  };

  useEffect(() => {
    load().catch(() => setStatus({ connected: false }));
  }, []);

  const retrySync = async () => {
    setSyncing(true);
    try {
      const response = await fetch("/api/google-sheets/sync", {
        method: "POST",
        credentials: "include",
      });
      if (response.status === 401) notifySessionExpired();
      await load();
    } finally {
      setSyncing(false);
    }
  };

  if (!status) {
    return (
      <div className="sheets-nav-item loading" aria-label="Loading Google Sheets status">
        <Sheet size={18} />
        <span className="sheets-copy"><strong>Google Sheets</strong><small>Checking connection…</small></span>
      </div>
    );
  }
  if (!status.connected) {
    return (
      <a className="sheets-nav-item" href="http://127.0.0.1:8000/api/google-sheets/connect" title="Set up your private Google Sheet">
        <Sheet size={18} />
        <span className="sheets-copy"><strong>Google Sheets</strong><small>Set up spreadsheet</small></span>
        <ExternalLink className="sheets-trailing" size={14} />
      </a>
    );
  }
  const lastSynced = status.last_synced_at
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(status.last_synced_at))
    : "Waiting for first sync";
  if (status.spreadsheet_url) {
    return (
      <a className="sheets-nav-item connected" href={status.spreadsheet_url} target="_blank" rel="noreferrer" title={`Open spreadsheet for ${status.google_account_email}`}>
        <Sheet size={18} />
        <span className="sheets-copy"><strong>Google Sheets</strong><small>Last synced {lastSynced}</small></span>
        <span className="sheets-trailing connected-mark"><Check size={12} /><ExternalLink size={13} /></span>
      </a>
    );
  }
  return (
    <button className="sheets-nav-item sync-error" type="button" onClick={retrySync} disabled={syncing} title="Retry Google Sheets synchronization">
      {syncing ? <RefreshCw className="spin" size={18} /> : <Sheet size={18} />}
      <span className="sheets-copy"><strong>Google Sheets</strong><small>{syncing ? "Syncing…" : "Unavailable — retry"}</small></span>
      <RefreshCw className={`sheets-trailing ${syncing ? "spin" : ""}`} size={14} />
    </button>
  );
}
