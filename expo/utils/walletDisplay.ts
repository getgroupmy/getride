import {
  Plus,
  ArrowRightLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  Banknote,
} from "lucide-react-native";
import type { WalletTransaction } from "@/utils/walletStore";

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
    default:
      return { label: tx.note ?? "Adjustment", Icon: Banknote, color: colors.textSecondary };
  }
}
