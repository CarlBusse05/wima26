#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wima-Worker: holt offene Jobs eines Nutzers vom Server und laesst sie von der
LOKALEN Claude-Installation (`claude -p`) erledigen — kein API-Key noetig, es
laeuft ueber das eigene Claude-Abo. Jeder Nutzer startet seinen eigenen Worker.

  python3 worker.py --user Carl                    Dauerschleife (alle 15 s)
  python3 worker.py --user Emil --server http://192.168.0.12:8790
  python3 worker.py --user Carl --once             genau einen Job, dann Ende

Ablauf pro Job:
  1. Job beanspruchen (POST /api/worker/claim)
  2. Eingabedateien nach arbeit/<job>/input/ laden
  3. Prompt aus prompts/<typ>.md fuellen, `claude -p` im Job-Ordner starten
  4. Alles aus arbeit/<job>/output/ hochladen, Job als fertig/fehler melden
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from urllib.parse import urlencode

DIR = os.path.dirname(os.path.abspath(__file__))
ARBEIT = os.path.join(DIR, "arbeit")
PROMPTS = os.path.join(DIR, "prompts")
TOOLS = os.path.join(DIR, "tools")
CLAUDE_TOOLS = "Bash,Read,Write,Edit,Glob,Grep"
TIMEOUT = 45 * 60

ART_NAME = {"skript": "Skript", "uebung": "Übungsblatt", "tutorium": "Tutoriumsblatt",
            "sonstiges": "Material"}


def call(server, method, path, body=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(server + path, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=120) as r:
        payload = r.read()
        return json.loads(payload) if payload else None


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


def run_job(server, claim, keep):
    job, item, course = claim["job"], claim["item"], claim["course"]
    wd = os.path.join(ARBEIT, f"job{job['id']}")
    shutil.rmtree(wd, ignore_errors=True)
    for sub in ("input", "output", "work"):
        os.makedirs(os.path.join(wd, sub))

    for f in claim["inputs"]:
        ziel = os.path.join(wd, "input", f["pfad"])
        os.makedirs(os.path.dirname(ziel), exist_ok=True)
        urllib.request.urlretrieve(server + f["url"], ziel)

    with open(os.path.join(PROMPTS, "_basis.md"), encoding="utf-8") as fh:
        basis = fh.read()
    with open(os.path.join(PROMPTS, f"{job['typ']}.md"), encoding="utf-8") as fh:
        spezifisch = fh.read()
    eingaben = "\n".join(f"- input/{f['pfad']}" for f in claim["inputs"]) or "- (keine)"
    prompt = fill(basis + "\n\n" + spezifisch, {
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

    dauer = f"{int(time.time() - t0)} s"
    call(server, "POST", f"/api/jobs/{job['id']}/{'fail' if fehler else 'done'}",
         {"ergebnis": f"{zusammenfassung}\n\n({dauer}, {len(ausgabe)} Datei(en))"})
    print(f"[job {job['id']}] {'FEHLER' if fehler else 'fertig'} nach {dauer}", flush=True)
    if not keep and not fehler:
        shutil.rmtree(wd, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--user", required=True)
    ap.add_argument("--server", default=os.environ.get("WIMA_SERVER", "http://127.0.0.1:8790"))
    ap.add_argument("--interval", type=int, default=15)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--keep", action="store_true", help="Arbeitsordner auch bei Erfolg behalten")
    args = ap.parse_args()
    server = args.server.rstrip("/")
    if not shutil.which("claude"):
        sys.exit("`claude` (Claude Code CLI) nicht gefunden.")
    print(f"Wima-Worker fuer {args.user} → {server}", flush=True)

    while True:
        try:
            claim = call(server, "POST", "/api/worker/claim", {"user": args.user})
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
