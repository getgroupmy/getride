import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  CheckCircle2,
  WifiOff,
  Stethoscope,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react-native";
import { MODAL_SUPPORTED_ORIENTATIONS } from "@/utils/modalOrientation";

interface ServerDetails {
  url: string;
  hasUrl: boolean;
  hasAnonKey: boolean;
  httpStatus?: number;
  errorName?: string;
  errorMessage?: string;
  durationMs?: number;
}

interface Props {
  visible: boolean;
  connected: boolean;
  errorMessage?: string | null;
  details?: ServerDetails | null;
  onClose: () => void;
  onDiagnose: () => void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || "(not set)";
  }
}

export function ConnectionStatusModal({
  visible,
  connected,
  errorMessage,
  details,
  onClose,
  onDiagnose,
}: Props) {
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [expanded, setExpanded] = useState<boolean>(false);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          friction: 7,
          tension: 80,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      scale.setValue(0.85);
      opacity.setValue(0);
      setExpanded(false);
    }
  }, [visible, scale, opacity]);

  const accent = connected ? "#10b981" : "#ef4444";
  const title = connected ? "Connected" : "Not Connected to server";
  const subtitle = connected
    ? "Successfully connected to Supabase."
    : "Couldn't reach Supabase. Continuing in local mode.";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <View style={[styles.iconWrap, { backgroundColor: `${accent}1A` }]}>
            {connected ? (
              <CheckCircle2 color={accent} size={44} strokeWidth={2.2} />
            ) : (
              <WifiOff color={accent} size={44} strokeWidth={2.2} />
            )}
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          {!connected && !(details?.hasUrl && details?.hasAnonKey) && (
            <View style={styles.reloadHint} testID="connection-reload-hint">
              <RefreshCw size={14} color="#92400e" />
              <Text style={styles.reloadHintText}>
                Reload required: Supabase env vars are missing. Set them and reload the app.
              </Text>
            </View>
          )}

          {!connected && (
            <View style={styles.errorBox} testID="connection-error-box">
              <Text style={styles.errorLabel}>Error</Text>
              <Text style={styles.errorText} numberOfLines={expanded ? 0 : 3}>
                {errorMessage ?? "Unable to reach Supabase."}
              </Text>

              <Pressable
                onPress={() => setExpanded((v) => !v)}
                style={styles.expandRow}
                testID="connection-toggle-details"
              >
                <Text style={styles.expandText}>
                  {expanded ? "Hide details" : "Show details"}
                </Text>
                {expanded ? (
                  <ChevronUp size={14} color="#475569" />
                ) : (
                  <ChevronDown size={14} color="#475569" />
                )}
              </Pressable>

              {expanded && (
                <ScrollView style={styles.detailScroll} nestedScrollEnabled>
                  <Text style={styles.detailLine}>
                    URL host: <Text style={styles.detailMono}>{hostOf(details?.url ?? "")}</Text>
                  </Text>
                  <Text style={styles.detailLine}>
                    URL set: <Text style={styles.detailMono}>{details?.hasUrl ? "yes" : "no"}</Text>
                  </Text>
                  <Text style={styles.detailLine}>
                    Anon key set:{" "}
                    <Text style={styles.detailMono}>{details?.hasAnonKey ? "yes" : "no"}</Text>
                  </Text>
                  {typeof details?.httpStatus === "number" && (
                    <Text style={styles.detailLine}>
                      HTTP status:{" "}
                      <Text style={styles.detailMono}>{details.httpStatus}</Text>
                    </Text>
                  )}
                  {details?.errorName && (
                    <Text style={styles.detailLine}>
                      Error name:{" "}
                      <Text style={styles.detailMono}>{details.errorName}</Text>
                    </Text>
                  )}
                  {typeof details?.durationMs === "number" && (
                    <Text style={styles.detailLine}>
                      Duration:{" "}
                      <Text style={styles.detailMono}>{details.durationMs}ms</Text>
                    </Text>
                  )}
                </ScrollView>
              )}
            </View>
          )}

          {!connected && (
            <Pressable
              onPress={onDiagnose}
              style={({ pressed }) => [
                styles.diagButton,
                { opacity: pressed ? 0.85 : 1 },
              ]}
              testID="connection-status-diagnose"
            >
              <Stethoscope size={18} color="#ffffff" />
              <Text style={styles.diagButtonText}>Diagnose</Text>
            </Pressable>
          )}

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: accent, opacity: pressed ? 0.85 : 1 },
            ]}
            testID="connection-status-ok"
          >
            <Text style={styles.buttonText}>{connected ? "OK" : "Continue"}</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 24,
    backgroundColor: "#ffffff",
    paddingTop: 28,
    paddingBottom: 20,
    paddingHorizontal: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: "#0f172a",
    marginBottom: 6,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 20,
  },
  errorBox: {
    width: "100%",
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  errorLabel: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: "#991b1b",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  errorText: {
    fontSize: 13,
    color: "#7f1d1d",
    lineHeight: 18,
  },
  expandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
  },
  expandText: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "600" as const,
  },
  detailScroll: {
    marginTop: 8,
    maxHeight: 140,
  },
  detailLine: {
    fontSize: 12,
    color: "#334155",
    marginBottom: 4,
  },
  detailMono: {
    fontFamily: "monospace" as const,
    color: "#0f172a",
  },
  reloadHint: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  reloadHintText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: "#92400e",
    fontWeight: "600" as const,
  },
  diagButton: {
    width: "100%",
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0f172a",
    marginBottom: 10,
  },
  diagButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600" as const,
  },
  button: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600" as const,
  },
});
