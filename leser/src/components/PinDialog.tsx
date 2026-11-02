import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import type { Entry, EntryKind, PageText } from "../lib/db";
import { entryLabel, findDefinitionCandidates, type DefCandidate } from "../lib/indexer";
import { renderRegion, type PDFDocumentProxy } from "../lib/pdf";

const KINDS: EntryKind[] = ["Definition", "Satz", "Lemma", "Korollar", "Theorem", "Proposition", "Bemerkung", "Beispiel", "Axiom", "Notation"];

interface Props {
  doc: PDFDocumentProxy;
  pages: PageText[];
  entries: Entry[];
  selection: string;
  at: { page: number; y: number }; // Position der angepinnten Stelle
  onLinkEntry: (entryId: string, term: string) => void;
  onCreateAt: (c: DefCandidate, term: string) => void;
  onDefineHere: (kind: EntryKind, number: string, terms: string[]) => void;
  onCancel: () => void;
}

/** "Ordnungsrelationen," → "Ordnungsrelationen" – Satzzeichen und Leerraum entfernen */
function cleanSelection(s: string) {
  return s.replace(/-\s*\n\s*/g, "").replace(/\s+/g, " ").replace(/^[\s„“"'(.,;:]+|[\s„“"').,;:!?]+$/gu, "").trim();
}

export default function PinDialog({ doc, pages, entries, selection, at, onLinkEntry, onCreateAt, onDefineHere, onCancel }: Props) {
  const [tab, setTab] = useState<"auto" | "manual">("auto");
  const [term, setTerm] = useState(() => cleanSelection(selection).slice(0, 60));

  const { page: atPage, y: atY } = at;
  const candidates = useMemo(
    () => findDefinitionCandidates(pages, entries, term, { page: atPage, y: atY }),
    [pages, entries, term, atPage, atY],
  );

  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal pin-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0 }} className="with-icon"><Icon name="pin" /> Anpinnen</h3>
        <label className="field">
          Begriff
          <input className="input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="z. B. Ordnungsrelation" />
        </label>
        <div className="seg-tabs">
          <button className={tab === "auto" ? "on" : ""} onClick={() => setTab("auto")}><Icon name="search" size={16} /> Automatisch suchen</button>
          <button className={tab === "manual" ? "on" : ""} onClick={() => setTab("manual")}><Icon name="edit" size={16} /> Manuell verweisen</button>
        </div>

        {tab === "auto" ? (
          <AutoSearch
            doc={doc}
            pages={pages}
            entries={entries}
            term={term}
            candidates={candidates}
            onLinkEntry={onLinkEntry}
            onCreateAt={onCreateAt}
            onManual={() => setTab("manual")}
          />
        ) : (
          <Manual entries={entries} term={term} at={at} onLinkEntry={onLinkEntry} onDefineHere={onDefineHere} />
        )}

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onCancel}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}

