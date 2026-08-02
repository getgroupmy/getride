/**
 * Shared registry of open OBD-II sessions.
 *
 * Two things need this. The side menu has to know whether the vehicle link is
 * up so it can reveal the Vehicle Information row — but it must not *open* a
 * link to find out. And Vehicle Information itself has to talk to the adapter
 * without opening a second one: every `useCanbus` mount owns a real transport,
 * so a second session would race the first for the same dongle (a Wi-Fi dongle
 * accepts one socket; a BLE peripheral one central).
 *
 * So `useCanbus` publishes its session here, read-only consumers subscribe for
 * the status (`hooks/useCanbusStatus.ts`) and Vehicle Information borrows the
 * live session's command channel. Several screens can be mounted at once — the
 * Teksi screen behind a pushed Meter Digital, for instance — so the registry is
 * keyed by source and collapsed to a single answer by the pure
 * `summarizeCanbusStates`.
 */

import type { CanConnectionState, CanTransportKind } from "./types";

/** A live session, as borrowed by screens that do not own the connection. */
export interface CanbusSession {
  state: CanConnectionState;
  /** Send a raw command on the open link; rejects if it has since closed. */
  sendCommand: (command: string) => Promise<string>;
  /** Suspend the owner's 1 Hz telemetry sweep during a bulk read. */
  setPollingPaused: (paused: boolean) => void;
}

/** The collapsed view of every live session, as consumers see it. */
export interface CanbusLiveStatus {
  /** A session has completed its handshake and is polling. */
  online: boolean;
  /** That session is the built-in simulator, not a real vehicle. */
  simulated: boolean;
  /** True only for a real dongle on a real vehicle. */
  linked: boolean;
  deviceName: string | null;
  transport: CanTransportKind | null;
}

export const IDLE_CANBUS_STATUS: CanbusLiveStatus = {
  online: false,
  simulated: false,
  linked: false,
  deviceName: null,
  transport: null,
};

/**
 * Collapse every registered session into one status.
 *
 * A real link always wins over a simulated one, so a driver running Demo Mode
 * on one screen while a dongle is genuinely connected on another sees the
 * honest answer.
 */
export function summarizeCanbusStates(
  states: (CanConnectionState | null | undefined)[],
): CanbusLiveStatus {
  const online = states.filter((s): s is CanConnectionState => !!s && s.phase === "online");
  if (online.length === 0) return IDLE_CANBUS_STATUS;
  const real = online.find((s) => !s.simulated);
  const chosen = real ?? online[0];
  return {
    online: true,
    simulated: !real,
    linked: !!real,
    deviceName: chosen.device?.name ?? null,
    transport: chosen.device?.transport ?? null,
  };
}

/**
 * Pick the session a borrower should use: a real link first, a simulated one
 * only if that is all there is, and null when nothing has finished connecting.
 */
export function pickActiveSession(sessions: CanbusSession[]): CanbusSession | null {
  const online = sessions.filter((s) => s.state.phase === "online");
  if (online.length === 0) return null;
  return online.find((s) => !s.state.simulated) ?? online[0];
}

/** True when two statuses are interchangeable — keeps subscribers from re-rendering. */
export function canbusStatusEquals(a: CanbusLiveStatus, b: CanbusLiveStatus): boolean {
  return (
    a.online === b.online &&
    a.simulated === b.simulated &&
    a.linked === b.linked &&
    a.deviceName === b.deviceName &&
    a.transport === b.transport
  );
}

const sources = new Map<string, CanbusSession>();
const listeners = new Set<(status: CanbusLiveStatus) => void>();
let current: CanbusLiveStatus = IDLE_CANBUS_STATUS;

function recompute(): void {
  const next = summarizeCanbusStates([...sources.values()].map((s) => s.state));
  if (canbusStatusEquals(next, current)) return;
  current = next;
  listeners.forEach((fn) => fn(current));
}

/** Publish (or, with a null session, withdraw) one screen's OBD-II session. */
export function publishCanbusSession(sourceId: string, session: CanbusSession | null): void {
  if (session) sources.set(sourceId, session);
  else sources.delete(sourceId);
  recompute();
}

export function getCanbusLiveStatus(): CanbusLiveStatus {
  return current;
}

/**
 * The session a screen without its own connection should borrow, or null.
 * Read it inside the handler that needs it rather than caching — the owning
 * screen can disconnect at any moment.
 */
export function getActiveCanbusSession(): CanbusSession | null {
  return pickActiveSession([...sources.values()]);
}

export function subscribeCanbusLiveStatus(
  listener: (status: CanbusLiveStatus) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hook — drops every registered session. */
export function resetCanbusSessions(): void {
  sources.clear();
  current = IDLE_CANBUS_STATUS;
  listeners.forEach((fn) => fn(current));
}
