/**
 * A live OBD-II session must notice when the adapter stops answering — the
 * driver turns Bluetooth off, unplugs the dongle, or drives out of range — and
 * say so, rather than keep reporting `online` while every command times out.
 * That phantom-online state is what blocked a hire: the meter's odometer gate
 * saw a "live reader", asked for PID A6, and waited on an answer that could
 * never come.
 *
 * `CanbusClient` reports it through `onLinkLost` after a run of unanswered
 * commands on a session that had come up. A reply of any kind — including the
 * "NO DATA" an ELM327 gives for an unsupported PID — proves the adapter is
 * still there and clears the count; only genuine silence trips it.
 */

import { CanbusClient } from "@/utils/canbus/canbusClient";
import { LINK_LOST_FAILURES } from "@/utils/canbus/config";
import { ELM_PROMPT } from "@/utils/canbus/obd";
import type { CanDeviceInfo, CanTransport } from "@/utils/canbus/types";

/**
 * A transport whose replies we switch on and off. When `respond` is true a
 * write echoes a prompt-terminated frame (so the command resolves); when false
 * the write rejects, standing in for an adapter that has gone silent.
 */
class MockTransport implements CanTransport {
  readonly kind = "wifi" as const;
  device: CanDeviceInfo | null = null;
  respond = true;
  /** The frame delivered on a write while `respond` is true. */
  reply = `41 00 00 00 00 00${ELM_PROMPT}`;
  private listener: ((chunk: string) => void) | null = null;

  onData(listener: (chunk: string) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  async connect(): Promise<CanDeviceInfo> {
    this.device = { name: "mock", id: "mock", transport: "wifi" };
    return this.device;
  }

  async disconnect(): Promise<void> {
    this.device = null;
  }

  async write(): Promise<void> {
    if (!this.respond) throw new Error("write failed — link down");
    // Deliver the response on a later microtask, like a real inbound chunk.
    void Promise.resolve().then(() => this.listener?.(this.reply));
  }
}

/** Let the queued microtasks (responses, the tail chain) drain. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

describe("CanbusClient link-loss detection", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function startLiveClient(onLinkLost: () => void) {
    const transport = new MockTransport();
    const client = new CanbusClient(transport, { onLinkLost });
    await client.start();
    await flush();
    return { transport, client };
  }

  it("reports the link lost after a run of unanswered commands", async () => {
    const onLinkLost = jest.fn();
    const { transport, client } = await startLiveClient(onLinkLost);

    transport.respond = false;
    for (let i = 0; i < LINK_LOST_FAILURES - 1; i += 1) {
      await client.request("01A6").catch(() => {});
    }
    expect(onLinkLost).not.toHaveBeenCalled();

    await client.request("01A6").catch(() => {});
    expect(onLinkLost).toHaveBeenCalledTimes(1);

    await client.stop();
  });

  it("fires onLinkLost only once, however long the adapter stays silent", async () => {
    const onLinkLost = jest.fn();
    const { transport, client } = await startLiveClient(onLinkLost);

    transport.respond = false;
    for (let i = 0; i < LINK_LOST_FAILURES + 3; i += 1) {
      await client.request("01A6").catch(() => {});
    }
    expect(onLinkLost).toHaveBeenCalledTimes(1);

    await client.stop();
  });

  it("does not report a lost link when a reply lands between failures", async () => {
    const onLinkLost = jest.fn();
    const { transport, client } = await startLiveClient(onLinkLost);

    // Two silent commands, then one that answers, then two more silent ones:
    // the reply resets the run, so the threshold is never reached.
    transport.respond = false;
    await client.request("01A6").catch(() => {});
    await client.request("01A6").catch(() => {});

    transport.respond = true;
    await client.request("01A6").catch(() => {});

    transport.respond = false;
    await client.request("01A6").catch(() => {});
    await client.request("01A6").catch(() => {});

    expect(onLinkLost).not.toHaveBeenCalled();
    await client.stop();
  });

  it("treats a failure during the handshake as a failed connect, not a lost link", async () => {
    const onLinkLost = jest.fn();
    const transport = new MockTransport();
    transport.respond = false; // dead from the very first init command
    const client = new CanbusClient(transport, { onLinkLost });

    await expect(client.start()).rejects.toBeTruthy();
    await flush();

    // The session never went live, so the caller owns the failure — the link
    // was never up to be "lost".
    expect(onLinkLost).not.toHaveBeenCalled();
    await client.stop();
  });
});
