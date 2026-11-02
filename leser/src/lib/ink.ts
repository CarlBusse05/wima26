// Handschriftliche Notizen: Datenmodell, Zeichnen, Radieren und PDF-Export.
// Alle Koordinaten sind in Seiteneinheiten (pdf.js-Viewport bei Skala 1, Ursprung oben links) –
// dadurch passen sie bei jedem Zoom und lassen sich exakt in PDF-Koordinaten umrechnen.

import {
  PDFDocument,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
  type PDFOperator,
  type PDFPage,
} from "pdf-lib";
import type { PDFDocumentProxy } from "./pdf";
import type { PageText } from "./db";

export type InkTool = "pen" | "highlighter";

export interface Stroke {
  id: string;
  tool: InkTool;
  color: string; // #rrggbb
  width: number; // Seiteneinheiten (= pt)
  points: number[]; // flach: x, y, Druck, x, y, Druck, …
}

export type PageInk = Record<number, Stroke[]>;

export interface Annotations {
  scriptId: string;
  pages: PageInk;
  updatedAt: number;
  orphans?: OrphanInk[]; // Notizen, die nach einer neuen Skript-Version keiner Seite zugeordnet werden konnten
  notes?: StickyNote[]; // Notiz-Zettel mit Text und Bildern, an eine Stelle im Skript geheftet
  // Verbesserungsansicht nach einer neuen Version: geänderte Seiten, auf denen Notizen waren
  compare?: CompareItem[];
  compareFile?: string; // id der vorigen PDF-Fassung im Speicher "files" (für die alte Seite links)
}

/** Geänderte Seite mit Notizen: alte Fassung (mit ihren Notizen) gegenüber der neuen. */
export interface CompareItem {
  id: string;
  oldPage: number; // Seite in der vorigen PDF-Fassung (compareFile)
  newPage: number; // Seite im aktuellen Skript
  dy: number; // senkrechte Verschiebung des Inhalts alt → neu (für „an gleicher Stelle“)
  oldText: PageText; // Text der alten Seite (zum Behalten im Skript)
  strokes: Stroke[]; // Zeichnungen der alten Seite – noch nicht übernommen
  notes: StickyNote[]; // Notiz-Zettel der alten Seite
  done?: boolean; // geprüft
  kept?: boolean; // alte Seite wurde ins Skript übernommen
}

/** Notiz-Zettel: kleines Symbol an einer Stelle im Skript, Inhalt (Text + Bilder) im Seitenfeld rechts. */
export interface StickyNote {
  id: string;
  page: number;
  x: number; // Seiteneinheiten
  y: number;
  html: string; // bereinigtes HTML: Absätze, Zeilenumbrüche, Fett/Kursiv, Bilder als data:-URL
  color?: string; // #rrggbb – ohne: Standard (weiß/grau)
  createdAt: number;
  updatedAt: number;
}

export interface OrphanInk {
  id: string;
  fromVersion: number;
  oldPage: number;
  width: number; // Seitengröße der alten Fassung
  height: number;
  snippet: string; // Textanfang der alten Seite zum Wiedererkennen
  strokes: Stroke[];
}

export const HIGHLIGHT_ALPHA = 0.35;

