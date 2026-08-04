/**
 * How big everything on Meter Digital is drawn.
 *
 * The meter is one console read off a mount, and the mount is anything from a
 * phone in a cradle to a 10-inch dash tablet. Nothing on it may be clipped,
 * wrapped into a scroll or squeezed out of its panel: a fare the driver has to
 * squint at — or a key whose word runs off its edge — is the one thing this
 * screen may not produce. So no size on the screen is a constant. Every
 * padding, every icon, every point size comes from here, computed from the
 * viewport the console is actually being drawn into.
 *
 * Two rules do the work:
 *
 *  1. **The tighter axis governs.** The scale is the smaller of "how wide is
 *     this glass against the reference console" and "how tall". Sizing off the
 *     height alone (as this screen first did) makes a wide-but-short viewport
 *     draw digits that overflow sideways.
 *  2. **A readout is sized to its own panel, not to a share of the screen.**
 *     The segment fields are monospace, so the width a value needs is
 *     arithmetic — `fitDigits` returns the largest point size at which the
 *     digits still sit inside the panel that holds them.
 *
 * All pure, so the fitting rules are unit tested rather than eyeballed on one
 * device.
 */

/** The reference console: a landscape phone in a cradle, the smallest sane fit. */
const BASE_WIDTH = 900;
const BASE_HEIGHT = 430;

/** Narrower than this and the header drops the date to keep the clock whole. */
const COMPACT_WIDTH = 820;

/**
 * Scale bounds. The floor keeps a very small or portrait viewport legible
 * (that case is covered by the rotate notice anyway); the ceiling stops a big
 * tablet from drawing a cartoon.
 */
export const MIN_METER_SCALE = 0.68;
export const MAX_METER_SCALE = 1.7;

/** Roughly how wide one monospace glyph is, as a fraction of its point size. */
const MONO_ASPECT = 0.62;

/** Every size the meter draws with, in points/pixels for one viewport. */
export interface MeterMetrics {
  /** The raw factor the sizes derive from, exposed for one-off scaling. */
  scale: number;
  /** Panel padding, and the gap between panels. */
  pad: number;
  gap: number;
  /** Outer padding of the body area (added to the safe-area insets). */
  bodyPad: number;
  radius: number;

  /* Readouts */
  fareSize: number;
  statSize: number;
  currencySize: number;
  statusSize: number;
  summaryValue: number;
  receiptTotal: number;
  modalAmount: number;

  /* Text */
  panelLabel: number;
  nameSize: number;
  bodyText: number;
  captionText: number;
  smallText: number;
  rowText: number;

  /* Controls */
  buttonHeight: number;
  buttonText: number;
  keyHeight: number;
  keyText: number;
  keyIcon: number;
  wideButtonHeight: number;
  wideButtonText: number;
  iconSize: number;
  avatar: number;

  /* Chrome */
  headerIcon: number;
  headerText: number;
  headerTitle: number;
  headerButton: number;
  tabIcon: number;
  tabLabel: number;
  tripWhenWidth: number;

  /** False on a narrow viewport: the date goes before anything else does. */
  showHeaderDate: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The factor every size on the meter is a multiple of.
 *
 * The smaller of the two axis ratios wins, so a viewport that is generous one
 * way and tight the other is fitted to the tight way — which is the only way
 * nothing overflows.
 */
export function meterScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 1;
  if (width <= 0 || height <= 0) return 1;
  const raw = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);
  return clamp(raw, MIN_METER_SCALE, MAX_METER_SCALE);
}

/**
 * The largest point size at which `chars` monospace glyphs still fit across a
 * panel of `panelWidth`, once its own padding and anything sharing the row
 * (a currency mark, a unit) has taken its share.
 */
export function fitDigits(
  panelWidth: number,
  chars: number,
  reserved: number,
): number {
  if (!Number.isFinite(panelWidth) || chars <= 0) return 0;
  const room = panelWidth - Math.max(0, reserved);
  if (room <= 0) return 0;
  return room / (chars * MONO_ASPECT);
}

/** Every size the meter draws with, for one viewport. */
export function computeMeterMetrics(width: number, height: number): MeterMetrics {
  const scale = meterScale(width, height);
  /** A scaled size, never smaller than one point. */
  const px = (base: number): number => Math.max(1, Math.round(base * scale));
  /** A scaled *type* size, with a legibility floor a dash instrument needs. */
  const pt = (base: number, floor = 9): number =>
    Math.max(floor, Math.round(base * scale));

  const pad = px(12);
  const gap = px(9);
  const bodyPad = px(14);
  const currencySize = pt(18, 11);

  // What the two grid columns actually get: the body's own padding and the
  // gaps between the panels come off the top, then the 1 : 1.85 column split.
  const gridWidth = Math.max(120, width - bodyPad * 2 - gap);
  const leftColumn = (gridWidth / 2.85) * 1;
  const rightColumn = (gridWidth / 2.85) * 1.85;

  // The fare and the extras share the right column; time and distance share
  // the left. Each readout is fitted to the panel it lives in.
  const moneyPanel = (rightColumn - gap) / 2;
  const statPanel = (leftColumn - gap) / 2;

  // What is left for the grid once the header and the tab bar have taken
  // theirs — both of which scale, so the reserve scales with them.
  const bodyHeight = Math.max(180, height - px(130));
  // The fare panel is the taller half of the right column's top row.
  const fareRoom = Math.max(26, bodyHeight / 1.75 - (pad * 2 + px(80)));

  return Object.freeze({
    scale,
    pad,
    gap,
    bodyPad,
    radius: px(14),

    // "999.99" — six glyphs is the widest fare a taxi meter renders, and the
    // currency mark plus its gap sit beside them in the same row.
    fareSize: Math.round(
      Math.min(
        56 * scale,
        fareRoom / 1.3,
        fitDigits(moneyPanel, 6, pad * 2 + currencySize * 1.6 + gap),
      ),
    ),
    // "00:00:00" is the longest thing a stat panel shows.
    statSize: Math.round(
      Math.min(28 * scale, fitDigits(statPanel, 8, pad * 2 + px(4))),
    ),
    currencySize,
    statusSize: pt(22, 13),
    summaryValue: pt(22, 13),
    receiptTotal: pt(30, 18),
    modalAmount: pt(62, 30),

    panelLabel: pt(12, 9),
    nameSize: pt(19, 12),
    bodyText: pt(12, 10),
    captionText: pt(11, 9),
    smallText: pt(10, 8),
    rowText: pt(13, 10),

    buttonHeight: px(56),
    buttonText: pt(19, 12),
    keyHeight: px(40),
    keyText: pt(13, 10),
    keyIcon: px(15),
    wideButtonHeight: px(44),
    wideButtonText: pt(13, 10),
    iconSize: px(18),
    avatar: px(95),

    headerIcon: px(17),
    headerText: pt(13, 10),
    headerTitle: pt(17, 12),
    headerButton: px(34),
    tabIcon: px(24),
    tabLabel: pt(10, 8),
    tripWhenWidth: px(180),

    showHeaderDate: width >= COMPACT_WIDTH,
  });
}
