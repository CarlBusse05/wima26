import { useRoute } from "./router";
import Library from "./views/Library";
import Reader from "./views/Reader";
import SettingsView from "./views/Settings";
import Quiz from "./views/Quiz";
import WimaOpen from "./views/WimaOpen";

export default function App() {
  const route = useRoute();
  const [section, id] = route.path;

  if (section === "wima" && id) return <WimaOpen key={id} fileId={Number(id)} />;

  if (section === "script" && id) {
    const page = Number(route.query.get("page")) || undefined;
    return <Reader key={id} scriptId={id} initialPage={page} />;
  }

  return (
    <div className="app">
      <nav className="topnav">
        <a className="brand" href="#/">
          <span className="logo">∑</span> Wima · Leser
        </a>
        <a className={"nav" + (!section ? " active" : "")} href="#/">Skripte</a>
        <a className={"nav" + (section === "quiz" ? " active" : "")} href="#/quiz">Abfragen</a>
        <span className="spacer" />
        <a className={"nav" + (section === "settings" ? " active" : "")} href="#/settings">Einstellungen</a>
        {/* Anmeldung übernimmt Wima (gleiche Adresse) */}
        <a className="nav" href="/">← Wima</a>
      </nav>
      <main className="main">
        {section === "quiz" ? (
          <Quiz key={id ?? "alle"} scriptId={id} />
        ) : section === "settings" ? (
          <SettingsView />
        ) : (
          <Library />
        )}
      </main>
    </div>
  );
}
