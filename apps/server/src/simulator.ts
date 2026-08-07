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
  const completedLaps = 18 + Math.floor(tick / 90);
  const battleSwapped = Math.floor(tick / 8) % 2 === 1;
  return names.map<DriverState>(([carNumber, name, team], index) => {
    const position = battleSwapped && index === 1 ? 3 : battleSwapped && index === 2 ? 2 : index + 1;
    const base = 81.42 + index * 0.23;
    const gap = position === 1 ? 0 : Number(((position - 1) * 0.73 + Math.sin(tick / 9 + index) * 0.18).toFixed(3));
    return {
      carIdx: index,
      position,
      carNumber,
      name,
      team,
      className: "GT3",
      interval: position === 1 ? null : gap,
      lastLap: base + Math.sin(tick / 7 + index) * 0.31,
      bestLap: base - 0.42 - (index % 3) * 0.04,
      lapsCompleted: completedLaps,
      onPitRoad: index === 9 && tick % 24 < 7,
      incidents: index % 4,
      classId: 1,
      classColor: "#ff4b2b",
      classPosition: position,
      gapToLeader: gap,
      intervalToAhead: position === 1 ? null : 0.73,
      classGapToLeader: gap,
      classIntervalToAhead: position === 1 ? null : 0.73,
      lapsBehindLeader: 0,
      lapsBehindClassLeader: 0,
      currentLap: completedLaps + 1,
      lastLapNumber: completedLaps,
      bestLapNumber: 12,
      lapDistPct: (tick / 90 + index / names.length) % 1,
      trackStatus: index === 9 && tick % 24 < 7 ? "pit" : "running",
      isConnected: true,
      userId: 10_000 + index,
      teamId: 20_000 + index,
      carId: 1,
      lastLapPosition: position,
      lastLapClassPosition: position,
      lastLapGapToLeader: gap,
      lastLapGapToClassLeader: gap,
      lastLapLapsBehindLeader: 0,
      lastLapLapsBehindClassLeader: 0,
    };
  }).sort((left, right) => left.position - right.position);
}

export function startSimulator(store: StateStore, onTelemetry: (session: SessionState) => void = () => {}): () => void {
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
      source: "simulation",
      sourceMode: "simulation",
      externalSubSessionId: null,
      externalSessionNumber: null,
      trackId: null,
    };
    store.telemetry(session);
    onTelemetry(session);
  };
  emit();
  const timer = setInterval(emit, 1_000);
  return () => clearInterval(timer);
}
