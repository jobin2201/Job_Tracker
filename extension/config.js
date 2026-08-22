globalThis.JobTrackerConfig = (() => {
  const ENVIRONMENT_KEY = "jobTrackerEnvironment";
  const ENVIRONMENTS = {
    production: {
      apiUrl: "https://job-tracker-backend-n86w.onrender.com",
      dashboardUrl: "https://mystratos-abc-16d3.vercel.app/app",
    },
    local: {
      apiUrl: "http://127.0.0.1:8000",
      dashboardUrl: "http://127.0.0.1:5173/app",
    },
  };

  async function environment() {
    const stored = await chrome.storage.local.get(ENVIRONMENT_KEY);
    return stored[ENVIRONMENT_KEY] === "local" ? "local" : "production";
  }

  async function current() {
    return ENVIRONMENTS[await environment()];
  }

  async function apiUrl(path = "") {
    const selected = await current();
    return `${selected.apiUrl}${path.startsWith("/") || !path ? path : `/${path}`}`;
  }

  async function dashboardUrl() {
    return (await current()).dashboardUrl;
  }

  async function setEnvironment(value) {
    const next = value === "local" ? "local" : "production";
    if (next === "local") {
      const granted = await chrome.permissions.request({
        origins: ["http://127.0.0.1:8000/*", "http://localhost:8000/*"],
      });
      if (!granted) throw new Error("Local backend access was not granted");
    }
    await chrome.storage.local.set({ [ENVIRONMENT_KEY]: next });
    await chrome.storage.local.remove("authToken");
    return ENVIRONMENTS[next];
  }

  return { apiUrl, dashboardUrl, environment, setEnvironment };
})();
