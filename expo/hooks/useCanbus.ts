/**
 * useCanbus — live CANBus / OBD-II connection state for the partner UI.
 *
 * Picks an available transport (Wi-Fi / Bluetooth / USB), runs the ELM327
 * session client, and exposes a {@link CanConnectionState} the System Status
 * panel and the speed pill consume. When no real transport is available and
 * partner-side simulation is on, it falls back to the telemetry simulator —
 * reported honestly via `simulated: true`, never as a live vehicle link.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CanbusClient } from "@/utils/canbus/canbusClient";
import { RECONNECT_INTERVAL_MS, SIMULATOR_TRANSPORT_KIND } from "@/utils/canbus/config";
import { publishCanbusSession } from "@/utils/canbus/liveStatus";
import {
  createTransport,
  getTransportAvailability,
} from "@/utils/canbus/transports";
import { startSimulator, type Simulator } from "@/utils/canbus/simulator";
import {
  adapterTransportOptions,
  loadCanbusAdapters,
  loadSelectedAdapterId,
  markAdapterConnected,
  pickDefaultAdapter,
  type SavedCanAdapter,
} from "@/utils/canbusAdapterStore";
import type {
  CanConnectionState,
  CanTransportKind,
  TransportAvailability,
} from "@/utils/canbus/types";

const INITIAL_STATE: CanConnectionState = {
  phase: "idle",
  device: null,
  protocol: null,
  bitrateKbps: null,
  telemetry: {},
  lastUpdate: null,
  error: null,
  simulated: false,
};

export interface UseCanbusOptions {
  /** Attempt to connect automatically on mount. */
  autoConnect?: boolean;
  /** Allow the simulator fallback (gated by an admin sim flag upstream). */
  allowSimulator?: boolean;
  /**
   * Use the reader saved from Settings → OBD-II (CANBus) reader as the default
   * target (its transport and, for Wi-Fi, its endpoint). Set false to always
   * fall back to the first transport this build supports.
   */
  preferSavedAdapter?: boolean;
  /**
   * Only auto-connect when a reader has actually been set up. Without this, an
   * `autoConnect` mount with no saved reader blind-scans for the first ELM327 it
   * can find (and, for Bluetooth, holds the radio scanning) — which the meter /
   * Teksi console must not do: it should link the device the driver chose in
   * Settings, and nothing else. With the flag on and no reader saved, the hook
   * stays idle (or starts the simulator when Demo Mode is on) instead of
   * scanning. Ignored when `autoConnect` is false.
   */
  autoConnectSavedOnly?: boolean;
}

export interface ConnectOptions {
  /**
   * Saved reader to link with. Supplies the Wi-Fi host/port; when omitted the
   * hook uses the adapter selected in Settings (if any).
   */
  adapter?: SavedCanAdapter | null;
}

export interface UseCanbusResult {
  state: CanConnectionState;
  availability: TransportAvailability[];
  /** Transports this build can actually attempt right now. */
  availableTransports: CanTransportKind[];
  /** Readers saved on this device, newest-selected first. */
  savedAdapters: SavedCanAdapter[];
  /** The reader auto-connect targets, or null when none has been added. */
  defaultAdapter: SavedCanAdapter | null;
  /** Re-read the saved reader list (call after adding/removing one). */
  reloadAdapters: () => Promise<SavedCanAdapter[]>;
  connecting: boolean;
  connect: (kind?: CanTransportKind, options?: ConnectOptions) => Promise<void>;
  /** Explicit user-chosen Demo Mode — virtual data, honestly flagged as sim. */
  connectDemo: () => void;
  disconnect: () => Promise<void>;
  /**
   * Send a raw command on the open session and resolve with the adapter's
   * reply. Rejects when there is no live session (Demo Mode included — the
   * simulator has no adapter to talk to). Commands queue behind the telemetry
   * sweep, so this is safe to call at any time.
   */
  sendCommand: (command: string) => Promise<string>;
  /**
   * Suspend the 1 Hz telemetry sweep so a bulk read gets the adapter to
   * itself. Always pair with a `false` call — a paused sweep stays paused.
   */
  setPollingPaused: (paused: boolean) => void;
}

