document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;
document.getElementById("test").addEventListener("click", () => {
  const status = document.getElementById("status");
  status.textContent = "Testing extension → API → PostgreSQL...";
  chrome.runtime.sendMessage({ type: "TEST_API_CONNECTION" }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      status.textContent = `Connection failed: ${response?.error || chrome.runtime.lastError?.message || "unknown error"}`;
      return;
    }
    status.textContent = `Connected: ${response.body.service} + ${response.body.database}`;
  });
});
fetch("http://127.0.0.1:8000/health")
  .then((response) => response.json())
  .then((body) => { document.getElementById("status").textContent = body.database === "postgresql" ? "Connected to PostgreSQL tracker" : "Local tracker is online"; })
  .catch(() => { document.getElementById("status").textContent = "Start the local Job Tracker backend"; });