/** Strichbreite in Abhängigkeit vom Druck (Apple Pencil liefert 0…1, Maus 0.5). */
export function pressureWidth(base: number, p: number) {
  return base * (0.45 + 0.85 * Math.min(1, Math.max(0, p)));
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, scale: number, ox = 0, oy = 0) {
  const pts = s.points;
  if (pts.length < 3) return;
  const X = (i: number) => (pts[i] - ox) * scale;
  const Y = (i: number) => (pts[i + 1] - oy) * scale;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  if (s.tool === "highlighter") {
    ctx.globalAlpha = HIGHLIGHT_ALPHA;
    ctx.lineWidth = s.width * scale;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    if (pts.length === 3) ctx.lineTo(X(0) + 0.01, Y(0));
    for (let i = 3; i < pts.length; i += 3) ctx.lineTo(X(i), Y(i));
    ctx.stroke();
  } else if (pts.length === 3) {
    ctx.beginPath();
    ctx.arc(X(0), Y(0), (pressureWidth(s.width, pts[2]) * scale) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let i = 3; i < pts.length; i += 3) {
      ctx.beginPath();
      ctx.lineWidth = pressureWidth(s.width, (pts[i - 1] + pts[i + 2]) / 2) * scale;
      ctx.moveTo(X(i - 3), Y(i - 3));
      ctx.lineTo(X(i), Y(i));
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], scale: number, ox = 0, oy = 0) {
  // Textmarker zuerst, damit Stiftschrift darüber liegt
  for (const s of strokes) if (s.tool === "highlighter") drawStroke(ctx, s, scale, ox, oy);
  for (const s of strokes) if (s.tool === "pen") drawStroke(ctx, s, scale, ox, oy);
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Liefert die IDs aller Striche, die der Radierer an (x, y) berührt. */
export function hitStrokes(strokes: Stroke[], x: number, y: number, radius: number): string[] {
  const hits: string[] = [];
  for (const s of strokes) {
    const r = radius + s.width / 2;
    const p = s.points;
    if (p.length === 3 && Math.hypot(p[0] - x, p[1] - y) <= r) hits.push(s.id);
    for (let i = 3; i < p.length; i += 3) {
      if (distToSegment(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= r) {
        hits.push(s.id);
        break;
      }
    }
  }
  return hits;
}

/** Entfernt fast identische Punkte (spart Speicher, Bild bleibt gleich). */
export function simplify(points: number[], minDist = 0.35): number[] {
  if (points.length <= 6) return points;
  const out = points.slice(0, 3);
  for (let i = 3; i < points.length - 3; i += 3) {
    const lx = out[out.length - 3];
    const ly = out[out.length - 2];
    if (Math.hypot(points[i] - lx, points[i + 1] - ly) >= minDist) out.push(points[i], points[i + 1], points[i + 2]);
  }
  out.push(...points.slice(-3));
  return out.map((v) => Math.round(v * 100) / 100);
}

// ---------- PDF-Export ----------

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

type ToPdf = (x: number, y: number) => [number, number];

function strokeOperators(page: PDFPage, s: Stroke, toPdf: ToPdf): PDFOperator[] {
  const pts = s.points;
  const [r, g, b] = hexToRgb(s.color);
  const ops: PDFOperator[] = [pushGraphicsState(), setStrokingRgbColor(r, g, b), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round)];
  if (s.tool === "highlighter") {
    const gs = page.doc.context.obj({ Type: "ExtGState", CA: HIGHLIGHT_ALPHA, ca: HIGHLIGHT_ALPHA, BM: "Multiply" });
    const name = page.node.newExtGState("InkGS", gs);
    ops.push(setGraphicsState(name), setLineWidth(s.width));
    const [x0, y0] = toPdf(pts[0], pts[1]);
    ops.push(moveTo(x0, y0));
    if (pts.length === 3) ops.push(lineTo(x0 + 0.01, y0));
    for (let i = 3; i < pts.length; i += 3) ops.push(lineTo(...toPdf(pts[i], pts[i + 1])));
    ops.push(stroke());
  } else if (pts.length === 3) {
    const [x0, y0] = toPdf(pts[0], pts[1]);
    ops.push(setLineWidth(pressureWidth(s.width, pts[2])), moveTo(x0, y0), lineTo(x0 + 0.01, y0), stroke());
  } else {
    // Druckabhängige Breite: aufeinanderfolgende Segmente mit gleicher (gerundeter) Breite zu einem Pfad bündeln
    const n = pts.length / 3;
    const segWidth = (k: number) => Math.round(pressureWidth(s.width, (pts[k * 3 - 1] + pts[k * 3 + 2]) / 2) * 4) / 4;
    let k = 1;
    while (k < n) {
      const w = segWidth(k);
      ops.push(setLineWidth(w), moveTo(...toPdf(pts[(k - 1) * 3], pts[(k - 1) * 3 + 1])));
      while (k < n && segWidth(k) === w) {
        ops.push(lineTo(...toPdf(pts[k * 3], pts[k * 3 + 1])));
        k++;
      }
      ops.push(stroke());
    }
  }
  ops.push(popGraphicsState());
  return ops;
}

function drawInkOnPage(page: PDFPage, strokes: Stroke[], toPdf: ToPdf) {
  const ordered = [...strokes.filter((s) => s.tool === "highlighter"), ...strokes.filter((s) => s.tool === "pen")];
  const ops = ordered.flatMap((s) => strokeOperators(page, s, toPdf));
  if (ops.length) page.pushOperators(...ops);
}

/**
 * Erzeugt ein neues PDF: Original + Notizen als Vektorgrafik an exakt derselben Stelle.
 * Bei verschlüsselten/defekten PDFs werden die Seiten als Bild übernommen.
 */
export async function exportWithInk(
  original: Blob,
  doc: PDFDocumentProxy,
  ink: PageInk,
  onProgress?: (msg: string) => void,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(await original.arrayBuffer());
  let out: PDFDocument | null = null;
  try {
    out = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    out = null; // verschlüsselt oder nicht lesbar → Raster-Fallback
  }

  if (out) {
    const pages = out.getPages();
    for (let n = 1; n <= pages.length; n++) {
      const strokes = ink[n];
      if (!strokes?.length) continue;
      onProgress?.(`Seite ${n} …`);
      const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
      const toPdf: ToPdf = (x, y) => vp.convertToPdfPoint(x, y) as [number, number];
      drawInkOnPage(pages[n - 1], strokes, toPdf);
    }
    return out.save();
  }

  // Fallback: Seiten rastern (z. B. kopiergeschützte Skripte)
  const raster = await PDFDocument.create();
  const RES = 2.5;
  for (let n = 1; n <= doc.numPages; n++) {
    onProgress?.(`Seite ${n}/${doc.numPages} wird gerastert …`);
    const p = await doc.getPage(n);
    const vp = p.getViewport({ scale: RES });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d")!;
    await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.88));
    const img = await raster.embedJpg(await blob.arrayBuffer());
    const w = vp.width / RES;
    const h = vp.height / RES;
    const page = raster.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
    const strokes = ink[n];
    if (strokes?.length) drawInkOnPage(page, strokes, (x, y) => [x, h - y]);
  }
  return raster.save();
}

export function inkCount(ink: PageInk) {
  return Object.values(ink).reduce((n, s) => n + s.length, 0);
}

