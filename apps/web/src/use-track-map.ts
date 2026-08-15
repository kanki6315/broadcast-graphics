import { useEffect, useState } from "react";
import type { ActiveTrackMap, TrackMapCalibration, TrackMapDefinition } from "@racecontrol/protocol";

interface TrackMapResource {
  definition: TrackMapDefinition | null;
  calibration: TrackMapCalibration | null;
  loading: boolean;
  error: string | null;
}

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  const response = await fetch(path, {
    signal,
    headers: token?.startsWith("bg_comms_") ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Track-map configuration could not be loaded.");
  return body;
}

export function useTrackMap(active: ActiveTrackMap | null | undefined): TrackMapResource {
  const [resource, setResource] = useState<TrackMapResource>({ definition: null, calibration: null, loading: false, error: null });
  useEffect(() => {
    if (!active) {
      setResource({ definition: null, calibration: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setResource((current) => ({ ...current, loading: true, error: null }));
    void Promise.all([
      getJson<TrackMapDefinition>(`/api/track-config/maps/${encodeURIComponent(active.mapDefinitionId)}`, controller.signal),
      getJson<TrackMapCalibration>(`/api/track-config/calibrations/${encodeURIComponent(active.calibrationId)}`, controller.signal),
    ]).then(([definition, calibration]) => {
      if (definition.sourceChecksum !== active.sourceChecksum || calibration.mapDefinitionId !== definition.id)
        throw new Error("The active map and calibration do not match.");
      setResource({ definition, calibration, loading: false, error: null });
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setResource({ definition: null, calibration: null, loading: false, error: error instanceof Error ? error.message : "Track map unavailable." });
    });
    return () => controller.abort();
  }, [active?.calibrationId, active?.mapDefinitionId, active?.sourceChecksum]);
  return resource;
}
