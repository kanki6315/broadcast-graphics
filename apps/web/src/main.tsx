import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";
import "./styles.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./auth-app";
import { OverlayApp } from "./overlay";

const isOverlay = window.location.pathname.startsWith("/overlay/");
document.documentElement.classList.toggle("overlay-document", isOverlay);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isOverlay ? <OverlayApp /> : <AdminApp />}</React.StrictMode>,
);
