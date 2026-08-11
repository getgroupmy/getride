import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  Modal,
  FlatList,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useDisplaySettings } from "@/contexts/DisplaySettingsContext";
import { useIpAccess } from "@/contexts/IpAccessContext";
import { useColors } from "@/hooks/useColors";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import { ArrowLeft, X, ChevronDown, Search, UserPlus, Stethoscope, ShieldAlert } from "lucide-react-native";

interface Country {
  name: string;
  code: string;
  dialCode: string;
  flag: string;
}

const COUNTRIES: Country[] = [
  { name: "Malaysia", code: "MY", dialCode: "+60", flag: "🇲🇾" },
  { name: "United States", code: "US", dialCode: "+1", flag: "🇺🇸" },
  { name: "United Kingdom", code: "GB", dialCode: "+44", flag: "🇬🇧" },
  { name: "Singapore", code: "SG", dialCode: "+65", flag: "🇸🇬" },
  { name: "Indonesia", code: "ID", dialCode: "+62", flag: "🇮🇩" },
  { name: "Thailand", code: "TH", dialCode: "+66", flag: "🇹🇭" },
  { name: "Philippines", code: "PH", dialCode: "+63", flag: "🇵🇭" },
  { name: "Vietnam", code: "VN", dialCode: "+84", flag: "🇻🇳" },
  { name: "Australia", code: "AU", dialCode: "+61", flag: "🇦🇺" },
  { name: "India", code: "IN", dialCode: "+91", flag: "🇮🇳" },
  { name: "China", code: "CN", dialCode: "+86", flag: "🇨🇳" },
  { name: "Japan", code: "JP", dialCode: "+81", flag: "🇯🇵" },
  { name: "South Korea", code: "KR", dialCode: "+82", flag: "🇰🇷" },
  { name: "Canada", code: "CA", dialCode: "+1", flag: "🇨🇦" },
  { name: "Germany", code: "DE", dialCode: "+49", flag: "🇩🇪" },
  { name: "France", code: "FR", dialCode: "+33", flag: "🇫🇷" },
  { name: "Italy", code: "IT", dialCode: "+39", flag: "🇮🇹" },
  { name: "Spain", code: "ES", dialCode: "+34", flag: "🇪🇸" },
  { name: "Netherlands", code: "NL", dialCode: "+31", flag: "🇳🇱" },
  { name: "Brazil", code: "BR", dialCode: "+55", flag: "🇧🇷" },
  { name: "Mexico", code: "MX", dialCode: "+52", flag: "🇲🇽" },
  { name: "Argentina", code: "AR", dialCode: "+54", flag: "🇦🇷" },
  { name: "South Africa", code: "ZA", dialCode: "+27", flag: "🇿🇦" },
  { name: "Egypt", code: "EG", dialCode: "+20", flag: "🇪🇬" },
  { name: "Saudi Arabia", code: "SA", dialCode: "+966", flag: "🇸🇦" },
  { name: "UAE", code: "AE", dialCode: "+971", flag: "🇦🇪" },
  { name: "Turkey", code: "TR", dialCode: "+90", flag: "🇹🇷" },
  { name: "Russia", code: "RU", dialCode: "+7", flag: "🇷🇺" },
  { name: "Pakistan", code: "PK", dialCode: "+92", flag: "🇵🇰" },
  { name: "Bangladesh", code: "BD", dialCode: "+880", flag: "🇧🇩" },
];

