import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "#App.tsx";
import { getLocale } from "#paraglide/runtime.js";
import "#styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");
document.documentElement.lang = getLocale();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
