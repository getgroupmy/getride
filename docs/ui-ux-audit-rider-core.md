# UI/UX audit — rider core flow

Audit of the screens every passenger touches on every trip, run against the
`ui-ux-pro-max` skill (`.claude/skills/ui-ux-pro-max/`, vendored from
[nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
at `abb7f2f`, MIT).

Screens in scope: `app/index.tsx` (home map), `app/ride-confirm.tsx`,
`app/ride-tracking.tsx`, `app/wallet.tsx`, `components/MenuSideSheet.tsx`.

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

## Known, not fixed

Deliberately out of scope for a targeted pass — each would be its own change:

1. **`app/wallet.tsx` is not themed.** It imports `useColors()` but hardcodes
   ~112 hex literals (`#8E8E93`, `#EEF1F6`, `#3A4157`, …), so it renders as a
   light-mode screen in dark mode. Fixing it means a token pass over the whole
   file — a visual change, not an audit fix.
2. **Home service cards do nothing.** The five service tiles on the home sheet
   call `console.log` only. They are labelled now, but a control that responds
   to touch and goes nowhere still violates *Disabled state clarity*. They need
   either destinations or a coming-soon state.
3. **The destinations list is keyed by array index** (`dest-manage-${index}`) in
   a list that can be reordered by drag and removed from — the one case where
   index keys actually break, since a reorder re-keys every row. The whole drag
   implementation is index-addressed (`getItemAnimatedValue(index)`,
   `createDragResponder(index)`), so fixing the key means giving destinations
   stable ids and rewriting the reorder logic. Left as its own change.
4. **`hitSlop` coverage app-wide.** 140 files use `TouchableOpacity`; 25 use
   `hitSlop`. The partner and admin surfaces were not touched by this pass.
5. **Reduced motion is not honoured anywhere.** The app runs `Animated`
   sequences (pin drop, bottom sheets, coin toast) without checking
   `AccessibilityInfo.isReduceMotionEnabled()`.
6. **Dynamic Type.** No screen was verified at the largest system text size;
   `allowFontScaling` is left at its default everywhere except the meter console.

## Re-running the audit

```bash
SK=.claude/skills/ui-ux-pro-max/scripts/search.py
python3 "$SK" "touch target safe area accessibility label" --domain web -n 8 --full
python3 "$SK" "accessibility roles touch feedback list keys" --stack react-native -n 10 --full
```

`references/pro-rules.md` holds the canonical pre-delivery checklist.
