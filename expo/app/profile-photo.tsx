import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Camera, ScanFace, ShieldCheck, ChevronRight, Sun, Smile, X } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";

/**
 * Onboarding profile-photo step. The photo *upload itself* is gated behind
 * the same two-shot liveness challenge used in edit-profile: the user can't
 * pick from gallery and can't proceed with a still/printed/AI-generated face.
 *
 * Flow: capture neutral selfie -> capture randomized challenge selfie ->
 * single vision-LLM call validates both frames -> on pass, the neutral
 * selfie is uploaded as the avatar. Users can also Skip and add it later.
 */
type ChallengeStep = "idle" | "neutral" | "challenge" | "verifying";

const CHALLENGES: { key: string; label: string; instruction: string }[] = [
  { key: "smile", label: "Smile clearly with teeth showing", instruction: "the subject is smiling clearly with teeth visible" },
  { key: "left", label: "Turn your head to your LEFT", instruction: "the subject's head is rotated to their own left (camera-right)" },
  { key: "right", label: "Turn your head to your RIGHT", instruction: "the subject's head is rotated to their own right (camera-left)" },
  { key: "brows", label: "Raise your eyebrows", instruction: "the subject is raising both eyebrows noticeably" },
  { key: "mouth", label: "Open your mouth wide", instruction: "the subject's mouth is open wide" },
];

