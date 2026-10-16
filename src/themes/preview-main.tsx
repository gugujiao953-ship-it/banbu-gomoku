import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import "../library.css";
import "../design-tokens.css";
import "../legacy-webview.css";
import "./themes.css";
import ErrorBoundary from "../ErrorBoundary";
import { applyWebViewCompatibilityClass } from "../webview-compat";
import ThemePreview from "./ThemePreview";

applyWebViewCompatibilityClass(document.documentElement);
createRoot(document.getElementById("root")!).render(<StrictMode><ErrorBoundary><ThemePreview /></ErrorBoundary></StrictMode>);
