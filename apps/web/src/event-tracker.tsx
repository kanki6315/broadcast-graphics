import React, { useEffect, useState } from "react";
import { ArrowRight, ExternalLink, OctagonAlert, X } from "lucide-react";
import type { RaceEvent } from "@racecontrol/protocol";
import { timingJson } from "./timing-api";

interface EventPage { sessionId: string | null; events: RaceEvent[]; total: number; nextBefore: string | null }

function formatSessionTime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "Time —";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function EventTracker({ events, classId, sessionId, healthy = true, detecting = true }: { events: RaceEvent[]; classId: number | "all"; sessionId?: string; healthy?: boolean; detecting?: boolean }) {
  const [logOpen, setLogOpen] = useState(false);
  const [page, setPage] = useState<EventPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const scope = React.useRef(0);
  useEffect(() => { scope.current++; setPage(null); setError(""); }, [sessionId, classId]);
  async function loadOlder() {
    if (!sessionId || !page?.nextBefore || loading) return;
    const generation = scope.current;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ sessionId, before: page.nextBefore });
      if (classId !== "all") query.set("classId", String(classId));
      const older = await timingJson<EventPage>(`/api/history/events?${query}`);
      if (generation !== scope.current) return;
      setPage((current) => current ? { ...older, events: [...new Map([...current.events, ...older.events].map((event) => [event.id, event])).values()] } : older);
    } catch (reason) { if (generation === scope.current) setError(reason instanceof Error ? reason.message : "Event history unavailable"); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (!logOpen || !sessionId) return;
    let cancelled = false;
    const query = new URLSearchParams({ sessionId });
    if (classId !== "all") query.set("classId", String(classId));
    setLoading(true); setError("");
    timingJson<EventPage>(`/api/history/events?${query}`).then((latest) => {
      if (!cancelled) setPage((current) => current ? { ...latest, nextBefore: current.nextBefore, events: [...new Map([...latest.events, ...current.events].map((event) => [event.id, event])).values()] } : latest);
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Event history unavailable"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [logOpen, sessionId, classId, events[0]?.id]);
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

  const rows = (expanded = false) => (expanded && page ? page.events : visible).map((event) => (
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
        <div className="race-event-heading"><strong>Event tracker</strong><span>{!healthy ? "Feed unavailable · detection paused" : detecting ? "Heuristic cues · verify on replay" : "Waiting for green-flag racing"}</span></div>
        <div className="race-event-actions">
          <dl>
            <div><dt>Recent passes</dt><dd>{passCount}</dd></div>
            <div><dt>Recent crashes</dt><dd>{crashCount}</dd></div>
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
      {logOpen && <aside onKeyDown={(event) => { if (event.key === "Escape") setLogOpen(false); }} id="race-event-log" className="race-event-log" role="dialog" aria-modal="false" aria-labelledby="race-event-log-title">
        <header>
          <div>
            <h2 id="race-event-log-title">Session event log</h2>
            <p>Inferred cues · newest first · verify on replay · retained for this server session</p>
          </div>
          <button type="button" aria-label="Close full event log" onClick={() => setLogOpen(false)}><X aria-hidden="true" /></button>
        </header>
        <div className="race-event-log-list">
          {error && <p role="alert">{error}</p>}{loading && !page ? <p>Loading event history…</p> : rows(true)}{!loading && (page?.total ?? visible.length) === 0 && <p>No inferred events in this class.</p>}{page?.nextBefore && <button onClick={() => void loadOlder()} disabled={loading}>{loading ? "Loading…" : "Load older events"}</button>}
        </div>
        <footer><span>{page?.events.length ?? visible.length} of {page?.total ?? visible.length} cues</span><span>Esc closes log</span></footer>
      </aside>}
    </section>
  );
}
