# Hardware verification

Everything in `mobile/` is covered by typecheck, lint and 1,222 tests except the
parts that need physical equipment. Those have **never run against real
hardware** — the code is written and reviewed, but no dongle has ever answered
it.

This is the list of what to check, and what "correct" looks like. It exists so
that session is an hour with a checklist rather than an afternoon of guessing.

## Getting a build onto a device

Expo Go will not do. The CANBus transports and the printer are native modules,
and Expo Go contains only the modules Expo ships — the JS resolves either way,
which is exactly why the app reports "package resolves" and "native module
linked" as separate facts.

```bash
cd mobile
bun install
cp env.example env          # fill in before building

bun i -g @expo/eas-cli
eas build --profile development --platform android   # or ios
```

Install the resulting build, then `bun run start --dev-client`.

## What to bring

- An ELM327 OBD-II dongle. Wi-Fi and Bluetooth LE are the two common kinds;
  either exercises a real transport.
- A car that will idle, or any vehicle whose ignition can be on without moving.
- A mini ESC/POS thermal printer, if receipt printing matters to you.
- An iPhone as well as an Android, if you use MFi dongles — that transport is
  iOS-only by design.

## The checks

### 1. The transport connects at all

Settings → **OBD-II reader** → add your dongle → Connect.

- Wi-Fi dongles: join the dongle's own Wi-Fi network first. iOS will ask for
  local network permission — **if that prompt never appears, the socket will
  fail silently**, and `NSLocalNetworkUsageDescription` in `app.json` is what
  makes it appear.
- The reader list should show your transport as **ready**. If it says
  unavailable, read the guidance line: it distinguishes "use a development
  build" from "this binary predates the module, you need a new native build",
  and those have different fixes.

### 2. Live telemetry

With the engine running, the OBD-II screen should show speed changing. This is
the 1 Hz sweep, PID `0D`.

### 3. The meter bills on the vehicle, not the phone

Open **Meter Digital**, start a hire, drive.

- The status line should read **GPS + OBD-II**, not GPS alone.
- Distance should accrue while moving.
- Now unplug the dongle mid-hire. Within a few seconds the meter should fall
  back to GPS and **keep accruing** — a dropped reader must never stop a fare.

### 4. Demo Mode must never bill

Connect **Demo Mode** instead of a real reader, then start a hire.

- The status line should flag `DEMO` beside the connection type, not instead
  of it.
- The fare must accrue from **GPS**, never from the simulator's speed. This is
  asserted in `app/__tests__/meterDigital.test.tsx`, but it is worth seeing
  once with your own eyes: it is the difference between a passenger being
  charged for a real journey and for an invented one.

### 5. The vehicle scan

**Vehicle** → Scan.

- The 1 Hz sweep pauses during the scan (the adapter answers one command at a
  time) and must resume afterwards — check the meter still reads speed when
  the scan finishes, including if you leave the screen mid-scan.
- Parameters the car claims but does not answer appear under **Supported but
  silent** rather than vanishing.

### 6. The printer

**Meter Digital** → Printer → add printer → Test print.

- A Bluetooth LE printer will not be in the phone's system Bluetooth list. Use
  the in-app scan; that is why it exists.
- Check the paper: every byte is ASCII-folded, so accented characters should
  degrade rather than corrupt the rest of the line.
- Print a real receipt after a hire and confirm the totals match the screen.
  They come from the same `meterReceipt` helpers, so a mismatch means something
  is genuinely wrong.

## If something fails

The likeliest causes, in order:

1. **Built before the module landed.** A binary only contains native modules
   present when it was built. An OTA update cannot add one.
2. **Permission never asked.** iOS local network for Wi-Fi dongles, Bluetooth
   for BLE. The plugin config in `app.json` is what produces those prompts.
3. **Another app holds the dongle.** A dongle serves one client at a time —
   close any other OBD app, including the manufacturer's.
4. **The car does not implement the PID.** Not every vehicle publishes odometer
   (`A6`) or fuel rate (`5E`). The app prints a dash rather than inventing a
   number, and that is correct behaviour, not a bug.
