#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wima-Worker: holt offene Jobs eines Nutzers vom Server und laesst sie von der
LOKALEN Claude-Installation (`claude -p`) erledigen — kein API-Key noetig, es
laeuft ueber das eigene Claude-Abo. Jeder Nutzer startet seinen eigenen Worker.

  python3 worker.py --user Carl                    gegen https://www.wima26.de, Dauerschleife
  python3 worker.py --user Carl --once             genau einen Job, dann Ende
  python3 worker.py --user Carl --server http://127.0.0.1:8790    gegen einen lokalen server.py

Anmeldung: Online fragt der Worker beim ersten Start nach dem Wima-Passwort (oder
--passwort / WIMA_PASSWORT) und merkt sich danach nur den Login-Token in
~/.config/wima/. Gegen einen lokalen Server auf demselben Rechner reicht der Name.

Ablauf pro Job:
  1. Job beanspruchen (POST /api/worker/claim)
  2. Eingabedateien nach arbeit/<job>/input/ und die Wissensbasis nach arbeit/<job>/wissen/ laden
  3. Prompt aus prompts/<typ>.md fuellen, `claude -p` im Job-Ordner starten
  4. Alles aus arbeit/<job>/output/ hochladen, geaenderte Wissensdateien zurueckschreiben,
     Job als fertig/fehler melden
