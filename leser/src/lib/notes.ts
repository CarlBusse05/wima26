// Notiz-Zettel: Inhalt bereinigen (nur Text, einfache Formatierung, eingebettete Bilder und Zeichenfelder) und
// Bilder verkleinern.
// Bilder werden als data:-URL im Notiz-HTML gespeichert – so landen sie ohne Sonderbehandlung in der Datensicherung.

import { parseInkData, serializeInk } from "./inkblock";

const ALLOWED = new Set(["DIV", "P", "BR", "B", "STRONG", "I", "EM", "U", "IMG", "MARK"]); // MARK: mit dem Marker hervorgehoben
const IMAGE_SRC = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_WIDTH = 1600;

function clean(node: Node, doc: Document): Node[] {
  if (node.nodeType === Node.TEXT_NODE) return [doc.createTextNode(node.textContent ?? "")];
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as Element;
  // Zeichenfeld: nur die geprüften Strich-Daten behalten (Canvas und Knöpfe entstehen beim Anzeigen neu)
  if (el.tagName === "DIV" && el.hasAttribute("data-ink")) {
    const data = parseInkData(el.getAttribute("data-ink"));
    if (!data) return [];
    const div = doc.createElement("div");
    div.setAttribute("data-ink", serializeInk(data));
    return [div];
  }
  const children = Array.from(el.childNodes).flatMap((c) => clean(c, doc));
  if (!ALLOWED.has(el.tagName)) {
    // unbekannte Elemente (span, font, a …) auflösen, Inhalt behalten; Skripte & Co. ganz verwerfen
    return /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|svg|SVG|MATH)$/.test(el.tagName) ? [] : children;
  }
  if (el.tagName === "IMG") {
    const src = el.getAttribute("src") ?? "";
    if (!IMAGE_SRC.test(src)) return [];
    const img = doc.createElement("img");
    img.setAttribute("src", src);
    img.setAttribute("alt", "");
    const w = imageWidth(el.getAttribute("data-w"));
    if (w) img.setAttribute("data-w", String(w));
    return [img];
  }
  const out = doc.createElement(el.tagName.toLowerCase());
  out.append(...children);
  return [out];
}

export const MIN_IMAGE_W = 0.2;
/** Breite eines verkleinerten Bilds als Anteil der Textbreite (0,2 … <1); null = volle Breite des Felds. */
export function imageWidth(v: string | null | undefined): number | null {
  const w = Number(v);
  if (!v || !Number.isFinite(w) || w >= 0.995) return null;
  return Math.round(Math.max(MIN_IMAGE_W, w) * 1000) / 1000;
}

/** Breite der Bilder im Feld aus data-w setzen (data-w wird gespeichert, die Breite selbst nicht). */
export function applyImageSizes(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const w = imageWidth(img.dataset.w);
    if (w) img.style.width = `${w * 100}%`;
    else {
      delete img.dataset.w;
      img.style.removeProperty("width");
    }
  });
}

/** Nur erlaubte Elemente ohne Attribute (außer Bildquelle und Bildbreite) – nichts Ausführbares. */
export function sanitizeNoteHtml(html: string): string {
  const t = document.createElement("template");
  t.innerHTML = html; // im <template> wird nichts geladen oder ausgeführt
  const box = document.createElement("div");
  box.append(...Array.from(t.content.childNodes).flatMap((c) => clean(c, document)));
  return box.innerHTML;
}

/** Ist die Notiz leer (kein Text, kein Bild)? */
export function isEmptyNote(html: string): boolean {
  const t = document.createElement("template");
  t.innerHTML = html;
  const drawn = Array.from(t.content.querySelectorAll("div[data-ink]")).some((d) => (parseInkData(d.getAttribute("data-ink"))?.s.length ?? 0) > 0);
  return !drawn && !t.content.querySelector("img") && !(t.content.textContent ?? "").trim();
}

/** Erste Textzeile für Tooltips. */
export function notePreview(html: string): string {
  const t = document.createElement("template");
  t.innerHTML = html.replace(/<(?:div|p|br)[^>]*>/gi, " ");
  const text = (t.content.textContent ?? "").replace(/\s+/g, " ").trim();
  const imgs = t.content.querySelectorAll("img").length;
  const drawings = t.content.querySelectorAll("div[data-ink]").length;
  if (text) return text.slice(0, 80);
  if (imgs) return `${imgs} ${imgs === 1 ? "Bild" : "Bilder"}`;
  return drawings ? (drawings === 1 ? "Handschrift" : `${drawings} Zeichenfelder`) : "Leere Notiz";
}

/** Bild verkleinern (höchstens 1600 px breit) und als data:-URL liefern. */
export async function imageToDataUrl(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  const f = Math.min(1, MAX_IMAGE_WIDTH / bmp.width);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * f));
  c.height = Math.max(1, Math.round(bmp.height * f));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; // JPEG kennt keine Transparenz
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  // PNG (Bildschirmfotos, Ausschnitte) bleibt PNG, solange es klein genug ist – Schrift bleibt scharf
  const png = file.type === "image/png" ? c.toDataURL("image/png") : "";
  const url = png && png.length < 1_500_000 ? png : c.toDataURL("image/jpeg", 0.88);
  c.width = c.height = 0;
  return url;
}
