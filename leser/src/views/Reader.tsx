import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { onSicht, setSichtbar, sichtbar, watchShared, wimaNutzer } from "../lib/wima";
import { get, put, uid, type Entry, type EntryKind, type Script, type ScriptIndex } from "../lib/db";
import { drawStrokes, exportWithInk, inkCount, type Annotations, type CompareItem, type OrphanInk, type PageInk, type StickyNote, type Stroke } from "../lib/ink";
import CompareView from "../components/CompareView";
import Lasso, { type LassoTarget } from "../components/Lasso";
import { finishCompare, keepOldPage, pendingPages } from "../lib/compare";
import NotePanel from "../components/NotePanel";
import { isEmptyNote, notePreview } from "../lib/notes";
import { isDark } from "../lib/colors";
import type { InkToolState } from "../components/InkLayer";
import InkToolbar from "../components/InkToolbar";
import ToolDock from "../components/ToolDock";
import Icon from "../components/Icon";
import { closePdf, definitionRegion, loadPdf, pageString, renderRegion, textBox, textInRect, type PDFDocumentProxy } from "../lib/pdf";
import { buildLinker, entryLabel, linkKey } from "../lib/indexer";
import { INDEX_VERSION, sortEntries, upgradeIndex } from "../lib/ingest";
import PinDialog from "../components/PinDialog";
import type { DefCandidate } from "../lib/indexer";
import PdfPage from "../components/PdfPage";
import IndexPanel from "../components/IndexPanel";
import { navigate } from "../router";
import { loadSettings } from "../lib/settings";
import { level, LEVELS, recordLookup, weakLookups } from "../lib/lookups";
import { loadWordPairs } from "../lib/wordforms";
import { pageRanges } from "../lib/versions";
import { copyImage, snipImage } from "../lib/snip";

/** Verkleinerte Darstellung von Notizen, die keiner Seite mehr zugeordnet sind. */
function OrphanPreview({ o }: { o: OrphanInk }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // nur den Bereich mit Strichen zeigen
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const st of o.strokes) for (let i = 0; i < st.points.length; i += 3) {
      x0 = Math.min(x0, st.points[i]); x1 = Math.max(x1, st.points[i]);
      y0 = Math.min(y0, st.points[i + 1]); y1 = Math.max(y1, st.points[i + 1]);
    }
    if (!Number.isFinite(x0)) return;
    const pad = 12;
    const w = x1 - x0 + 2 * pad;
    const h = y1 - y0 + 2 * pad;
    const sc = Math.min(260 / w, 180 / h, 2);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(w * sc * dpr);
    c.height = Math.round(h * sc * dpr);
    c.style.width = `${w * sc}px`;
    c.style.height = `${h * sc}px`;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w * sc, h * sc);
    drawStrokes(ctx, o.strokes, sc, x0 - pad, y0 - pad);
  }, [o]);
  return <canvas ref={ref} className="orphan-canvas" />;
}

interface HistoryItem {
  scrollTop: number;
  label: string;
  term?: string; // Begriff, über dessen Verknüpfung gesprungen wurde
  link?: { page: number; start: number }; // die angeklickte Fundstelle
}

interface LinkMenu {
  entry: Entry;
  term?: string;
  link?: { page: number; start: number };
  x: number;
  y: number;
  openedAt: number;
}

/** Google-Suche nach der Definition eines Begriffs */
const googleUrl = (text: string) =>
  `https://www.google.com/search?q=${encodeURIComponent(`${text.replace(/\s+/g, " ").trim()} Definition Mathematik`)}`;

const LONG_PRESS_MS = 500;
const nowMs = () => Date.now(); // Zeitstempel in Ereignis-Handlern

type InkOp =
  | { type: "add" | "erase"; page: number; strokes: Stroke[] }
  | { type: "move"; from: number; to: number; before: Stroke[]; after: Stroke[] }; // Lasso: verschoben (auch auf eine andere Seite)

const isTouch = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

const GAP = 14;
const NO_STROKES: Stroke[] = [];
const PAD = 16;
const RENDER_MARGIN = 1600;
const MIN_ZOOM = 0.25; // 25 %: mehrere Seiten untereinander im Blick, zum schnellen Überblicken
const MAX_ZOOM = 3;

