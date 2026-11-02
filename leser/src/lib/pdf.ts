// Reihenfolge wichtig: Polyfills vor pdf.js. Legacy-Build, weil der normale Build nur aktuelle
// Chrome/Firefox-Versionen unterstützt und in Safari/iPadOS beim Import abbricht.
import "./polyfills";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "./pdf.worker.ts?worker&url";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PageText, TextItem } from "./db";
import { drawStrokes, type Stroke } from "./ink";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type { PDFDocumentProxy };

const tasks = new WeakMap<PDFDocumentProxy, { destroy(): Promise<void> }>();

export async function loadPdf(blob: Blob): Promise<PDFDocumentProxy> {
  const data = new Uint8Array(await blob.arrayBuffer());
  // fontExtraProperties: Schriftnamen (z. B. "CMBX10") verfügbar machen → Fettdruck erkennen
  const task = pdfjs.getDocument({ data, fontExtraProperties: true });
  const doc = await task.promise;
  tasks.set(doc, task);
  return doc;
}

export async function closePdf(doc: PDFDocumentProxy | null) {
  if (doc) await tasks.get(doc)?.destroy();
}

// Fett: "Helvetica-Bold", "DejaVuSerif-Bold", LaTeX "CMBX10"/"CMB10", "LMRoman10-Bold", "…-Semibold", "…-Black"
const BOLD_FONT = /bold|black|heavy|semibold|demi|cmbx|cmb\d|cmssbx|bx\d|-bd\b|\bbd\b/i;
// Kursiv: Textkursiv ("CMTI10", "…-Italic"), aber nicht Mathe-Kursiv ("CMMI10"), das sind nur Variablen
const ITALIC_FONT = /italic|oblique|cmti|cmsl|cmssi|-it\b|\bit\d/i;
const MATH_FONT = /cmmi|cmsy|cmex|msam|msbm|math|symbol/i;

interface FontInfo {
  bold: boolean;
  italic: boolean;
}

/** Schriftstil aus den geladenen Schriftobjekten von pdf.js (erst nach getOperatorList verfügbar). */
function fontInfo(page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>>, loadedName: string): FontInfo {
  try {
    if (!page.commonObjs.has(loadedName)) return { bold: false, italic: false };
    const f = page.commonObjs.get(loadedName) as { name?: string; bold?: boolean; black?: boolean; italic?: boolean };
    const name = f.name ?? "";
    const math = MATH_FONT.test(name);
    return {
      bold: !math && (!!f.bold || !!f.black || BOLD_FONT.test(name)),
      italic: !math && (!!f.italic || ITALIC_FONT.test(name)),
    };
  } catch {
    return { bold: false, italic: false };
  }
}

/** Text einer Seite in der Reihenfolge, in der auch pdf.js' TextLayer die Spans erzeugt. */
export async function extractPage(doc: PDFDocumentProxy, pageNo: number): Promise<PageText> {
  const page = await doc.getPage(pageNo);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  // Lädt die Schriften der Seite – nur so ist erkennbar, welcher Text fett oder kursiv ist
  await page.getOperatorList().catch(() => null);
  const fonts = new Map<string, FontInfo>();
  const items: TextItem[] = [];
  for (const it of content.items) {
    if (!("str" in it)) continue;
    // Gerätekoordinaten (Ursprung oben links)
    const tx = pdfjs.Util.transform(viewport.transform, it.transform);
    const fontH = Math.hypot(tx[2], tx[3]);
    if (!fonts.has(it.fontName)) fonts.set(it.fontName, fontInfo(page, it.fontName));
    const f = fonts.get(it.fontName)!;
    const item: TextItem = { s: it.str, x: tx[4], y: tx[5] - fontH, w: it.width, h: fontH, eol: it.hasEOL };
    if (f.bold) item.b = 1;
    if (f.italic) item.i = 1;
    items.push(item);
  }
  page.cleanup();
  return { page: pageNo, width: viewport.width, height: viewport.height, items };
}

