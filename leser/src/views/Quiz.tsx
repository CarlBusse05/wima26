import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import { get, getAll, type Lookup, type Script, type ScriptIndex } from "../lib/db";
import { byUrgency, gradeLookup, levelInfo, weakLookups } from "../lib/lookups";
import { closePdf, definitionRegion, loadPdf, renderRegion, type PDFDocumentProxy } from "../lib/pdf";
import { navigate } from "../router";

const GRADES: { g: 0 | 1 | 2; label: string; key: string; cls: string }[] = [
  { g: 0, label: "Nicht gewusst", key: "1", cls: "g0" },
  { g: 1, label: "Teilweise", key: "2", cls: "g1" },
  { g: 2, label: "Gewusst", key: "3", cls: "g2" },
];

interface Shown {
  url: string | null;
  page: number;
  text: string;
}

/** Fragt Definitionen ab, die oft nachgeschlagen oder zuletzt nicht gewusst wurden. */
export default function Quiz({ scriptId }: { scriptId?: string }) {
  const [queue, setQueue] = useState<Lookup[] | null>(null);
  const [allCount, setAllCount] = useState(0);
  const [scripts, setScripts] = useState<Map<string, Script>>(new Map());
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState("");
  const [shown, setShown] = useState<Shown | null>(null);
  const [results, setResults] = useState<{ l: Lookup; g: 0 | 1 | 2 }[]>([]);
  const docs = useRef(new Map<string, Promise<PDFDocumentProxy>>());

  const start = async (mode: "weak" | "all") => {
    const all = (await getAll<Lookup>("lookups")).filter((l) => !scriptId || l.scriptId === scriptId);
    setAllCount(all.length);
    const list = mode === "weak" ? await weakLookups(scriptId) : all.sort(byUrgency);
    setQueue(list);
    setI(0);
    setRevealed(false);
    setAnswer("");
    setResults([]);
  };

  useEffect(() => {
    void getAll<Script>("scripts").then((s) => setScripts(new Map(s.map((x) => [x.id, x]))));
    void start("weak");
    const opened = docs.current;
    return () => {
      for (const d of opened.values()) void d.then(closePdf);
    };
  }, [scriptId]); // start() bewusst nicht als Abhängigkeit: nur beim Öffnen/Wechsel des Skripts laden

  const current = queue?.[i];

  // Definition der aktuellen Karte vorbereiten (wird erst beim Aufdecken gezeigt)
  useEffect(() => {
    setShown(null);
    if (!current) return;
    let alive = true;
    void (async () => {
      const index = await get<ScriptIndex>("indexes", current.scriptId);
      // aktuelle Stelle des Begriffs suchen (Einträge können nach einer Neuanalyse neu angelegt sein)
      const key = current.term.toLowerCase();
      const entry = index?.entries.find((e) => e.terms.some((t) => t.toLowerCase() === key));
      const target = entry ? { page: entry.page, y: entry.y, yEnd: entry.yEnd, text: entry.text } : current.target;
      const page = index?.pages[target.page - 1];
      let url: string | null = null;
      if (page) {
        if (!docs.current.has(current.scriptId)) {
          const file = await get<{ id: string; blob: Blob }>("files", current.scriptId);
          if (file) docs.current.set(current.scriptId, loadPdf(file.blob));
        }
        const doc = await docs.current.get(current.scriptId);
        if (doc) url = (await renderRegion(doc, target.page, definitionRegion(page, target.y, target.yEnd), 1.8)).url;
      }
      if (alive) setShown({ url, page: target.page, text: target.text });
    })();
    return () => {
      alive = false;
    };
  }, [current]);

  const grade = async (g: 0 | 1 | 2) => {
    if (!current) return;
    const updated = await gradeLookup(current, g);
    setResults((r) => [...r, { l: updated, g }]);
    setRevealed(false);
    setAnswer("");
    setI((x) => x + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (!current) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed) {
        const g = GRADES.find((x) => x.key === e.key);
        if (g) void grade(g.g);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!queue) return <p className="empty">Lädt …</p>;
  const scriptTitle = scriptId ? scripts.get(scriptId)?.title : null;

  return (
    <div className="learn">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="btn ghost" onClick={() => navigate(scriptId ? `/script/${scriptId}` : "/")}>
          <Icon name="back" size={18} /> {scriptTitle ?? "Übersicht"}
        </button>
        {queue.length > 0 && (
          <span className="muted small">
            {Math.min(i + 1, queue.length)} / {queue.length}
          </span>
        )}
      </div>
      <h1 style={{ margin: 0 }}>Abfragen{scriptTitle ? `: ${scriptTitle}` : ""}</h1>

      {!queue.length ? (
        <div className="quiz-card" style={{ textAlign: "center" }}>
          <p>Gerade gibt es nichts abzufragen.</p>
          <p className="muted small">
            Jeder Begriff, den du im Skript anklickst, landet hier – je öfter, desto höher die Stufe (noch nicht sicher →
            unsicher → sehr unsicher → kritisch). Auch was du beim Abfragen nicht gewusst hast, kommt wieder.
          </p>
          {allCount > 0 && (
            <button className="btn" onClick={() => void start("all")}>
              Alle bisher nachgeschlagenen abfragen ({allCount})
            </button>
          )}
        </div>
      ) : current ? (
        <>
          <div className="progress">
            <div style={{ width: `${(i / queue.length) * 100}%` }} />
          </div>
          <div className="quiz-card">
            <div className="quiz-meta">
              <span className={"lvl " + levelInfo(current).cls}>{levelInfo(current).label}</span>
              <span className="count" title="So oft hast du den Begriff im Skript angeklickt">
                <strong>{current.clicks}×</strong> nachgeschlagen
                {current.sinceReview !== current.clicks && ` · ${current.sinceReview}× seit der letzten Abfrage`}
              </span>
            </div>
            <div className="muted small">
              {current.label}
              {current.reviews.at(-1)?.grade === 0 ? " · zuletzt nicht gewusst" : current.reviews.at(-1)?.grade === 1 ? " · zuletzt teilweise" : ""}
              {!scriptId && scripts.get(current.scriptId) ? ` · ${scripts.get(current.scriptId)!.title}` : ""}
            </div>
            <h2 style={{ margin: "8px 0 14px" }}>Was bedeutet „{current.term}“?</h2>
            <textarea
              className="input"
              rows={3}
              placeholder="Erst selbst formulieren (optional) – dann aufdecken."
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
            {revealed && (
              <div className="quiz-answer">
                <div className="muted small">Im Skript (S. {shown?.page ?? current.target.page}):</div>
                {shown?.url ? (
                  <img src={shown.url} alt={`Definition von ${current.term}`} />
                ) : shown ? (
                  <p>{shown.text}</p>
                ) : (
                  <p className="muted">Lädt …</p>
                )}
                <a href={`#/script/${current.scriptId}?page=${shown?.page ?? current.target.page}`}>Im Skript ansehen <Icon name="jump" size={14} /></a>
              </div>
            )}
          </div>
          {revealed ? (
            <div className="grades">
              {GRADES.map((x) => (
                <button key={x.g} className={x.cls} onClick={() => void grade(x.g)}>
                  {x.label}
                  <small>
                    <kbd>{x.key}</kbd>
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <button className="btn primary" style={{ justifyContent: "center", padding: 12 }} onClick={() => setRevealed(true)}>
              Aufdecken <kbd>Leertaste</kbd>
            </button>
          )}
        </>
      ) : (
        <div className="quiz-card" style={{ textAlign: "center" }}>
          <h2>Geschafft!</h2>
          <p>
            {results.filter((r) => r.g === 2).length} gewusst · {results.filter((r) => r.g === 1).length} teilweise ·{" "}
            {results.filter((r) => r.g === 0).length} nicht gewusst
          </p>
          <table className="quiz-results">
            <thead>
              <tr>
                <th>Begriff</th>
                <th>nachgeschlagen</th>
                <th>Antwort</th>
                <th>jetzt</th>
              </tr>
            </thead>
            <tbody>
              {results.map(({ l, g }) => (
                <tr key={l.id}>
                  <td>{l.term}</td>
                  <td>{l.clicks}×</td>
                  <td>{GRADES[g].label}</td>
                  <td>
                    <span className={"lvl " + levelInfo(l).cls}>{levelInfo(l).label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.some((r) => r.g < 2) && (
            <p className="muted small">Was du nicht sicher wusstest, bleibt auf der Liste und kommt beim nächsten Abfragen wieder.</p>
          )}
          <div className="row" style={{ justifyContent: "center" }}>
            {results.some((r) => r.g < 2) && (
              <button className="btn primary" onClick={() => void start("weak")}>Unsichere gleich nochmal</button>
            )}
            <button className="btn" onClick={() => navigate(scriptId ? `/script/${scriptId}` : "/")}>Fertig</button>
          </div>
        </div>
      )}
    </div>
  );
}
