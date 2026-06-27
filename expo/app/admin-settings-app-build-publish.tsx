import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import * as Application from "expo-application";
import {
  ArrowLeft,
  Rocket,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCcw,
  Hammer,
  Store,
  Apple,
  Smartphone,
  ChevronRight,
  ExternalLink,
  Copy,
  Info,
  Play,
} from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { useColors } from "@/hooks/useColors";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Status = "idle" | "running" | "ok" | "fail";

interface BuildEntry {
  id: string;
  platform: "ios" | "android";
  version: string;
  status: "queued" | "building" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  artifactUrl?: string;
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AdminSettingsAppBuildPublishScreen() {
  const router = useRouter();
  const Colors = useColors();

  const appVersion = Application.nativeApplicationVersion ?? "?";
  const buildVersion = Application.nativeBuildVersion ?? "?";

  // Build state
  const [buildStatus, setBuildStatus] = useState<Status>("idle");
  const [buildMsg, setBuildMsg] = useState<string>("");
  const [buildHistory, setBuildHistory] = useState<BuildEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(true);

  // Publish state
  const [iosPublishStatus, setIosPublishStatus] = useState<Status>("idle");
  const [iosPublishMsg, setIosPublishMsg] = useState<string>("");
  const [androidPublishStatus, setAndroidPublishStatus] = useState<Status>("idle");
  const [androidPublishMsg, setAndroidPublishMsg] = useState<string>("");

  // Settings
  const [autoPublish, setAutoPublish] = useState<boolean>(false);

  /* ---------------------------------------------------------------- */
  /*  Derived                                                          */
  /* ---------------------------------------------------------------- */

  const toolkitUrl = useMemo<string>(
    () => process.env.EXPO_PUBLIC_TOOLKIT_URL ?? "https://toolkit.rork.com",
    []
  );

  const projectId = useMemo<string>(
    () => process.env.EXPO_PUBLIC_PROJECT_ID ?? "",
    []
  );

  /* ---------------------------------------------------------------- */
  /*  Safe JSON helper — prevents crashes on non-JSON responses       */
  /* ---------------------------------------------------------------- */

  const safeJson = useCallback(async <T,>(res: Response): Promise<T | null> => {
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      // Response was not valid JSON (likely HTML or plain text)
      console.log("[build-publish] non-JSON response", text.slice(0, 200));
      return null;
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Load build history (best-effort from toolkit if available)      */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `${toolkitUrl}/v1/projects/${projectId}/builds`,
          { headers: { Accept: "application/json" } }
        );
        if (res.ok) {
          const data = await safeJson<{ builds?: BuildEntry[] }>(res);
          if (data?.builds) setBuildHistory(data.builds);
        }
      } catch (e) {
        console.log("[build-publish] history fetch failed", e);
      } finally {
        setLoadingHistory(false);
      }
    })();
  }, [toolkitUrl, projectId, safeJson]);

  /* ---------------------------------------------------------------- */
  /*  Trigger Build                                                    */
  /* ---------------------------------------------------------------- */

  const triggerBuild = useCallback(
    async (platform: "ios" | "android") => {
      const label = platform === "ios" ? "iOS" : "Android";
      setBuildStatus("running");
      setBuildMsg(`Attempting ${label} build via Rork CI…`);

      try {
        const res = await fetch(
          `${toolkitUrl}/v1/projects/${projectId}/builds`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ platform }),
          }
        );

        const data = await safeJson<{
          ok?: boolean;
          buildId?: string;
          error?: string;
        }>(res);

        if (data && res.ok && data.ok !== false && data.buildId) {
          setBuildStatus("ok");
          setBuildMsg(
            `${label} build triggered (${data.buildId}). Build will appear in history soon.`
          );
        } else if (data?.error) {
          setBuildStatus("fail");
          setBuildMsg(data.error);
        } else if (!data) {
          // Non-JSON response — API not available
          setBuildStatus("fail");
          setBuildMsg(
            `Build API not available from within the app. ${label} builds are triggered through the Rork AI agent — ask your agent to run a build for you.`
          );
        } else {
          setBuildStatus("fail");
          setBuildMsg(`Failed to trigger ${label} build (HTTP ${res.status}).`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setBuildStatus("fail");
        setBuildMsg(`Network error: ${msg}`);
      }
    },
    [toolkitUrl, projectId, safeJson]
  );

  /* ---------------------------------------------------------------- */
  /*  Publish to App Store                                             */
  /* ---------------------------------------------------------------- */

  const publishToAppStore = useCallback(async () => {
    setIosPublishStatus("running");
    setIosPublishMsg("Attempting App Store submission via Rork…");

    try {
      const res = await fetch(
        `${toolkitUrl}/v1/projects/${projectId}/publish/ios`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoSubmit: autoPublish }),
        }
      );

      const data = await safeJson<{
        ok?: boolean;
        submissionId?: string;
        error?: string;
      }>(res);

      if (data && res.ok && data.ok !== false) {
        setIosPublishStatus("ok");
        setIosPublishMsg(
          data.submissionId
            ? `Submitted (${data.submissionId}). Check TestFlight in ~30 min.`
            : "Publish request accepted. Check the App Store Connect dashboard."
        );
      } else if (data?.error) {
        setIosPublishStatus("fail");
        setIosPublishMsg(data.error);
      } else if (!data) {
        setIosPublishStatus("fail");
        setIosPublishMsg(
          "App Store publishing is not available from within the app. Ask your Rork agent to publish your app to TestFlight or the App Store."
        );
      } else {
        setIosPublishStatus("fail");
        setIosPublishMsg(`Publish failed (HTTP ${res.status}).`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setIosPublishStatus("fail");
      setIosPublishMsg(`Network error: ${msg}`);
    }
  }, [toolkitUrl, projectId, autoPublish, safeJson]);

  /* ---------------------------------------------------------------- */
  /*  Publish to Play Store                                            */
  /* ---------------------------------------------------------------- */

  const publishToPlayStore = useCallback(async () => {
    setAndroidPublishStatus("running");
    setAndroidPublishMsg("Attempting Google Play submission via Rork…");

    try {
      const res = await fetch(
        `${toolkitUrl}/v1/projects/${projectId}/publish/android`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ track: "internal" }),
        }
      );

      const data = await safeJson<{
        ok?: boolean;
        releaseId?: string;
        error?: string;
      }>(res);

      if (data && res.ok && data.ok !== false) {
        setAndroidPublishStatus("ok");
        setAndroidPublishMsg(
          data.releaseId
            ? `Published to internal track (${data.releaseId}).`
            : "Publish request accepted. Check the Google Play Console."
        );
      } else if (data?.error) {
        setAndroidPublishStatus("fail");
        setAndroidPublishMsg(data.error);
      } else if (!data) {
        setAndroidPublishStatus("fail");
        setAndroidPublishMsg(
          "Google Play publishing is not available from within the app. Ask your Rork agent to publish your app to Google Play."
        );
      } else {
        setAndroidPublishStatus("fail");
        setAndroidPublishMsg(`Publish failed (HTTP ${res.status}).`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setAndroidPublishStatus("fail");
      setAndroidPublishMsg(`Network error: ${msg}`);
    }
  }, [toolkitUrl, projectId, safeJson]);

  /* ---------------------------------------------------------------- */
  /*  Refresh build history                                            */
  /* ---------------------------------------------------------------- */

  const refreshHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(
        `${toolkitUrl}/v1/projects/${projectId}/builds`,
        { headers: { Accept: "application/json" } }
      );
      if (res.ok) {
        const data = await safeJson<{ builds?: BuildEntry[] }>(res);
        if (data?.builds) setBuildHistory(data.builds);
      }
    } catch (e) {
      console.log("[build-publish] refresh failed", e);
    } finally {
      setLoadingHistory(false);
    }
  }, [toolkitUrl, projectId, safeJson]);

  /* ---------------------------------------------------------------- */
  /*  Helpers                                                          */
  /* ---------------------------------------------------------------- */

  const statusIcon = (s: Status) => {
    switch (s) {
      case "ok":
        return <CheckCircle2 color={Colors.success} size={18} />;
      case "fail":
        return <XCircle color={Colors.error} size={18} />;
      case "running":
        return <ActivityIndicator color={Colors.accent} size="small" />;
      default:
        return <Info color={Colors.textSecondary} size={18} />;
    }
  };

  const statusColor = (s: Status) => {
    switch (s) {
      case "ok":
        return Colors.success;
      case "fail":
        return Colors.error;
      case "running":
        return Colors.accent;
      default:
        return Colors.textSecondary;
    }
  };

  const buildStatusBadge = (s: BuildEntry["status"]) => {
    switch (s) {
      case "completed":
        return { label: "Completed", color: Colors.success };
      case "failed":
        return { label: "Failed", color: Colors.error };
      case "building":
        return { label: "Building", color: Colors.accent };
      default:
        return { label: "Queued", color: Colors.warning ?? "#F59E0B" };
    }
  };

  const copyReport = useCallback(async () => {
    const lines = [
      `=== TEKSI Build & Publish Report ===`,
      `App Version: ${appVersion} (build ${buildVersion})`,
      `Project: ${projectId}`,
      `Platform: ${Platform.OS}`,
      ``,
      `--- Build ---`,
      `Status: ${buildStatus} — ${buildMsg || "idle"}`,
      ``,
      `--- Publish ---`,
      `iOS: ${iosPublishStatus} — ${iosPublishMsg || "idle"}`,
      `Android: ${androidPublishStatus} — ${androidPublishMsg || "idle"}`,
      ``,
      `--- Build History (last 10) ---`,
      ...buildHistory.slice(0, 10).map(
        (b) =>
          `[${b.platform.toUpperCase()}] ${b.version} — ${b.status} — ${b.startedAt}`
      ),
    ].join("\n");

    try {
      await Clipboard.setStringAsync(lines);
      if (Platform.OS !== "web") Alert.alert("Copied", "Report copied to clipboard.");
    } catch (e) {
      console.log("[build-publish] copy failed", e);
    }
  }, [
    appVersion,
    buildVersion,
    projectId,
    buildStatus,
    buildMsg,
    iosPublishStatus,
    iosPublishMsg,
    androidPublishStatus,
    androidPublishMsg,
    buildHistory,
  ]);

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: Colors.background }]}
      edges={["top", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="build-publish-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Rocket color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>
              App Build & Publish
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            Trigger builds and publish to stores
          </Text>
        </View>
        <TouchableOpacity
          onPress={copyReport}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="build-publish-copy"
        >
          <Copy color={Colors.textSecondary} size={18} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* App Info Card */}
        <View
          style={[
            styles.infoCard,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
        >
          <View style={styles.infoRow}>
            <View style={styles.infoItem}>
              <Text style={[styles.infoLabel, { color: Colors.textSecondary }]}>
                Version
              </Text>
              <Text style={[styles.infoValue, { color: Colors.text }]}>
                {appVersion}
              </Text>
            </View>
            <View style={[styles.infoDivider, { backgroundColor: Colors.border }]} />
            <View style={styles.infoItem}>
              <Text style={[styles.infoLabel, { color: Colors.textSecondary }]}>
                Build
              </Text>
              <Text style={[styles.infoValue, { color: Colors.text }]}>
                {buildVersion}
              </Text>
            </View>
            <View style={[styles.infoDivider, { backgroundColor: Colors.border }]} />
            <View style={styles.infoItem}>
              <Text style={[styles.infoLabel, { color: Colors.textSecondary }]}>
                Platform
              </Text>
              <Text style={[styles.infoValue, { color: Colors.text }]}>
                {Platform.OS === "ios" ? "iOS" : "Android"}
              </Text>
            </View>
          </View>
        </View>

        {/* Build Section */}
        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Build</Text>
        <View
          style={[
            styles.statusCard,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
        >
          <View style={styles.statusRow}>
            {statusIcon(buildStatus)}
            <Text
              style={[styles.statusText, { color: statusColor(buildStatus) }]}
              numberOfLines={3}
            >
              {buildStatus === "idle"
                ? "Trigger a new build for iOS or Android on Rork CI."
                : buildMsg}
            </Text>
          </View>

          <View style={styles.actionGroup}>
            <TouchableOpacity
              onPress={() => triggerBuild("ios")}
              disabled={buildStatus === "running"}
              style={[
                styles.actionBtn,
                {
                  backgroundColor: Colors.accent,
                  opacity: buildStatus === "running" ? 0.6 : 1,
                },
              ]}
              testID="build-trigger-ios"
            >
              <Apple color="#fff" size={16} />
              <Text style={styles.actionBtnText}>Build iOS</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => triggerBuild("android")}
              disabled={buildStatus === "running"}
              style={[
                styles.actionBtn,
                {
                  backgroundColor: Colors.success,
                  opacity: buildStatus === "running" ? 0.6 : 1,
                },
              ]}
              testID="build-trigger-android"
            >
              <Smartphone color="#fff" size={16} />
              <Text style={styles.actionBtnText}>Build Android</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Publish Section */}
        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Publish</Text>

        {/* iOS Publish */}
        <View
          style={[
            styles.statusCard,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
        >
          <View style={styles.statusRow}>
            {statusIcon(iosPublishStatus)}
            <View style={{ flex: 1 }}>
              <Text style={[styles.publishLabel, { color: Colors.text }]}>
                App Store (iOS)
              </Text>
              <Text
                style={[
                  styles.statusText,
                  { color: statusColor(iosPublishStatus) },
                ]}
                numberOfLines={2}
              >
                {iosPublishStatus === "idle"
                  ? "Submit the latest iOS build to App Store Connect."
                  : iosPublishMsg}
              </Text>
            </View>
          </View>

          <View style={styles.actionGroup}>
            <TouchableOpacity
              onPress={publishToAppStore}
              disabled={iosPublishStatus === "running"}
              style={[
                styles.actionBtn,
                {
                  backgroundColor: Colors.accent,
                  opacity: iosPublishStatus === "running" ? 0.6 : 1,
                },
              ]}
              testID="publish-ios"
            >
              <Store color="#fff" size={16} />
              <Text style={styles.actionBtnText}>Publish to App Store</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Android Publish */}
        <View
          style={[
            styles.statusCard,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
        >
          <View style={styles.statusRow}>
            {statusIcon(androidPublishStatus)}
            <View style={{ flex: 1 }}>
              <Text style={[styles.publishLabel, { color: Colors.text }]}>
                Google Play (Android)
              </Text>
              <Text
                style={[
                  styles.statusText,
                  { color: statusColor(androidPublishStatus) },
                ]}
                numberOfLines={2}
              >
                {androidPublishStatus === "idle"
                  ? "Submit the latest Android build to Google Play (internal track)."
                  : androidPublishMsg}
              </Text>
            </View>
          </View>

          <View style={styles.actionGroup}>
            <TouchableOpacity
              onPress={publishToPlayStore}
              disabled={androidPublishStatus === "running"}
              style={[
                styles.actionBtn,
                {
                  backgroundColor: Colors.success,
                  opacity: androidPublishStatus === "running" ? 0.6 : 1,
                },
              ]}
              testID="publish-android"
            >
              <Store color="#fff" size={16} />
              <Text style={styles.actionBtnText}>Publish to Play Store</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Auto-publish toggle */}
        <TouchableOpacity
          onPress={() => setAutoPublish((v) => !v)}
          activeOpacity={0.85}
          style={[
            styles.toggleRow,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.toggleLabel, { color: Colors.text }]}>
              Auto-submit after build
            </Text>
            <Text style={[styles.toggleDesc, { color: Colors.textSecondary }]}>
              Automatically submit for review after a successful build
            </Text>
          </View>
          <View
            style={[
              styles.toggle,
              { backgroundColor: autoPublish ? Colors.accent : Colors.border },
            ]}
          >
            <View
              style={[
                styles.toggleKnob,
                { transform: [{ translateX: autoPublish ? 18 : 2 }] },
              ]}
            />
          </View>
        </TouchableOpacity>

        {/* Build History */}
        <View style={styles.historyHeader}>
          <Text style={[styles.sectionTitle, { color: Colors.text, flex: 1 }]}>
            Build History
          </Text>
          <TouchableOpacity
            onPress={refreshHistory}
            style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
            testID="refresh-history"
          >
            <RefreshCcw color={Colors.textSecondary} size={16} />
          </TouchableOpacity>
        </View>

        {loadingHistory ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : buildHistory.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: Colors.gray[100], borderColor: Colors.border },
            ]}
          >
            <Clock color={Colors.textSecondary} size={20} />
            <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
              No builds yet. Trigger one above to get started.
            </Text>
          </View>
        ) : (
          <View style={styles.historyList}>
            {buildHistory.slice(0, 10).map((entry) => {
              const badge = buildStatusBadge(entry.status);
              return (
                <TouchableOpacity
                  key={entry.id}
                  style={[
                    styles.historyRow,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (entry.artifactUrl) {
                      Alert.alert(
                        "Artifact",
                        `URL: ${entry.artifactUrl}\n\nTap Copy Report above to copy this info.`
                      );
                    }
                  }}
                >
                  <View style={styles.historyLeft}>
                    <View
                      style={[
                        styles.platformBadge,
                        {
                          backgroundColor:
                            entry.platform === "ios"
                              ? Colors.accent + "20"
                              : Colors.success + "20",
                        },
                      ]}
                    >
                      {entry.platform === "ios" ? (
                        <Apple color={Colors.accent} size={14} />
                      ) : (
                        <Smartphone color={Colors.success} size={14} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.historyVersion, { color: Colors.text }]}>
                        v{entry.version}
                      </Text>
                      <Text
                        style={[
                          styles.historyDate,
                          { color: Colors.textSecondary },
                        ]}
                      >
                        {formatDate(entry.startedAt)}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: badge.color + "20" },
                    ]}
                  >
                    <Text style={[styles.badgeText, { color: badge.color }]}>
                      {badge.label}
                    </Text>
                  </View>
                  {entry.artifactUrl ? (
                    <ExternalLink
                      color={Colors.textSecondary}
                      size={14}
                      style={{ marginLeft: 8 }}
                    />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <Text style={[styles.helper, { color: Colors.textSecondary }]}>
          Builds run on Rork CI. iOS builds produce an IPA for App Store
          Connect; Android builds produce an AAB for Google Play. Publishing
          submits the latest successful build to the respective store.
        </Text>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 16 },

  /* App Info */
  infoCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 18,
  },
  infoRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  infoItem: { flex: 1, alignItems: "center" as const },
  infoLabel: { fontSize: 11, fontWeight: "600" as const, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  infoValue: { fontSize: 16, fontWeight: "800" as const, marginTop: 4 },
  infoDivider: { width: 1, height: 36 },

  /* Sections */
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800" as const,
    marginBottom: 10,
    marginTop: 4,
  },

  /* Status cards */
  statusCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
    gap: 12,
  },
  statusRow: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 10,
  },
  statusText: { fontSize: 13, flex: 1, lineHeight: 18 },
  publishLabel: { fontSize: 14, fontWeight: "700" as const, marginBottom: 2 },

  /* Action buttons */
  actionGroup: {
    flexDirection: "row" as const,
    gap: 10,
    flexWrap: "wrap" as const,
  },
  actionBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    flex: 1,
    justifyContent: "center" as const,
  },
  actionBtnText: { color: "#fff", fontWeight: "700" as const, fontSize: 13 },

  /* Toggle */
  toggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    marginTop: 4,
    marginBottom: 18,
  },
  toggleLabel: { fontSize: 14, fontWeight: "700" as const },
  toggleDesc: { fontSize: 12, marginTop: 2 },
  toggle: {
    width: 42,
    height: 24,
    borderRadius: 12,
    justifyContent: "center" as const,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
  },

  /* History */
  historyHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  historyList: { gap: 8 },
  historyRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  historyLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    flex: 1,
  },
  platformBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  historyVersion: { fontSize: 14, fontWeight: "700" as const },
  historyDate: { fontSize: 11, marginTop: 2 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: { fontSize: 11, fontWeight: "700" as const },

  /* Empty */
  loadingWrap: {
    paddingVertical: 32,
    alignItems: "center" as const,
  },
  emptyCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
  },
  emptyText: { fontSize: 13, flex: 1 },

  /* Helper */
  helper: { fontSize: 11, lineHeight: 16, marginTop: 8 },
});
