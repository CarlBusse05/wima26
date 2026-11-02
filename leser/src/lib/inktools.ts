// Stift-Werkzeuge: Farben, Stärken und Werkzeugwechsel (Stift-Leiste oben und Werkzeug-Leisten am Rand).

import type { InkToolState } from "../components/InkLayer";

export const PEN_COLORS = [
  { c: "#1d1d1f", n: "Schwarz" },
  { c: "#1f4fc4", n: "Blau" },
  { c: "#d0312d", n: "Rot" },
  { c: "#1e7a3d", n: "Grün" },
  { c: "#7b3fbf", n: "Lila" },
];
export const HL_COLORS = [
  { c: "#ffd400", n: "Gelb" },
  { c: "#5be37d", n: "Grün" },
  { c: "#ff7eb6", n: "Pink" },
  { c: "#6ec8ff", n: "Blau" },
];
export const PEN_WIDTHS = [0.9, 1.6, 2.8];
export const HL_WIDTHS = [8, 12, 18];

/** Werkzeug wechseln (Stift-Leiste oben und Werkzeug-Leisten am Rand): der Stift behält seine Farbe, der Textmarker
 *  beginnt gelb, Radierer und Lasso behalten Farbe und Stärke für die Rückkehr zum Stift. */
export function switchTool(tool: InkToolState, mode: InkToolState["mode"], custom: string[]): InkToolState {
  if (mode === "pen") {
    return { mode, color: PEN_COLORS.some((x) => x.c === tool.color) || custom.includes(tool.color) ? tool.color : PEN_COLORS[1].c, width: PEN_WIDTHS[1] };
  }
  if (mode === "highlighter") return { mode, color: HL_COLORS[0].c, width: HL_WIDTHS[1] };
  return { ...tool, mode };
}
