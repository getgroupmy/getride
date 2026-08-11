import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, Check } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

interface Language {
  code: string;
  name: string;
  nativeName: string;
}

const languages: Language[] = [
  { code: "ar", name: "Arabic (Saudi Arabia)", nativeName: "العربية" },
  { code: "bn", name: "Bangla (India)", nativeName: "বাংলা" },
  { code: "en", name: "English", nativeName: "English" },
  { code: "en-US", name: "English (United States)", nativeName: "English (US)" },
  { code: "fil", name: "Filipino", nativeName: "Filipino" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ" },
  { code: "kk", name: "Kazakh", nativeName: "Қазақша" },
  { code: "km", name: "Khmer", nativeName: "ខ្មែរ" },
  { code: "ky", name: "Kyrgyz", nativeName: "Кыргызча" },
  { code: "lo", name: "Lao (Laos)", nativeName: "ລາວ" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
  { code: "ne", name: "Nepali", nativeName: "नेपाली" },
  { code: "pt-BR", name: "Portuguese (Brazil)", nativeName: "Português (Brasil)" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்" },
  { code: "th", name: "Thai (Thailand)", nativeName: "ไทย" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська" },
  { code: "ur", name: "Urdu", nativeName: "اردو (پاکستان)" },
  { code: "vi", name: "Vietnamese (Vietnam)", nativeName: "Tiếng Việt" },
];

export default function LanguageScreen() {
  const router = useRouter();
  const Colors = useColors();
  const [selectedLanguage, setSelectedLanguage] = useState("en");

  const handleBack = () => {
    router.back();
  };

  const handleLanguageSelect = (code: string) => {
    setSelectedLanguage(code);
    console.log("Language selected:", code);
  };

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <StatusBar barStyle={Colors.background === "#000000" ? "light-content" : "dark-content"} />
      
      <SafeAreaView style={[styles.safeArea, { backgroundColor: Colors.background }]} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft color={Colors.text} size={28} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Language</Text>
          <View style={styles.placeholder} />
        </View>
      </SafeAreaView>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {languages.map((language) => (
            <TouchableOpacity
              key={language.code}
              style={styles.languageItem}
              onPress={() => handleLanguageSelect(language.code)}
              activeOpacity={0.7}
            >
              <View style={styles.languageInfo}>
                <Text style={[styles.languageNative, { color: Colors.text }]}>
                  {language.nativeName}
                </Text>
                <Text style={[styles.languageName, { color: Colors.textSecondary }]}>
                  {language.name}
                </Text>
              </View>
              {selectedLanguage === language.code && (
                <Check color="#4483e3" size={24} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {},
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  placeholder: {
    width: 32,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingTop: 8,
  },
  languageItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  languageInfo: {
    flex: 1,
  },
  languageNative: {
    fontSize: 17,
    fontWeight: "400",
    marginBottom: 2,
  },
  languageName: {
    fontSize: 14,
    fontWeight: "400",
  },
});
