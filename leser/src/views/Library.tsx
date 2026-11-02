import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import { deleteScript, get, getAll, put, type Script, type ScriptIndex } from "../lib/db";
import { ingestPdf } from "../lib/ingest";
import { navigate } from "../router";
import { weakLookups } from "../lib/lookups";
import { thumbnail } from "../lib/thumbs";
import { describeChanges, prepareNewVersion } from "../lib/versions";
import { DATE_SCAN_VERSION, findDocDate, formatDocDate } from "../lib/docdate";
import { importWima, listWimaPdfs, scriptsBySource, syncSource, type WimaPdf } from "../lib/wima";

const formatDay = (t: number) => new Date(t).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const uploadedAt = (s: Script) => s.versions?.at(-1)?.uploadedAt ?? s.createdAt;

const COURSE_SUGGESTIONS = [
  "Analysis I", "Analysis II", "Lineare Algebra I", "Lineare Algebra II", "Stochastik", "Statistik",
  "Finanzmathematik", "Versicherungsmathematik", "Operations Research", "Optimierung", "Numerik",
  "Ökonometrie", "Mikroökonomik", "Makroökonomik", "BWL", "Programmierung",
];

type Job = { key: string; name: string; msg: string; frac: number; error?: string };

/** Vorschaubild der ersten Seite (wird beim ersten Anzeigen erzeugt). */
function Thumb({ id, version }: { id: string; version: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let u: string | null = null;
    void thumbnail(id, version).then((blob) => {
      if (!alive || !blob) return;
      u = URL.createObjectURL(blob);
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id, version]);
  return url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-ph">∑</span>;
}

export default function Library() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [course, setCourse] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [weak, setWeak] = useState(0);
  const [now] = useState(Date.now);
  const [menu, setMenu] = useState<{ script: Script; x: number; y: number } | null>(null);
  const [report, setReport] = useState<{ script: Script; lines: string[] } | null>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const versionFor = useRef<Script | null>(null);
  const [wima, setWima] = useState<WimaPdf[] | null>(null);
  const [wimaError, setWimaError] = useState<string | null>(null);
  const synced = useRef(false);

  const load = async () => {
    setScripts(await getAll<Script>("scripts"));
    setWeak((await weakLookups()).length);
  };
  useEffect(() => {
    void load();
  }, []);

  // Wima: verfügbare PDFs holen; bereits geöffnete Skripte mit neuerer Fassung in Wima als neue Version übernehmen
  useEffect(() => {
    if (synced.current) return;
    synced.current = true;
    void (async () => {
      let list: WimaPdf[];
      try {
        list = await listWimaPdfs();
      } catch (e) {
        setWimaError(e instanceof Error ? e.message : String(e));
        return;
      }
      setWima(list);
      const have = await scriptsBySource();
      // gemeinsame Notizen holen; neuere Fassung in Wima → neue Version
      for (const p of list) {
        const s = have.get(p.key);
        if (!s) continue;
        await runJob("w" + s.id, s.title, async (upd) => {
          const r = await syncSource(p, s, upd, (m) => confirm(m));
          if (r.lines) setReport({ script: r.script, lines: r.lines });
        });
      }
    })();
  }, []);

  // Ältere Skripte einmalig nach dem Datum des neuesten Aufschriebs durchsuchen
  useEffect(() => {
    const todo = scripts.filter((s) => s.dateScan !== DATE_SCAN_VERSION);
    if (!todo.length) return;
    let alive = true;
    void (async () => {
      for (const s of todo) {
        const idx = await get<ScriptIndex>("indexes", s.id);
        if (!alive || !idx) continue;
        const next: Script = { ...((await get<Script>("scripts", s.id)) ?? s), docDate: findDocDate(idx.pages, uploadedAt(s)), dateScan: DATE_SCAN_VERSION };
        await put("scripts", next);
        if (alive) setScripts((list) => list.map((x) => (x.id === s.id ? next : x)));
      }
    })();
    return () => {
      alive = false;
    };
  }, [scripts]);

  const allCourses = useMemo(() => [...new Set(scripts.map((s) => s.course))].sort((a, b) => a.localeCompare(b, "de")), [scripts]);
  const shown = useMemo(
    () =>
      scripts
        .filter((s) => !filter || s.course === filter)
        .sort((a, b) => a.course.localeCompare(b.course, "de") || a.title.localeCompare(b.title, "de", { numeric: true })),
    [scripts, filter],
  );

  const runJob = async (key: string, name: string, work: (upd: (msg: string, frac: number) => void) => Promise<void>) => {
    setJobs((j) => [...j, { key, name, msg: "Startet …", frac: 0 }]);
    const upd = (patch: Partial<Job>) => setJobs((j) => j.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    try {
      await work((msg, frac) => upd({ msg, frac }));
      setJobs((j) => j.filter((x) => x.key !== key));
      await load();
    } catch (e) {
      upd({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  async function handleFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) continue;
      await runJob(f.name + Date.now(), f.name, async (upd) => {
        await ingestPdf(f, course, upd);
      });
    }
  }

  async function uploadVersion(s: Script, f: File) {
    setReport(null);
    await runJob("v" + s.id, `${s.title} – neue Version`, async (upd) => {
      const plan = await prepareNewVersion(s.id, f, upd);
      if (
        plan.matchedShare < 0.3 &&
        !confirm(
          `„${f.name}“ hat kaum Seiten mit dem bisherigen „${s.title}“ gemeinsam – ist das wirklich eine neue Version davon?\n\nNotizen ohne passende Seite gehen nicht verloren, sondern werden gesammelt.`,
        )
      ) {
        return;
      }
      const next = await plan.commit();
      setReport({ script: next, lines: describeChanges(plan.report, plan.pageCount) });
    });
  }

  const openMenu = (s: Script, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ script: s, x: r.right, y: r.bottom + 4 });
  };

  const imported = useMemo(() => new Set(scripts.filter((s) => s.wima).map((s) => `${s.wima!.item}:${s.wima!.rolle}`)), [scripts]);
  const wimaOpen = (wima ?? []).filter((p) => !imported.has(p.key));
  const openFromWima = (p: WimaPdf) =>
    runJob("i" + p.key, `${p.course} · ${p.item.titel ?? p.file.name}`, async (upd) => {
      const s = await importWima(p, upd);
      navigate(`/script/${s.id}`);
    });

  const courses = [...new Set([...scripts.map((s) => s.course), ...COURSE_SUGGESTIONS])];

  return (
    <div className="page-wrap">
      <h1>Deine Skripte</h1>
      <p className="muted">
        Skripte aus Wima öffnen oder eine PDF hochladen – Definitionen, Sätze und Verweise werden automatisch verlinkt.
        Notizen in Skripten aus Wima sind gemeinsam (alle sehen und bearbeiten denselben Stand); hochgeladene PDFs bleiben
        lokal in diesem Browser.
      </p>
      {weak > 0 && (
        <div className="card-box quiz-hint">
          <span>
            <Icon name="bulb" /> <strong>{weak}</strong> {weak === 1 ? "Definition sitzt" : "Definitionen sitzen"} noch nicht sicher – du hast sie
            nachgeschlagen oder beim Abfragen nicht gewusst.
          </span>
          <button className="btn primary" onClick={() => navigate("/quiz")}>Jetzt abfragen</button>
        </div>
      )}

      {jobs.map((j) => (
        <div key={j.key} className="card-box" style={{ marginTop: 8 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{j.name}</strong>
            <span className={j.error ? "error" : "muted small"}>{j.error ?? j.msg}</span>
          </div>
          {!j.error && (
            <div className="progress" style={{ marginTop: 6 }}>
              <div style={{ width: `${Math.round(j.frac * 100)}%` }} />
            </div>
          )}
        </div>
      ))}
      {report && (
        <div className="card-box version-report" role="status">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>„{report.script.title}“ aktualisiert</strong>
            <span className="row">
              <button className="btn primary small" onClick={() => navigate(`/script/${report.script.id}`)}>Öffnen</button>
              <button className="icon-btn" onClick={() => setReport(null)} aria-label="Schließen"><Icon name="x" size={18} /></button>
            </span>
          </div>
          <ul>
            {report.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}

      {allCourses.length > 1 && (
        <div className="chips" role="tablist" aria-label="Nach Fach filtern">
          <button className={!filter ? "on" : ""} onClick={() => setFilter(null)}>Alle</button>
          {allCourses.map((c) => (
            <button key={c} className={filter === c ? "on" : ""} onClick={() => setFilter(c)}>{c}</button>
          ))}
        </div>
      )}

      {shown.length > 0 && (
        <div className="tile-grid">
          {shown.map((s) => {
            const pos = Math.min(s.lastPage ?? 1, s.pageCount);
            const fresh = s.changes && now < s.changes.newUntil;
            return (
              <div
                key={s.id}
                className="script-tile"
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/script/${s.id}`)}
                onKeyDown={(e) => e.key === "Enter" && navigate(`/script/${s.id}`)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(s, e.currentTarget.querySelector(".tile-more") as HTMLElement);
                }}
              >
                <div className="thumb">
                  <Thumb id={s.id} version={s.version ?? 1} />
                  {fresh && <span className="tile-badge">Neu: Version {s.version}</span>}
                </div>
                <div className="tile-info">
                  <span className="title" title={s.title}>{s.title}</span>
                  <span className="muted small">{s.course}</span>
                  <span className="muted small">Seite {pos} von {s.pageCount}</span>
                  {s.docDate ? (
                    <span className="muted small tile-date" title={`Neuester Aufschrieb laut Dokument: „${s.docDate.context}“`}>
                      <Icon name="calendar" size={14} /> Stand {formatDocDate(s.docDate)}
                    </span>
                  ) : (
                    <span className="muted small tile-date" title="Datum des Hochladens">
                      <Icon name="upload" size={14} /> Hochgeladen {formatDay(uploadedAt(s))}
                    </span>
                  )}
                  <div className="read-progress" aria-hidden>
                    <div style={{ width: `${Math.round((pos / Math.max(1, s.pageCount)) * 100)}%` }} />
                  </div>
                </div>
                <button
                  className="tile-more"
                  title="Weitere Aktionen"
                  aria-label={`Aktionen für ${s.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    openMenu(s, e.currentTarget);
                  }}
                >
                  <Icon name="more" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {!scripts.length && !jobs.length && (
        <p className="empty">Noch keine Skripte. Öffne unten ein Skript aus Wima oder lade eine PDF hoch.</p>
      )}

      <h2>Aus Wima</h2>
      {wimaError ? (
        <p className="muted small">{wimaError}</p>
      ) : !wima ? (
        <p className="muted small">Wird geladen …</p>
      ) : !wimaOpen.length ? (
        <p className="muted small">Alle PDFs aus Wima sind schon oben in der Bibliothek. Neue Fassungen und Notizen anderer kommen automatisch an.</p>
      ) : (
        <div className="wima-list">
          {[...new Set(wimaOpen.map((p) => p.course))].map((c) => (
            <div key={c} className="card-box" style={{ marginTop: 8 }}>
              <strong>{c}</strong>
              {wimaOpen
                .filter((p) => p.course === c)
                .map((p) => (
                  <div key={p.key} className="row wima-row" style={{ justifyContent: "space-between", marginTop: 6 }}>
                    <span>
                      {p.item.art === "skript" ? "Skript" : p.item.art === "uebung" ? "Übung" : p.item.art === "tutorium" ? "Tutorium" : "Sonstiges"}
                      {p.item.nummer ? ` ${p.item.nummer}` : ""}
                      {p.item.titel ? `: ${p.item.titel}` : ""} <span className="muted small">· {p.label}</span>
                    </span>
                    <button className="btn small" onClick={() => void openFromWima(p)}>Öffnen</button>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}

      <h2>Skript hochladen</h2>
      <div
        className={"dropzone" + (over ? " over" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="row" style={{ justifyContent: "center" }}>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            list="courses"
            placeholder="Fach, z. B. Analysis I"
            value={course}
            onChange={(e) => setCourse(e.target.value)}
          />
          <datalist id="courses">
            {courses.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <label className="btn primary">
            PDF auswählen
            <input
              type="file"
              accept="application/pdf"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          oder PDF-Dateien hierher ziehen · Neue Fassung eines vorhandenen Skripts: „⋯“ auf der Kachel → Neue Version hochladen
        </p>
      </div>

      {/* Datei-Auswahl für "Neue Version" – wird aus dem Menü heraus geöffnet */}
      <input
        ref={versionInput}
        type="file"
        accept="application/pdf"
        hidden
        data-testid="version-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          const s = versionFor.current;
          e.target.value = "";
          if (f && s) void uploadVersion(s, f);
        }}
      />

      {menu && (
        <>
          <div className="popup-back" onClick={() => setMenu(null)} />
          <div
            className="mini-popup tile-menu"
            role="menu"
            style={{ left: Math.min(Math.max(menu.x - 60, 110), window.innerWidth - 110), top: Math.max(8, Math.min(menu.y, window.innerHeight - 300)) }}
          >
            <div className="title">{menu.script.title}</div>
            <button onClick={() => navigate(`/script/${menu.script.id}`)}><Icon name="book" size={18} /> Öffnen</button>
            <button
              onClick={async () => {
                const s = menu.script;
                setMenu(null);
                const title = prompt("Name des Skripts", s.title);
                if (title === null || !title.trim()) return;
                await put("scripts", { ...s, title: title.trim() });
                await load();
              }}
            >
              <Icon name="edit" size={18} /> Umbenennen
            </button>
            <button
              onClick={async () => {
                const s = menu.script;
                setMenu(null);
                const c = prompt("Fach", s.course);
                if (c === null || !c.trim()) return;
                await put("scripts", { ...s, course: c.trim() });
                await load();
              }}
            >
              <Icon name="tag" size={18} /> Fach ändern
            </button>
            <button
              onClick={() => {
                versionFor.current = menu.script;
                setMenu(null);
                versionInput.current?.click(); // direkt im Tipp aufrufen, sonst öffnet Safari die Dateiauswahl nicht
              }}
            >
              <Icon name="upload" size={18} /> Neue Version hochladen
            </button>
            <button onClick={() => navigate(`/quiz/${menu.script.id}`)}><Icon name="bulb" size={18} /> Abfragen</button>
            <button
              className="danger-item"
              onClick={async () => {
                const s = menu.script;
                setMenu(null);
                if (!confirm(`„${s.title}“ mit allen Notizen löschen?`)) return;
                await deleteScript(s.id);
                await load();
              }}
            >
              <Icon name="trash" size={18} /> Löschen
            </button>
            {menu.script.versions && menu.script.versions.length > 1 && (
              <div className="muted small" style={{ padding: "4px 10px" }}>
                Version {menu.script.version} · hochgeladen {new Date(menu.script.versions.at(-1)!.uploadedAt).toLocaleDateString("de-DE")}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