function AutoSearch({
  doc,
  pages,
  entries,
  term,
  candidates,
  onLinkEntry,
  onCreateAt,
  onManual,
}: {
  doc: PDFDocumentProxy;
  pages: PageText[];
  entries: Entry[];
  term: string;
  candidates: DefCandidate[];
  onLinkEntry: (entryId: string, term: string) => void;
  onCreateAt: (c: DefCandidate, term: string) => void;
  onManual: () => void;
}) {
  if (!term.trim()) return <p className="muted small">Gib den Begriff ein, der verlinkt werden soll.</p>;
  if (!candidates.length) {
    return (
      <div className="card-box small">
        „{term}“ kommt <strong>vor dieser Stelle</strong> im Skript nicht vor – also kann hier auch nichts darauf verweisen.
        Prüfe die Schreibweise (Grundform, z. B. „Schranke“ statt „Schranken“) oder{" "}
        <button className="btn small" onClick={onManual}>verweise manuell</button>.
      </div>
    );
  }
  return (
    <div className="cand-list">
      <p className="small muted" style={{ margin: 0 }}>
        Frühere Vorkommen von „{term}“, sortiert danach, wie wahrscheinlich dort die Definition steht:
      </p>
      {candidates.map((c, i) => {
        // Liegt die Stelle in einer nummerierten Definition → dort ergänzen, sonst eigene Definitionsstelle
        const target =
          (c.block?.kind === "Definition" ? c.block : null) ??
          entries.find((e) => e.page === c.page && Math.abs(e.y + 4 - c.y) < c.h && e.terms.some((t) => t.toLowerCase() === term.trim().toLowerCase())) ??
          null;
        return (
          <div key={`${c.page}:${c.y}`} className={"cand" + (i === 0 && c.verdict === "wahrscheinlich" ? " best" : "")}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>S. {c.page}</strong>
              <span className={"verdict " + c.verdict}>
                {c.verdict === "wahrscheinlich" ? "wahrscheinlich Definition" : c.verdict === "möglich" ? "möglicherweise Definition" : "nur Erwähnung"}
              </span>
            </div>
            <CandidatePreview doc={doc} page={pages[c.page - 1]} c={c} />
            <div className="row small">
              {c.reasons.map((r) => (
                <span key={r} className="badge">{r}</span>
              ))}
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="small muted">
                {target ? `→ wird ${entryLabel(target)} hinzugefügt` : "→ neue Definitionsstelle"}
              </span>
              <button
                className={"btn small" + (i === 0 ? " primary" : "")}
                onClick={() => (target ? onLinkEntry(target.id, term.trim()) : onCreateAt(c, term.trim()))}
              >
                Hierauf verweisen
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CandidatePreview({ doc, page, c }: { doc: PDFDocumentProxy; page: PageText; c: DefCandidate }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const xs = page.items.filter((i) => i.s.trim());
    const x0 = Math.max(0, Math.min(...xs.map((i) => i.x)) - 8);
    const x1 = Math.min(page.width, Math.max(...xs.map((i) => i.x + i.w)) + 8);
    const y0 = Math.max(0, c.y - c.h * 1.6);
    void renderRegion(doc, page.page, { x: x0, y: y0, w: x1 - x0, h: Math.min(page.height - y0, c.h * 4.2) }, 1.6).then(
      (r) => alive && setUrl(r.url),
    );
    return () => {
      alive = false;
    };
  }, [doc, page, c]);
  return url ? <img className="cand-img" src={url} alt={c.context} /> : <div className="small muted">{c.context}</div>;
}

function Manual({
  entries,
  term,
  at,
  onLinkEntry,
  onDefineHere,
}: {
  entries: Entry[];
  term: string;
  at: { page: number; y: number };
  onLinkEntry: (entryId: string, term: string) => void;
  onDefineHere: (kind: EntryKind, number: string, terms: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<EntryKind>("Definition");
  const [number, setNumber] = useState("");
  // Verweisen geht nur auf frühere Stellen – nächstliegende zuerst
  const earlier = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries
      .filter((e) => e.page < at.page || (e.page === at.page && e.y < at.y - 1))
      .filter((e) => !needle || entryLabel(e).toLowerCase().includes(needle) || e.text.toLowerCase().includes(needle) || String(e.page) === needle)
      .sort((a, b) => b.page - a.page || b.y - a.y)
      .slice(0, 40);
  }, [entries, at, q]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div className="small" style={{ marginBottom: 4 }}><strong>1. Auf eine frühere Stelle verweisen</strong></div>
        <input className="input" placeholder="Definition suchen (Begriff, Nummer oder Seite) …" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="manual-list">
          {earlier.map((e) => (
            <div key={e.id} className="entry" onClick={() => term.trim() && onLinkEntry(e.id, term.trim())} title={e.text.slice(0, 200)}>
              <span className="kind">{e.kind.slice(0, 4)}.</span>
              <span>
                {e.number && <strong>{e.number} </strong>}
                {e.terms.length ? e.terms.slice(0, 3).join(", ") : <span className="muted">{e.text.slice(0, 50)}</span>}
              </span>
              <span className="pg">S. {e.page}</span>
            </div>
          ))}
          {!earlier.length && <p className="empty">Keine früheren Einträge gefunden.</p>}
        </div>
      </div>
      <div className="card-box" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="small"><strong>2. Oder: Diese Stelle selbst ist die Definition</strong></div>
        <div className="row">
          <select className="input" style={{ flex: 1 }} value={kind} onChange={(e) => setKind(e.target.value as EntryKind)}>
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <input className="input" style={{ width: 100 }} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Nr., z. B. 1.1" />
          <button className="btn primary" disabled={!term.trim()} onClick={() => onDefineHere(kind, number.trim(), [term.trim()])}>
            Als Definition speichern
          </button>
        </div>
      </div>
    </div>
  );
}
