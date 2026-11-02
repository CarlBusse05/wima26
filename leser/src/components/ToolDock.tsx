import Icon from "./Icon";
import type { InkToolState } from "./InkLayer";
import { switchTool } from "../lib/inktools";
import { loadCustomColors } from "../lib/colors";

type Side = "left" | "right";

interface Props {
  tool: InkToolState;
  setTool: (t: InkToolState) => void;
  open: Side | null;
  onOpen: (side: Side | null) => void;
}

const TOOLS = [
  { mode: "pen", icon: "pencil", label: "Stift" },
  { mode: "highlighter", icon: "highlighter", label: "Textmarker" },
  { mode: "eraser", icon: "eraser", label: "Radierer" },
  { mode: "lasso", icon: "lasso", label: "Lasso" },
] as const;

/**
 * Kleine Werkzeug-Leisten am linken und rechten Rand (über dem Skript), solange der Stift an ist: nur der Wechsel
 * zwischen Stift, Textmarker, Radierer und Lasso. Geöffnet und geschlossen über einen Halbkreis am Rand; offen ist
 * höchstens eine Seite – die andere lässt sich erst öffnen, wenn beide zu sind.
 */
export default function ToolDock({ tool, setTool, open, onOpen }: Props) {
  const side = (s: Side) => {
    if (open && open !== s) return null;
    const isOpen = open === s;
    const where = s === "left" ? "links" : "rechts";
    return (
      <div className={`tool-dock ${s}` + (isOpen ? " open" : "")} role="toolbar" aria-label={`Werkzeuge ${where}`}>
        {isOpen && (
          <div className="dock-pill">
            {TOOLS.map((t) => (
              <button
                key={t.mode}
                className={tool.mode === t.mode ? "on" : ""}
                onClick={() => setTool(switchTool(tool, t.mode, loadCustomColors()))}
                title={t.label}
                aria-label={t.label}
                aria-pressed={tool.mode === t.mode}
              >
                <Icon name={t.icon} />
                {tool.mode === t.mode && (t.mode === "pen" || t.mode === "highlighter") && <span className="dock-color" style={{ background: tool.color }} />}
              </button>
            ))}
          </div>
        )}
        <button
          className="dock-tab"
          onClick={() => onOpen(isOpen ? null : s)}
          title={isOpen ? "Werkzeuge schließen" : `Werkzeuge ${where} öffnen`}
          aria-label={isOpen ? `Werkzeuge ${where} schließen` : `Werkzeuge ${where} öffnen`}
          aria-expanded={isOpen}
        >
          <Icon name="chevron" size={16} className={(s === "left") !== isOpen ? "point-right" : "point-left"} />
        </button>
      </div>
    );
  };
  return (
    <>
      {side("left")}
      {side("right")}
    </>
  );
}
