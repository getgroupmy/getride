/**
 * ESC/POS receipt renderer for direct thermal-printer support.
 *
 * A "mini" Bluetooth / Wi-Fi receipt printer is a thermal printer that speaks
 * ESC/POS — a byte stream of control codes (0x00–0x1F) interleaved with the
 * text to print. Unlike the OS print service (`expo-print`, which drives an
 * AirPrint/CUPS driver from HTML), these printers have no driver: the app has
 * to build the byte stream itself and push it down a socket or a Bluetooth
 * characteristic.
 *
 * The document is built as a **string** on purpose. Every byte this renderer
 * emits is ≤ 0x7F — the ESC/POS control codes it uses all live in 0x00–0x1F,
 * and the text is folded to ASCII (`asciiFold`) because a mini printer's
 * default code page is ASCII/CP437 and selecting another is fragile — so the
 * whole payload is a valid ASCII string that every transport can carry without
 * corrupting a byte. That also keeps the renderer pure and its output directly
 * assertable in a test.
 *
 * A receipt's *content* is shared with the HTML/plain-text renderers via
 * `meterReceiptLines` / `meterReceiptFooterNote` (`utils/meterReceipt.ts`), so
 * a fare can never print one total on paper and another on the phone.
 */

import {
  meterReceiptFooterNote,
  meterReceiptLines,
  type ReceiptBranding,
} from "@/utils/meterReceipt";
import type { MeterTrip } from "@/utils/meterTripsStore";

// --- ESC/POS control codes (all bytes ≤ 0x7F) ---------------------------

const ESC = "\x1B";
const GS = "\x1D";

/** Reset the printer to a known state — clears any leftover styling. */
export const ESCPOS_INIT = ESC + "@";
const ALIGN_LEFT = ESC + "a" + "\x00";
const ALIGN_CENTER = ESC + "a" + "\x01";
const BOLD_ON = ESC + "E" + "\x01";
const BOLD_OFF = ESC + "E" + "\x00";
/** `GS ! n` — the low nibble is height, the high nibble width (double = 1). */
const SIZE_NORMAL = GS + "!" + "\x00";
const SIZE_DOUBLE = GS + "!" + "\x11";
/** `GS V 0` — full cut. Harmless on the many mini printers with no cutter. */
const CUT = GS + "V" + "\x00";

/** Feed `n` blank lines (`ESC d n`), clamped to a byte. */
function feed(n: number): string {
  return ESC + "d" + String.fromCharCode(Math.max(0, Math.min(255, Math.round(n))));
}

// --- paper geometry ------------------------------------------------------

/** The two roll widths a mini thermal printer comes in. */
export type PaperWidth = "58mm" | "80mm";

/**
 * Printable columns at Font A for each roll. 58 mm carriages fit 32 characters,
 * 80 mm fit 48 — the two numbers the whole layout is built around.
 */
export const PAPER_COLUMNS: Record<PaperWidth, number> = {
  "58mm": 32,
  "80mm": 48,
};

export function paperColumns(width: PaperWidth): number {
  return PAPER_COLUMNS[width] ?? PAPER_COLUMNS["58mm"];
}

// --- text shaping --------------------------------------------------------

/**
 * Fold text to printable ASCII so it survives the printer's default code page.
 *
 * Common Latin accents are transliterated to their base letter (a reverse-
 * geocoded street name may carry them); anything else outside 0x20–0x7E — an
 * emoji, a CJK character — becomes '?', which is honest: the printer genuinely
 * cannot render it, and a '?' is clearer than a mojibake box.
 */
