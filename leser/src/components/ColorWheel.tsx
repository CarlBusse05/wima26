import { useEffect, useRef, useState } from "react";
import { hexToHsv, hsvToHex, hsvToRgb } from "../lib/colors";

interface Props {
  initial: string;
  onAdd: (hex: string) => void;
  onCancel: () => void;
}

const SIZE = 220; // CSS-Pixel

/**
 * Farbkreis: Farbton rundherum, Sättigung zur Mitte hin, darunter ein Helligkeitsregler.
 * Mit Finger und Apple Pencil bedienbar (Pointer Events, touch-action: none).
 */
export default function ColorWheel({ initial, onAdd, onCancel }: Props) {
  const start = hexToHsv(initial);
  const [h, setH] = useState(start.h);
  const [s, setS] = useState(start.s);
  const [v, setV] = useState(Math.max(0.15, start.v));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<number | null>(null);
  const hex = hsvToHex(h, s, v);

  // Rad zeichnen (bei jeder Helligkeit neu, damit die Vorschau im Rad stimmt)
  useEffect(() => {
    const c = canvasRef.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(SIZE * dpr);
    c.width = px;
    c.height = px;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(px, px);
    const r0 = px / 2;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const dx = x - r0 + 0.5;
        const dy = y - r0 + 0.5;
        const dist = Math.hypot(dx, dy) / r0;
        const i = (y * px + x) * 4;
        if (dist > 1) {
          img.data[i + 3] = 0;
          continue;
        }
        const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 180;
        const [rr, gg, bb] = hsvToRgb(hue, dist, v);
        img.data[i] = rr;
        img.data[i + 1] = gg;
        img.data[i + 2] = bb;
        // weicher Rand
        img.data[i + 3] = dist > 0.985 ? Math.round(((1 - dist) / 0.015) * 255) : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [v]);

  const pick = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    setH((Math.atan2(dy, dx) * 180) / Math.PI + 180);
    setS(Math.min(1, Math.hypot(dx, dy) / (r.width / 2)));
  };

  // Position der Markierung im Rad
  const angle = ((h - 180) * Math.PI) / 180;
  const mx = SIZE / 2 + Math.cos(angle) * s * (SIZE / 2);
  const my = SIZE / 2 + Math.sin(angle) * s * (SIZE / 2);

  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal color-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>Eigene Farbe</h3>
        <div className="wheel" style={{ width: SIZE, height: SIZE }}>
          <canvas
            ref={canvasRef}
            style={{ width: SIZE, height: SIZE }}
            onPointerDown={(e) => {
              e.preventDefault();
              dragging.current = e.pointerId;
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* ignorieren */
              }
              pick(e);
            }}
            onPointerMove={(e) => dragging.current === e.pointerId && pick(e)}
            onPointerUp={() => (dragging.current = null)}
            onPointerCancel={() => (dragging.current = null)}
          />
          <span className="wheel-marker" style={{ left: mx, top: my, background: hex }} />
        </div>
        <label className="field">
          Helligkeit
          <input
            className="brightness"
            type="range"
            min={5}
            max={100}
            value={Math.round(v * 100)}
            onChange={(e) => setV(Number(e.target.value) / 100)}
            style={{ ["--hue" as string]: hsvToHex(h, s, 1) }}
          />
        </label>
        <div className="row">
          <span className="color-preview" style={{ background: hex }} />
          <span className="muted small">{hex.toUpperCase()}</span>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onCancel}>Abbrechen</button>
          <button className="btn primary" onClick={() => onAdd(hex)}>Hinzufügen</button>
        </div>
      </div>
    </div>
  );
}
