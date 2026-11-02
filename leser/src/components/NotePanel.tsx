import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import ColorWheel from "./ColorWheel";
import { applyImageSizes, imageToDataUrl, imageWidth, MIN_IMAGE_W, sanitizeNoteHtml } from "../lib/notes";
import { isDark, loadNoteColors, loadNotePenColors, saveNoteColors, saveNotePenColors, type NotePenColors } from "../lib/colors";
import type { StickyNote } from "../lib/ink";
import type { InkToolState } from "./InkLayer";
import { applyInkOp, collapseInkBlocks, createInkBlockElement, INK_W, mountInkBlock, type InkOp } from "../lib/inkblock";

interface Props {
  note: StickyNote;
  onChange: (html: string) => void;
  onColor: (color: string | null) => void; // null = ohne Farbe
  offScreen: boolean; // Notiz-Symbol ist im Skript gerade nicht zu sehen
  onLocate: () => void; // zurück zur Stelle der Notiz scrollen
  onDelete: () => void;
  onClose: () => void;
  headerTarget?: HTMLElement | null; // Platz in der Leiste des Skripts für die Kopfzeile der Notiz (mehr Platz zum Zeichnen)
  flushRef?: { current: (() => void) | null }; // Reader: vor dem Schließen alles Ungespeicherte sofort sichern
}

/**
 * Seitenfeld rechts für einen Notiz-Zettel: freier Text mit Bildern und Zeichenfeldern (Handschrift mit dem
 * Apple Pencil) dazwischen. Bilder und Zeichenfelder sitzen im Textfluss (an der Schreibmarke eingefügt) und reichen
 * über die ganze Breite des Felds.
 */