export default function ProfilePhotoScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { authState, refreshProfile } = useAuth();
  const { firstName } = useLocalSearchParams<{ firstName?: string }>();

  const [avatar, setAvatar] = useState<string>("");
  const [verifying, setVerifying] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [step, setStep] = useState<ChallengeStep>("idle");
  const [stepLabel, setStepLabel] = useState<string>("");

  // Pre-camera instruction overlay. Shown right before launching the OS
  // camera so users see clear visual guidance for the shot they're about to
  // take (the OS camera UI can't be overlaid directly).
  const [instruction, setInstruction] = useState<{
    visible: boolean;
    title: string;
    body: string;
    action: string;
    shot: 1 | 2;
  } | null>(null);
  const [instructionResolver, setInstructionResolver] = useState<((go: boolean) => void) | null>(null);

  const showInstruction = (cfg: { title: string; body: string; action: string; shot: 1 | 2 }) =>
    new Promise<boolean>((resolve) => {
      setInstruction({ visible: true, ...cfg });
      setInstructionResolver(() => resolve);
    });

  const closeInstruction = (go: boolean) => {
    if (instructionResolver) instructionResolver(go);
    setInstruction(null);
    setInstructionResolver(null);
  };

  const verifyTwoShotChallenge = async (
    neutralImage: string,
    challengeImage: string,
    challengeInstruction: string
  ): Promise<{ ok: boolean; reason?: string }> => {
    const toolkitUrl = process.env.EXPO_PUBLIC_TOOLKIT_URL ?? "https://toolkit.rork.com";
    const res = await fetch(`${toolkitUrl}/text/llm/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "You are a strict two-shot face-liveness gate for a profile-photo upload. You receive TWO images: image 1 is a neutral selfie, image 2 is a challenge selfie. Accept ONLY when ALL are true: (a) both images are real living human faces captured directly by a camera (REJECT screens, printed/scanned photos, drawings, AI-generated faces, masks, dolls, mannequins, statues, animals); (b) the SAME person appears in both; (c) image 2 visibly performs the challenge described by the user; (d) the two frames are clearly different (not the same frame twice). Respond ONLY with compact JSON: {\"bothHuman\":boolean,\"bothLive\":boolean,\"samePerson\":boolean,\"challengePassed\":boolean,\"framesDiffer\":boolean,\"confidence\":number,\"reason\":string}. confidence is 0..1.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Two-shot liveness check. Image 1 = neutral selfie. Image 2 = challenge selfie where ${challengeInstruction}. Verify and return JSON only.`,
              },
              { type: "image", image: neutralImage },
              { type: "image", image: challengeImage },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      const snippet = bodyText ? bodyText.slice(0, 300) : "<empty body>";
      console.log("[profile-photo] verifier non-OK", res.status, snippet);
      const hint =
        res.status === 413 || /payload|too large|entity too large/i.test(bodyText)
          ? " \u2014 photos may be too large; try again in better light."
          : res.status === 401 || res.status === 403
          ? " \u2014 verifier rejected the request (auth)."
          : "";
      return { ok: false, reason: `Verifier error ${res.status}${hint}\n${snippet}` };
    }
    const rawText = await res.text();
    let data: { completion?: string } = {};
    try {
      data = JSON.parse(rawText) as { completion?: string };
    } catch (e) {
      console.log("[profile-photo] verifier JSON parse error", e, rawText.slice(0, 300));
      return { ok: false, reason: `Verifier returned non-JSON (${res.status})\n${rawText.slice(0, 300)}` };
    }
    const raw = String(data.completion ?? "").trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { ok: false, reason: `Couldn't parse verifier response\n${raw.slice(0, 300)}` };
    const parsed = JSON.parse(match[0]) as {
      bothHuman?: boolean;
      bothLive?: boolean;
      samePerson?: boolean;
      challengePassed?: boolean;
      framesDiffer?: boolean;
      confidence?: number;
      reason?: string;
    };
    const conf = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    if (
      parsed.bothHuman &&
      parsed.bothLive &&
      parsed.samePerson &&
      parsed.challengePassed &&
      parsed.framesDiffer &&
      conf >= 0.6
    ) {
      return { ok: true };
    }
    if (!parsed.bothHuman || !parsed.bothLive) {
      return { ok: false, reason: parsed.reason || "One or both photos don't look like a real, live person." };
    }
    if (!parsed.samePerson) {
      return { ok: false, reason: parsed.reason || "The two photos don't appear to be the same person." };
    }
    if (!parsed.framesDiffer) {
      return { ok: false, reason: parsed.reason || "The two photos look identical \u2014 please move between shots." };
    }
    if (!parsed.challengePassed) {
      return { ok: false, reason: parsed.reason || "Couldn't detect the requested action in shot 2." };
    }
    return { ok: false, reason: parsed.reason || "Liveness check didn't pass." };
  };

  /**
   * Front-camera selfie compressed to a small base64 data URI for the
   * verifier (kept under ~1MB) plus a local URI for preview/upload.
   */
  const captureSelfie = async (): Promise<{ uri: string; dataUri: string } | null> => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      cameraType: ImagePicker.CameraType.front,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.4,
      base64: true,
      exif: false,
    });
    if (result.canceled || !result.assets[0]?.uri) return null;
    const a = result.assets[0];
    const mime = a.mimeType ?? "image/jpeg";
    const dataUri = a.base64 ? `data:${mime};base64,${a.base64}` : a.uri;
    return { uri: a.uri, dataUri };
  };

  const startChallenge = async () => {
    try {
      if (Platform.OS === "web") {
        Alert.alert("Camera required", "Selfie capture isn't supported on web. Please use the mobile app.");
        return;
      }
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Camera permission needed", "Allow camera access to take a selfie for your profile photo.");
        return;
      }

      const challenge = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];

      const proceed = await showInstruction({
        shot: 1,
        title: "Shot 1 of 2 \u00b7 Neutral face",
        body: "Look straight at the front camera with a neutral expression. Good lighting, no hat or sunglasses, fill the frame with your face.",
        action: "Open camera",
      });
      if (!proceed) return;

      setStep("neutral");
      setStepLabel("Shot 1 of 2 \u00b7 Neutral face");
      const neutral = await captureSelfie();
      if (!neutral) {
        setStep("idle");
        setStepLabel("");
        return;
      }

      const continueToChallenge = await showInstruction({
        shot: 2,
        title: "Shot 2 of 2 \u00b7 " + challenge.label,
        body: `Hold the pose: ${challenge.label.toLowerCase()}. Then tap Open camera and snap the photo while holding it.`,
        action: "Open camera",
      });
      if (!continueToChallenge) {
        setStep("idle");
        setStepLabel("");
        return;
      }

      setStep("challenge");
      setStepLabel(`Shot 2 of 2 \u00b7 ${challenge.label}`);
      const challengeShot = await captureSelfie();
      if (!challengeShot) {
        setStep("idle");
        setStepLabel("");
        return;
      }

      setStep("verifying");
      setStepLabel("Verifying it\u2019s really you\u2026");
      setVerifying(true);
      try {
        const neutralKB = Math.round((neutral.dataUri.length * 3) / 4 / 1024);
        const challengeKB = Math.round((challengeShot.dataUri.length * 3) / 4 / 1024);
        console.log(
          `[profile-photo] verifier payload \u2248 ${neutralKB}KB + ${challengeKB}KB`
        );
        const verdict = await verifyTwoShotChallenge(
          neutral.dataUri,
          challengeShot.dataUri,
          challenge.instruction
        );
        if (!verdict.ok) {
          Alert.alert(
            "Liveness check failed",
            `${verdict.reason ?? "Please try again."}\n\nUse the front camera in good lighting, no screens or printed photos, and follow the on-screen action.`,
            [
              { text: "Cancel", style: "cancel" },
              { text: "Retry", onPress: () => startChallenge() },
            ]
          );
          return;
        }
        setAvatar(neutral.uri);
      } catch (err) {
        console.log("[profile-photo] two-shot verify error", err);
        Alert.alert(
          "Couldn't verify selfie",
          "We couldn't run the liveness check. Check your connection and try again."
        );
      } finally {
        setVerifying(false);
        setStep("idle");
        setStepLabel("");
      }
    } catch (e) {
      console.log("[profile-photo] startChallenge error", e);
      Alert.alert("Couldn't open camera", "Please try again.");
      setVerifying(false);
      setStep("idle");
      setStepLabel("");
    }
  };

  const persistAvatar = async (uri: string): Promise<boolean> => {
    if (!isSupabaseConfigured || !supabase) return false;
    try {
      let uid = authState.userId ?? null;
      if (!uid) {
        const { data: u } = await supabase.auth.getUser();
        uid = u.user?.id ?? null;
      }
      if (!uid) return false;
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: uri })
        .eq("id", uid);
      if (error) {
        console.log("[profile-photo] save error", error.message);
        return false;
      }
      return true;
    } catch (e) {
      console.log("[profile-photo] save threw", e);
      return false;
    }
  };

  const handleContinue = async () => {
    if (!avatar) return;
    setSaving(true);
    try {
      const ok = await persistAvatar(avatar);
      if (!ok) {
        Alert.alert("Couldn't save photo", "We'll keep you signed in \u2014 you can add it later from your profile.");
      } else {
        await refreshProfile();
      }
      router.replace("/welcome-back" as any);
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    router.replace("/welcome-back" as any);
  };

  const firstChar = (firstName || authState.phoneNumber || "U").trim().charAt(0).toUpperCase();
  const busy = verifying || saving;

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: Colors.background }}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Add a profile photo</Text>
          <TouchableOpacity onPress={handleSkip} disabled={busy} testID="profile-photo-skip">
            <Text style={[styles.skip, { color: Colors.textSecondary }]}>Skip</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <View style={styles.body}>
        <View style={styles.avatarWrap}>
          <View style={[styles.avatar, { backgroundColor: Colors.accent + "25" }]}>
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatarImage} />
            ) : (
              <Text style={[styles.avatarText, { color: Colors.accent }]}>{firstChar}</Text>
            )}
            {verifying && (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </View>
          <View style={[styles.cameraBadge, { backgroundColor: Colors.accent, borderColor: Colors.background }]}>
            <Camera color={Colors.onAccent} size={14} />
          </View>
        </View>

        <View style={styles.copy}>
          <Text style={[styles.title, { color: Colors.text }]}>
            {firstName ? `Great, ${firstName}!` : "Almost there"}
          </Text>
          <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
            We use a quick 2-shot liveness check to make sure your photo is a real,
            live person \u2014 no screens, prints, or AI faces.
          </Text>
        </View>

        <View style={[styles.statusRow, { backgroundColor: Colors.gray[50], borderColor: Colors.border }]}>
          <ScanFace color={avatar ? Colors.success : Colors.textSecondary} size={18} />
          <Text style={[styles.statusText, { color: Colors.text }]}>
            {step !== "idle" && stepLabel
              ? stepLabel
              : avatar
              ? "Liveness verified \u00b7 ready to continue"
              : "Tap below to start the 2-shot liveness check"}
          </Text>
          {avatar && !verifying && <ShieldCheck color={Colors.success} size={18} />}
        </View>
      </View>

      <Modal
        visible={!!instruction?.visible}
        transparent
        animationType="fade"
        onRequestClose={() => closeInstruction(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <View style={styles.modalHeader}>
              <View style={[styles.shotBadge, { backgroundColor: Colors.accent }]}>
                <Text style={[styles.shotBadgeText, { color: Colors.secondary }]}>
                  {instruction?.shot === 1 ? "1 / 2" : "2 / 2"}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => closeInstruction(false)}
                style={styles.modalClose}
                testID="instruction-close"
              >
                <X color={Colors.textSecondary} size={20} />
              </TouchableOpacity>
            </View>
            <View style={[styles.modalIconWrap, { backgroundColor: Colors.accent + "20" }]}>
              {instruction?.shot === 1 ? (
                <ScanFace color={Colors.accent} size={44} />
              ) : (
                <Smile color={Colors.accent} size={44} />
              )}
            </View>
            <Text style={[styles.modalTitle, { color: Colors.text }]}>{instruction?.title}</Text>
            <Text style={[styles.modalBody, { color: Colors.textSecondary }]}>{instruction?.body}</Text>

            <View style={styles.tipRow}>
              <Sun color={Colors.warning ?? Colors.accent} size={16} />
              <Text style={[styles.tipText, { color: Colors.textSecondary }]}>
                Use good, even lighting \u2014 avoid backlight.
              </Text>
            </View>
            <View style={styles.tipRow}>
              <Camera color={Colors.textSecondary} size={16} />
              <Text style={[styles.tipText, { color: Colors.textSecondary }]}>
                The front camera will open next. Hold steady, then capture.
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: Colors.border, flex: 1 }]}
                onPress={() => closeInstruction(false)}
                testID="instruction-cancel"
              >
                <Text style={[styles.secondaryBtnText, { color: Colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: Colors.accent, flex: 1.4 }]}
                onPress={() => closeInstruction(true)}
                testID="instruction-continue"
              >
                <Camera color={Colors.onAccent} size={18} />
                <Text style={[styles.primaryBtnText, { color: Colors.secondary }]}>
                  {instruction?.action ?? "Open camera"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <SafeAreaView edges={["bottom"]} style={styles.footerSafe}>
        <View style={styles.footer}>
          {avatar ? (
            <>
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: Colors.border }]}
                onPress={startChallenge}
                disabled={busy}
                testID="profile-photo-retry"
              >
                <Text style={[styles.secondaryBtnText, { color: Colors.text }]}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: Colors.accent }, busy && styles.btnDisabled]}
                onPress={handleContinue}
                disabled={busy}
                testID="profile-photo-continue"
              >
                {saving ? (
                  <ActivityIndicator color={Colors.secondary} />
                ) : (
                  <>
                    <Text style={[styles.primaryBtnText, { color: Colors.secondary }]}>Continue</Text>
                    <ChevronRight color={Colors.secondary} size={18} />
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: Colors.accent, flex: 1 }, busy && styles.btnDisabled]}
              onPress={startChallenge}
              disabled={busy}
              testID="profile-photo-start"
            >
              {verifying ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <>
                  <Camera color={Colors.onAccent} size={18} />
                  <Text style={[styles.primaryBtnText, { color: Colors.secondary }]}>
                    Start liveness check
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: { fontSize: 18, fontWeight: "700" as const },
  skip: { fontSize: 15, fontWeight: "600" as const },
  body: {
    flex: 1,
    alignItems: "center" as const,
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  avatarWrap: { position: "relative" as const, marginBottom: 28 },
  avatar: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  },
  avatarImage: { width: "100%" as const, height: "100%" as const },
  avatarText: { fontSize: 52, fontWeight: "700" as const },
  avatarOverlay: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  cameraBadge: {
    position: "absolute" as const,
    right: -2,
    bottom: -2,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 3,
  },
  copy: { alignItems: "center" as const, marginBottom: 24 },
  title: { fontSize: 24, fontWeight: "700" as const, marginBottom: 8, textAlign: "center" as const },
  subtitle: { fontSize: 15, lineHeight: 21, textAlign: "center" as const },
  statusRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    width: "100%" as const,
  },
  statusText: { flex: 1, fontSize: 13, fontWeight: "600" as const },
  footerSafe: {},
  footer: {
    flexDirection: "row" as const,
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
    paddingTop: 8,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 16,
    borderRadius: 12,
    minHeight: 56,
  },
  primaryBtnText: { fontSize: 16, fontWeight: "700" as const },
  secondaryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 56,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  secondaryBtnText: { fontSize: 16, fontWeight: "600" as const },
  btnDisabled: { opacity: 0.6 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: 20,
  },
  modalCard: {
    width: "100%" as const,
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
  },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 16,
  },
  shotBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  shotBadgeText: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 0.5 },
  modalClose: { padding: 4 },
  modalIconWrap: {
    alignSelf: "center" as const,
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700" as const,
    textAlign: "center" as const,
    marginBottom: 8,
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center" as const,
    marginBottom: 16,
  },
  tipRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 8,
  },
  tipText: { flex: 1, fontSize: 13 },
  modalActions: {
    flexDirection: "row" as const,
    gap: 10,
    marginTop: 14,
  },
});
