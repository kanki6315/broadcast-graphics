import React, { useEffect, useState } from "react";
import { ArrowRight, ExternalLink, OctagonAlert, X } from "lucide-react";
import type { RaceEvent } from "@racecontrol/protocol";

function formatSessionTime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "Time —";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function EventTracker({ events, classId }: { events: RaceEvent[]; classId: number | "all" }) {
  const [logOpen, setLogOpen] = useState(false);
  const visible = classId === "all" ? events : events.filter((event) => event.classId === classId);
  const passCount = visible.filter((event) => event.kind === "pass").length;
  const crashCount = visible.filter((event) => event.kind === "crash").length;

  useEffect(() => {
    if (!logOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLogOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [logOpen]);

  const rows = (expanded = false) => visible.map((event) => (
    <article key={event.id} className={`race-event race-event-${event.kind}${expanded ? " is-expanded" : ""}`}>
      <span className="race-event-icon">{event.kind === "pass" ? <ArrowRight aria-hidden="true" /> : <OctagonAlert aria-hidden="true" />}</span>
      <div>
        <strong>{event.summary}</strong>
        <span>{event.detail}</span>
      </div>
      <time dateTime={event.at}>L{event.lap} · {formatSessionTime(event.sessionTime)}</time>
    </article>
  ));

  return (
    <section className="race-event-tracker" aria-label="Inferred race events">
      <header>
        <div className="race-event-heading"><strong>Event tracker</strong><span>Heuristic cues · verify on replay</span></div>
        <div className="race-event-actions">
          <dl>
            <div><dt>Pass</dt><dd>{passCount}</dd></div>
            <div><dt>Crash</dt><dd>{crashCount}</dd></div>
          </dl>
          <button type="button" aria-label="Open full event log" aria-controls="race-event-log" aria-expanded={logOpen} onClick={() => setLogOpen(true)}>
            <ExternalLink aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="race-event-feed" aria-live="polite">
        {visible.length === 0 ? (
          <p><strong>No inferred events</strong><span>Watching green-flag position swaps, surface departures, and stalled progress.</span></p>
        ) : rows()}
      </div>
      {logOpen && <aside id="race-event-log" className="race-event-log" role="dialog" aria-modal="false" aria-labelledby="race-event-log-title">
        <header>
          <div>
            <h2 id="race-event-log-title">Session event log</h2>
            <p>Inferred cues · newest first · verify on replay</p>
          </div>
          <button type="button" aria-label="Close full event log" onClick={() => setLogOpen(false)}><X aria-hidden="true" /></button>
        </header>
        <div className="race-event-log-list">
          {visible.length === 0 ? <p>No inferred events in this class.</p> : rows(true)}
        </div>
        <footer><span>{visible.length} cue{visible.length === 1 ? "" : "s"} in this view</span><span>Esc closes log</span></footer>
      </aside>}
    </section>
  );
}