export default function Reader({ scriptId, initialPage }: { scriptId: string; initialPage?: number }) {
  const [script, setScript] = useState<Script | null>(null);
  const [index, setIndex] = useState<ScriptIndex | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  // Ziel eines laufenden weichen Bildlaufs (Sprünge, „Zur Notiz“): Schließt man die Notiz, bevor er fertig ist, gilt
  // das Ziel als die aktuelle Ansicht – sonst würde die Zwischenposition gemerkt und der Bildlauf liefe danach weiter
  const pendingScroll = useRef<{ top: number; left: number; until: number } | null>(null);
  const smoothScroll = useCallback((top: number, left?: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const t = {
      top: Math.min(Math.max(0, top), Math.max(0, el.scrollHeight - el.clientHeight)),
      left: Math.min(Math.max(0, left ?? el.scrollLeft), Math.max(0, el.scrollWidth - el.clientWidth)),
    };
    pendingScroll.current = { ...t, until: nowMs() + 1500 };
    el.scrollTo({ ...t, behavior: "smooth" });
  }, []);
  const [viewW, setViewW] = useState(800);
  const [zoom, setZoom] = useState(0.7); // Start mit 70 %
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewH, setViewH] = useState(800);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showTrail, setShowTrail] = useState(false);
  const [flash, setFlash] = useState<{ page: number; y: number; h: number; key: number } | null>(null);

  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 1200);
  const [showLinks, setShowLinks] = useState(true);

  const [search, setSearch] = useState("");
  const [pageInput, setPageInput] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ entry: Entry; x: number; y: number; url?: string; term?: string; span?: HTMLElement } | null>(null);
  const [linkMenu, setLinkMenu] = useState<LinkMenu | null>(null);
  const [toast, setToast] = useState<{ msg: string; action: { label: string; run: () => void } } | null>(null);
  const [weakCount, setWeakCount] = useState(0);
  const [linkStyle] = useState(() => loadSettings().linkStyle);
  const [wordPairs] = useState(loadWordPairs);
  const [orphans, setOrphans] = useState<OrphanInk[]>([]);
  const [showOrphans, setShowOrphans] = useState(false);
  // Notiz-Zettel: Symbol an einer Stelle im Skript, Inhalt im Feld rechts
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [notePlacing, setNotePlacing] = useState(false);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [noteHeadSlot, setNoteHeadSlot] = useState<HTMLDivElement | null>(null); // Platz in der Leiste für die Notiz-Kopfzeile
  const previewCache = useRef(new Map<string, string>());
  const hoverTimer = useRef<number | undefined>(undefined);
  const [selTool, setSelTool] = useState<{ x: number; y: number; text: string; page: number | null; rect: DOMRect | null } | null>(null);
  const [pin, setPin] = useState<{ text: string; page: number; y: number } | null>(null);
  // nachgeschlagene Definition als Ausschnitt in der Mitte (statt zu springen)
  const [lookup, setLookup] = useState<{
    entry: Entry;
    from: { page: number; y: number };
    term?: string;
    link?: { page: number; start: number };
    url?: string;
  } | null>(null);
  const lookupCache = useRef(new Map<string, string>());

  // ---------- Ausschnitt (Snipping-Tool) ----------
  const [snip, setSnip] = useState<{ area: { left: number; top: number; width: number; height: number } } | null>(null);
  const [snipDrag, setSnipDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [snipResult, setSnipResult] = useState<{ blob?: Blob; url?: string; copied?: boolean; error?: string } | null>(null);
  const snipDone = useRef(false);

  // ---------- Lasso: Zeichnungen auswählen und verschieben ----------
  const [lassoHide, setLassoHide] = useState<{ page: number; ids: Set<string> } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [lassoArea, setLassoArea] = useState<HTMLDivElement | null>(null);
  const setWrap = useCallback((el: HTMLDivElement | null) => {
    wrapRef.current = el;
    setLassoArea(el);
  }, []);

  const [upgrading, setUpgrading] = useState<string | null>(null);
  // Verbesserungsansicht (geänderte Seiten mit Notizen nach einer neuen Version)
  const [compare, setCompare] = useState<CompareItem[]>([]);
  const [compareFile, setCompareFile] = useState<string | undefined>(undefined);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [oldDoc, setOldDoc] = useState<PDFDocumentProxy | null>(null);
  const [reloadKey, setReloadKey] = useState(0); // nach „Alte Seite behalten“ alles neu laden

  // ---------- Handschriftliche Notizen ----------
  const [ink, setInk] = useState<PageInk>({});
  const [inkTool, setInkTool] = useState<InkToolState | null>(null);
  const [lastTool, setLastTool] = useState<InkToolState>({ mode: "pen", color: "#1f4fc4", width: 1.6 });
  const [dockSide, setDockSide] = useState<"left" | "right" | null>(null); // offene Werkzeug-Leiste am Rand
  const [inkVisible, setInkVisible] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null);
  const undoStack = useRef<InkOp[]>([]);
  const redoStack = useRef<InkOp[]>([]);
  const [, setOpsVersion] = useState(0);
  const inkLoaded = useRef(false);

  // ---------- Laden ----------
  useEffect(() => {
    let d: PDFDocumentProxy | null = null;
    (async () => {
      const s = await get<Script>("scripts", scriptId);
      const idx = await get<ScriptIndex>("indexes", scriptId);
      const file = await get<{ id: string; blob: Blob }>("files", scriptId);
      if (!s || !idx || !file) {
        setError("Skript nicht gefunden.");
        return;
      }
      setScript(s);
      setIndex(idx);
      const ann = await get<Annotations>("annotations", scriptId);
      setInk(ann?.pages ?? {});
      setOrphans(ann?.orphans ?? []);
      setNotes(ann?.notes ?? []);
      setCompare(ann?.compare ?? []);
      setCompareFile(ann?.compareFile);
      undoStack.current = [];
      redoStack.current = [];
      inkLoaded.current = true;
      d = await loadPdf(file.blob);
      setDoc(d);
      // Ältere Skripte: Text samt Fett/Kursiv neu lesen, Definitionen neu erkennen
      if ((idx.version ?? 1) < INDEX_VERSION) {
        setUpgrading("Skript wird neu analysiert …");
        const next = await upgradeIndex(d, idx, (msg) => setUpgrading(msg));
        setIndex(next);
        setUpgrading(null);
      }
    })().catch((e) => setError(String(e)));
    return () => {
      void closePdf(d);
    };
  }, [scriptId, reloadKey]);

  // Gemeinsame Notizen (Skripte aus Wima): fremde Änderungen holen und dann neu laden
  useEffect(() => {
    if (!script?.wima) return;
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== scriptId) return;
      inkLoaded.current = false;
      setReloadKey((k) => k + 1);
    };
    window.addEventListener("wima-reload", on);
    const unwatch = watchShared(scriptId);
    return () => {
      window.removeEventListener("wima-reload", on);
      unwatch();
    };
  }, [scriptId, !!script?.wima]);

  // Skripte aus Wima: Wessen Notizen zu sehen sind, wird in Wima gewählt; bearbeiten lassen sich nur die eigenen
  const wimaItem = script?.wima?.item;
  const [ich, setIch] = useState<string | null>(null);
  const [sicht, setSicht] = useState<string[]>([]);
  const [nutzer, setNutzer] = useState<string[]>([]);
  useEffect(() => {
    if (wimaItem === undefined) return;
    setSicht(sichtbar(wimaItem));
    wimaNutzer().then((w) => {
      setIch(w.user);
      setNutzer(w.users);
    }, () => {});
    return onSicht(wimaItem, setSicht);
  }, [wimaItem]);
  const wimaAn = wimaItem !== undefined && ich !== null;
  const zeigt = useCallback((von?: string) => !wimaAn || !von || sicht.includes(von), [wimaAn, sicht]);
  const teilCache = useMemo(() => new WeakMap<Stroke[], { own: Stroke[]; fixed: Stroke[] }>(), [wimaAn, sicht, ich]);
  /** Striche einer Seite: eigene (bearbeitbar) und fremde sichtbare (nur angezeigt). */
  const teile = (list: Stroke[]) => {
    if (!wimaAn) return { own: list, fixed: NO_STROKES };
    let r = teilCache.get(list);
    if (!r) {
      const own = list.filter((x) => zeigt(x.von) && (!x.von || x.von === ich));
      const fixed = list.filter((x) => zeigt(x.von) && x.von && x.von !== ich);
      r = { own: own.length === list.length ? list : own, fixed: fixed.length ? fixed : NO_STROKES };
      teilCache.set(list, r);
    }
    return r;
  };
  /** Neue eigene Notiz: Autor eintragen und die eigenen Notizen einblenden. */
  const alsEigene = useCallback(<T extends { von?: string }>(x: T): T => {
    if (!wimaAn) return x;
    if (!sicht.includes(ich!)) setSichtbar(wimaItem!, [...sicht, ich!]);
    return { ...x, von: ich! };
  }, [wimaAn, sicht, ich, wimaItem]);

  // ---------- Geometrie ----------
  // wird vor jeder Größenänderung des Lesebereichs aufgerufen (Notizfeld, Index, Drehen des iPads)
  const beforeResize = useRef<((newWidth: number) => void) | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      beforeResize.current?.(el.clientWidth);
      setViewW(el.clientWidth);
      setViewH(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  const pages = useMemo(() => index?.pages ?? [], [index]);
  const maxW = useMemo(() => Math.max(1, ...pages.map((p) => p.width)), [pages]);
  const scale = useMemo(() => Math.max(0.1, ((Math.min(viewW, 1400) - 2 * PAD) / maxW) * zoom), [viewW, maxW, zoom]);
  const tops = useMemo(() => {
    const t: number[] = [];
    let y = PAD;
    for (const p of pages) {
      t.push(y);
      y += p.height * scale + GAP;
    }
    t.push(y);
    return t;
  }, [pages, scale]);

  const pageAtY = useCallback(
    (y: number) => {
      let i = 0;
      while (i + 1 < pages.length && tops[i + 1] <= y) i++;
      return i + 1;
    },
    [pages.length, tops],
  );
  const currentPage = pages.length ? pageAtY(scrollTop + viewH * 0.3) : 1;

  // ---------- Zoom ----------
  // Beim Zoomen bleibt der Punkt unter den Fingern (bzw. die Bildschirmmitte) an seiner Stelle: Seite + Anteil
  // innerhalb der Seite merken und nach dem Neu-Layout wieder an dieselbe Bildschirmposition scrollen.
  const contentRef = useRef<HTMLDivElement>(null);
  // sy: Bildschirmhöhe (clientY) des Ankers – gilt auch, wenn sich der Lesebereich selbst verschiebt
  // (z. B. weil die Leiste beim Öffnen einer Notiz eine andere Höhe bekommt)
  // mid: der Ankerpunkt kommt in die Mitte des Lesebereichs, so wie er NACH der Größenänderung ist
  // from: Scrollstand vor dem Öffnen einer Notiz (zum exakten Zurückkehren); restore: genau diesen Stand wiederherstellen
  const anchor = useRef<{
    page: number; fx: number; fy: number; vx: number; vy: number; sy?: number; mid?: boolean;
    from?: { top: number; left: number }; restore?: { top: number; left: number };
  } | null>(null);
  // Ansicht nach dem Öffnen der Notiz – wird bis zum Schließen nicht gescrollt, kehrt das Schließen exakt zurück
  const noteView = useRef<{ from: { top: number; left: number }; top: number; left: number; zoom: number } | null>(null);
  const geo = useRef({ zoom, scale, tops, pages, viewW });
  useLayoutEffect(() => {
    geo.current = { zoom, scale, tops, pages, viewW };
  });

  /** Seitenanker für einen Punkt im Inhalt (Koordinaten des ungezoomten Inhalts) und seine Bildschirmposition. */
  const anchorAt = (cx: number, cy: number, vx: number, vy: number) => {
    const el = scrollRef.current;
    const { pages: ps, tops: ts, scale: sc, viewW: w } = geo.current;
    if (!el || !ps.length) return null;
    let i = 0;
    while (i + 1 < ps.length && ts[i + 1] <= cy) i++;
    const pw = ps[i].width * sc;
    const left = Math.max(0, (w - pw) / 2); // Breite des bisherigen Layouts (bei Größenänderung ist clientWidth schon neu)
    return { page: i + 1, fx: (cx - left) / pw, fy: (cy - ts[i]) / (ps[i].height * sc), vx, vy };
  };

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  const changeZoom = (z: number, at?: { vx: number; vy: number }) => {
    const el = scrollRef.current;
    const next = clampZoom(z);
    if (el && next !== geo.current.zoom) {
      const vx = at?.vx ?? el.clientWidth / 2;
      const vy = at?.vy ?? el.clientHeight / 2;
      anchor.current = anchorAt(el.scrollLeft + vx, el.scrollTop + vy, vx, vy);
    }
    setZoom(next);
  };
  // Safari auf dem iPad übernimmt eine Scrollposition, die im selben Moment wie eine Größenänderung des Lesebereichs
  // gesetzt wird, nicht immer (der Bereich bleibt auf der alten Scrollhöhe – bei kleineren Seiten also weiter hinten).
  // Deshalb wird die Zielposition in den nächsten Frames erneut gesetzt – nur wenn der Bereich genau auf die alte
  // Scrollhöhe zurückgesprungen ist, und nicht, wenn man inzwischen selbst scrollt/tippt oder ein Sprung läuft.
  const lastTouch = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mark = () => (lastTouch.current = nowMs());
    el.addEventListener("touchstart", mark, { passive: true });
    el.addEventListener("pointerdown", mark, { passive: true });
    el.addEventListener("wheel", mark, { passive: true });
    return () => {
      el.removeEventListener("touchstart", mark);
      el.removeEventListener("pointerdown", mark);
      el.removeEventListener("wheel", mark);
    };
  }, [doc]);
  const holdScroll = (el: HTMLElement, top: number, left: number, oldTop: number, oldLeft: number) => {
    const since = nowMs();
    let done = false;
    const fix = () => {
      if (done || lastTouch.current > since) return; // man scrollt/tippt selbst – nicht dagegenhalten
      const atTarget = Math.abs(el.scrollTop - top) <= 2 && Math.abs(el.scrollLeft - left) <= 2;
      const reverted = Math.abs(el.scrollTop - oldTop) <= 2 && Math.abs(el.scrollLeft - oldLeft) <= 2;
      if (atTarget) return;
      if (!reverted) {
        done = true; // woanders hin gescrollt (Sprung o. Ä.) – das gilt
        return;
      }
      el.scrollTop = top;
      el.scrollLeft = left;
    };
    requestAnimationFrame(() => {
      fix();
      requestAnimationFrame(fix);
    });
    for (const ms of [80, 200, 400]) window.setTimeout(fix, ms);
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scrollRef.current;
    if (contentRef.current) contentRef.current.style.transform = "";
    if (!a || !el || !pages.length) return;
    anchor.current = null;
    const p = pages[a.page - 1];
    const pw = p.width * scale;
    const left = Math.max(0, (el.clientWidth - pw) / 2);
    const vy = a.mid ? el.clientHeight / 2 : a.sy !== undefined ? a.sy - el.getBoundingClientRect().top : a.vy;
    const vx = a.mid ? el.clientWidth / 2 : a.vx;
    const oldTop = el.scrollTop;
    const oldLeft = el.scrollLeft;
    const top = a.restore ? a.restore.top : tops[a.page - 1] + a.fy * p.height * scale - vy;
    const lft = a.restore ? a.restore.left : left + a.fx * pw - vx;
    el.scrollTop = top;
    el.scrollLeft = lft;
    if (a.from) noteView.current = { from: a.from, top: el.scrollTop, left: el.scrollLeft, zoom: geo.current.zoom };
    holdScroll(el, el.scrollTop, el.scrollLeft, oldTop, oldLeft);
  }, [scale, tops, pages]);

  // Anfangsposition
  const didInit = useRef(false);
  useLayoutEffect(() => {
    if (didInit.current || !doc || !script || !pages.length || !scrollRef.current) return;
    didInit.current = true;
    const p = initialPage ?? script.lastPage ?? 1;
    if (p > 1) scrollRef.current.scrollTop = tops[Math.min(p, pages.length) - 1] - 8;
  }, [doc, script, pages, tops, initialPage]);

  // nach „Alte Seite behalten“: dieselbe Stelle weiterlesen, auch wenn davor eine Seite eingefügt wurde
  const keepPos = useRef<{ page: number; dy: number } | null>(null);
  useLayoutEffect(() => {
    const k = keepPos.current;
    if (!k || !scrollRef.current || pages.length < k.page) return;
    keepPos.current = null;
    scrollRef.current.scrollTop = tops[k.page - 1] + k.dy;
  }, [pages, tops]);

  // Leseposition merken
  useEffect(() => {
    if (!script || !pages.length) return;
    const t = setTimeout(() => {
      if (script.lastPage !== currentPage) {
        const next = { ...script, lastPage: currentPage };
        setScript(next);
        void put("scripts", next);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [currentPage, script, pages.length]);

  // ---------- Verlinkung ----------
  const entries = useMemo(() => index?.entries ?? [], [index]);
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const linker = useMemo(
    () => (index && showLinks ? buildLinker(index.entries, index.disabledTerms, index.disabledLinks, wordPairs) : null),
    [index, showLinks, wordPairs],
  );
  const searchRe = useMemo(() => {
    const q = search.trim();
    if (q.length < 2) return null;
    return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  }, [search]);
  // alle Fundstellen der Suche (Seite + Zeichenbereich), in Lesereihenfolge
  const searchHits = useMemo(() => {
    if (!searchRe) return [];
    const hits: { page: number; start: number; end: number }[] = [];
    for (const p of pages) {
      for (const m of pageString(p).text.matchAll(searchRe)) hits.push({ page: p.page, start: m.index, end: m.index + m[0].length });
    }
    return hits;
  }, [searchRe, pages]);
  const [searchPos, setSearchPos] = useState(-1); // zuletzt angesprungene Fundstelle
  const searchPages = useMemo(() => new Set(searchHits.map((h) => h.page)).size, [searchHits]);

  const saveIndex = async (next: ScriptIndex) => {
    setIndex(next);
    previewCache.current.clear();
    await put("indexes", next);
  };

  // Bezeichnung der aktuellen Stelle (für die Zurück-Leiste)
  const placeLabel = useCallback(
    (page: number, y: number) => {
      let last: Entry | null = null;
      for (const e of entries) {
        if (e.page < page || (e.page === page && e.y <= y + 5)) last = e;
        else break;
      }
      const nearby = last && page - last.page <= 3 ? ` · ${last.kind}${last.number ? " " + last.number : ""}` : "";
      return `S. ${page}${nearby}`;
    },
    [entries],
  );

  const scrollToY = (top: number, smooth = true) => {
    if (smooth) smoothScroll(top);
    else scrollRef.current?.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  };

  /** Sprung zu einem Wort: Es steht danach in der Mitte des Lesebereichs (auch waagerecht, wenn die Seite breiter ist). */
  const centerOn = (page: number, box: { x: number; y: number; w: number; h: number }) => {
    const el = scrollRef.current;
    const p = pages[page - 1];
    if (!el || !p) return;
    const left = Math.max(0, (el.clientWidth - p.width * scale) / 2);
    smoothScroll(tops[page - 1] + (box.y + box.h / 2) * scale - el.clientHeight / 2, left + (box.x + box.w / 2) * scale - el.clientWidth / 2);
  };
  /** Lage eines Begriffs auf einer Seite – bevorzugt innerhalb [y0, y1] (z. B. im Definitionstext). */
  const findTerm = (page: number, term: string, y0 = 0, y1 = Infinity) => {
    const p = pages[page - 1];
    if (!p || !term) return null;
    const text = pageString(p).text.toLowerCase();
    const t = term.toLowerCase();
    let first: ReturnType<typeof textBox> = null;
    for (let i = text.indexOf(t); i >= 0; i = text.indexOf(t, i + 1)) {
      const b = textBox(p, i, i + t.length);
      if (!b) continue;
      if (b.y + b.h >= y0 - 4 && b.y <= y1 + 4) return b;
      if (!first && b.y >= y0) first = b;
    }
    return first;
  };

  const jumpTo = (e: Entry, from?: { page: number; y: number }, term?: string, link?: { page: number; start: number }) => {
    const el = scrollRef.current;
    if (!el) return;
    const fromPage = from?.page ?? pageAtY(el.scrollTop + el.clientHeight * 0.3);
    const fromY = from?.y ?? (el.scrollTop - tops[fromPage - 1]) / scale;
    setHistory((h) => [...h, { scrollTop: el.scrollTop, label: placeLabel(fromPage, fromY), term, link }].slice(-30));
    setPreview(null);
    setSelTool(null);
    // der Begriff (oder der Anfang der Definition) steht danach in der Mitte des Lesebereichs
    const box = findTerm(e.page, term ?? "", e.y, e.yEnd) ?? findTerm(e.page, e.terms[0] ?? "", e.y, e.yEnd);
    if (box) centerOn(e.page, box);
    else centerOn(e.page, { x: (pages[e.page - 1]?.width ?? 0) / 2, y: e.y, w: 0, h: Math.min(e.yEnd - e.y, 40) });
    setFlash({ page: e.page, y: e.y, h: Math.min(e.yEnd - e.y, 260), key: Date.now() });
  };

  // Suche: nächste (Shift: vorige) Fundstelle – das Wort springt in die Mitte des Lesebereichs
  const jumpToHit = (back = false) => {
    const el = scrollRef.current;
    if (!el || !searchHits.length) return;
    let i: number;
    if (searchPos >= 0 && searchPos < searchHits.length) i = (searchPos + (back ? -1 : 1) + searchHits.length) % searchHits.length;
    else {
      // erste Fundstelle ab der Mitte des Lesebereichs
      const mid = el.scrollTop + el.clientHeight / 2;
      const ys = searchHits.map((h) => tops[h.page - 1] + (textBox(pages[h.page - 1], h.start, h.end)?.y ?? 0) * scale);
      i = Math.max(0, ys.findIndex((y) => y >= mid - 2));
      if (back) i = (i - 1 + searchHits.length) % searchHits.length;
    }
    const h = searchHits[i];
    const box = textBox(pages[h.page - 1], h.start, h.end);
    if (!box) return;
    const fromPage = pageAtY(el.scrollTop + el.clientHeight * 0.3);
    setHistory((list) => [...list, { scrollTop: el.scrollTop, label: placeLabel(fromPage, 0) }].slice(-30));
    setSearchPos(i);
    centerOn(h.page, box);
    setFlash({ page: h.page, y: box.y - 3, h: box.h + 6, key: Date.now() });
  };

  const jumpToPage = (page: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const fromPage = pageAtY(el.scrollTop + el.clientHeight * 0.3);
    setHistory((h) => [...h, { scrollTop: el.scrollTop, label: placeLabel(fromPage, 0) }].slice(-30));
    scrollToY(tops[Math.min(Math.max(page, 1), pages.length) - 1] - 8);
  };

  const goBack = useCallback(
    (steps = 1) => {
      setHistory((h) => {
        if (!h.length) return h;
        const target = h[h.length - steps];
        smoothScroll(target.scrollTop);
        return h.slice(0, h.length - steps);
      });
      setShowTrail(false);
    },
    [smoothScroll],
  );

  // Notizen speichern (verzögert, damit nicht jeder Strich einzeln schreibt)
  useEffect(() => {
    if (!inkLoaded.current) return;
    const t = setTimeout(() => {
      if (!inkLoaded.current) return; // gerade wird ein fremder Stand geladen – alten nicht darüberschreiben
      void put<Annotations>("annotations", { scriptId, pages: ink, orphans, notes, compare, compareFile, updatedAt: Date.now() });
    }, 500);
    return () => clearTimeout(t);
  }, [ink, orphans, notes, compare, compareFile, scriptId]);

  // ---------- Neue Version: Hinweise ----------
  const changes = script?.changes;
  const [openedAt] = useState(Date.now);
  const newPages = useMemo(
    () => new Set(changes && openedAt < changes.newUntil ? changes.newPages : []),
    [changes, openedAt],
  );
  // geänderte Seiten mit Notizen, die noch in der Verbesserungsansicht zu prüfen sind
  const pendingCompare = useMemo(() => compare.filter((c) => !c.done).sort((a, b) => a.newPage - b.newPage), [compare]);
  const reviewPages = useMemo(() => new Set(pendingPages({ compare })), [compare]);
  const updateChanges = (patch: Partial<NonNullable<Script["changes"]>>) => {
    setScript((cur) => {
      if (!cur?.changes) return cur;
      const next = { ...cur, changes: { ...cur.changes, ...patch } };
      void put("scripts", next);
      return next;
    });
  };
  const nextAfter = (list: number[]) => list.find((p) => p > currentPage) ?? list[0];

  const applyOp = useCallback((op: InkOp, reverse: boolean) => {
    if (op.type === "move") {
      const [from, to, remove, add] = reverse ? [op.to, op.from, op.after, op.before] : [op.from, op.to, op.before, op.after];
      const ids = new Set(remove.map((x) => x.id));
      setInk((cur) => {
        const next = { ...cur, [from]: (cur[from] ?? []).filter((x) => !ids.has(x.id)) };
        return { ...next, [to]: [...(next[to] ?? []), ...add] };
      });
      return;
    }
    const adding = (op.type === "add") !== reverse;
    const ids = new Set(op.strokes.map((x) => x.id));
    setInk((cur) => {
      const list = cur[op.page] ?? [];
      return { ...cur, [op.page]: adding ? [...list, ...op.strokes] : list.filter((x) => !ids.has(x.id)) };
    });
  }, []);

  const pushOp = useCallback(
    (op: InkOp) => {
      undoStack.current.push(op);
      redoStack.current = [];
      applyOp(op, false);
      setOpsVersion((v) => v + 1);
    },
    [applyOp],
  );

  const placeOrphan = (o: OrphanInk, page: number) => {
    pushOp({ type: "add", page, strokes: o.strokes.map((x) => ({ ...x, id: uid() })) });
    setOrphans((list) => list.filter((x) => x.id !== o.id));
    setInkVisible(true);
  };

  const onInkAdd = useCallback(
    (page: number, stroke: Stroke) => pushOp({ type: "add", page, strokes: [alsEigene(stroke)] }),
    [pushOp, alsEigene],
  );

  const inkRef = useRef(ink);
  useEffect(() => {
    inkRef.current = ink;
  }, [ink]);
  const onInkErase = useCallback(
    (page: number, ids: string[]) => {
      const removed = (inkRef.current[page] ?? []).filter((x) => ids.includes(x.id));
      if (!removed.length) return;
      // sofort aus dem Ref entfernen, damit schnelle Radier-Bewegungen nichts doppelt löschen
      inkRef.current = { ...inkRef.current, [page]: (inkRef.current[page] ?? []).filter((x) => !ids.includes(x.id)) };
      pushOp({ type: "erase", page, strokes: removed });
    },
    [pushOp],
  );

  const undo = () => {
    const op = undoStack.current.pop();
    if (!op) return;
    applyOp(op, true);
    redoStack.current.push(op);
    setOpsVersion((v) => v + 1);
  };
  const redo = () => {
    const op = redoStack.current.pop();
    if (!op) return;
    applyOp(op, false);
    undoStack.current.push(op);
    setOpsVersion((v) => v + 1);
  };

  const toggleDrawRef = useRef<() => void>(() => undefined); // für die Taste P (toggleDraw steht weiter unten)
  const stopDrawing = () => {
    if (!inkTool) return;
    setLastTool(inkTool);
    setInkTool(null);
  };

  // mit Notizen: Original-PDF plus Striche als Vektorgrafik; ohne Notizen: das hochgeladene Original unverändert
  const exportPdf = async (withInk: boolean) => {
    if (!doc || !script) return;
    setExportMenu(null);
    setExporting("Wird vorbereitet …");
    try {
      const file = await get<{ id: string; blob: Blob }>("files", scriptId);
      const blob = withInk
        ? new Blob([(await exportWithInk(file!.blob, doc, ink, (m) => setExporting(m))) as BlobPart], { type: "application/pdf" })
        : new Blob([file!.blob], { type: "application/pdf" });
      const name = withInk ? `${script.title} (mit Notizen).pdf` : `${script.title}.pdf`;
      const fileObj = new File([blob], name, { type: "application/pdf" });
      // iPad: Teilen-Menü (In Dateien sichern, AirDrop, GoodNotes …), sonst normaler Download
      if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [fileObj] })) {
        try {
          await navigator.share({ files: [fileObj], title: name });
          return;
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
        }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    } catch (e) {
      alert("Export fehlgeschlagen: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(null);
    }
  };

  // ---------- Tastatur ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
      if (e.key === "Escape") {
        setCompareId(null);
        setLookup(null);
        setNotePlacing(false);
        setSnip(null);
        setSnipDrag(null);
        setPreview(null);
        setSelTool(null);
        setShowTrail(false);
      }
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (e.key === "p") {
        toggleDrawRef.current();
        return;
      }
      // Pfeiltasten scrollen das Skript (Shift: fast eine ganze Bildschirmhöhe)
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey) {
        e.preventDefault();
        const step = e.shiftKey ? viewH * 0.9 : 80;
        scrollRef.current?.scrollBy({ top: e.key === "ArrowDown" ? step : -step, behavior: e.repeat ? "auto" : "smooth" });
        return;
      }
      if ((e.altKey && e.key === "ArrowLeft") || e.key === "Backspace" || e.key === "b") {
        e.preventDefault();
        goBack();
      } else if (e.key === "+" || e.key === "=") changeZoom(zoom * 1.15);
      else if (e.key === "-") changeZoom(zoom / 1.15);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- Klicks & Hover auf Verknüpfungen ----------
  const linkFromEvent = (target: EventTarget | null) => {
    const span = (target as HTMLElement | null)?.closest?.("span.dl") as HTMLElement | null;
    if (!span) return null;
    const entry = entryById.get(span.dataset.entry ?? "");
    return entry ? { span, entry } : null;
  };

  const linkAt = (span: HTMLElement) => {
    const pageEl = span.closest(".page") as HTMLElement | null;
    const start = Number(span.dataset.start);
    return pageEl && Number.isFinite(start) ? { page: Number(pageEl.dataset.page), start } : undefined;
  };

  // Langes Drücken (Finger/Pencil) oder Rechtsklick auf eine Verknüpfung → kleines Popup an der Stelle
  const pressTimer = useRef<number | undefined>(undefined);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const openLinkMenu = (span: HTMLElement, entry: Entry) => {
    const r = span.getBoundingClientRect();
    window.getSelection()?.removeAllRanges();
    setPreview(null);
    setSelTool(null);
    setLinkMenu({ entry, term: span.dataset.term, link: linkAt(span), x: r.left + r.width / 2, y: r.bottom + 6, openedAt: Date.now() });
  };
  const lastPointer = useRef("mouse");
  const onPagesPointerDown = (ev: React.PointerEvent) => {
    lastPointer.current = ev.pointerType;
    suppressClick.current = false;
    if (ev.pointerType === "mouse") return;
    const hit = linkFromEvent(ev.target);
    if (!hit) return;
    pressStart.current = { x: ev.clientX, y: ev.clientY };
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      suppressClick.current = true;
      openLinkMenu(hit.span, hit.entry);
    }, LONG_PRESS_MS);
  };
  const onPagesPointerMove = (ev: React.PointerEvent) => {
    const p0 = pressStart.current;
    if (p0 && Math.hypot(ev.clientX - p0.x, ev.clientY - p0.y) > 10) window.clearTimeout(pressTimer.current); // scrollt
  };
  const endPress = () => {
    pressStart.current = null;
    window.clearTimeout(pressTimer.current);
  };

  // Pinch-Zoom mit zwei Fingern (und Trackpad): Während der Geste wird nur der Inhalt per CSS skaliert –
  // schnell und ohne Neuzeichnen. Beim Loslassen wird der Zoom übernommen und die Seiten werden scharf neu gerendert.
  // Navigation und Werkzeugleisten bleiben gleich groß; das Seiten-Zoomen von Safari ist im Leser abgeschaltet.
  const pinch = useRef<{
    cx: number; // Inhaltspunkt unter den Fingern beim Start (ungezoomte Koordinaten)
    cy: number;
    ratio: number;
    vx: number; // aktuelle Bildschirmposition dieses Punkts (begrenzt, s. u.)
    vy: number;
    sx: number; // Bildschirmposition beim Start
    sy: number;
    pageW: number; // eine Seite (inkl. Abstand) beim Start – so weit darf während der Geste verschoben werden
    pageH: number;
    source: "touch" | "gesture" | "wheel";
  } | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const local = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return { vx: x - r.left, vy: y - r.top };
    };
    const begin = (x: number, y: number, source: "touch" | "gesture" | "wheel") => {
      const { vx, vy } = local(x, y);
      const cy = el.scrollTop + vy;
      const { pages: ps, tops: ts, scale: sc } = geo.current;
      let i = 0;
      while (i + 1 < ps.length && ts[i + 1] <= cy) i++;
      const pageH = ps[i] ? ps[i].height * sc + GAP : el.clientHeight;
      const pageW = ps[i] ? ps[i].width * sc : el.clientWidth;
      if (source === "touch") {
        // Safari: ein schon laufendes Scrollen (erster Finger, Schwung) sofort anhalten – sonst bewegen sich Scrollen
        // und Zoomen gleichzeitig und die Seite springt
        const st = el.scrollTop;
        const sl = el.scrollLeft;
        el.style.overflow = "hidden";
        el.scrollTop = st;
        el.scrollLeft = sl;
      }
      pinch.current = { cx: el.scrollLeft + vx, cy: el.scrollTop + vy, ratio: 1, vx, vy, sx: vx, sy: vy, pageW, pageH, source };
      endPress();
      setPreview(null);
      setSelTool(null);
      if (contentRef.current) contentRef.current.style.transformOrigin = "0 0";
    };
    const update = (ratio: number, x: number, y: number) => {
      const pz = pinch.current;
      const c = contentRef.current;
      if (!pz || !c) return;
      const z = geo.current.zoom;
      pz.ratio = clampZoom(z * ratio) / z;
      // Verschieben mit zwei Fingern: höchstens eine Seite nach oben/unten (bzw. eine Seitenbreite zur Seite)
      const cur = local(x, y);
      const limH = pz.pageH * pz.ratio;
      const limW = pz.pageW * pz.ratio;
      pz.vx = pz.sx + Math.max(-limW, Math.min(limW, cur.vx - pz.sx));
      pz.vy = pz.sy + Math.max(-limH, Math.min(limH, cur.vy - pz.sy));
      // Inhaltspunkt unter dem Startpunkt der Geste bleibt unter den Fingern
      const tx = pz.vx + el.scrollLeft - pz.cx * pz.ratio;
      const ty = pz.vy + el.scrollTop - pz.cy * pz.ratio;
      c.style.transform = `translate(${tx}px, ${ty}px) scale(${pz.ratio})`;
    };
    const end = () => {
      const pz = pinch.current;
      if (!pz) return;
      pinch.current = null;
      el.style.overflow = "";
      const z = geo.current.zoom;
      const next = clampZoom(z * pz.ratio);
      if (Math.abs(next - z) < 0.005) {
        // nur verschoben, nicht gezoomt: Verschiebung übernehmen
        if (contentRef.current) contentRef.current.style.transform = "";
        el.scrollTop = pz.cy - pz.vy;
        el.scrollLeft = pz.cx - pz.vx;
        return;
      }
      anchor.current = anchorAt(pz.cx, pz.cy, pz.vx, pz.vy);
      setZoom(next);
    };

    // Finger (Apple Pencil zählt nicht – er zeichnet)
    const fingers = (e: TouchEvent) => Array.from(e.touches).filter((t) => (t as Touch & { touchType?: string }).touchType !== "stylus");
    const dist = (f: Touch[]) => Math.hypot(f[0].clientX - f[1].clientX, f[0].clientY - f[1].clientY);
    const mid = (f: Touch[]) => [(f[0].clientX + f[1].clientX) / 2, (f[0].clientY + f[1].clientY) / 2] as const;
    let startDist = 0;
    let touching = 0; // alle Berührungen inkl. Apple Pencil
    const onTouchStart = (e: TouchEvent) => {
      touching = e.touches.length;
      const f = fingers(e);
      if (f.length !== 2 || pinch.current) return;
      startDist = dist(f) || 1;
      begin(...mid(f), "touch");
    };
    const onTouchMove = (e: TouchEvent) => {
      if (pinch.current?.source !== "touch") return;
      const f = fingers(e);
      if (f.length < 2) return;
      if (e.cancelable) e.preventDefault(); // nicht gleichzeitig scrollen
      update(dist(f) / startDist, ...mid(f));
    };
    const onTouchEnd = (e: TouchEvent) => {
      touching = e.touches.length;
      if (pinch.current?.source === "touch" && fingers(e).length < 2) end();
    };

    // Safari: Gesten-Ereignisse (Trackpad am Mac/iPad, auf dem iPad parallel zu den Touch-Ereignissen).
    // preventDefault verhindert, dass Safari die ganze Seite vergrößert.
    type GestureEv = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEv;
      // nur fürs Trackpad – bei Berührungen (zwei Finger, Finger + Pencil) entscheiden die Touch-Ereignisse
      if (!pinch.current && !touching && el.contains(e.target as Node)) begin(g.clientX, g.clientY, "gesture");
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEv;
      if (pinch.current?.source === "gesture") update(g.scale, g.clientX, g.clientY);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      if (pinch.current?.source === "gesture") end();
    };

    // Chrome/Firefox: Trackpad-Pinch kommt als Mausrad mit Strg
    let wheelTimer: number | undefined;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (!pinch.current) begin(e.clientX, e.clientY, "wheel");
      if (pinch.current?.source !== "wheel") return;
      update(pinch.current.ratio * Math.exp(-e.deltaY / 120), e.clientX, e.clientY);
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(end, 180);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("gesturestart", onGestureStart);
    document.addEventListener("gesturechange", onGestureChange);
    document.addEventListener("gestureend", onGestureEnd);
    return () => {
      window.clearTimeout(wheelTimer);
      el.style.overflow = "";
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
      document.removeEventListener("gesturestart", onGestureStart);
      document.removeEventListener("gesturechange", onGestureChange);
      document.removeEventListener("gestureend", onGestureEnd);
    };
  }, [doc]);


  // ---------- Notiz-Zettel ----------
  // Das Notizfeld macht den Lesebereich schmaler (bzw. beim Schließen wieder breiter) und die Seiten kleiner/größer.
  // Die Notiz bleibt dabei auf derselben Bildschirmhöhe: Anker = ihre aktuelle Position auf dem Bildschirm.
  const anchorForNote = (n: StickyNote) => {
    const el = scrollRef.current;
    const g = geo.current;
    const p = g.pages[n.page - 1];
    if (!el || !p) return null;
    const cx = Math.max(0, (g.viewW - p.width * g.scale) / 2) + n.x * g.scale;
    const cy = g.tops[n.page - 1] + n.y * g.scale;
    const a = anchorAt(cx, cy, cx - el.scrollLeft, cy - el.scrollTop);
    return a && { ...a, sy: el.getBoundingClientRect().top + a.vy };
  };
  // Lage einer Notiz im Inhalt (aktuelles Layout) und ob sie gerade im Lesebereich zu sehen ist
  const noteSpot = (n: StickyNote) => {
    const el = scrollRef.current;
    const g = geo.current;
    const p = g.pages[n.page - 1];
    if (!el || !p) return null;
    const cx = Math.max(0, (g.viewW - p.width * g.scale) / 2) + n.x * g.scale;
    const cy = g.tops[n.page - 1] + n.y * g.scale;
    // Breite des bisherigen Layouts (bei einer Größenänderung ist clientWidth schon neu)
    const visible = cy >= el.scrollTop && cy <= el.scrollTop + el.clientHeight && cx >= el.scrollLeft && cx <= el.scrollLeft + g.viewW;
    return { cx, cy, visible };
  };
  // Anker = das, was gerade in der Mitte des Lesebereichs zu sehen ist
  const centerAnchor = () => {
    const el = scrollRef.current;
    if (!el) return null;
    const vx = el.clientWidth / 2;
    const vy = el.clientHeight / 2;
    const a = anchorAt(el.scrollLeft + vx, el.scrollTop + vy, vx, vy);
    return a && { ...a, sy: el.getBoundingClientRect().top + vy };
  };
  // Anker = die Mitte des Lesebereichs: Beim Öffnen/Schließen einer Notiz steht danach dieselbe Stelle in der Mitte –
  // die Ansicht wird nur kleiner (Notizfeld offen) bzw. wieder größer gezeichnet, nichts springt
  const midAnchor = () => {
    const el = scrollRef.current;
    if (!el) return null;
    // läuft noch ein Sprung, sofort ans Ziel – das ist die Ansicht, die gilt
    const ps = pendingScroll.current;
    pendingScroll.current = null;
    if (ps && nowMs() < ps.until && (Math.abs(el.scrollTop - ps.top) > 2 || Math.abs(el.scrollLeft - ps.left) > 2)) {
      el.scrollTo({ top: ps.top, left: ps.left, behavior: "auto" });
    }
    const vx = el.clientWidth / 2;
    const vy = el.clientHeight / 2;
    const a = anchorAt(el.scrollLeft + vx, el.scrollTop + vy, vx, vy);
    return a && { ...a, mid: true };
  };
  // Schließen: Wurde seit dem Öffnen nicht gescrollt/gezoomt, genau die Ansicht von vor dem Öffnen – sonst bleibt die
  // Mitte. (Am Anfang/Ende des Skripts lässt sich die Mitte nicht immer halten, weil nicht weiter gescrollt werden kann.)
  const closeAnchor = () => {
    const el = scrollRef.current;
    const v = noteView.current;
    noteView.current = null;
    const a = midAnchor();
    if (!a || !el || !v) return a;
    const untouched = Math.abs(el.scrollTop - v.top) <= 2 && Math.abs(el.scrollLeft - v.left) <= 2 && v.zoom === geo.current.zoom;
    return untouched ? { ...a, restore: v.from } : a;
  };
  // Beim Schließen/Ändern der Breite: Ist die Notiz zu sehen, bleibt sie stehen; sonst bleibt die Stelle, die man
  // gerade ansieht (man kann bei offener Notiz woanders im Skript lesen)
  const viewAnchor = (n: StickyNote | null | undefined) => (n && noteSpot(n)?.visible ? anchorForNote(n) : centerAnchor());

  const openNoteRef = useRef<StickyNote | null>(null);
  useLayoutEffect(() => {
    openNoteRef.current = notes.find((n) => n.id === openNoteId) ?? null;
    // ändert sich die Breite, während eine Notiz offen ist (Index-Leiste, iPad drehen), bleibt sie ebenfalls stehen
    beforeResize.current = (w) => {
      const n = openNoteRef.current;
      // ein schon gesetzter Anker (Öffnen/Schließen der Notiz) hat Vorrang
      if (n && w !== geo.current.viewW && !anchor.current) anchor.current = viewAnchor(n);
    };
  });
  // Öffnen: Ist die Notiz zu sehen, bleibt die Ansicht links dieselbe (nur passend verkleinert); sonst wird ihre
  // Seite so gezeigt, dass die Notiz im oberen Drittel steht
  const openNote = (n: StickyNote) => {
    const spot = noteSpot(n);
    const el = scrollRef.current;
    if (spot && el && !spot.visible) {
      const vy = el.clientHeight / 3;
      if (openNoteId === null) {
        const a = anchorAt(spot.cx, spot.cy, Math.min(spot.cx, el.clientWidth / 2), vy);
        anchor.current = a && { ...a, sy: el.getBoundingClientRect().top + vy };
      } else {
        smoothScroll(spot.cy - vy, spot.cx - el.clientWidth / 2);
      }
    } else if (openNoteId === null) {
      const a = midAnchor();
      anchor.current = a && el ? { ...a, from: { top: el.scrollTop, left: el.scrollLeft } } : a;
    }
    stopDrawing(); // entweder Notiz oder Stift
    setNotePlacing(false);
    setPreview(null);
    setSelTool(null);
    setOpenNoteId(n.id);
  };
  // switching: gleich öffnet sich eine andere Notiz – das Feld bleibt, also auch die Breite
  const noteFlush = useRef<(() => void) | null>(null);
  const closeNote = (switching = false) => {
    noteFlush.current?.(); // Getipptes sofort übernehmen – sonst gälte die Notiz unten als leer
    const open = notes.find((n) => n.id === openNoteId);
    if (open && !switching) anchor.current = closeAnchor(); // dieselbe Ansicht wie eben links, nur wieder größer
    // leere Notizen (nur angetippt, nichts geschrieben) nicht stehen lassen
    setNotes((list) => list.filter((n) => n.id !== openNoteId || n.color || !isEmptyNote(n.html)));
    setOpenNoteId(null);
  };
  const placeNote = (ev: React.MouseEvent) => {
    const pageEl = (ev.target as HTMLElement).closest(".page") as HTMLElement | null;
    if (!pageEl) return;
    const r = pageEl.getBoundingClientRect();
    placeNoteAt(Number(pageEl.dataset.page), (ev.clientX - r.left) / scale, (ev.clientY - r.top) / scale);
  };
  const placeNoteAt = (page: number, x: number, y: number) => {
    const now = nowMs();
    const n = alsEigene<StickyNote>({ id: uid(), page, x, y, html: "", createdAt: now, updatedAt: now });
    if (openNoteId) closeNote(true);
    setNotes((list) => [...list, n]);
    openNote(n);
  };
  const openNoteObj = notes.find((n) => n.id === openNoteId) ?? null;

  const toggleDraw = () => {
    if (inkTool) {
      setLastTool(inkTool);
      setInkTool(null);
    } else {
      // entweder Stift oder Notiz: eine offene Notiz schließt sich
      if (openNoteId) closeNote();
      setNotePlacing(false);
      setInkVisible(true);
      setInkTool(lastTool);
    }
  };
  useEffect(() => {
    toggleDrawRef.current = toggleDraw;
  });


  // ---------- Verbesserungsansicht ----------
  const compareItem = compareId ? compare.find((c) => c.id === compareId) ?? null : null;
  const compareOpen = !!compareItem;
  // alte PDF-Fassung nur laden, solange die Ansicht offen ist
  useEffect(() => {
    if (!compareOpen || !compareFile) return;
    let d: PDFDocumentProxy | null = null;
    let alive = true;
    void (async () => {
      const f = await get<{ id: string; blob: Blob }>("files", compareFile);
      if (!f || !alive) return;
      d = await loadPdf(f.blob);
      if (alive) setOldDoc(d);
    })();
    return () => {
      alive = false;
      setOldDoc(null);
      void closePdf(d);
    };
  }, [compareOpen, compareFile]);
  const notesRef = useRef(notes);
  useLayoutEffect(() => {
    notesRef.current = notes;
  });
  // aktueller Stand aller Notizen (auch noch nicht Gespeichertes) – für Aktionen, die direkt in die Datenbank schreiben
  const annNow = (): Annotations => ({ scriptId, pages: inkRef.current, orphans, notes: notesRef.current, compare, compareFile, updatedAt: nowMs() });
  const pasteToNew = (strokes: Stroke[], from: StickyNote[], dx: number, dy: number) => {
    if (!compareItem) return;
    const page = compareItem.newPage;
    const moved = strokes.map((st) => ({ ...st, id: uid(), points: st.points.map((v, i) => (i % 3 === 0 ? v + dx : i % 3 === 1 ? v + dy : v)) }));
    if (moved.length) pushOp({ type: "add", page, strokes: moved }); // mit Rückgängig
    if (from.length) {
      const now = nowMs();
      setNotes((list) => [...list, ...from.map((n) => ({ ...n, id: uid(), page, x: n.x + dx, y: Math.max(0, n.y + dy), updatedAt: now }))]);
    }
  };
  const nextPending = (list: CompareItem[], after?: number) => {
    const open = list.filter((c) => !c.done).sort((a, b) => a.newPage - b.newPage);
    return (after !== undefined ? open.find((c) => c.newPage > after) : undefined) ?? open[0] ?? null;
  };
  const compareDone = async () => {
    if (!compareItem) return;
    if (
      compareItem.strokes.length + compareItem.notes.length > 0 &&
      !confirm("Seite als geprüft markieren? Zeichnungen und Notizen der alten Fassung, die du nicht übernommen hast, entfallen dann.")
    ) {
      return;
    }
    if (openNoteId) closeNote();
    const next = await finishCompare(scriptId, annNow(), compareItem.id);
    setCompare(next.compare ?? []);
    setCompareFile(next.compareFile);
    const s2 = await get<Script>("scripts", scriptId);
    if (s2) setScript(s2);
    setCompareId(nextPending(next.compare ?? [], compareItem.newPage)?.id ?? null);
  };
  const compareKeepOld = async () => {
    if (!compareItem) return;
    if (openNoteId) {
      closeNote();
      await new Promise((r) => setTimeout(r, 50)); // Notiz-Stand übernehmen
    }
    try {
      await keepOldPage(scriptId, annNow(), compareItem.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      return;
    }
    const cur = currentPage;
    keepPos.current = { page: cur >= compareItem.newPage ? cur + 1 : cur, dy: (scrollRef.current?.scrollTop ?? 0) - tops[cur - 1] };
    const a = await get<Annotations>("annotations", scriptId);
    setCompareId(nextPending(a?.compare ?? [], compareItem.newPage + 1)?.id ?? null);
    setReloadKey((k) => k + 1); // Skript (eine Seite mehr) neu laden
  };

  // Lage der offenen Notiz im Inhalt; sichtbar = ihr Symbol liegt im Lesebereich
  const notePos = (n: StickyNote) => {
    const p = pages[n.page - 1];
    if (!p) return null;
    return { x: Math.max(0, (viewW - p.width * scale) / 2) + n.x * scale, y: tops[n.page - 1] + n.y * scale };
  };
  const openPos = openNoteObj ? notePos(openNoteObj) : null;
  const noteOffScreen =
    !!openPos && (openPos.y < scrollTop || openPos.y > scrollTop + viewH || openPos.x < scrollLeft || openPos.x > scrollLeft + viewW);
  const [pulseNote, setPulseNote] = useState<{ id: string; key: number } | null>(null);
  const locateNote = () => {
    if (!openNoteObj || !openPos || !scrollRef.current) return;
    const el = scrollRef.current;
    smoothScroll(openPos.y - el.clientHeight / 2, openPos.x - el.clientWidth / 2);
    setPulseNote((prev) => ({ id: openNoteObj.id, key: (prev?.key ?? 0) + 1 })); // kurz aufleuchten lassen
  };

  const onPagesClick = (ev: React.MouseEvent) => {
    if (notePlacing) {
      ev.preventDefault();
      placeNote(ev);
      return;
    }
    // Tipp ins Skript schließt eine offene Notiz (nicht beim Schreiben mit dem Pencil oder beim Markieren von Text)
    if (openNoteId && lastPointer.current !== "pen" && window.getSelection()?.isCollapsed !== false) {
      ev.preventDefault();
      closeNote();
      return;
    }
    const hit = linkFromEvent(ev.target);
    if (!hit) return;
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // Nutzer markiert gerade Text
    const pageEl = hit.span.closest(".page") as HTMLElement;
    const page = Number(pageEl.dataset.page);
    const y = (hit.span.getBoundingClientRect().top - pageEl.getBoundingClientRect().top) / scale;
    // nicht springen: die Definition erscheint als Ausschnitt in der Mitte (wie in der Vorschau beim Abfragen)
    void showLookup(hit.entry, { page, y }, hit.span.dataset.term, linkAt(hit.span));
    void noteLookup(hit.entry, hit.span.dataset.term);
  };

  // ---------- Nachgeschlagener Ausschnitt in der Mitte ----------
  const showLookup = async (entry: Entry, from: { page: number; y: number }, term?: string, link?: { page: number; start: number }) => {
    setPreview(null);
    setSelTool(null);
    const cached = lookupCache.current.get(entry.id);
    setLookup({ entry, from, term, link, url: cached });
    if (cached || !doc || !pages[entry.page - 1]) return;
    // gleicher Ausschnitt wie beim Abfragen (Quiz): Definitionsbereich, ohne handschriftliche Notizen
    const { url } = await renderRegion(doc, entry.page, definitionRegion(pages[entry.page - 1], entry.y, entry.yEnd), 1.8);
    lookupCache.current.set(entry.id, url);
    setLookup((l) => (l && l.entry.id === entry.id ? { ...l, url } : l));
  };

  const showPreview = async (entry: Entry, x: number, y: number, term?: string, span?: HTMLElement) => {
    setPreview({ entry, x, y, term, span, url: previewCache.current.get(entry.id) });
    if (previewCache.current.has(entry.id) || !doc) return;
    const region = definitionRegion(pages[entry.page - 1], entry.y, entry.yEnd);
    const { url } = await renderRegion(doc, entry.page, region, 1.8, inkRef.current[entry.page]);
    previewCache.current.set(entry.id, url);
    setPreview((p) => (p && p.entry.id === entry.id ? { ...p, url } : p));
  };

  const onPagesOver = (ev: React.MouseEvent) => {
    const hit = linkFromEvent(ev.target);
    window.clearTimeout(hoverTimer.current);
    if (!hit) return;
    const r = hit.span.getBoundingClientRect();
    hoverTimer.current = window.setTimeout(() => void showPreview(hit.entry, r.left, r.bottom, hit.span.dataset.term, hit.span), 350);
  };
  const onPagesOut = (ev: React.MouseEvent) => {
    if (linkFromEvent(ev.target)) window.clearTimeout(hoverTimer.current);
  };

  // ---------- Verknüpfungen eines Begriffs entfernen (mit Rückgängig) ----------
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = (msg: string, action: { label: string; run: () => void }) => {
    window.clearTimeout(toastTimer.current);
    setToast({ msg, action });
    toastTimer.current = window.setTimeout(() => setToast(null), 10000);
  };
  // Über indexRef, damit "Rückgängig" auch nach weiteren Änderungen auf dem aktuellen Stand aufsetzt
  const restoreTerms = async (terms: string[]) => {
    const cur = indexRef.current;
    if (!cur) return;
    const keys = new Set(terms.map((t) => t.toLowerCase()));
    await saveIndex({ ...cur, disabledTerms: cur.disabledTerms.filter((t) => !keys.has(t.toLowerCase())) });
  };
  const removeLinks = async (terms: string[]) => {
    const cur = indexRef.current;
    if (!cur || !terms.length) return;
    const have = new Set(cur.disabledTerms.map((t) => t.toLowerCase()));
    const added = terms.filter((t) => !have.has(t.toLowerCase()));
    await saveIndex({ ...cur, disabledTerms: [...cur.disabledTerms, ...added] });
    setPreview(null);
    const removed = new Set(terms.map((t) => t.toLowerCase()));
    setHistory((h) => h.map((x) => (x.term && removed.has(x.term.toLowerCase()) ? { ...x, term: undefined } : x)));
    showToast(`Verknüpfungen zu „${terms.join("“, „")}“ entfernt`, {
      label: "Rückgängig",
      run: () => {
        void restoreTerms(added);
        setToast(null);
      },
    });
  };

  const restoreLinks = async (keys: string[]) => {
    const cur = indexRef.current;
    if (!cur) return;
    await saveIndex({ ...cur, disabledLinks: (cur.disabledLinks ?? []).filter((k) => !keys.includes(k)) });
  };
  const removeOneLink = async (term: string, link: { page: number; start: number }) => {
    const cur = indexRef.current;
    if (!cur) return;
    const key = linkKey(link.page, link.start, term);
    await saveIndex({ ...cur, disabledLinks: [...new Set([...(cur.disabledLinks ?? []), key])] });
    setPreview(null);
    showToast(`Verknüpfung „${term}“ auf S. ${link.page} entfernt`, {
      label: "Rückgängig",
      run: () => {
        void restoreLinks([key]);
        setToast(null);
      },
    });
  };

  // ---------- Nachschlagen zählen → Abfragen ----------
  useEffect(() => {
    void weakLookups(scriptId).then((l) => setWeakCount(l.length));
  }, [scriptId]);
  const noteLookup = async (entry: Entry, term?: string) => {
    if (!term) return;
    const { before, after } = await recordLookup(scriptId, term, entry);
    setWeakCount((await weakLookups(scriptId)).length);
    // nur melden, wenn die Stufe steigt (1×, 2×, 4×, 7× …)
    const lv = level(after);
    if (lv > (before ? level(before) : 0)) {
      showToast(`„${term}“ ${after.sinceReview}× nachgeschlagen – Stufe: ${LEVELS[lv].label}.`, {
        label: "Jetzt abfragen",
        run: () => navigate(`/quiz/${scriptId}`),
      });
    }
  };

  // ---------- Auswahl ----------
  const onMouseUp = () => {
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || sel.isCollapsed || text.length < 2) {
        setSelTool(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const startPage = (range.startContainer.parentElement?.closest(".page") as HTMLElement | null)?.dataset.page;
      const endPage = (range.endContainer.parentElement?.closest(".page") as HTMLElement | null)?.dataset.page;
      setSelTool({
        x: rect.left + rect.width / 2,
        // Auf Touch-Geräten unter der Markierung, damit das iOS-Kontextmenü (Kopieren …) frei bleibt
        y: isTouch ? rect.bottom + 52 : rect.top,
        text,
        page: startPage && startPage === endPage ? Number(startPage) : null,
        rect,
      });
    }, 0);
  };

  // iPad: Markieren per langem Druck löst kein mouseup aus → auf selectionchange reagieren
  useEffect(() => {
    if (!isTouch) return;
    let t: number | undefined;
    const onChange = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && scrollRef.current?.contains(sel.anchorNode)) onMouseUp();
      }, 400);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("selectionchange", onChange);
    };
  });

  // ---------- Manuelle Definition ----------
  const addManualEntry = async (kind: EntryKind, number: string, terms: string[], page: number, y: number) => {
    if (!index) return;
    const p = pages[page - 1];
    const below = entries.find((e) => e.page === page && e.y > y + 10);
    const entry: Entry = {
      id: uid(),
      kind,
      number: number || undefined,
      terms,
      page,
      y: Math.max(0, y - 6),
      yEnd: below ? below.y : Math.min(p.height, y + 160),
      source: "manual",
      text: textInRect(p, { x: 0, y: y - 6, w: p.width, h: 200 }),
    };
    await saveIndex({ ...index, entries: sortEntries([...index.entries, entry]) });
  };

  // Anpinnen: Begriff an eine frühere Definition hängen bzw. dort eine Definitionsstelle anlegen
  const linkTermToEntry = async (entryId: string, term: string) => {
    if (!index || !term) return;
    const key = term.toLowerCase();
    await saveIndex({
      ...index,
      disabledTerms: index.disabledTerms.filter((t) => t.toLowerCase() !== key),
      entries: index.entries.map((e) =>
        e.id === entryId && !e.terms.some((t) => t.toLowerCase() === key)
          ? // als "manuell" markieren, sonst ginge der Begriff bei einer Neuanalyse verloren
            { ...e, terms: [...e.terms, term], source: e.source === "auto" ? "manual" : e.source }
          : e,
      ),
    });
  };
  const createDefinitionAt = async (c: DefCandidate, term: string) => {
    if (!index || !term) return;
    const entry: Entry = {
      id: uid(),
      kind: "Definition",
      terms: [term],
      page: c.page,
      y: Math.max(0, c.y - 4),
      yEnd: c.y + c.h * 1.4,
      source: "manual",
      hint: c.reasons.includes("fett") ? "fett" : c.reasons.includes("kursiv") ? "kursiv" : undefined,
      text: c.context,
    };
    const key = term.toLowerCase();
    await saveIndex({
      ...index,
      disabledTerms: index.disabledTerms.filter((t) => t.toLowerCase() !== key),
      entries: sortEntries([...index.entries, entry]),
    });
  };

  const lasso = inkTool?.mode === "lasso"; // Lasso ist ein Werkzeug der Stift-Leiste
  const hiddenStrokes = useMemo(
    () => (lassoHide ? (ink[lassoHide.page] ?? NO_STROKES).filter((x) => !lassoHide.ids.has(x.id)) : NO_STROKES),
    [ink, lassoHide],
  );
  // Seiten, auf denen das Lasso auswählt: in der Verbesserungsansicht die alte (nur kopieren) und die neue Seite,
  // sonst alle gerade gezeigten Seiten des Skripts
  const lassoTargets = (): LassoTarget[] => {
    const wrap = wrapRef.current;
    if (!wrap) return [];
    if (compareItem) {
      const oldEl = wrap.querySelector<HTMLElement>(".compare-old-page");
      const newEl = wrap.querySelector<HTMLElement>(".compare-new .page");
      const np = pages[compareItem.newPage - 1];
      return [
        ...(oldEl ? [{ id: "old", page: compareItem.oldPage, el: oldEl, width: compareItem.oldText.width, strokes: compareItem.strokes, notes: compareItem.notes, readOnly: true }] : []),
        ...(newEl && np ? [{ id: "new", page: compareItem.newPage, el: newEl, width: np.width, strokes: teile(ink[compareItem.newPage] ?? NO_STROKES).own }] : []),
      ];
    }
    const out: LassoTarget[] = [];
    for (const el of scrollRef.current?.querySelectorAll<HTMLElement>(".page[data-page]") ?? []) {
      const n = Number(el.dataset.page);
      const p = pages[n - 1];
      if (p) out.push({ id: "p" + n, page: n, el, width: p.width, strokes: teile(ink[n] ?? NO_STROKES).own });
    }
    return out;
  };
  const onLassoMove = (from: LassoTarget, to: LassoTarget, before: Stroke[], after: Stroke[], copiedNotes: StickyNote[]) => {
    if (from.readOnly) {
      // von der alten Seite kopiert
      if (after.length) pushOp({ type: "add", page: to.page, strokes: after });
      if (copiedNotes.length) {
        const now = nowMs();
        setNotes((list) => [...list, ...copiedNotes.map((n) => ({ ...n, page: to.page, y: Math.max(0, n.y), updatedAt: now }))]);
      }
      return;
    }
    if (after.length) pushOp({ type: "move", from: from.page, to: to.page, before, after });
  };
  const onLassoDelete = (from: LassoTarget, ids: string[]) => {
    const removed = (ink[from.page] ?? []).filter((x) => ids.includes(x.id));
    if (removed.length) pushOp({ type: "erase", page: from.page, strokes: removed });
  };

  const startSnip = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (snip) {
      setSnip(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setPreview(null);
    setSelTool(null);
    setSnipDrag(null);
    setSnip({ area: { left: r.left, top: r.top, width: r.width, height: r.height } });
  };

  // Bild erzeugen und sofort in die Zwischenablage legen – das muss im selben Tipp passieren (Safari)
  const finishSnip = () => {
    const d = snipDrag;
    if (snipDone.current || !d || !doc || !scrollRef.current) return;
    snipDone.current = true;
    setSnipDrag(null);
    setSnip(null);
    const rect = { left: Math.min(d.x0, d.x1), top: Math.min(d.y0, d.y1), right: Math.max(d.x0, d.x1), bottom: Math.max(d.y0, d.y1) };
    if (rect.right - rect.left < 8 || rect.bottom - rect.top < 8) return; // nur getippt
    const pageEls = Array.from(scrollRef.current.querySelectorAll<HTMLElement>(".page"));
    const blob = snipImage(doc, pageEls, rect, scale, inkVisible ? ink : null);
    const copied = copyImage(blob);
    setSnipResult({});
    blob.then(
      async (b) => {
        const ok = await copied;
        setSnipResult({ blob: b, url: URL.createObjectURL(b), copied: ok });
      },
      (e) => setSnipResult({ error: e instanceof Error ? e.message : String(e) }),
    );
  };
  const closeSnipResult = () => {
    if (snipResult?.url) URL.revokeObjectURL(snipResult.url);
    setSnipResult(null);
  };
  const snipFileName = () => `${script?.title ?? "Skript"} – Ausschnitt S. ${currentPage}.png`;

  // ---------- Rendern ----------
  if (error) {
    return (
      <div className="page-wrap">
        <p className="error">{error}</p>
        <a href="#/">Zurück zur Übersicht</a>
      </div>
    );
  }

  const visibleFrom = scrollTop - RENDER_MARGIN;
  const visibleTo = scrollTop + viewH + RENDER_MARGIN;
  const lastHistory = history[history.length - 1];

  return (
    <div className="reader">
      <div className="reader-bar">
        <button className="btn ghost icon-only home-btn" onClick={() => navigate("/")} title="Zurück zum Startbildschirm" aria-label="Zum Startbildschirm">
          <Icon name="home" size={22} />
        </button>
        <button
          className={"btn ghost icon-only" + (leftOpen ? " active" : "")}
          onClick={() => setLeftOpen((o) => !o)}
          title="Index: Definitionen und Sätze"
          aria-label="Index"
        >
          <Icon name="list" />
        </button>
        <span className="title" title={script?.title}>{script?.title ?? "…"}</span>
        <span className="muted small">
          S.{" "}
          <input
            className="input"
            style={{ width: 56, padding: "2px 6px", display: "inline-block" }}
            value={pageInput ?? currentPage}
            onFocus={() => setPageInput(String(currentPage))}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={() => setPageInput(null)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const n = Number(pageInput);
              if (n >= 1 && n <= pages.length) jumpToPage(n);
              (e.target as HTMLInputElement).blur();
            }}
          />{" "}
          / {pages.length}
        </span>
        {wimaAn && nutzer.length > 0 && (
          <span className="wima-sicht" title="Wessen Notizen zu sehen sind – bearbeiten lassen sich nur die eigenen">
            <span className="muted small">Notizen:</span>
            {nutzer.map((u) => (
              <button
                key={u}
                className={"wima-chip" + (sicht.includes(u) ? " on" : "")}
                aria-pressed={sicht.includes(u)}
                onClick={() => setSichtbar(wimaItem!, sicht.includes(u) ? sicht.filter((x) => x !== u) : [...sicht, u])}
              >
                {u}
              </button>
            ))}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <input
          className="input"
          style={{ width: 170 }}
          placeholder="Im Skript suchen …"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSearchPos(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") jumpToHit(e.shiftKey);
          }}
          title="Enter: nächste Fundstelle, Shift+Enter: vorige"
        />
        {searchRe && (
          <span className="small muted search-count">
            {searchPos >= 0 && searchPos < searchHits.length ? `${searchPos + 1}/${searchHits.length}` : `${searchHits.length} Treffer`}
            {searchPages > 1 ? ` · ${searchPages} S.` : ""}
          </span>
        )}
        {/* Ist eine Notiz offen, steht hier ihre Kopfzeile (Farbe, Marker, Stift, …) – mehr Platz zum Zeichnen */}
        {openNoteObj ? (
          <div className="note-head-slot" ref={setNoteHeadSlot} />
        ) : (
          <>
          <button className="btn ghost icon-only" onClick={() => changeZoom(zoom / 1.15)} title="Verkleinern (−)" aria-label="Verkleinern">
            <Icon name="minus" />
          </button>
          <span className="small muted" style={{ width: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
          <button className="btn ghost icon-only" onClick={() => changeZoom(zoom * 1.15)} title="Vergrößern (+)" aria-label="Vergrößern">
            <Icon name="plus" />
          </button>
          <button
            className={"btn ghost icon-only" + (showLinks ? " active" : "")}
            onClick={() => setShowLinks((s) => !s)}
            title="Verknüpfungen ein/aus"
            aria-label="Verknüpfungen ein/aus"
          >
            <Icon name="link" />
          </button>
          {/* Lesemodus: blendet die handschriftlichen Notizen aus, um nur das Skript zu lesen */}
          {!inkTool && (
            <button
              className={"btn ghost icon-only" + (!inkVisible ? " active" : "")}
              onClick={() => setInkVisible((v) => !v)}
              title={
                inkVisible
                  ? `Lesemodus – Notizen ausblenden${inkCount(ink) ? ` (${inkCount(ink)} Striche)` : ""}`
                  : "Lesemodus beenden – Notizen wieder einblenden"
              }
              aria-label="Lesemodus"
              aria-pressed={!inkVisible}
            >
              <Icon name="book" />
            </button>
          )}
          <button
            className={"btn ghost icon-only" + (notePlacing ? " active" : "")}
            onClick={() => {
              setSnip(null);
              if (!notePlacing) stopDrawing();
              setNotePlacing((v) => !v);
            }}
            title="Notiz hinzufügen – danach auf die Stelle im Skript tippen"
            aria-label="Notiz hinzufügen"
            aria-pressed={notePlacing}
          >
            <Icon name="note" />
          </button>
          <button
            className={"btn ghost icon-only" + (snip ? " active" : "")}
            onClick={startSnip}
            title="Ausschnitt als Bild – Bereich aufziehen, das Bild landet in der Zwischenablage"
            aria-label="Ausschnitt"
          >
            <Icon name="scissors" />
          </button>
          {orphans.length > 0 && (
            <button
              className="btn ghost icon-only"
              onClick={() => setShowOrphans(true)}
              title={`Notizen ohne Seite (${orphans.length}) – nach einer neuen Version keiner Seite zugeordnet`}
              aria-label="Notizen ohne Seite"
            >
              <Icon name="inbox" />
              <span className="count">{orphans.length}</span>
            </button>
          )}
          <button
            className={"btn ghost icon-only" + (inkTool ? " active" : "")}
            onClick={toggleDraw}
            title="Mit Stift / Apple Pencil Notizen schreiben (Taste P)"
            aria-label="Stift"
            aria-pressed={!!inkTool}
          >
            <Icon name="pencil" />
          </button>
          <button
            className="btn ghost icon-only"
            onClick={() => navigate(`/quiz/${scriptId}`)}
            title={`Abfragen – Definitionen, die du oft nachschlägst oder nicht gewusst hast${weakCount ? ` (${weakCount})` : ""}`}
            aria-label="Abfragen"
          >
            <Icon name="bulb" />
            {weakCount > 0 && <span className="count">{weakCount}</span>}
          </button>
          <button
            className="btn ghost icon-only"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setExportMenu({ x: r.left + r.width / 2, y: r.bottom + 6 });
            }}
            disabled={!!exporting || !doc}
            title={exporting ?? "Skript als PDF exportieren – mit oder ohne Notizen"}
            aria-label="Als PDF exportieren"
          >
            <Icon name={exporting ? "clock" : "download"} />
          </button>
          </>
        )}
      </div>

      {inkTool && (
        <InkToolbar
          tool={inkTool}
          setTool={setInkTool}
          canUndo={undoStack.current.length > 0}
          canRedo={redoStack.current.length > 0}
          onUndo={undo}
          onRedo={redo}
        />
      )}
      {changes && !changes.dismissed && (
        <div className="version-banner" role="status">
          <span className="with-icon"><Icon name="file" size={16} /> Neue Version {changes.version} vom {new Date(changes.at).toLocaleDateString("de-DE")}</span>
          {changes.newPages.length > 0 && (
            <button onClick={() => jumpToPage(nextAfter(changes.newPages))}>
              {changes.newPages.length} neue {changes.newPages.length === 1 ? "Seite" : "Seiten"} ({pageRanges(changes.newPages)}) <Icon name="jump" size={14} />
            </button>
          )}
          {pendingCompare.length > 0 && (
            <button onClick={() => setCompareId(pendingCompare[0].id)}>
              <Icon name="alert" size={14} /> {pendingCompare.length} geänderte {pendingCompare.length === 1 ? "Seite" : "Seiten"} mit Notizen vergleichen{" "}
              <Icon name="jump" size={14} />
            </button>
          )}
          {orphans.length > 0 && (
            <button onClick={() => setShowOrphans(true)}><Icon name="inbox" size={14} /> Notizen ohne Seite ({orphans.length})</button>
          )}
          <button className="close" onClick={() => updateChanges({ dismissed: true })} title="Hinweis schließen" aria-label="Hinweis schließen"><Icon name="x" size={16} /></button>
        </div>
      )}
      {upgrading && <div className="upgrade-banner with-icon"><Icon name="clock" size={16} /> {upgrading} (einmalig, für die verbesserte Erkennung von Definitionen und Fachbegriffen)</div>}
      <div className="reader-body">
        {leftOpen && index && (
          <aside className="side-left">
            <IndexPanel
              index={index}
              currentPage={currentPage}
              onJump={(e) => jumpTo(e)}
              onSave={saveIndex}
              onRemoveLinks={(terms) => void removeLinks(terms)}
              onRestoreTerm={(t) => void restoreTerms([t])}
              onRestoreLink={(k) => void restoreLinks([k])}
              onClose={() => window.innerWidth <= 900 && setLeftOpen(false)}
            />
          </aside>
        )}

        <div className="pages-wrap" ref={setWrap}>
        <div
          ref={scrollRef}
          className={"pages" + (inkTool ? " drawing" : "") + (notePlacing ? " placing" : "") + (linkStyle === "deutlich" ? " links-strong" : "")}
          onScroll={(e) => {
            setScrollTop((e.target as HTMLElement).scrollTop);
            setScrollLeft((e.target as HTMLElement).scrollLeft);
            setSelTool(null);
          }}
          onClick={onPagesClick}
          onPointerDown={onPagesPointerDown}
          onPointerMove={onPagesPointerMove}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          onContextMenu={(ev) => {
            const hit = linkFromEvent(ev.target);
            if (!hit) return;
            ev.preventDefault();
            openLinkMenu(hit.span, hit.entry);
          }}
          onMouseOver={onPagesOver}
          onMouseOut={onPagesOut}
          onMouseUp={onMouseUp}
        >
          <div ref={contentRef} className="pages-content" style={{ height: tops[tops.length - 1] ?? 0, paddingTop: PAD, position: "relative" }}>
            {doc &&
              pages.map((p, i) => {
                const top = tops[i];
                const bottom = tops[i + 1];
                const render = bottom >= visibleFrom && top <= visibleTo;
                return (
                  <PdfPage
                    key={p.page}
                    doc={doc}
                    page={p}
                    scale={scale}
                    render={render}
                    linker={linker}
                    search={searchRe}
                    flash={flash && flash.page === p.page ? flash : null}
                    ink={{
                      strokes: teile(lassoHide?.page === p.page ? hiddenStrokes : (ink[p.page] ?? NO_STROKES)).own,
                      fixed: teile(ink[p.page] ?? NO_STROKES).fixed,
                      visible: inkVisible,
                      tool: inkTool,
                      onAdd: onInkAdd,
                      onErase: onInkErase,
                    }}
                  />
                );
              })}
            {doc &&
              changes &&
              pages.map((p, i) => {
                const isNew = newPages.has(p.page);
                const review = reviewPages.has(p.page);
                if (!isNew && !review) return null;
                const left = Math.max(0, (viewW - p.width * scale) / 2);
                return (
                  <div key={"flag" + p.page} className="page-flags" style={{ top: tops[i] + 8, left: left + 8, maxWidth: p.width * scale - 16 }}>
                    {isNew && (
                      <span className="page-flag new">
                        Neu in Version {changes.version}
                        <button
                          className="flag-close"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateChanges({ newPages: changes.newPages.filter((x) => x !== p.page) });
                          }}
                          title="Markierung entfernen"
                          aria-label={`Markierung „Neu“ auf Seite ${p.page} entfernen`}
                        >
                          <Icon name="x" size={12} />
                        </button>
                      </span>
                    )}
                    {review && (
                      <span className="page-flag review">
                        Inhalt geändert – deine Notizen stehen noch auf der alten Fassung
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const c = pendingCompare.find((x) => x.newPage === p.page);
                            if (c) setCompareId(c.id);
                          }}
                        >
                          <Icon name="alert" size={13} /> Vergleichen
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            {doc &&
              notes.map((n) => {
                const p = pages[n.page - 1];
                if (!p || !zeigt(n.von)) return null;
                const left = Math.max(0, (viewW - p.width * scale) / 2);
                // das Symbol wächst und schrumpft mit der Seite (Zoom, Notizfeld)
                const size = Math.round(Math.min(40, Math.max(12, 20 * scale)));
                return (
                  <button
                    key={n.id + (pulseNote?.id === n.id ? ":" + pulseNote.key : "")}
                    className={
                      "note-marker" +
                      (n.id === openNoteId ? " open" : "") +
                      (n.color && isDark(n.color) ? " dark" : "") +
                      (pulseNote?.id === n.id ? " pulse" : "")
                    }
                    style={{
                      left: left + n.x * scale - size / 2,
                      top: tops[n.page - 1] + n.y * scale - size / 2,
                      width: size,
                      height: size,
                      borderRadius: Math.max(3, size / 4),
                      ...(n.color ? { background: n.color, borderColor: n.color } : null),
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (n.id === openNoteId) closeNote();
                      else {
                        if (openNoteId) closeNote(true);
                        openNote(n);
                      }
                    }}
                    title={notePreview(n.html)}
                    aria-label={`Notiz: ${notePreview(n.html)}`}
                  >
                    <Icon name="note" size={Math.round(size * 0.62)} />
                  </button>
                );
              })}
          </div>
          {!doc && <p className="empty">Skript wird geladen …</p>}
        </div>
        {compareItem && doc && pages[compareItem.newPage - 1] && (
          <CompareView
            key={compareItem.id}
            item={compareItem}
            position={{ index: pendingCompare.findIndex((c) => c.id === compareItem.id), total: pendingCompare.length }}
            onPrev={() => {
              const i = pendingCompare.findIndex((c) => c.id === compareItem.id);
              if (i > 0) setCompareId(pendingCompare[i - 1].id);
            }}
            onNext={() => {
              const i = pendingCompare.findIndex((c) => c.id === compareItem.id);
              if (i + 1 < pendingCompare.length) setCompareId(pendingCompare[i + 1].id);
            }}
            oldDoc={oldDoc}
            doc={doc}
            newPage={pages[compareItem.newPage - 1]}
            newStrokes={lassoHide?.page === compareItem.newPage ? hiddenStrokes : (ink[compareItem.newPage] ?? NO_STROKES)}
            inkTool={inkTool}
            onInkAdd={onInkAdd}
            onInkErase={onInkErase}
            newNotes={notes.filter((n) => n.page === compareItem.newPage)}
            openNoteId={openNoteId}
            onOpenNote={(n) => {
              if (n.id === openNoteId) closeNote();
              else {
                if (openNoteId) closeNote(true);
                openNote(n);
              }
            }}
            notePlacing={notePlacing}
            onPlaceNote={placeNoteAt}
            onPaste={pasteToNew}
            onKeepOld={() => void compareKeepOld()}
            onDone={() => void compareDone()}
            onClose={() => setCompareId(null)}
          />
        )}
        {inkTool && <ToolDock tool={inkTool} setTool={setInkTool} open={dockSide} onOpen={setDockSide} />}
        </div>
        {notePlacing && (
          <div className="place-hint">
            <Icon name="note" size={16} /> Auf die Stelle tippen, an die die Notiz soll
            <button onClick={() => setNotePlacing(false)} aria-label="Abbrechen"><Icon name="x" size={16} /></button>
          </div>
        )}

        {lookup && (
          <div className="lookup-back" onClick={() => setLookup(null)}>
            <div className="lookup-card" role="dialog" aria-label={entryLabel(lookup.entry)} onClick={(e) => e.stopPropagation()}>
              <header>
                <strong>{entryLabel(lookup.entry)}</strong>
                <span className="row" style={{ gap: 2 }}>
                  <span className="muted small">S. {lookup.entry.page}</span>
                  <button
                    className="btn small"
                    onClick={() => {
                      const l = lookup;
                      setLookup(null);
                      jumpTo(l.entry, l.from, l.term, l.link);
                    }}
                    title="Zur Stelle im Skript springen"
                  >
                    <Icon name="jump" size={16} /> Zur Stelle
                  </button>
                  <button className="icon-btn" onClick={() => setLookup(null)} aria-label="Schließen">
                    <Icon name="x" size={18} />
                  </button>
                </span>
              </header>
              {lookup.url ? (
                <img src={lookup.url} alt={entryLabel(lookup.entry)} />
              ) : (
                <p className="empty">Lädt …</p>
              )}
            </div>
          </div>
        )}

        {openNoteObj && (
          <NotePanel
            key={openNoteObj.id}
            note={openNoteObj}
            headerTarget={noteHeadSlot}
            flushRef={noteFlush}
            onChange={(html) =>
              setNotes((list) => list.map((n) => (n.id === openNoteObj.id && n.html !== html ? { ...n, html, updatedAt: Date.now() } : n)))
            }
            offScreen={noteOffScreen}
            onLocate={locateNote}
            onColor={(color) =>
              setNotes((list) =>
                list.map((n) => (n.id === openNoteObj.id ? { ...n, color: color ?? undefined, updatedAt: Date.now() } : n)),
              )
            }
            onDelete={() => {
              anchor.current = viewAnchor(openNoteObj); // Feld schließt sich – angezeigte Stelle festhalten
              setNotes((list) => list.filter((n) => n.id !== openNoteObj.id));
              setOpenNoteId(null);
            }}
            onClose={() => closeNote()}
          />
        )}

        {history.length > 0 && (
          <>
            <div className="backbar">
              <button className="main-back" onClick={() => goBack()} title="Zurück (Alt+← oder B)">
                <Icon name="back" size={18} /> Zurück zu {lastHistory.label}
              </button>
              {history.length > 1 && (
                <>
                  <span className="sep" />
                  <button onClick={() => setShowTrail((s) => !s)} title="Alle Stationen">
                    {history.length} <Icon name="chevron" size={14} />
                  </button>
                </>
              )}
              {lastHistory.term && (
                <>
                  <span className="sep" />
                  <button
                    className="backbar-more"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      const entry = entries.find((x) => x.terms.some((t) => t.toLowerCase() === lastHistory.term!.toLowerCase()));
                      if (entry) setLinkMenu({ entry, term: lastHistory.term, link: lastHistory.link, x: r.left + r.width / 2, y: r.top - 8, openedAt: Date.now() });
                    }}
                    title={`Verknüpfung „${lastHistory.term}“ bearbeiten`}
                    aria-label="Verknüpfung bearbeiten"
                  >
                    <Icon name="more" />
                  </button>
                </>
              )}
              <span className="sep" />
              <button onClick={() => setHistory([])} title="Verlauf schließen" aria-label="Verlauf schließen"><Icon name="x" size={16} /></button>
            </div>
            {showTrail && (
              <div className="trail">
                {[...history].reverse().map((h, i) => (
                  <button key={i} onClick={() => goBack(i + 1)}>
                    <Icon name="back" size={16} /> {i > 0 && <span className="muted small">{i + 1} zurück · </span>}
                    {h.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.msg}</span>
          <button onClick={toast.action.run}>{toast.action.label}</button>
        </div>
      )}

      {preview && (
        <div
          className="preview"
          style={{
            left: Math.min(preview.x, window.innerWidth - Math.min(520, window.innerWidth - 24) - 12),
            top: preview.y + 340 > window.innerHeight ? Math.max(8, preview.y - 380) : preview.y + 6,
          }}
          onMouseLeave={() => setPreview(null)}
        >
          <header>
            <strong>{entryLabel(preview.entry)}</strong>
            <span className="row">
              <span className="muted">S. {preview.entry.page}</span>
              {preview.term && preview.span && (
                <button
                  className="icon-btn"
                  onClick={() => openLinkMenu(preview.span!, preview.entry)}
                  title="Verknüpfung entfernen …"
                  aria-label="Verknüpfung bearbeiten"
                >
                  <Icon name="more" />
                </button>
              )}
              <button
                className="btn small primary"
                onClick={() => {
                  jumpTo(preview.entry, undefined, preview.term, preview.span ? linkAt(preview.span) : undefined);
                  void noteLookup(preview.entry, preview.term);
                }}
              >
                Springen
              </button>
              <button className="icon-btn" onClick={() => setPreview(null)} aria-label="Schließen"><Icon name="x" size={18} /></button>
            </span>
          </header>
          <div className="img">
            {preview.url ? <img src={preview.url} alt={entryLabel(preview.entry)} /> : <p className="empty">Lädt …</p>}
          </div>
        </div>
      )}

      {selTool && (
        <div
          className="sel-toolbar"
          style={{ left: Math.max(8, Math.min(selTool.x - 170, window.innerWidth - 360)), top: Math.max(8, selTool.y - 44) }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {selTool.page && (
            <button
              onClick={() => {
                const pageEl = scrollRef.current?.querySelector(`.page[data-page="${selTool.page}"]`) as HTMLElement;
                const y = selTool.rect ? (selTool.rect.top - pageEl.getBoundingClientRect().top) / scale : 0;
                setPin({ text: selTool.text, page: selTool.page!, y });
                setSelTool(null);
              }}
              title="Begriff mit seiner Definition verknüpfen – automatisch suchen oder manuell"
            >
              <Icon name="pin" size={16} /> Anpinnen
            </button>
          )}
          <a
            className="sel-link"
            href={googleUrl(selTool.text)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setSelTool(null)}
          >
            <Icon name="search" size={16} /> Definition bei Google suchen
          </a>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(selTool.text);
              setSelTool(null);
            }}
          >
            Kopieren
          </button>
        </div>
      )}

      {exportMenu && (
        <>
          <div className="popup-back" onClick={() => setExportMenu(null)} />
          <div className="mini-popup" role="menu" style={{ left: Math.min(exportMenu.x, window.innerWidth - 130), top: exportMenu.y }}>
            <div className="title">Als PDF exportieren</div>
            <button onClick={() => void exportPdf(true)} title="Skript inkl. Notizen als PDF exportieren">
              <Icon name="pencil" size={18} /> Mit Notizen
            </button>
            <button onClick={() => void exportPdf(false)} title="Skript ohne Notizen als PDF exportieren">
              <Icon name="file" size={18} /> Ohne Notizen (Original)
            </button>
          </div>
        </>
      )}

      {linkMenu && (
        <>
          {/* Der Klick, den der Browser nach einem langen Drücken erzeugt, darf das Popup nicht gleich wieder schließen */}
          <div className="popup-back" onClick={() => Date.now() - linkMenu.openedAt > 500 && setLinkMenu(null)} />
          <div
            className="mini-popup"
            style={{
              left: Math.min(Math.max(linkMenu.x, 130), window.innerWidth - 130),
              top: linkMenu.y + 200 > window.innerHeight ? Math.max(8, linkMenu.y - 210) : linkMenu.y,
            }}
            role="menu"
          >
            <div className="title">
              {linkMenu.term ? `„${linkMenu.term}“ → ` : ""}
              {linkMenu.entry.kind === "Begriff" ? "erstes Vorkommen" : `${linkMenu.entry.kind}${linkMenu.entry.number ? " " + linkMenu.entry.number : ""}`}, S. {linkMenu.entry.page}
            </div>
            <button
              onClick={() => {
                const m = linkMenu;
                setLinkMenu(null);
                jumpTo(m.entry, undefined, m.term, m.link);
                void noteLookup(m.entry, m.term);
              }}
            >
              <Icon name="jump" size={18} /> Springen
            </button>
            {linkMenu.term && linkMenu.link && (
              <button
                onClick={() => {
                  void removeOneLink(linkMenu.term!, linkMenu.link!);
                  setLinkMenu(null);
                }}
              >
                <Icon name="x" size={18} /> Nur diese Verknüpfung entfernen
              </button>
            )}
            {linkMenu.term && (
              <button
                onClick={() => {
                  void removeLinks([linkMenu.term!]);
                  setLinkMenu(null);
                }}
              >
                <Icon name="unlink" size={18} /> Alle zu „{linkMenu.term}“ entfernen
              </button>
            )}
            {linkMenu.term && (
              <a className="item" href={googleUrl(linkMenu.term)} target="_blank" rel="noopener noreferrer" onClick={() => setLinkMenu(null)}>
                <Icon name="search" size={16} /> Definition bei Google suchen
              </a>
            )}
          </div>
        </>
      )}

      {showOrphans && (
        <div className="modal-back" onClick={() => setShowOrphans(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>Notizen ohne Seite</h3>
              <button className="icon-btn" onClick={() => setShowOrphans(false)} aria-label="Schließen"><Icon name="x" size={18} /></button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Diese Notizen standen auf Seiten einer früheren Version, die es in der neuen PDF so nicht mehr gibt. Du kannst sie
              auf die aktuelle Seite ({currentPage}) legen und dort weiterbearbeiten oder löschen.
            </p>
            {!orphans.length && <p className="empty">Keine mehr – alles zugeordnet.</p>}
            {orphans.map((o) => (
              <div key={o.id} className="orphan">
                <OrphanPreview o={o} />
                <div className="small">
                  <strong>Alte Seite {o.oldPage}</strong> <span className="muted">(Version {o.fromVersion})</span>
                  {o.snippet && <div className="muted orphan-snippet">„{o.snippet} …“</div>}
                </div>
                <div className="row">
                  <button className="btn small primary" onClick={() => placeOrphan(o, currentPage)}>Auf S. {currentPage} legen</button>
                  <button
                    className="btn small"
                    onClick={() => confirm("Diese Notizen endgültig löschen?") && setOrphans((l) => l.filter((x) => x.id !== o.id))}
                  >
                    Löschen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {snip && (
        <div
          className="snip-overlay"
          style={snip.area}
          onPointerDown={(e) => {
            e.preventDefault();
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* egal */
            }
            snipDone.current = false;
            setSnipDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
          }}
          onPointerMove={(e) => snipDrag && !snipDone.current && setSnipDrag({ ...snipDrag, x1: e.clientX, y1: e.clientY })}
          onPointerUp={(e) => {
            // Maus: hier fertig. Finger/Pencil: im touchend (zählt in Safari sicher als Tipp für die Zwischenablage)
            if (e.pointerType === "mouse") finishSnip();
            else window.setTimeout(finishSnip, 80);
          }}
          onTouchEnd={finishSnip}
          onWheel={(e) => scrollRef.current?.scrollBy({ top: e.deltaY, left: e.deltaX })}
        >
          {snipDrag ? (
            <div
              className="snip-rect"
              style={{
                left: Math.min(snipDrag.x0, snipDrag.x1) - snip.area.left,
                top: Math.min(snipDrag.y0, snipDrag.y1) - snip.area.top,
                width: Math.abs(snipDrag.x1 - snipDrag.x0),
                height: Math.abs(snipDrag.y1 - snipDrag.y0),
              }}
            />
          ) : (
            <div className="snip-hint">
              <Icon name="scissors" size={16} /> Bereich aufziehen – mit Finger, Pencil oder Maus
              <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setSnip(null)}>Abbrechen</button>
            </div>
          )}
        </div>
      )}

      {lasso && (
        <Lasso
          container={lassoArea}
          getTargets={lassoTargets}
          scrollEl={() => (compareItem ? wrapRef.current?.querySelector<HTMLElement>(".compare-scroll") : scrollRef.current) ?? null}
          onMove={onLassoMove}
          onDelete={onLassoDelete}
          onHide={setLassoHide}
        />
      )}

      {snipResult && (
        <div className="modal-back" onClick={closeSnipResult}>
          <div className="modal snip-modal" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>Ausschnitt</h3>
              <button className="icon-btn" onClick={closeSnipResult} aria-label="Schließen"><Icon name="x" size={18} /></button>
            </div>
            {snipResult.error ? (
              <p className="error">Bild konnte nicht erzeugt werden: {snipResult.error}</p>
            ) : !snipResult.url ? (
              <p className="empty">Bild wird erzeugt …</p>
            ) : (
              <>
                <p className={"small " + (snipResult.copied ? "ok-text" : "muted")} style={{ margin: 0 }} role="status">
                  {snipResult.copied
                    ? "In die Zwischenablage kopiert – du kannst es jetzt z. B. in GoodNotes, Notizen oder eine Nachricht einfügen."
                    : "Automatisch kopieren hat der Browser nicht erlaubt. Tippe auf „Bild kopieren“ – oder halte das Bild gedrückt und wähle „Kopieren“."}
                </p>
                {/* Bild bleibt lang-drückbar (Kontextmenü von iOS: Kopieren, Sichern, Teilen) */}
                <img className="snip-img" src={snipResult.url} alt="Ausschnitt aus dem Skript" />
                <div className="row">
                  <button
                    className="btn primary"
                    onClick={async () => {
                      const ok = await copyImage(Promise.resolve(snipResult.blob!));
                      setSnipResult((r) => (r ? { ...r, copied: ok } : r));
                      if (!ok) alert("Kopieren ist hier nicht möglich – halte das Bild gedrückt und wähle „Kopieren“.");
                    }}
                  >
                    <Icon name="copy" size={18} /> Bild kopieren
                  </button>
                  {isTouch && (
                    <button
                      className="btn"
                      onClick={() => {
                        const f = new File([snipResult.blob!], snipFileName(), { type: "image/png" });
                        if (navigator.canShare?.({ files: [f] })) void navigator.share({ files: [f] }).catch(() => undefined);
                        else alert("Teilen ist hier nicht möglich – nutze „Herunterladen“.");
                      }}
                    >
                      <Icon name="share" size={18} /> Teilen / Sichern
                    </button>
                  )}
                  <a className="btn" href={snipResult.url} download={snipFileName()}><Icon name="download" size={18} /> Herunterladen</a>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      closeSnipResult();
                      startSnip();
                    }}
                  >
                    <Icon name="scissors" size={18} /> Neuer Ausschnitt
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {pin && doc && (
        <PinDialog
          doc={doc}
          pages={pages}
          entries={entries}
          selection={pin.text}
          at={{ page: pin.page, y: pin.y }}
          onCancel={() => setPin(null)}
          onLinkEntry={async (id, term) => {
            await linkTermToEntry(id, term);
            setPin(null);
          }}
          onCreateAt={async (c, term) => {
            await createDefinitionAt(c, term);
            setPin(null);
          }}
          onDefineHere={async (kind, number, terms) => {
            await addManualEntry(kind, number, terms, pin.page, pin.y);
            setPin(null);
          }}
        />
      )}
    </div>
  );
}
