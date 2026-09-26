import type { LiveState } from "./index.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type StateChange = { path: string[]; value: JsonValue } | { path: string[]; remove: true };
export interface ViewerState {
  revision: number;
  live: JsonValue;
  history: JsonValue;
}
export type ViewerStateMessage =
  | { type: "state.init"; payload: ViewerState }
  | { type: "state.delta"; baseRevision: number; revision: number; live: StateChange[]; history?: StateChange[] };

/** Keep historical data separate and avoid sending the active session twice. */
export function viewerState(state: LiveState): ViewerState {
  const { revision, sessionResults, events, raceEvents, ...live } = state;
  const results = { ...sessionResults };
  if (state.session) delete results[state.session.type];
  return JSON.parse(JSON.stringify({ revision, live, history: { sessionResults: results, events, raceEvents } })) as ViewerState;
}

export function diffState(before: JsonValue, after: JsonValue, path: string[] = []): StateChange[] {
  if (before === after) return [];
  if (before === null || after === null || typeof before !== "object" || typeof after !== "object"
    || Array.isArray(before) !== Array.isArray(after)
    || (Array.isArray(before) && Array.isArray(after) && before.length !== after.length)) {
    return [{ path, value: after }];
  }
  const old = before as Record<string, JsonValue>;
  const next = after as Record<string, JsonValue>;
  return [
    ...Object.keys(old).filter((key) => !Object.hasOwn(next, key)).map((key): StateChange => ({ path: [...path, key], remove: true })),
    ...Object.keys(next).flatMap((key): StateChange[] => Object.hasOwn(old, key)
      ? diffState(old[key], next[key], [...path, key]) : [{ path: [...path, key], value: next[key] }]),
  ];
}

export function applyStateChanges(value: JsonValue, changes: StateChange[]): JsonValue {
  let result = structuredClone(value);
  for (const change of changes) {
    if (change.path.some((key) => ["__proto__", "constructor", "prototype"].includes(key))) throw new Error("Invalid state path");
    if (!change.path.length) {
      if ("remove" in change) throw new Error("Cannot remove state root");
      result = structuredClone(change.value);
      continue;
    }
    let target = result as Record<string, JsonValue>;
    for (const key of change.path.slice(0, -1)) {
      if (!target || typeof target !== "object" || !Object.hasOwn(target, key)) throw new Error("Missing state path");
      target = target[key] as Record<string, JsonValue>;
    }
    const key = change.path.at(-1)!;
    if ("remove" in change) delete target[key];
    else target[key] = structuredClone(change.value);
  }
  return result;
}

export function receiveViewerState(current: ViewerState | null, message: ViewerStateMessage): ViewerState {
  if (message.type === "state.init") return message.payload;
  if (!current || current.revision !== message.baseRevision) throw new Error("Viewer state is out of sync");
  return {
    revision: message.revision,
    live: applyStateChanges(current.live, message.live),
    history: message.history ? applyStateChanges(current.history, message.history) : current.history,
  };
}

export function liveStateFromViewer(state: ViewerState): LiveState {
  const restored = { ...(state.live as object), ...(state.history as object), revision: state.revision } as LiveState;
  restored.sessionResults = { ...restored.sessionResults };
  if (restored.session) restored.sessionResults[restored.session.type] = restored.session;
  return restored;
}