export default function PhoneAuthScreen() {
  const router = useRouter();
  const colors = useColors();
  const { isUserRegistered, isSupabaseAuth, sendOtp } = useAuth();
  const { settings } = useDisplaySettings();
  const { isBlacklisted } = useIpAccess();
  void isUserRegistered;
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]);
  const [isCountryPickerVisible, setIsCountryPickerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [checkError, setCheckError] = useState<string | null>(null);
  const [signupSheet, setSignupSheet] = useState<{ phone: string } | null>(null);
  const [registrationBlocked, setRegistrationBlocked] = useState<boolean>(false);
  const [isSendingOtp, setIsSendingOtp] = useState<boolean>(false);

  const sendSignupOtpAndContinue = async (fullPhoneNumber: string) => {
    setIsSendingOtp(true);
    setCheckError(null);
    if (isSupabaseAuth) {
      const res = await sendOtp(fullPhoneNumber, { shouldCreateUser: true });
      setIsSendingOtp(false);
      if (!res.ok) {
        setCheckError(res.error ?? "Failed to send code. Please try again.");
        return;
      }
    } else {
      setIsSendingOtp(false);
    }
    setSignupSheet(null);
    router.push({
      pathname: "/otp-verify",
      params: { phoneNumber: fullPhoneNumber, isNewUser: "true" },
    });
  };

  const handleNext = async () => {
    if (!phoneNumber) return;

    if (isBlacklisted) {
      setCheckError("Service Not Available");
      return;
    }

    setIsLoading(true);
    setCheckError(null);

    let cleanedPhone = phoneNumber;
    const dialCodeDigits = selectedCountry.dialCode.replace(/\D/g, "");

    if (cleanedPhone.startsWith(dialCodeDigits)) {
      cleanedPhone = cleanedPhone.substring(dialCodeDigits.length);
    }
    if (cleanedPhone.startsWith("0")) {
      cleanedPhone = cleanedPhone.substring(1);
    }

    const fullPhoneNumber = `${selectedCountry.dialCode}${cleanedPhone}`;

    console.log("=== handleNext ===");
    console.log("Full phone number:", fullPhoneNumber);

    let isRegistered = isSupabaseAuth ? false : isUserRegistered(fullPhoneNumber);
    let hasProfile = false;
    let hasPinOnServer = false;
    let isDeleted = false;

    if (isSupabaseConfigured && supabase) {
      try {
        // RLS on `profiles` blocks anon SELECTs (auth.uid() = id), so a direct
        // table query before login always returns empty. Use the SECURITY
        // DEFINER RPC that exposes only the booleans we need.
        const { data, error } = await supabase.rpc("profile_phone_lookup", {
          p_phone: fullPhoneNumber,
        });
        if (error) {
          console.log("[phone-auth] rpc error, falling back to table", error.message);
          // Fallback: try the table query (works if RLS has been relaxed or
          // the migration hasn't been applied yet).
          const digitsOnly = fullPhoneNumber.replace(/[^\d]/g, "");
          const variants = Array.from(
            new Set(
              [
                `+${digitsOnly}`,
                digitsOnly,
                `0${digitsOnly.substring(dialCodeDigits.length)}`,
                digitsOnly.substring(dialCodeDigits.length),
              ].filter((v) => v && v.length >= 4)
            )
          );
          const retry = await supabase
            .from("profiles")
            .select("id, pin, login_pin, profile_status")
            .in("phone", variants)
            .limit(1);
          if (retry.error) {
            console.log("[phone-auth] fallback table error", retry.error.message);
            setCheckError("Could not verify number. Please try again.");
            setIsLoading(false);
            return;
          }
          const row = retry.data && retry.data.length > 0 ? retry.data[0] : null;
          const r = row as { pin?: string | null; login_pin?: string | null; profile_status?: string | null } | null;
          hasProfile = !!r;
          hasPinOnServer = !!(r?.pin || r?.login_pin);
          isDeleted = (r?.profile_status ?? "").toLowerCase() === "deleted";
        } else {
          const row = Array.isArray(data) ? data[0] : data;
          const r = row as { has_profile?: boolean; has_pin?: boolean; is_deleted?: boolean } | null;
          hasProfile = !!r?.has_profile;
          hasPinOnServer = !!r?.has_pin;
          isDeleted = !!r?.is_deleted;
        }
        if (hasProfile && !isDeleted) isRegistered = true;
        console.log("[phone-auth] rpc result:", {
          phone: fullPhoneNumber,
          hasProfile,
          hasPinOnServer,
          isDeleted,
        });
      } catch (e) {
        console.log("[phone-auth] rpc threw", e);
        setCheckError("Network error. Please try again.");
        setIsLoading(false);
        return;
      }
    }

    // Existing user (not deleted) with a PIN already set -> straight to PIN entry.
    if (!isDeleted && (isRegistered || hasProfile) && hasPinOnServer) {
      setIsLoading(false);
      router.push({
        pathname: "/pin-verify",
        params: { phoneNumber: fullPhoneNumber },
      });
      return;
    }

    // Existing user with no PIN yet (or deleted-and-reactivating) -> OTP flow so they can set one.
    if (!isDeleted && (isRegistered || hasProfile) && !hasPinOnServer) {
      setIsLoading(false);
      if (isSupabaseAuth) {
        const res = await sendOtp(fullPhoneNumber, { shouldCreateUser: false });
        if (!res.ok) {
          setCheckError(res.error ?? "Failed to send code. Please try again.");
          return;
        }
      }
      router.push({
        pathname: "/otp-verify",
        params: { phoneNumber: fullPhoneNumber, isNewUser: "false" },
      });
      return;
    }

    // Registration disabled by admin -> block unknown numbers with a contact-admin popup.
    if (!settings.registrationEnabled) {
      setIsLoading(false);
      setRegistrationBlocked(true);
      return;
    }

    // New user -> require explicit Sign-up confirmation before sending an SMS,
    // so existing users mistyping their number never accidentally trigger one.
    setIsLoading(false);
    setSignupSheet({ phone: fullPhoneNumber });
  };

  const formatPhoneNumber = (text: string) => {
    const cleaned = text.replace(/\D/g, "");
    if (cleaned.length <= 2) return cleaned;
    if (cleaned.length <= 5) return `${cleaned.slice(0, 2)}-${cleaned.slice(2)}`;
    if (cleaned.length <= 9)
      return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 5)} ${cleaned.slice(5)}`;
    return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 5)} ${cleaned.slice(5, 9)}`;
  };

  const handlePhoneChange = (text: string) => {
    const cleaned = text.replace(/\D/g, "");
    if (cleaned.length <= 15) {
      setPhoneNumber(cleaned);
    }
  };

  const filteredCountries = COUNTRIES.filter(
    (country) =>
      country.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      country.dialCode.includes(searchQuery) ||
      country.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCountrySelect = (country: Country) => {
    setSelectedCountry(country);
    setIsCountryPickerVisible(false);
    setSearchQuery("");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft color={colors.text} size={24} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.diagButton}
            accessibilityRole="button"
            onPress={() => {
              console.log("[phone-auth] diagnostics button pressed");
              try {
                router.push("/auth-diagnostics" as never);
              } catch (e) {
                console.log("[phone-auth] router.push failed, trying navigate", e);
                try {
                  router.navigate("/auth-diagnostics" as never);
                } catch (e2) {
                  console.log("[phone-auth] navigate failed", e2);
                }
              }
            }}
            testID="auth-diagnostics-button"
            accessibilityLabel="Auth Diagnostics"
            activeOpacity={0.6}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          >
            <Stethoscope color={colors.textSecondary} size={22} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.content}
      >
        <View style={styles.topContent}>
          <Text style={[styles.title, { color: colors.text }]}>Join us via phone number</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            We&apos;ll text a code to verify your phone
          </Text>

          {isBlacklisted ? (
            <View style={[styles.blockBanner, { backgroundColor: colors.error + "15", borderColor: colors.error + "40" }]}>
              <ShieldAlert color={colors.errorText} size={18} />
              <Text style={[styles.blockBannerText, { color: colors.errorText }]}>Service Not Available</Text>
            </View>
          ) : null}

          <View style={styles.inputContainer}>
            <View style={[styles.inputWrapper, { backgroundColor: colors.gray[100], borderColor: colors.text }]}>
              <TouchableOpacity
                style={styles.countryCode}
                onPress={() => setIsCountryPickerVisible(true)}
                accessibilityRole="button"
                accessibilityLabel={`Country: ${selectedCountry.name}, ${selectedCountry.dialCode}. Change country`}
              >
                <Text style={styles.flag}>{selectedCountry.flag}</Text>
                <ChevronDown color={colors.text} size={16} />
              </TouchableOpacity>
              <Text style={[styles.prefix, { color: colors.text }]}>{selectedCountry.dialCode}</Text>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={formatPhoneNumber(phoneNumber)}
                onChangeText={handlePhoneChange}
                placeholder=""
                placeholderTextColor={colors.textSecondary}
                keyboardType="number-pad"
                autoFocus
                maxLength={15}
                accessibilityLabel="Phone number"
              />
              {phoneNumber.length > 0 && (
                <TouchableOpacity
                  style={[styles.clearButton, { backgroundColor: colors.gray[200] }]}
                  onPress={() => setPhoneNumber("")}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear phone number"
                >
                  <X color={colors.textSecondary} size={20} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        <SafeAreaView edges={["bottom"]} style={styles.bottomContent}>
          <TouchableOpacity
            style={[
              styles.nextButton,
              { backgroundColor: colors.accent },
              (!phoneNumber || isLoading) && styles.nextButtonDisabled,
            ]}
            onPress={handleNext}
            disabled={!phoneNumber || isLoading || isBlacklisted}
            accessibilityRole="button"
            accessibilityLabel={isLoading ? "Sending code" : "Next"}
            accessibilityState={{ disabled: !phoneNumber || isLoading || isBlacklisted, busy: isLoading }}
          >
            {isLoading ? (
              <View style={[styles.loadingIndicator, { borderColor: colors.secondary, borderTopColor: "transparent" }]} />
            ) : (
              <Text style={[styles.nextButtonText, { color: colors.secondary }]}>Next</Text>
            )}
          </TouchableOpacity>
          {checkError ? (
            <Text style={[styles.sheetError, { color: colors.errorText, marginTop: 12 }]}>{checkError}</Text>
          ) : null}
        </SafeAreaView>
      </KeyboardAvoidingView>

      <Modal
        visible={!!signupSheet}
        animationType="slide"
        transparent={true}
        onRequestClose={() => (isSendingOtp ? null : setSignupSheet(null))}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => (isSendingOtp ? null : setSignupSheet(null))}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
          <View style={[styles.sheetContent, { backgroundColor: colors.gray[50] }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.gray[200] }]} />
            <View style={styles.sheetBody}>
              <View style={[styles.sheetIconWrap, { backgroundColor: colors.gray[100] }]}>
                <UserPlus color={colors.text} size={26} />
              </View>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>Create a new account?</Text>
              <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
                We don&apos;t recognise this number. We&apos;ll text a 6-digit code to:
              </Text>
              <Text style={[styles.sheetPhone, { color: colors.text }]}>{signupSheet?.phone}</Text>
              {checkError ? (
                <Text style={[styles.sheetError, { color: colors.errorText }]}>{checkError}</Text>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.sheetPrimaryButton,
                  { backgroundColor: colors.accent },
                  isSendingOtp && styles.nextButtonDisabled,
                ]}
                onPress={() => signupSheet && sendSignupOtpAndContinue(signupSheet.phone)}
                disabled={isSendingOtp}
                accessibilityRole="button"
                accessibilityLabel={isSendingOtp ? "Sending code" : "Sign up and send code"}
                accessibilityState={{ disabled: isSendingOtp, busy: isSendingOtp }}
              >
                {isSendingOtp ? (
                  <View style={[styles.loadingIndicator, { borderColor: colors.secondary, borderTopColor: "transparent" }]} />
                ) : (
                  <Text style={[styles.sheetPrimaryButtonText, { color: colors.secondary }]}>Sign up &amp; send code</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.sheetSecondaryButton}
                onPress={() => {
                  if (isSendingOtp) return;
                  setSignupSheet(null);
                  setCheckError(null);
                }}
                disabled={isSendingOtp}
                accessibilityRole="button"
              >
                <Text style={[styles.sheetSecondaryButtonText, { color: colors.textSecondary }]}>Use a different number</Text>
              </TouchableOpacity>
            </View>
            <SafeAreaView edges={["bottom"]} />
          </View>
        </View>
      </Modal>

      <Modal
        visible={registrationBlocked}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setRegistrationBlocked(false)}
      >
        <View style={styles.alertOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setRegistrationBlocked(false)} />
          <View style={[styles.alertCard, { backgroundColor: colors.gray[50] }]}>
            <View style={[styles.sheetIconWrap, { backgroundColor: colors.gray[100] }]}>
              <ShieldAlert color={colors.text} size={26} />
            </View>
            <Text style={[styles.alertTitle, { color: colors.text }]}>Registration Unavailable</Text>
            <Text style={[styles.alertMessage, { color: colors.textSecondary }]}>
              For new registration please contact Administrator
            </Text>
            <TouchableOpacity
              style={[styles.alertButton, { backgroundColor: colors.accent }]}
              onPress={() => setRegistrationBlocked(false)}
              accessibilityRole="button"
            >
              <Text style={[styles.alertButtonText, { color: colors.secondary }]}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isCountryPickerVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsCountryPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setIsCountryPickerVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
          <View style={[styles.modalContent, { backgroundColor: colors.gray[50] }]}>
            <SafeAreaView edges={["top"]} style={[styles.modalHeader, { backgroundColor: colors.gray[50] }]}>
              <View style={styles.modalHeaderContent}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Select Country</Text>
                <TouchableOpacity
                  onPress={() => setIsCountryPickerVisible(false)}
                  style={styles.closeButton}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <X color={colors.text} size={24} />
                </TouchableOpacity>
              </View>
              <View style={[styles.searchContainer, { backgroundColor: colors.gray[100] }]}>
                <Search color={colors.textSecondary} size={20} style={styles.searchIcon} />
                <TextInput
                  style={[styles.searchInput, { color: colors.text }]}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search country or code"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="none"
                  accessibilityLabel="Search for a country or dialling code"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setSearchQuery("")}
                    style={styles.searchClearButton}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                  >
                    <X color={colors.textSecondary} size={16} />
                  </TouchableOpacity>
                )}
              </View>
            </SafeAreaView>

            <FlatList
              data={filteredCountries}
              keyExtractor={(item) => item.code}
              style={styles.countryList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.countryItem,
                    selectedCountry.code === item.code && [styles.countryItemSelected, { backgroundColor: colors.gray[100] }],
                  ]}
                  onPress={() => handleCountrySelect(item)}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: selectedCountry.code === item.code,
                    checked: selectedCountry.code === item.code,
                  }}
                  accessibilityLabel={`${item.name}, ${item.dialCode}`}
                >
                  <Text style={styles.countryFlag}>{item.flag}</Text>
                  <Text style={[styles.countryName, { color: colors.text }]}>{item.name}</Text>
                  <Text style={[styles.countryDialCode, { color: colors.textSecondary }]}>{item.dialCode}</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.gray[100] }]} />}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {},
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
  },
  diagButton: {
    width: 44,
    height: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    justifyContent: "space-between",
  },
  topContent: {
    paddingHorizontal: 28,
    paddingTop: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 40,
  },
  blockBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 24,
  },
  blockBannerText: {
    fontSize: 15,
    fontWeight: "700",
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 2,
  },
  countryCode: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 6,
  },
  flag: {
    fontSize: 24,
    marginRight: 6,
  },
  prefix: {
    fontSize: 17,
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 17,
    paddingVertical: 0,
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  bottomContent: {
    paddingHorizontal: 28,
    paddingBottom: 20,
  },
  nextButton: {
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
  },
  nextButtonDisabled: {
    opacity: 0.5,
  },
  nextButtonText: {
    fontSize: 17,
    fontWeight: "600",
  },
  loadingIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "80%",
  },
  modalHeader: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  modalHeaderContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    height: 48,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  searchClearButton: {
    width: 28,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  countryList: {
    paddingHorizontal: 20,
  },
  countryItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
  },
  countryItemSelected: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  countryFlag: {
    fontSize: 28,
    marginRight: 12,
    width: 40,
  },
  countryName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  countryDialCode: {
    fontSize: 16,
    fontWeight: "500",
  },
  separator: {
    height: 1,
  },
  sheetContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetBody: {
    paddingHorizontal: 28,
    paddingTop: 12,
    paddingBottom: 12,
    alignItems: "center",
  },
  sheetIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  sheetSubtitle: {
    fontSize: 15,
    textAlign: "center",
  },
  sheetPhone: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 4,
    marginBottom: 24,
  },
  sheetPrimaryButton: {
    width: "100%",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
  },
  sheetPrimaryButtonText: {
    fontSize: 17,
    fontWeight: "600",
  },
  sheetSecondaryButton: {
    paddingVertical: 14,
    alignItems: "center",
  },
  sheetSecondaryButtonText: {
    fontSize: 15,
    fontWeight: "500",
  },
  sheetError: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 12,
    textAlign: "center",
  },
  alertOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  alertCard: {
    width: "100%",
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: "center",
  },
  alertTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginTop: 16,
    marginBottom: 8,
    textAlign: "center",
  },
  alertMessage: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 24,
  },
  alertButton: {
    width: "100%",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
  },
  alertButtonText: {
    fontSize: 17,
    fontWeight: "600",
  },
});
