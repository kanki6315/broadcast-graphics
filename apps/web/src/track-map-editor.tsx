import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Check, CircleDot, CloudDownload, Crosshair, GitBranch, LockKeyhole, MapPinned, MousePointer2, Plus, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import type {
  SectorBoundary,
  SectorDefinitionRevision,
  TrackLayoutIdentity,
  TrackMapCalibration,
  TrackMapDefinition,
  TrackMapPathCandidate,
} from "@racecontrol/protocol";
import { clientPointToViewBox, pointAndHeadingForLapPct, pointForLapPct, projectToPath } from "./track-map-geometry";
import { useLiveState } from "./use-live-state";
import "./track-map-editor.css";

interface ImportPreview { checksum: string; sanitizedSvg: string; viewBox: [number, number, number, number]; candidates: TrackMapPathCandidate[]; duplicateMapDefinitionId?: string }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "The configuration request failed.");
  return body;
}

function layoutFor(trackName: string, trackId?: number | null): TrackLayoutIdentity { return { trackId, trackName }; }
function normalized(boundaries: SectorBoundary[]): SectorBoundary[] { return [...boundaries].sort((a, b) => a.startPct - b.startPct).map((boundary, index) => ({ sectorNumber: index + 1, startPct: boundary.startPct })); }

export function TrackMapEditor() {
  const { state } = useLiveState("control", "operator");
  const session = state?.session;
  const layout = useMemo(() => session ? layoutFor(session.trackName, session.trackId) : null, [session?.trackId, session?.trackName]);
  const [maps, setMaps] = useState<TrackMapDefinition[]>([]);
  const [selectedMapId, setSelectedMapId] = useState<string>("");
  const [calibrations, setCalibrations] = useState<TrackMapCalibration[]>([]);
  const [revisions, setRevisions] = useState<SectorDefinitionRevision[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sourceSvg, setSourceSvg] = useState("");
  const [sourceFilename, setSourceFilename] = useState("");
  const [selectedPathId, setSelectedPathId] = useState("");
  const [startFinishPathPct, setStartFinishPathPct] = useState(0);
  const [direction, setDirection] = useState<"forward" | "reverse">("forward");
  const [rotationDegrees, setRotationDegrees] = useState(0);
  const [boundaries, setBoundaries] = useState<SectorBoundary[]>([]);
  const [dragSector, setDragSector] = useState<number | null>(null);
  const [addArmed, setAddArmed] = useState(false);
  const [placingStartFinish, setPlacingStartFinish] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  const selectedMap = maps.find((map) => map.id === selectedMapId) ?? null;
  const activeCalibration = calibrations.find((calibration) => calibration.active) ?? calibrations[0] ?? null;
  const activeRevision = revisions.find((revision) => revision.active) ?? null;
  const nativeRevision = revisions.find((revision) => revision.source === "iracing") ?? null;
  const raceLocked = Boolean(session?.type === "race" && (session.lapsCompleted > 0 || session.lap > 1 || session.startState === "go" || ["racing", "checkered", "cool-down"].includes(session.phase)));

  async function loadConfiguration() {
    if (!layout) return;
    try {
      const [mapList, sectorList] = await Promise.all([
        api<TrackMapDefinition[]>(`/api/track-config/maps?layout=${encodeURIComponent(JSON.stringify(layout))}`),
        api<SectorDefinitionRevision[]>("/api/track-config/sectors"),
      ]);
      setMaps(mapList); setRevisions(sectorList);
      const nextMapId = state?.trackConfiguration?.activeMap?.mapDefinitionId ?? (selectedMapId || mapList[0]?.id || "");
      setSelectedMapId(nextMapId);
      const nextActive = sectorList.find((revision) => revision.active);
      setBoundaries((current) => current.length ? current : structuredClone(nextActive?.boundaries ?? []));
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Configuration could not be loaded."); }
  }

  useEffect(() => { void loadConfiguration(); }, [layout?.trackId, layout?.trackName, state?.trackConfiguration?.activeMap?.calibrationId]);
  useEffect(() => {
    if (!selectedMapId) { setCalibrations([]); return; }
    void api<TrackMapCalibration[]>(`/api/track-config/calibrations?mapDefinitionId=${encodeURIComponent(selectedMapId)}`).then((items) => {
      setCalibrations(items);
      const active = items.find((item) => item.active) ?? items[0];
      const map = maps.find((item) => item.id === selectedMapId);
      if (active) { setStartFinishPathPct(active.startFinishPathPct); setDirection(active.direction); setRotationDegrees(active.rotationDegrees ?? 0); setPlacingStartFinish(false); }
      else {
        setStartFinishPathPct(map?.suggestedStartFinishPathPct ?? 0); setDirection("forward"); setRotationDegrees(0);
        setPlacingStartFinish(map?.suggestedStartFinishPathPct == null);
      }
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Calibrations could not be loaded."));
  }, [selectedMapId, maps]);

  async function selectFile(file: File | undefined) {
    if (!file) return;
    setError(""); setMessage("");
    if (file.size > 1_000_000) { setError("The SVG exceeds the 1 MB import limit."); return; }
    setBusy(true);
    try {
      const svg = await file.text();
      const result = await api<ImportPreview>("/api/track-config/import-preview", { method: "POST", body: JSON.stringify({ svg }) });
      setSourceSvg(svg); setSourceFilename(file.name); setPreview(result); setSelectedPathId(result.candidates[0]?.id ?? "");
      setMessage(result.duplicateMapDefinitionId ? "This exact asset checksum is already stored. You can reuse the existing definition." : `${result.candidates.length} closed path candidate${result.candidates.length === 1 ? "" : "s"} validated.`);
    } catch (importError) { setPreview(null); setError(importError instanceof Error ? importError.message : "SVG validation failed."); }
    finally { setBusy(false); }
  }

  async function saveMap() {
    if (!layout || !preview || !selectedPathId) return;
    setBusy(true); setError("");
    try {
      const map = await api<TrackMapDefinition>("/api/track-config/maps", { method: "POST", body: JSON.stringify({ svg: sourceSvg, layout, selectedPathId, source: "imported", originalFilename: sourceFilename }) });
      setMessage(`Centerline stored as map ${map.id.slice(0, 8)}. Calibrate start/finish and direction before activation.`);
      setPreview(null); setMaps((current) => current.some((item) => item.id === map.id) ? current : [map, ...current]); setSelectedMapId(map.id);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Map could not be stored."); }
    finally { setBusy(false); }
  }

  async function importIracingMap() {
    if (!layout) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const map = await api<TrackMapDefinition>("/api/track-config/maps/iracing", { method: "POST", body: JSON.stringify({ layout }) });
      setMaps((current) => current.some((item) => item.id === map.id)
        ? current.map((item) => item.id === map.id ? map : item)
        : [map, ...current]);
      setSelectedMapId(map.id);
      setStartFinishPathPct(map.suggestedStartFinishPathPct ?? 0);
      setPlacingStartFinish(map.suggestedStartFinishPathPct == null);
      setMessage(map.suggestedStartFinishPathPct == null
        ? `Official centerline stored as map ${map.id.slice(0, 8)}. The S/F reference was unavailable; place it manually and confirm direction.`
        : `Official iRacing S/F snapped to ${(map.suggestedStartFinishPathPct * 100).toFixed(3)}% of the source path. Confirm direction before activation.`);
    } catch (importError) { setError(importError instanceof Error ? importError.message : "The iRacing map could not be imported."); }
    finally { setBusy(false); }
  }

  function projected(event: Pick<ReactPointerEvent<SVGSVGElement>, "clientX" | "clientY">) {
    if (!svgRef.current || !pathRef.current || !activeCalibration) return null;
    return projectToPath(pathRef.current, clientPointToViewBox(svgRef.current, event.clientX, event.clientY), activeCalibration);
  }

  function mapPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!pathRef.current || !svgRef.current) return;
    if (placingStartFinish) {
      const length = pathRef.current.getTotalLength();
      const target = clientPointToViewBox(svgRef.current, event.clientX, event.clientY);
      const provisional = projectToPath(pathRef.current, target, { startFinishPathPct: 0, direction: "forward" });
      setStartFinishPathPct(provisional.pathPct); setPlacingStartFinish(false); setMessage(`Manual start/finish placed at ${(provisional.pathPct * 100).toFixed(3)}% of the source path.`);
      return;
    }
    if (addArmed) {
      const result = projected(event); if (!result) return;
      setBoundaries((current) => normalized([...current, { sectorNumber: current.length + 1, startPct: result.lapPct }]));
      setAddArmed(false); setMessage(`Boundary added at ${(result.lapPct * 100).toFixed(3)}% lap distance.`);
    }
  }

  function mapPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragSector == null || dragSector === 1) return;
    const result = projected(event); if (!result) return;
    setBoundaries((current) => normalized(current.map((boundary) => boundary.sectorNumber === dragSector ? { ...boundary, startPct: result.lapPct } : boundary)));
  }

  async function saveCalibration() {
    if (!selectedMap) return;
    setBusy(true); setError("");
    try {
      const calibration = await api<TrackMapCalibration>("/api/track-config/calibrations", { method: "POST", body: JSON.stringify({ mapDefinitionId: selectedMap.id, startFinishPathPct, direction, rotationDegrees }) });
      setCalibrations((current) => [calibration, ...current]); setMessage(`Calibration revision ${calibration.revision} saved inactive. Review the percentage markers, then activate it.`);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Calibration could not be saved."); }
    finally { setBusy(false); }
  }

  async function activateCalibration(calibration: TrackMapCalibration) {
    if (!layout) return;
    setBusy(true); setError("");
    try {
      await api(`/api/track-config/calibrations/${calibration.id}/activate`, { method: "POST", body: JSON.stringify({ layout }) });
      setCalibrations((current) => current.map((item) => ({ ...item, active: item.id === calibration.id })));
      setMessage(`Calibration ${calibration.revision} is active for this exact layout.`);
    } catch (activationError) { setError(activationError instanceof Error ? activationError.message : "Calibration could not be activated."); }
    finally { setBusy(false); }
  }

  function resetTo(definition: SectorDefinitionRevision | null) {
    setBoundaries(structuredClone(definition?.boundaries ?? [])); setAddArmed(false); setDragSector(null);
    setMessage(definition ? `Draft reset to ${definition.source} revision ${definition.revision}. Nothing active changed.` : "No native definition is available for this layout.");
  }

  async function saveDraft() {
    if (!layout || !activeCalibration) return;
    setBusy(true); setError("");
    try {
      const draft = await api<SectorDefinitionRevision>("/api/track-config/sectors", { method: "POST", body: JSON.stringify({ layout, boundaries, mapCalibrationId: activeCalibration.id }) });
      setRevisions((current) => current.some((revision) => revision.revision === draft.revision) ? current : [draft, ...current]);
      setMessage(`Custom revision ${draft.revision} saved as a draft. Current timing comparisons are unchanged.`);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Sector draft could not be saved."); }
    finally { setBusy(false); }
  }

  async function activateRevision(revision: SectorDefinitionRevision) {
    if (!layout) return;
    setBusy(true); setError("");
    try {
      await api(`/api/track-config/sectors/${encodeURIComponent(revision.revision)}/activate`, { method: "POST", body: JSON.stringify({ layout }) });
      setRevisions((current) => current.map((item) => ({ ...item, active: item.revision === revision.revision, draft: item.revision === revision.revision ? false : item.draft })));
      setBoundaries(structuredClone(revision.boundaries));
      setMessage(`Revision ${revision.revision} is active. New sector results will compare only within this revision.`);
    } catch (activationError) { setError(activationError instanceof Error ? activationError.message : "Sector revision could not be activated."); }
    finally { setBusy(false); }
  }

  if (!state) return <main className="loading-screen"><MapPinned aria-hidden="true" /><h1>Opening track configuration</h1><p>Waiting for the authorized control connection.</p></main>;
  if (!layout) return <main className="map-config-empty"><a href="/control"><ArrowLeft aria-hidden="true" />Control desk</a><h1>No active track layout</h1><p>Connect telemetry before importing or activating a circuit definition.</p></main>;

  const previewCalibration = { startFinishPathPct, direction };
  const markerScale = selectedMap ? Math.max(selectedMap.viewBox[2] / 80, selectedMap.viewBox[3] / 45) : 1;
  const percentageMarkers = selectedMap && pathRef.current ? [0, .25, .5, .75].map((lapPct) => ({
    lapPct, point: pointForLapPct(pathRef.current!, lapPct, previewCalibration),
  })) : [];
  const directionMarkers = selectedMap && pathRef.current ? [.125, .375, .625, .875].map((lapPct) => (
    pointAndHeadingForLapPct(pathRef.current!, lapPct, previewCalibration)
  )) : [];

  return (
    <div className="map-config-shell">
      <header className="map-config-masthead"><a href="/control"><ArrowLeft aria-hidden="true" />Control desk</a><div><img src="/brand/gantry-mark.svg" alt="" /><strong>Track configuration</strong><span>{layout.trackName}{layout.configurationName ? ` · ${layout.configurationName}` : ""}</span></div><div className={raceLocked ? "is-locked" : "is-open"}>{raceLocked ? <LockKeyhole aria-hidden="true" /> : <Check aria-hidden="true" />}<strong>{raceLocked ? "Race locked" : "Pre-race changes allowed"}</strong></div></header>
      <main className="map-config-workspace">
        <section className="map-config-intro"><div><h1>Calibrated circuit and sectors</h1><p>Import verified geometry, align lap distance to the path, then publish immutable sector revisions. Telemetry never creates the circuit shape.</p></div><dl><div><dt>Track identity</dt><dd>{layout.trackId ?? "Name only"}</dd></div><div><dt>Active map</dt><dd>{state.trackConfiguration?.activeMap ? `CAL ${state.trackConfiguration.activeMap.calibrationRevision}` : "Ribbon fallback"}</dd></div><div><dt>Sector revision</dt><dd>{activeRevision?.revision ?? "Native pending"}</dd></div></dl></section>
        {(error || message) && <div className={`map-config-notice${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{error || message}<button type="button" onClick={() => { setError(""); setMessage(""); }}>Dismiss</button></div>}
        <div className="map-config-grid">
          <section className="map-import-panel" aria-labelledby="map-import-title"><header><Upload aria-hidden="true" /><div><h2 id="map-import-title">Import and select centerline</h2><p>SVG only · 1 MB · inert closed paths</p></div></header>
            <button className="iracing-import" type="button" disabled={busy || !layout.trackId} onClick={() => void importIracingMap()}><CloudDownload aria-hidden="true" /><span><strong>{busy ? "Contacting iRacing…" : "Import from iRacing"}</strong><small>Official SVG for track layout {layout.trackId ?? "unknown"}</small></span></button>
            <div className="import-divider"><span>or choose a local file</span></div>
            <label className="svg-drop"><input type="file" accept="image/svg+xml,.svg" disabled={busy} onChange={(event) => void selectFile(event.target.files?.[0])} /><Upload aria-hidden="true" /><strong>{busy ? "Validating asset…" : "Choose local SVG"}</strong><span>Scripts, event handlers, CSS, images, fonts, and external URLs are rejected.</span></label>
            {preview && <div className="path-selection"><div className="path-preview"><svg viewBox={preview.viewBox.join(" ")} aria-label="Sanitized path candidates">{preview.candidates.map((candidate) => <path key={candidate.id} d={candidate.pathData} className={candidate.id === selectedPathId ? "is-selected" : ""} onClick={() => setSelectedPathId(candidate.id)} />)}</svg></div><fieldset><legend>Validated paths</legend>{preview.candidates.map((candidate) => <label key={candidate.id} className={candidate.id === selectedPathId ? "is-selected" : ""}><input type="radio" name="centerline" checked={candidate.id === selectedPathId} onChange={() => setSelectedPathId(candidate.id)} /><span><strong>{candidate.id}</strong><small>{candidate.length.toFixed(1)} units · closed</small></span></label>)}</fieldset><button className="config-primary" type="button" disabled={!selectedPathId || busy} onClick={() => void saveMap()}><Save aria-hidden="true" />Store selected centerline</button></div>}
          </section>

          <section className="map-calibration-panel" aria-labelledby="calibration-title"><header><CircleDot aria-hidden="true" /><div><h2 id="calibration-title">Calibrate start and direction</h2><p>Path distance ↔ lap distance</p></div></header>
            <label className="config-field"><span>Stored map</span><select value={selectedMapId} onChange={(event) => setSelectedMapId(event.target.value)}><option value="">Choose a map</option>{maps.map((map) => <option key={map.id} value={map.id}>{map.originalFilename ?? map.id.slice(0, 8)} · {map.sourceChecksum.slice(0, 8)}</option>)}</select></label>
            {selectedMap && <><div className={`calibration-map${placingStartFinish ? " is-placing-start" : ""}`}><svg ref={svgRef} viewBox={selectedMap.viewBox.join(" ")} onPointerDown={mapPointerDown} onPointerMove={mapPointerMove} onPointerUp={() => setDragSector(null)} onPointerLeave={() => setDragSector(null)} aria-label={`Centerline calibration editor. Orange arrows show ${direction} travel.`}><g transform={`rotate(${rotationDegrees} ${selectedMap.viewBox[0] + selectedMap.viewBox[2] / 2} ${selectedMap.viewBox[1] + selectedMap.viewBox[3] / 2})`}><path className="calibration-bed" d={selectedMap.centerlinePath} />{selectedMap.startFinishMarkerPaths?.map((path, index) => <path key={index} className="start-finish-reference" d={path} />)}<path ref={pathRef} className="calibration-line" d={selectedMap.centerlinePath} />{directionMarkers.map(({ x, y, angleDegrees }, index) => <g key={index} className="direction-marker" transform={`translate(${x} ${y}) rotate(${angleDegrees}) scale(${markerScale})`} aria-hidden="true"><path d="M-2.1-1.35L1.6 0-2.1 1.35-1.05 0Z" /></g>)}{percentageMarkers.map(({ lapPct, point }) => <g key={lapPct} className={`percentage-marker${lapPct === 0 ? " is-start" : ""}`} transform={`translate(${point.x} ${point.y}) scale(${markerScale})`}><line x1="0" y1="-1.2" x2="0" y2="1.2" /><circle r=".62" /><rect x="-4" y="-4.7" width="8" height="3" /><text y="-2.55">{lapPct === 0 ? "START / FINISH" : `${lapPct * 100}% LAP`}</text></g>)}{activeCalibration && boundaries.map((boundary) => { const point = pointForLapPct(pathRef.current!, boundary.startPct, activeCalibration); return <g key={boundary.sectorNumber} className={`sector-editor-handle${boundary.sectorNumber === 1 ? " is-fixed" : ""}`} role="button" tabIndex={0} aria-label={`${boundary.sectorNumber === 1 ? "Fixed start finish" : `Move sector ${boundary.sectorNumber} boundary`} at ${(boundary.startPct * 100).toFixed(3)} percent`} transform={`translate(${point.x} ${point.y})`} onPointerDown={(event) => { event.stopPropagation(); if (boundary.sectorNumber !== 1) { setDragSector(boundary.sectorNumber); event.currentTarget.setPointerCapture(event.pointerId); } }} onKeyDown={(event) => { if (boundary.sectorNumber === 1) return; if (event.key === "Delete" || event.key === "Backspace") setBoundaries((current) => normalized(current.filter((item) => item.sectorNumber !== boundary.sectorNumber))); if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); const delta = event.key === "ArrowLeft" ? -0.005 : 0.005; setBoundaries((current) => normalized(current.map((item) => boundary.sectorNumber === item.sectorNumber ? { ...item, startPct: Math.max(0.005, Math.min(0.995, item.startPct + delta)) } : item))); } }}><circle r="6" /><text y="-9">{boundary.sectorNumber === 1 ? "S/F" : `S${boundary.sectorNumber}`}</text></g>; })}</g></svg><span>{placingStartFinish ? "Click the centerline to override S/F" : addArmed ? "Click the centerline to add a boundary" : activeCalibration ? "Arrows show travel · drag sector handles to adjust" : "Orange arrows must follow racing traffic"}</span></div>
              <div className={`start-finish-status${selectedMap.suggestedStartFinishPathPct == null ? " is-manual" : ""}`}><div><strong>{selectedMap.suggestedStartFinishPathPct == null ? "Manual S/F required" : "Official iRacing S/F detected"}</strong><span>{selectedMap.suggestedStartFinishPathPct == null ? "Click the centerline at the scoring line." : "The orange reference line is projected onto the centerline. Override only if visual inspection shows a mismatch."}</span></div><button type="button" className={placingStartFinish ? "is-armed" : ""} onClick={() => setPlacingStartFinish((value) => !value)}><Crosshair aria-hidden="true" />{placingStartFinish ? "Cancel placement" : "Place manually"}</button></div>
              <div className="calibration-controls"><label><span>Source path start</span><output>{(startFinishPathPct * 100).toFixed(3)}%</output></label><fieldset className="direction-choice"><legend>Travel direction · match arrows to traffic</legend><label><input type="radio" checked={direction === "forward"} onChange={() => setDirection("forward")} /><span>Forward</span></label><label><input type="radio" checked={direction === "reverse"} onChange={() => setDirection("reverse")} /><span>Reverse</span></label></fieldset><label className="config-field"><span>Display rotation</span><input type="number" min="-360" max="360" step="1" value={rotationDegrees} onChange={(event) => setRotationDegrees(Number(event.target.value))} /></label></div>
              <div className="config-actions"><button className="config-primary" disabled={busy} onClick={() => void saveCalibration()}><Save aria-hidden="true" />Save new calibration</button>{calibrations.filter((item) => !item.active).slice(0, 1).map((item) => <button key={item.id} disabled={busy} onClick={() => void activateCalibration(item)}><Check aria-hidden="true" />Activate CAL {item.revision}</button>)}</div></>}
          </section>

          <section className="sector-editor-panel" aria-labelledby="sector-editor-title"><header><GitBranch aria-hidden="true" /><div><h2 id="sector-editor-title">Sector definition editor</h2><p>{raceLocked ? "Current revision locked · drafts remain future-only" : "Pre-race activation available"}</p></div></header>
            {!activeCalibration ? <p className="config-empty">Activate a calibrated map before editing sector boundaries.</p> : <><div className="sector-toolbar"><button className={addArmed ? "is-armed" : ""} onClick={() => setAddArmed((value) => !value)}><Plus aria-hidden="true" />{addArmed ? "Click map…" : "Add boundary"}</button><button onClick={() => resetTo(nativeRevision)} disabled={!nativeRevision}><RotateCcw aria-hidden="true" />Reset to native</button><button onClick={() => resetTo(activeRevision)} disabled={!activeRevision}><MousePointer2 aria-hidden="true" />Cancel draft</button></div>
              <ol className="sector-boundary-list">{boundaries.map((boundary, index) => { const next = boundaries[index + 1]?.startPct ?? 1; return <li key={boundary.sectorNumber} className={boundary.sectorNumber === 1 ? "is-fixed" : ""}><span>S{boundary.sectorNumber}</span><strong>{(boundary.startPct * 100).toFixed(3)}%</strong><small>{((next - boundary.startPct) * 100).toFixed(3)}% range</small><button aria-label={`Delete sector ${boundary.sectorNumber} boundary`} disabled={boundary.sectorNumber === 1 || boundaries.length <= 2} onClick={() => setBoundaries((current) => normalized(current.filter((item) => item.sectorNumber !== boundary.sectorNumber)))}>{boundary.sectorNumber === 1 ? <LockKeyhole aria-hidden="true" /> : <Trash2 aria-hidden="true" />}</button></li>; })}</ol>
              <div className="crossing-preview"><strong>Expected crossing order</strong><span>{boundaries.map((boundary) => `S${boundary.sectorNumber}`).join(" → ")} → S1</span></div>
              <div className="revision-warning"><strong>Revision boundary</strong><p>Saving creates a new immutable draft. Activation starts a separate comparison set; existing sector results stay attached to their original revision.</p></div>
              <div className="config-actions"><button className="config-primary" disabled={busy || boundaries.length < 2} onClick={() => void saveDraft()}><Save aria-hidden="true" />Save custom draft</button>{revisions.filter((revision) => revision.draft).slice(0, 1).map((revision) => <button key={revision.revision} disabled={busy || raceLocked} onClick={() => void activateRevision(revision)}>{raceLocked ? <LockKeyhole aria-hidden="true" /> : <Check aria-hidden="true" />}{raceLocked ? "Future session only" : "Activate draft"}</button>)}</div>
              <div className="revision-register"><strong>Revision register</strong>{revisions.length ? revisions.map((revision) => <div key={revision.revision} className={revision.active ? "is-active" : revision.draft ? "is-draft" : ""}><span>{revision.source}</span><code>{revision.revision}</code><b>{revision.active ? "ACTIVE" : revision.draft ? "DRAFT" : "HISTORY"}</b><small>{revision.boundaries.length} sectors</small></div>) : <p>No sector definitions observed yet.</p>}</div></>}
          </section>
        </div>
      </main>
    </div>
  );
}
