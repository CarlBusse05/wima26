import { useEffect, useState } from "react";
import { navigate } from "../router";
import { openWimaFile } from "../lib/wima";

/** Ziel des Links „Lesen“ in Wima: #/wima/<Datei-ID> → Skript holen (beim ersten Mal analysieren) und öffnen. */
export default function WimaOpen({ fileId }: { fileId: number }) {
  const [msg, setMsg] = useState("Skript wird aus Wima geholt …");
  const [frac, setFrac] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    openWimaFile(fileId, (m, f) => {
      if (!alive) return;
      setMsg(m);
      setFrac(f);
    })
      // replace: "Zurück" im Browser führt wieder nach Wima statt in diese Zwischenseite
      .then((s) => alive && location.replace(`#/script/${s.id}`))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [fileId]);

  return (
    <div className="page-wrap">
      <h1>Aus Wima öffnen</h1>
      <div className="card-box">
        {error ? (
          <>
            <p className="error">{error}</p>
            <div className="row">
              <a className="btn primary" href="/">Zu Wima</a>
              <button className="btn" onClick={() => navigate("/")}>Zur Bibliothek</button>
            </div>
          </>
        ) : (
          <>
            <span className="muted small">{msg}</span>
            <div className="progress" style={{ marginTop: 6 }}>
              <div style={{ width: `${Math.round(frac * 100)}%` }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
