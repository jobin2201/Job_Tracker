import DashboardApp from "./DashboardApp";

export default function App() {
  if (window.location.pathname.startsWith("/app")) {
    return <DashboardApp />;
  }

  window.location.replace("/landing/index.html");
  return null;
}