export function useCanbus(options: UseCanbusOptions = {}): UseCanbusResult {
  const {
    autoConnect = true,
    allowSimulator = false,
    preferSavedAdapter = true,
    autoConnectSavedOnly = false,
  } = options;
  const sourceId = useId();
  const [state, setState] = useState<CanConnectionState>(INITIAL_STATE);
  const [savedAdapters, setSavedAdapters] = useState<SavedCanAdapter[]>([]);
  const [defaultAdapter, setDefaultAdapter] = useState<SavedCanAdapter | null>(null);
  const clientRef = useRef<CanbusClient | null>(null);
  const simRef = useRef<Simulator | null>(null);
  const mountedRef = useRef(true);
  // Read inside connect() without making the callback depend on state, so the
  // identity of `connect` stays stable for callers that memoise on it.
  const defaultAdapterRef = useRef<SavedCanAdapter | null>(null);

  /* --- Auto-reconnect after a live link drops --- */

  // Latest state, read by the reconnect loop without depending on it.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // True while we want a real vehicle link kept up — set when a real connect is
  // attempted, cleared by an explicit disconnect or Demo Mode. The reconnect
  // loop stops the moment this is false.
  const wantLinkRef = useRef(false);
  // The target of the last real connect, replayed on reconnect so a dropped
  // Wi-Fi endpoint / saved reader comes back as itself.
  const lastConnectRef = useRef<{
    kind?: CanTransportKind;
    options?: ConnectOptions;
  } | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectingRef = useRef(false);
  // The link-lost handler, held by ref so `connect` (defined first) can wire the
  // CanbusClient to it without a declaration cycle.
  const linkLostRef = useRef<() => void>(() => {});

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const availability = useMemo(() => getTransportAvailability(), []);
  const availableTransports = useMemo(
    () => availability.filter((a) => a.available).map((a) => a.kind),
    [availability],
  );

  const patch = useCallback((p: Partial<CanConnectionState>) => {
    if (!mountedRef.current) return;
    setState((prev) => ({ ...prev, ...p }));
  }, []);

  const teardown = useCallback(async () => {
    simRef.current?.stop();
    simRef.current = null;
    const client = clientRef.current;
    clientRef.current = null;
    if (client) {
      try {
        await client.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const startSimulated = useCallback(() => {
    // Demo Mode is a deliberate choice, not a real link — stop chasing one.
    wantLinkRef.current = false;
    clearReconnect();
    void teardown();
    patch({
      phase: "online",
      simulated: true,
      error: null,
      device: {
        name: "Simulated adapter",
        id: "sim",
        transport: SIMULATOR_TRANSPORT_KIND,
      },
      protocol: "Simulated CAN (demo)",
      bitrateKbps: 500,
    });
    simRef.current = startSimulator((telemetry, at) =>
      patch({ telemetry, lastUpdate: at }),
    );
  }, [clearReconnect, patch, teardown]);

  const reloadAdapters = useCallback(async () => {
    const [list, selectedId] = await Promise.all([
      loadCanbusAdapters(),
      loadSelectedAdapterId(),
    ]);
    const preferred = pickDefaultAdapter(list, selectedId);
    defaultAdapterRef.current = preferred;
    if (mountedRef.current) {
      setSavedAdapters(list);
      setDefaultAdapter(preferred);
    }
    return list;
  }, []);

  const connect = useCallback(
    async (kind?: CanTransportKind, connectOptions?: ConnectOptions) => {
      await teardown();
      // An explicitly passed reader wins; otherwise fall back to the one saved
      // in Settings, but only when it matches the transport being attempted.
      const saved = preferSavedAdapter ? defaultAdapterRef.current : null;
      const adapter =
        connectOptions?.adapter ??
        (saved && (!kind || saved.transport === kind) ? saved : null);
      const target = kind ?? adapter?.transport ?? availableTransports[0];

      if (!target) {
        if (allowSimulator) {
          startSimulated();
        } else {
          patch({
            phase: "error",
            error: "No OBD adapter transport available on this build",
            simulated: false,
          });
        }
        return;
      }

      // A real transport is being attempted: remember it so a later drop can
      // reconnect to the same target, and arm the reconnect loop.
      wantLinkRef.current = true;
      lastConnectRef.current = { kind, options: connectOptions };

      patch({ phase: "connecting", error: null, simulated: false });
      try {
        const transport = createTransport(target, adapterTransportOptions(adapter));
        const device = await transport.connect();
        if (!mountedRef.current) {
          await transport.disconnect();
          return;
        }
        patch({ phase: "handshaking", device });

        const client = new CanbusClient(transport, {
          onTelemetry: (telemetry, at) => patch({ telemetry, lastUpdate: at }),
          onProtocol: (protocol, bitrateKbps) =>
            patch({ protocol, bitrateKbps, phase: "online" }),
          onError: (message) => patch({ error: message }),
          // The adapter stopped answering a session that was live — tear it down
          // and reconnect rather than keep reporting `online` while every
          // command times out.
          onLinkLost: () => linkLostRef.current(),
        });
        clientRef.current = client;
        await client.start();
        patch({ phase: "online" });
        if (adapter) {
          void markAdapterConnected(adapter.id).then((list) => {
            if (mountedRef.current) setSavedAdapters(list);
          });
        }
      } catch (e: any) {
        await teardown();
        if (allowSimulator) {
          startSimulated();
        } else {
          patch({
            phase: "error",
            error: e?.message ?? "Failed to connect to OBD adapter",
          });
        }
      }
    },
    [
      allowSimulator,
      availableTransports,
      patch,
      preferSavedAdapter,
      startSimulated,
      teardown,
    ],
  );

  /**
   * Try the last real target again, and keep trying on an interval until it
   * comes back or the intent is dropped.
   *
   * `connect` does the teardown and the state transitions; this only decides
   * whether to try once more. A single attempt at a time (`reconnectingRef`),
   * and never once `wantLinkRef` has been cleared by a disconnect / Demo Mode.
   */
  const attemptReconnect = useCallback(async () => {
    clearReconnect();
    if (reconnectingRef.current) return;
    if (!mountedRef.current || !wantLinkRef.current) return;
    reconnectingRef.current = true;
    try {
      const args = lastConnectRef.current ?? undefined;
      await connect(args?.kind, args?.options);
    } finally {
      reconnectingRef.current = false;
    }
    if (!mountedRef.current || !wantLinkRef.current) return;
    // Back online — stop. Otherwise (Bluetooth still off, reader still gone)
    // wait out the interval and try again.
    if (stateRef.current.phase === "online") return;
    reconnectTimerRef.current = setTimeout(() => {
      void attemptReconnect();
    }, RECONNECT_INTERVAL_MS);
  }, [clearReconnect, connect]);

  /**
   * A live link dropped (`CanbusClient.onLinkLost`): stop the dead session
   * reporting `online` and start reconnecting. Billing and the odometer gate
   * key off `phase === "online"`, so flipping to `connecting` here is what makes
   * a hire fall back to GPS (or wait for the reader, per the rate card) instead
   * of stalling on an odometer read the vanished adapter can never answer.
   */
  const handleLinkLost = useCallback(() => {
    if (!mountedRef.current) return;
    wantLinkRef.current = true;
    void teardown();
    patch({
      phase: "connecting",
      error: "Reader disconnected — reconnecting…",
      telemetry: {},
      lastUpdate: null,
      device: null,
      protocol: null,
      bitrateKbps: null,
      simulated: false,
    });
    void attemptReconnect();
  }, [attemptReconnect, patch, teardown]);

  // Keep the ref the CanbusClient calls pointed at the latest handler.
  linkLostRef.current = handleLinkLost;

  const disconnect = useCallback(async () => {
    // A deliberate disconnect ends the intent to hold a link — stop reconnecting.
    wantLinkRef.current = false;
    clearReconnect();
    await teardown();
    patch({ ...INITIAL_STATE });
  }, [clearReconnect, patch, teardown]);

  const sendCommand = useCallback(async (command: string) => {
    const client = clientRef.current;
    if (!client || !client.active) {
      throw new Error("No OBD-II session is open");
    }
    return client.request(command);
  }, []);

  const setPollingPaused = useCallback((paused: boolean) => {
    clientRef.current?.setPollingPaused(paused);
  }, []);

  // Broadcast this session so read-only consumers (the side menu) can tell the
  // reader is linked, and screens like Vehicle Information can borrow the open
  // link, without opening a competing connection of their own.
  useEffect(() => {
    publishCanbusSession(sourceId, { state, sendCommand, setPollingPaused });
  }, [sourceId, state, sendCommand, setPollingPaused]);

  useEffect(() => {
    return () => {
      publishCanbusSession(sourceId, null);
    };
  }, [sourceId]);

  useEffect(() => {
    mountedRef.current = true;
    // Load the saved reader first so auto-connect targets it (and its Wi-Fi
    // endpoint) instead of blindly picking the first supported transport.
    void reloadAdapters().finally(() => {
      if (!mountedRef.current || !autoConnect) return;
      // With `autoConnectSavedOnly`, never blind-scan on mount: connect only to
      // the reader the driver actually set up. With none set, stay idle (or run
      // the simulator when Demo Mode is on) rather than reaching for any device.
      if (autoConnectSavedOnly && !defaultAdapterRef.current) {
        if (allowSimulator) startSimulated();
        return;
      }
      if (availableTransports.length > 0) {
        void connect();
      } else if (allowSimulator) {
        startSimulated();
      }
    });
    return () => {
      mountedRef.current = false;
      wantLinkRef.current = false;
      clearReconnect();
      void teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connecting =
    state.phase === "connecting" ||
    state.phase === "handshaking" ||
    state.phase === "scanning";

  return {
    state,
    availability,
    availableTransports,
    savedAdapters,
    defaultAdapter,
    reloadAdapters,
    connecting,
    connect,
    connectDemo: startSimulated,
    disconnect,
    sendCommand,
    setPollingPaused,
  };
}
