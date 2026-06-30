import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { buildPdfRasterizerHtml, readPdfAsBase64 } from "@/utils/pdfRasterize";

interface Props {
  /** Local file:// path, content:// path, http(s) URL, or data: URL to a PDF. */
  uri: string;
  /** Fires once with a PNG data URL of the first page, or null on failure. */
  onResult: (dataUrl: string | null) => void;
  maxWidth?: number;
  /** Unused for PNG output; kept for API compatibility. */
  quality?: number;
}

/**
 * Off-screen WebView that rasterizes the first page of a PDF to a PNG data
 * URL using pdf.js. Mount it whenever you have a PDF that needs to be passed
 * to an image-only API (e.g. the document AI verifier) or stored as an image.
 */
export default function PdfRasterizer({
  uri,
  onResult,
  maxWidth = 1600,
  quality = 1,
}: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const settled = useRef<boolean>(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    settled.current = false;
    (async () => {
      const b64 = await readPdfAsBase64(uri);
      if (cancelled) return;
      if (!b64) {
        if (!settled.current) {
          settled.current = true;
          onResult(null);
        }
        return;
      }
      setHtml(buildPdfRasterizerHtml(b64, maxWidth, quality));
    })();
    timeoutRef.current = setTimeout(() => {
      if (!settled.current) {
        settled.current = true;
        console.log("[pdf-raster] timed out after 20s");
        onResult(null);
      }
    }, 20000);
    return () => {
      cancelled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [uri, maxWidth, quality, onResult]);

  const onMessage = (e: WebViewMessageEvent) => {
    if (settled.current) return;
    try {
      const parsed = JSON.parse(e.nativeEvent.data) as
        | { ok: true; dataUrl: string }
        | { ok: false; error?: string };
      if (parsed.ok && parsed.dataUrl) {
        settled.current = true;
        onResult(parsed.dataUrl);
      } else {
        settled.current = true;
        console.log("[pdf-raster] webview reported error", (parsed as { error?: string }).error);
        onResult(null);
      }
    } catch (err) {
      settled.current = true;
      console.log("[pdf-raster] message parse failed", err);
      onResult(null);
    }
  };

  const source = useMemo(() => (html ? { html } : null), [html]);
  if (!source) return null;
  if (Platform.OS === "web") {
    // react-native-webview on web isn't reliable; skip rasterization there.
    if (!settled.current) {
      settled.current = true;
      onResult(null);
    }
    return null;
  }

  return (
    <View style={[styles.hidden, { pointerEvents: "none" }]}>
      <WebView
        originWhitelist={["*"]}
        source={source}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
        onError={(e) => {
          if (settled.current) return;
          settled.current = true;
          console.log("[pdf-raster] webview onError", e.nativeEvent);
          onResult(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    left: -1000,
    top: -1000,
  },
});
