import { act, render, screen, userEvent, waitFor } from "@testing-library/react-native";
import React from "react";

import IncomingTransferPopup from "@/components/IncomingTransferPopup";
import type { WalletTransferRequest } from "@/utils/transferRequestsStore";

/**
 * The incoming-coin prompt.
 *
 * It is mounted globally and sits over the whole app, so its failure modes are
 * more consequential than its happy path: a request that cannot be answered
 * must not trap the user, and a lapsed request must not offer an Accept the
 * server will refuse.
 */

const mockApply = jest.fn();
const mockRefresh = jest.fn();

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ authState: { userId: "me", profileName: "Me", phone: null } }),
}));

jest.mock("@/contexts/WalletContext", () => ({
  useWallet: () => ({ apply: mockApply, refresh: mockRefresh }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    text: "#000",
    textSecondary: "#333",
    subtext: "#666",
    card: "#fff",
    border: "#ccc",
    primary: "#00f",
    onAccent: "#fff",
    error: "#f00",
  }),
}));

const mockFetchPending = jest.fn();
const mockRespond = jest.fn();
const mockSubscribe = jest.fn();

jest.mock("@/utils/transferRequestsStore", () => ({
  fetchPendingIncomingRequests: (...a: unknown[]) => mockFetchPending(...a),
  respondToTransferRequest: (...a: unknown[]) => mockRespond(...a),
  subscribeIncomingTransferRequests: (...a: unknown[]) => mockSubscribe(...a),
  // The real predicate is pure and tested elsewhere; reuse its behaviour here
  // rather than stubbing it, so an expiry test exercises the real rule.
  isRequestExpired: (req: { expiresAt: string }, now = Date.now()) =>
    Date.parse(req.expiresAt) <= now,
}));

const request = (over: Partial<WalletTransferRequest> = {}): WalletTransferRequest => ({
  id: "req-1",
  fromUserId: "them",
  fromName: "Aisha",
  toUserId: "me",
  toName: "Me",
  coins: 12.5,
  note: null,
  status: "pending",
  createdAt: new Date().toISOString(),
  respondedAt: null,
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchPending.mockResolvedValue([]);
  mockSubscribe.mockReturnValue(() => {});
  mockRespond.mockResolvedValue({ ok: true, status: "accepted", balances: undefined });
});

describe("IncomingTransferPopup", () => {
  it("renders nothing when there is no pending request", async () => {
    render(<IncomingTransferPopup />);
    await waitFor(() => expect(mockFetchPending).toHaveBeenCalledWith("me"));
    expect(screen.queryByText("Incoming GET.coin")).toBeNull();
  });

  it("names the sender and the amount, so the user knows what they are accepting", async () => {
    mockFetchPending.mockResolvedValue([request()]);
    render(<IncomingTransferPopup />);

    expect(await screen.findByText("Incoming GET.coin")).toBeTruthy();
    expect(screen.getByText("12.50 GC")).toBeTruthy();
    expect(screen.getByText("from Aisha")).toBeTruthy();
  });

  it("accepts, and applies the balances the server returned", async () => {
    const balances = { getWallet: 1, getCredit: 2, getCoin: 3, currency: "RM", source: "supabase" };
    mockFetchPending.mockResolvedValue([request()]);
    mockRespond.mockResolvedValue({ ok: true, status: "accepted", balances });

    render(<IncomingTransferPopup />);
    const user = userEvent.setup();
    await user.press(await screen.findByLabelText("Accept coins"));

    await waitFor(() =>
      expect(mockRespond).toHaveBeenCalledWith({ requestId: "req-1", userId: "me", accept: true })
    );
    expect(mockApply).toHaveBeenCalledWith(balances);
    // Answered, so it leaves the screen.
    await waitFor(() => expect(screen.queryByText("Incoming GET.coin")).toBeNull());
  });

  it("declines without moving coins", async () => {
    mockFetchPending.mockResolvedValue([request()]);
    mockRespond.mockResolvedValue({ ok: true, status: "declined" });

    render(<IncomingTransferPopup />);
    const user = userEvent.setup();
    await user.press(await screen.findByLabelText("Decline coins"));

    await waitFor(() =>
      expect(mockRespond).toHaveBeenCalledWith({ requestId: "req-1", userId: "me", accept: false })
    );
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("refetches balances when an accept succeeds but returns none", async () => {
    mockFetchPending.mockResolvedValue([request()]);
    mockRespond.mockResolvedValue({ ok: true, status: "accepted", balances: undefined });

    render(<IncomingTransferPopup />);
    const user = userEvent.setup();
    await user.press(await screen.findByLabelText("Accept coins"));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("dequeues a failed response rather than wedging the modal over the app", async () => {
    mockFetchPending.mockResolvedValue([request()]);
    mockRespond.mockResolvedValue({ ok: false, error: "network" });

    render(<IncomingTransferPopup />);
    const user = userEvent.setup();
    await user.press(await screen.findByLabelText("Accept coins"));

    // The request is answered whatever the server said — otherwise a failure
    // leaves a full-screen modal the user cannot get past.
    await waitFor(() => expect(screen.queryByText("Incoming GET.coin")).toBeNull());
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("ignores a request that has already lapsed", async () => {
    mockFetchPending.mockResolvedValue([
      request({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    ]);
    render(<IncomingTransferPopup />);

    await waitFor(() => expect(mockFetchPending).toHaveBeenCalled());
    expect(screen.queryByText("Incoming GET.coin")).toBeNull();
  });

  it("shows how many others are waiting when several arrive", async () => {
    mockFetchPending.mockResolvedValue([
      request({ id: "a" }),
      request({ id: "b" }),
      request({ id: "c" }),
    ]);
    render(<IncomingTransferPopup />);

    expect(await screen.findByText("2 more waiting")).toBeTruthy();
  });

  it("surfaces a request that arrives live, not just ones present at mount", async () => {
    let push: ((r: WalletTransferRequest) => void) | null = null;
    mockSubscribe.mockImplementation((_uid: string, onRequest: (r: WalletTransferRequest) => void) => {
      push = onRequest;
      return () => {};
    });

    render(<IncomingTransferPopup />);
    await waitFor(() => expect(push).not.toBeNull());

    await act(async () => {
      push!(request({ id: "live", coins: 5, fromName: "Ben" }));
    });

    expect(await screen.findByText("5.00 GC")).toBeTruthy();
    expect(screen.getByText("from Ben")).toBeTruthy();
  });

  it("does not subscribe or fetch when nobody is signed in", async () => {
    const auth = jest.requireMock("@/contexts/AuthContext");
    const original = auth.useAuth;
    auth.useAuth = () => ({ authState: { userId: null, profileName: null, phone: null } });

    render(<IncomingTransferPopup />);
    await waitFor(() => expect(mockFetchPending).not.toHaveBeenCalled());
    expect(mockSubscribe).not.toHaveBeenCalled();

    auth.useAuth = original;
  });
});
