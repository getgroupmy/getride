import React, { useState, useRef } from "react";
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
  Animated,
  PanResponder,
  Dimensions,
  Easing,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ChevronLeft, X, ChevronDown, Search, ShieldCheck } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";

interface Country {
  name: string;
  code: string;
  dialCode: string;
  flag: string;
  minLength: number;
  maxLength: number;
}

const COUNTRIES: Country[] = [
  { name: "Malaysia", code: "MY", dialCode: "+60", flag: "🇲🇾", minLength: 9, maxLength: 10 },
  { name: "United States", code: "US", dialCode: "+1", flag: "🇺🇸", minLength: 10, maxLength: 10 },
  { name: "United Kingdom", code: "GB", dialCode: "+44", flag: "🇬🇧", minLength: 10, maxLength: 10 },
  { name: "Singapore", code: "SG", dialCode: "+65", flag: "🇸🇬", minLength: 8, maxLength: 8 },
  { name: "Indonesia", code: "ID", dialCode: "+62", flag: "🇮🇩", minLength: 9, maxLength: 12 },
  { name: "Thailand", code: "TH", dialCode: "+66", flag: "🇹🇭", minLength: 9, maxLength: 9 },
  { name: "Philippines", code: "PH", dialCode: "+63", flag: "🇵🇭", minLength: 10, maxLength: 10 },
  { name: "Vietnam", code: "VN", dialCode: "+84", flag: "🇻🇳", minLength: 9, maxLength: 10 },
  { name: "Australia", code: "AU", dialCode: "+61", flag: "🇦🇺", minLength: 9, maxLength: 9 },
  { name: "India", code: "IN", dialCode: "+91", flag: "🇮🇳", minLength: 10, maxLength: 10 },
  { name: "China", code: "CN", dialCode: "+86", flag: "🇨🇳", minLength: 11, maxLength: 11 },
  { name: "Japan", code: "JP", dialCode: "+81", flag: "🇯🇵", minLength: 10, maxLength: 10 },
  { name: "South Korea", code: "KR", dialCode: "+82", flag: "🇰🇷", minLength: 9, maxLength: 10 },
  { name: "Canada", code: "CA", dialCode: "+1", flag: "🇨🇦", minLength: 10, maxLength: 10 },
  { name: "Germany", code: "DE", dialCode: "+49", flag: "🇩🇪", minLength: 10, maxLength: 11 },
  { name: "France", code: "FR", dialCode: "+33", flag: "🇫🇷", minLength: 9, maxLength: 9 },
  { name: "Italy", code: "IT", dialCode: "+39", flag: "🇮🇹", minLength: 9, maxLength: 10 },
  { name: "Spain", code: "ES", dialCode: "+34", flag: "🇪🇸", minLength: 9, maxLength: 9 },
  { name: "Netherlands", code: "NL", dialCode: "+31", flag: "🇳🇱", minLength: 9, maxLength: 9 },
  { name: "Brazil", code: "BR", dialCode: "+55", flag: "🇧🇷", minLength: 10, maxLength: 11 },
  { name: "Mexico", code: "MX", dialCode: "+52", flag: "🇲🇽", minLength: 10, maxLength: 10 },
  { name: "Argentina", code: "AR", dialCode: "+54", flag: "🇦🇷", minLength: 10, maxLength: 10 },
  { name: "South Africa", code: "ZA", dialCode: "+27", flag: "🇿🇦", minLength: 9, maxLength: 9 },
  { name: "Egypt", code: "EG", dialCode: "+20", flag: "🇪🇬", minLength: 10, maxLength: 10 },
  { name: "Saudi Arabia", code: "SA", dialCode: "+966", flag: "🇸🇦", minLength: 9, maxLength: 9 },
  { name: "UAE", code: "AE", dialCode: "+971", flag: "🇦🇪", minLength: 9, maxLength: 9 },
  { name: "Turkey", code: "TR", dialCode: "+90", flag: "🇹🇷", minLength: 10, maxLength: 10 },
  { name: "Russia", code: "RU", dialCode: "+7", flag: "🇷🇺", minLength: 10, maxLength: 10 },
  { name: "Pakistan", code: "PK", dialCode: "+92", flag: "🇵🇰", minLength: 10, maxLength: 10 },
  { name: "Bangladesh", code: "BD", dialCode: "+880", flag: "🇧🇩", minLength: 10, maxLength: 10 },
];

const formatPhoneNumber = (number: string): string => {
  if (number.length <= 2) return number;
  if (number.length <= 5) return `${number.slice(0, 2)}-${number.slice(2)}`;
  return `${number.slice(0, 2)}-${number.slice(2, 5)} ${number.slice(5)}`;
};

