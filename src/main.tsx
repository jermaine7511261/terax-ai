import "./styles/globals.css";

import { detectPlatform, getPlatform, invoke } from "@/platform";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initLaunchDir } from "./lib/launchDir";
import { USE_CUSTOM_WINDOW_CONTROLS } from "./lib/platform";

if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

// Render-instrumentation overlay, opt-in: `VITE_REACT_SCAN=true pnpm dev`.
// Dev-only dynamic import so it never reaches the production bundle.
if (import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN === "true") {
  const { scan } = await import("react-scan");
  scan({ enabled: true });
}

// Activate the platform adapter once, before any module code runs: the
// feature modules call `invoke`/`createStorage`/`getOsPlatform` through it.
// Until this resolves, `invoke()` falls back to the raw Tauri call.
await detectPlatform();

// Reap PTY sessions orphaned by a prior webview load before any tab spawns.
// Web mode: no Tauri backend for this — fail silently.
await invoke("pty_close_all").catch(() => {});

// Seed before first paint so default tab mounts at target cwd (no flicker).
// Web mode has no launch-dir snapshot; initLaunchDir no-ops via the adapter.
await initLaunchDir();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

// Window starts hidden (per tauri.conf.json) so users never see a transparent
// shadow-only frame before React paints. Use setTimeout — rAF is throttled
// while the window is hidden and would never fire. Web mode: the browser
// adapter's window.show() is a no-op, so this is safe on both runtimes.
const showWindow = () => {
  getPlatform()
    .window.show()
    .catch((e) => console.error("window.show failed:", e));
};
setTimeout(showWindow, 50);
// Safety net: if the first show somehow fails to take effect, force again.
setTimeout(showWindow, 500);
