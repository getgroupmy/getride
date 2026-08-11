import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { X, FileText, ExternalLink } from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  url: string | null;
  title?: string;
  onClose: () => void;
}

function isPdfUrl(u: string): boolean {
  const lower = u.toLowerCase().split("?")[0];
  return lower.endsWith(".pdf");
}

/**
 * Full-screen document viewer with pinch-to-zoom and pan.
 * - Images: rendered inside a WebView via an HTML wrapper with a viewport
 *   meta tag that enables native pinch zoom on both iOS and Android.
 * - PDFs: rendered directly by WKWebView on iOS, and via Google Docs Viewer
 *   on Android (since Android WebView can't display PDFs natively).
 */
export default function DocumentViewerModal({ visible, url, title, onClose }: Props) {
  const Colors = useColors();

  const isPdf = useMemo(() => (url ? isPdfUrl(url) : false), [url]);

  const source = useMemo(() => {
    if (!url) return null;
    if (isPdf) {
      if (Platform.OS === "android") {
        const viewer = `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}`;
        return { uri: viewer } as const;
      }
      return { uri: url } as const;
    }
    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=0.5, maximum-scale=6, user-scalable=yes" />
<style>
  html,body{margin:0;padding:0;background:#000;height:100%;}
  .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;}
  img{max-width:100%;height:auto;display:block;}
</style></head>
<body><div class="wrap"><img src="${url.replace(/"/g, "&quot;")}" /></div></body></html>`;
    return { html } as const;
  }, [url, isPdf]);

  const openExternally = async () => {
    if (!url) return;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      console.log("[doc-viewer] openExternally failed", e);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={[styles.container, { backgroundColor: "#000" }]} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} testID="doc-viewer-close" accessibilityRole="button">
            <X color="#fff" size={22} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title ?? (isPdf ? "PDF document" : "Document")}
            </Text>
            {isPdf ? (
              <View style={styles.pdfBadge}>
                <FileText color="#fff" size={11} />
                <Text style={styles.pdfBadgeText}>PDF</Text>
              </View>
            ) : null}
          </View>
          <TouchableOpacity onPress={openExternally} style={styles.iconBtn} testID="doc-viewer-open-ext" accessibilityRole="button" accessibilityLabel="Open outside the app">
            <ExternalLink color="#fff" size={20} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {!url || !source ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No document available.</Text>
            </View>
          ) : (
            <WebView
              source={source}
              style={styles.webview}
              originWhitelist={["*"]}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator color={Colors.accentText} />
                </View>
              )}
              scalesPageToFit
              allowsLinkPreview={false}
              javaScriptEnabled
              domStorageEnabled
              setSupportMultipleWindows={false}
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1, alignItems: "center" as const, gap: 4 },
  headerTitle: { color: "#fff", fontSize: 15, fontWeight: "700" as const },
  pdfBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  pdfBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" as const },
  body: { flex: 1, backgroundColor: "#000" },
  webview: { flex: 1, backgroundColor: "#000" },
  loadingWrap: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const, backgroundColor: "#000" },
  empty: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const },
  emptyText: { color: "#fff", fontSize: 14 },
});
