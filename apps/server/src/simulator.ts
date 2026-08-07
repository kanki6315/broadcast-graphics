import type { DriverState, SessionState } from "@racecontrol/protocol";
import type { StateStore } from "./state-store.js";

const names = [
  ["23", "Maya Anderson", "Northline Racing"],
  ["17", "Jon Bell", "Bellworks Motorsport"],
  ["48", "Riley Patterson", "Signal Autosport"],
  ["9", "Alejandra Garcia", "Mesa Competition"],
  ["12", "Bryn Thompson", "Northline Racing"],
  ["31", "Dev Morris", "Keystone Velocity"],
  ["29", "Emi Johnson", "Signal Autosport"],
  ["55", "Luca Baker", "Aperture Racing"],
  ["66", "Noah Davis", "Bellworks Motorsport"],
  ["88", "Casey White", "Mesa Competition"],
  ["14", "Taylor Martinez", "Keystone Velocity"],
  ["3", "Morgan Harris", "Aperture Racing"],
] as const;

function drivers(tick: number): DriverState[] {
  return names.map(([carNumber, name, team], index) => {
    const base = 81.42 + index * 0.23;
    return {
      carIdx: index,
      position: index + 1,
      carNumber,
      name,
      team,
      className: "GT3",
      interval: index === 0 ? null : Number((index * 0.73 + Math.sin(tick / 9 + index) * 0.18).toFixed(3)),
      lastLap: base + Math.sin(tick / 7 + index) * 0.31,
      bestLap: base - 0.42 - (index % 3) * 0.04,
      lapsCompleted: 18,
      onPitRoad: index === 9 && tick % 24 < 7,
      incidents: index % 4,
      classId: 1,
      classColor: "#ff4b2b",
      classPosition: index + 1,
      gapToLeader: index === 0 ? 0 : Number((index * 0.73 + Math.sin(tick / 9 + index) * 0.18).toFixed(3)),
      intervalToAhead: index === 0 ? null : 0.73,
      classGapToLeader: index === 0 ? 0 : Number((index * 0.73 + Math.sin(tick / 9 + index) * 0.18).toFixed(3)),
      classIntervalToAhead: index === 0 ? null : 0.73,
      lapsBehindLeader: 0,
      lapsBehindClassLeader: 0,
      currentLap: 19,
      lastLapNumber: 18,
      bestLapNumber: 12,
      lapDistPct: (tick / 90 + index / names.length) % 1,
      trackStatus: index === 9 && tick % 24 < 7 ? "pit" : "running",
      isConnected: true,
    };
  });
}

export function startSimulator(store: StateStore): () => void {
  let tick = 0;
  const emit = () => {
    tick += 1;
    const session: SessionState = {
      id: "simulated-session",
      name: "Thursday Night GT3",
      type: "race",
      trackName: "Virginia International Raceway — Full Course",
      lap: 18 + Math.floor(tick / 90),
      totalLaps: 40,
      timeRemaining: null,
      flag: tick % 180 > 160 ? "yellow" : "green",
      timestamp: new Date().toISOString(),
      drivers: drivers(tick),
      lapsCompleted: 18 + Math.floor(tick / 90),
      lapsRemaining: 22 - Math.floor(tick / 90),
      timeElapsed: tick,
      totalTime: null,
      phase: "racing",
      startState: "go",
      flags: tick % 180 > 160 ? ["caution"] : ["green"],
      classes: [{ id: 1, name: "GT3", color: "#ff4b2b", carCount: names.length }],
    };
    store.telemetry(session);
  };
  emit();
  const timer = setInterval(emit, 1_000);
  return () => clearInterval(timer);
}