"""

import argparse
import getpass
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from urllib.parse import urlencode, urlparse

DIR = os.path.dirname(os.path.abspath(__file__))
ARBEIT = os.path.join(DIR, "arbeit")
PROMPTS = os.path.join(DIR, "prompts")
TOOLS = os.path.join(DIR, "tools")
CLAUDE_TOOLS = "Bash,Read,Write,Edit,Glob,Grep"
TIMEOUT = 90 * 60

ART_NAME = {"skript": "Skript", "uebung": "Übungsblatt", "tutorium": "Tutoriumsblatt",
            "sonstiges": "Material"}

# Art-spezifische Teile von prompts/verbessern.md
ABGLEICH = {
    "skript": "Geh jede Aufgabe der Übungs- und Tutoriumsblätter in `input/kontext/` durch: Welche "
              "Begriffe, Sätze und Techniken braucht sie? Stehen sie in diesem Original oder in früheren "
              "Vorlesungen? Was fehlt oder zu knapp ist, wird ein Befund (Typ Lücke). Löse die Aufgaben dabei "
              "nicht. Es geht nur darum, was der Stoff liefern muss.",
    "blatt": "Bestimme für jede Aufgabe dieses Blatts die nötigen Begriffe, Sätze und Techniken und ihre "
             "Fundstelle in den Vorlesungen in `input/kontext/`, mit Nummer. Fehlt etwas im Skript oder kommt "
             "es erst später, wird das ein Befund und gehört in `stoff.md` (Abschnitt „Lücken“).",
}
SCHREIBEN = {
    "skript": "Setze das **gesamte** Original in LaTeX neu: Gliederung, Nummerierung, Definitionen, Sätze, "
              "Beweise und Beispiele vollständig und wörtlich. Deine Ergänzungen und Korrekturen baust du "
              "nahtlos an der passenden Stelle ein (siehe unten). Was die Blätter brauchen (Schritt 2), "
              "ergänzt du dort, wo der Begriff eingeführt wird, ohne auf die Blätter zu verweisen.",
    "blatt": "Setze das Blatt vollständig und wörtlich neu, alle Aufgaben mit Punkten und Abgabehinweisen. "
             "Präzisiere unklare oder mehrdeutige Formulierungen direkt im Aufgabentext und ergänze knapp "
             "die Definition eines Begriffs, wo es hilft. Beides steht in Türkis, siehe unten. "
             "**Keine Lösungshinweise.**",
}


AUTH = {}  # Header fuer alle Anfragen, siehe anmelden()


def request(server, method, path, body=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(server + path, data=data, method=method, headers=AUTH)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    return urllib.request.urlopen(req, timeout=120)


def call(server, method, path, body=None, raw=None):
    with request(server, method, path, body, raw) as r:
        payload = r.read()
        return json.loads(payload) if payload else None


def anmelden(server, user, passwort):
    host = urlparse(server).hostname
    if host in ("127.0.0.1", "localhost", "::1"):
        AUTH["X-Wima-Worker"] = user
        return
    datei = os.path.join(os.path.expanduser("~/.config/wima"), f"{host}-{user}.token")
    if not passwort and os.path.exists(datei):
        with open(datei) as fh:
            AUTH["Authorization"] = "Bearer " + fh.read().strip()
        try:
            call(server, "GET", "/api/state")
            return
        except urllib.error.HTTPError as e:
            if e.code != 401:
                raise
            print("Gespeicherter Login abgelaufen, bitte neu anmelden.", flush=True)
    passwort = passwort or os.environ.get("WIMA_PASSWORT") or getpass.getpass(f"Wima-Passwort fuer {user}: ")
    token = call(server, "POST", "/api/login", {"user": user, "passwort": passwort})["token"]
    AUTH["Authorization"] = "Bearer " + token
    os.makedirs(os.path.dirname(datei), exist_ok=True)
    with open(os.open(datei, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as fh:
        fh.write(token)


def fill(template, values):
    for k, v in values.items():
        template = template.replace("{{" + k + "}}", str(v))
    return template


def titel(item):
    t = ART_NAME.get(item["art"], item["art"])
    if item.get("nummer"):
        t += f" {item['nummer']}"
    if item.get("titel"):
        t += f" – {item['titel']}"
    return t


def wissen_laden(server, ziel):
    dateien = call(server, "GET", "/api/wissen")["dateien"]
    for rel, text in dateien.items():
        os.makedirs(os.path.dirname(os.path.join(ziel, rel)), exist_ok=True)
        with open(os.path.join(ziel, rel), "w", encoding="utf-8") as fh:
            fh.write(text)
    return dateien


def wissen_zurueck(server, ziel, vorher):
    geaendert = []
    for root, _, names in os.walk(ziel):
        for n in names:
            rel = os.path.relpath(os.path.join(root, n), ziel)
            if not n.endswith(".md"):
                continue
            with open(os.path.join(ziel, rel), encoding="utf-8") as fh:
                text = fh.read()
            if vorher.get(rel) == text:
                continue
            try:
                call(server, "PUT", "/api/wissen?" + urlencode({"pfad": rel}), raw=text.encode("utf-8"))
                geaendert.append(rel)
            except urllib.error.HTTPError as e:
                print(f"  wissen/{rel} nicht übernommen ({e.code})", flush=True)
    return geaendert


def run_job(server, claim, keep):
    job, item, course = claim["job"], claim["item"], claim["course"]
    wd = os.path.join(ARBEIT, f"job{job['id']}")
    shutil.rmtree(wd, ignore_errors=True)
    for sub in ("input", "output", "work"):
        os.makedirs(os.path.join(wd, sub))
    wissen_vorher = wissen_laden(server, os.path.join(wd, "wissen"))

    for f in claim["inputs"]:
        ziel = os.path.join(wd, "input", f["pfad"])
        os.makedirs(os.path.dirname(ziel), exist_ok=True)
        with request(server, "GET", f["url"]) as r, open(ziel, "wb") as fh:
            shutil.copyfileobj(r, fh)

    with open(os.path.join(PROMPTS, "_basis.md"), encoding="utf-8") as fh:
        basis = fh.read()
    with open(os.path.join(PROMPTS, f"{job['typ']}.md"), encoding="utf-8") as fh:
        spezifisch = fh.read()
    eingaben = "\n".join(f"- input/{f['pfad']}" for f in claim["inputs"]) or "- (keine)"
    art = "skript" if item["art"] == "skript" else "blatt"
    endung = {"verbessern": "_verbessert", "lang": "_lang"}.get(job["typ"], f"_fuer_{job['owner']}")
    stamm = (titel(item).split(" – ")[0] + endung).replace(" ", "_")
    prompt = fill(basis + "\n\n" + spezifisch, {
        "ABGLEICH": ABGLEICH[art], "SCHREIBEN": SCHREIBEN[art],
        "ORDNER": "skript" if item["art"] == "skript" else "aufgabe", "DATEINAME": stamm,
        "KUERZEL": course.get("kuerzel") or f"kurs{course['id']}",
        "USER": job["owner"], "KURS": course["name"], "TITEL": titel(item),
        "ART": ART_NAME.get(item["art"], item["art"]), "NUMMER": item.get("nummer") or "",
        "DATUM": date.today().strftime("%d.%m.%Y"), "TOOLS": TOOLS,
        "EINGABEN": eingaben, "HINWEIS": job.get("hinweis") or "(kein Hinweis)",
    })
    with open(os.path.join(wd, "prompt.md"), "w", encoding="utf-8") as fh:
        fh.write(prompt)

    print(f"[job {job['id']}] {job['typ']} · {course['name']} · {titel(item)} — Claude arbeitet …", flush=True)
    t0 = time.time()
    proc = subprocess.run(
        ["claude", "-p", prompt, "--output-format", "json",
         "--allowedTools", CLAUDE_TOOLS, "--add-dir", TOOLS],
        cwd=wd, capture_output=True, text=True, timeout=TIMEOUT)
    with open(os.path.join(wd, "claude.log"), "w", encoding="utf-8") as fh:
        fh.write(proc.stdout + "\n--- stderr ---\n" + proc.stderr)
    try:
        res = json.loads(proc.stdout)
        zusammenfassung = (res.get("result") or "").strip()
        fehler = res.get("is_error")
    except json.JSONDecodeError:
        zusammenfassung, fehler = proc.stdout.strip()[-2000:], True
    if proc.returncode != 0:
        fehler = True
        zusammenfassung = zusammenfassung or proc.stderr.strip()[-2000:]

    ausgabe = sorted(os.listdir(os.path.join(wd, "output")))
    if not ausgabe:
        fehler = True
        zusammenfassung = "Keine Ausgabedatei erzeugt.\n\n" + zusammenfassung
    rolle, owner = claim["ausgabe"]["rolle"], claim["ausgabe"]["owner"]
    for name in ausgabe:
        pfad = os.path.join(wd, "output", name)
        if not os.path.isfile(pfad):
            continue
        qs = urlencode({"item": item["id"], "rolle": rolle, "owner": owner or "",
                        "name": name, "job": job["id"]})
        with open(pfad, "rb") as fh:
            call(server, "POST", f"/api/upload?{qs}", raw=fh.read())

    geaendert = wissen_zurueck(server, os.path.join(wd, "wissen"), wissen_vorher)
    if geaendert:
        zusammenfassung += "\n\nWissensbasis aktualisiert: " + ", ".join(geaendert)
    dauer = f"{int(time.time() - t0)} s"
    call(server, "POST", f"/api/jobs/{job['id']}/{'fail' if fehler else 'done'}",
         {"ergebnis": f"{zusammenfassung}\n\n({dauer}, {len(ausgabe)} Datei(en))"})
    print(f"[job {job['id']}] {'FEHLER' if fehler else 'fertig'} nach {dauer}", flush=True)
    if not keep and not fehler:
        shutil.rmtree(wd, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--user", required=True)
    ap.add_argument("--server", default=os.environ.get("WIMA_SERVER", "https://www.wima26.de"))
    ap.add_argument("--passwort", help="sonst wird beim ersten Start danach gefragt")
    # Jede Abfrage weckt die Datenbank (Neon, kostenloses Kontingent) — nicht zu oft fragen
    ap.add_argument("--interval", type=int, default=30)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--keep", action="store_true", help="Arbeitsordner auch bei Erfolg behalten")
    args = ap.parse_args()
    server = args.server.rstrip("/")
    if not shutil.which("claude"):
        sys.exit("`claude` (Claude Code CLI) nicht gefunden.")
    anmelden(server, args.user, args.passwort)
    print(f"Wima-Worker fuer {args.user} → {server}", flush=True)

    while True:
        try:
            claim = call(server, "POST", "/api/worker/claim", {})
        except (urllib.error.URLError, OSError) as e:
            print(f"Server nicht erreichbar: {e}", flush=True)
            claim = None
        if claim:
            try:
                run_job(server, claim, args.keep)
            except Exception as e:  # Job als Fehler melden, Worker laeuft weiter
                print(f"[job {claim['job']['id']}] Ausnahme: {e}", flush=True)
                try:
                    call(server, "POST", f"/api/jobs/{claim['job']['id']}/fail", {"ergebnis": f"Worker-Fehler: {e}"})
                except Exception:
                    pass
            if args.once:
                return
            continue
        if args.once:
            print("Keine offenen Jobs.")
            return
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
