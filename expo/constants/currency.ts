export interface CurrencyInfo {
  code: string;
  symbol: string;
  position: "before" | "after";
}

const COUNTRY_CURRENCY_MAP: Record<string, CurrencyInfo> = {
  MY: { code: "MYR", symbol: "RM", position: "before" },
  SG: { code: "SGD", symbol: "S$", position: "before" },
  ID: { code: "IDR", symbol: "Rp", position: "before" },
  TH: { code: "THB", symbol: "฿", position: "before" },
  PH: { code: "PHP", symbol: "₱", position: "before" },
  VN: { code: "VND", symbol: "₫", position: "after" },
  IN: { code: "INR", symbol: "₹", position: "before" },
  US: { code: "USD", symbol: "$", position: "before" },
  GB: { code: "GBP", symbol: "£", position: "before" },
  EU: { code: "EUR", symbol: "€", position: "before" },
  JP: { code: "JPY", symbol: "¥", position: "before" },
  KR: { code: "KRW", symbol: "₩", position: "before" },
  AU: { code: "AUD", symbol: "A$", position: "before" },
  AE: { code: "AED", symbol: "AED", position: "before" },
  SA: { code: "SAR", symbol: "SAR", position: "before" },
  PK: { code: "PKR", symbol: "Rs", position: "before" },
  BD: { code: "BDT", symbol: "৳", position: "before" },
  LK: { code: "LKR", symbol: "Rs", position: "before" },
  MM: { code: "MMK", symbol: "K", position: "after" },
  KH: { code: "KHR", symbol: "៛", position: "after" },
  LA: { code: "LAK", symbol: "₭", position: "before" },
  BN: { code: "BND", symbol: "B$", position: "before" },
  CN: { code: "CNY", symbol: "¥", position: "before" },
  TW: { code: "TWD", symbol: "NT$", position: "before" },
  HK: { code: "HKD", symbol: "HK$", position: "before" },
};

export const DEFAULT_CURRENCY: CurrencyInfo = {
  code: "MYR",
  symbol: "RM",
  position: "before",
};

export function getCurrencyForCountry(countryCode: string): CurrencyInfo {
  return COUNTRY_CURRENCY_MAP[countryCode.toUpperCase()] ?? DEFAULT_CURRENCY;
}

export function formatCurrency(amount: number | string, currency: CurrencyInfo = DEFAULT_CURRENCY): string {
  const value = typeof amount === "string" ? amount : amount.toString();
  if (currency.position === "after") {
    return `${value}${currency.symbol}`;
  }
  return `${currency.symbol} ${value}`;
}
