// Zeichenfelder in Notizen: ein Block im Textfluss (wie ein Bild), in den mit dem Apple Pencil geschrieben wird –
// z. B. Formeln. Gespeichert wird die Handschrift als Striche (nicht als Bild): im Notiz-HTML als
// <div data-ink="{…}"></div>. Koordinaten in Einheiten einer festen Breite (INK_W), damit die Schrift bei jeder
// Breite des Notizfelds an derselben Stelle bleibt; das Feld wächst beim Schreiben nach unten.

import { drawStrokes, hitStrokes, simplify, type Stroke } from "./ink";
import type { InkToolState } from "../components/InkLayer";
import { uid } from "./db";

export const INK_W = 400; // Breite eines Zeichenfelds in Einheiten (≈ CSS-Pixel bei üblicher Feldbreite)
const START_H = 160; // leeres Feld ohne bekannte Feldhöhe (z. B. beim Verkleinern eines leeren Felds)
const GROW_MARGIN = 40;
const END_MARGIN = 50; // so weit reicht ein Feld unter den tiefsten Strich – Platz für die nächste Zeile
const MIN_H = 60;

export interface InkBlockData {
  v: 1;
  h: number; // Höhe in Einheiten
  s: Stroke[];
}

/** Daten eines Zeichenfelds prüfen (stammen aus gespeichertem HTML). */
export function parseInkData(raw: string | null | undefined): InkBlockData | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<InkBlockData>;
    if (!d || typeof d.h !== "number" || !Array.isArray(d.s)) return null;
    const s = d.s.filter(
      (x): x is Stroke =>
        !!x &&
        typeof x.id === "string" &&
        (x.tool === "pen" || x.tool === "highlighter") &&
        typeof x.color === "string" &&
        /^#[0-9a-f]{6}$/i.test(x.color) &&
        typeof x.width === "number" &&
        Array.isArray(x.points) &&
        x.points.every((n) => typeof n === "number" && Number.isFinite(n)),
    );
    return { v: 1, h: Math.min(20000, Math.max(80, d.h)), s };
  } catch {
    return null;
  }
}

/** Benötigte Höhe: kurz unter dem tiefsten Strich (leeres Feld: Startgröße zum Losschreiben). */
function lowestY(d: InkBlockData): number {
  let maxY = 0;
  for (const st of d.s) for (let i = 1; i < st.points.length; i += 3) maxY = Math.max(maxY, st.points[i] + st.width);
  return maxY;
}
function usedHeight(d: InkBlockData): number {
  if (!d.s.length) return START_H;
  return Math.max(MIN_H, Math.ceil(lowestY(d) + END_MARGIN));
}

export const serializeInk = (d: InkBlockData) =>
  JSON.stringify({ v: 1, h: Math.min(Math.round(d.h), usedHeight(d)), s: d.s.map((x) => ({ ...x, points: x.points.map((n) => Math.round(n * 100) / 100) })) });

/** Neues, leeres Zeichenfeld; h = Starthöhe in Einheiten (die Hälfte des sichtbaren Notizfelds). */
export function createInkBlockElement(h = START_H): HTMLDivElement {
  const div = document.createElement("div");
  div.dataset.ink = JSON.stringify({ v: 1, h: Math.round(h), s: [] }); // ungekürzt: das leere Feld soll diese Größe haben
  return div;
}

export type InkOp = { el: HTMLElement; type: "add" | "erase"; strokes: Stroke[] };

export interface InkBlockHost {
  onPenStart: (el: HTMLElement) => void; // Feld wird zum Zeichnen geöffnet (Pencil setzt auf / Feld angetippt)
  tool: () => InkToolState; // aktuelles Werkzeug (Stift/Marker/Radierer, Farbe, Stärke)
  onChange: () => void; // Inhalt geändert → speichern
  onRemove?: () => void; // Feld wurde über sein Papierkorb-Symbol gelöscht
  onOp?: (op: InkOp) => void; // für Rückgängig/Wiederholen
}

interface Controller {
  data: InkBlockData;
  draw: () => void;
  commit: () => void;
  collapse: () => void; // auf die benötigte Höhe verkleinern
}
const controllers = new WeakMap<HTMLElement, Controller>();

const DELETE_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';