export default function ChangeNumberScreen() {
  const router = useRouter();
  const { verified } = useLocalSearchParams<{ verified?: string }>();
  const isPinVerified = verified === "true";
  const Colors = useColors();
  const styles = makeStyles(Colors);
  const { isSupabaseAuth, authState, sendPhoneChangeOtp, sendOtp } = useAuth();
  const [sendError, setSendError] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]);
  const [isCountryPickerVisible, setIsCountryPickerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isErrorSheetVisible, setIsErrorSheetVisible] = useState(false);
  const [showDialCode, setShowDialCode] = useState(true);
  const inputRef = useRef<TextInput>(null);
  const errorSheetTranslateY = useRef(new Animated.Value(0)).current;

  const validatePhoneNumber = (): boolean => {
    let cleanedPhone = phoneNumber;
    if (cleanedPhone.startsWith("0")) {
      cleanedPhone = cleanedPhone.substring(1);
    }
    const length = cleanedPhone.length;
    return length >= selectedCountry.minLength && length <= selectedCountry.maxLength;
  };

  const handleContinue = async () => {
    if (!phoneNumber) return;

    if (!validatePhoneNumber()) {
      errorSheetTranslateY.setValue(0);
      setIsErrorSheetVisible(true);
      return;
    }

    setIsLoading(true);
    
    let cleanedPhone = phoneNumber;
    const dialCodeDigits = selectedCountry.dialCode.replace(/\D/g, "");
    
    if (cleanedPhone.startsWith(dialCodeDigits)) {
      cleanedPhone = cleanedPhone.substring(dialCodeDigits.length);
    }
    if (cleanedPhone.startsWith("0")) {
      cleanedPhone = cleanedPhone.substring(1);
    }
    
    const fullPhoneNumber = `${selectedCountry.dialCode}${cleanedPhone}`;
    
    console.log("Change number - Full phone number:", fullPhoneNumber);
    setSendError(null);

    // Pre-send duplicate check: block if this number already belongs to
    // another non-deleted profile. Uses the SECURITY DEFINER RPC so RLS
    // doesn't hide the row from the anon/authenticated client.
    const currentPhone = authState.phoneNumber ?? null;
    const isSameAsCurrent = currentPhone === fullPhoneNumber;
    if (isSupabaseConfigured && supabase && !isSameAsCurrent) {
      try {
        const { data, error } = await supabase.rpc("profile_phone_lookup", {
          p_phone: fullPhoneNumber,
        });
        if (error) {
          console.log("[change-number] rpc error", error.message);
        } else {
          const row = Array.isArray(data) ? data[0] : data;
          const r = row as { has_profile?: boolean; is_deleted?: boolean } | null;
          const hasProfile = !!r?.has_profile;
          const isDeleted = !!r?.is_deleted;
          console.log("[change-number] dup check:", { fullPhoneNumber, hasProfile, isDeleted });
          if (hasProfile && !isDeleted) {
            setIsLoading(false);
            setSendError("This number is already linked to another account.");
            return;
          }
        }
      } catch (e) {
        console.log("[change-number] rpc threw", e);
      }
    }

    if (isSupabaseAuth) {
      const res = authState.isSupabaseSession
        ? await sendPhoneChangeOtp(fullPhoneNumber)
        : await sendOtp(fullPhoneNumber, { shouldCreateUser: false });
      setIsLoading(false);
      if (!res.ok) {
        setSendError(res.error ?? "Failed to send code");
        return;
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
      setIsLoading(false);
    }

    router.push({
      pathname: "/otp-verify",
      params: { phoneNumber: fullPhoneNumber, isChangeNumber: "true", pinVerified: isPinVerified ? "true" : "false" },
    });
  };

  const handlePhoneChange = (text: string) => {
    const cleaned = text.replace(/\D/g, "");
    if (cleaned.length <= 15) {
      setPhoneNumber(cleaned);
      if (cleaned.length > 0 && !showDialCode) {
        setShowDialCode(true);
      }
    }
  };

  const handleClearPhone = () => {
    if (phoneNumber === "") {
      setShowDialCode(false);
    } else {
      setPhoneNumber("");
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

  const showClearButton = isFocused;

  const sheetHeight = Dimensions.get('window').height * 0.90;
  const translateY = useRef(new Animated.Value(0)).current;
  const lastGestureDy = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        lastGestureDy.current = 0;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
          lastGestureDy.current = gestureState.dy;
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const threshold = sheetHeight * 0.4;
        const velocity = gestureState.vy;
        
        if (gestureState.dy > threshold || velocity > 0.5) {
          const baseDuration = 250;
          const velocityFactor = Math.max(0.5, 1 - Math.abs(velocity) * 0.3);
          const duration = Math.min(baseDuration * velocityFactor, 300);
          
          Animated.timing(translateY, {
            toValue: sheetHeight,
            duration: duration,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start(() => {
            setIsCountryPickerVisible(false);
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 8,
          }).start();
        }
      },
    })
  ).current;

  const handleCloseSheet = () => {
    Animated.timing(translateY, {
      toValue: sheetHeight,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setIsCountryPickerVisible(false);
    });
  };

  const handleOpenSheet = () => {
    translateY.setValue(0);
    setIsCountryPickerVisible(true);
  };

  const errorSheetHeight = 420;

  const errorPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {},
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          errorSheetTranslateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: () => {
        Animated.spring(errorSheetTranslateY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 8,
        }).start();
      },
    })
  ).current;

  const handleCloseErrorSheet = () => {
    Animated.timing(errorSheetTranslateY, {
      toValue: errorSheetHeight,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setIsErrorSheetVisible(false);
    });
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft color={Colors.text} size={28} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.content}
      >
        <View style={styles.topContent}>
          <Text style={styles.title}>Change number?</Text>
          {isPinVerified && (
            <View style={styles.verifiedBadge} testID="change-number-verified-badge">
              <ShieldCheck color={Colors.success} size={14} strokeWidth={2.5} />
              <Text style={styles.verifiedBadgeText}>PIN verified · step skipped</Text>
            </View>
          )}
          <Text style={styles.subtitle}>
            Your account and data will be linked to the new number
          </Text>

          <TouchableOpacity 
            style={[styles.inputContainer, isFocused && styles.inputContainerFocused]}
            activeOpacity={1}
            onPress={() => inputRef.current?.focus()}
            accessibilityRole="button"
          >
            <TouchableOpacity
              style={styles.countrySelector}
              onPress={handleOpenSheet}
              accessibilityRole="button"
            >
              <Text style={styles.flag}>{selectedCountry.flag}</Text>
              <ChevronDown color={Colors.text} size={16} strokeWidth={2.5} />
            </TouchableOpacity>

            <View style={styles.phoneInputWrapper}>
              <Text style={styles.inputLabel}>New phone number</Text>
              <View style={styles.phoneRow}>
                <Text style={styles.phoneDisplay}>
                  {showDialCode ? selectedCountry.dialCode : ''}{phoneNumber ? (showDialCode ? ` ${formatPhoneNumber(phoneNumber)}` : formatPhoneNumber(phoneNumber)) : ''}
                </Text>
                <TextInput
                  ref={inputRef}
                  style={styles.hiddenInput}
                  value={phoneNumber}
                  onChangeText={handlePhoneChange}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  keyboardType="number-pad"
                  maxLength={15}
                  caretHidden={true}
                  autoFocus={false}
                />
                {isFocused && (
                  <View style={styles.cursorContainer}>
                    <View style={styles.cursor} />
                  </View>
                )}
              </View>
            </View>

            {showClearButton && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={handleClearPhone}
                accessibilityRole="button"
              >
                <View style={styles.clearButtonInner}>
                  <X color="#FFFFFF" size={12} strokeWidth={3} />
                </View>
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          {sendError ? (
            <Text style={styles.sendErrorText}>{sendError}</Text>
          ) : null}

          <TouchableOpacity
            style={[
              styles.continueButton,
              phoneNumber.length > 0 && styles.continueButtonActive,
            ]}
            onPress={handleContinue}
            disabled={!phoneNumber || isLoading}
            accessibilityRole="button"
          >
            {isLoading ? (
              <View style={styles.loadingIndicator} />
            ) : (
              <Text
                style={[
                  styles.continueButtonText,
                  phoneNumber.length > 0 && styles.continueButtonTextActive,
                ]}
              >
                Continue
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={isCountryPickerVisible}
        animationType="none"
        transparent={true}
        onRequestClose={handleCloseSheet}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={handleCloseSheet}
            accessibilityRole="button"
          />
          <Animated.View 
            style={[
              styles.modalContent,
              { height: sheetHeight, transform: [{ translateY }] }
            ]}
            {...panResponder.panHandlers}
          >
            <View style={styles.dragHandleContainer}>
              <View style={styles.dragHandle} />
            </View>
            <SafeAreaView edges={["top"]} style={styles.modalHeader}>
              <View style={styles.modalHeaderContent}>
                <Text style={styles.modalTitle}>Select Country</Text>
                <TouchableOpacity
                  onPress={handleCloseSheet}
                  style={styles.closeButton}
                  accessibilityRole="button"
                >
                  <X color={Colors.text} size={24} />
                </TouchableOpacity>
              </View>
              <View style={styles.searchContainer}>
                <Search color={Colors.textSecondary} size={20} style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search country or code"
                  placeholderTextColor={Colors.textSecondary}
                  autoCapitalize="none"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setSearchQuery("")}
                    style={styles.searchClearButton}
                    accessibilityRole="button"
                  >
                    <X color={Colors.textSecondary} size={16} />
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
                    selectedCountry.code === item.code && styles.countryItemSelected,
                  ]}
                  onPress={() => handleCountrySelect(item)}
                  accessibilityRole="button"
                >
                  <Text style={styles.countryFlag}>{item.flag}</Text>
                  <Text style={styles.countryName}>{item.name}</Text>
                  <Text style={styles.countryDialCode}>{item.dialCode}</Text>
                </TouchableOpacity>
              )}
              showsVerticalScrollIndicator={false}
              scrollEnabled={true}
            />
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={isErrorSheetVisible}
        animationType="none"
        transparent={true}
        onRequestClose={handleCloseErrorSheet}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={handleCloseErrorSheet}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
          <Animated.View 
            style={[
              styles.errorSheetContent,
              { transform: [{ translateY: errorSheetTranslateY }] }
            ]}
            {...errorPanResponder.panHandlers}
          >
            <View style={styles.errorSheetHeader}>
              <TouchableOpacity
                onPress={handleCloseErrorSheet}
                style={styles.errorCloseButton}
                accessibilityRole="button"
              >
                <X color={Colors.text} size={24} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.errorSheetBody}>
              <Image
                source={{ uri: 'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/46dhegfmzdggv08z7pf9n' }}
                style={styles.errorImage}
                resizeMode="contain"
              />
              
              <Text style={styles.errorText}>invalid phone, code InvalidArgument</Text>
              
              <TouchableOpacity
                style={styles.errorCloseButtonBottom}
                onPress={handleCloseErrorSheet}
                accessibilityRole="button"
              >
                <Text style={styles.errorCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (Colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeArea: {
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
  },
  content: {
    flex: 1,
  },
  topContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    lineHeight: 24,
    marginBottom: 32,
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(16,185,129,0.12)",
    marginBottom: 12,
  },
  verifiedBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.success,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.gray[50],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingLeft: 16,
    paddingRight: 16,
    height: 72,
    marginBottom: 16,
  },
  inputContainerFocused: {
    borderColor: Colors.text,
    borderWidth: 1.5,
  },
  countrySelector: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 12,
    borderRightWidth: 0,
  },
  flag: {
    fontSize: 24,
    marginRight: 6,
  },
  phoneInputWrapper: {
    flex: 1,
    paddingLeft: 12,
    justifyContent: "center",
  },
  inputLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 24,
  },
  phoneDisplay: {
    fontSize: 17,
    color: Colors.text,
    fontWeight: "400",
  },
  phoneInput: {
    fontSize: 17,
    padding: 0,
    margin: 0,
    minHeight: 24,
  },
  hiddenInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  cursorContainer: {
    marginLeft: 2,
    height: 20,
    justifyContent: "center",
  },
  cursor: {
    width: 2,
    height: 18,
    backgroundColor: Colors.text,
  },
  clearButton: {
    padding: 4,
    marginLeft: 8,
  },
  clearButtonInner: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.gray[400],
    justifyContent: "center",
    alignItems: "center",
  },
  continueButton: {
    backgroundColor: Colors.gray[200],
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
  },
  continueButtonActive: {
    backgroundColor: Colors.accent,
  },
  continueButtonText: {
    fontSize: 17,
    fontWeight: "600",
    color: Colors.gray[400],
  },
  continueButtonTextActive: {
    color: "#000000",
  },
  sendErrorText: {
    fontSize: 14,
    color: Colors.error,
    marginBottom: 12,
    fontWeight: "500",
  },
  loadingIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: Colors.gray[400],
    borderTopColor: "transparent",
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
    backgroundColor: Colors.gray[50],
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  dragHandleContainer: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 8,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.gray[300],
    borderRadius: 2,
  },
  modalHeader: {
    backgroundColor: Colors.gray[50],
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
    color: Colors.text,
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
    backgroundColor: Colors.gray[100],
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
    color: Colors.text,
  },
  searchClearButton: {
    width: 28,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  countryList: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: Colors.gray[50],
  },
  countryItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
  },
  countryItemSelected: {
    backgroundColor: Colors.gray[100],
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
    color: Colors.text,
  },
  countryDialCode: {
    fontSize: 16,
    fontWeight: "500",
    color: Colors.textSecondary,
  },
  errorSheetContent: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
    minHeight: 420,
  },
  errorSheetHeader: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  errorCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.gray[100],
    justifyContent: "center",
    alignItems: "center",
  },
  errorSheetBody: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  errorImage: {
    width: 200,
    height: 180,
    marginBottom: 40,
  },
  errorText: {
    fontSize: 16,
    color: Colors.text,
    textAlign: "left",
    alignSelf: "flex-start",
    marginBottom: 24,
  },
  errorCloseButtonBottom: {
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  errorCloseButtonText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#000000",
  },
});
