import { toPng } from "html-to-image";

interface CaptureOptions {
  /** Filename for the downloaded PNG (without extension). */
  filename?: string;
  /** Pixel ratio multiplier — 2x produces crisp results on retina/social. */
  pixelRatio?: number;
  /** Background color for the captured image. Defaults to the app's dark bg. */
  backgroundColor?: string;
}

/**
 * Capture a DOM node and download it as a PNG.
 *
 * `html-to-image` walks the node, inlines computed styles, and renders to a
 * canvas. Anything outside the node tree (sidebar, scrollbars) is excluded
 * automatically.
 *
 * Notes:
 *   - Caller is responsible for ensuring the node is visible in the DOM.
 *   - For Recharts/SVG content, html-to-image handles inlining of styles.
 *   - We rely on a single recommended "double pass" trick: render once to
 *     warm fonts/images, then a second time for the final capture. This
 *     avoids the common "first export is blank" issue across browsers.
 */
export async function downloadNodeAsImage(
  node: HTMLElement,
  opts: CaptureOptions = {}
): Promise<void> {
  const {
    filename = "tradefolio",
    pixelRatio = 2,
    backgroundColor = "hsl(222 38% 13%)", // matches --color-background
  } = opts;

  // First pass — primes browser caches (fonts, gradients, images).
  await toPng(node, { pixelRatio, backgroundColor, cacheBust: true });

  // Second pass — the one we actually download.
  const dataUrl = await toPng(node, {
    pixelRatio,
    backgroundColor,
    cacheBust: true,
  });

  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.png`;
  link.click();
}

/**
 * Same as downloadNodeAsImage but writes the PNG to the system clipboard
 * instead of downloading it. Falls back to download if the Clipboard API
 * isn't available (older browsers / non-https origins).
 */
export async function copyNodeAsImage(
  node: HTMLElement,
  opts: CaptureOptions = {}
): Promise<"copied" | "downloaded"> {
  const {
    pixelRatio = 2,
    backgroundColor = "hsl(222 38% 13%)",
  } = opts;

  await toPng(node, { pixelRatio, backgroundColor, cacheBust: true });
  const dataUrl = await toPng(node, {
    pixelRatio,
    backgroundColor,
    cacheBust: true,
  });

  // Convert data URL to Blob
  const blob = await (await fetch(dataUrl)).blob();

  // Try the modern Clipboard API
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    "write" in navigator.clipboard &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      return "copied";
    } catch {
      // fall through to download
    }
  }

  // Fallback: trigger a download
  await downloadNodeAsImage(node, opts);
  return "downloaded";
}
