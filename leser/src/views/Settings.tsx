import { useState } from "react";
import Icon from "../components/Icon";
import { loadSettings, saveSettings, type Settings } from "../lib/settings";
import { exportBackup, importBackup, inspectBackup, type BackupSummary } from "../lib/backup";
import { loadWordPairs, pairKey, relatedForms, saveWordPairs, type WordPair } from "../lib/wordforms";

const formatSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function SettingsView() {
  const [s, setS] = useState<Settings>(loadSettings);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<{ file: File; url: string } | null>(null);
  const [pending, setPending] = useState<{ file: File; info: BackupSummary } | null>(null);
  const [pairs, setPairs] = useState<WordPair[]>(loadWordPairs);
  const [pairA, setPairA] = useState("");
  const [pairB, setPairB] = useState("");

  const updatePairs = (next: WordPair[]) => {
    setPairs(next);
    saveWordPairs(next);
  };
  const addPair = () => {
    const a = pairA.trim();
    const b = pairB.trim();
    if (!a || !b || a.toLowerCase() === b.toLowerCase()) return;
    const p: WordPair = [a, b];
    if (!pairs.some((x) => pairKey(x) === pairKey(p))) updatePairs([...pairs, p]);
    setPairA("");
    setPairB("");
  };
  // Vorschau: Was erkennt die Seite schon von allein?
  const auto = pairA.trim() ? relatedForms(pairA.trim()) : [];

  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  // Schritt 1: Datei erzeugen. Schritt 2 (eigener Tipp) teilt/speichert sie – Safari erlaubt das Teilen-Menü
  // nur unmittelbar nach einer Berührung, und das Zusammenstellen kann bei vielen PDFs etwas dauern.
  const prepareExport = async () => {
    setBusy(true);
    setMsg("Daten werden zusammengestellt …");
    try {
      const file = await exportBackup();
      if (prepared) URL.revokeObjectURL(prepared.url);
      setPrepared({ file, url: URL.createObjectURL(file) });
      setMsg("");
    } catch (e) {
      setMsg("Export fehlgeschlagen: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const saveExport = async () => {
    if (!prepared) return;
    const { file, url } = prepared;
    // iPad/iPhone: Teilen-Menü → „In Dateien sichern“
    if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name });
        setMsg("Gesichert.");
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setMsg("Datei wurde heruntergeladen.");
  };

  const runImport = async (mode: "replace" | "merge") => {
    if (!pending) return;
    const { file } = pending;
    setPending(null);
    setBusy(true);
    try {
      const n = await importBackup(file, mode, setMsg);
      setMsg(`Import abgeschlossen (${n} ${n === 1 ? "Skript" : "Skripte"}). Die Seite wird neu geladen …`);
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      setMsg("Import fehlgeschlagen: " + (e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  };

  return (
    <div className="page-wrap" style={{ maxWidth: 720 }}>
      <h1>Einstellungen</h1>
      <p className="muted">{saved ? "Gespeichert." : "Änderungen werden sofort gespeichert."}</p>

      <h2>Darstellung</h2>
      <div className="card-box" style={{ display: "flex", flexDirection: "column" }}>
        <label className="field">
          Farbschema
          <select className="input" value={s.theme} onChange={(e) => update({ theme: e.target.value as Settings["theme"] })}>
            <option value="system">Wie System</option>
            <option value="light">Hell</option>
            <option value="dark">Dunkel</option>
          </select>
        </label>
        <label className="field" style={{ marginTop: 12 }}>
          Verknüpfungen im Skript
          <select className="input" value={s.linkStyle} onChange={(e) => update({ linkStyle: e.target.value as Settings["linkStyle"] })}>
            <option value="dezent">Dezent – feine, halbtransparente Unterstreichung</option>
            <option value="deutlich">Deutlich – farbig hinterlegt</option>
          </select>
        </label>
      </div>

      <h2>Verwandte Wortformen</h2>
      <div className="card-box" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Adjektiv und Nomen verweisen automatisch auf dieselbe Definition – z. B. <em>injektiv ↔ Injektivität</em>,{" "}
          <em>symmetrisch ↔ Symmetrie</em>, <em>disjunkt ↔ Disjunktheit</em>, <em>stetig ↔ Stetigkeit</em>, auch gebeugt
          („injektiven“). Fehlt eine Verknüpfung, kannst du hier ein eigenes Wortpaar anlegen. Es wirkt in beide Richtungen
          und in allen Skripten.
        </p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            addPair();
          }}
        >
          <input className="input" style={{ flex: "1 1 140px", width: "auto" }} placeholder="z. B. kompakt" value={pairA} onChange={(e) => setPairA(e.target.value)} autoCapitalize="none" />
          <span aria-hidden>↔</span>
          <input className="input" style={{ flex: "1 1 140px", width: "auto" }} placeholder="z. B. Kompaktheit" value={pairB} onChange={(e) => setPairB(e.target.value)} autoCapitalize="none" />
          <button className="btn primary" type="submit" disabled={!pairA.trim() || !pairB.trim()}>Hinzufügen</button>
        </form>
        {auto.length > 0 && (
          <div className="small muted">Für „{pairA.trim()}“ schon automatisch: {auto.join(", ")}</div>
        )}
        {pairs.length > 0 ? (
          <ul className="pair-list">
            {pairs.map((p) => (
              <li key={pairKey(p)}>
                <span>
                  {p[0]} ↔ {p[1]}
                </span>
                <button className="icon-btn" onClick={() => updatePairs(pairs.filter((x) => pairKey(x) !== pairKey(p)))} title="Wortpaar entfernen" aria-label={`Wortpaar ${p[0]} – ${p[1]} entfernen`}>
                  <Icon name="x" size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="small muted">Noch keine eigenen Wortpaare.</div>
        )}
      </div>

      <h2>Daten sichern und übertragen</h2>
      <div className="card-box" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Alles wird nur in diesem Browser gespeichert – und zwar getrennt pro Internetadresse. Deshalb siehst du unter
          einer anderen Adresse (z. B. einer Vercel-Vorschau oder später einer eigenen Domain) einen anderen Stand. Mit
          Export und Import nimmst du alles mit: Skripte samt PDFs, Notizen und Zeichnungen, Verknüpfungen, Abfrage-Statistik,
          eigene Farben, eigene Wortpaare, Skript-Versionen und Einstellungen.
        </p>
        <div className="row">
          {prepared ? (
            <>
              <button className="btn primary" onClick={() => void saveExport()}>
                <Icon name="download" size={18} /> Datei sichern ({formatSize(prepared.file.size)})
              </button>
              <a className="small" href={prepared.url} download={prepared.file.name}>
                oder herunterladen
              </a>
            </>
          ) : (
            <button className="btn" disabled={busy} onClick={() => void prepareExport()}>
              Daten exportieren
            </button>
          )}
          <label className={"btn" + (busy ? " disabled" : "")}>
            Daten importieren
            {/* ohne accept-Filter: iPadOS graut sonst unbekannte Dateitypen in der Dateien-App aus */}
            <input
              type="file"
              hidden
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  setPending({ file: f, info: await inspectBackup(f) });
                  setMsg("");
                } catch (err) {
                  setMsg(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </label>
        </div>
        {msg && <div className="small">{msg}</div>}
      </div>

      {pending && (
        <div className="modal-back" onClick={() => setPending(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Daten importieren</h3>
            <p style={{ margin: 0 }}>
              „{pending.file.name}“
              {pending.info.createdAt ? ` vom ${new Date(pending.info.createdAt).toLocaleString("de-DE")}` : ""}
              {Number.isFinite(pending.info.scripts) ? ` · ${pending.info.scripts} ${pending.info.scripts === 1 ? "Skript" : "Skripte"}` : ""}
            </p>
            <p className="small muted" style={{ margin: 0 }}>Was soll mit den Daten passieren, die hier schon gespeichert sind?</p>
            <button className="btn primary" onClick={() => void runImport("merge")}>
              Zusammenführen
            </button>
            <p className="small muted" style={{ margin: "-6px 0 0" }}>
              Beides behalten. Neue Skripte kommen dazu; bei gleichen Skripten werden eigene Einträge und entfernte
              Verknüpfungen vereinigt, bei Notizen gewinnt der neuere Stand. Die Einstellungen dieses Geräts bleiben.
            </p>
            <button
              className="btn danger"
              onClick={() => {
                if (confirm("Alle hier gespeicherten Skripte, Notizen und Verknüpfungen werden gelöscht und durch die Sicherung ersetzt. Fortfahren?")) {
                  void runImport("replace");
                }
              }}
            >
              Ersetzen
            </button>
            <p className="small muted" style={{ margin: "-6px 0 0" }}>Alles hier Gespeicherte wird durch die Sicherung ersetzt.</p>
            <button className="btn" onClick={() => setPending(null)}>Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  );
}
