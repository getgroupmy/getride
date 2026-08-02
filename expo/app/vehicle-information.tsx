/**
 * Vehicle information.
 *
 * Everything the connected OBD-II reader can tell us about the vehicle it is
 * plugged into: its identity (VIN, calibration IDs, ECU name), its fault state
 * (stored / pending / permanent trouble codes and the emissions readiness
 * monitors), every mode-01 parameter the car reports as supported, and the
 * adapter's own details.
 *
 * Reached from the partner side menu, which only shows the row while a reader
 * is genuinely linked. This screen deliberately does **not** open a connection
 * of its own — it borrows the session the Teksi screen already owns (see
 * `utils/canbus/liveStatus.ts`), because a dongle serves one client at a time.
 *
 * The write section is the other half: the small set of commands that change
 * something rather than read it. Each one is behind a warning popup that says
 * plainly what it touches, and writes that reach the ECUs are refused while
 * the vehicle is moving or when the link is the simulator.
 *
 * The three numbers a driver actually asks for — odometer, fuel level and how
 * far the fuel left will go — lead the screen. The first two come off the bus;
 * the third cannot (OBD-II publishes neither tank capacity nor distance to
 * empty) and is computed in `utils/canbus/fuelRange.ts` from the tank size the
 * driver enters and a consumption figure that is measured from their own fuel
 * burn where possible. The card always says which it used.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  AlertTriangle,
  ArrowLeft,
  Car,
  Check,
  ChevronRight,
  Cpu,
  Eraser,
  Fuel,
  Gauge,
  Navigation,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useCanbusStatus } from "@/hooks/useCanbusStatus";
import { getActiveCanbusSession } from "@/utils/canbus/liveStatus";
import { ELM_INIT_COMMANDS, ELM_PROTOCOL_NAMES } from "@/utils/canbus/obd";
import { PID_GROUP_LABEL, PID_GROUP_ORDER } from "@/utils/canbus/pidCatalog";
import { TRANSPORT_LABEL } from "@/utils/canbus/types";
import {
  DTC_MODES,
  VEHICLE_WRITE_ACTIONS,
  decodeVin,
  describeDtc,
  evaluateWriteAvailability,
  isLikelyVin,
  isWriteAcknowledged,
  parseAtText,
  validateRawCommand,
  type VehicleWriteAction,
  type VehicleWriteId,
} from "@/utils/canbus/vehicleInfo";
import {
  groupReadings,
  scanVehicle,
  type ScanProgress,
  type VehicleScanReport,
} from "@/utils/canbus/vehicleScan";
import {
  CONSUMPTION_SOURCE_LABEL,
  computeFuelRange,
  defaultFuelProfile,
  formatConsumption,
  formatKm,
  formatLitres,
  formatPercent,
  fuelBarFraction,
  fuelLevelColor,
  readFuelSnapshot,
  validateFuelProfileInput,
  type FuelProfile,
} from "@/utils/canbus/fuelRange";
import {
  loadFuelProfile,
  recordFuelSample,
  resetMeasuredConsumption,
  saveFuelProfile,
} from "@/utils/vehicleFuelStore";

const WRITE_ICON: Record<VehicleWriteId, typeof Eraser> = {
  "clear-dtc": Eraser,
  "set-protocol": Cpu,
  "reset-adapter": RotateCcw,
  "raw-command": Terminal,
};

/** ELM327 protocol codes offered by the "Set CAN protocol" write. */
const PROTOCOL_CHOICES = Object.keys(ELM_PROTOCOL_NAMES).map((code) => ({
  code,
  label: ELM_PROTOCOL_NAMES[code],
}));

interface WriteResult {
  ok: boolean;
  message: string;
}

