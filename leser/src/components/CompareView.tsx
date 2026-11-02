import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import PdfPage from "./PdfPage";
import type { InkToolState } from "./InkLayer";
import { drawStrokes, type CompareItem, type StickyNote, type Stroke } from "../lib/ink";
import { notePreview } from "../lib/notes";
import { isDark } from "../lib/colors";
import type { PDFDocumentProxy } from "../lib/pdf";
import type { PageText } from "../lib/db";

/** Zwischenablage der Verbesserungsansicht: ausgewählte Zeichnungen/Notizen der alten Seite (Seiteneinheiten). */
interface Clip {
  strokes: Stroke[];
  notes: StickyNote[];
  ox: number; // Bezugspunkt (linke obere Ecke der Auswahl)
  oy: number;
}

interface Props {
  item: CompareItem;
  position: { index: number; total: number };
  onPrev: () => void;
  onNext: () => void;
  oldDoc: PDFDocumentProxy | null;
  doc: PDFDocumentProxy;
  newPage: PageText;
  newStrokes: Stroke[];
  inkTool: InkToolState | null;
  onInkAdd: (page: number, s: Stroke) => void;
  onInkErase: (page: number, ids: string[]) => void;
  newNotes: StickyNote[];
  openNoteId: string | null;
  onOpenNote: (n: StickyNote) => void;
  notePlacing: boolean;
  onPlaceNote: (page: number, x: number, y: number) => void;
  onPaste: (strokes: Stroke[], notes: StickyNote[], dx: number, dy: number) => void;
  onKeepOld: () => void;
  onDone: () => void;
  onClose: () => void;
}

const GAP = 16;

