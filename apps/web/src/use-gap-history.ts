import { useCallback, useEffect, useRef, useState } from "react";
import type { ClassGapHistoryResponse, CompletedLap } from "@racecontrol/protocol";

export interface RecentLapHistoryResource {
  laps: CompletedLap[];
  loading: boolean;
  error: string | null;
}

interface GapHistoryModalResource {
  open: boolean;
  loading: boolean;
  error: string | null;
  history: ClassGapHistoryResponse | null;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Race history could not be loaded.");
  return body;
}

export function mergeClassGapHistory(
  cached: ClassGapHistoryResponse | undefined,
  incoming: ClassGapHistoryResponse,
): ClassGapHistoryResponse {
  if (!cached || cached.sessionId !== incoming.sessionId || cached.classId !== incoming.classId) return incoming;
  const points = new Map(cached.points.map((point) => [`${point.carIdx}:${point.lapNumber}`, point]));
  for (const point of incoming.points) points.set(`${point.carIdx}:${point.lapNumber}`, point);
  const drivers = new Map(cached.drivers.map((driver) => [driver.carIdx, driver]));
  for (const driver of incoming.drivers) drivers.set(driver.carIdx, driver);
  return {
    ...incoming,
    drivers: [...drivers.values()],
    points: [...points.values()].sort((left, right) => left.lapNumber - right.lapNumber || left.carIdx - right.carIdx),
  };
}

function historyWatermarks(history: ClassGapHistoryResponse | undefined): string {
  if (!history) return "";
  const highest = new Map<number, number>();
  for (const point of history.points) highest.set(point.carIdx, Math.max(point.lapNumber, highest.get(point.carIdx) ?? 0));
  return [...highest].sort(([left], [right]) => left - right).map(([carIdx, lap]) => `${carIdx}:${lap}`).join(",");
}

export function useGapHistory(sessionId: string | undefined) {
  const classCache = useRef(new Map<string, ClassGapHistoryResponse>());
  const recentCache = useRef(new Map<string, RecentLapHistoryResource>());
  const modalRequest = useRef(0);
  const [modal, setModal] = useState<GapHistoryModalResource>({ open: false, loading: false, error: null, history: null });
  const [recentByCarIdx, setRecentByCarIdx] = useState<ReadonlyMap<number, RecentLapHistoryResource>>(new Map());

  useEffect(() => {
    modalRequest.current += 1;
    classCache.current.clear();
    recentCache.current.clear();
    setModal({ open: false, loading: false, error: null, history: null });
    setRecentByCarIdx(new Map());
  }, [sessionId]);

  const openClassHistory = useCallback(async (classId: number) => {
    if (!sessionId) return;
    const key = `${sessionId}:${classId}`;
    const cached = classCache.current.get(key);
    const requestId = ++modalRequest.current;
    setModal({ open: true, loading: true, error: null, history: null });
    try {
      const query = new URLSearchParams({ classId: String(classId) });
      const after = historyWatermarks(cached);
      if (after) query.set("after", after);
      const incoming = await getJson<ClassGapHistoryResponse>(`/api/history/class-gaps?${query}`);
      if (modalRequest.current !== requestId) return;
      if (incoming.sessionId !== sessionId || incoming.classId !== classId) throw new Error("The active race changed while history was loading.");
      const merged = mergeClassGapHistory(cached, incoming);
      classCache.current.set(key, merged);
      setModal({ open: true, loading: false, error: null, history: structuredClone(merged) });
    } catch (error) {
      if (modalRequest.current !== requestId) return;
      const message = error instanceof Error ? error.message : "Race history could not be loaded.";
      setModal({ open: true, loading: false, error: cached ? `${message} Showing cached history.` : message, history: cached ? structuredClone(cached) : null });
    }
  }, [sessionId]);

  const closeModal = useCallback(() => {
    modalRequest.current += 1;
    setModal((current) => ({ ...current, open: false }));
  }, []);

  const loadRecentLaps = useCallback(async (carIdx: number) => {
    if (!sessionId) return;
    const key = `${sessionId}:${carIdx}`;
    const cached = recentCache.current.get(key);
    if (cached?.loading) return;
    const loading = { laps: cached?.laps ?? [], loading: true, error: null } satisfies RecentLapHistoryResource;
    recentCache.current.set(key, loading);
    setRecentByCarIdx((current) => new Map(current).set(carIdx, loading));
    try {
      const laps = await getJson<CompletedLap[]>(`/api/history/laps?carIdx=${encodeURIComponent(carIdx)}&limit=10`);
      const loaded = { laps, loading: false, error: null } satisfies RecentLapHistoryResource;
      recentCache.current.set(key, loaded);
      setRecentByCarIdx((current) => new Map(current).set(carIdx, loaded));
    } catch (error) {
      const failed = { laps: [], loading: false, error: error instanceof Error ? error.message : "Lap history could not be loaded." } satisfies RecentLapHistoryResource;
      recentCache.current.set(key, failed);
      setRecentByCarIdx((current) => new Map(current).set(carIdx, failed));
    }
  }, [sessionId]);

  return { modal, openClassHistory, closeModal, recentByCarIdx, loadRecentLaps };
}
