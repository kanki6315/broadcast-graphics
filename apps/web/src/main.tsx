import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";
import "./styles.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { ControlPanel } from "./control-panel";
import { OverlayApp } from "./overlay";

const isOverlay = window.location.pathname.startsWith("/overlay/");

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isOverlay ? <OverlayApp /> : <ControlPanel />}</React.StrictMode>,
);
