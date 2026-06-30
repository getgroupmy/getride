import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import {
  ArrowLeft,
  Sparkles,
  Upload,
  Save,
  RotateCcw,
  Check,
  Trash2,
  Image as ImageIcon,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useBranding, DEFAULT_BRANDING } from "@/contexts/BrandingContext";

const HEX_RE = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/;
const PRESET_COLORS: string[] = [
  "#2dabe2",
  "#000000",
  "#FFFFFF",
  "#0EA5E9",
  "#22C55E",
  "#F59E0B",
  "#8B5CF6",
  "#EF4444",
];

export default function AdminSplashScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const branding = useBranding();
  const [image, setImage] = useState<string | null>(branding.splashImageUri);
  const [bg, setBg] = useState<string>(branding.splashBgColor);
  const [saving, setSaving] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);

  useEffect(() => {
    if (branding.hydrated) {
      setImage(branding.splashImageUri);
      setBg(branding.splashBgColor);
    }
  }, [branding.hydrated, branding.splashImageUri, branding.splashBgColor]);

  const pickImage = useCallback(async () => {
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
      setImage(res.assets[0].uri);
    } catch (e) {
      console.log("[admin-splash] pick error", e);
      Alert.alert("Error", "Could not pick image.");
    }
  }, []);

  const valid = HEX_RE.test(bg.trim());

  const handleSave = useCallback(async () => {
    if (!guard()) return;
    if (!valid) {
      Alert.alert("Validation", "Background color must be a valid #RRGGBB hex.");
      return;
    }
    setSaving(true);
    try {
      const ok = await branding.setSplash(image, bg);
      if (!ok) {
        Alert.alert("Save failed", "Could not save splash to Supabase. Check your connection and try again.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }, [bg, branding, guard, image, valid]);

  const handleReset = useCallback(() => {
    Alert.alert("Reset", "Restore the default splash image and background?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: () => {
          setImage(DEFAULT_BRANDING.splashImageUri);
          setBg(DEFAULT_BRANDING.splashBgColor);
        },
      },
    ]);
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="splash-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Sparkles color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Splash Screen</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            Image & background color
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleReset}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="splash-reset"
        >
          <RotateCcw color={Colors.text} size={18} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.previewWrap, { backgroundColor: valid ? bg : Colors.gray[100], borderColor: Colors.border }]}>
          {image ? (
            <Image source={{ uri: image }} style={styles.previewImg} resizeMode="contain" />
          ) : (
            <Image
              source={require("@/assets/images/splash-icon.png")}
              style={styles.previewImg}
              resizeMode="contain"
            />
          )}
        </View>
        <Text style={[styles.caption, { color: Colors.textSecondary }]}>
          Live preview — shown on app launch and reconnect splash.
        </Text>

        <View style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
          <View style={styles.cardHeader}>
            <ImageIcon color={Colors.accent} size={18} />
            <Text style={[styles.cardTitle, { color: Colors.text }]}>Splash Image</Text>
          </View>
          <View style={styles.rowBetween}>
            <TouchableOpacity
              onPress={pickImage}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent }]}
              testID="splash-pick"
            >
              <Upload color="#000000" size={16} />
              <Text style={styles.primaryBtnText}>{image ? "Replace image" : "Upload image"}</Text>
            </TouchableOpacity>
            {image ? (
              <TouchableOpacity
                onPress={() => setImage(null)}
                style={[styles.ghostBtn, { borderColor: Colors.border }]}
                testID="splash-clear"
              >
                <Trash2 color={Colors.error} size={16} />
                <Text style={[styles.ghostBtnText, { color: Colors.error }]}>Remove</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={[styles.helper, { color: Colors.textSecondary }]}>
            Recommended: a square PNG, 1024×1024, transparent background.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.swatch, { backgroundColor: valid ? bg : "transparent", borderColor: Colors.border }]} />
            <Text style={[styles.cardTitle, { color: Colors.text }]}>Background Color</Text>
          </View>
          <TextInput
            value={bg}
            onChangeText={setBg}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="#RRGGBB"
            placeholderTextColor={Colors.textSecondary}
            style={[
              styles.hexInput,
              {
                color: Colors.text,
                borderColor: valid ? Colors.border : Colors.error,
                backgroundColor: Colors.background,
              },
            ]}
            testID="splash-bg-hex"
          />
          <View style={styles.presets}>
            {PRESET_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => setBg(c)}
                style={[
                  styles.preset,
                  {
                    backgroundColor: c,
                    borderColor: c.toLowerCase() === bg.toLowerCase() ? Colors.accent : Colors.border,
                    borderWidth: c.toLowerCase() === bg.toLowerCase() ? 2.5 : 1,
                  },
                ]}
                testID={`splash-preset-${c}`}
              />
            ))}
          </View>
        </View>

        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveBtn, { backgroundColor: saved ? Colors.success : Colors.accent }]}
          testID="splash-save"
        >
          {saving ? (
            <>
              <ActivityIndicator color="#000000" />
              <Text style={styles.saveText}>Uploading…</Text>
            </>
          ) : saved ? (
            <>
              <Check color="#000000" size={18} />
              <Text style={styles.saveText}>Published to all users</Text>
            </>
          ) : (
            <>
              <Save color="#000000" size={18} />
              <Text style={styles.saveText}>Publish to all users</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: "700" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  scroll: { padding: 16, gap: 16, paddingBottom: 48 },
  previewWrap: {
    height: 260,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  previewImg: { width: 180, height: 180 },
  caption: { fontSize: 12, textAlign: "center", marginTop: -8 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: "600" as const },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryBtnText: { color: "#000000", fontWeight: "600" as const },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  ghostBtnText: { fontWeight: "600" as const },
  helper: { fontSize: 12 },
  swatch: { width: 22, height: 22, borderRadius: 6, borderWidth: 1 },
  hexInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: "600" as const,
  },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  preset: { width: 36, height: 36, borderRadius: 18 },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  saveText: { color: "#000000", fontWeight: "700" as const, fontSize: 15 },
});
