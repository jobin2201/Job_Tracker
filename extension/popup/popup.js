const statusNode = document.getElementById("status");
const signin = document.getElementById("signin");
const signout = document.getElementById("signout");
const account = document.getElementById("account");
const dashboard = document.getElementById("dashboard");
const useLocal = document.getElementById("use-local");

document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;

async function showEnvironment() {
  const environment = await JobTrackerConfig.environment();
  useLocal.checked = environment === "local";
  dashboard.href = await JobTrackerConfig.dashboardUrl();
  dashboard.textContent = environment === "local" ? "Open local dashboard" : "Open dashboard";
}

async function showAccount() {
  const user = await JobTrackerAuth.currentUser();
  if (!user) {
    account.hidden = true;
    signin.hidden = false;
    signout.hidden = true;
    statusNode.textContent = "Sign in so imports go to your private workspace";
    return;
  }
  account.hidden = false;
  signin.hidden = true;
  signout.hidden = false;
  document.getElementById("account-name").textContent = user.name || user.email;
  document.getElementById("account-email").textContent = user.email;
  const avatar = document.getElementById("avatar");
  avatar.src = user.picture_url || "";
  avatar.hidden = !user.picture_url;
  statusNode.textContent = "Ready to track applications for this account";
}

signin.addEventListener("click", () => {
  statusNode.textContent = "Opening Google sign-in...";
  JobTrackerAuth.signIn().then(showAccount).catch((error) => {
    statusNode.textContent = `Sign-in failed: ${error.message}`;
  });
});

signout.addEventListener("click", async () => {
  await JobTrackerAuth.signOut();
  await showAccount();
});

document.getElementById("test").addEventListener("click", () => {
  statusNode.textContent = "Testing extension to API to PostgreSQL...";
  chrome.runtime.sendMessage({ type: "TEST_API_CONNECTION" }, (response) => {
    statusNode.textContent = chrome.runtime.lastError || !response?.ok
      ? `Connection failed: ${response?.error || chrome.runtime.lastError?.message || "unknown error"}`
      : `Authenticated as ${response.user.email}`;
  });
});

document.getElementById("reconnect").addEventListener("click", () => {
  statusNode.textContent = "Reconnecting open LinkedIn and Indeed pages...";
  chrome.runtime.sendMessage({ type: "RECONNECT_JOB_PAGES" }, (response) => {
    statusNode.textContent = chrome.runtime.lastError || !response?.ok
      ? `Reconnect failed: ${response?.error || chrome.runtime.lastError?.message || "unknown error"}`
      : `Reconnected ${response.count} open job page${response.count === 1 ? "" : "s"}`;
  });
});

useLocal.addEventListener("change", async () => {
  useLocal.disabled = true;
  try {
    await JobTrackerConfig.setEnvironment(useLocal.checked ? "local" : "production");
    await showEnvironment();
    await showAccount();
    statusNode.textContent = useLocal.checked
      ? "Local development mode — sign in to the local backend"
      : "Production mode — sign in to your hosted workspace";
  } catch (error) {
    useLocal.checked = false;
    statusNode.textContent = `Environment change failed: ${error.message}`;
  } finally {
    useLocal.disabled = false;
  }
});

Promise.all([showEnvironment(), showAccount()]).catch(() => {
  statusNode.textContent = useLocal.checked
    ? "Start the local MyStratos backend"
    : "Could not reach the hosted MyStratos service";
});
