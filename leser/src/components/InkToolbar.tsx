import { useRef, useState } from "react";
import Icon from "./Icon";
import type { InkToolState } from "./InkLayer";
import ColorWheel from "./ColorWheel";
import { loadCustomColors, saveCustomColors } from "../lib/colors";
import { HL_COLORS, HL_WIDTHS, PEN_COLORS, PEN_WIDTHS, switchTool } from "../lib/inktools";

const LONG_PRESS_MS = 500;

interface Props {
  tool: InkToolState;
  setTool: (t: InkToolState) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

// Beendet wird das Zeichnen nur über „✏️ Stift“ im Leser; Rückgängig/Wiederholen sitzen rechts in dieser Leiste.
export default function InkToolbar({ tool, setTool, canUndo, canRedo, onUndo, onRedo }: Props) {
  const presets = tool.mode === "highlighter" ? HL_COLORS : PEN_COLORS;
  const widths = tool.mode === "highlighter" ? HL_WIDTHS : PEN_WIDTHS;
  const [custom, setCustom] = useState<string[]>(loadCustomColors);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [removeMenu, setRemoveMenu] = useState<{ color: string; x: number; y: number; openedAt: number } | null>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);

  const setCustomColors = (next: string[]) => {
    setCustom(next);
    saveCustomColors(next);
  };

  // Langes Drücken auf eine eigene Farbe → "Entfernen" anbieten
  const startPress = (color: string, el: HTMLElement) => {
    longPressed.current = false;
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      const r = el.getBoundingClientRect();
      setRemoveMenu({ color, x: r.left + r.width / 2, y: r.bottom + 6, openedAt: Date.now() });
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => window.clearTimeout(pressTimer.current);

  return (
    <div className="ink-bar" role="toolbar" aria-label="Stift-Werkzeuge">
      <div className="seg">
        <button
          className={tool.mode === "pen" ? "on" : ""}
          onClick={() => setTool(switchTool(tool, "pen", custom))}
          title="Stift"
          aria-label="Stift"
        >
          <Icon name="pencil" />
        </button>
        <button
          className={tool.mode === "highlighter" ? "on" : ""}
          onClick={() => setTool(switchTool(tool, "highlighter", custom))}
          title="Textmarker"
          aria-label="Textmarker"
        >
          <Icon name="highlighter" />
        </button>
        <button className={tool.mode === "eraser" ? "on" : ""} onClick={() => setTool(switchTool(tool, "eraser", custom))} title="Radierer (löscht ganze Striche)" aria-label="Radierer">
          <Icon name="eraser" />
        </button>
        <button
          className={tool.mode === "lasso" ? "on" : ""}
          onClick={() => setTool(switchTool(tool, "lasso", custom))}
          title="Lasso – Zeichnungen umkreisen, dann verschieben, vergrößern/verkleinern oder löschen"
          aria-label="Lasso"
        >
          <Icon name="lasso" />
        </button>
      </div>

      {tool.mode !== "eraser" && tool.mode !== "lasso" && (
        <>
          <div className="seg colors-seg">
            {/* scrollt waagerecht, wenn mehr Farben vorhanden sind, als in die Leiste passen */}
            <div className="colors-scroll">
              {presets.map((x) => (
                <button
                  key={x.c}
                  className={"swatch" + (tool.color === x.c ? " on" : "")}
                  style={{ ["--sw" as string]: x.c }}
                  onClick={() => setTool({ ...tool, color: x.c })}
                  title={x.n}
                  aria-label={x.n}
                />
              ))}
              {custom.map((c) => (
                <button
                  key={c}
                  className={"swatch custom" + (tool.color === c ? " on" : "")}
                  style={{ ["--sw" as string]: c }}
                  title={`Eigene Farbe ${c.toUpperCase()} – lange drücken zum Entfernen`}
                  aria-label={`Eigene Farbe ${c}`}
                  onPointerDown={(e) => startPress(c, e.currentTarget)}
                  onPointerUp={cancelPress}
                  onPointerLeave={cancelPress}
                  onPointerCancel={cancelPress}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setRemoveMenu({ color: c, x: r.left + r.width / 2, y: r.bottom + 6, openedAt: Date.now() });
                  }}
                  onClick={() => {
                    if (longPressed.current) return; // war ein langes Drücken
                    setTool({ ...tool, color: c });
                  }}
                />
              ))}
            </div>
            <button className="add-color" onClick={() => setWheelOpen(true)} title="Eigene Farbe hinzufügen" aria-label="Eigene Farbe hinzufügen">
              <Icon name="plus" size={18} />
            </button>
          </div>
          <div className="seg">
            {widths.map((w, i) => (
              <button key={w} className={"width" + (tool.width === w ? " on" : "")} onClick={() => setTool({ ...tool, width: w })} title={["Fein", "Mittel", "Dick"][i]}>
                <span style={{ width: 6 + i * 5, height: 6 + i * 5, background: tool.mode === "highlighter" ? tool.color : "currentColor" }} />
              </button>
            ))}
          </div>
        </>
      )}


      <div className="seg ink-history" role="group" aria-label="Rückgängig und Wiederholen">
        <button onClick={onUndo} disabled={!canUndo} title="Rückgängig – letzten Strich zurücknehmen (⌘Z)" aria-label="Rückgängig"><Icon name="undo" /></button>
        <button onClick={onRedo} disabled={!canRedo} title="Wiederholen (⇧⌘Z)" aria-label="Wiederholen"><Icon name="redo" /></button>
      </div>

      {wheelOpen && (
        <ColorWheel
          initial={tool.color}
          onCancel={() => setWheelOpen(false)}
          onAdd={(hex) => {
            if (!custom.includes(hex) && !presets.some((x) => x.c === hex)) setCustomColors([...custom, hex]);
            setTool({ ...tool, color: hex });
            setWheelOpen(false);
          }}
        />
      )}

      {removeMenu && (
        <>
          <div className="popup-back" onClick={() => Date.now() - removeMenu.openedAt > 500 && setRemoveMenu(null)} />
          <div className="mini-popup" style={{ left: removeMenu.x, top: removeMenu.y }}>
            <button
              onClick={() => {
                setCustomColors(custom.filter((c) => c !== removeMenu.color));
                if (tool.color === removeMenu.color) setTool({ ...tool, color: presets[0].c });
                setRemoveMenu(null);
              }}
            >
              <span className="dot" style={{ background: removeMenu.color }} /> <Icon name="trash" size={16} /> Entfernen
            </button>
          </div>
        </>
      )}
    </div>
  );
}
