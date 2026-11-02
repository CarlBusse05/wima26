import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { uid } from "../lib/db";
import { drawStrokes, type StickyNote, type Stroke } from "../lib/ink";

/** Eine Seite, auf der das Lasso auswählen kann. */
export interface LassoTarget {
  id: string;
  page: number;
  el: HTMLElement; // Seiten-Element (für die Lage auf dem Bildschirm)
  width: number; // Seitenbreite in Seiteneinheiten
  strokes: Stroke[];
  notes?: StickyNote[]; // Notiz-Zettel werden nur von schreibgeschützten Seiten mitkopiert
  readOnly?: boolean; // alte Seite der Verbesserungsansicht: Auswahl wird kopiert, nicht verschoben
}

interface Props {
  container: HTMLElement | null; // Bereich, in dem das Lasso arbeitet
  getTargets: () => LassoTarget[];
  scrollEl: () => HTMLElement | null;
  /** Auswahl wurde verschoben/skaliert (bzw. von einer schreibgeschützten Seite kopiert) – after/notes in Seiteneinheiten von „to“. */
  onMove: (from: LassoTarget, to: LassoTarget, before: Stroke[], after: Stroke[], notes: StickyNote[]) => void;
  onDelete: (from: LassoTarget, ids: string[]) => void;
  onHide: (h: { page: number; ids: Set<string> } | null) => void; // Striche während des Ziehens ausblenden
}

type Pt = { x: number; y: number };
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface Selection {
  targetId: string;
  ids: string[];
  noteIds: string[];
}
interface Drag {
  kind: "move" | "resize";
  pointerId: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  f: number; // Vergrößerung (resize)
  box: Box; // Lage der Auswahl beim Anfassen
  rect: DOMRect; // Lage der Seite beim Anfassen
  scale: number;
}

const PAD = 8; // Abstand des Auswahlrahmens um die Striche (px)
const EDGE = 48; // Rand, an dem beim Ziehen gescrollt wird (px)
const TAP = 6; // weniger Bewegung gilt als Tippen (px)
const MIN_F = 0.2;
const MAX_F = 5;

function inPolygon(poly: Pt[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Lage der ausgewählten Striche/Notizen auf dem Bildschirm (mit Rand). */
function selectionBox(t: LassoTarget, strokes: Stroke[], notes: StickyNote[]): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of strokes) {
    for (let i = 0; i < s.points.length; i += 3) {
      x0 = Math.min(x0, s.points[i] - s.width / 2);
      x1 = Math.max(x1, s.points[i] + s.width / 2);
      y0 = Math.min(y0, s.points[i + 1] - s.width / 2);
      y1 = Math.max(y1, s.points[i + 1] + s.width / 2);
    }
  }
  for (const n of notes) {
    x0 = Math.min(x0, n.x - 10);
    x1 = Math.max(x1, n.x + 10);
    y0 = Math.min(y0, n.y - 10);
    y1 = Math.max(y1, n.y + 10);
  }
  if (x0 === Infinity) return null;
  const r = t.el.getBoundingClientRect();
  const s = r.width / t.width;
  return { left: r.left + x0 * s - PAD, top: r.top + y0 * s - PAD, width: (x1 - x0) * s + 2 * PAD, height: (y1 - y0) * s + 2 * PAD };
}

/**
 * Lasso (Werkzeug der Stift-Leiste): Zeichnungen mit dem Pencil (oder der Maus) umkreisen – der Finger scrollt weiter.
 * Die Auswahl lässt sich mit Finger oder Pencil verschieben (auch auf eine andere Seite), über den Griff unten rechts
 * bzw. − / + vergrößern und verkleinern oder löschen. Auf einer schreibgeschützten Seite (alte Fassung in der
 * Verbesserungsansicht) wird die Auswahl kopiert: auf die neue Seite ziehen oder dort antippen.
 */
