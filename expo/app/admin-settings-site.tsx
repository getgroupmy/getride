import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import {
  ArrowLeft,
  Palette,
  Sun,
  Moon,
  ImageIcon,
  Sparkles,
  MapPin,
  Save,
  RotateCcw,
  Upload,
  Check,
  Globe,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";

const STORAGE_KEY = "app-settings-v1";

interface ThemePalette {
  accent: string;
  accentDark: string;
  background: string;
  text: string;
  textSecondary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
}

interface AppSettings {
  light: ThemePalette;
  dark: ThemePalette;
  appIconUri: string | null;
  splashIconUri: string | null;
  splashBgColor: string;
  startLat: string;
  startLng: string;
}

const defaultLight: ThemePalette = {
  accent: "#2dabe2",
  accentDark: "#238baf",
  background: "#FFFFFF",
  text: "#111827",
  textSecondary: "#6B7280",
  border: "#E5E7EB",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
};

const defaultDark: ThemePalette = {
  accent: "#2dabe2",
  accentDark: "#238baf",
  background: "#000000",
  text: "#FFFFFF",
  textSecondary: "#9CA3AF",
  border: "#374151",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
};

const defaultSettings: AppSettings = {
  light: defaultLight,
  dark: defaultDark,
  appIconUri: null,
  splashIconUri: null,
  splashBgColor: "#FFFFFF",
  startLat: "3.139003",
  startLng: "101.686855",
};

const HEX_RE = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/;

function isValidHex(v: string): boolean {
  return HEX_RE.test(v.trim());
}

function isValidLatLng(lat: string, lng: string): boolean {
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  return la >= -90 && la <= 90 && lo >= -180 && lo <= 180;
}

const PALETTE_FIELDS: { key: keyof ThemePalette; label: string }[] = [
  { key: "accent", label: "Accent" },
  { key: "accentDark", label: "Accent Dark" },
  { key: "background", label: "Background" },
  { key: "text", label: "Text" },
  { key: "textSecondary", label: "Text Secondary" },
  { key: "border", label: "Border" },
  { key: "success", label: "Success" },
  { key: "warning", label: "Warning" },
  { key: "error", label: "Error" },
];

export default function AdminAppSettingsScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedTick, setSavedTick] = useState<boolean>(false);
  const [mode, setMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<AppSettings>;
          setSettings({
            light: { ...defaultLight, ...(parsed.light ?? {}) },
            dark: { ...defaultDark, ...(parsed.dark ?? {}) },
            appIconUri: parsed.appIconUri ?? null,
            splashIconUri: parsed.splashIconUri ?? null,
            splashBgColor: parsed.splashBgColor ?? defaultSettings.splashBgColor,
            startLat: parsed.startLat ?? defaultSettings.startLat,
            startLng: parsed.startLng ?? defaultSettings.startLng,
          });
        }
      } catch (e) {
        console.log("[app-settings] load error", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const updatePalette = useCallback(
    (m: "light" | "dark", key: keyof ThemePalette, value: string) => {
      setSettings((s) => ({ ...s, [m]: { ...s[m], [key]: value } }));
    },
    []
  );

  const pickImage = useCallback(
    async (target: "app" | "splash") => {
      try {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Permission required", "Photo library access is needed.");
          return;
        }
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.9,
        });
        if (res.canceled || !res.assets?.[0]?.uri) return;
        const uri = res.assets[0].uri;
        setSettings((s) =>
          target === "app" ? { ...s, appIconUri: uri } : { ...s, splashIconUri: uri }
        );
      } catch (e) {
        console.log("[app-settings] pick error", e);
        Alert.alert("Error", "Could not pick image.");
      }
    },
    []
  );

  const validate = useCallback((): string | null => {
    const palettes: [string, ThemePalette][] = [
      ["Light", settings.light],
      ["Dark", settings.dark],
    ];
    for (const [name, p] of palettes) {
      for (const f of PALETTE_FIELDS) {
        if (!isValidHex(p[f.key])) return `Invalid ${name} ${f.label} color`;
      }
    }
    if (!isValidHex(settings.splashBgColor)) return "Invalid splash background color";
    if (!isValidLatLng(settings.startLat, settings.startLng))
      return "Invalid start latitude/longitude";
    return null;
  }, [settings]);

  const handleSave = useCallback(async () => {
    if (!guard()) return;
    const err = validate();
    if (err) {
      Alert.alert("Validation", err);
      return;
    }
    setSaving(true);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1600);
    } catch (e) {
      console.log("[app-settings] save error", e);
      Alert.alert("Error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }, [settings, validate]);

  const handleReset = useCallback(() => {
    Alert.alert("Reset", "Restore all defaults?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: () => setSettings(defaultSettings),
      },
    ]);
  }, []);

  const activePalette = mode === "light" ? settings.light : settings.dark;

  const renderColorField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    testID: string
  ) => {
    const valid = isValidHex(value);
    return (
      <View style={styles.colorRow} key={testID}>
        <View style={styles.colorRowLeft}>
          <View
            style={[
              styles.swatch,
              {
                backgroundColor: valid ? value : "transparent",
                borderColor: Colors.border,
              },
            ]}
          />
          <Text style={[styles.colorLabel, { color: Colors.text }]}>{label}</Text>
        </View>
        <TextInput
          value={value}
          onChangeText={onChange}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="#RRGGBB"
          placeholderTextColor={Colors.textSecondary}
          style={[
            styles.hexInput,
            {
              color: Colors.text,
              borderColor: valid ? Colors.border : Colors.error,
              backgroundColor: Colors.gray[100],
            },
          ]}
          testID={testID}
          accessibilityLabel="#RRGGBB"
        />
      </View>
    );
  };

  const card = useMemo(
    () => ({
      backgroundColor: Colors.gray[100],
      borderColor: Colors.border,
    }),
    [Colors]
  );

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: Colors.background }]}
        edges={["top", "bottom"]}
      >
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accentText} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: Colors.background }]}
      edges={["top", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="app-settings-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Globe color={Colors.accentText} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>App Settings</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            Theme, branding & defaults
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleReset}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="app-settings-reset"
          accessibilityRole="button"
          accessibilityLabel="Reset settings"
        >
          <RotateCcw color={Colors.text} size={18} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Theme Palette */}
          <View style={[styles.card, card]}>
            <View style={styles.cardHeader}>
              <Palette color={Colors.accentText} size={18} />
              <Text style={[styles.cardTitle, { color: Colors.text }]}>Theme Colors</Text>
            </View>

            <View style={[styles.modeSwitch, { borderColor: Colors.border }]}>
              {(["light", "dark"] as const).map((m) => {
                const active = mode === m;
                const Icon = m === "light" ? Sun : Moon;
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => setMode(m)}
                    style={[
                      styles.modeBtn,
                      {
                        backgroundColor: active ? Colors.accent : "transparent",
                      },
                    ]}
                    testID={`mode-${m}`}
                    accessibilityRole="button"
                  >
                    <Icon color={active ? "#000000" : Colors.text} size={14} />
                    <Text
                      style={[
                        styles.modeText,
                        { color: active ? "#000000" : Colors.text },
                      ]}
                    >
                      {m === "light" ? "Light" : "Dark"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.colorList}>
              {PALETTE_FIELDS.map((f) =>
                renderColorField(
                  f.label,
                  activePalette[f.key],
                  (v) => updatePalette(mode, f.key, v),
                  `color-${mode}-${f.key}`
                )
              )}
            </View>
          </View>

          {/* App Icon */}
          <View style={[styles.card, card]}>
            <View style={styles.cardHeader}>
              <ImageIcon color={Colors.accentText} size={18} />
              <Text style={[styles.cardTitle, { color: Colors.text }]}>App Icon</Text>
            </View>
            <View style={styles.assetRow}>
              <View
                style={[
                  styles.assetPreview,
                  {
                    backgroundColor: Colors.gray[200],
                    borderColor: Colors.border,
                  },
                ]}
              >
                {settings.appIconUri ? (
                  <Image
                    source={{ uri: settings.appIconUri }}
                    style={styles.assetImage}
                    resizeMode="cover"
                  />
                ) : (
                  <ImageIcon color={Colors.textSecondary} size={28} />
                )}
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={[styles.assetHint, { color: Colors.textSecondary }]}>
                  Square PNG. 1024×1024 recommended.
                </Text>
                <TouchableOpacity
                  onPress={() => pickImage("app")}
                  style={[styles.uploadBtn, { backgroundColor: Colors.accent }]}
                  testID="upload-app-icon"
                  accessibilityRole="button"
                >
                  <Upload color="#000000" size={14} />
                  <Text style={styles.uploadBtnText}>
                    {settings.appIconUri ? "Replace" : "Upload"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Splash */}
          <View style={[styles.card, card]}>
            <View style={styles.cardHeader}>
              <Sparkles color={Colors.accentText} size={18} />
              <Text style={[styles.cardTitle, { color: Colors.text }]}>Splash Screen</Text>
            </View>

            <View style={styles.assetRow}>
              <View
                style={[
                  styles.assetPreview,
                  {
                    backgroundColor: isValidHex(settings.splashBgColor)
                      ? settings.splashBgColor
                      : Colors.gray[200],
                    borderColor: Colors.border,
                  },
                ]}
              >
                {settings.splashIconUri ? (
                  <Image
                    source={{ uri: settings.splashIconUri }}
                    style={styles.assetImage}
                    resizeMode="contain"
                  />
                ) : (
                  <Sparkles color={Colors.textSecondary} size={28} />
                )}
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={[styles.assetHint, { color: Colors.textSecondary }]}>
                  Splash icon shown on app launch.
                </Text>
                <TouchableOpacity
                  onPress={() => pickImage("splash")}
                  style={[styles.uploadBtn, { backgroundColor: Colors.accent }]}
                  testID="upload-splash-icon"
                  accessibilityRole="button"
                >
                  <Upload color="#000000" size={14} />
                  <Text style={styles.uploadBtnText}>
                    {settings.splashIconUri ? "Replace" : "Upload"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ marginTop: 14 }}>
              {renderColorField(
                "Splash Background",
                settings.splashBgColor,
                (v) => setSettings((s) => ({ ...s, splashBgColor: v })),
                "splash-bg-color"
              )}
            </View>
          </View>

          {/* Start Location */}
          <View style={[styles.card, card]}>
            <View style={styles.cardHeader}>
              <MapPin color={Colors.accentText} size={18} />
              <Text style={[styles.cardTitle, { color: Colors.text }]}>
                Default Start Location
              </Text>
            </View>
            <Text style={[styles.assetHint, { color: Colors.textSecondary, marginBottom: 10 }]}>
              Used before the user&apos;s location is captured.
            </Text>
            <View style={styles.latLngRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                  Latitude
                </Text>
                <TextInput
                  value={settings.startLat}
                  onChangeText={(v) => setSettings((s) => ({ ...s, startLat: v }))}
                  keyboardType="numbers-and-punctuation"
                  placeholder="3.139003"
                  placeholderTextColor={Colors.textSecondary}
                  style={[
                    styles.input,
                    {
                      color: Colors.text,
                      borderColor: Colors.border,
                      backgroundColor: Colors.gray[50],
                    },
                  ]}
                  testID="start-lat"
                  accessibilityLabel="Latitude"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                  Longitude
                </Text>
                <TextInput
                  value={settings.startLng}
                  onChangeText={(v) => setSettings((s) => ({ ...s, startLng: v }))}
                  keyboardType="numbers-and-punctuation"
                  placeholder="101.686855"
                  placeholderTextColor={Colors.textSecondary}
                  style={[
                    styles.input,
                    {
                      color: Colors.text,
                      borderColor: Colors.border,
                      backgroundColor: Colors.gray[50],
                    },
                  ]}
                  testID="start-lng"
                  accessibilityLabel="Longitude"
                />
              </View>
            </View>
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>

        <View
          style={[
            styles.footer,
            { backgroundColor: Colors.background, borderTopColor: Colors.border },
          ]}
        >
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            style={[
              styles.saveBtn,
              {
                backgroundColor: savedTick ? Colors.success : Colors.accent,
                opacity: saving ? 0.7 : 1,
              },
            ]}
            testID="save-app-settings"
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator color="#000000" />
            ) : savedTick ? (
              <>
                <Check color="#000000" size={18} />
                <Text style={styles.saveText}>Saved</Text>
              </>
            ) : (
              <>
                <Save color="#000000" size={18} />
                <Text style={styles.saveText}>Save Settings</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 14 },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "800" },
  modeSwitch: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  modeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  modeText: { fontSize: 13, fontWeight: "700" },
  colorList: { gap: 10 },
  colorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  colorRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
  },
  colorLabel: { fontSize: 14, fontWeight: "600" },
  hexInput: {
    minWidth: 110,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  assetRow: { flexDirection: "row", gap: 14, alignItems: "center" },
  assetPreview: {
    width: 84,
    height: 84,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  assetImage: { width: "100%", height: "100%" },
  assetHint: { fontSize: 12 },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  uploadBtnText: { color: "#000000", fontSize: 13, fontWeight: "700" },
  latLngRow: { flexDirection: "row", gap: 10 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 6,
    letterSpacing: 0.4,
  },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    borderTopWidth: 1,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  saveText: { color: "#000000", fontSize: 15, fontWeight: "800" },
});
