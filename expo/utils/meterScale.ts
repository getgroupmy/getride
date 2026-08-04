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
 *  2. **A readout is sized to the value in hand, in its own panel.** The
 *     segment fields are monospace, so the width a value needs is arithmetic —
 *     `fitDigits` returns the largest point size at which that many digits
 *     still sit inside the panel holding them, and `fitReadout` caps it at what
 *     the panel has vertically. Sizing a field to the longest string it might
 *     ever hold either clips the long case or wastes the short one, so the
 *     clock and the distance are re-fitted as they grow.
 *  3. **A measured box beats a predicted one.** The sizes here are computed from
 *     the viewport, which is only a *prediction* of how wide a panel ends up —
 *     and a prediction is wrong the moment the device adds a safe-area inset (a
 *     landscape notch takes ~100pt off the glass). So the screen hands the box
 *     each field was actually laid out in back to `fitReadoutBox` /
 *     `fitMoneyPanel`, and the field is fitted to that box in both axes.
 *     Nothing is clipped, because nothing is guessed.
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

/**
 * Roughly how wide one monospace glyph is, as a fraction of its point size.
 *
 * Menlo (iOS) advances 0.602 em and Android's monospace 0.600, and
 * `SegmentDisplay` adds 0.02 em of letter spacing on top — so the true figure
 * is a shade over 0.62. This carries a few percent of margin above that: a
 * readout drawn one point too small is invisible to the driver, while one drawn
 * a hair too wide loses its last digit to the panel's overflow.
 */
const MONO_ASPECT = 0.645;

/**
 * How tall one monospace line is, as a multiple of its point size.
 *
 * `SegmentDisplay` draws with `lineHeight: size * 1.26`, so this is the figure a
 * height fit divides by — a readout sized off the raw box height has its leading
 * clipped by the panel holding it.
 */
const MONO_LINE = 1.26;

/** How tall a line of ordinary panel text is, as a multiple of its point size. */
const TEXT_LINE = 1.35;

/** Never draw a readout below this: a dash instrument is read at a glance. */
export const MIN_READOUT_PT = 9;

/** A key still has to be pressable with a thumb in a moving vehicle. */
export const MIN_KEY_HEIGHT = 26;

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
  /**
   * Ceiling for the TIME / DISTANCE readouts. Their actual size is fitted to
   * the value being shown (`fitReadout` against {@link statPanelWidth}), so a
   * clock past an hour and a two-digit distance both stay whole.
   */
  statSizeMax: number;
  /** Width one of the two stat panels gets, for that fitting. */
  statPanelWidth: number;
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

/**
 * The size a readout is actually drawn at: {@link fitDigits} for the value in
 * hand, held under `max` and above the legibility floor, and rounded.
 *
 * This is what makes a field size itself to its *content* rather than to the
 * longest thing it might ever hold. A clock that has run past an hour, a
 * distance that has gained a digit, an odometer with six of them — each is
 * drawn as large as its own box allows, so nothing is ever cut off and nothing
 * is needlessly small. Fields that sit side by side pass their values through
 * separately and take the smaller answer, so a pair stays a pair.
 */
export function fitReadout(
  panelWidth: number,
  chars: number,
  reserved: number,
  max: number,
): number {
  const fitted = fitDigits(panelWidth, chars, reserved);
  // No room at all (a pathological viewport): the floor still gets drawn, and
  // the panel's own overflow is what clips it.
  if (fitted <= 0) return Math.round(Math.min(max, MIN_READOUT_PT));
  return Math.round(Math.max(MIN_READOUT_PT, Math.min(max, fitted)));
}

/**
 * The largest point size at which a value fits a box it was *measured* in —
 * across and down.
 *
 * This is the honest version of {@link fitReadout}: instead of a panel width
 * predicted from the viewport and a height ceiling guessed from the scale, both
 * numbers come from the layout the platform actually performed. A landscape
 * notch, a split-screen tablet, a rounding that landed the other way — none of
 * them can clip a readout that was fitted to its own box.
 *
 * An axis that has not been measured yet (0) falls through to the axis that
 * was, and to `max` when neither has.
 */
export function fitReadoutBox(
  boxWidth: number,
  boxHeight: number,
  chars: number,
  reservedWidth: number,
  max: number,
): number {
  const byWidth = fitDigits(boxWidth, chars, reservedWidth);
  const byHeight =
    Number.isFinite(boxHeight) && boxHeight > 0 ? boxHeight / MONO_LINE : 0;
  const limits = [byWidth, byHeight].filter((v) => v > 0);
  if (limits.length === 0) return Math.round(Math.min(max, MIN_READOUT_PT));
  return Math.round(Math.max(MIN_READOUT_PT, Math.min(max, ...limits)));
}

