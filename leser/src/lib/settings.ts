export interface Settings {
  theme: "system" | "light" | "dark";
  linkStyle: "dezent" | "deutlich"; // Darstellung der Verknüpfungen im Skript
}

export const SETTINGS_KEY = "mathe-studium.settings";

const DEFAULTS: Settings = {
  theme: "system",
  linkStyle: "dezent",
};

// Felder früherer Versionen (Claude-API-Schlüssel und -Modell), die nicht mehr gebraucht werden
const OBSOLETE = ["apiKey", "cardModel", "chatModel", "effort"];

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Record<string, unknown>;
    // alten API-Schlüssel aus dem Browser-Speicher entfernen
    if (OBSOLETE.some((k) => k in raw)) {
      for (const k of OBSOLETE) delete raw[k];
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(raw));
    }
    return { ...DEFAULTS, ...(raw as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* Speicher nicht verfügbar */
  }
  applyTheme(s.theme);
}

export function applyTheme(theme: Settings["theme"]) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
