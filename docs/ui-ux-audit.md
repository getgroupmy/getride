# UI/UX audit — GET.ride

Audit of the screens every passenger touches on every trip, and of the partner
(driver) surface a driver spends a whole shift in, run against the
`ui-ux-pro-max` skill (`.claude/skills/ui-ux-pro-max/`, vendored from
[nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
at `abb7f2f`, MIT).

Screens in scope: `app/index.tsx` (home map), `app/ride-confirm.tsx`,
`app/ride-tracking.tsx`, `app/wallet.tsx` (and the six sibling wallet screens),
`components/MenuSideSheet.tsx`.

## Which parts of the skill apply here

The skill's `--design-system` generator is built for marketing landing pages: for
a ride-hailing query it returns an "App Store Style Landing" section plan and an
"Exaggerated Minimalism" style with `clamp(3rem, 10vw, 12rem)` headings. That is
not guidance for an existing branded mobile app, so no generated `MASTER.md` is
kept in this repo.

What does apply, and what this audit is graded against:

| Source | Use |
|---|---|
| `--domain web` (`data/app-interface.csv`) | React Native rules: safe areas, touch targets, icon-button labels, form labels |
| `--domain ux` | The 98 UX guidelines, priority-ordered |
| `--stack react-native` | List virtualisation, memoisation, keys, touch feedback, a11y roles |
| `references/pro-rules.md` | Icon discipline, light/dark contrast, spacing rhythm, the pre-delivery checklist |

Priority 1 (Accessibility) and 2 (Touch & Interaction) are both marked CRITICAL,
so this pass took them first.

## Baseline

Across all 164 screens and 47 components at the start of this audit:

- `accessibilityLabel` — **2 occurrences** in the entire app
- `accessibilityRole` — **0 occurrences**
- `hitSlop` — 25 files, against 140 files using `TouchableOpacity`

Every icon-only control in the rider flow (menu, recenter, satellite toggle,
sheet close, balance eye) was therefore an unlabelled button: a screen reader
announces these as "button" with no name.

## Fixed in this pass

### Accessibility (priority 1)

- **Icon-only buttons now carry names.** Menu, pickup-address bar, satellite
  toggle, recenter, ride-type info badge, ride-tracking close/recenter/map-type,
  wallet balance eye, wallet amount clear, the social links.
- **Selection is exposed, not just coloured.** Ride-type cards, satellite
  toggle, wallet quick-amount pills, wallet activity filters and the cancel-reason
  rows now set `accessibilityState.selected` / `checked` and sit in a labelled
  `radiogroup` / `tablist`. Previously selection was conveyed by background
  colour alone — the "color is not the only indicator" rule.
- **Disabled and busy states are announced.** Reload → Next / Reload buttons,
  cancel-confirm and admin-login now set `accessibilityState.disabled` / `busy`,
  with an `accessibilityHint` naming what is missing ("Pick a reason first",
  "Select a reload method first").
- **Placeholder-only input labelled.** The cancel-reason "Other" field had a
  placeholder and nothing else (rule: *Form Control Labels*, severity Critical).
  It now has a visible "Your reason" label plus an `accessibilityLabel`.
- The decorative star row in the menu sheet is hidden from the screen reader,
  since the profile button already announces the rating.

### Touch & interaction (priority 2)

- **Info-sheet close button** was a 32pt circle with no slop. Now 48pt of tap
  area via `hitSlop`, without moving the icon.
- **Ride-type info badge** was 18pt + 10pt slop = 38pt. Now 46pt.
- **Rating stars** were bare 36pt glyphs. Now 44pt.
- **Wallet balance eye / View All** raised from 36pt to 44pt.

### Feedback

- **The trip rating control did nothing visible.** All five stars rendered
  permanently filled and `onPress` only fired a haptic, so a tap left no trace —
  "controls that look tappable but do nothing". The stars now track a `rating`
  state and fill up to the tapped one. *Submission is still not wired to a
  backend* — this pass fixed the feedback, not the persistence.

### Icon discipline (priority 4)

- **Emoji and text used as icons.** The menu sheet drew Instagram as `📷` and
  Facebook as a text `f`, and the profile rating as `★★★★★`. Emoji and glyph
  icons are font-dependent, render differently per platform and cannot be
  themed. All three now use `lucide-react-native` (`Instagram`, `Facebook`,
  `Star`), matching the repo's icons-are-lucide convention.
- The profile rating numeral and its stars are now driven by one constant, so
  they cannot disagree (it previously showed five full stars beside "4.8").

### React Native stack rules

- Menu items were keyed by array index (rule: *Provide keyExtractor* — "Don't:
  index as key"). They now carry and key by their stable `id`, so reordering or
  hiding a menu item from admin settings no longer re-keys the rows.

## `app/ride-confirm.tsx` (second pass)

The booking screen — 6,066 lines, 70 touchables, 0 accessibility attributes, 2
`hitSlop`. It is the screen between picking a destination and getting a driver,
so everything below was on the critical path of every booking.

### Four controls that did nothing

- **Two `Info` buttons** beside the ride-type name. `onPress` was
  `(e) => { e.stopPropagation(); }` — it swallowed the tap and returned.
  **Removed**: the description they would have shown is already rendered two
  lines below the title, so nothing is lost.
- **Two `Pencil` "edit" buttons** on the selected ride card, same empty handler.
  The pencil sits exactly where the fare shows on every other card, and its own
  parent card opens the fare editor. **Wired to `handleOpenOfferFare`.**
- **The settings square** in the bottom bar next to *Find a driver* had no
  `onPress` prop at all, and drew a white `SlidersHorizontal` on
  `colors.gray[100]` — **1.10:1 contrast**, invisible in light mode.
  **Removed**; `findDriverButton` is `flex: 1`, so the primary CTA takes the
  width back.

### Buttons nested inside buttons

The **Entrance** chip lived inside the "change pickup" touchable, and the
**+ add stop** button inside the "change destination" touchable (twice). Nested
touchables share a press region and collapse into a single accessibility
element, so the inner control had no independent existence. All three are now
siblings in their row; row spacing moved to the row wrapper so the layout is
unchanged.

### Emoji and glyphs as icons

- Cash payment drew `💵` at `fontSize: 16` → `Banknote` (7.0:1 on its mint chip).
- The platinum tier badge drew `◆` in `colors.text` on a `#7C3AED` chip —
  **3.11:1**, failing AA → `Gem` in white, **5.70:1**.

### Names, states and targets

- 74 accessibility labels and 68 roles added, from 0. Every icon-only control is
  named: back, recenter, cancel request, payment, promo clear, promo submit
  (a 180°-rotated `ArrowLeft`), seven sheet close buttons, the keypad's delete,
  the drag handles, and all seven full-screen sheet scrims — each of which was
  an unnamed screen-sized button.
- **Selection exposed** on ride-type cards and payment methods (`radio` +
  `checked`), which previously signalled selection with a border colour only.
- **Disabled/busy announced** on both fare steppers, *Raise fare*, *Apply promo*
  and *Remove stop*, with hints ("Increase the fare above first").
- **Switches had no name at all** — `Use GET.coin`, and both auto-accept toggles.
  A `Switch` announces its on/off value but not what it controls.
- **Promo errors** are now an `accessibilityLiveRegion`, so a rejected code is
  spoken rather than only drawn.
- **Twelve touch targets** raised to 44pt via `hitSlop`: the 32pt sheet closes
  (×6), 36pt payment and remove buttons, the 28pt promo clear, the 32pt add-stop,
  the entrance chip and the edit pencil.
- `fareLabel` and `coinEarnText` raised 11pt → 12pt, the documented floor.
  `keypadLetters` (10pt "ABC") and the map's toll marker text are left alone —
  both match platform conventions for their context and neither is body copy.

## Wallet theming (third pass)

All seven wallet screens built their `StyleSheet` at **module scope**, which
cannot see the active colour scheme. `wallet.tsx` imported `useColors()` and
then ignored it for almost everything: ~380 hardcoded light-mode literals across
the feature, so the whole wallet rendered white in dark mode.

### The tokens

`utils/walletTheme.ts` defines the light/dark pair for each *role* the wallet
uses — `surface`, `surfaceAlt`, `surfaceTint`, `textMuted`, `divider`,
`amountPositive` and so on. Screens ask for a role, never a hex.

`utils/__tests__/walletTheme.test.ts` computes the WCAG contrast of every
text/background pair the wallet actually renders and fails the build below
4.5:1 (3:1 for placeholders, and a visibility floor for borders and dividers).
The palette is therefore checked rather than eyeballed, in both themes.

Writing that test surfaced **three contrast failures that were already
shipping in light mode**:

| Where | Was | Ratio | Now |
|---|---|---|---|
| Amount on every credit row (`wallet.tsx`, `wallet-history`, `wallet-trade`) | `#16A34A` on white | **3.30:1** | `#15803D`, 5.02:1 |
| Selected reload-amount pill | `#2dabe2` on white | **2.61:1** | `accentText` `#1C7FA3`, 4.55:1 |
| Balance timestamp, activity dates | `#8E8E93` on white | **3.26:1** | `textFaint` `#6E6E76`, 5.0:1 |

The first was a module constant (`GAIN_GREEN`) in `wallet-trade.tsx`, which is
exactly why it could not vary by theme — a constant has no way to ask what mode
it is in.

### Structure

Each screen now builds its stylesheet through a `makeStyles(wc, Colors)` factory
behind a local `useWalletStyles()` hook, so helper components in the same file
(`SlideToPayButton`, `RateSparkline`) share one themed stylesheet instead of
reaching for a module-scope one.

### What deliberately did NOT become themeable

- **QR codes and barcodes.** A scanner expects dark-on-light, so `QR_SURFACE`
  and `QR_INK` are exported as theme-independent constants and the palette
  points at them. `wallet-show-code.tsx` — the screen you hold up to somebody
  else's camera — stays light in **both** themes as a whole, because its
  barcode draws its bars straight onto the screen background with no card of
  its own; a dark ground would make it unscannable.
- **The camera viewfinder** on `wallet-scan.tsx` and the trade scanner: a
  viewfinder is a dark surface in both themes.
- **Brand colours.** Visa, Mastercard, FPX, DuItNow, MCash, and the GET.coin /
  GET.credit golds stay literal. The only concession is that the Visa and FPX
  wordmarks reverse to white on a dark card, since their brand hues are
  near-black.
- **Text on the accent gradient** (header, filled buttons): white in both
  themes, because the ground it sits on does not change.

98 literals remain across the seven files, all in the categories above.

## Home service tiles (fourth pass)

The five tiles under the home bottom sheet were admin-configurable in label,
icon, image and linked service entry — but had no destination field at all.
Every one called `console.log` and nothing else, so a rider tapped a card that
looked live and got no response: *Disabled state clarity*, "controls that look
tappable but do nothing".

They now work the way the side-menu items already did:

- `ServiceBoxConfig` gains `route` and `comingSoon`, and the admin editor
  (Admin → Settings → Display) gains an **Opens** field and a **Coming soon**
  switch per box. The route picker is the same page list the side menu uses, so
  a destination is chosen rather than typed.
- `utils/serviceBoxAction.ts` (pure + tested) resolves a tap: an admin-set
  route navigates, and everything else — no route, an unusable route, the box
  marked coming-soon, or the global `serviceEnabled` switch being off — raises
  the coming-soon notice. **There is no path where a tap does nothing.**
- Routes are validated before they reach `router.push`: an in-app path only, so
  a bare name, `https://`, `javascript:`, `file:` or a protocol-relative
  `//host` is treated as unset rather than handed to the router. Invalid stored
  routes are also dropped when settings load.
- The state is visible *before* the tap, not just after: a tile that can only
  raise the notice carries a **SOON** badge. Small tiles never drew a badge at
  all, so they now share the large tile's header row.
- The notice names the service ("Groceries in 30 min isn't available yet")
  rather than saying "This service".

The badge work turned up one more pre-existing contrast miss: the **NEW** badge
drew white on `#FF3B30` — **3.55:1**, under AA for 11pt text. It is now
`#D32F26` (4.99:1), and SOON uses a neutral slate rather than borrowing the red
that means "new".

## Reduced motion (fifth pass)

`AccessibilityInfo` appeared **nowhere** in the app: 24 files run `Animated`
sequences, ~140 calls in the rider core alone, and none of them asked whether
the device wants reduced motion.

### Reduce Motion is not "no motion"

WCAG 2.3.3 and both platform HIGs ask for *non-essential* motion to go — large
travel, parallax, spin, zoom — while motion that carries information stays. A
spinner replaced by a static glyph tells the user nothing is happening. So
`utils/reducedMotion.ts` (pure + tested) makes each animation declare what it is
for, and that decides what happens:

| kind | example | when reduced |
|---|---|---|
| `decorative` | pulsing map ring, radar rings, ringing-call pulse | does not run |
| `transition` | sheet slide, pin drop, drawer, card entry/exit | snaps to its end state |
| `essential` | spinner, progress bar, countdown | unchanged |

A `transition` still runs — a transition that did not would leave the sheet
closed forever — it just arrives without the travel. `motionSpring` also drops
the caller's `tension`/`friction` before setting `speed`/`bounciness`, because
`Animated` throws if given both, and clamps overshoot, since the bounce is the
part that causes trouble.

`hooks/useReducedMotion.ts` reads the OS setting and subscribes to
`reduceMotionChanged`, with the value also cached at module scope
(`isMotionReduced()`) for animations started from a gesture handler rather than
from render. A host that does not implement `AccessibilityInfo` reads as "no
preference" rather than crashing.

### What this changed

Decorative loops now stop: the pulsing ring on the user's location marker and
on the driver marker, the three staggered radar rings on the searching screen,
and the pulsing avatar on the incoming-support-call popup — which is mounted
app-wide, so it followed a rider onto every screen.

Transitions now snap: the bottom-sheet entrance and its map-drag hide/show, the
pin drop, the menu drawer (open, close and the gesture fling), the coin toast,
the two cancel modals, and the driver-offer cards — whose exit slid a card off
screen **while rotating it 15°**, the largest single piece of motion in the app.

### What deliberately did not change

- **Spinners and progress bars** (`loadingSpinnerAnim`, `promoLoadingSpinnerAnim`,
  `searchProgressAnim`, `map-picker`'s loader). These say "still working";
  freezing them says the app has hung.
- **`acceptProgress` on the driver-offer cards.** It looks like an animation but
  it is a **10-second countdown** the rider has to accept an offer within, and
  its completion handler dismisses the card. Zeroing its duration would have
  expired every offer the instant it arrived — the clearest argument against
  treating "reduced motion" as a blanket duration cut.
- **Opacity cross-fades**, which are not the kind of motion the setting is about.
- **Gesture-driven values** that follow the finger.

## Partner surface (sixth pass)

11 screens and 6 components, ~26,000 lines, ~250 touchables, and — like the
rider side before it — **zero** accessibility attributes. A driver spends a
whole shift here, against a passenger's few minutes.

Now at **142** roles/labels across the surface. What it turned up:

### The same defects, cloned

`components/OfferFareSideSheet.tsx` is a descendant of `ride-confirm.tsx` and
carried the same three faults, none of which had been noticed because they were
copied rather than written:

- **The dead settings square** (`SlidersHorizontal`, no `onPress`) — the same
  control removed from `ride-confirm`'s bottom bar. Removed.
- **`💵` as the cash payment icon.** Replaced with `Banknote`.
- **Buttons nested inside buttons** — the Entrance chip inside the pickup row
  and the add-stop `+` inside both destination rows. Unnested; the row is now
  the layout and only the address text is the tap target.

Two more dead controls it did *not* inherit: a **bookmark button on every search
result row** with no handler at all, and a payment row rendered as a
`TouchableOpacity` that only reports the method and never changes it — now a
plain `View`, since a control that does nothing should not look like one.

`components/PartnerSideSheet.tsx` was a near-clone of `MenuSideSheet` and
carried its faults too: `📷` and a text `f` as brand icons (now lucide), and
menu rows keyed by array index (now by stable `id`).

### Accessibility

- Every icon-only control named: both menu buttons, both status pills, the
  locate/search/recenter buttons, the permit document link, the meter's
  pause/back/extra keys, the printer and reader rows, the offer stepper.
- **Selection exposed** on the reader-transport, printer, paper-width and
  vehicle lists, and on partner-type checkboxes — all of which signalled state
  with a tick glyph and a border colour only.
- **Busy states named.** Several partner buttons replace their whole label with
  an `ActivityIndicator` while working, so they became *unnamed* buttons exactly
  when something was happening: the meter's print and reader-link buttons, the
  vehicle-onboarding saves.
- **`Go Online` / `Go Offline`** is now `accessibilityRole="switch"` with
  `checked` state — it is a mode, not a one-shot action, and a driver's income
  depends on knowing which way it is set.
- **The cancel-reason "Other" field** on `ride-running` was placeholder-only,
  the same fault as the rider side. It now has a visible label.

### Reduced motion

Applied to the partner loops the earlier pass left open:

- `ride-running`'s marker ring, and its **blinking VoiceProtection dot** — the
  pill only renders while recording and is captioned "VoiceProtection
  recording", so the blink is decoration on a state the text already gives; it
  rests at full opacity.
- `partner-ehailing`'s online ring, and the bottom-sheet entrances on both.

## Remaining pages (seventh pass)

After the rider and partner surfaces, 184 files were still untouched: ~80,000
lines and ~890 touchables, dominated by the ~107-screen admin panel. This pass
worked them highest-value first rather than alphabetically.

### Auth flow — every user passes through it

Back buttons, the country picker and its search, the phone field and its clear
button, the signup sheet, and Next / Passenger / Driver / Resend with disabled
and busy state. The six one-character PIN and OTP boxes announced as six
identical unnamed fields; each now says which digit it is.

**The onboarding screen's "Continue with PIN" had no `onPress` at all** — a dead
primary CTA on the first screen of the app, with a key emoji for an icon. It
cannot route to `/pin-verify` either, which needs a phone number param it has no
way to supply, so the only working path was the button directly above it.
Removed with its orphaned styles; it can come back when passkey sign-in exists.

### Shared components — where the leverage is

`AdminCrudList` backs **23** admin screens, `AdminVehicleList` and
`AdminPartnerList` 9 each, `AdminUserList` 7. Their rows are built from
icon-only edit / delete / call / reorder / open buttons that announced as
unnamed buttons on every one of those screens. Each now names its row ("Edit
&lt;name&gt;", "Delete &lt;plate&gt;", "Move &lt;name&gt; up") and the 32pt icon
buttons take `hitSlop` to 48pt.

The reorder arrows are the one target that **cannot** reach 44pt: two stacked
28×26 buttons in a ~52pt column. Their slop is asymmetric so each extends away
from the other, landing at 40pt. Recorded rather than faked.

### Two mechanical sweeps

- **97 back buttons across 88 files.** The back arrow is the most repeated
  control in the app and was unnamed in every one. Only labelled where the
  touchable's whole body is the arrow, so nothing ambiguous was touched.
- **117 icon-only admin controls, labelled from their testIDs.** The admin panel
  names controls regularly (`airport-edit-${id}`, `vehicle-service-add`), so the
  verb and subject are recoverable. The rule is deliberately narrow, because a
  confident-sounding *wrong* label is worse than none: the verb must be the last
  token before any interpolated id, and the subject is used only when it holds
  no second verb and no interpolation. `edit-partner-delete` therefore becomes
  "Delete", not "Delete edit partner", and `edit-select-vehicle-${id}` is left
  alone because its verb is not its action. Internal shorthand is expanded
  (`vmm` → vehicle make and model) and markup words dropped (`modal`, `empty`).

### Two more dead controls, both clones

- `app/offer-fare.tsx` carried a **third** copy of the settings square with no
  `onPress` — after `ride-confirm` and `OfferFareSideSheet`.
- `app/emergency-contacts.tsx` had a `HelpCircle` header button with no
  `onPress` at all. It only balances the back button, so it is a plain `View`
  now rather than something that invites a tap and answers with nothing.

### Where coverage stands

| | before this session | now |
|---|---|---|
| Files with any `accessibilityRole`/`Label` | 8 of 211 | **119 of 211** |
| `accessibilityLabel` occurrences | 2 | **510** |
| `accessibilityRole` occurrences | 0 | **495** |

See the next pass for the remainder.

## Closing the gap (eighth pass)

### A correction to the last pass's number

The "243 remaining" figure was wrong, and wrong in a way worth recording: the
detector only scanned **12 lines** past a touchable for a `<Text>` child, so any
control whose text sat further down its body was counted as icon-only. Scanning
each element to its actual closing tag put the real figure at **114**. The other
~129 were rows that already announce their own text, and giving those an
`accessibilityLabel` would have *overridden* richer content with a worse
summary. Measure the element, not a window over it.

### Every icon-only control in the app is now named

All 114 were labelled from their icon, testID and handler — the reveal toggles
on the API-key and Supabase screens, the ± steppers throughout the display
settings, reorder arrows, map/geo pickers, the meter's print and vehicle
controls, the e-hailing and Teksi map overlays, the support chat's
record/attach/send, the wallet's copy and torch. **The count of unlabelled
icon-only controls across `app/` and `components/` is now zero.**

### Declaring what is actionable

1,370 touchables exist; 764 of them had an `onPress` and no `accessibilityRole`,
so a screen reader announced them as text rather than as something you can
activate. 757 now carry `accessibilityRole="button"`. The ones that needed a
truer role — `radio`, `tab`, `switch`, `link`, `checkbox`, `radiogroup` — were
given it in the earlier passes and were left alone here.

| | before this session | now |
|---|---|---|
| Files with any accessibility attribute | 8 of 211 | **142 of 211** |
| `accessibilityLabel` | 2 | **622** |
| `accessibilityRole` | 0 | **1,364** |
| Touchables carrying a role | 0% | **99%** |

### Four more dead controls

Auditing the handler-less touchables — the ones with neither a role nor an
`onPress` — turned up four more:

- `app/offer-fare.tsx` had **both** a payment row rendered as a
  `TouchableOpacity` that only reports the method, and an add-stop `+` with no
  handler. That screen has now yielded three dead controls in total.
- `app/search.tsx` carried the **original** of the bookmark button already
  removed from `OfferFareSideSheet` — same defect, copied forward.
- `app/change-number.tsx`'s error sheet had a backdrop with no `onPress`, while
  the identical backdrop 70 lines above it closes its sheet. `handleCloseErrorSheet`
  already existed, so the error sheet simply could not be dismissed by tapping
  outside. Wired.

Left alone deliberately: five `TouchableOpacity`/`Pressable` wrappers with
`activeOpacity={1}` and no handler. Those are the standard React Native idiom
for stopping a tap on a sheet from reaching the backdrop behind it. They are
structure, not controls, and converting them to `View` would let taps through.

## Switches and text inputs (ninth pass)

Answering "are all pages updated?" honestly turned up two element types the
earlier passes never swept, because they were only ever fixed in files worked by
hand: **73 of 78 `Switch` components and 235 of 246 `TextInput`s were unlabelled.**

Both matter for the same reason. A `Switch` announces its on/off *value* but
never what it controls, so a screen reader user hears "on" with no idea of what.
And React Native does not associate a nearby `<Text>` with an input the way
HTML's `<label for>` does, so even a clearly captioned field announces as
unnamed — the skill's *Form Control Labels* rule, severity Critical.

The caption is already in the JSX, so labels were **derived, not invented**:
where the caption is a literal it becomes a string, and where it is an
expression (`{item.label}`) that expression is reused, which is safe because it
is in scope at exactly that point. Three guards keep it honest:

- **Prose is rejected.** Empty-state copy and helper sentences sit in the same
  row and were being picked up as the nearest text — "No vehicles linked to this
  service." was about to become a switch label.
- **Distance matters.** A field label sits immediately above its input; a
  caption 8+ lines away is usually a screen title. `admin-orders` was about to
  label its search box "EV Orders". Those fall back to the placeholder instead.
- **Scope is checked.** A caption can sit inside a `.map((t) => …)` that has
  already closed by the time the control is reached; reusing `t` there does not
  compile, and one such case did not.

Whatever could not be read confidently was skipped and then labelled by hand —
49 of them, mostly search boxes and shared field components whose caption is a
prop.

| | before this session | now |
|---|---|---|
| `Switch` labelled | 5 of 78 | **78 of 78** |
| `TextInput` labelled | 11 of 246 | **244 of 244** |
| Touchables carrying a role | 0% | **99%** |
| Files with any accessibility attribute | 8 of 211 | **142 of 211** |
| `accessibilityLabel` / `accessibilityRole` | 2 / 0 | **928 / 1,364** |

The 69 files with no accessibility attribute contain no interactive element at
all — layouts, type modules and presentational components.

## Known, not fixed

Deliberately out of scope for a targeted pass — each would be its own change:

1. **The destinations list is keyed by array index** (`dest-manage-${index}`) in
   a list that can be reordered by drag and removed from — the one case where
   index keys actually break, since a reorder re-keys every row. The whole drag
   implementation is index-addressed (`getItemAnimatedValue(index)`,
   `createDragResponder(index)`), so fixing the key means giving destinations
   stable ids and rewriting the reorder logic. Left as its own change.
2. **`components/AdminSettingPlaceholder.tsx` has a CTA with no handler**, but
   the component takes `primaryAction` as a *label* with no `onPress` prop at
   all, and nothing in the app imports it. Dead code rather than a dead button;
   deleting the file is a separate call.
3. **Reduced motion in `map-picker`.** Its loop is a loading spinner, which is
   `essential` and correctly left alone; nothing else there animates.
4. **Dynamic Type.** No screen was verified at the largest system text size;
   `allowFontScaling` is left at its default everywhere except the meter console.

## Re-running the audit

```bash
SK=.claude/skills/ui-ux-pro-max/scripts/search.py
python3 "$SK" "touch target safe area accessibility label" --domain web -n 8 --full
python3 "$SK" "accessibility roles touch feedback list keys" --stack react-native -n 10 --full
```

`references/pro-rules.md` holds the canonical pre-delivery checklist.
