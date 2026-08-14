/**
 * PDF first-page rasterizer.
 *
 * Loads the PDF bytes from a local or remote URI as base64, then renders the
 * first page to a PNG data URL via pdf.js inside an off-screen WebView. The
 * caller mounts <PdfRasterizer /> with the URI; the component fires
 * `onResult(dataUrl | null)` exactly once.
 *
 * PNG is used (rather than JPEG) so that the converted image preserves text
 * sharpness for the document storage bucket — uploaded PDFs are converted to
 * PNG before being persisted.
 *
 * We can't use pdf.js directly in React Native (no DOM canvas), so the WebView
 * is the cheapest path that works inside Expo Go without any native modules.
 */

import * as FileSystem from "expo-file-system/legacy";

export async function readPdfAsBase64(uri: string): Promise<string | null> {
  try {
    if (!uri) return null;
    if (uri.startsWith("data:")) {
      const idx = uri.indexOf("base64,");
      return idx >= 0 ? uri.slice(idx + "base64,".length) : null;
    }
    if (/^https?:\/\//i.test(uri)) {
      const tmp = `${FileSystem.cacheDirectory ?? ""}pdf-${Date.now()}-${Math.floor(
        Math.random() * 1e6
      )}.pdf`;
      const dl = await FileSystem.downloadAsync(uri, tmp);
      const b64 = await FileSystem.readAsStringAsync(dl.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return b64;
    }
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return b64;
  } catch (e) {
    console.log("[pdf-raster] readPdfAsBase64 failed", e);
    return null;
  }
}

/**
 * HTML page hosted inside the off-screen WebView. Loads pdf.js from a CDN,
 * decodes the base64 PDF passed in via a global, renders the first page to a
 * hidden canvas, then posts the JPEG data URL back to the host via
 * `window.ReactNativeWebView.postMessage`.
 */
export const buildPdfRasterizerHtml = (
  base64: string,
  maxWidth: number,
  _quality: number
): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>html,body{margin:0;padding:0;background:#fff;}</style>
  </head>
  <body>
    <canvas id="c" style="display:none"></canvas>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>
      (function(){
        function post(msg){
          try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
        }
        try {
          if (!window.pdfjsLib) { post({ ok:false, error:'pdfjs-not-loaded' }); return; }
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          var b64 = ${JSON.stringify(base64)};
          var raw = atob(b64);
          var bytes = new Uint8Array(raw.length);
          for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          window.pdfjsLib.getDocument({ data: bytes }).promise.then(function(pdf){
            return pdf.getPage(1);
          }).then(function(page){
            var v1 = page.getViewport({ scale: 1 });
            var target = ${maxWidth};
            var scale = Math.min(target / v1.width, 3);
            if (!isFinite(scale) || scale <= 0) scale = 1;
            var viewport = page.getViewport({ scale: scale });
            var canvas = document.getElementById('c');
            var ctx = canvas.getContext('2d');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function(){
              var dataUrl = canvas.toDataURL('image/png');
              post({ ok:true, dataUrl: dataUrl });
            });
          }).catch(function(err){
            post({ ok:false, error: String(err && err.message || err) });
          });
        } catch (e) {
          post({ ok:false, error: String(e && e.message || e) });
        }
      })();
    </script>
  </body>
</html>`;