export default function VehicleInformationScreen() {
  const router = useRouter();
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const isLightMode = Colors.background === "#FFFFFF";
  const status = useCanbusStatus();

  const [report, setReport] = useState<VehicleScanReport | null>(null);
  const [scanning, setScanning] = useState<boolean>(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const [fuelProfile, setFuelProfile] = useState<FuelProfile>(() => defaultFuelProfile());
  const [fuelEditOpen, setFuelEditOpen] = useState<boolean>(false);
  const [tankInput, setTankInput] = useState<string>("");
  const [consumptionInput, setConsumptionInput] = useState<string>("");
  const [fuelEditError, setFuelEditError] = useState<string | null>(null);

  const [pendingWrite, setPendingWrite] = useState<VehicleWriteAction | null>(null);
  const [rawCommand, setRawCommand] = useState<string>("");
  const [protocolCode, setProtocolCode] = useState<string>("0");
  const [writing, setWriting] = useState<boolean>(false);
  const [writeResult, setWriteResult] = useState<WriteResult | null>(null);

  const mountedRef = useRef<boolean>(true);
  const scanningRef = useRef<boolean>(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runScan = useCallback(async () => {
    if (scanningRef.current) return;
    const session = getActiveCanbusSession();
    if (!session) {
      setScanError("The OBD-II reader is not connected.");
      return;
    }
    if (session.state.simulated) {
      setScanError(
        "Demo Mode is streaming virtual telemetry — there is no vehicle to interrogate.",
      );
      return;
    }
    scanningRef.current = true;
    setScanning(true);
    setScanError(null);
    setProgress({ done: 0, total: 1, label: "Starting" });
    // The adapter answers one command at a time, so hand the whole link to the
    // scan instead of interleaving it with the 1 Hz telemetry sweep.
    session.setPollingPaused(true);
    try {
      const next = await scanVehicle(session.sendCommand, {
        onProgress: (p) => {
          if (mountedRef.current) setProgress(p);
        },
        shouldContinue: () => mountedRef.current,
      });
      if (mountedRef.current) setReport(next);
      // Odometer + fuel level together are one measurement of this vehicle's
      // real fuel burn: hand them to the profile so the range stops resting on
      // an assumed consumption once the driver has covered enough ground.
      const snapshot = readFuelSnapshot(next.readings);
      const sample =
        snapshot.odometerKm !== null && snapshot.fuelLevelPercent !== null
          ? {
              odometerKm: snapshot.odometerKm,
              fuelLevelPercent: snapshot.fuelLevelPercent,
              at: Date.now(),
            }
          : null;
      try {
        const { profile } = await recordFuelSample(next.vin, sample);
        if (mountedRef.current) setFuelProfile(profile);
      } catch (e) {
        // A device-storage failure is not a failed scan — the vehicle answered.
        console.log("[vehicle-info] fuel profile update failed", e);
      }
    } catch (e: any) {
      if (mountedRef.current) {
        setScanError(e?.message ?? "Could not read from the vehicle.");
      }
    } finally {
      session.setPollingPaused(false);
      scanningRef.current = false;
      if (mountedRef.current) {
        setScanning(false);
        setProgress(null);
      }
    }
  }, []);

  // Read the vehicle as soon as the screen opens on a live link. `report` is
  // in the deps only so a reconnect after a dropped link re-reads.
  useEffect(() => {
    if (status.linked && !report && !scanningRef.current) {
      void runScan();
    }
  }, [status.linked, report, runScan]);

  // The stored profile is what the range maths rests on, so it is needed
  // whether or not a scan has run — the settings popup opens on it too.
  useEffect(() => {
    void loadFuelProfile().then((profile) => {
      if (mountedRef.current) setFuelProfile(profile);
    });
  }, []);

  // Writes that reach the ECUs are refused while the car is rolling, so the
  // rows need a reasonably fresh speed. Sampling every two seconds is enough:
  // React bails out when the value is unchanged, so a parked vehicle costs no
  // re-renders at all, and the authoritative check happens again at write time.
  // The fuel gauge rides along on the same tick — it is already in the 1 Hz
  // telemetry sweep, so the level and range stay live without a re-scan.
  const [liveSpeed, setLiveSpeed] = useState<number | null>(null);
  const [liveFuelLevel, setLiveFuelLevel] = useState<number | null>(null);
  useEffect(() => {
    if (!status.linked) {
      setLiveSpeed(null);
      setLiveFuelLevel(null);
      return;
    }
    const sample = () => {
      const telemetry = getActiveCanbusSession()?.state.telemetry;
      const speed = telemetry?.speed;
      const fuelLevel = telemetry?.fuelLevel;
      setLiveSpeed(typeof speed === "number" ? Math.round(speed) : null);
      setLiveFuelLevel(typeof fuelLevel === "number" ? fuelLevel : null);
    };
    sample();
    const timer = setInterval(sample, 2000);
    return () => clearInterval(timer);
  }, [status.linked]);

  // What the fuel card renders: the scan's snapshot, with the two values the
  // telemetry loop keeps fresh laid over the top.
  const fuel = useMemo(() => {
    const snapshot = readFuelSnapshot(report?.readings ?? []);
    return computeFuelRange(
      {
        ...snapshot,
        fuelLevelPercent: liveFuelLevel ?? snapshot.fuelLevelPercent,
        speedKmh: liveSpeed ?? snapshot.speedKmh,
      },
      fuelProfile,
    );
  }, [report?.readings, liveFuelLevel, liveSpeed, fuelProfile]);

  const openFuelEditor = useCallback(() => {
    setTankInput(String(fuelProfile.tankCapacityL));
    setConsumptionInput(formatConsumption(fuelProfile.consumptionL100));
    setFuelEditError(null);
    setFuelEditOpen(true);
  }, [fuelProfile]);

  const saveFuelEditor = useCallback(async () => {
    const check = validateFuelProfileInput(tankInput, consumptionInput);
    if (!check.ok || !check.value) {
      setFuelEditError(check.error ?? "Check the values and try again.");
      return;
    }
    const saved = await saveFuelProfile({ ...fuelProfile, ...check.value });
    if (!mountedRef.current) return;
    setFuelProfile(saved);
    setFuelEditOpen(false);
  }, [tankInput, consumptionInput, fuelProfile]);

  const clearMeasuredConsumption = useCallback(async () => {
    const saved = await resetMeasuredConsumption();
    if (mountedRef.current) setFuelProfile(saved);
  }, []);

  const writeContext = useMemo(
    () => ({
      online: status.online,
      simulated: status.simulated,
      speedKmh: liveSpeed,
    }),
    [status.online, status.simulated, liveSpeed],
  );

  const closeWriteModal = useCallback(() => {
    setPendingWrite(null);
    setWriteResult(null);
    setRawCommand("");
  }, []);

  /** Run the confirmed write and report exactly what the adapter answered. */
  const performWrite = useCallback(
    async (action: VehicleWriteAction) => {
      const session = getActiveCanbusSession();
      if (!session) {
        setWriteResult({ ok: false, message: "The reader is no longer connected." });
        return;
      }
      // Re-check against the link as it is *now*, not as it was when the row
      // rendered — the car may have started moving while the popup was open.
      const availability = evaluateWriteAvailability(action, {
        online: session.state.phase === "online",
        simulated: session.state.simulated,
        speedKmh: session.state.telemetry.speed ?? null,
      });
      if (!availability.allowed) {
        setWriteResult({
          ok: false,
          message: availability.reason ?? "This write is not available right now.",
        });
        return;
      }
      setWriting(true);
      setWriteResult(null);
      session.setPollingPaused(true);
      try {
        let result: WriteResult;
        switch (action.id) {
          case "clear-dtc": {
            const raw = await session.sendCommand("04");
            result = isWriteAcknowledged(raw, "44")
              ? {
                  ok: true,
                  message:
                    "Codes cleared. The readiness monitors are now \"not ready\" until the vehicle completes a drive cycle.",
                }
              : { ok: false, message: `The vehicle refused the request: ${raw.trim()}` };
            break;
          }
          case "set-protocol": {
            const raw = await session.sendCommand("ATSP" + protocolCode);
            const ok = isWriteAcknowledged(raw);
            const confirm = ok ? await session.sendCommand("ATDP") : null;
            const name = confirm ? parseAtText(confirm) : null;
            result = ok
              ? { ok: true, message: `Protocol set${name ? ` — now ${name}` : ""}.` }
              : { ok: false, message: `The adapter refused the change: ${raw.trim()}` };
            break;
          }
          case "reset-adapter": {
            await session.sendCommand("ATZ");
            // ATZ drops the adapter back to its power-on defaults, so re-run the
            // handshake the session client established — otherwise echo comes
            // back on and every later reply is unparseable.
            for (const cmd of ELM_INIT_COMMANDS.slice(1)) {
              await session.sendCommand(cmd);
            }
            result = { ok: true, message: "Reader reset and re-initialised." };
            break;
          }
          case "raw-command": {
            const check = validateRawCommand(rawCommand);
            if (!check.ok || !check.command) {
              result = { ok: false, message: check.error ?? "Invalid command." };
              break;
            }
            const raw = await session.sendCommand(check.command);
            const text = raw.trim() || "(no response)";
            result = { ok: true, message: text };
            break;
          }
          default:
            result = { ok: false, message: "Unsupported action." };
        }
        if (mountedRef.current) setWriteResult(result);
        // Anything that touched the vehicle invalidates what is on screen.
        if (result.ok && action.target === "vehicle" && mountedRef.current) {
          setReport(null);
        }
      } catch (e: any) {
        if (mountedRef.current) {
          setWriteResult({ ok: false, message: e?.message ?? "The command failed." });
        }
      } finally {
        session.setPollingPaused(false);
        if (mountedRef.current) setWriting(false);
      }
    },
    [protocolCode, rawCommand],
  );

  const cardStyle = {
    backgroundColor: isLightMode ? "#F9FAFB" : "#111",
    borderColor: Colors.border,
  };

  const vinDetails = useMemo(() => decodeVin(report?.vin ?? null), [report?.vin]);
  const rawCommandCheck = useMemo(
    () => (rawCommand.trim().length > 0 ? validateRawCommand(rawCommand) : null),
    [rawCommand],
  );
  // A one-shot write that succeeded has nothing left to confirm, so the popup
  // collapses to a single "Close". The raw-command console is the exception —
  // sending one command is usually the start of a session, not the end of it.
  const oneShotDone = !!writeResult?.ok && pendingWrite?.id !== "raw-command";
  const readingSections = useMemo(
    () => groupReadings(report?.readings ?? [], PID_GROUP_ORDER),
    [report?.readings],
  );
  const totalCodes = useMemo(
    () =>
      DTC_MODES.reduce((sum, store) => sum + (report?.dtcs[store.key]?.length ?? 0), 0),
    [report?.dtcs],
  );

  const renderRow = (label: string, value: string, key: string) => (
    <View key={key} style={[styles.dataRow, { borderTopColor: Colors.border }]}>
      <Text style={[styles.dataLabel, { color: Colors.textSecondary }]} numberOfLines={2}>
        {label}
      </Text>
      <Text style={[styles.dataValue, { color: Colors.text }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );

  const sectionHeader = (text: string) => (
    <Text style={[styles.sectionHeader, { color: Colors.textSecondary }]}>{text}</Text>
  );

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <StatusBar barStyle={isLightMode ? "dark-content" : "light-content"} />

      <SafeAreaView edges={["top"]} style={{ backgroundColor: Colors.background }}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => router.back()}
            testID="vehicle-info-back"
          >
            <ArrowLeft color={Colors.text} size={24} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Vehicle information</Text>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => void runScan()}
            disabled={scanning || !status.linked}
            testID="vehicle-info-refresh"
          >
            <RefreshCw
              color={scanning || !status.linked ? Colors.textSecondary : Colors.text}
              size={20}
            />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* --- Link --- */}
        <View style={[styles.card, cardStyle]} testID="vehicle-info-link">
          <View style={styles.cardHeader}>
            <Cpu color={Colors.text} size={18} />
            <Text style={[styles.cardTitle, { color: Colors.text }]}>Reader</Text>
          </View>
          {status.linked ? (
            <Text style={[styles.statusLine, { color: "#22C55E" }]}>
              Connected{status.deviceName ? ` — ${status.deviceName}` : ""}
              {status.transport ? ` via ${TRANSPORT_LABEL[status.transport]}` : ""}
            </Text>
          ) : status.online && status.simulated ? (
            <Text style={[styles.statusLine, { color: "#F59E0B" }]}>
              Demo Mode — virtual telemetry, no vehicle attached
            </Text>
          ) : (
            <Text style={[styles.statusLine, { color: Colors.textSecondary }]}>
              Not connected
            </Text>
          )}
          {!status.linked ? (
            <>
              <Text style={[styles.cardBody, { color: Colors.textSecondary }]}>
                {status.simulated
                  ? "Demo Mode streams simulated numbers so the panels can be exercised without hardware. There is no vehicle behind it to read from, and nothing can be written."
                  : "Plug your OBD-II reader in and connect it, then come back — this screen reads everything the reader exposes about the vehicle it is plugged into."}
              </Text>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: Colors.accent }]}
                onPress={() => router.push("/obd2-reader" as any)}
                testID="vehicle-info-open-reader"
              >
                <Text style={[styles.primaryButtonText, { color: Colors.onAccent }]}>
                  Open OBD-II reader settings
                </Text>
              </TouchableOpacity>
            </>
          ) : null}

          {report?.adapter.map((item) => renderRow(item.label, item.value, item.key))}

          {scanning ? (
            <View style={styles.progressBlock}>
              <View style={styles.progressRow}>
                <ActivityIndicator color={Colors.accent} size="small" />
                <Text style={[styles.progressLabel, { color: Colors.textSecondary }]} numberOfLines={1}>
                  Reading {progress?.label ?? "vehicle"}…
                </Text>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: Colors.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: Colors.accent,
                      width: `${Math.round(
                        ((progress?.done ?? 0) / Math.max(1, progress?.total ?? 1)) * 100,
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ) : null}

          {scanError ? (
            <Text style={[styles.errorText]} testID="vehicle-info-error">
              {scanError}
            </Text>
          ) : null}
        </View>

        {report ? (
          <>
            {/* --- Odometer & fuel --- */}
            {sectionHeader("ODOMETER & FUEL")}
            <View style={[styles.card, cardStyle]} testID="vehicle-info-fuel">
              <View style={styles.cardHeader}>
                <Fuel color={Colors.text} size={18} />
                <Text style={[styles.cardTitle, { color: Colors.text }]}>
                  Odometer &amp; fuel
                </Text>
                <TouchableOpacity
                  style={styles.inlineEdit}
                  onPress={openFuelEditor}
                  testID="vehicle-info-fuel-edit"
                >
                  <Pencil color={Colors.textSecondary} size={13} />
                  <Text style={[styles.inlineEditText, { color: Colors.textSecondary }]}>
                    Tank
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Gauge color={Colors.textSecondary} size={15} />
                  <Text
                    style={[styles.statValue, { color: Colors.text }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    testID="vehicle-info-odometer"
                  >
                    {formatKm(fuel.odometerKm)}
                  </Text>
                  <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>
                    km odometer
                  </Text>
                </View>
                <View style={[styles.stat, styles.statDivider, { borderLeftColor: Colors.border }]}>
                  <Fuel color={fuelLevelColor(fuel.fuelLevelPercent)} size={15} />
                  <Text
                    style={[styles.statValue, { color: Colors.text }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    testID="vehicle-info-fuel-level"
                  >
                    {formatPercent(fuel.fuelLevelPercent)}
                  </Text>
                  <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>
                    % in the tank
                  </Text>
                </View>
                <View style={[styles.stat, styles.statDivider, { borderLeftColor: Colors.border }]}>
                  <Navigation color={Colors.textSecondary} size={15} />
                  <Text
                    style={[styles.statValue, { color: Colors.text }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    testID="vehicle-info-range"
                  >
                    {fuel.rangeKm === null
                      ? "—"
                      : `${fuel.estimated ? "≈" : ""}${formatKm(fuel.rangeKm)}`}
                  </Text>
                  <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>
                    km remaining
                  </Text>
                </View>
              </View>

              <View style={[styles.fuelTrack, { backgroundColor: Colors.border }]}>
                <View
                  style={[
                    styles.fuelFill,
                    {
                      backgroundColor: fuelLevelColor(fuel.fuelLevelPercent),
                      width: `${Math.round(fuelBarFraction(fuel.fuelLevelPercent) * 100)}%`,
                    },
                  ]}
                />
              </View>

              {fuel.fuelLevelPercent === null
                ? renderRow(
                    "Fuel level",
                    "Not reported by this vehicle",
                    "fuel-level-missing",
                  )
                : renderRow(
                    "Fuel remaining",
                    `${formatLitres(fuel.litresRemaining)} L of ${formatLitres(
                      fuelProfile.tankCapacityL,
                    )} L`,
                    "fuel-remaining",
                  )}
              {renderRow(
                "Consumption used",
                `${formatConsumption(fuel.consumption.l100)} L/100 km`,
                "fuel-consumption",
              )}
              <Text style={[styles.cardBody, { color: Colors.textSecondary, marginTop: 8 }]}>
                Range is worked out from a {formatLitres(fuelProfile.tankCapacityL)} L tank
                at {formatConsumption(fuel.consumption.l100)} L/100 km —{" "}
                {CONSUMPTION_SOURCE_LABEL[fuel.consumption.source]}. OBD-II publishes
                neither tank size nor distance to empty, so this is the app&apos;s own
                estimate, not the figure on your dashboard.
              </Text>
              {fuel.odometerKm === null ? (
                <>
                  <Text style={[styles.cardBody, { color: Colors.textSecondary, marginTop: 8 }]}>
                    This vehicle does not answer the odometer parameter (mode 01 PID A6).
                    Most cars built before the late 2010s keep the odometer on the
                    instrument cluster and never put it on the diagnostic bus.
                  </Text>
                  {fuel.distanceSinceClearedKm !== null
                    ? renderRow(
                        "Distance since codes cleared",
                        `${formatKm(fuel.distanceSinceClearedKm)} km`,
                        "distance-since-cleared",
                      )
                    : null}
                </>
              ) : null}
            </View>

            {/* --- Identity --- */}
            {sectionHeader("VEHICLE IDENTITY")}
            <View style={[styles.card, cardStyle]} testID="vehicle-info-identity">
              <View style={styles.cardHeader}>
                <Car color={Colors.text} size={18} />
                <Text style={[styles.cardTitle, { color: Colors.text }]}>
                  {report.vin && isLikelyVin(report.vin) ? report.vin : "Identity"}
                </Text>
              </View>
              {report.identity.length === 0 ? (
                <Text style={[styles.cardBody, { color: Colors.textSecondary }]}>
                  This vehicle did not answer any mode 09 identity request. Plenty of
                  pre-2010 vehicles do not implement it.
                </Text>
              ) : (
                report.identity.map((item) => renderRow(item.label, item.value, item.key))
              )}
              {vinDetails ? (
                <>
                  {renderRow(
                    "Manufacturer code (WMI)",
                    vinDetails.region
                      ? `${vinDetails.wmi} · ${vinDetails.region}`
                      : vinDetails.wmi,
                    "wmi",
                  )}
                  {vinDetails.modelYears.length > 0
                    ? renderRow(
                        "Model year",
                        vinDetails.modelYears.length > 1
                          ? `${vinDetails.modelYears.join(" or ")} (the VIN year code repeats every 30 years)`
                          : String(vinDetails.modelYears[0]),
                        "model-year",
                      )
                    : null}
                  {renderRow("Assembly plant", vinDetails.plantCode, "plant")}
                  {renderRow("Serial", vinDetails.serial, "serial")}
                </>
              ) : null}
            </View>

            {/* --- Fault codes --- */}
            {sectionHeader("DIAGNOSTIC TROUBLE CODES")}
            <View style={[styles.card, cardStyle]} testID="vehicle-info-dtcs">
              <View style={styles.cardHeader}>
                {totalCodes > 0 ? (
                  <AlertTriangle color="#F59E0B" size={18} />
                ) : (
                  <ShieldCheck color="#22C55E" size={18} />
                )}
                <Text style={[styles.cardTitle, { color: Colors.text }]}>
                  {totalCodes > 0
                    ? `${totalCodes} code${totalCodes === 1 ? "" : "s"} reported`
                    : "No fault codes"}
                </Text>
              </View>
              {DTC_MODES.map((store) => {
                const codes = report.dtcs[store.key];
                if (!codes) return null;
                return (
                  <View key={store.key} style={styles.dtcStore}>
                    <Text style={[styles.dtcStoreTitle, { color: Colors.text }]}>
                      {store.label}
                      {codes.length > 0 ? ` (${codes.length})` : ""}
                    </Text>
                    <Text style={[styles.dtcStoreHint, { color: Colors.textSecondary }]}>
                      {store.hint}
                    </Text>
                    {codes.length === 0 ? (
                      <Text style={[styles.dtcNone, { color: Colors.textSecondary }]}>None</Text>
                    ) : (
                      codes.map((code) => (
                        <View
                          key={code}
                          style={[styles.dtcRow, { borderTopColor: Colors.border }]}
                        >
                          <Text style={[styles.dtcCode, { color: "#F59E0B" }]}>{code}</Text>
                          <Text
                            style={[styles.dtcDescription, { color: Colors.textSecondary }]}
                          >
                            {describeDtc(code)}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                );
              })}
            </View>

            {/* --- Readiness --- */}
            {report.monitor ? (
              <>
                {sectionHeader("EMISSIONS READINESS")}
                <View style={[styles.card, cardStyle]} testID="vehicle-info-readiness">
                  <View style={styles.cardHeader}>
                    <Gauge color={Colors.text} size={18} />
                    <Text style={[styles.cardTitle, { color: Colors.text }]}>
                      Check-engine light {report.monitor.milOn ? "on" : "off"}
                    </Text>
                  </View>
                  <Text style={[styles.cardBody, { color: Colors.textSecondary }]}>
                    {report.monitor.dtcCount} confirmed emission fault
                    {report.monitor.dtcCount === 1 ? "" : "s"} stored ·{" "}
                    {report.monitor.compressionIgnition
                      ? "compression ignition (diesel)"
                      : "spark ignition (petrol)"}
                  </Text>
                  <View style={styles.monitorGrid}>
                    {report.monitor.monitors
                      .filter((m) => m.supported)
                      .map((m) => (
                        <View
                          key={m.key}
                          style={[
                            styles.monitorChip,
                            {
                              borderColor: m.complete ? "#22C55E" : "#F59E0B",
                              backgroundColor: (m.complete ? "#22C55E" : "#F59E0B") + "18",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.monitorChipText,
                              { color: m.complete ? "#22C55E" : "#F59E0B" },
                            ]}
                          >
                            {m.label} · {m.complete ? "ready" : "not ready"}
                          </Text>
                        </View>
                      ))}
                  </View>
                </View>
              </>
            ) : null}

            {/* --- Live parameters --- */}
            {sectionHeader(
              `PARAMETERS (${report.readings.length} of ${report.supportedPids.length} supported)`,
            )}
            {readingSections.map((section) => (
              <View
                key={section.group}
                style={[styles.card, cardStyle]}
                testID={`vehicle-info-group-${section.group}`}
              >
                <Text style={[styles.cardTitle, { color: Colors.text, marginBottom: 4 }]}>
                  {PID_GROUP_LABEL[section.group]}
                </Text>
                {section.readings.map((reading) =>
                  renderRow(
                    reading.known ? reading.label : `${reading.label} (raw)`,
                    reading.value,
                    reading.pid,
                  ),
                )}
              </View>
            ))}
            {report.unreadablePids.length > 0 ? (
              <Text style={[styles.footnote, { color: Colors.textSecondary }]}>
                {report.unreadablePids.length} parameter
                {report.unreadablePids.length === 1 ? "" : "s"} the vehicle lists as
                supported did not answer this pass:{" "}
                {report.unreadablePids.join(", ")}.
              </Text>
            ) : null}
          </>
        ) : null}

        {/* --- Writes --- */}
        {sectionHeader("WRITE TO VEHICLE")}
        <View style={[styles.card, cardStyle, styles.listCard]} testID="vehicle-info-writes">
          {VEHICLE_WRITE_ACTIONS.map((action, idx) => {
            const availability = evaluateWriteAvailability(action, writeContext);
            const Icon = WRITE_ICON[action.id];
            return (
              <TouchableOpacity
                key={action.id}
                style={[
                  styles.writeRow,
                  idx > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: Colors.border,
                  },
                  !availability.allowed && styles.writeRowDisabled,
                ]}
                disabled={!availability.allowed}
                onPress={() => {
                  setWriteResult(null);
                  setPendingWrite(action);
                }}
                activeOpacity={0.7}
                testID={`vehicle-info-write-${action.id}`}
              >
                <Icon
                  color={
                    !availability.allowed
                      ? Colors.textSecondary
                      : action.destructive
                        ? "#EF4444"
                        : Colors.text
                  }
                  size={20}
                />
                <View style={styles.writeInfo}>
                  <View style={styles.writeTitleRow}>
                    <Text style={[styles.writeTitle, { color: Colors.text }]}>
                      {action.label}
                    </Text>
                    <View
                      style={[
                        styles.targetBadge,
                        {
                          borderColor:
                            action.target === "vehicle" ? "#EF4444" : Colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.targetBadgeText,
                          {
                            color:
                              action.target === "vehicle" ? "#EF4444" : Colors.textSecondary,
                          },
                        ]}
                      >
                        {action.target === "vehicle" ? "ECU" : "Reader"}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.writeDescription, { color: Colors.textSecondary }]}>
                    {action.description}
                  </Text>
                  {!availability.allowed && availability.reason ? (
                    <Text style={styles.writeBlocked}>{availability.reason}</Text>
                  ) : null}
                </View>
                {availability.allowed ? (
                  <ChevronRight color={Colors.textSecondary} size={18} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[styles.footnote, { color: Colors.textSecondary }]}>
          Generic OBD-II defines exactly one write every vehicle must accept — clearing
          diagnostic information. Anything a workshop tool appears to reprogram beyond
          that is manufacturer-specific and outside what this reader can safely be asked
          to do.
        </Text>
      </ScrollView>

      {/* --- Warning / confirmation popup --- */}
      <Modal
        visible={!!pendingWrite}
        transparent
        animationType="fade"
        onRequestClose={closeWriteModal}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalRoot}
        >
          <View style={styles.modalBackdrop} />
          <View style={[styles.warnCard, { backgroundColor: Colors.secondary }]}>
            <View style={styles.warnHeader}>
              <View style={styles.warnHeaderLeft}>
                <AlertTriangle
                  color={pendingWrite?.destructive ? "#EF4444" : "#F59E0B"}
                  size={22}
                />
                <Text style={[styles.warnTitle, { color: Colors.text }]}>
                  {pendingWrite?.warningTitle}
                </Text>
              </View>
              <TouchableOpacity
                onPress={closeWriteModal}
                style={[
                  styles.sheetClose,
                  { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" },
                ]}
                testID="vehicle-info-write-close"
              >
                <X color={Colors.text} size={18} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.warnScroll}>
              <Text style={[styles.warnBody, { color: Colors.textSecondary }]}>
                {pendingWrite?.warningBody}
              </Text>

              {pendingWrite?.id === "raw-command" ? (
                <>
                  <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                    COMMAND
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      { color: Colors.text, borderColor: Colors.border },
                    ]}
                    value={rawCommand}
                    onChangeText={setRawCommand}
                    placeholder="e.g. 0100 or ATRV"
                    placeholderTextColor={Colors.textSecondary}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={24}
                    testID="vehicle-info-raw-input"
                  />
                  {rawCommandCheck && !rawCommandCheck.ok ? (
                    <Text style={styles.writeBlocked}>{rawCommandCheck.error}</Text>
                  ) : null}
                  {rawCommandCheck?.ok ? (
                    <Text
                      style={[
                        styles.warnHint,
                        { color: rawCommandCheck.write ? "#EF4444" : Colors.textSecondary },
                      ]}
                    >
                      {rawCommandCheck.target === "adapter"
                        ? "Adapter command — this configures the reader and never reaches the vehicle."
                        : rawCommandCheck.write
                          ? "This is a writing service. It will change something in the vehicle."
                          : "Read-only OBD-II request — it asks the vehicle a question."}
                    </Text>
                  ) : null}
                </>
              ) : null}

              {pendingWrite?.id === "set-protocol" ? (
                <>
                  <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                    PROTOCOL
                  </Text>
                  <View style={[styles.protocolList, { borderColor: Colors.border }]}>
                    {PROTOCOL_CHOICES.map((choice, idx) => (
                      <TouchableOpacity
                        key={choice.code}
                        style={[
                          styles.protocolRow,
                          idx > 0 && {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: Colors.border,
                          },
                        ]}
                        onPress={() => setProtocolCode(choice.code)}
                        testID={`vehicle-info-protocol-${choice.code}`}
                      >
                        <Text style={[styles.protocolLabel, { color: Colors.text }]}>
                          {choice.label}
                        </Text>
                        {protocolCode === choice.code ? (
                          <Check color={Colors.accent} size={18} strokeWidth={3} />
                        ) : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : null}

              {writeResult ? (
                <View
                  style={[
                    styles.resultBox,
                    {
                      borderColor: writeResult.ok ? "#22C55E" : "#EF4444",
                      backgroundColor: (writeResult.ok ? "#22C55E" : "#EF4444") + "14",
                    },
                  ]}
                  testID="vehicle-info-write-result"
                >
                  <Text
                    style={[
                      styles.resultText,
                      { color: writeResult.ok ? "#22C55E" : "#EF4444" },
                    ]}
                  >
                    {writeResult.message}
                  </Text>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.warnActions}>
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: Colors.border }]}
                onPress={closeWriteModal}
                testID="vehicle-info-write-cancel"
              >
                <Text style={[styles.secondaryButtonText, { color: Colors.text }]}>
                  {writeResult ? "Close" : "Cancel"}
                </Text>
              </TouchableOpacity>
              {oneShotDone ? null : (
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    styles.warnConfirm,
                    {
                      backgroundColor: pendingWrite?.destructive ? "#EF4444" : Colors.accent,
                    },
                    writing && styles.buttonDisabled,
                  ]}
                  disabled={writing}
                  onPress={() => {
                    if (pendingWrite) void performWrite(pendingWrite);
                  }}
                  testID="vehicle-info-write-confirm"
                >
                  <Pencil color={pendingWrite?.destructive ? "#FFFFFF" : Colors.onAccent} size={16} />
                  <Text
                    style={[
                      styles.primaryButtonText,
                      { color: pendingWrite?.destructive ? "#FFFFFF" : Colors.onAccent },
                    ]}
                  >
                    {writing
                      ? "Writing…"
                      : writeResult && pendingWrite?.id === "raw-command"
                        ? "Send again"
                        : (pendingWrite?.confirmLabel ?? "Confirm")}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* --- Tank & consumption --- */}
      <Modal
        visible={fuelEditOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFuelEditOpen(false)}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalRoot}
        >
          <View style={styles.modalBackdrop} />
          <View style={[styles.warnCard, { backgroundColor: Colors.secondary }]}>
            <View style={styles.warnHeader}>
              <View style={styles.warnHeaderLeft}>
                <Fuel color={Colors.accent} size={22} />
                <Text style={[styles.warnTitle, { color: Colors.text }]}>
                  Tank &amp; consumption
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setFuelEditOpen(false)}
                style={[
                  styles.sheetClose,
                  { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" },
                ]}
                testID="vehicle-info-fuel-close"
              >
                <X color={Colors.text} size={18} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.warnScroll}>
              <Text style={[styles.warnBody, { color: Colors.textSecondary }]}>
                The vehicle reports how full the tank is, but never how big it is or
                how much fuel it takes to move — so the remaining kilometres need these
                two numbers. Both are in your owner&apos;s manual.
              </Text>

              <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                TANK CAPACITY (LITRES)
              </Text>
              <TextInput
                style={[styles.input, { color: Colors.text, borderColor: Colors.border }]}
                value={tankInput}
                onChangeText={setTankInput}
                placeholder="e.g. 45"
                placeholderTextColor={Colors.textSecondary}
                keyboardType="decimal-pad"
                maxLength={6}
                testID="vehicle-info-tank-input"
              />

              <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                AVERAGE CONSUMPTION (L/100 KM)
              </Text>
              <TextInput
                style={[styles.input, { color: Colors.text, borderColor: Colors.border }]}
                value={consumptionInput}
                onChangeText={setConsumptionInput}
                placeholder="e.g. 8.0"
                placeholderTextColor={Colors.textSecondary}
                keyboardType="decimal-pad"
                maxLength={5}
                testID="vehicle-info-consumption-input"
              />

              {fuelProfile.measuredL100 !== null ? (
                <View style={[styles.measuredBox, { borderColor: Colors.border }]}>
                  <Text style={[styles.cardBody, { color: Colors.textSecondary }]}>
                    Measured from your own driving:{" "}
                    <Text style={{ color: Colors.text, fontWeight: "700" }}>
                      {formatConsumption(fuelProfile.measuredL100)} L/100 km
                    </Text>
                    . This is used instead of the average above.
                  </Text>
                  <TouchableOpacity
                    onPress={() => void clearMeasuredConsumption()}
                    style={styles.measuredReset}
                    testID="vehicle-info-reset-measured"
                  >
                    <RotateCcw color={Colors.accent} size={14} />
                    <Text style={[styles.measuredResetText, { color: Colors.accent }]}>
                      Start measuring again
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={[styles.warnHint, { color: Colors.textSecondary, marginTop: 12 }]}>
                  Once this reader has seen the odometer and the fuel gauge across a
                  long enough stretch of driving, the app measures your real
                  consumption and uses that instead.
                </Text>
              )}

              {fuelEditError ? (
                <Text style={styles.writeBlocked} testID="vehicle-info-fuel-error">
                  {fuelEditError}
                </Text>
              ) : null}
            </ScrollView>

            <View style={styles.warnActions}>
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: Colors.border }]}
                onPress={() => setFuelEditOpen(false)}
                testID="vehicle-info-fuel-cancel"
              >
                <Text style={[styles.secondaryButtonText, { color: Colors.text }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: Colors.accent }]}
                onPress={() => void saveFuelEditor()}
                testID="vehicle-info-fuel-save"
              >
                <Text style={[styles.primaryButtonText, { color: Colors.onAccent }]}>
                  Save
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerButton: { width: 32, height: 32, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 16,
  },
  listCard: { padding: 0 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
  cardBody: { fontSize: 13, lineHeight: 19 },
  statusLine: { fontSize: 14, fontWeight: "600", marginBottom: 4 },
  sectionHeader: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, marginBottom: 8 },
  dataRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dataLabel: { fontSize: 13, flex: 1 },
  dataValue: { fontSize: 13, fontWeight: "600", flexShrink: 0, maxWidth: "52%", textAlign: "right" },
  inlineEdit: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingLeft: 8,
  },
  inlineEditText: { fontSize: 12, fontWeight: "600" },
  statRow: { flexDirection: "row", alignItems: "stretch", marginTop: 4, marginBottom: 12 },
  stat: { flex: 1, alignItems: "center", gap: 4, paddingHorizontal: 4 },
  statDivider: { borderLeftWidth: StyleSheet.hairlineWidth },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 11, textAlign: "center" },
  fuelTrack: { height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 4 },
  fuelFill: { height: 6, borderRadius: 3 },
  measuredBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  measuredReset: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  measuredResetText: { fontSize: 13, fontWeight: "600" },
  progressBlock: { marginTop: 14 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  progressLabel: { fontSize: 12, flex: 1 },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  errorText: { fontSize: 13, lineHeight: 19, color: "#EF4444", marginTop: 12 },
  footnote: { fontSize: 12, lineHeight: 18, marginBottom: 20 },
  dtcStore: { marginTop: 12 },
  dtcStoreTitle: { fontSize: 14, fontWeight: "700" },
  dtcStoreHint: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  dtcNone: { fontSize: 13, marginTop: 6 },
  dtcRow: { paddingVertical: 8, marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth },
  dtcCode: { fontSize: 15, fontWeight: "700" },
  dtcDescription: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  monitorGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  monitorChip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  monitorChipText: { fontSize: 11, fontWeight: "600" },
  writeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  writeRowDisabled: { opacity: 0.55 },
  writeInfo: { flex: 1 },
  writeTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  writeTitle: { fontSize: 15, fontWeight: "600" },
  targetBadge: {
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  targetBadgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  writeDescription: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  writeBlocked: { fontSize: 12, lineHeight: 17, marginTop: 6, color: "#F59E0B" },
  modalRoot: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  warnCard: {
    borderRadius: 18,
    padding: 20,
    maxHeight: "86%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  warnHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  warnHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  warnTitle: { fontSize: 17, fontWeight: "700", flex: 1 },
  warnScroll: { marginTop: 12 },
  warnBody: { fontSize: 14, lineHeight: 21 },
  warnHint: { fontSize: 12, lineHeight: 17, marginBottom: 8 },
  warnActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  warnConfirm: { flexDirection: "row", gap: 8 },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 8,
  },
  protocolList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    marginBottom: 8,
  },
  protocolRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  protocolLabel: { fontSize: 14, flex: 1 },
  resultBox: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginTop: 14,
  },
  resultText: { fontSize: 13, lineHeight: 19 },
  primaryButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: { fontSize: 15, fontWeight: "700" },
  secondaryButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: { fontSize: 15, fontWeight: "600" },
  buttonDisabled: { opacity: 0.6 },
});
