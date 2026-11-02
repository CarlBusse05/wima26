// Datum des neuesten Aufschriebs in einem Skript erkennen – z. B. "Vorlesung 23. Oktober", "Stand: 23.10.2025",
// "VL 7 (30.10.)", "Montag, 6. November 2025". Grundsatz: lieber kein Datum als ein falsches. Daten im Fließtext
// (z. B. Zinstermine in Aufgaben) zählen deshalb nur, wenn ein Signalwort in derselben Zeile steht oder die Zeile
// im Wesentlichen nur aus dem Datum besteht (Überschrift).

import type { PageText } from "./db";
import { pageString } from "./pdf";

/** Bei Änderungen am Verfahren erhöhen – vorhandene Skripte werden dann neu durchsucht. */
export const DATE_SCAN_VERSION = 1;

export interface DocDate {
  at: number; // Zeitstempel (12 Uhr Ortszeit)
  hasYear: boolean; // Jahr stand im Dokument (sonst aus dem Hochladedatum erschlossen)
  context: string; // Fundstelle, z. B. "Vorlesung 23. Oktober"
}

const MONTHS: [RegExp, number][] = [
  [/^(?:januar|jan|january)$/, 1],
  [/^(?:februar|feb|febr|february)$/, 2],
  [/^(?:märz|maerz|mär|mrz|march|mar)$/, 3],
  [/^(?:april|apr)$/, 4],
  [/^(?:mai|may)$/, 5],
  [/^(?:juni|jun|june)$/, 6],
  [/^(?:juli|jul|july)$/, 7],
  [/^(?:august|aug)$/, 8],
  [/^(?:september|sep|sept)$/, 9],
  [/^(?:oktober|okt|october|oct)$/, 10],
  [/^(?:november|nov)$/, 11],
  [/^(?:dezember|dez|december|dec)$/, 12],
];
const MONTH_WORDS =
  "januar|january|jan|februar|february|febr|feb|märz|maerz|march|mär|mrz|mar|april|apr|mai|may|juni|june|jun|juli|july|jul|august|aug|september|sept|sep|oktober|october|okt|oct|november|nov|dezember|december|dez|dec";
const TEXTUAL = new RegExp(`(?<![\\p{L}\\d])(\\d{1,2})\\.?\\s*(${MONTH_WORDS})\\.?(?![\\p{L}])(?:\\s*(\\d{4}))?`, "giu");
const NUMERIC = /(?<![\d.,])(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}|\d{2}))?(?![\d,])/g;
const KEYWORDS =
  /(?<![\p{L}])(?:vorlesung(?:en)?|vl|sitzung|termin|stand|datum|woche|aufschrieb|mitschrift|lecture|session|stunde|übung|tutorium|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so)(?![\p{L}])/iu;

const NUMBERED =
  /(?:satz|sätze|kapitel|kap|abschnitt|abschn|definition|def|lemma|korollar|theorem|proposition|bemerkung|beispiel|bsp|aufgabe|übung|übungsblatt|blatt|folie|seite|s|nr|gleichung|abbildung|abb|tabelle|tab|§)\.?\s*$/iu;

const DAY = 86400000;

function monthOf(word: string): number | null {
  const w = word.toLowerCase();
  for (const [re, m] of MONTHS) if (re.test(w)) return m;
  return null;
}

/** Neuestes erkennbares Datum eines Aufschriebs; null, wenn keins sicher erkennbar ist. */
export function findDocDate(pages: PageText[], uploadedAt: number): DocDate | null {
  const ref = new Date(uploadedAt);
  let best: DocDate | null = null;

  const consider = (d: number, mo: number, y: string | undefined, context: string) => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return;
    let year = y ? Number(y.length === 2 ? "20" + y : y) : ref.getFullYear();
    let date = new Date(year, mo - 1, d, 12);
    if (date.getMonth() !== mo - 1) return; // z. B. 31.02.
    // ohne Jahr: das letzte solche Datum bis zum Hochladen
    if (!y && date.getTime() > uploadedAt + DAY) {
      year--;
      date = new Date(year, mo - 1, d, 12);
    }
    const t = date.getTime();
    // Termine nach dem Hochladen (Vorlesungsplan) und sehr alte Daten (Literatur, Aufgaben) ignorieren
    if (t > uploadedAt + 2 * DAY || t < uploadedAt - 2 * 365 * DAY) return;
    if (!best || t > best.at) best = { at: t, hasYear: !!y, context };
  };

  for (const p of pages) {
    const text = pageString(p).text.replace(/-\n(\p{Ll})/gu, "$1");
    for (const raw of text.split("\n")) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (line.length < 4 || !/\d/.test(line)) continue;
      const keyword = KEYWORDS.test(line);
      const words = line.split(" ").length;
      for (const m of line.matchAll(TEXTUAL)) {
        const mo = monthOf(m[2]);
        // Überschrift: Datum ist (fast) die ganze Zeile
        const heading = words <= 6 && m[0].length >= line.length * 0.4;
        if (mo && (keyword || heading)) consider(Number(m[1]), mo, m[3], line.slice(0, 80));
      }
      for (const m of line.matchAll(NUMERIC)) {
        // Nummern wie "Satz 2.3." oder "Kapitel 1.2." sind keine Daten
        if (NUMBERED.test(line.slice(Math.max(0, m.index! - 16), m.index!))) continue;
        // ohne Signalwort nur vollständige Daten als eigene Zeile
        const heading = words <= 4 && !!m[3] && m[3].length === 4 && m[0].length >= line.length * 0.4;
        if (keyword || heading) consider(Number(m[1]), Number(m[2]), m[3], line.slice(0, 80));
      }
    }
  }
  return best;
}

/** Anzeige: "23.10.2025" bzw. "23.10." wenn das Jahr nicht im Dokument stand. */
export function formatDocDate(d: DocDate): string {
  const x = new Date(d.at);
  const dm = `${String(x.getDate()).padStart(2, "0")}.${String(x.getMonth() + 1).padStart(2, "0")}.`;
  return d.hasYear ? dm + x.getFullYear() : dm;
}
