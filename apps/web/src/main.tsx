import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "#App.tsx";
import { installAudioUnlock } from "#audio.ts";
import { startErrorReporting } from "#error-reporting.ts";
import { getLocale } from "#paraglide/runtime.js";
import "#styles.css";

// Start reporting first, so errors during the first render are caught too.
// Without a SENTRY_DSN the server says no and nothing is initialised.
await startErrorReporting();
installAudioUnlock();

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");
document.documentElement.lang = getLocale();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