export default function NotePanel({ note, onChange, onColor, offScreen, onLocate, onDelete, onClose, headerTarget, flushRef }: Props) {
  const [colorPop, setColorPop] = useState(false);
  const [wheel, setWheel] = useState(false);
  const [history, setHistory] = useState<string[]>(loadNoteColors);
  const updateHistory = (next: string[]) => {
    setHistory(next);
    saveNoteColors(next);
  };
  // Farbe wählen: an der Notiz speichern und in der Liste nach vorn holen (zuletzt verwendet zuerst)
  const pickColor = (c: string) => {
    onColor(c);
    updateHistory([c, ...history.filter((x) => x !== c)]);
    setColorPop(false);
  };
  const editor = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null); // Schreibmarke merken – die Dateiauswahl nimmt den Fokus weg
  const fileInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  const pending = useRef(false); // ungespeicherte Änderung (verzögertes Speichern läuft)
  const save = (immediate = false) => {
    window.clearTimeout(saveTimer.current);
    const run = () => {
      pending.current = false;
      if (editor.current) onChange(sanitizeNoteHtml(editor.current.innerHTML));
    };
    if (immediate) run();
    else {
      pending.current = true;
      saveTimer.current = window.setTimeout(run, 400);
    }
  };
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    if (flushRef) flushRef.current = () => save(true);
  });

  // ---------- Zeichenfelder ----------
  // nur Stift (mittlere Stärke) und Radierer; zwei Farben: Antippen wechselt (die schon gewählte Farbe antippen
  // ändert sie), Gedrückthalten ändert die Farbe
  const [pens, setPens] = useState<NotePenColors>(loadNotePenColors);
  const [inkTool, setInkTool] = useState<InkToolState>(() => ({ mode: "pen", color: pens.colors[pens.active], width: 1.6 }));
  const [penWheel, setPenWheel] = useState<0 | 1 | null>(null); // Farbkreis für Farbe 1/2
  const updatePens = (next: NotePenColors) => {
    setPens(next);
    saveNotePenColors(next);
    setInkTool({ mode: "pen", color: next.colors[next.active], width: 1.6 });
  };
  // Gedrückthalten einer Farbe → Farbkreis zum Ändern; danach kein Wechsel durch das Loslassen
  const pressTimer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const startPress = (i: 0 | 1) => {
    longPressed.current = false;
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setPenWheel(i);
    }, 500);
  };
  const cancelPress = () => window.clearTimeout(pressTimer.current);
  const setPenColor = (i: 0 | 1, c: string) => {
    const colors: [string, string] = [...pens.colors];
    colors[i] = c;
    updatePens({ colors, active: i });
  };
  const toolRef = useRef(inkTool);
  useEffect(() => {
    toolRef.current = inkTool;
  }, [inkTool]);
  // Zeichnen ein/aus (Stift-Symbol). Solange es an ist, behält das Zeichenfeld seinen Platz (höchstens eine halbe
  // Feldhöhe leer unter dem tiefsten Strich; Text darunter rückt so weit nach unten); beim Ausschalten endet es kurz
  // unter dem tiefsten Strich.
  const [drawing, setDrawing] = useState(false);
  const drawingRef = useRef(false);
  const cleanups = useRef(new Map<HTMLElement, () => void>());
  // Rückgängig/Wiederholen für Striche und Radieren in allen Zeichenfeldern der Notiz
  const undoStack = useRef<InkOp[]>([]);
  const redoStack = useRef<InkOp[]>([]);
  const [stacks, setStacks] = useState({ undo: 0, redo: 0 });
  const syncStacks = () => setStacks({ undo: undoStack.current.length, redo: redoStack.current.length });
  const undo = () => {
    const op = undoStack.current.pop();
    if (op && applyInkOp(op, true)) redoStack.current.push(op);
    syncStacks();
  };
  const redo = () => {
    const op = redoStack.current.pop();
    if (op && applyInkOp(op, false)) undoStack.current.push(op);
    syncStacks();
  };
  // Schreibmarke aus der Notiz nehmen → auf dem iPad verschwindet die Tastatur
  const hideKeyboard = () => {
    const el = editor.current;
    const sel = window.getSelection();
    if (el && sel?.anchorNode && el.contains(sel.anchorNode)) sel.removeAllRanges();
    if (el && document.activeElement && el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  };
  const drawingSince = useRef(0); // späte Auswahl-Ereignisse direkt nach dem Einschalten nicht als Textwechsel werten
  const startDrawing = () => {
    hideKeyboard(); // Zeichnen: nur das Zeichenfeld, keine Tastatur
    drawingSince.current = Date.now();
    if (!drawingRef.current) {
      drawingRef.current = true;
      setDrawing(true);
    }
  };
  const stopDrawing = () => {
    drawingRef.current = false;
    setDrawing(false);
    if (editor.current) collapseInkBlocks(editor.current); // Text/Bilder rücken wieder direkt unter die Striche
    save();
  };
  const mountBlock = (div: HTMLElement) => {
    cleanups.current.set(
      div,
      mountInkBlock(div, {
        tool: () => toolRef.current,
        onPenStart: startDrawing, // Pencil in einem vorhandenen Feld → Zeichnen geht automatisch an
        onOp: (op) => {
          undoStack.current.push(op);
          redoStack.current = [];
          syncStacks();
        },
        onRemove: hideKeyboard, // Löschen eines Felds öffnet nicht den Text-Modus
        onChange: () => {
          if (drawingRef.current && !editor.current?.querySelector(".ink-block")) stopDrawing(); // letztes Feld gelöscht
          else save();
        },
      }),
    );
  };
  useEffect(() => {
    const map = cleanups.current;
    return () => map.forEach((fn) => fn());
  }, []);
  // für den einmaligen Aufbau beim Öffnen (der Effekt darunter läuft nur einmal je Notiz)
  const blockApi = useRef({ mount: mountBlock });
  useLayoutEffect(() => {
    blockApi.current = { mount: mountBlock };
  });

  // Inhalt nur einmal setzen (je Notiz wird das Feld neu angelegt, siehe key im Reader). Danach ist das Feld
  // "unkontrolliert" – sonst würde die Schreibmarke bei jedem Speichern springen.
  // Beim Öffnen keine Schreibmarke (keine Tastatur): Text beginnt erst mit einem Tipp auf die Notiz,
  // ein Zeichenfeld über das Stift-Symbol.
  const [initial] = useState(() => ({ html: sanitizeNoteHtml(note.html) || "<div><br></div>" }));
  useEffect(() => {
    const el = editor.current;
    if (!el) return;
    el.innerHTML = initial.html;
    applyImageSizes(el);
    el.querySelectorAll<HTMLElement>("div[data-ink]").forEach((d) => blockApi.current.mount(d));
    // Wird die Notiz anders als über X geschlossen (z. B. Tipp ins Skript), Ungespeichertes noch sichern
    return () => {
      if (pending.current) onChangeRef.current(sanitizeNoteHtml(el.innerHTML));
    };
  }, [initial]);


  const rememberCaret = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && editor.current?.contains(sel.anchorNode)) {
      range.current = sel.getRangeAt(0).cloneRange();
      // Wechsel in den Text → Zeichnen beenden, Felder sofort verkleinern
      const inField = (sel.anchorNode as Node).parentElement?.closest(".ink-block");
      if (drawingRef.current && !inField && Date.now() - drawingSince.current > 300) stopDrawing();
    }
  };
  useEffect(() => {
    document.addEventListener("selectionchange", rememberCaret);
    return () => document.removeEventListener("selectionchange", rememberCaret);
  });

  /** Knoten an der Schreibmarke einfügen (bzw. am Ende) und die Marke dahinter setzen. */
  // keepCaret=false (Zeichenfeld): keine Schreibmarke danach, keine leere Textzeile darunter, Tastatur bleibt zu
  const insertAtCaret = (nodes: Node[], keepCaret = true) => {
    const el = editor.current;
    if (!el || !nodes.length) return;
    let r = range.current;
    if (!r || !el.contains(r.startContainer)) {
      r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
    }
    r.deleteContents();
    const frag = document.createDocumentFragment();
    frag.append(...nodes);
    const last = nodes[nodes.length - 1];
    r.insertNode(frag);
    if (!keepCaret) {
      range.current = null;
      hideKeyboard();
      save();
      return;
    }
    // nach einem Bild am Ende eine leere Zeile, damit man darunter weiterschreiben kann
    if ((last.nodeName === "IMG" || (last as HTMLElement).dataset?.ink !== undefined) && !last.nextSibling) {
      const line = document.createElement("div");
      line.append(document.createElement("br"));
      last.parentNode!.insertBefore(line, null);
    }
    const after = document.createRange();
    after.setStartAfter(last);
    after.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(after);
    range.current = after;
    save();
  };

  const insertDrawing = () => {
    // Starthöhe: die Hälfte des sichtbaren Notizfelds (in Einheiten der festen Feldbreite)
    const ed = editor.current;
    const half = ed && ed.clientWidth ? ((ed.clientHeight / 2) * INK_W) / ed.clientWidth : undefined;
    const div = createInkBlockElement(half);
    // leere Notiz: die leere Startzeile ersetzen, damit über dem Feld keine Textzeile steht
    if (ed && !ed.textContent?.trim() && !ed.querySelector("img, .ink-block")) ed.replaceChildren();
    insertAtCaret([div], false);
    mountBlock(div);
    startDrawing();
    if (toolRef.current.mode === "eraser") setInkTool({ ...toolRef.current, mode: "pen" });
  };

  // Marker: markierten Text hervorheben (bzw. eine Hervorhebung wieder entfernen)
  const highlight = () => {
    const el = editor.current;
    const sel = window.getSelection();
    if (!el || !sel || !sel.rangeCount || sel.isCollapsed || !el.contains(sel.anchorNode)) {
      alert("Erst Text in der Notiz markieren, dann den Marker antippen.");
      return;
    }
    const r = sel.getRangeAt(0);
    const markOf = (n: Node) => (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement)?.closest("mark");
    const unwrap = (m: Element) => m.replaceWith(...Array.from(m.childNodes));
    const m1 = markOf(r.startContainer);
    if (m1 && m1 === markOf(r.endContainer)) {
      unwrap(m1); // ganz in einer Hervorhebung → entfernen
    } else {
      const frag = r.cloneContents();
      if (frag.querySelector(".ink-block, [data-ink]")) {
        alert("Zeichenfelder lassen sich nicht markieren – bitte nur Text auswählen.");
        return;
      }
      const content = r.extractContents();
      content.querySelectorAll("mark").forEach(unwrap);
      const mark = document.createElement("mark");
      mark.append(content);
      r.insertNode(mark);
      sel.removeAllRanges();
    }
    save();
  };

  const insertImages = async (files: Blob[]) => {
    const imgs: HTMLImageElement[] = [];
    for (const f of files) {
      try {
        const img = document.createElement("img");
        img.src = await imageToDataUrl(f);
        img.alt = "";
        imgs.push(img);
      } catch {
        alert("Das Bild konnte nicht gelesen werden.");
      }
    }
    insertAtCaret(imgs);
  };

  // ---------- Bildgröße ----------
  // Bild antippen → Rahmen mit Griff unten rechts und kleiner Leiste. Ziehen am Griff verkleinert/vergrößert ohne
  // Verzerrung (Ecke oben links bleibt); verkleinerte Bilder stehen bündig am Textrand, daneben steht nie Text, der
  // Text darunter rückt nach. Rahmen, Griff und Leiste liegen außerhalb des Textfelds (keine Tastatur, keine Lupe).
  const asideRef = useRef<HTMLElement>(null);
  const [selImg, setSelImg] = useState<HTMLImageElement | null>(null);
  // Lage des ausgewählten Bilds relativ zum Notizfeld (gemessen beim Scrollen und bei jeder Größenänderung)
  const [imageBox, setImageBox] = useState<{ left: number; top: number; width: number; height: number; edTop: number } | null>(null);
  const resize = useRef<{ pointerId: number; x0: number; w0: number; col: number } | null>(null);
  useEffect(() => {
    if (!selImg) return;
    const ed = editor.current;
    const tick = () => {
      const host = asideRef.current;
      if (!host || !selImg.isConnected) return setImageBox(null);
      const a = host.getBoundingClientRect();
      const b = selImg.getBoundingClientRect();
      const e = ed?.getBoundingClientRect();
      setImageBox({ left: b.left - a.left, top: b.top - a.top, width: b.width, height: b.height, edTop: (e?.top ?? a.top) - a.top });
    };
    ed?.addEventListener("scroll", tick);
    window.addEventListener("resize", tick);
    const ro = new ResizeObserver(tick);
    ro.observe(selImg);
    return () => {
      ed?.removeEventListener("scroll", tick);
      window.removeEventListener("resize", tick);
      ro.disconnect();
    };
  }, [selImg]);
  // Breite der Textspalte (ohne Innenabstand des Felds)
  const textWidth = () => {
    const ed = editor.current;
    if (!ed) return 1;
    const cs = getComputedStyle(ed);
    return Math.max(1, ed.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  };
  /** Breite setzen: Anteil der Textbreite, null = volle Breite des Felds. */
  const setImageWidth = (img: HTMLImageElement, w: number | null) => {
    const v = w === null ? null : imageWidth(String(w));
    if (v) img.dataset.w = String(v);
    else delete img.dataset.w;
    applyImageSizes(img.parentElement ?? img); // die neue Größe meldet der ResizeObserver → Rahmen folgt
  };
  const selectImage = (img: HTMLImageElement | null) => {
    if (img) hideKeyboard();
    setSelImg(img);
  };
  const startResize = (e: React.PointerEvent<HTMLElement>) => {
    if (!selImg) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    resize.current = { pointerId: e.pointerId, x0: e.clientX, w0: selImg.getBoundingClientRect().width, col: textWidth() };
  };
  const moveResize = (e: React.PointerEvent<HTMLElement>) => {
    const r = resize.current;
    if (!r || !selImg || e.pointerId !== r.pointerId) return;
    const px = r.w0 + (e.clientX - r.x0);
    // bis zur Textbreite: verkleinert (am Textrand); darüber: wieder volle Breite des Felds
    setImageWidth(selImg, px >= r.col * 0.99 ? null : Math.max(MIN_IMAGE_W, px / r.col));
  };
  const endResize = (e: React.PointerEvent<HTMLElement>) => {
    if (!resize.current || e.pointerId !== resize.current.pointerId) return;
    resize.current = null;
    save();
  };

  // Kopfzeile der Notiz (Titel, Farbe, Marker, Stift, Bild, Löschen, Schließen) – sitzt in der Leiste des Skripts
  const head = (
    <header
      style={note.color ? { background: note.color, color: isDark(note.color) ? "#fff" : "#1d1c19" } : undefined}
      className={"note-head" + (note.color ? " colored" + (isDark(note.color) ? " dark" : "") : "")}
    >
      <span className="with-icon">
        <Icon name="note" /> Notiz · S. {note.page}
        {/* nur, wenn man im Skript von der Notiz weggescrollt hat */}
        {offScreen && (
          <button className="icon-btn note-locate" onClick={onLocate} title="Zur Stelle der Notiz im Skript" aria-label="Zur Stelle der Notiz">
            <Icon name="locate" />
          </button>
        )}
      </span>
      <span className="row" style={{ gap: 2 }}>
        <button
          className={"icon-btn" + (colorPop ? " on" : "")}
          title="Farbe der Notiz"
          aria-label="Farbe der Notiz"
          aria-expanded={colorPop}
          onClick={() => setColorPop((v) => !v)}
        >
          <Icon name="palette" />
        </button>
        <button
          className="icon-btn"
          title="Marker – markierten Text hervorheben (nochmal: entfernen)"
          aria-label="Text hervorheben"
          onPointerDown={(e) => e.preventDefault()} // Textauswahl nicht verlieren
          onClick={highlight}
        >
          <Icon name="highlighter" />
        </button>
        <button
          className={"icon-btn" + (drawing ? " on" : "")}
          title={
            drawing
              ? "Zeichnen beenden – das Feld endet dann kurz unter dem letzten Strich"
              : "Zeichenfeld einfügen – mit dem Apple Pencil schreiben (an der Schreibmarke)"
          }
          aria-label={drawing ? "Zeichnen beenden" : "Zeichenfeld einfügen"}
          aria-pressed={drawing}
          onPointerDown={rememberCaret}
          onClick={() => (drawing ? stopDrawing() : insertDrawing())}
        >
          <Icon name="pencil" />
        </button>
        <button
          className="icon-btn"
          title="Bild einfügen (an der Schreibmarke)"
          aria-label="Bild einfügen"
          onPointerDown={rememberCaret}
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="image" />
        </button>
        <button
          className="icon-btn"
          title="Notiz löschen"
          aria-label="Notiz löschen"
          onClick={() => confirm("Diese Notiz löschen?") && onDelete()}
        >
          <Icon name="trash" />
        </button>
        <button
          className="icon-btn"
          title="Schließen"
          aria-label="Notiz schließen"
          onClick={() => {
            if (drawingRef.current) stopDrawing();
            save(true);
            onClose();
          }}
        >
          <Icon name="x" />
        </button>
      </span>
    </header>
  );

  return (
    <aside className="side-note" aria-label="Notiz" ref={asideRef}>
      {headerTarget ? createPortal(head, headerTarget) : head}
      {colorPop && (
        <>
          <div className="popup-back" onClick={() => setColorPop(false)} />
          <div className="note-color-pop" role="dialog" aria-label="Farbe der Notiz">
            <div className="title">Farbe der Notiz</div>
            {history.length ? (
              <div className="note-swatches">
                {history.map((c) => (
                  <span key={c} className="note-swatch-wrap">
                    <button
                      className={"note-swatch" + (note.color === c ? " on" : "")}
                      style={{ background: c }}
                      onClick={() => pickColor(c)}
                      title={c.toUpperCase()}
                      aria-label={`Farbe ${c}`}
                    />
                    <button
                      className="note-swatch-del"
                      onClick={() => updateHistory(history.filter((x) => x !== c))}
                      title="Aus der Liste entfernen"
                      aria-label={`Farbe ${c} aus der Liste entfernen`}
                    >
                      <Icon name="x" size={10} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <div className="small muted">Noch keine Farben – mit „Neue Farbe“ hinzufügen.</div>
            )}
            <div className="row" style={{ gap: 6 }}>
              <button className="btn small" onClick={() => setWheel(true)}>
                <Icon name="plus" size={16} /> Neue Farbe
              </button>
              <button
                className="btn small"
                disabled={!note.color}
                onClick={() => {
                  onColor(null);
                  setColorPop(false);
                }}
              >
                <Icon name="x" size={16} /> Ohne Farbe
              </button>
            </div>
          </div>
        </>
      )}
      {wheel && (
        <ColorWheel
          initial={note.color ?? history[0] ?? "#ffe27a"}
          onCancel={() => setWheel(false)}
          onAdd={(hex) => {
            setWheel(false);
            pickColor(hex);
          }}
        />
      )}
      {/* Werkzeuge für die Zeichenfelder, solange das Zeichnen eingeschaltet ist: eine Zeile – Stift, Radierer, Farbe,
          Rückgängig, Wiederholen */}
      {drawing && (
        <div className="note-ink-bar" role="toolbar" aria-label="Zeichenwerkzeuge">
          <button
            className={inkTool.mode === "pen" ? "on" : ""}
            onClick={() => setInkTool({ ...inkTool, mode: "pen" })}
            title="Stift"
            aria-label="Stift"
          >
            <Icon name="pencil" />
          </button>
          <button
            className={inkTool.mode === "eraser" ? "on" : ""}
            onClick={() => setInkTool({ ...inkTool, mode: "eraser" })}
            title="Radierer (löscht ganze Striche)"
            aria-label="Radierer"
          >
            <Icon name="eraser" />
          </button>
          {([0, 1] as const).map((i) => {
            const on = i === pens.active && inkTool.mode === "pen";
            return (
              <button
                key={i}
                className={"pen-color" + (on ? " on" : "")}
                style={{ ["--sw" as string]: pens.colors[i] }}
                title={on ? "Antippen oder gedrückt halten: Farbe ändern" : "Antippen: zu dieser Farbe wechseln – gedrückt halten: Farbe ändern"}
                aria-label={`Farbe ${i + 1}`}
                aria-pressed={on}
                onPointerDown={() => startPress(i)}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                onContextMenu={(e) => {
                  e.preventDefault(); // Maus: Rechtsklick ändert die Farbe
                  cancelPress();
                  longPressed.current = true;
                  setPenWheel(i);
                }}
                onClick={() => {
                  if (longPressed.current) return; // war ein Gedrückthalten
                  if (on) setPenWheel(i); // schon gewählt und am Zeichnen → Farbe ändern
                  else updatePens({ ...pens, active: i });
                }}
              />
            );
          })}
          {/* Rückgängig/Wiederholen am rechten Rand */}
          <button className="push-right" onClick={undo} disabled={!stacks.undo} title="Rückgängig" aria-label="Rückgängig">
            <Icon name="undo" />
          </button>
          <button onClick={redo} disabled={!stacks.redo} title="Wiederholen" aria-label="Wiederholen">
            <Icon name="redo" />
          </button>
        </div>
      )}
      {penWheel !== null && (
        <ColorWheel
          initial={pens.colors[penWheel]}
          onCancel={() => setPenWheel(null)}
          onAdd={(hex) => {
            setPenColor(penWheel, hex);
            setPenWheel(null);
          }}
        />
      )}
      <div
        ref={editor}
        className="note-editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label="Text der Notiz"
        data-placeholder="Tippen zum Schreiben – Zeichenfeld über das Stift-Symbol, Bilder über das Bild-Symbol oder per Einfügen."
        onPointerDown={(e) => {
          // Bild antippen: auswählen (Größe ändern) – keine Schreibmarke, keine Tastatur
          if ((e.target as HTMLElement).tagName === "IMG") {
            e.preventDefault();
            selectImage(e.target as HTMLImageElement);
          } else if (selImg) setSelImg(null);
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).tagName !== "IMG") return;
          setImageWidth(e.target as HTMLImageElement, null); // Doppeltipp: wieder volle Breite
          save();
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).tagName === "IMG") {
            selectImage(e.target as HTMLImageElement);
            return;
          }
          // Tipp auf den leeren Teil der Notiz (unter dem Inhalt): Zeichnen beenden, Schreibmarke ans Ende setzen
          const el = editor.current;
          if (!el || e.target !== el) return;
          if (drawingRef.current) stopDrawing();
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed) return;
          const last = el.lastElementChild;
          const r = document.createRange();
          if (last && !last.classList.contains("ink-block") && !last.matches("img")) {
            r.selectNodeContents(last);
          } else {
            // nach einem Zeichenfeld/Bild eine neue Zeile anlegen
            const line = document.createElement("div");
            line.append(document.createElement("br"));
            el.append(line);
            r.selectNodeContents(line);
          }
          r.collapse(last?.textContent ? false : true);
          el.focus();
          sel?.removeAllRanges();
          sel?.addRange(r);
        }}
        onInput={() => {
          if (selImg && !selImg.isConnected) setSelImg(null); // Bild gelöscht (Rücktaste)
          if (drawingRef.current && !editor.current?.querySelector(".ink-block")) stopDrawing(); // Feld per Rücktaste entfernt
          save();
        }}
        onBlur={() => save(true)}
        onKeyUp={rememberCaret}
        onPaste={(e) => {
          // Bilder (z. B. aus dem Ausschnitt-Werkzeug) als Bild, alles andere als reiner Text
          const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
          e.preventDefault();
          rememberCaret();
          if (files.length) {
            void insertImages(files);
            return;
          }
          const text = e.clipboardData.getData("text/plain");
          if (!text) return;
          const nodes: Node[] = [];
          text.split(/\r?\n/).forEach((line, i) => {
            if (i) nodes.push(document.createElement("br"));
            if (line) nodes.push(document.createTextNode(line));
          });
          insertAtCaret(nodes);
        }}
      />
      {selImg && imageBox && (
        <>
          <div
            className="img-sel"
            style={{ left: imageBox.left, top: imageBox.top, width: imageBox.width, height: imageBox.height, clipPath: `inset(${Math.max(0, imageBox.edTop - imageBox.top)}px -40px -40px -40px)` }}
          >
            <span
              className="img-handle"
              onPointerDown={startResize}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              title="Ziehen zum Verkleinern/Vergrößern"
              aria-label="Bildgröße ändern"
            />
          </div>
          {imageBox.top >= imageBox.edTop - 4 && (
            // in der Ecke oben links auf dem Bild – verdeckt keinen Text (neben einem Bild steht nie Text)
            <div className="img-bar" style={{ left: imageBox.left + 6, top: Math.max(imageBox.edTop + 6, imageBox.top + 6) }}>
              <button
                onClick={() => {
                  setImageWidth(selImg, 0.5);
                  save();
                }}
                title="Halbe Breite"
                aria-label="Halbe Breite"
              >
                ½
              </button>
              <button
                onClick={() => {
                  setImageWidth(selImg, null);
                  save();
                }}
                title="Volle Breite"
                aria-label="Volle Breite"
              >
                <Icon name="image" size={16} /> Volle Breite
              </button>
              <button
                onClick={() => {
                  selImg.remove();
                  setSelImg(null);
                  save();
                }}
                title="Bild löschen"
                aria-label="Bild löschen"
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          )}
        </>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void insertImages(files);
        }}
      />
    </aside>
  );
}
