// Eigene Stiftfarben (zusätzlich zu den vorgegebenen). Liegen im Browser-Speicher und kommen mit in die Datensicherung.

export const CUSTOM_COLORS_KEY = "mathe-studium.customColors";

export function loadCustomColors(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) : [];
  } catch {
    return [];
  }
}

export function saveCustomColors(colors: string[]) {
  try {
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

// Farben für Notiz-Zettel: zuletzt verwendete zuerst. Beim ersten Mal ein paar helle Vorschläge (löschbar).
export const NOTE_COLORS_KEY = "mathe-studium.noteColors";
const NOTE_COLOR_SEED = ["#ffe27a", "#a8e6a1", "#9fd3ff", "#ffb3c7"];

export function loadNoteColors(): string[] {
  try {
    const raw = localStorage.getItem(NOTE_COLORS_KEY);
    if (raw === null) return [...NOTE_COLOR_SEED];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) : [];
  } catch {
    return [...NOTE_COLOR_SEED];
  }
}

export function saveNoteColors(colors: string[]) {
  try {
    localStorage.setItem(NOTE_COLORS_KEY, JSON.stringify(colors));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

// Stiftfarbe in Zeichenfeldern von Notizen (eine Farbe, per langem Drücken änderbar)
export const NOTE_PEN_COLOR_KEY = "mathe-studium.notePenColor"; // frühere Fassung: nur eine Farbe
export const NOTE_PEN_COLORS_KEY = "mathe-studium.notePenColors";
export interface NotePenColors {
  colors: [string, string]; // zwei Stiftfarben für Zeichenfelder in Notizen
  active: 0 | 1;
}
const HEX = /^#[0-9a-f]{6}$/i;
/** Zwei Stiftfarben der Zeichenfelder in Notizen (übernimmt die eine Farbe der früheren Fassung als erste). */
export function loadNotePenColors(): NotePenColors {
  const fallback: NotePenColors = { colors: ["#1d1d1f", "#1f4fc4"], active: 0 };
  try {
    const v = JSON.parse(localStorage.getItem(NOTE_PEN_COLORS_KEY) ?? "null") as Partial<NotePenColors> | null;
    if (v && Array.isArray(v.colors) && v.colors.length === 2 && v.colors.every((c) => typeof c === "string" && HEX.test(c))) {
      return { colors: [v.colors[0], v.colors[1]], active: v.active === 1 ? 1 : 0 };
    }
    const old = localStorage.getItem(NOTE_PEN_COLOR_KEY);
    if (old && HEX.test(old)) return { colors: [old, old.toLowerCase() === "#1f4fc4" ? "#1d1d1f" : "#1f4fc4"], active: 0 };
  } catch {
    /* Speicher nicht verfügbar */
  }
  return fallback;
}
export function saveNotePenColors(v: NotePenColors) {
  try {
    localStorage.setItem(NOTE_PEN_COLORS_KEY, JSON.stringify(v));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

/** Dunkle Farbe? (dann helle Schrift/Symbole darauf) */
export function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

/** HSV (h 0–360, s/v 0–1) → [r, g, b] mit 0–255 */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return [f(5), f(3), f(1)];
}

/** HSV (h 0–360, s/v 0–1) → "#rrggbb" */
export function hsvToHex(h: number, s: number, v: number): string {
  return "#" + hsvToRgb(h, s, v).map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** "#rrggbb" → HSV (h 0–360, s/v 0–1) */
export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
