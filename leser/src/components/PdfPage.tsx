import { memo, useEffect, useRef } from "react";
import { pdfjs, pageString, type PDFDocumentProxy } from "../lib/pdf";
import type { PageText } from "../lib/db";
import type { Linker, LinkRange } from "../lib/indexer";
import type { Stroke } from "../lib/ink";
import InkLayer, { type InkToolState } from "./InkLayer";

interface Props {
  doc: PDFDocumentProxy;
  page: PageText;
  scale: number;
  render: boolean;
  linker: Linker | null;
  search: RegExp | null;
  flash: { y: number; h: number; key: number } | null;
  ink: {
    strokes: Stroke[];
    visible: boolean;
    tool: InkToolState | null;
    onAdd: (page: number, s: Stroke) => void;
    onErase: (page: number, ids: string[]) => void;
  };
}

type Mark = { start: number; end: number; cls: string; data?: Record<string, string> };

/** Umschließt Zeichenbereiche (Offsets im Seitentext) in den Spans der Textebene. */
function applyMarks(divs: HTMLElement[], page: PageText, marks: Mark[]) {
  if (!marks.length) return;
  const { starts } = pageString(page);
  const perDiv = new Map<number, { a: number; b: number; m: Mark }[]>();
  for (const m of marks) {
    for (let i = 0; i < page.items.length; i++) {
      const s = starts[i];
      const e = s + page.items[i].s.length;
      if (e <= m.start) continue;
      if (s >= m.end) break;
      const a = Math.max(0, m.start - s);
      const b = Math.min(page.items[i].s.length, m.end - s);
      if (b > a) perDiv.set(i, [...(perDiv.get(i) ?? []), { a, b, m }]);
    }
  }
  for (const [i, segs] of perDiv) {
    const div = divs[i];
    if (!div || div.childNodes.length !== 1 || div.firstChild?.nodeType !== Node.TEXT_NODE) continue;
    const str = div.textContent ?? "";
    segs.sort((x, y) => x.a - y.a);
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const { a, b, m } of segs) {
      if (a < pos) continue;
      if (a > pos) frag.append(str.slice(pos, a));
      const span = document.createElement("span");
      span.className = m.cls;
      for (const [k, v] of Object.entries(m.data ?? {})) span.dataset[k] = v;
      span.textContent = str.slice(a, b);
      frag.append(span);
      pos = b;
    }
    if (pos < str.length) frag.append(str.slice(pos));
    div.replaceChildren(frag);
  }
}

function PdfPageImpl({ doc, page, scale, render, linker, search, flash, ink }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const w = page.width * scale;
  const h = page.height * scale;

  useEffect(() => {
    if (!render) return;
    let cancelled = false;
    // Elemente sofort festhalten: React löst Refs beim Ausblenden, bevor dieser Effekt aufgeräumt wird
    const canvas = canvasRef.current;
    const container = textRef.current;
    if (!canvas || !container) return;
    let renderTask: { cancel(): void; promise: Promise<unknown> } | null = null;
    let textLayer: InstanceType<typeof pdfjs.TextLayer> | null = null;

    (async () => {
      const p = await doc.getPage(page.page);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const viewport = p.getViewport({ scale });
      // Erst unsichtbar rendern, dann übertragen: Beim Zoomen bleibt so das alte (gestreckte) Bild stehen,
      // bis die scharfe Fassung fertig ist – statt kurz weiß zu blinken.
      const fresh = !canvas.width || canvas.width === 300; // noch leer (Standardgröße)
      const target = fresh ? canvas : document.createElement("canvas");
      target.width = Math.floor(viewport.width * dpr);
      target.height = Math.floor(viewport.height * dpr);
      renderTask = p.render({
        canvas: target,
        canvasContext: target.getContext("2d")!,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      try {
        await renderTask.promise;
      } catch {
        return; // abgebrochen
      }
      if (cancelled) return;
      if (target !== canvas) {
        canvas.width = target.width;
        canvas.height = target.height;
        canvas.getContext("2d")!.drawImage(target, 0, 0);
        target.width = target.height = 0; // Speicher sofort freigeben (wichtig auf dem iPad)
      }

      container.replaceChildren();
      const textContent = await p.getTextContent();
      if (cancelled) return;
      textLayer = new pdfjs.TextLayer({ textContentSource: textContent, container, viewport });
      await textLayer.render();
      if (cancelled) return;
      const end = document.createElement("div");
      end.className = "endOfContent";
      container.append(end);

      const { text } = pageString(page);
      const marks: Mark[] = [];
      if (linker) {
        for (const r of linker.link(page, text) as LinkRange[]) {
          marks.push({
            start: r.start,
            end: r.end,
            cls:
              "dl" +
              (/^(Satz|Lemma|Korollar|Theorem|Proposition|Bemerkung|Beispiel|Definition|Axiom|Notation) [\d.]+$/.test(r.label) ? " ref" : "") +
              (r.label.startsWith("Erstes Vorkommen") ? " first" : ""),
            data: { entry: r.entryId, label: r.label, start: String(r.start), ...(r.term ? { term: r.term } : {}) },
          });
        }
      }
      if (search) {
        for (const m of text.matchAll(search)) {
          const overlap = marks.some((x) => m.index! < x.end && m.index! + m[0].length > x.start);
          if (!overlap) marks.push({ start: m.index!, end: m.index! + m[0].length, cls: "hit" });
        }
      }
      applyMarks(textLayer.textDivs, page, marks);
    })().catch(() => {
      /* Rendern abgebrochen (Seite ausgeblendet oder Zoom geändert) */
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [doc, page, scale, render, linker, search]);

  return (
    <div
      className="page"
      data-page={page.page}
      style={{ width: w, height: h, ["--scale-factor" as string]: scale, ["--total-scale-factor" as string]: scale }}
    >
      {render && <canvas ref={canvasRef} />}
      {render && <div className="textLayer" ref={textRef} />}
      {render && (ink.visible || ink.tool) && (
        <InkLayer
          page={page.page}
          width={page.width}
          height={page.height}
          scale={scale}
          strokes={ink.strokes}
          tool={ink.tool}
          onAdd={ink.onAdd}
          onErase={ink.onErase}
        />
      )}
      {flash && (
        <div key={flash.key} className="flash" style={{ top: flash.y * scale, height: Math.max(24, flash.h * scale) }} />
      )}
      <span className="page-num">{page.page}</span>
    </div>
  );
}

// Das ink-Objekt entsteht bei jedem Rendern neu – deshalb feldweise vergleichen
export default memo(PdfPageImpl, (a, b) => {
  for (const k of ["doc", "page", "scale", "render", "linker", "search", "flash"] as const) if (a[k] !== b[k]) return false;
  const x = a.ink;
  const y = b.ink;
  return (
    x.strokes === y.strokes &&
    x.visible === y.visible &&
    x.tool === y.tool &&
    x.onAdd === y.onAdd &&
    x.onErase === y.onErase
  );
});
