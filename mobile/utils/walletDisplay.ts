import {
  Plus,
  ArrowRightLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  Banknote,
  Coins,
  Car,
  Gift,
  RotateCcw,
} from "lucide-react-native";
import type { WalletTransaction, WalletType } from "@/utils/walletStore";

/** "19 Jun 2026, 10:41 PM" style date for wallet activity rows. */
export function formatActivityDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true })
  );
}

/** "10/07/2026 20:17:20" style timestamp for the wallet "Updated" line. */
export function formatUpdatedStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Friendly name for a wallet type. */
export function walletTypeLabel(walletType: WalletType): string {
  switch (walletType) {
    case "get_credit":
      return "GET.credit";
    case "get_coin":
      return "GET.coin";
    default:
      return "GET.wallet";
  }
}

/**
 * Unsigned amount string in the wallet's own unit:
 * currency wallets -> "RM12.50", GET.coin -> "12 GC" (2dp when fractional).
 */
export function walletAmountText(walletType: WalletType, amount: number): string {
  const abs = Math.abs(amount);
  if (walletType === "get_coin") {
    const whole = Math.abs(abs - Math.round(abs)) < 0.005;
    return `${whole ? Math.round(abs).toLocaleString() : abs.toFixed(2)} GC`;
  }
  return `RM${abs.toFixed(2)}`;
}

/**
 * Metadata (label, icon, colour) for a wallet transaction row.
 */
export function walletTxMeta(
  tx: WalletTransaction,
  colors: { success: string; warning: string; danger: string; textSecondary: string }
): { label: string; Icon: typeof Plus; color: string } {
  switch (tx.kind) {
    case "topup":
      return { label: "Wallet Reload", Icon: Plus, color: colors.success };
    case "recharge_in":
      return { label: "Recharge received", Icon: ArrowDownLeft, color: colors.success };
    case "recharge_out":
      return { label: "Recharge to GET.credit", Icon: ArrowRightLeft, color: colors.warning };
    case "payment":
      return { label: "Payment", Icon: ArrowUpRight, color: colors.danger };
    case "commission":
      return { label: "Commission", Icon: Landmark, color: colors.danger };
    case "refund":
      return { label: "Refund", Icon: ArrowDownLeft, color: colors.success };
    case "reward":
      return { label: "Ride Reward", Icon: Coins, color: colors.success };
    case "redeem":
      return { label: "Paid with GET.coin", Icon: Coins, color: colors.danger };
    case "transfer_out":
      return { label: "Transfer Sent", Icon: ArrowUpRight, color: colors.danger };
    case "transfer_in":
      return { label: "Transfer Received", Icon: ArrowDownLeft, color: colors.success };
    case "referral":
      return { label: "Referral Bonus", Icon: Gift, color: colors.success };
    default:
      return { label: tx.note ?? "Adjustment", Icon: Banknote, color: colors.textSecondary };
  }
}

export type WalletTxCategoryId =
  | "ride"
  | "reward"
  | "referral"
  | "transfer"
  | "reload"
  | "refund"
  | "other";

/**
 * Golden accent used to make the "Referral Bonus" row stand out from every
 * other wallet activity. Shared by the wallet screen and the history screen so
 * the highlight looks identical in both places.
 * - `rowBg` tints the whole activity row/card.
 * - `border` outlines the highlighted row/card.
 * - `iconBg`/`icon` colour the leading gift-icon circle.
 * - `badgeBg`/`badgeText` colour the little "BONUS" pill.
 */
export const REFERRAL_HIGHLIGHT = {
  rowBg: "#FFF8E1",
  border: "#F1D592",
  iconBg: "#FBE7A1",
  icon: "#B8860B",
  badgeBg: "#F6C445",
  badgeText: "#6B4E00",
} as const;

/** True when the transaction is a referral bonus (golden-highlighted row). */
export function isReferralTransaction(tx: WalletTransaction): boolean {
  return tx.kind === "referral";
}

export interface WalletTxCategory {
  id: WalletTxCategoryId;
  label: string;
  Icon: typeof Plus;
  /** Icon / label colour for the category. */
  color: string;
  /** Soft tinted background for the icon circle. */
  bg: string;
}

const TX_CATEGORIES: Record<WalletTxCategoryId, WalletTxCategory> = {
  ride: { id: "ride", label: "Ride", Icon: Car, color: "#2DABE2", bg: "#E4F3FB" },
  reward: { id: "reward", label: "Reward", Icon: Gift, color: "#D97706", bg: "#FEF3C7" },
  referral: {
    id: "referral",
    label: "Referral",
    Icon: Gift,
    color: REFERRAL_HIGHLIGHT.icon,
    bg: REFERRAL_HIGHLIGHT.iconBg,
  },
  transfer: {
    id: "transfer",
    label: "Transfer",
    Icon: ArrowRightLeft,
    color: "#0D9488",
    bg: "#CCFBF1",
  },
  reload: { id: "reload", label: "Reload", Icon: Plus, color: "#16A34A", bg: "#DCFCE7" },
  refund: { id: "refund", label: "Refund", Icon: RotateCcw, color: "#0891B2", bg: "#CFFAFE" },
  other: { id: "other", label: "Other", Icon: Banknote, color: "#6B7280", bg: "#F3F4F6" },
};

/**
 * Groups a wallet transaction into a display category (Ride, Reward,
 * Transfer, Reload, Refund, Other) with a distinct colour-coded icon.
 */
export function walletTxCategory(tx: WalletTransaction): WalletTxCategory {
  switch (tx.kind) {
    case "payment":
    case "commission":
    case "redeem":
      return TX_CATEGORIES.ride;
    case "reward":
      return TX_CATEGORIES.reward;
    case "referral":
      return TX_CATEGORIES.referral;
    case "transfer_in":
    case "transfer_out":
    case "recharge_in":
    case "recharge_out":
      return TX_CATEGORIES.transfer;
    case "topup":
      return TX_CATEGORIES.reload;
    case "refund":
      return TX_CATEGORIES.refund;
    default:
      return TX_CATEGORIES.other;
  }
}
