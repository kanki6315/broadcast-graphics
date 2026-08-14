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

function inferredPitFixture(tick: number) {
  const phase = tick % 20;
  const pitEntryTime = tick - phase;
  if (phase < 4) return {
    pitState: "pit-lane" as const,
    visit: { pitEntryTime, pitLaneTime: phase, boxTime: 0, unknownTime: 0, observedBoxTime: 0, inferredBoxTime: 0, driverChange: false, entryDriverId: "10009", quality: "incomplete" as const },
  };
  if (phase < 7) return {
    pitState: "pit-stall" as const,
    visit: { pitEntryTime, pitLaneTime: 4, boxTime: phase - 4, unknownTime: 0, observedBoxTime: phase - 4, inferredBoxTime: 0, driverChange: false, entryDriverId: "10009", quality: "incomplete" as const },
  };
  if (phase < 10) return {
    pitState: "unobserved" as const,
    visit: { pitEntryTime, pitLaneTime: 4, boxTime: 2, unknownTime: phase - 6, observedBoxTime: 2, inferredBoxTime: 0, driverChange: phase >= 8, entryDriverId: "10009", quality: "incomplete" as const },
  };
  if (phase < 13) return {
    pitState: "pit-stall" as const,
    visit: { pitEntryTime, pitLaneTime: 4, boxTime: 6 + phase - 10, unknownTime: 0, observedBoxTime: 2 + phase - 10, inferredBoxTime: 4, driverChange: true, entryDriverId: "10009", quality: "incomplete" as const },
  };
  if (phase < 16) return {
    pitState: "pit-lane" as const,
    visit: { pitEntryTime, pitLaneTime: 4 + phase - 13, boxTime: 9, unknownTime: 0, observedBoxTime: 5, inferredBoxTime: 4, driverChange: true, entryDriverId: "10009", exitDriverId: "10109", quality: "incomplete" as const },
  };
  return {
    pitState: "not-in-pits" as const,
    visit: { pitEntryTime, pitExitTime: pitEntryTime + 16, pitLaneTime: 7, boxTime: 9, unknownTime: 0, observedBoxTime: 5, inferredBoxTime: 4, driverChange: true, entryDriverId: "10009", exitDriverId: "10109", quality: "contains-inference" as const },
  };
}

function unknownPitFixture(tick: number) {
  const phase = tick % 20;
  const pitEntryTime = tick - phase;
  if (phase < 3) return {
    pitState: "pit-lane" as const,
    visit: { pitEntryTime, pitLaneTime: phase, boxTime: 0, unknownTime: 0, observedBoxTime: 0, inferredBoxTime: 0, driverChange: false, entryDriverId: "10008", quality: "incomplete" as const },
  };
  if (phase < 7) return {
    pitState: "unobserved" as const,
    visit: { pitEntryTime, pitLaneTime: 3, boxTime: 0, unknownTime: phase - 3, observedBoxTime: 0, inferredBoxTime: 0, driverChange: false, entryDriverId: "10008", quality: "incomplete" as const },
  };
  return {
    pitState: "not-in-pits" as const,
    visit: { pitEntryTime, pitExitTime: pitEntryTime + 7, pitLaneTime: 3, boxTime: 0, unknownTime: 4, observedBoxTime: 0, inferredBoxTime: 0, driverChange: false, entryDriverId: "10008", exitDriverId: "10008", quality: "incomplete" as const },
  };
}

