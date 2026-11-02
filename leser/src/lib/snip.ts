// Ausschnitt-Werkzeug: Ein auf dem Bildschirm aufgezogenes Rechteck wird als scharfes PNG erzeugt – aus dem PDF neu
// gerendert (nicht abfotografiert), mit den sichtbaren Notizen, auch über Seitengrenzen hinweg.

import { renderRegionCanvas, type PDFDocumentProxy } from "./pdf";
import type { PageInk } from "./ink";

export interface ClientRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const MAX_PIXELS = 16_000_000; // Safari begrenzt Canvas-Flächen (iPad ca. 16 MP)

/**
 * Erzeugt das Bild eines Bildschirmausschnitts.
 * @param pageEls die gerenderten Seiten-Elemente (.page) mit data-page
 * @param scale   aktueller Darstellungsmaßstab (CSS-Pixel je PDF-Einheit)
 */
export async function snipImage(
  doc: PDFDocumentProxy,
  pageEls: HTMLElement[],
  rect: ClientRect,
  scale: number,
  ink: PageInk | null,
): Promise<Blob> {
  const cssW = rect.right - rect.left;
  const cssH = rect.bottom - rect.top;
  // Auflösung: mindestens 3 Pixel je PDF-Einheit (≈ 216 dpi), höchstens MAX_PIXELS
  let f = Math.max(3 / scale, 2);
  if (cssW * cssH * f * f > MAX_PIXELS) f = Math.sqrt(MAX_PIXELS / (cssW * cssH));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(cssW * f));
  out.height = Math.max(1, Math.round(cssH * f));
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);

  for (const el of pageEls) {
    const pr = el.getBoundingClientRect();
    const l = Math.max(rect.left, pr.left);
    const t = Math.max(rect.top, pr.top);
    const r = Math.min(rect.right, pr.right);
    const b = Math.min(rect.bottom, pr.bottom);
    if (r - l < 1 || b - t < 1) continue;
    const page = Number(el.dataset.page);
    const region = { x: (l - pr.left) / scale, y: (t - pr.top) / scale, w: (r - l) / scale, h: (b - t) / scale };
    const part = await renderRegionCanvas(doc, page, region, scale * f, ink?.[page]);
    ctx.drawImage(part, Math.round((l - rect.left) * f), Math.round((t - rect.top) * f));
    part.width = part.height = 0;
  }
  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, "image/png"));
  out.width = out.height = 0;
  if (!blob) throw new Error("Bild konnte nicht erzeugt werden.");
  return blob;
}

/**
 * Bild in die Zwischenablage legen. Muss direkt aus einem Tipp/Klick heraus aufgerufen werden; Safari verlangt dabei
 * ein ClipboardItem mit einem Promise, das erst später fertig wird. Liefert false, wenn der Browser es nicht erlaubt.
 */
export async function copyImage(blob: Promise<Blob>): Promise<boolean> {
  try {
    // Safari ab 13.1, Chrome; ältere Firefox kennen ClipboardItem nicht → dann Rückfall auf das Fenster
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
    // eslint-disable-next-line compat/compat -- oben geprüft; fehlt nur in älterem Firefox
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}