export async function extractAll(
  doc: PDFDocumentProxy,
  onProgress?: (done: number, total: number) => void,
): Promise<PageText[]> {
  const pages: PageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    pages.push(await extractPage(doc, p));
    onProgress?.(p, doc.numPages);
  }
  return pages;
}

/** Fließtext einer Seite + Startoffset jedes Items (für Abbildung Treffer → Span). */
export function pageString(page: PageText): { text: string; starts: number[] } {
  let text = "";
  const starts: number[] = [];
  for (const it of page.items) {
    starts.push(text.length);
    text += it.s;
    if (it.eol) text += "\n";
  }
  return { text, starts };
}

/** Index des Items, das den Offset enthält (binäre Suche). */
export function itemAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Lage eines Textstücks (Zeichen start…end von pageString) auf der Seite – PDF-Einheiten, Skala 1. */
export function textBox(page: PageText, start: number, end: number): { x: number; y: number; w: number; h: number } | null {
  if (!page.items.length) return null;
  const { starts } = pageString(page);
  const i = itemAt(starts, start);
  const it = page.items[i];
  const len = Math.max(1, it.s.length);
  const a = Math.max(0, Math.min(len, start - starts[i]));
  const b = Math.max(a, Math.min(len, end - starts[i]));
  return { x: it.x + (it.w * a) / len, y: it.y, w: Math.max(4, (it.w * (b - a)) / len), h: it.h };
}

/** Text innerhalb eines Rechtecks (PDF-Einheiten, Skala 1). */
export function textInRect(page: PageText, r: { x: number; y: number; w: number; h: number }): string {
  let out = "";
  for (const it of page.items) {
    const cy = it.y + it.h / 2;
    const overlapsX = it.x + it.w > r.x && it.x < r.x + r.w;
    if (overlapsX && cy >= r.y && cy <= r.y + r.h) {
      out += it.s;
      if (it.eol) out += "\n";
    }
  }
  return out.trim();
}

/** Bildausschnitt einer Definition: Textbreite der Zeilen zwischen y und yEnd (höchstens maxH hoch). */
export function definitionRegion(page: PageText, y: number, yEnd: number, maxH = 340) {
  const h = Math.min(Math.max(yEnd - y + 6, 40), maxH);
  const inBand = page.items.filter((i) => i.y >= y - 2 && i.y <= y + h && i.s.trim());
  const x0 = Math.max(0, Math.min(...inBand.map((i) => i.x), page.width * 0.1) - 10);
  const x1 = Math.min(page.width, Math.max(...inBand.map((i) => i.x + i.w), page.width * 0.9) + 10);
  return { x: x0, y, w: x1 - x0, h };
}

/** Rendert einen Ausschnitt einer Seite (PDF-Einheiten) auf ein Canvas, optional mit Notizen. */
export async function renderRegionCanvas(
  doc: PDFDocumentProxy,
  pageNo: number,
  r: { x: number; y: number; w: number; h: number },
  scale = 2.5,
  strokes?: Stroke[],
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNo);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(r.w * scale));
  canvas.height = Math.max(1, Math.round(r.h * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, -r.x * scale, -r.y * scale],
  }).promise;
  if (strokes?.length) drawStrokes(ctx, strokes, scale, r.x, r.y);
  return canvas;
}

/** Rendert einen Ausschnitt einer Seite als PNG (base64 ohne Präfix). */
export async function renderRegion(
  doc: PDFDocumentProxy,
  pageNo: number,
  r: { x: number; y: number; w: number; h: number },
  scale = 2.5,
  strokes?: Stroke[],
): Promise<{ data: string; url: string }> {
  const url = (await renderRegionCanvas(doc, pageNo, r, scale, strokes)).toDataURL("image/png");
  return { data: url.split(",")[1], url };
}