/** Alte Fassung einer Seite: gerendert aus der vorigen PDF, mit ihren Zeichnungen und Notiz-Zettel. */
function OldPage({ doc, pageNo, text, scale, strokes, notes, onCopyNote }: {
  doc: PDFDocumentProxy | null;
  pageNo: number;
  text: PageText;
  scale: number;
  strokes: Stroke[];
  notes: StickyNote[];
  onCopyNote: (n: StickyNote) => void;
}) {
  const pdfCanvas = useRef<HTMLCanvasElement>(null);
  const inkCanvas = useRef<HTMLCanvasElement>(null);
  const w = text.width * scale;
  const h = text.height * scale;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  useEffect(() => {
    const c = pdfCanvas.current;
    if (!doc || !c) return;
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    let cancelled = false;
    void (async () => {
      const page = await doc.getPage(pageNo);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      c.width = Math.floor(viewport.width * dpr);
      c.height = Math.floor(viewport.height * dpr);
      task = page.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNo, scale, dpr]);

  useEffect(() => {
    const c = inkCanvas.current;
    if (!c) return;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStrokes(ctx, strokes, scale);
  }, [strokes, scale, w, h, dpr]);

  const size = Math.round(Math.min(40, Math.max(12, 20 * scale)));

  return (
    <div className="page compare-old-page" style={{ width: w, height: h }}>
      <canvas ref={pdfCanvas} />
      <canvas ref={inkCanvas} className="ink" />
      {notes.map((n) => (
        <button
          key={n.id}
          className={"note-marker" + (n.color && isDark(n.color) ? " dark" : "")}
          style={{
            left: n.x * scale - size / 2,
            top: n.y * scale - size / 2,
            width: size,
            height: size,
            borderRadius: Math.max(3, size / 4),
            ...(n.color ? { background: n.color, borderColor: n.color } : null),
          }}
          title={`${notePreview(n.html)} – antippen zum Kopieren`}
          aria-label={`Alte Notiz kopieren: ${notePreview(n.html)}`}
          onClick={() => onCopyNote(n)}
        >
          <Icon name="note" size={Math.round(size * 0.62)} />
        </button>
      ))}
    </div>
  );
}

/**
 * Verbesserungsansicht: links die alte Fassung einer geänderten Seite (mit den Notizen, die dort standen), rechts die
 * neue. Rechts wird wie gewohnt gezeichnet und es werden Notizen angelegt; Zeichnungen und Notizen der alten Seite
 * lassen sich auswählen, kopieren und rechts einfügen – oder alles auf einmal übernehmen. Die alte Seite kann auch
 * im Skript bleiben (vor der neuen).
 */
export default function CompareView(p: Props) {
  const { item } = p;
  const box = useRef<HTMLDivElement>(null);
  const [colW, setColW] = useState(400);
  const [clip, setClip] = useState<Clip | null>(null);
  const [hint, setHint] = useState("");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setColW(Math.max(120, (el.clientWidth - 3 * GAP) / 2)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const oldScale = colW / item.oldText.width;
  const newScale = colW / p.newPage.width;

  const onNewClick = (e: React.MouseEvent) => {
    const pageEl = (e.target as HTMLElement).closest(".page") as HTMLElement | null;
    if (!pageEl || (e.target as HTMLElement).closest(".note-marker")) return;
    const r = pageEl.getBoundingClientRect();
    const x = (e.clientX - r.left) / newScale;
    const y = (e.clientY - r.top) / newScale;
    if (clip) {
      p.onPaste(clip.strokes, clip.notes, x - clip.ox, y - clip.oy);
      setClip(null);
      setHint("Eingefügt.");
    } else if (p.notePlacing) p.onPlaceNote(item.newPage, x, y);
  };

  const size = Math.round(Math.min(40, Math.max(12, 20 * newScale)));
  const hasOld = item.strokes.length + item.notes.length > 0;

  return (
    <div className="compare" role="region" aria-label="Verbesserungsansicht">
      <div className="compare-bar">
        <span className="with-icon compare-title">
          <Icon name="alert" size={16} /> Verbesserungsansicht · S. {item.newPage}
        </span>
        {p.position.total > 1 && (
          <span className="row" style={{ gap: 2 }}>
            <button className="icon-btn" onClick={p.onPrev} disabled={p.position.index === 0} aria-label="Vorige geänderte Seite">
              <Icon name="back" size={18} />
            </button>
            <span className="small muted">
              {p.position.index + 1} / {p.position.total}
            </span>
            <button className="icon-btn" onClick={p.onNext} disabled={p.position.index + 1 >= p.position.total} aria-label="Nächste geänderte Seite">
              <Icon name="jump" size={18} />
            </button>
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          className="btn small"
          disabled={!clip}
          onClick={() => {
            if (!clip) return;
            p.onPaste(clip.strokes, clip.notes, 0, item.dy);
            setClip(null);
            setHint("An gleicher Stelle eingefügt.");
          }}
          title="Kopiertes an derselben Stelle der neuen Seite einfügen"
        >
          <Icon name="copy" size={16} /> An gleicher Stelle
        </button>
        <button className="btn small" disabled={!hasOld} onClick={() => p.onPaste(item.strokes, item.notes, 0, item.dy)} title="Alle Zeichnungen und Notizen der alten Seite auf die neue übernehmen">
          <Icon name="check" size={16} /> Alles übernehmen
        </button>
        <button className="btn small" onClick={p.onKeepOld} title="Die alte Seite (mit ihren Notizen) zusätzlich im Skript behalten – vor der neuen">
          <Icon name="file" size={16} /> Alte Seite behalten
        </button>
        <button className="btn small primary" onClick={p.onDone} title="Seite als geprüft markieren">
          <Icon name="check" size={16} /> Fertig
        </button>
        <button className="icon-btn" onClick={p.onClose} title="Verbesserungsansicht schließen" aria-label="Verbesserungsansicht schließen">
          <Icon name="x" size={18} />
        </button>
      </div>
      {hint && <div className="compare-hint" role="status">{hint}</div>}
      <div className="compare-scroll" ref={box}>
        <div className="compare-cols" style={{ gap: GAP, padding: GAP }}>
          <section className="compare-col" style={{ width: colW }}>
            <h4>Alte Fassung (S. {item.oldPage}) {hasOld ? "· mit deinen Notizen" : "· Notizen übernommen"}</h4>
            <OldPage
              doc={p.oldDoc}
              pageNo={item.oldPage}
              text={item.oldText}
              scale={oldScale}
              strokes={item.strokes}
              notes={item.notes}
              onCopyNote={(n) => {
                setClip({ strokes: [], notes: [n], ox: n.x, oy: n.y });
                setHint("Notiz kopiert – rechts auf die Stelle tippen, um einzufügen.");
              }}
            />
          </section>
          <section className={"compare-col compare-new" + (clip || p.notePlacing ? " pasting" : "")} style={{ width: colW }} onClick={onNewClick}>
            <h4>Neue Fassung (S. {item.newPage})</h4>
            <div style={{ position: "relative" }}>
              <PdfPage
                doc={p.doc}
                page={p.newPage}
                scale={newScale}
                render
                linker={null}
                search={null}
                flash={null}
                ink={{ strokes: p.newStrokes, visible: true, tool: p.inkTool, onAdd: p.onInkAdd, onErase: p.onInkErase }}
              />
              {p.newNotes.map((n) => (
                <button
                  key={n.id}
                  className={"note-marker" + (n.id === p.openNoteId ? " open" : "") + (n.color && isDark(n.color) ? " dark" : "")}
                  style={{
                    left: n.x * newScale - size / 2,
                    top: n.y * newScale - size / 2,
                    width: size,
                    height: size,
                    borderRadius: Math.max(3, size / 4),
                    ...(n.color ? { background: n.color, borderColor: n.color } : null),
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onOpenNote(n);
                  }}
                  title={notePreview(n.html)}
                  aria-label={`Notiz: ${notePreview(n.html)}`}
                >
                  <Icon name="note" size={Math.round(size * 0.62)} />
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