export function asciiFold(input: string): string {
  const map: Record<string, string> = {
    à: "a", á: "a", â: "a", ã: "a", ä: "a", å: "a",
    è: "e", é: "e", ê: "e", ë: "e",
    ì: "i", í: "i", î: "i", ï: "i",
    ò: "o", ó: "o", ô: "o", õ: "o", ö: "o",
    ù: "u", ú: "u", û: "u", ü: "u",
    ñ: "n", ç: "c",
    À: "A", Á: "A", Â: "A", Ã: "A", Ä: "A", Å: "A",
    È: "E", É: "E", Ê: "E", Ë: "E",
    Ì: "I", Í: "I", Î: "I", Ï: "I",
    Ò: "O", Ó: "O", Ô: "O", Õ: "O", Ö: "O",
    Ù: "U", Ú: "U", Û: "U", Ü: "U",
    Ñ: "N", Ç: "C",
    "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "·": "-",
  };
  let out = "";
  for (const ch of input) {
    if (ch === "\n") {
      out += ch;
      continue;
    }
    const mapped = map[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.charCodeAt(0);
    out += code >= 0x20 && code <= 0x7e ? ch : "?";
  }
  return out;
}

/** Break `text` into lines no longer than `cols`, wrapping on whitespace. */
export function wrapText(text: string, cols: number): string[] {
  const words = asciiFold(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    // A single word longer than the roll (a run-on address token) is hard-split
    // rather than pushed off the edge.
    if (word.length > cols) {
      if (line) {
        lines.push(line);
        line = "";
      }
      for (let i = 0; i < word.length; i += cols) {
        lines.push(word.slice(i, i + cols));
      }
      continue;
    }
    const next = line ? `${line} ${word}` : word;
    if (next.length > cols) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * A label/value row spread across the roll: label left, value right-aligned.
 *
 * When the value alone (or label-space-value) will not fit the width, the value
 * drops onto its own right-aligned line(s) below the label rather than pushing
 * the column off the paper — the same rule the 80 mm HTML uses for addresses.
 */
export function padRow(label: string, value: string, cols: number): string {
  const l = asciiFold(label);
  const v = asciiFold(value);
  const gap = cols - l.length - v.length;
  if (v.length <= cols && gap >= 1) {
    return l + " ".repeat(gap) + v + "\n";
  }
  // Label on its own line, then the value wrapped and right-aligned under it.
  const wrapped = wrapText(v, cols).map((line) =>
    line.length < cols ? " ".repeat(cols - line.length) + line : line,
  );
  return `${l}\n${wrapped.join("\n")}\n`;
}

/** A centred line, clipping anything wider than the roll. */
function centerLine(text: string, cols: number): string {
  const t = asciiFold(text).slice(0, cols);
  const pad = Math.floor((cols - t.length) / 2);
  return " ".repeat(Math.max(0, pad)) + t + "\n";
}

function ruleLine(cols: number): string {
  return "-".repeat(cols) + "\n";
}

// --- document builder ----------------------------------------------------

export interface EscposReceiptOptions {
  paperWidth?: PaperWidth;
  branding?: ReceiptBranding;
  /** Extra blank lines fed before the cut, to clear the tear bar. Default 3. */
  feedLines?: number;
  /** Emit the cut command at the end. Off by default — most mini printers
   *  have no cutter and the command is a harmless no-op, but a driver can turn
   *  it on for a printer that does. */
  cut?: boolean;
}

/**
 * Render a completed hire as an ESC/POS byte stream (returned as a string of
 * bytes ≤ 0x7F). The header is centred and emphasised; the body is the same
 * line set as every other receipt renderer; the footer names the metered
 * source and thanks the passenger.
 */
export function buildMeterReceiptEscpos(
  trip: MeterTrip,
  options: EscposReceiptOptions = {},
): string {
  const cols = paperColumns(options.paperWidth ?? "58mm");
  const branding = options.branding ?? {};
  const parts: string[] = [ESCPOS_INIT];

  // --- header: operator name, then optional subtitle and vehicle/driver ---
  parts.push(ALIGN_CENTER, BOLD_ON, SIZE_DOUBLE);
  parts.push(centerLine(branding.title ?? "GET TAXI METER", Math.floor(cols / 2)));
  parts.push(SIZE_NORMAL, BOLD_OFF);
  if (branding.subtitle) parts.push(centerLine(branding.subtitle, cols));
  const meta = [
    trip.plate ? `Vehicle ${trip.plate}` : null,
    trip.driver ? `Driver ${trip.driver}` : null,
  ].filter(Boolean) as string[];
  for (const line of meta) parts.push(centerLine(line, cols));

  // --- body ---
  parts.push(ALIGN_LEFT, ruleLine(cols));
  for (const line of meterReceiptLines(trip)) {
    if (line.strong) {
      // The grand total gets emphasis so it reads at a glance off the roll.
      parts.push(BOLD_ON, padRow(line.label, line.value, cols), BOLD_OFF);
    } else {
      parts.push(padRow(line.label, line.value, cols));
    }
  }
  parts.push(ruleLine(cols));

  // --- footer ---
  parts.push(ALIGN_CENTER);
  for (const line of wrapText(meterReceiptFooterNote(trip), cols)) {
    parts.push(line + "\n");
  }
  parts.push(centerLine("Thank you for riding.", cols));

  parts.push(feed(options.feedLines ?? 3));
  if (options.cut) parts.push(CUT);
  parts.push(ALIGN_LEFT);
  return parts.join("");
}

/**
 * A short self-test slip — what the driver's "Test print" button sends, so a
 * printer can be confirmed working before a real fare depends on it.
 */
export function buildTestPrintEscpos(options: EscposReceiptOptions = {}): string {
  const cols = paperColumns(options.paperWidth ?? "58mm");
  const branding = options.branding ?? {};
  const parts: string[] = [ESCPOS_INIT];
  parts.push(ALIGN_CENTER, BOLD_ON, SIZE_DOUBLE);
  parts.push(centerLine(branding.title ?? "GET TAXI METER", Math.floor(cols / 2)));
  parts.push(SIZE_NORMAL, BOLD_OFF);
  parts.push(centerLine("Printer test", cols));
  parts.push(ALIGN_LEFT, ruleLine(cols));
  parts.push(padRow("Paper", (options.paperWidth ?? "58mm") + ` (${cols} cols)`, cols));
  parts.push(padRow("Status", "OK", cols));
  parts.push(ruleLine(cols));
  parts.push(
    ALIGN_CENTER,
    centerLine("If you can read this,", cols),
    centerLine("the printer is ready.", cols),
  );
  parts.push(feed(options.feedLines ?? 3));
  if (options.cut) parts.push(CUT);
  parts.push(ALIGN_LEFT);
  return parts.join("");
}
