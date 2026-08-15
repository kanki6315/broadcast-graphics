import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";
import "./styles.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./auth-app";
import { CommentatorTiming } from "./commentator-timing";
import { OverlayApp } from "./overlay";

const isOverlay = window.location.pathname === "/overlay" || window.location.pathname === "/overlay/";
const isTiming = window.location.pathname === "/timing" || window.location.pathname === "/timing/";
const sharedToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
const isSharedCommentator = isTiming && sharedToken?.startsWith("bg_comms_");
document.documentElement.classList.toggle("overlay-document", isOverlay);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isOverlay
    ? <OverlayApp />
    : isSharedCommentator
      ? <CommentatorTiming onLogout={async () => { window.location.replace("/timing"); }} />
      : <AdminApp />}</React.StrictMode>,
);