export function simulatedDrivers(tick: number): DriverState[] {
  const completedLaps = 18 + Math.floor(tick / 90);
  const battleSwapped = Math.floor(tick / 8) % 2 === 1;
  return names.map<DriverState>(([carNumber, name, team], index) => {
    const position = battleSwapped && index === 1 ? 3 : battleSwapped && index === 2 ? 2 : index + 1;
    const classId = index < 8 ? 1 : 2;
    const className = index < 8 ? "GT3" : "TCR";
    const startingClassPosition = index < 8 ? index + 1 : index - 7;
    const classPosition = battleSwapped && index === 1 ? 3 : battleSwapped && index === 2 ? 2 : startingClassPosition;
    const base = 81.42 + index * 0.23;
    const gap = position === 1 ? 0 : Number(((position - 1) * 0.73 + Math.sin(tick / 9 + index) * 0.18).toFixed(3));
    const classGap = classPosition === 1 ? 0 : Number(((classPosition - 1) * 0.73 + Math.sin(tick / 9 + index) * 0.18).toFixed(3));
    const pit = index === 9 ? inferredPitFixture(tick) : index === 8 ? unknownPitFixture(tick) : null;
    return {
      carIdx: index,
      position,
      carNumber,
      name,
      team,
      className,
      interval: position === 1 ? null : gap,
      lastLap: base + Math.sin(tick / 7 + index) * 0.31,
      bestLap: base - 0.42 - (index % 3) * 0.04,
      lapsCompleted: completedLaps,
      onPitRoad: pit?.pitState === "pit-lane" || pit?.pitState === "pit-stall",
      incidents: index % 4,
      classId,
      classColor: classId === 1 ? "#ff4b2b" : "#1976d2",
      classPosition,
      gapToLeader: gap,
      intervalToAhead: position === 1 ? null : 0.73,
      classGapToLeader: classGap,
      classIntervalToAhead: classPosition === 1 ? null : 0.73,
      lapsBehindLeader: 0,
      lapsBehindClassLeader: 0,
      currentLap: completedLaps + 1,
      lastLapNumber: completedLaps,
      bestLapNumber: 12,
      lapDistPct: (tick / 90 + index / names.length) % 1,
      trackStatus: pit?.pitState === "pit-lane" || pit?.pitState === "pit-stall" ? "pit" : pit?.pitState === "unobserved" ? "not-in-world" : "running",
      pitState: pit?.pitState ?? "not-in-pits",
      latestPitVisit: pit?.visit ?? null,
      startingPosition: index + 1,
      startingClassPosition,
      positionChange: index + 1 - position,
      classPositionChange: startingClassPosition - classPosition,
      timingQuality: {
        lapDistPct: { source: "iracing", quality: "valid" },
        gapToLeader: { source: "derived", quality: "valid" },
        intervalToAhead: { source: "derived", quality: position === 1 ? "incomplete" : "valid" },
        classGapToLeader: { source: "derived", quality: "valid" },
        classIntervalToAhead: { source: "derived", quality: classPosition === 1 ? "incomplete" : "valid" },
        lastLap: { source: "iracing", quality: "valid" },
        bestLap: { source: "iracing", quality: "valid" },
      },
      isConnected: pit?.pitState !== "unobserved",
      userId: 10_000 + index,
      teamId: 20_000 + index,
      carId: 1,
      lastLapPosition: position,
      lastLapClassPosition: classPosition,
      lastLapGapToLeader: gap,
      lastLapGapToClassLeader: classGap,
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
      name: "Thursday Night Multiclass",
      type: "race",
      trackName: "Virginia International Raceway — Full Course",
      lap: 18 + Math.floor(tick / 90),
      totalLaps: 40,
      timeRemaining: null,
      flag: tick % 180 > 160 ? "yellow" : "green",
      timestamp: new Date().toISOString(),
      drivers: simulatedDrivers(tick),
      lapsCompleted: 18 + Math.floor(tick / 90),
      lapsRemaining: 22 - Math.floor(tick / 90),
      timeElapsed: tick,
      totalTime: null,
      phase: "racing",
      startState: "go",
      flags: tick % 180 > 160 ? ["caution"] : ["green"],
      classes: [
        { id: 1, name: "GT3", color: "#ff4b2b", carCount: 8 },
        { id: 2, name: "TCR", color: "#1976d2", carCount: 4 },
      ],
      source: "simulation",
      sourceMode: "simulation",
      externalSubSessionId: null,
      externalSessionNumber: null,
      trackId: null,
      weather: {
        condition: "partly-cloudy",
        airTemperatureC: 25.56,
        trackTemperatureC: 48.89,
        windSpeedMps: 3.58,
        windDirectionRadians: 5.89,
        relativeHumidityPercent: 30.38,
      },
      cameraGroups: [
        { number: 1, name: "TV 1", isScenic: false, cameras: [{ number: 0, name: "TV 1" }] },
        { number: 2, name: "TV 2", isScenic: false, cameras: [{ number: 0, name: "TV 2" }] },
        { number: 3, name: "TV 3", isScenic: false, cameras: [{ number: 0, name: "TV 3" }] },
        { number: 4, name: "Pit Lane", isScenic: false, cameras: [{ number: 0, name: "Pit Lane" }] },
        { number: 5, name: "Nose", isScenic: false, cameras: [{ number: 0, name: "Nose" }] },
        { number: 6, name: "Gearbox", isScenic: false, cameras: [{ number: 0, name: "Gearbox" }] },
        { number: 7, name: "Roll Bar", isScenic: false, cameras: [{ number: 0, name: "Roll Bar" }] },
      ],
      activeCameraCarIdx: 0,
      activeCameraGroup: 1,
      activeCamera: 0,
    };
    store.telemetry(session);
    onTelemetry(session);
  };
  emit();
  const timer = setInterval(emit, 1_000);
  return () => clearInterval(timer);
}