export default function Lasso({ container, getTargets, scrollEl, onMove, onDelete, onHide }: Props) {
  const [path, setPath] = useState<Pt[] | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [, setTick] = useState(0);

  // Rahmen folgt der Seite beim Scrollen und bei Größenänderungen
  useEffect(() => {
    const tick = () => setTick((t) => t + 1);
    window.addEventListener("scroll", tick, true);
    window.addEventListener("resize", tick);
    return () => {
      window.removeEventListener("scroll", tick, true);
      window.removeEventListener("resize", tick);
    };
  }, []);

  const targets = getTargets();
  const target = sel ? targets.find((t) => t.id === sel.targetId) : undefined;
  const selStrokes = target && sel ? target.strokes.filter((s) => sel.ids.includes(s.id)) : [];
  const selNotes = target && sel ? (target.notes ?? []).filter((n) => sel.noteIds.includes(n.id)) : [];
  const box = target ? selectionBox(target, selStrokes, selNotes) : null;
  const area = container?.getBoundingClientRect();

  // Vorschau der gezogenen Auswahl – einmal beim Anfassen gezeichnet, danach nur verschoben bzw. skaliert
  const drawGhost = (c: HTMLCanvasElement | null) => {
    if (!c || !drag || c.dataset.drawn) return;
    c.dataset.drawn = "1";
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    c.width = Math.round(drag.box.width * dpr);
    c.height = Math.round(drag.box.height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ox = (drag.box.left - drag.rect.left) / drag.scale;
    const oy = (drag.box.top - drag.rect.top) / drag.scale;
    drawStrokes(ctx, selStrokes, drag.scale, ox, oy);
    for (const n of selNotes) {
      ctx.fillStyle = n.color ?? "#ffd84d";
      ctx.fillRect((n.x - ox) * drag.scale - 9, (n.y - oy) * drag.scale - 9, 18, 18);
    }
  };

  /**
   * Auswahl umrechnen und ablegen: Bildschirmlage (rect/scale) → um anchor mit f skaliert → um shift verschoben →
   * in Seiteneinheiten von „to“.
   */
  const place = (to: LassoTarget, from: LassoTarget, rect: DOMRect, scale: number, shift: Pt, f = 1, anchor?: Pt) => {
    const tr = to.el.getBoundingClientRect();
    const ts = tr.width / to.width;
    const ax = anchor?.x ?? 0;
    const ay = anchor?.y ?? 0;
    const conv = (x: number, y: number): Pt => {
      const cx = ax + (rect.left + x * scale - ax) * f + shift.x;
      const cy = ay + (rect.top + y * scale - ay) * f + shift.y;
      return { x: (cx - tr.left) / ts, y: (cy - tr.top) / ts };
    };
    const copy = !!from.readOnly;
    const after = selStrokes.map((st) => {
      const pts = st.points.slice();
      for (let i = 0; i < pts.length; i += 3) {
        const p = conv(pts[i], pts[i + 1]);
        pts[i] = Math.round(p.x * 100) / 100;
        pts[i + 1] = Math.round(p.y * 100) / 100;
      }
      return { ...st, id: copy ? uid() : st.id, width: Math.round(st.width * f * (scale / ts) * 100) / 100, points: pts };
    });
    const notes = selNotes.map((n) => ({ ...n, id: uid(), page: to.page, ...conv(n.x, n.y) }));
    onMove(from, to, selStrokes, after, notes);
    setSel({ targetId: to.id, ids: after.map((s) => s.id), noteIds: [] });
  };

  /** Auswahl um f vergrößern/verkleinern (Bezugspunkt: linke obere Ecke der Striche). */
  const resizeBy = (f: number) => {
    if (!target || !box || target.readOnly) return;
    const rect = target.el.getBoundingClientRect();
    place(target, target, rect, rect.width / target.width, { x: 0, y: 0 }, f, { x: box.left + PAD, y: box.top + PAD });
  };

  const targetAt = (x: number, y: number, maxDist = 0) => {
    let best: LassoTarget | null = null;
    let bestD = Infinity;
    for (const t of targets) {
      const r = t.el.getBoundingClientRect();
      const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      if (d <= maxDist && d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  };

  const select = (poly: Pt[]) => {
    let best: Selection | null = null;
    let bestCount = 0;
    for (const t of targets) {
      const r = t.el.getBoundingClientRect();
      const s = r.width / t.width;
      const ids = t.strokes
        .filter((st) => {
          let inside = 0;
          for (let i = 0; i < st.points.length; i += 3) if (inPolygon(poly, r.left + st.points[i] * s, r.top + st.points[i + 1] * s)) inside++;
          return inside > 0 && inside >= (st.points.length / 3) * 0.5;
        })
        .map((st) => st.id);
      const noteIds = (t.notes ?? []).filter((n) => inPolygon(poly, r.left + n.x * s, r.top + n.y * s)).map((n) => n.id);
      if (ids.length + noteIds.length > bestCount) {
        bestCount = ids.length + noteIds.length;
        best = { targetId: t.id, ids, noteIds };
      }
    }
    setSel(best);
  };

  // ---------- Lasso ziehen: Pencil und Maus; der Finger scrollt ----------
  const live = useRef({ box, target, select, place, targetAt });
  useEffect(() => {
    live.current = { box, target, select, place, targetAt };
  });
  useEffect(() => {
    const el = container;
    if (!el) return;
    let gesture: { pointerId: number; x: number; y: number; moved: boolean; pts: Pt[] } | null = null;
    let swallowClick = false;
    // Safari: der Pencil soll hier nicht scrollen
    const blockStylus = (e: TouchEvent) => {
      if (Array.from(e.changedTouches).some((t) => (t as Touch & { touchType?: string }).touchType === "stylus")) e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      const g = gesture;
      if (!g || e.pointerId !== g.pointerId) return;
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > TAP) g.moved = true;
      const last = g.pts[g.pts.length - 1];
      if (g.moved && Math.hypot(e.clientX - last.x, e.clientY - last.y) > 2) {
        g.pts.push({ x: e.clientX, y: e.clientY });
        setPath([...g.pts]);
      }
    };
    const up = (e: PointerEvent) => {
      const g = gesture;
      if (!g || e.pointerId !== g.pointerId) return;
      gesture = null;
      swallowClick = true;
      window.setTimeout(() => (swallowClick = false), 400);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setPath(null);
      const L = live.current;
      if (g.moved && g.pts.length > 2) {
        L.select(g.pts);
        return;
      }
      // Tippen: kopierte Auswahl der alten Seite hier einfügen – sonst Auswahl aufheben
      const to = L.targetAt(e.clientX, e.clientY);
      if (L.box && L.target?.readOnly && to && !to.readOnly) {
        const rect = L.target.el.getBoundingClientRect();
        L.place(to, L.target, rect, rect.width / L.target.width, { x: e.clientX - (L.box.left + PAD), y: e.clientY - (L.box.top + PAD) });
        return;
      }
      setSel(null);
    };
    const down = (e: PointerEvent) => {
      if (gesture || e.pointerType === "touch" || e.button > 0) return;
      const t = e.target as HTMLElement;
      if (t.closest(".lasso-ui, .note-marker, button, input, textarea, [contenteditable]") || !t.closest(".page")) return;
      e.preventDefault();
      e.stopPropagation();
      gesture = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false, pts: [{ x: e.clientX, y: e.clientY }] };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    };
    // der Klick nach einem Lasso-Zug soll keine Verknüpfung öffnen und keine Notiz schließen
    const click = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("click", click, true);
    el.addEventListener("touchstart", blockStylus, { passive: false, capture: true });
    el.addEventListener("touchmove", blockStylus, { passive: false, capture: true });
    return () => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("click", click, true);
      el.removeEventListener("touchstart", blockStylus, true);
      el.removeEventListener("touchmove", blockStylus, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [container]);

  // ---------- Auswahl verschieben / skalieren (Finger, Pencil, Maus) ----------
  const startDrag = (kind: Drag["kind"]) => (e: React.PointerEvent<HTMLElement>) => {
    if (drag || !box || !target || !sel || (kind === "resize" && target.readOnly)) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    const rect = target.el.getBoundingClientRect();
    setDrag({ kind, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, f: 1, box, rect, scale: rect.width / target.width });
    if (!target.readOnly) onHide({ page: target.page, ids: new Set(sel.ids) });
  };
  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (drag.kind === "resize") {
      const w = Math.max(drag.box.width - 2 * PAD, 1);
      const h = Math.max(drag.box.height - 2 * PAD, 1);
      const f = Math.min(MAX_F, Math.max(MIN_F, Math.max((w + dx) / w, (h + dy) / h)));
      setDrag({ ...drag, dx, dy, f });
      return;
    }
    setDrag({ ...drag, dx, dy });
    // am Rand weiterscrollen, um die Auswahl auf eine andere Seite zu bringen
    const s = scrollEl();
    if (s && area) {
      if (e.clientY < area.top + EDGE) s.scrollBy(0, -14);
      else if (e.clientY > area.bottom - EDGE) s.scrollBy(0, 14);
    }
  };
  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag || e.pointerId !== drag.pointerId || !target) return;
    setDrag(null);
    onHide(null);
    if (Math.hypot(drag.dx, drag.dy) <= TAP) return;
    if (drag.kind === "resize") {
      place(target, target, drag.rect, drag.scale, { x: 0, y: 0 }, drag.f, { x: drag.box.left + PAD, y: drag.box.top + PAD });
      return;
    }
    const shift = { x: drag.dx, y: drag.dy };
    const to = targetAt(drag.box.left + drag.box.width / 2 + shift.x, drag.box.top + drag.box.height / 2 + shift.y, 80);
    if (!to || to.readOnly) return; // zurück an die alte Stelle
    place(to, target, drag.rect, drag.scale, shift);
  };

  const remove = () => {
    if (!target || !sel || target.readOnly) return;
    onDelete(target, sel.ids);
    setSel(null);
  };

  // Tastatur: Entf löscht die Auswahl, Esc hebt sie auf
  const keys = useRef({ remove });
  useEffect(() => {
    keys.current = { remove };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape") setSel(null);
      else if (e.key === "Delete" || e.key === "Backspace") keys.current.remove();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!area) return null;
  const rel = (x: number, y: number) => `${x - area.left},${y - area.top}`;
  const ghostBox = !drag
    ? null
    : drag.kind === "resize"
      ? { left: drag.box.left - PAD * (drag.f - 1), top: drag.box.top - PAD * (drag.f - 1), width: drag.box.width * drag.f, height: drag.box.height * drag.f }
      : { ...drag.box, left: drag.box.left + drag.dx, top: drag.box.top + drag.dy };

  return (
    <div className="lasso-layer" style={{ left: area.left, top: area.top, width: area.width, height: area.height }}>
      {path && path.length > 1 && (
        <svg className="lasso-path" width={area.width} height={area.height}>
          <polygon points={path.map((p) => rel(p.x, p.y)).join(" ")} />
        </svg>
      )}
      {box && target && (
        // bleibt beim Ziehen (unsichtbar) stehen: er hält den Zeiger fest
        <div
          className={"lasso-ui lasso-box" + (target.readOnly ? " copy" : "") + (drag ? " dragging" : "")}
          style={{ left: box.left - area.left, top: box.top - area.top, width: box.width, height: box.height }}
          onPointerDown={startDrag("move")}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          title={target.readOnly ? "Auf die neue Seite ziehen oder dort antippen" : "Zum Verschieben ziehen"}
        >
          {!target.readOnly && <span className="lasso-ui lasso-handle" onPointerDown={startDrag("resize")} title="Ziehen zum Vergrößern/Verkleinern" />}
        </div>
      )}
      {ghostBox && (
        <canvas
          ref={drawGhost}
          className="lasso-ghost"
          style={{ left: ghostBox.left - area.left, top: ghostBox.top - area.top, width: ghostBox.width, height: ghostBox.height }}
        />
      )}
      {box && !drag && target && !target.readOnly && (
        <div className="lasso-ui lasso-actions" style={{ left: box.left - area.left + box.width / 2, top: Math.max(4, box.top - area.top - 46) }}>
          <button onClick={() => resizeBy(1 / 1.15)} title="Verkleinern" aria-label="Auswahl verkleinern">
            <Icon name="minus" size={16} />
          </button>
          <button onClick={() => resizeBy(1.15)} title="Vergrößern" aria-label="Auswahl vergrößern">
            <Icon name="plus" size={16} />
          </button>
          <button onClick={remove} title="Auswahl löschen (Entf)" aria-label="Auswahl löschen">
            <Icon name="trash" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
