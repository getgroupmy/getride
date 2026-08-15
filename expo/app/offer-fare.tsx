import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Switch,
  Dimensions,
  Animated,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import {
  ArrowLeft,
  Info,
  Send,
  Delete,
} from "lucide-react-native";
import { useLocation } from "@/contexts/LocationContext";
import { useAdminData } from "@/contexts/AdminDataContext";
import { useColors } from "@/hooks/useColors";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function OfferFareScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { currency } = useLocation();
  const Colors = useColors();
  const { getEntries } = useAdminData();
  const vehicleServiceEntries = getEntries("vehicle-services");

  const pickup = (params.pickup as string) || "Current Location";
  const destination = (params.destination as string) || "Destination";
  const entranceValue = (params.entrance as string) || "";
  const selectedPaymentMethod = (params.paymentMethod as string) || "duitnow";
  const vehicleServiceId = (params.vehicleServiceId as string) || "";
  const distanceKm = parseFloat((params.distance as string) || "") || 10;

  /**
   * Recommended fare derived from the selected vehicle service in
   * admin-settings-vehicle-services. Falls back to the first active passenger
   * service if no id is provided. This is the only source of vehicle service
   * data for this screen.
   */
  const recommendedFare = useMemo(() => {
    const activePassengerServices = vehicleServiceEntries.filter((e) => {
      const v = e.values as Record<string, unknown>;
      const active = v.status === undefined ? true : Boolean(v.status);
      const types = Array.isArray(v.serviceTypes) ? (v.serviceTypes as string[]) : [];
      const allowsPassenger = types.length === 0 || types.includes("Passenger");
      return active && allowsPassenger;
    });
    const selected =
      activePassengerServices.find((e) => e.id === vehicleServiceId) ??
      activePassengerServices.sort((a, b) => {
        const pa = Number((a.values as Record<string, unknown>).displayPriority ?? 9999);
        const pb = Number((b.values as Record<string, unknown>).displayPriority ?? 9999);
        return pa - pb;
      })[0];
    if (!selected) {
      return parseInt(params.recommendedFare as string) || 47;
    }
    const v = selected.values as Record<string, unknown>;
    const costPerKm = Number(v.costPerKm ?? 1.5) || 1.5;
    const baseFare = Number(v.baseFare ?? 0) || 0;
    const fare = Math.round(baseFare + costPerKm * distanceKm);
    return fare > 0 ? fare : 47;
  }, [vehicleServiceEntries, vehicleServiceId, distanceKm, params.recommendedFare]);

  const minFare = Math.round(recommendedFare * 0.7);
  const maxFare = Math.round(recommendedFare * 4);

  const [fareValue, setFareValue] = useState(recommendedFare.toString());

  useEffect(() => {
    setFareValue(recommendedFare.toString());
  }, [recommendedFare]);
  const [isEditing, setIsEditing] = useState(false);
  const [autoAccept, setAutoAccept] = useState(false);
  const keyboardAnim = useRef(new Animated.Value(0)).current;

  const currentFare = parseInt(fareValue) || 0;
  const isBelowMin = currentFare < minFare && currentFare > 0;
  const isAboveMax = currentFare > maxFare;
  const isValidFare = currentFare >= minFare && currentFare <= maxFare;

  useEffect(() => {
    Animated.timing(keyboardAnim, {
      toValue: isEditing ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [isEditing]);

  const handleKeyPress = (key: string) => {
    if (key === "backspace") {
      setFareValue((prev) => prev.slice(0, -1));
    } else if (key === ".") {
      if (!fareValue.includes(".")) {
        setFareValue((prev) => prev + ".");
      }
    } else {
      if (fareValue.length < 6) {
        setFareValue((prev) => (prev === "0" ? key : prev + key));
      }
    }
  };

  const handleDone = () => {
    setIsEditing(false);
  };

  const handleFindDriver = () => {
    router.back();
  };

  const getValidationMessage = () => {
    if (isBelowMin) {
      return { text: `Minimum fare is ${currency.symbol} ${minFare}`, color: Colors.errorText };
    }
    if (isAboveMax) {
      return { text: `Maximum fare is ${currency.symbol} ${maxFare}`, color: Colors.errorText };
    }
    return { text: `Recommended fare: ${currency.symbol} ${recommendedFare}`, color: Colors.text };
  };

  const validation = getValidationMessage();

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: Colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingTop: insets.top + 8,
      paddingBottom: 16,
    },
    backButton: {
      width: 40,
      height: 40,
      justifyContent: "center",
      alignItems: "center",
    },
    headerTitle: {
      flex: 1,
      fontSize: 18,
      fontWeight: "600",
      color: Colors.text,
      textAlign: "center",
      marginRight: 40,
    },
    content: {
      flex: 1,
      paddingHorizontal: 20,
    },
    instructionText: {
      fontSize: 14,
      color: Colors.textSecondary,
      marginBottom: 8,
    },
    fareContainer: {
      marginBottom: 8,
    },
    fareRow: {
      flexDirection: "row",
      alignItems: "flex-end",
    },
    fareCurrency: {
      fontSize: 48,
      fontWeight: "300",
      color: Colors.errorText,
      marginRight: 4,
    },
    fareAmount: {
      fontSize: 48,
      fontWeight: "300",
      color: Colors.text,
    },
    fareCursor: {
      width: 2,
      height: 50,
      backgroundColor: Colors.text,
      marginLeft: 2,
      marginBottom: 6,
    },
    fareDivider: {
      height: 1,
      backgroundColor: Colors.border,
      marginTop: 12,
    },
    validationText: {
      fontSize: 15,
      marginTop: 12,
      marginBottom: 20,
    },
    infoRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      backgroundColor: Colors.gray[50],
      padding: 14,
      borderRadius: 12,
      marginBottom: 16,
    },
    infoIcon: {
      marginRight: 12,
      marginTop: 2,
    },
    infoText: {
      flex: 1,
      fontSize: 14,
      color: Colors.textSecondary,
      lineHeight: 20,
    },
    paymentRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
    },
    paymentIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: Colors.accent,
      justifyContent: "center",
      alignItems: "center",
      marginRight: 14,
    },
    paymentText: {
      flex: 1,
      fontSize: 15,
      color: Colors.text,
    },
    autoAcceptRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
    },
    autoAcceptIcon: {
      marginRight: 14,
    },
    autoAcceptTextContainer: {
      flex: 1,
    },
    autoAcceptText: {
      fontSize: 15,
      color: Colors.text,
      lineHeight: 20,
    },
    locationSection: {
      marginTop: 16,
    },
    locationRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
    },
    locationDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 3,
      marginRight: 14,
    },
    pickupDot: {
      borderColor: Colors.success,
      backgroundColor: Colors.background,
    },
    destDot: {
      borderColor: Colors.error,
      backgroundColor: Colors.background,
    },
    locationText: {
      flex: 1,
      fontSize: 15,
      color: Colors.text,
    },
    entranceBadge: {
      backgroundColor: Colors.gray[100],
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
    },
    entranceText: {
      fontSize: 13,
      color: Colors.text,
      fontWeight: "500",
    },
    addButton: {
      width: 32,
      height: 32,
      justifyContent: "center",
      alignItems: "center",
    },
    bottomContainer: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: insets.bottom + 12,
      backgroundColor: Colors.background,
    },
    doneButton: {
      alignSelf: "flex-end",
      paddingVertical: 8,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    doneButtonText: {
      fontSize: 16,
      color: Colors.accentText,
      fontWeight: "500",
    },
    bottomBar: {
      flexDirection: "row",
      alignItems: "center",
    },
    findDriverButton: {
      flex: 1,
      backgroundColor: Colors.accent,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    findDriverButtonDisabled: {
      flex: 1,
      backgroundColor: Colors.gray[200],
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    findDriverText: {
      fontSize: 16,
      fontWeight: "700",
      color: "#000000",
    },
    findDriverTextDisabled: {
      fontSize: 16,
      fontWeight: "700",
      color: Colors.gray[400],
    },
    settingsButton: {
      width: 52,
      height: 52,
      borderRadius: 12,
      backgroundColor: Colors.accent,
      justifyContent: "center",
      alignItems: "center",
      marginLeft: 12,
    },
    keyboardContainer: {
      backgroundColor: Colors.gray[200],
      paddingHorizontal: 6,
      paddingTop: 10,
      paddingBottom: insets.bottom + 10,
    },
    keypadRow: {
      flexDirection: "row",
      justifyContent: "center",
      marginBottom: 8,
    },
    keypadButton: {
      width: (SCREEN_WIDTH - 36) / 3,
      height: 52,
      backgroundColor: Colors.background,
      borderRadius: 8,
      justifyContent: "center",
      alignItems: "center",
      marginHorizontal: 3,
    },
    keypadButtonEmpty: {
      width: (SCREEN_WIDTH - 36) / 3,
      height: 52,
      backgroundColor: "transparent",
      marginHorizontal: 3,
    },
    keypadButtonBackspace: {
      width: (SCREEN_WIDTH - 36) / 3,
      height: 52,
      backgroundColor: "transparent",
      borderRadius: 8,
      justifyContent: "center",
      alignItems: "center",
      marginHorizontal: 3,
    },
    keypadNumber: {
      fontSize: 28,
      fontWeight: "400",
      color: Colors.text,
    },
    keypadLetters: {
      fontSize: 10,
      fontWeight: "600",
      color: Colors.text,
      letterSpacing: 2,
      marginTop: -2,
    },
  });

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Offer your fare</Text>
      </View>

      <View style={styles.content}>
        {isEditing && (
          <Text style={styles.instructionText}>You can change the recommended fare</Text>
        )}

        <TouchableOpacity
          style={styles.fareContainer}
          onPress={() => setIsEditing(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <View style={styles.fareRow}>
            <Text style={styles.fareCurrency}>{currency.symbol}</Text>
            <Text style={styles.fareAmount}>{fareValue || "0"}</Text>
            {isEditing && <View style={styles.fareCursor} />}
          </View>
          <View style={styles.fareDivider} />
        </TouchableOpacity>

        <Text style={[styles.validationText, { color: validation.color }]}>
          {validation.text}
        </Text>

        <View style={styles.infoRow}>
          <Info color={Colors.textSecondary} size={20} style={styles.infoIcon} />
          <Text style={styles.infoText}>
            Fare doesn&apos;t include state entry tax, tolls, or parking fees
          </Text>
        </View>

        {/* Not a control — this row reports the payment method. */}
        <View style={styles.paymentRow}>
          <Image
            source={{
              uri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/3drcunhhotpoqbujxqkwp",
            }}
            style={{ width: 40, height: 40, borderRadius: 20 }}
            resizeMode="contain"
          />
          <Text style={[styles.paymentText, { marginLeft: 14 }]}>
            DuItNow manual transfer
          </Text>
        </View>

        <View style={styles.autoAcceptRow}>
          <Send color={Colors.text} size={20} style={styles.autoAcceptIcon} />
          <View style={styles.autoAcceptTextContainer}>
            <Text style={styles.autoAcceptText}>
              Automatically accept the nearest{"\n"}driver for {currency.symbol} {currentFare || recommendedFare}
            </Text>
          </View>
          <Switch
            value={autoAccept}
            onValueChange={setAutoAccept}
            trackColor={{ false: Colors.gray[200], true: Colors.accentDark }}
            thumbColor={autoAccept ? Colors.accent : "#FFFFFF"}
            accessibilityLabel="Fare doesn't include state entry tax, tolls, or parking fees"
          />
        </View>

        <View style={styles.locationSection}>
          <View style={styles.locationRow}>
            <View style={[styles.locationDot, styles.pickupDot]} />
            <Text style={styles.locationText} numberOfLines={1}>
              {pickup}
            </Text>
            <View style={styles.entranceBadge}>
              <Text style={styles.entranceText}>
                Entrance{entranceValue ? ` ${entranceValue}` : ""}
              </Text>
            </View>
          </View>

          <View style={styles.locationRow}>
            <View style={[styles.locationDot, styles.destDot]} />
            <Text style={styles.locationText} numberOfLines={1}>
              {destination}
            </Text>
          </View>
        </View>
      </View>

      {isEditing ? (
        <View>
          <View style={styles.bottomContainer}>
            <TouchableOpacity style={styles.doneButton} onPress={handleDone} accessibilityRole="button">
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.keyboardContainer}>
            <View style={styles.keypadRow}>
              <TouchableOpacity
                style={styles.keypadButton}
                onPress={() => handleKeyPress("1")}
                accessibilityRole="button"
              >
                <Text style={styles.keypadNumber}>1</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.keypadButton}
                onPress={() => handleKeyPress("2")}
                accessibilityRole="button"
              >
                <Text style={styles.keypadNumber}>2</Text>
                <Text style={styles.keypadLetters}>ABC</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.keypadButton}
                onPress={() => handleKeyPress("3")}
                accessibilityRole="button"
              >
                <Text style={styles.keypadNumber}>3</Text>
                <Text style={styles.keypadLetters}>DEF</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.keypadRow}>
              <TouchableOpacity
                style={styles.keypadButton}
                onPress={() => handleKeyPress("4")}
                accessibilityRole="button"
              >
                <Text style={styles.keypadNumber}>4</Text>
                <Text style={styles.keypadLetters}>GHI</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.keypadButton}
                onPress={() => handleKeyPress("5")}
                accessibilityRole="button"
              >
                <Text style={styles.keypadNumber}>5</Text>
                <Text style={styles.keypadLetters}>JKL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.keypadButton}
                onPress={() => handleKeyPress("6")}
                accessibilityRole="button"
              >
                <Text style={styles.keypadNumber}>6</Text>
                <Text style={styles.keypadLetters}>MNO</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.keypadRow}>
              <TouchableOpacity
                style={styles.keypadButton}
                onPress={() => handleKeyPress("7")}
                accessibilityRole="button"
              >
                <Text style={styles.keypadNumber}>7</Text>
                <Text style={styles.keypadLetters}>PQRS</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.keypadButton}
                onPress={() => handleKeyPress("8")}
                accessibilityRole="button"
              >
                <Text style={styles.keypadNumber}>8</Text>
                <Text style={styles.keypadLetters}>TUV</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.keypadButton}
                onPress={() => handleKeyPress("9")}
                accessibilityRole="button"
              >
                <Text style={styles.keypadNumber}>9</Text>
                <Text style={styles.keypadLetters}>WXYZ</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.keypadRow}>
              <TouchableOpacity
                style={styles.keypadButton}
                onPress={() => handleKeyPress(".")}
                accessibilityRole="button"
              >
                <Text style={styles.keypadNumber}>.</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.keypadButton}
                onPress={() => handleKeyPress("0")}
                accessibilityRole="button"
              >
                <Text style={styles.keypadNumber}>0</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.keypadButtonBackspace}
                onPress={() => handleKeyPress("backspace")}
                accessibilityRole="button"
                accessibilityLabel="Delete"
              >
                <Delete color={Colors.text} size={26} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.bottomContainer}>
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={isValidFare ? styles.findDriverButton : styles.findDriverButtonDisabled}
              onPress={handleFindDriver}
              disabled={!isValidFare}
              accessibilityRole="button"
              accessibilityLabel="Find a driver"
              accessibilityState={{ disabled: !isValidFare }}
            >
              <Text style={isValidFare ? styles.findDriverText : styles.findDriverTextDisabled}>
                Find a driver
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}
