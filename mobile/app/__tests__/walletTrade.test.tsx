import { act, render, waitFor } from "@testing-library/react-native";
import React from "react";

/**
 * Coin trading.
 *
 * The guards here are the point. A buy larger than the wallet, or a sell larger
 * than the coin balance, must be refused before it reaches the RPC — and the
 * rate and supply cap the trade executes against must be the ones the screen
 * actually resolved, not defaults it fell back to silently.
 */

const balances = { getWallet: 100, getCredit: 0, getCoin: 50, currency: "RM", source: "supabase" };
const mockApply = jest.fn();

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ authState: { userId: "u1", profileName: "U", phone: null } }),
}));

jest.mock("@/contexts/WalletContext", () => ({
  useWallet: () => ({ balances, apply: mockApply, refresh: jest.fn(), isLoading: false }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff", card: "#eee", border: "#ccc", text: "#000",
    textSecondary: "#333", subtext: "#666", primary: "#00f", onAccent: "#fff",
    error: "#f00", success: "#0a0",
  }),
}));

const mockSettings = {
  coinsPerCurrency: 2,
  marketEnabled: false,
  maxSupply: 1000,
  currency: "RM",
};
const mockStats = { circulatingSupply: 400 };
const mockRate = { baseRatePerGC: 0.5, ratePerGC: 0.5, multiplier: 1, coinsPerCurrency: 2, changePct: 0, contributions: [] };

// Plain functions rather than jest.fn().mockResolvedValue(...): the suite runs
// with clearMocks, and a stripped implementation would resolve to undefined and
// fail inside the screen rather than in an assertion.
jest.mock("@/utils/getCoinStore", () => ({
  fetchGetCoinSettings: async () => mockSettings,
  fetchCoinMarketStats: async () => mockStats,
  computeMarketRate: () => mockRate,
}));

const mockTrade = jest.fn();
jest.mock("@/utils/walletStore", () => ({
  tradeCoins: (...a: unknown[]) => mockTrade(...a),
}));

// eslint-disable-next-line import/first
import { Alert } from "react-native";
// eslint-disable-next-line import/first
import WalletTrade from "@/app/wallet-trade";

const mockAlert = jest.spyOn(Alert, "alert").mockImplementation(() => {});

const { fireEvent } = jest.requireActual("@testing-library/react-native");

/** Load the screen, choose a direction, enter an amount, submit. */
async function trade(direction: "Buy" | "Sell", coins: string) {
  const utils = render(<WalletTrade />);
  await utils.findByLabelText("Number of coins");

  await act(async () => {
    fireEvent.press(utils.getByLabelText(direction === "Buy" ? "Buy coins" : "Sell coins"));
  });
  await act(async () => {
    fireEvent.changeText(utils.getByLabelText("Number of coins"), coins);
  });
  await act(async () => {
    fireEvent.press(
      utils.getByLabelText(direction === "Buy" ? "Confirm buy" : "Confirm sell")
    );
  });
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAlert.mockImplementation(() => {});
  mockTrade.mockResolvedValue({ ok: true, balances: { ...balances, getCoin: 60 } });
});

describe("wallet-trade", () => {
  it("executes a buy at the resolved rate, with the supply cap the operator set", async () => {
    await trade("Buy", "10");

    await waitFor(() => expect(mockTrade).toHaveBeenCalled());
    expect(mockTrade).toHaveBeenCalledWith({
      userId: "u1",
      direction: "buy",
      coins: 10,
      ratePerGC: 0.5,
      maxSupply: 1000,
      circulatingSupply: 400,
    });
  });

  it("applies the balances the trade returned", async () => {
    await trade("Buy", "10");
    await waitFor(() => expect(mockApply).toHaveBeenCalledWith({ ...balances, getCoin: 60 }));
  });

  it("refuses a buy the wallet cannot cover, before reaching the RPC", async () => {
    // 500 GC at RM0.50 = RM250, against a RM100 wallet.
    await trade("Buy", "500");

    expect(mockTrade).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith(
      "Not enough in GET.wallet",
      expect.stringContaining("Top up")
    );
  });

  it("refuses a sell larger than the coin balance", async () => {
    await trade("Sell", "80");

    expect(mockTrade).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith(
      "Not enough GET.coin",
      expect.stringContaining("don't have")
    );
  });

  it("allows a sell within the coin balance", async () => {
    await trade("Sell", "20");
    await waitFor(() =>
      expect(mockTrade).toHaveBeenCalledWith(expect.objectContaining({ direction: "sell", coins: 20 }))
    );
  });

  it("does not trade a zero or unparseable amount", async () => {
    await trade("Buy", "0");
    expect(mockTrade).not.toHaveBeenCalled();

    await trade("Buy", "abc");
    expect(mockTrade).not.toHaveBeenCalled();
  });

  it("reports a rejected trade rather than implying it went through", async () => {
    mockTrade.mockResolvedValue({ ok: false, error: "supply cap reached" });
    await trade("Buy", "10");

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith("Trade didn't go through", "supply cap reached")
    );
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("says the rate is fixed when the market is off", async () => {
    const { findByText } = render(<WalletTrade />);
    expect(await findByText("Fixed rate")).toBeTruthy();
  });
});
