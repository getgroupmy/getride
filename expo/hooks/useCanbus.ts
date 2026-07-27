/**
 * useCanbus — live CANBus / OBD-II connection state for the partner UI.
 *
 * Picks an available transport (Wi-Fi / Bluetooth / USB), runs the ELM327
 * session client, and exposes a {@link CanConnectionState} the System Status
 * panel and the speed pill consume. When no real transport is available and
 * partner-side simulation is on, it falls back to the telemetry simulator —
 * reported honestly via `simulated: true`, never as a live vehicle link.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanbusClient } from "@/utils/canbus/canbusClient";
import { SIMULATOR_TRANSPORT_KIND } from "@/utils/canbus/config";
import {
  createTransport,
  getTransportAvailability,
} from "@/utils/canbus/transports";
import { startSimulator, type Simulator } from "@/utils/canbus/simulator";
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
}

export interface UseCanbusResult {
  state: CanConnectionState;
  availability: TransportAvailability[];
  /** Transports this build can actually attempt right now. */
  availableTransports: CanTransportKind[];
  connecting: boolean;
  connect: (kind?: CanTransportKind) => Promise<void>;
  /** Explicit user-chosen Demo Mode — virtual data, honestly flagged as sim. */
  connectDemo: () => void;
  disconnect: () => Promise<void>;
}

export function useCanbus(options: UseCanbusOptions = {}): UseCanbusResult {
  const { autoConnect = true, allowSimulator = false } = options;
  const [state, setState] = useState<CanConnectionState>(INITIAL_STATE);
  const clientRef = useRef<CanbusClient | null>(null);
  const simRef = useRef<Simulator | null>(null);
  const mountedRef = useRef(true);

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
  }, [patch, teardown]);

  const connect = useCallback(
    async (kind?: CanTransportKind) => {
      await teardown();
      const target = kind ?? availableTransports[0];

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

      patch({ phase: "connecting", error: null, simulated: false });
      try {
        const transport = createTransport(target);
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
        });
        clientRef.current = client;
        await client.start();
        patch({ phase: "online" });
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
    [allowSimulator, availableTransports, patch, startSimulated, teardown],
  );

  const disconnect = useCallback(async () => {
    await teardown();
    patch({ ...INITIAL_STATE });
  }, [patch, teardown]);

  useEffect(() => {
    mountedRef.current = true;
    if (autoConnect) {
      if (availableTransports.length > 0) {
        void connect();
      } else if (allowSimulator) {
        startSimulated();
      }
    }
    return () => {
      mountedRef.current = false;
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
    connecting,
    connect,
    connectDemo: startSimulated,
    disconnect,
  };
}
