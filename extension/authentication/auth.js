const JobTrackerAuth = (() => {
  async function token() {
    return (await chrome.storage.local.get("authToken")).authToken || "";
  }

  async function authenticatedFetch(path, options = {}) {
    const authToken = await token();
    const headers = new Headers(options.headers || {});
    if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
    const url = await JobTrackerConfig.apiUrl(path);
    return fetch(url, { ...options, headers });
  }

  async function currentUser() {
    const authToken = await token();
    if (!authToken) return null;
    const response = await authenticatedFetch("/api/auth/me");
    if (!response.ok) {
      await chrome.storage.local.remove("authToken");
      return null;
    }
    return response.json();
  }

  async function signIn() {
    const apiUrl = await JobTrackerConfig.apiUrl();
    return new Promise((resolve, reject) => {
      const redirectUri = chrome.identity.getRedirectURL("google");
      const url = `${apiUrl}/auth/google/extension?redirect_uri=${encodeURIComponent(redirectUri)}`;
      chrome.identity.launchWebAuthFlow({ url, interactive: true }, async (resultUrl) => {
        if (chrome.runtime.lastError || !resultUrl) {
          reject(new Error(chrome.runtime.lastError?.message || "No response"));
          return;
        }
        const authToken = new URLSearchParams(new URL(resultUrl).hash.slice(1)).get("token");
        if (!authToken) {
          reject(new Error("Sign-in did not return a token"));
          return;
        }
        await chrome.storage.local.set({ authToken });
        resolve(currentUser());
      });
    });
  }

  async function signOut() {
    await chrome.storage.local.remove("authToken");
  }

  return { authenticatedFetch, currentUser, signIn, signOut };
})();
