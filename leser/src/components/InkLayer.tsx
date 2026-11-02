import { memo, useEffect, useRef } from "react";
import { drawStroke, drawStrokes, hitStrokes, simplify, type Stroke } from "../lib/ink";
import { uid } from "../lib/db";

export interface InkToolState {
  mode: "pen" | "highlighter" | "eraser" | "lasso"; // Lasso: Auswahl übernimmt components/Lasso.tsx
  color: string;
  width: number;
}

interface Props {
  page: number;
  width: number; // Seiteneinheiten
  height: number;
  scale: number;
  strokes: Stroke[];
  tool: InkToolState | null; // null = Zeichnen aus
  onAdd: (page: number, s: Stroke) => void;
  onErase: (page: number, ids: string[]) => void;
}

// Gezeichnet, markiert und radiert wird ausschließlich mit dem Apple Pencil (pointerType "pen").
// Finger (und Maus) scrollen bzw. zoomen nur.
function InkLayerImpl({ page, width, height, scale, strokes, tool, onAdd, onErase }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const current = useRef<{ pointerId: number; stroke: Stroke } | null>(null);
  const erasing = useRef<number | null>(null);

  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  // Komplett neu zeichnen, wenn sich Striche oder Zoom ändern
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = Math.round(width * scale * dpr);
    c.height = Math.round(height * scale * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStrokes(ctx, strokes, scale);
  }, [strokes, scale, width, height, dpr]);

  // Safari/iPad: Apple Pencil darf die Seite nicht scrollen, Finger schon
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !tool) return;
    const block = (e: TouchEvent) => {
      const stylus = Array.from(e.changedTouches).some((t) => (t as Touch & { touchType?: string }).touchType === "stylus");
      if (stylus) e.preventDefault();
    };
    c.addEventListener("touchstart", block, { passive: false });
    c.addEventListener("touchmove", block, { passive: false });
    return () => {
      c.removeEventListener("touchstart", block);
      c.removeEventListener("touchmove", block);
    };
  }, [tool]);

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale] as const;
  };
  const pressure = (e: PointerEvent | React.PointerEvent) => e.pressure || 0.5;

  const accepts = (e: React.PointerEvent) => !!tool && tool.mode !== "lasso" && e.pointerType === "pen";

  const eraseAt = (e: { clientX: number; clientY: number }) => {
    const [x, y] = toPage(e);
    const ids = hitStrokes(strokes, x, y, 6 / Math.min(scale, 1.5));
    if (ids.length) onErase(page, ids);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!accepts(e) || current.current) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* manche Browser kennen den Zeiger schon nicht mehr */
    }
    if (tool!.mode === "eraser") {
      erasing.current = e.pointerId;
      eraseAt(e);
      return;
    }
    const [x, y] = toPage(e);
    current.current = {
      pointerId: e.pointerId,
      stroke: { id: uid(), tool: tool!.mode as Stroke["tool"], color: tool!.color, width: tool!.width, points: [x, y, pressure(e)] },
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (erasing.current === e.pointerId) {
      eraseAt(e);
      return;
    }
    const cur = current.current;
    if (!cur || cur.pointerId !== e.pointerId) return;
    e.preventDefault();
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const pts = cur.stroke.points;
    const before = pts.length;
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const [x, y] = toPage(ev);
      pts.push(x, y, pressure(ev));
    }
    // nur das neue Stück zeichnen (Textmarker: ganzer Strich, damit die Deckkraft gleichmäßig bleibt)
    const ctx = canvasRef.current!.getContext("2d")!;
    if (cur.stroke.tool === "pen") {
      drawStroke(ctx, { ...cur.stroke, points: pts.slice(Math.max(0, before - 3)) }, scale);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStrokes(ctx, [...strokes, cur.stroke], scale);
    }
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (erasing.current === e.pointerId) {
      erasing.current = null;
      return;
    }
    const cur = current.current;
    if (!cur || cur.pointerId !== e.pointerId) return;
    current.current = null;
    onAdd(page, { ...cur.stroke, points: simplify(cur.stroke.points) });
  };

  return (
    <canvas
      ref={canvasRef}
      className={"ink" + (tool ? " drawing" : "") + (tool?.mode === "eraser" ? " erasing" : "")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onContextMenu={(e) => tool && e.preventDefault()}
    />
  );
}

export default memo(InkLayerImpl);
