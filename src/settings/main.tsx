import "../styles/globals.css";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { ThemeProvider } from "@/modules/theme";
import { detectPlatform, getCurrentWindow } from "@/platform";
import ReactDOM from "react-dom/client";
import { SettingsApp } from "./SettingsApp";

if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

// Activate the platform adapter (same as the main window bootstrap).
await detectPlatform();

ReactDOM.createRoot(
  document.getElementById("settings-root") as HTMLElement,
).render(
  <ErrorBoundary>
    <ThemeProvider>
      <SettingsApp />
    </ThemeProvider>
  </ErrorBoundary>,
);

const showWindow = () => {
  getCurrentWindow()
    .show()
    .catch((e) => console.error("settings show failed:", e));
};
setTimeout(showWindow, 50);
setTimeout(showWindow, 500);
