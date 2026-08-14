/**
 * ELM327 session client.
 *
 * Drives an already-opened {@link CanTransport}: runs the init handshake,
 * detects the CAN protocol, then polls the configured PIDs on an interval and
 * emits decoded telemetry. Transport-blind — works over Wi-Fi, BLE, or USB.
 */

import {
  COMMAND_TIMEOUT_MS,
  LINK_LOST_FAILURES,
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
  /**
   * The adapter has stopped answering entirely on a session that was live —
   * Bluetooth switched off, the dongle unplugged, the car out of range. Fires
   * once (never during the initial handshake, which `start()`'s caller already
   * handles) so the owner can tear the dead session down and reconnect rather
   * than leave a session reporting `online` while every command times out.
   */
  onLinkLost?: () => void;
}

export class CanbusClient {
  private buffer = "";
  private waiter: ((response: string) => void) | null = null;
  private unsub: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /**
   * An ELM327 answers one command at a time and the response is matched purely
   * by arrival order, so every command — the poll sweep's and any the UI sends
   * through `request` — is chained onto this tail rather than issued
   * concurrently. Two in flight at once would swap each other's replies.
   */
  private tail: Promise<unknown> = Promise.resolve();
  /** A sweep is mid-flight — the next tick is skipped rather than stacked. */
  private polling = false;
  /** Telemetry sweeps are suspended (see {@link setPollingPaused}). */
  private paused = false;
  /**
   * True once the handshake has finished and polling has begun. Command
   * failures only count toward a lost link after this point — a failure during
   * the initial handshake is a *failed connect*, which `start()`'s caller
   * handles, not a live link that dropped.
   */
  private live = false;
  /** Consecutive unanswered commands on a live session; reset by any reply. */
  private failures = 0;
  /** `onLinkLost` fires at most once per client instance. */
  private linkLostReported = false;

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

    // The handshake succeeded, so from here a run of unanswered commands means
    // a live link that dropped rather than a connect that never came up.
    this.live = true;
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, POLL_INTERVAL_MS);
    // Kick an immediate first sweep so the panel populates without waiting.
    void this.pollOnce();
  }

  /** A command came back — the adapter is answering, so the link is healthy. */
  private noteReply(): void {
    this.failures = 0;
  }

  /**
   * A command went unanswered (timed out, or the write threw). On a live
   * session a sustained run of these means the adapter has gone; report it once
   * so the owner can reconnect. A "NO DATA" reply is *not* a failure — it
   * arrived, so it resets the counter through {@link noteReply} instead.
   */
  private noteFailure(): void {
    if (!this.live || this.stopped || this.linkLostReported) return;
    this.failures += 1;
    if (this.failures >= LINK_LOST_FAILURES) {
      this.linkLostReported = true;
      this.events.onLinkLost?.();
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped || this.paused || this.polling) return;
    this.polling = true;
    try {
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
    } finally {
      this.polling = false;
    }
  }

  /**
   * Suspend/resume the telemetry sweep.
   *
   * A bulk read (the Vehicle Information scan walks every PID the vehicle
   * supports) shares the same single-command-at-a-time adapter, so letting the
   * 1 Hz sweep interleave would roughly double how long it takes. Pausing is
   * safe: the sweep resumes from the next tick, and the live state simply goes
   * stale in the meantime.
   */
  setPollingPaused(paused: boolean): void {
    this.paused = paused;
  }

  /**
   * Send an arbitrary command to the adapter and resolve with its raw reply.
   *
   * The public escape hatch used by the Vehicle Information screen to read the
   * PIDs the poll loop does not cover and to issue writes. It queues behind
   * whatever the poll sweep is doing, so it is safe to call at any time.
   */
  request(cmd: string): Promise<string> {
    return this.command(cmd);
  }

  /** Is this session still usable? */
  get active(): boolean {
    return !this.stopped;
  }

  /** Send a command and resolve with the raw response up to the prompt. */
  private command(cmd: string): Promise<string> {
    const run = this.tail.then(
      () => this.sendNow(cmd),
      () => this.sendNow(cmd),
    );
    // Keep the chain alive after a rejection so one timeout doesn't poison
    // every later command.
    this.tail = run.catch(() => undefined);
    return run;
  }

  private sendNow(cmd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (this.stopped) {
        reject(new Error("client stopped"));
        return;
      }
      this.buffer = "";
      const timer = setTimeout(() => {
        this.waiter = null;
        // Silence from the adapter — the signal a dropped link is detected on.
        this.noteFailure();
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
        // A reply of any kind (even "NO DATA") means the adapter is alive.
        this.noteReply();
        resolve(response);
      };

      this.transport.write(cmd).catch((e) => {
        clearTimeout(timer);
        this.waiter = null;
        this.noteFailure();
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
    this.live = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.unsub?.();
    this.unsub = null;
    this.waiter = null;
    await this.transport.disconnect();
  }
}