/** What one money panel (FARE, EXTRA) draws with, once it has been measured. */
export interface MoneyPanelFit {
  /** Point size for the RM readout. */
  readoutSize: number;
  /** Height each key below it gets. */
  keyHeight: number;
}

/** A measured money panel, and everything sharing its height. */
export interface MoneyPanelInput {
  /** The panel's own measured box. */
  width: number;
  height: number;
  /** How many glyphs the readout is drawing right now: "4.00" is four. */
  chars: number;
  /** The panel's padding, and the gap between its rows. */
  pad: number;
  gap: number;
  /** Point sizes of the fixed text lines: the label, and any caption below. */
  textLines: number[];
  /** Width the currency mark and its gap take out of the readout's row. */
  reservedWidth: number;
  /** Ceilings from the viewport metrics: never draw larger than these. */
  maxReadout: number;
  maxKeyHeight: number;
}

/**
 * Divide a measured money panel between its readout and its keys.
 *
 * The panel carries a label, the RM readout, a row of keys and — for EXTRA,
 * always — a caption, inside a box whose height is a share of the glass. On a
 * short console the sum of their natural sizes exceeds that box and whatever is
 * drawn first gets clipped, which is exactly what may not happen to a fare.
 *
 * So the panel is divided rather than overflowed: the fixed text lines take
 * their real height off the top, the keys take a share of what is left but never
 * more than the viewport allows nor less than a thumb needs, and the readout is
 * fitted to the remainder in both axes.
 */
export function fitMoneyPanel(input: MoneyPanelInput): MoneyPanelFit {
  const {
    width,
    height,
    chars,
    pad,
    gap,
    textLines,
    reservedWidth,
    maxReadout,
    maxKeyHeight,
  } = input;

  const innerWidth = Math.max(0, width - pad * 2);
  // The rows sharing the height: every fixed text line, the readout, the keys.
  const rows = textLines.length + 2;
  const fixed =
    textLines.reduce((sum, size) => sum + size * TEXT_LINE, 0) +
    gap * Math.max(0, rows - 1);
  const innerHeight = Math.max(0, height - pad * 2 - fixed);

  // Not measured yet (or a box with nothing left): the viewport ceilings stand,
  // and the width fit decides alone where there is a width to fit to. This is
  // the first frame only — the layout pass lands immediately after it.
  if (innerHeight <= 0) {
    return Object.freeze({
      readoutSize:
        innerWidth > 0
          ? fitReadoutBox(innerWidth, 0, chars, reservedWidth, maxReadout)
          : Math.round(Math.max(MIN_READOUT_PT, maxReadout)),
      keyHeight: Math.max(MIN_KEY_HEIGHT, Math.round(maxKeyHeight)),
    });
  }

  // The thumb floor holds even where the box cannot pay for it. A key too small
  // to hit is worse than a panel that overflows — the driver can still read a
  // clipped panel, but cannot press a 16pt key at a junction — so this floors
  // exactly as `MIN_READOUT_PT` does, and the panel's overflow is the backstop.
  const keyHeight = Math.max(
    MIN_KEY_HEIGHT,
    Math.min(maxKeyHeight, innerHeight * 0.46),
  );

  // What is left for the readout once the keys have taken theirs. A measured
  // box with nothing left is *not* an unmeasured one: handing 0 to
  // `fitReadoutBox` would fall through to the width axis and draw a full-size
  // fare across a panel with no room for it, which is the very clipping this
  // function exists to prevent. So a spent box lands on the legibility floor.
  const readoutRoom = innerHeight - keyHeight - gap;

  return Object.freeze({
    readoutSize:
      readoutRoom > 0
        ? fitReadoutBox(innerWidth, readoutRoom, chars, reservedWidth, maxReadout)
        : Math.round(Math.min(maxReadout, MIN_READOUT_PT)),
    keyHeight: Math.round(keyHeight),
  });
}

/**
 * The part of the glass the console does not get: the safe-area insets a notch,
 * a rounded corner or a home indicator claim.
 *
 * Sizing off the raw window on a landscape phone over-states the width by the
 * ~100pt the sensor housing takes, and every panel prediction inherits that
 * error — which is what pushed the clock's last digits outside their panel.
 */
export interface MeterChrome {
  horizontal?: number;
  vertical?: number;
}

/** Every size the meter draws with, for one viewport. */
export function computeMeterMetrics(
  rawWidth: number,
  rawHeight: number,
  chrome?: MeterChrome,
): MeterMetrics {
  const width = Math.max(1, rawWidth - Math.max(0, chrome?.horizontal ?? 0));
  const height = Math.max(1, rawHeight - Math.max(0, chrome?.vertical ?? 0));
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
    // The stat panels have the height for this much; how much of it a readout
    // actually uses is decided by the value it is drawing (see `fitReadout`).
    statSizeMax: Math.round(28 * scale),
    statPanelWidth: statPanel,
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
