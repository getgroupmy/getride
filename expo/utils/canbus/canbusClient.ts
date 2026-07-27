/**
 * ELM327 session client.
 *
 * Drives an already-opened {@link CanTransport}: runs the init handshake,
 * detects the CAN protocol, then polls the configured PIDs on an interval and
 * emits decoded telemetry. Transport-blind — works over Wi-Fi, BLE, or USB.
 */

import {
  COMMAND_TIMEOUT_MS,
  POLL_INTERVAL_MS,
} from "./config";
import {
  ELM_DESCRIBE_PROTOCOL,
  ELM_INIT_COMMANDS,
  ELM_PROMPT,
  OBD_PIDS,
  buildPidCommand,
  cleanElmResponse,
  decodePidResponse,
  describeProtocol,
  isElmSearching,
} from "./obd";
import type { CanTransport } from "./types";
import type { Telemetry } from "./obd";

export interface CanbusClientEvents {
  onTelemetry?: (telemetry: Telemetry, at: number) => void;
  onProtocol?: (name: string, bitrateKbps: number | null) => void;
  onError?: (message: string) => void;
}

export class CanbusClient {
  private buffer = "";
  private waiter: ((response: string) => void) | null = null;
  private unsub: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private transport: CanTransport,
    private events: CanbusClientEvents = {},
  ) {}

  /** Run the ELM327 init sequence and start polling. */
  async start(): Promise<void> {
    this.unsub = this.transport.onData((chunk) => this.ingest(chunk));

    for (const cmd of ELM_INIT_COMMANDS) {
      await this.command(cmd);
    }

    // Ask which protocol the adapter negotiated with the ECU.
    try {
      const dpn = await this.command(ELM_DESCRIBE_PROTOCOL);
      const num = cleanElmResponse(dpn)[0] ?? null;
      const { name, bitrateKbps } = describeProtocol(num);
      this.events.onProtocol?.(name, bitrateKbps);
    } catch {
      /* protocol description is best-effort */
    }

    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, POLL_INTERVAL_MS);
    // Kick an immediate first sweep so the panel populates without waiting.
    void this.pollOnce();
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped) return;
    const telemetry: Telemetry = {};
    let any = false;
    for (const key of Object.keys(OBD_PIDS) as (keyof typeof OBD_PIDS)[]) {
      if (this.stopped) return;
      const pid = OBD_PIDS[key];
      try {
        const raw = await this.command(buildPidCommand(pid));
        const decoded = decodePidResponse(raw, pid);
        if (decoded) {
          telemetry[key] = decoded.value;
          any = true;
        }
      } catch {
        // A single PID timing out shouldn't abort the whole sweep.
      }
    }
    if (any) this.events.onTelemetry?.(telemetry, Date.now());
  }

  /** Send a command and resolve with the raw response up to the prompt. */
  private command(cmd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (this.stopped) {
        reject(new Error("client stopped"));
        return;
      }
      this.buffer = "";
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error(`"${cmd}" timed out`));
      }, COMMAND_TIMEOUT_MS);

      this.waiter = (response: string) => {
        // Ignore the transient "SEARCHING..." heartbeat; keep waiting for the
        // real frame that follows it before the prompt.
        if (isElmSearching(response) && !response.includes(ELM_PROMPT)) {
          return;
        }
        clearTimeout(timer);
        this.waiter = null;
        resolve(response);
      };

      this.transport.write(cmd).catch((e) => {
        clearTimeout(timer);
        this.waiter = null;
        reject(e);
      });
    });
  }

  /** Accumulate inbound bytes; a response ends at the ELM327 prompt char. */
  private ingest(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.includes(ELM_PROMPT) && this.waiter) {
      const response = this.buffer;
      this.buffer = "";
      this.waiter(response);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.unsub?.();
    this.unsub = null;
    this.waiter = null;
    await this.transport.disconnect();
  }
}
