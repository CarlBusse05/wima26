import { useMemo, useState } from "react";
import Icon from "./Icon";
import type { Entry, ScriptIndex } from "../lib/db";
import { reindex } from "../lib/ingest";

interface Props {
  index: ScriptIndex;
  currentPage: number;
  onJump: (e: Entry) => void;
  onSave: (next: ScriptIndex) => Promise<void>;
  onClose: () => void;
  onRemoveLinks: (terms: string[]) => void; // alle Verknüpfungen dieser Begriffe entfernen (mit Rückgängig)
  onRestoreTerm: (term: string) => void;
  onRestoreLink: (key: string) => void; // einzeln entfernte Verknüpfung wiederherstellen
}

const FILTERS = ["Alle", "Definition", "Satz", "Lemma/Korollar", "Beispiel", "Bemerkung", "Erstes Vorkommen"] as const;

export default function IndexPanel({ index, currentPage, onJump, onSave, onClose, onRemoveLinks, onRestoreTerm, onRestoreLink }: Props) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Alle");
  const [editing, setEditing] = useState<string | null>(null);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return index.entries.filter((e) => {
      if (filter === "Definition" && e.kind !== "Definition") return false;
      if (filter === "Satz" && !["Satz", "Theorem", "Proposition"].includes(e.kind)) return false;
      if (filter === "Lemma/Korollar" && !["Lemma", "Korollar"].includes(e.kind)) return false;
      if (filter === "Beispiel" && e.kind !== "Beispiel") return false;
      if (filter === "Bemerkung" && e.kind !== "Bemerkung") return false;
      if (filter === "Erstes Vorkommen" && e.kind !== "Begriff") return false;
      if (!needle) return true;
      return (
        e.terms.some((t) => t.toLowerCase().includes(needle)) ||
        (e.number ?? "").startsWith(needle) ||
        e.text.toLowerCase().includes(needle)
      );
    });
  }, [index.entries, q, filter]);

  const termCount = index.entries.reduce((n, e) => n + e.terms.length, 0);
  const disabled = new Set(index.disabledTerms.map((t) => t.toLowerCase()));
  const activeTerms = (e: Entry) => e.terms.filter((t) => !disabled.has(t.toLowerCase()));

  const update = (id: string, patch: Partial<Entry>) =>
    onSave({
      ...index,
      // Bearbeitete Einträge gelten als manuell und überstehen so eine Neuanalyse
      entries: index.entries.map((e) => (e.id === id ? { ...e, ...patch, source: e.source === "auto" ? "manual" : e.source } : e)),
    });

  return (
    <>
      <div className="side-head">
        <input className="input" placeholder="Begriff oder Nummer suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={filter} onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])}>
          {FILTERS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <div className="small muted">
          {index.entries.length} Stellen · {termCount} verlinkte Begriffe
        </div>
        <div className="row">
          <button
            className="btn small"
            title="Automatische Erkennung neu laufen lassen (eigene Einträge bleiben)"
            onClick={async () => {
              const next = await reindex(index.scriptId);
              if (next) await onSave(next);
            }}
          >
            <Icon name="refresh" size={16} /> Neu erkennen
          </button>
        </div>
      </div>
      <div className="side-scroll">
        {list.map((e) => (
          <div key={e.id}>
            <div
              className="entry"
              style={e.page === currentPage ? { background: "var(--surface-2)" } : undefined}
              onClick={() => {
                onJump(e);
                onClose();
              }}
            >
              <span className="kind">{e.kind.slice(0, 4)}.</span>
              <span>
                {e.number && <strong>{e.number} </strong>}
                {e.terms.length ? e.terms.slice(0, 3).join(", ") : <span className="muted">{e.text.slice(0, 50)}</span>}
                {e.source !== "auto" && <span className={"badge" + (e.source === "ai" ? " ai" : "")} style={{ marginLeft: 6 }}>{e.source === "ai" ? "KI" : "manuell"}</span>}
                {e.hint && <span className="badge" style={{ marginLeft: 6 }} title="Woran die Definition erkannt wurde">{e.hint}</span>}
              </span>
              <span className="pg">
                {e.page}
                <button
                  className="icon-btn"
                  title="Bearbeiten"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setEditing(editing === e.id ? null : e.id);
                  }}
                  aria-label="Bearbeiten"
                >
                  <Icon name="edit" size={16} />
                </button>
              </span>
            </div>
            {editing === e.id && (
              <div className="card-box" style={{ margin: "4px 0 8px", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="field">
                  Verlinkte Begriffe (Komma-getrennt)
                  <input
                    className="input"
                    defaultValue={e.terms.join(", ")}
                    onBlur={(ev) =>
                      void update(e.id, {
                        terms: ev.target.value.split(",").map((t) => t.trim()).filter((t) => t.length >= 2),
                      })
                    }
                  />
                </label>
                <label className="field">
                  Nummer
                  <input className="input" defaultValue={e.number ?? ""} onBlur={(ev) => void update(e.id, { number: ev.target.value.trim() || undefined })} />
                </label>
                <div className="row">
                  {activeTerms(e).length > 0 && (
                    <button className="btn small" onClick={() => onRemoveLinks(activeTerms(e))} title="Lässt den Eintrag stehen, entfernt aber alle Verweise darauf">
                      <Icon name="unlink" size={16} /> Alle Verknüpfungen entfernen
                    </button>
                  )}
                  <button
                    className="btn small danger"
                    onClick={() => void onSave({ ...index, entries: index.entries.filter((x) => x.id !== e.id) })}
                  >
                    Eintrag löschen
                  </button>
                  <button className="btn small" onClick={() => setEditing(null)}>Fertig</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {!list.length && (
          <p className="empty">
            Keine Einträge gefunden. Markiere einen Begriff im Skript und wähle „Anpinnen“.
          </p>
        )}
      </div>
      {(index.disabledTerms.length > 0 || (index.disabledLinks ?? []).length > 0) && (
        <details className="disabled-terms">
          <summary>Entfernte Verknüpfungen ({index.disabledTerms.length + (index.disabledLinks ?? []).length})</summary>
          {index.disabledTerms.map((t) => (
            <div key={t} className="row">
              <span>{t} <span className="muted">(alle)</span></span>
              <button className="btn small" onClick={() => onRestoreTerm(t)}>Wiederherstellen</button>
            </div>
          ))}
          {(index.disabledLinks ?? []).map((k) => {
            const [page, , ...term] = k.split(":");
            return (
              <div key={k} className="row">
                <span>{term.join(":")} <span className="muted">(S. {page}, einzeln)</span></span>
                <button className="btn small" onClick={() => onRestoreLink(k)}>Wiederherstellen</button>
              </div>
            );
          })}
        </details>
      )}
    </>
  );
}