/** Macht aus einem <div data-ink> ein bedienbares Zeichenfeld. Liefert eine Aufräum-Funktion. */
export function mountInkBlock(div: HTMLElement, host: InkBlockHost): () => void {
  if (controllers.has(div)) return () => undefined;
  const data = parseInkData(div.dataset.ink) ?? { v: 1, h: START_H, s: [] };
  div.className = "ink-block";
  div.contentEditable = "false";
  const canvas = document.createElement("canvas");
  const del = document.createElement("button");
  del.type = "button";
  del.className = "ink-block-del";
  del.title = "Zeichenfeld löschen";
  del.setAttribute("aria-label", "Zeichenfeld löschen");
  del.innerHTML = DELETE_SVG;
  div.replaceChildren(canvas, del);

  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  let current: { pointerId: number; stroke: Stroke } | null = null;
  let erasing: number | null = null;

  const scale = () => (div.clientWidth || INK_W) / INK_W;
  const draw = () => {
    const sc = scale();
    const w = Math.max(1, div.clientWidth);
    const h = data.h * sc;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStrokes(ctx, current ? [...data.s, current.stroke] : data.s, sc);
  };
  const commit = () => {
    div.dataset.ink = serializeInk(data);
    host.onChange();
  };
  // Beim Beenden des Zeichnens (Stift-Symbol im Notizfeld) endet das Feld kurz unter dem tiefsten Strich,
  // damit Text und Bilder direkt danach folgen (siehe collapseInkBlocks).
  const collapse = () => {
    const h = usedHeight(data);
    if (h < data.h) {
      data.h = h;
      draw();
    }
  };
  controllers.set(div, { data, draw, commit, collapse });

  const toUnits = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    const sc = scale();
    return [(e.clientX - r.left) / sc, (e.clientY - r.top) / sc] as const;
  };
  // Höchstens die Hälfte des sichtbaren Notizfelds ist leerer Platz unter dem tiefsten Strich: Schreibt man nahe am
  // unteren Rand, wächst das Feld so weit, dass wieder eine halbe Feldhöhe frei ist. Scrollen lässt es unverändert –
  // darunter geht die (leere) Notiz einfach weiter.
  const halfView = () => {
    const ed = div.closest(".note-editor") as HTMLElement | null;
    return ed ? ed.clientHeight / 2 / scale() : START_H;
  };
  // Feld zum Weiterzeichnen öffnen: wieder eine halbe Feldhöhe Platz unter dem tiefsten Strich, Werkzeuge einblenden
  const activate = () => {
    const h = Math.ceil(lowestY(data) + halfView());
    if (h > data.h) {
      data.h = h;
      draw();
    }
    host.onPenStart(div);
  };
  const grow = (y: number) => {
    if (y > data.h - GROW_MARGIN) data.h = Math.ceil(y + halfView());
  };
  const eraseAt = (e: PointerEvent) => {
    const [x, y] = toUnits(e);
    const ids = new Set(hitStrokes(data.s, x, y, 6));
    if (!ids.size) return;
    const removed = data.s.filter((s) => ids.has(s.id));
    data.s = data.s.filter((s) => !ids.has(s.id));
    draw();
    host.onOp?.({ el: div, type: "erase", strokes: removed });
    commit();
  };

  // Gezeichnet wird nur mit dem Apple Pencil – Finger scrollen das Notizfeld
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== "pen" || current) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* Zeiger schon weg */
    }
    activate();
    const tool = host.tool();
    if (tool.mode === "eraser") {
      erasing = e.pointerId;
      eraseAt(e);
      return;
    }
    const [x, y] = toUnits(e);
    current = { pointerId: e.pointerId, stroke: { id: uid(), tool: tool.mode as Stroke["tool"], color: tool.color, width: tool.width, points: [x, y, e.pressure || 0.5] } };
  };
  const onMove = (e: PointerEvent) => {
    if (erasing === e.pointerId) {
      eraseAt(e);
      return;
    }
    if (!current || current.pointerId !== e.pointerId) return;
    e.preventDefault();
    const coalesced = e.getCoalescedEvents?.() ?? [];
    for (const ev of coalesced.length ? coalesced : [e]) {
      const [x, y] = toUnits(ev);
      current.stroke.points.push(x, y, ev.pressure || 0.5);
      grow(y);
    }
    draw();
  };
  const onUp = (e: PointerEvent) => {
    if (erasing === e.pointerId) {
      erasing = null;
      return;
    }
    if (!current || current.pointerId !== e.pointerId) return;
    const stroke = { ...current.stroke, points: simplify(current.stroke.points) };
    current = null;
    data.s.push(stroke);
    draw();
    host.onOp?.({ el: div, type: "add", strokes: [stroke] });
    commit();
  };
  // Safari/iPad: der Pencil soll das Notizfeld nicht scrollen
  const blockStylus = (e: TouchEvent) => {
    if (Array.from(e.changedTouches).some((t) => (t as Touch & { touchType?: string }).touchType === "stylus")) e.preventDefault();
  };
  const onDelete = (e: MouseEvent) => {
    e.preventDefault();
    if (data.s.length && !confirm("Dieses Zeichenfeld löschen?")) return;
    cleanup();
    div.remove();
    host.onRemove?.();
    host.onChange();
  };

  // Tipp auf ein Zeichenfeld (auch mit dem Finger) soll keine Schreibmarke im Text setzen → keine Tastatur
  const noCaret = (e: Event) => e.preventDefault();
  canvas.addEventListener("mousedown", noCaret);
  // Antippen eines vorhandenen Felds (Finger, Maus, Pencil) öffnet es zum Weiterzeichnen – ohne neues Feld
  canvas.addEventListener("click", activate);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("touchstart", blockStylus, { passive: false });
  canvas.addEventListener("touchmove", blockStylus, { passive: false });
  del.addEventListener("click", onDelete);
  del.addEventListener("mousedown", noCaret); // Löschen setzt keine Schreibmarke → keine Tastatur
  const ro = new ResizeObserver(draw);
  ro.observe(div);
  draw();

  function cleanup() {
    ro.disconnect();
    canvas.removeEventListener("mousedown", noCaret);
    canvas.removeEventListener("click", activate);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
    canvas.removeEventListener("touchstart", blockStylus);
    canvas.removeEventListener("touchmove", blockStylus);
    del.removeEventListener("click", onDelete);
    del.removeEventListener("mousedown", noCaret);
  }
  return cleanup;
}

/** Rückgängig (reverse) bzw. Wiederholen eines Zeichenschritts. */
export function applyInkOp(op: InkOp, reverse: boolean): boolean {
  const c = controllers.get(op.el);
  if (!c || !op.el.isConnected) return false; // Feld inzwischen gelöscht
  const adding = (op.type === "add") !== reverse;
  const ids = new Set(op.strokes.map((s) => s.id));
  c.data.s = adding ? [...c.data.s.filter((s) => !ids.has(s.id)), ...op.strokes] : c.data.s.filter((s) => !ids.has(s.id));
  c.draw();
  c.commit();
  return true;
}

/** Alle Zeichenfelder auf ihre benötigte Höhe verkleinern – beim Beenden des Zeichnens. */
export function collapseInkBlocks(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".ink-block").forEach((el) => controllers.get(el)?.collapse());
}
