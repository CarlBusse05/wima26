#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wima — Lernplattform fuer Carls und Emils Mathe-Kurse.

JSON-API + Job-Queue. Die agentischen Aufgaben (verbessern, lang, personalisieren,
aufbereiten, vergleich, loesung) erledigt NICHT der Server, sondern der Worker (worker.py) jedes
Nutzers mit seiner eigenen lokalen Claude-Installation. Der Server verteilt nur Jobs und
Dateien.

Laeuft in zwei Formen:
  online   auf Vercel (https://www.wima26.de): api/index.py -> Handler, Postgres + Blob
  lokal    python3 server.py [--port 9000] [--lan]   -> http://127.0.0.1:8790, SQLite + data/
Welcher Speicher benutzt wird, entscheidet store.py anhand der Umgebungsvariablen.

API (alles ausser /api/users, /api/login und /api/health braucht eine Anmeldung:
Cookie "wima" oder "Authorization: Bearer <token>"; lokal zusaetzlich — nur von
127.0.0.1 — der Header "X-Wima-Worker: <Name>" fuer den Worker auf demselben Rechner):
  GET    /api/health
  GET    /api/users                      -> {users:[{name, hat_passwort}]}
  POST   /api/login                      <- {user, passwort}  (Nutzername klein oder gross)
  POST   /api/logout
  GET    /api/state                      -> {user, users, courses, worker, einstellungen, plan}
  PUT    /api/einstellungen              <- {tutorien?: {<kurs_id>: {tag, zeit}}, tutorien_frage?, notizen?: [Nutzer],
                                            gesehen?: ["<item>:<rolle>"]}  (Datei-Markierung „neu“)
  POST   /api/courses                    <- {name, kuerzel, farbe, semester, owner?}
  PATCH  /api/courses/<id>               <- Teilfelder
  DELETE /api/courses/<id>
  GET    /api/courses/<id>/items         -> {items:[{..., files:[], jobs:[]}]}
  POST   /api/items                      <- {course_id, art, nummer, titel, datum}
  PATCH  /api/items/<id>                 <- Teilfelder
  DELETE /api/items/<id>
  POST   /api/upload?item=&rolle=&owner=&name=[&job=][&prio=1][&spaeter=1]   Body = rohe Datei
  PATCH  /api/files/<id>                 <- {prio}  (nur Loesungsteile)
  DELETE /api/files/<id>
  GET    /files/<id>                     Datei selbst
  GET    /api/notizen?item=&rolle=       -> gemeinsamer Notizstand des Lesers ({} = keiner)
  PUT    /api/notizen?item=&rolle=&rev=&basis=&vergleich=&quelle=   Body = JSON; 409 {stand}, wenn rev veraltet
  POST   /api/jobs                       <- {item_id, typ, hinweis}
  POST   /api/jobs/<id>/retry | /done | /fail
  DELETE /api/jobs/<id>
  POST   /api/worker/claim               -> {job, kontext, inputs} oder 204
  GET    /api/wissen                     -> {dateien:{pfad: text}}  (fremde Fehlerprofile ausgenommen)
  PUT    /api/wissen?pfad=               Body = Text; nur pruefkatalog.md, kurse/**, personen/<ich>.md

Automatik: Neues Original -> Job "verbessern";
neuer/geloeschter/umgeschalteter Loesungsteil -> Job "loesung" (spaeter=1: noch kein Job, weitere
Dateien folgen);
"personalisieren" ("Fuer <Name>") ist abgeschaltet (seit 02.11.): keine neuen Jobs, offene werden nicht mehr
abgeholt. Stattdessen gemeinsame Notizen im Leser (leser/, Tabelle notizen, Schalter „Notizen“ je Eintrag).
Gemeinsame Jobs (verbessern, lang, loesung) nimmt der Worker dessen, der sie angestossen hat, zuerst;
laeuft der nicht, uebernimmt sie jeder andere Worker. Persoenliche Jobs bleiben beim Besitzer.
Vorausplanung: Beim Laden eines Kurses legt vorplanen() die naechsten Uebungsblaetter und Tutorien
laut stundenplan.json schon an (Quelle: Kalender auf carlbusse.de).
"""

import argparse
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import threading
from datetime import date, datetime, timedelta
from http.cookies import SimpleCookie
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs, quote
from zoneinfo import ZoneInfo

import store
from store import db, rows, one

DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(DIR, "public")
PLAN = os.path.join(DIR, "stundenplan.json")  # Vorausplanung, siehe vorplanen()
ONLINE = bool(os.environ.get("VERCEL"))

USERS = [u.strip() for u in os.environ.get("WIMA_USERS", "Carl,Emil,Theo,Marie,Lara").split(",") if u.strip()]
ARTEN = ["skript", "uebung", "tutorium", "sonstiges"]
HAUPT = os.environ.get("WIMA_HAUPT") or USERS[0]  # erledigt die gemeinsamen Jobs
ROLLEN = ["original", "musterloesung", "verbessert", "lang", "fuer", "foto", "notiz",
          "aufbereitet", "vergleich", "begleitskript", "herde", "loesungsteil", "loesung",
          "notizbasis", "notizdaten"]  # notiz*: intern fuer gemeinsame Notizen (nicht in der Dateiliste)
NOTIZ_INTERN = ("notizbasis", "notizdaten")
NOTIZ_FASSUNGEN = ("original", "verbessert", "lang", "loesung")
JOB_TYPEN = {
    # typ: Rolle der Ergebnisdateien, Ergebnis gehoert dem Nutzer (False = allen)
    "aufbereiten":       ("aufbereitet", True),
    "vergleich":         ("vergleich", True),
    "verbessern":        ("verbessert", False),
    "lang":              ("lang", False),
    "personalisieren":   ("fuer", True),
    "loesung":           ("loesung", False),
}
# Vercel nimmt hoechstens 4,5 MB pro Anfrage an; Fotos verkleinert die Oberflaeche vorher.
MAX_UPLOAD = int(4.4 * 1024 * 1024) if ONLINE else 200 * 1024 * 1024
LOCK = threading.Lock()
COOKIE_MAX_AGE = 365 * 24 * 3600
ZONE = ZoneInfo("Europe/Berlin")  # Vercel laeuft in UTC


def now():
    return datetime.now(ZONE).replace(tzinfo=None).isoformat(timespec="seconds")


def safe_name(name):
    name = os.path.basename(name or "datei")
    name = re.sub(r"[^\w.\-äöüÄÖÜß ]+", "_", name).strip() or "datei"
    return name[:120]


class ApiError(Exception):
    def __init__(self, status, msg, **extra):
        super().__init__(msg)
        self.status = status
        self.extra = extra  # weitere Felder fuer die Antwort, z. B. der aktuelle Stand bei 409


def insert(con, sql, params):
    """INSERT ... und die neue id zurueck (RETURNING geht in SQLite und Postgres)."""
    return con.execute(sql + " RETURNING id", params).fetchone()["id"]


# ---------------------------------------------------------------- Anmeldung
def pw_hash(passwort, salt):
    return hashlib.pbkdf2_hmac("sha256", passwort.encode(), bytes.fromhex(salt), 200_000).hex()


def users_info():
    with db() as con:
        gesetzt = {r["nutzer"] for r in con.execute("SELECT nutzer FROM logins")}
    return {"users": [{"name": u, "hat_passwort": u in gesetzt} for u in USERS]}


def login(body):
    # Nutzername ohne Ruecksicht auf Gross-/Kleinschreibung: "carl" -> "Carl"
    name = (body.get("user") or "").strip().lower()
    user = next((u for u in USERS if u.lower() == name), None)
    passwort = body.get("passwort") or ""
    with db() as con:
        row = user and one(con.execute("SELECT * FROM logins WHERE nutzer=?", (user,)))
        # Passwoerter werden von Hand gesetzt (siehe tools/passwort.py), nicht beim ersten Login
        if not row or not hmac.compare_digest(row["hash"], pw_hash(passwort, row["salt"])):
            raise ApiError(401, "Nutzername oder Passwort falsch")
        token = secrets.token_urlsafe(32)
        con.execute("INSERT INTO sessions(token,nutzer,created) VALUES(?,?,?)", (token, user, now()))
    return {"user": user, "token": token}


def session_user(token):
    if not token:
        return None
    with db() as con:
        row = one(con.execute("SELECT nutzer FROM sessions WHERE token=?", (token,)))
    return row["nutzer"] if row and row["nutzer"] in USERS else None


# ---------------------------------------------------------------- Logik
def state(user):
    with db() as con:
        courses = rows(con.execute("SELECT * FROM courses WHERE owner IS NULL OR owner=? ORDER BY pos, id",
                                   (user,)))
        worker = {r["nutzer"]: r["last_seen"] for r in con.execute("SELECT * FROM worker")}
    plan = {}
    if os.path.exists(PLAN):
        with open(PLAN, encoding="utf-8") as fh:
            plan = {"reihen": json.load(fh)["reihen"]}
    einst = einstellungen(user)
    if "seit" not in einst:  # „neu“ zaehlt erst ab dem ersten Besuch, sonst waere anfangs alles neu
        einst = einstellungen_setzen(user, {"seit": True})
    return {"users": USERS, "arten": ARTEN, "courses": courses, "worker": worker, "now": now(),
            "einstellungen": einst, "plan": plan}


def einstellungen(user):
    with db() as con:
        row = one(con.execute("SELECT daten FROM einstellungen WHERE nutzer=?", (user,)))
    return json.loads(row["daten"]) if row else {}


def einstellungen_setzen(user, body):
    """Uebernimmt nur bekannte Schluessel: tutorien (je Kurs Wochentag 1-5 + Uhrzeit), tutorien_frage (Runde der
    Abfrage), notizen (Nutzerliste), gesehen (["<item>:<rolle>", ...] -> jetzt geoeffnet), seit (erster Besuch)."""
    daten = einstellungen(user)
    if body.get("seit") and "seit" not in daten:
        daten["seit"] = now()
    if "gesehen" in body:
        g = dict(daten.get("gesehen", {}))
        for k in body["gesehen"] or []:
            if re.fullmatch(r"\d+:[a-z]+", str(k)):
                g[k] = now()
        daten["gesehen"] = g
    if "tutorien_frage" in body:
        daten["tutorien_frage"] = int(body["tutorien_frage"])
    if "tutorien" in body:
        tut = dict(daten.get("tutorien", {}))
        for kid, t in (body["tutorien"] or {}).items():
            if not (isinstance(t, dict) and int(t.get("tag", 0)) in range(1, 8)
                    and re.fullmatch(r"\d{1,2}:\d{2}", str(t.get("zeit", "")))):
                raise ApiError(400, "Tutorium braucht Wochentag und Uhrzeit")
            tut[str(int(kid))] = {"tag": int(t["tag"]), "zeit": t["zeit"]}
        daten["tutorien"] = tut
    if "notizen" in body:
        daten["notizen"] = [u for u in USERS if u in (body["notizen"] or [])]
    with db() as con:
        con.execute("INSERT INTO einstellungen(nutzer,daten) VALUES(?,?) ON CONFLICT(nutzer) "
                    "DO UPDATE SET daten=excluded.daten", (user, json.dumps(daten, ensure_ascii=False)))
    return daten


def plan_termine(reihe, plan, bis):
    """(nummer, datum) aller Blaetter einer Reihe bis einschliesslich `bis`; Ferienwochen ohne Blatt."""
    ferien = [(date.fromisoformat(a), date.fromisoformat(b)) for a, b in plan.get("ferien", [])]
    d, nr = date.fromisoformat(reihe["erstes_datum"]), reihe["erste_nr"]
    ende = min(bis, date.fromisoformat(plan["ende"]))
    while d <= ende:
        if not any(a <= d <= b for a, b in ferien):
            yield nr, d
            nr += 1
        d += timedelta(days=7)


def plan_titel(vorlage, d):
    return re.sub(r"\{\+(\d+)\}", lambda m: (d + timedelta(days=int(m.group(1)))).strftime("%d.%m."), vorlage)


_GEPLANT = set()  # (kurs_id, tag): pro Prozess und Tag nur einmal pruefen


def vorplanen(con, course):
    """Legt die naechsten Uebungsblaetter und Tutorien laut stundenplan.json schon vorab an."""
    heute = datetime.now(ZONE).date()
    if (course["id"], heute) in _GEPLANT or not os.path.exists(PLAN):
        return
    with open(PLAN, encoding="utf-8") as fh:
        plan = json.load(fh)
    bis = heute + timedelta(days=plan.get("vorlauf_tage", 7))
    reihen = [r for r in plan["reihen"] if r["kurs"] == course["kuerzel"]]
    if reihen:
        da = {(i["art"], str(i["nummer"])): i for i in
              rows(con.execute("SELECT * FROM items WHERE course_id=?", (course["id"],)))}
        for r in reihen:
            for nr, d in plan_termine(r, plan, bis):
                titel = plan_titel(r["titel"], d)
                alt = da.get((r["art"], str(nr)))
                if not alt:
                    insert(con, "INSERT INTO items(course_id,art,nummer,titel,datum,created) VALUES(?,?,?,?,?,?)",
                           (course["id"], r["art"], str(nr), titel, d.isoformat(), now()))
                elif not alt["titel"]:
                    con.execute("UPDATE items SET titel=? WHERE id=?", (titel, alt["id"]))
    _GEPLANT.add((course["id"], heute))


def course_items(course_id, user):
    with db() as con:
        c = one(con.execute("SELECT * FROM courses WHERE id=?", (course_id,)))
        if not c or (c["owner"] and c["owner"] != user):
            raise ApiError(404, "Kurs nicht gefunden")
        vorplanen(con, c)
        items = rows(con.execute(
            "SELECT * FROM items WHERE course_id=? ORDER BY datum DESC, id DESC", (course_id,)))
        ids = [i["id"] for i in items] or [-1]
        marks = ",".join("?" * len(ids))
        files = rows(con.execute(
            f"SELECT id,item_id,rolle,owner,name,mime,groesse,job_id,created,prio FROM files "
            f"WHERE item_id IN ({marks}) AND rolle NOT IN ('notizbasis','notizdaten') ORDER BY id", ids))
        notizen = rows(con.execute(
            f"SELECT item_id,rolle,rev,geaendert,von FROM notizen WHERE item_id IN ({marks})", ids))
        jobs = rows(con.execute(
            f"SELECT * FROM jobs WHERE item_id IN ({marks}) ORDER BY id DESC", ids))
    by_id = {i["id"]: dict(i, files=[], jobs=[], notizen={}) for i in items}
    for n in notizen:
        by_id[n["item_id"]]["notizen"][n["rolle"]] = {k: n[k] for k in ("rev", "geaendert", "von")}
    for f in files:
        by_id[f["item_id"]]["files"].append(f)
    for j in jobs:
        by_id[j["item_id"]]["jobs"].append(j)
    return {"items": list(by_id.values())}


def pick(body, keys):
    return {k: body[k] for k in keys if k in body}


def create_course(body):
    if not (body.get("name") or "").strip():
        raise ApiError(400, "name fehlt")
    with db() as con:
        cid = insert(con, "INSERT INTO courses(name,kuerzel,farbe,semester,pos,created,owner) VALUES(?,?,?,?,?,?,?)",
                     (body["name"].strip(), body.get("kuerzel"), body.get("farbe"),
                      body.get("semester"), body.get("pos", 0), now(), body.get("owner")))
        return one(con.execute("SELECT * FROM courses WHERE id=?", (cid,)))


def update(table, row_id, fields):
    if not fields:
        raise ApiError(400, "keine Felder")
    sets = ", ".join(f"{k}=?" for k in fields)
    with db() as con:
        con.execute(f"UPDATE {table} SET {sets} WHERE id=?", (*fields.values(), row_id))
        row = one(con.execute(f"SELECT * FROM {table} WHERE id=?", (row_id,)))
    if not row:
        raise ApiError(404, "nicht gefunden")
    return row


def delete_with_files(table, row_id):
    """Loescht Kurs/Eintrag/Datei samt den gespeicherten Dateien."""
    q = {
        "courses": "SELECT f.pfad FROM files f JOIN items i ON f.item_id=i.id WHERE i.course_id=?",
        "items": "SELECT pfad FROM files WHERE item_id=?",
        "files": "SELECT pfad FROM files WHERE id=?",
    }[table]
    with db() as con:
        paths = [r["pfad"] for r in con.execute(q, (row_id,))]
        con.execute(f"DELETE FROM {table} WHERE id=?", (row_id,))
    store.dateien_loeschen(paths)
    return {"ok": True}


def create_item(body):
    if body.get("art") not in ARTEN:
        raise ApiError(400, f"art muss eins von {ARTEN} sein")
    with db() as con:
        iid = insert(con, "INSERT INTO items(course_id,art,nummer,titel,datum,created) VALUES(?,?,?,?,?,?)",
                     (body["course_id"], body["art"], body.get("nummer"), body.get("titel"),
                      body.get("datum") or datetime.now(ZONE).date().isoformat(), now()))
        return one(con.execute("SELECT * FROM items WHERE id=?", (iid,)))


def save_upload(qs, data, user):
    item = int(qs.get("item", ["0"])[0])
    rolle = qs.get("rolle", [""])[0]
    owner = user if qs.get("owner", [""])[0] else None  # private Dateien gehoeren immer dem Angemeldeten
    job = int(qs.get("job", [""])[0] or 0) or None
    name = safe_name(qs.get("name", ["datei"])[0])
    prio = 1 if rolle == "loesungsteil" and qs.get("prio", [""])[0] == "1" else 0
    if rolle not in ROLLEN:
        raise ApiError(400, f"rolle muss eins von {ROLLEN} sein")
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    with db() as con:
        if not one(con.execute("SELECT 1 AS x FROM items WHERE id=?", (item,))):
            raise ApiError(404, "Eintrag nicht gefunden")
        fid = insert(con, "INSERT INTO files(item_id,rolle,owner,name,mime,groesse,job_id,created,prio) "
                          "VALUES(?,?,?,?,?,?,?,?,?)", (item, rolle, owner, name, mime, len(data), job, now(), prio))
        pfad = store.datei_speichern(fid, name, data, mime)
        con.execute("UPDATE files SET pfad=? WHERE id=?", (pfad, fid))
        if rolle == "original" and not job:
            queue_job(con, item, "verbessern", HAUPT)
        if rolle == "loesungsteil" and not qs.get("spaeter"):
            queue_job(con, item, "loesung", HAUPT)
        return one(con.execute("SELECT * FROM files WHERE id=?", (fid,)))


# ---------------------------------------------------------------- Gemeinsame Notizen (Leser)
def notiz_stand(item, rolle):
    with db() as con:
        return one(con.execute("SELECT * FROM notizen WHERE item_id=? AND rolle=?", (item, rolle)))


def notizen_lesen(qs):
    item, rolle = int(qs.get("item", ["0"])[0]), qs.get("rolle", [""])[0]
    return notiz_stand(item, rolle) or {}


def notizen_schreiben(qs, data, user):
    """Neuer Notizstand. rev = Stand, auf dem der Leser aufbaut; passt er nicht mehr (jemand anderes hat
    inzwischen gespeichert), gibt es 409 samt aktuellem Stand und der Leser fuehrt zusammen."""
    item, rolle = int(qs.get("item", ["0"])[0]), qs.get("rolle", [""])[0]
    if rolle not in NOTIZ_FASSUNGEN:
        raise ApiError(400, f"rolle muss eins von {NOTIZ_FASSUNGEN} sein")
    zahl = lambda k: int(qs.get(k, [""])[0] or 0) or None
    rev, basis, vergleich, quelle = zahl("rev") or 0, zahl("basis"), zahl("vergleich"), zahl("quelle")
    with db() as con:
        alt = one(con.execute("SELECT * FROM notizen WHERE item_id=? AND rolle=?", (item, rolle)))
        if (alt["rev"] if alt else 0) != rev:
            raise ApiError(409, "inzwischen geaendert", stand=alt)
        for fid in (basis, vergleich, quelle):
            if fid and not one(con.execute("SELECT 1 AS x FROM files WHERE id=? AND item_id=?", (fid, item))):
                raise ApiError(400, f"Datei {fid} gehoert nicht zu diesem Eintrag")
        did = insert(con, "INSERT INTO files(item_id,rolle,owner,name,mime,groesse,created) VALUES(?,?,?,?,?,?,?)",
                     (item, "notizdaten", None, f"notizen_{rolle}.json", "application/json", len(data), now()))
        con.execute("UPDATE files SET pfad=? WHERE id=?",
                    (store.datei_speichern(did, f"notizen_{rolle}.json", data, "application/json"), did))
        neu = (rev + 1, did, basis, vergleich, quelle, now(), user)
        if alt:
            con.execute("UPDATE notizen SET rev=?, daten_id=?, basis_id=?, vergleich_id=?, quelle_id=?, geaendert=?, von=? "
                        "WHERE item_id=? AND rolle=?", neu + (item, rolle))
        else:
            con.execute("INSERT INTO notizen(rev,daten_id,basis_id,vergleich_id,quelle_id,geaendert,von,item_id,rolle) "
                        "VALUES(?,?,?,?,?,?,?,?,?)", neu + (item, rolle))
        # interne Dateien, auf die kein Stand mehr zeigt, wegraeumen
        weg = rows(con.execute(
            "SELECT id, pfad FROM files WHERE item_id=? AND rolle IN ('notizbasis','notizdaten') AND id NOT IN "
            "(SELECT x FROM (SELECT daten_id AS x FROM notizen WHERE item_id=? UNION SELECT basis_id FROM notizen "
            "WHERE item_id=? UNION SELECT vergleich_id FROM notizen WHERE item_id=?) u WHERE x IS NOT NULL) "
            "AND id < ?", (item, item, item, item, did)))
        for w in weg:
            con.execute("DELETE FROM files WHERE id=?", (w["id"],))
        stand = one(con.execute("SELECT * FROM notizen WHERE item_id=? AND rolle=?", (item, rolle)))
    store.dateien_loeschen([w["pfad"] for w in weg])
    return stand


def set_prio(fid, body):
    with db() as con:
        f = one(con.execute("SELECT * FROM files WHERE id=?", (fid,)))
        if not f or f["rolle"] != "loesungsteil":
            raise ApiError(404, "Lösungsteil nicht gefunden")
        con.execute("UPDATE files SET prio=? WHERE id=?", (1 if body.get("prio") else 0, fid))
        queue_job(con, f["item_id"], "loesung", HAUPT)
        return one(con.execute("SELECT * FROM files WHERE id=?", (fid,)))


def delete_file(fid):
    with db() as con:
        f = one(con.execute("SELECT item_id, rolle FROM files WHERE id=?", (fid,)))
    res = delete_with_files("files", fid)
    if f and f["rolle"] == "loesungsteil":
        with db() as con:  # Loesung ohne den geloeschten Teil neu bauen, falls noch Teile da sind
            if one(con.execute("SELECT 1 AS x FROM files WHERE item_id=? AND rolle='loesungsteil'",
                               (f["item_id"],))):
                queue_job(con, f["item_id"], "loesung", HAUPT)
    return res


def queue_job(con, item_id, typ, owner, hinweis=None):
    """Legt einen Job an, ausser es wartet schon derselbe (dann zaehlt der).
    Gemeinsame Jobs gibt es pro Eintrag nur einmal, egal wer sie angestossen hat."""
    if JOB_TYPEN[typ][1]:
        row = one(con.execute("SELECT id FROM jobs WHERE item_id=? AND typ=? AND owner=? AND status='offen'",
                              (item_id, typ, owner)))
    else:
        row = one(con.execute("SELECT id FROM jobs WHERE item_id=? AND typ=? AND status='offen'",
                              (item_id, typ)))
    if row:
        return row["id"]
    return insert(con, "INSERT INTO jobs(item_id,typ,owner,hinweis,created) VALUES(?,?,?,?,?)",
                  (item_id, typ, owner, hinweis, now()))


def create_job(body, user):
    if body.get("typ") not in JOB_TYPEN:
        raise ApiError(400, f"typ muss eins von {list(JOB_TYPEN)} sein")
    if body["typ"] == "personalisieren":  # „Für <Name>“ gibt es nicht mehr; gemeinsame Notizen im Leser stattdessen
        raise ApiError(400, "„Für <Name>“ gibt es nicht mehr")
    # Wer den Job anstoesst, dessen Worker nimmt ihn zuerst; gemeinsame Jobs darf aber
    # jeder laufende Worker uebernehmen (siehe claim), damit nichts auf einen Rechner wartet.
    with db() as con:
        jid = queue_job(con, body["item_id"], body["typ"], user, body.get("hinweis"))
        return one(con.execute("SELECT * FROM jobs WHERE id=?", (jid,)))


def job_status(job_id, status, ergebnis=None):
    with db() as con:
        if status == "offen":
            con.execute("UPDATE jobs SET status='offen', started=NULL, finished=NULL, ergebnis=NULL "
                        "WHERE id=?", (job_id,))
        else:
            con.execute("UPDATE jobs SET status=?, ergebnis=?, finished=? WHERE id=?",
                        (status, ergebnis, now(), job_id))
        row = one(con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)))
    if not row:
        raise ApiError(404, "Job nicht gefunden")
    return row


def latest_job(files):
    """Von generierten Dateien nur die des neuesten Jobs (z. B. .pdf + .tex)."""
    last = max((f["job_id"] or 0 for f in files), default=None)
    return [f for f in files if (f["job_id"] or 0) == last]


def kontext_originale(con, item):
    """Neueste Originale der anderen Eintraege desselben Kurses."""
    return rows(con.execute(
        "SELECT f.*, i.art AS i_art, i.nummer AS i_nummer FROM files f "
        "JOIN items i ON f.item_id=i.id WHERE i.course_id=? AND i.id<>? "
        "AND f.rolle='original' AND f.id=(SELECT MAX(id) FROM files WHERE item_id=i.id AND rolle='original') "
        "ORDER BY i.datum", (item["course_id"], item["id"])))


def job_inputs(con, job, item):
    """Welche Dateien der Worker fuer einen Job herunterladen soll."""
    typ, owner = job["typ"], job["owner"]
    fs = rows(con.execute("SELECT * FROM files WHERE item_id=? ORDER BY id", (item["id"],)))

    def rolle(r, nur_owner=False):
        return [f for f in fs if f["rolle"] == r and (not nur_owner or f["owner"] == owner)]

    picks = []  # (unterordner, datei)
    add = lambda sub, lst: picks.extend((sub, f) for f in lst)
    add("aufgabe" if item["art"] != "skript" else "skript", rolle("original")[-1:])  # nur die neueste Version
    if typ == "aufbereiten":
        add("fotos", rolle("foto", True))
    elif typ == "vergleich":
        add("musterloesung", rolle("musterloesung"))
        add("fotos", rolle("foto", True))
        add("aufbereitet", latest_job(rolle("aufbereitet", True)))
    elif typ == "verbessern":
        add("vorherige_version", latest_job(rolle("verbessert")))
        add("kontext", kontext_originale(con, item))
    elif typ == "lang":
        add("verbessert", latest_job(rolle("verbessert")))
        add("vorherige_version", latest_job(rolle("lang")))
        add("kontext", kontext_originale(con, item))
    elif typ == "personalisieren":
        # Grundlage ist die ausfuehrlichste vorhandene Fassung: Lang, sonst Verbessert
        add("verbessert", latest_job(rolle("lang")) or latest_job(rolle("verbessert")))
        add("notizen", rolle("notiz", True))
        add("vergleich", latest_job(rolle("vergleich", True)))
        add("fotos", rolle("foto", True))
        add("vorherige_version", latest_job(rolle("fuer", True)))
    elif typ == "loesung":
        add("teile", rolle("loesungsteil"))
        add("vorherige_version", [f for f in latest_job(rolle("loesung")) if f["name"].endswith(".tex")])
    out = []
    for sub, f in picks:
        prefix = f"{f['owner']}_" if f["owner"] else ""
        if sub == "teile" and f.get("prio"):
            prefix = "prio_"
        if sub == "kontext":
            prefix = f"{f['i_art']}{f['i_nummer'] or ''}_"
        out.append({"id": f["id"], "pfad": f"{sub}/{prefix}{f['id']}_{f['name']}",
                    "url": f"/files/{f['id']}"})
    return out


# ---------------------------------------------------------------- Wissensbasis
def wissen_lesen(user):
    dateien = {rel: text for rel, text in store.wissen_alle().items()
               if not rel.startswith("personen/") or rel == f"personen/{user}.md"}  # Profile sind privat
    return {"dateien": dateien}


def wissen_schreiben(pfad, text, user):
    erlaubt = (pfad == "pruefkatalog.md" or pfad == f"personen/{user}.md"
               or re.fullmatch(r"kurse/[\w\-]+/[\w\-]+\.md", pfad))
    if not erlaubt or ".." in pfad:
        raise ApiError(403, f"{pfad} darf nicht automatisch geaendert werden")
    store.wissen_setzen(pfad, text, now())
    return {"ok": True}


def claim(user):
    # Ein einziges UPDATE, damit zwei gleichzeitige Anfragen nie denselben Job bekommen
    sperre = " FOR UPDATE SKIP LOCKED" if store.PG else ""
    with LOCK, db() as con:
        con.execute("INSERT INTO worker(nutzer,last_seen) VALUES(?,?) "
                    "ON CONFLICT(nutzer) DO UPDATE SET last_seen=excluded.last_seen", (user, now()))
        gemeinsam = ",".join(f"'{t}'" for t, (_, privat) in JOB_TYPEN.items() if not privat)
        # Mit mehreren Workern parallel: "lang" wartet auf "verbessern" desselben Eintrags,
        # "personalisieren" auf beide, sonst arbeiten sie mit einer veralteten Grundlage
        job = one(con.execute(
            "UPDATE jobs SET status='laeuft', started=?, owner=? WHERE id=(SELECT j.id FROM jobs j "
            f"WHERE j.status='offen' AND j.typ<>'personalisieren' AND (j.owner=? OR j.typ IN ({gemeinsam})) "
            "AND NOT EXISTS (SELECT 1 FROM jobs v WHERE v.item_id=j.item_id AND v.status IN ('offen','laeuft') "
            "AND ((j.typ='lang' AND v.typ='verbessern') "
            "OR (j.typ='personalisieren' AND v.typ IN ('verbessern','lang')))) "
            f"ORDER BY CASE WHEN j.owner=? THEN 0 ELSE 1 END, j.id LIMIT 1{sperre}) RETURNING *",
            (now(), user, user, user)))
        if not job:
            return None
        item = one(con.execute("SELECT * FROM items WHERE id=?", (job["item_id"],)))
        course = one(con.execute("SELECT * FROM courses WHERE id=?", (item["course_id"],)))
        inputs = job_inputs(con, job, item)
    rolle, privat = JOB_TYPEN[job["typ"]]
    return {"job": job, "item": item, "course": course, "inputs": inputs,
            "ausgabe": {"rolle": rolle, "owner": job["owner"] if privat else None}}


# ---------------------------------------------------------------- HTTP
class Handler(SimpleHTTPRequestHandler):
    server_version = "Wima/1.0"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=PUBLIC, **kw)

    def log_message(self, fmt, *args):
        if "/api/worker/claim" not in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def send_json(self, obj, status=200, extra=()):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)
        return True

    def body_bytes(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD:
            raise ApiError(413, f"Datei zu groß (höchstens {MAX_UPLOAD // (1024 * 1024)} MB)")
        return self.rfile.read(n) if n else b""

    def body_json(self):
        raw = self.body_bytes()
        return json.loads(raw) if raw else {}

    def token(self):
        auth = self.headers.get("Authorization") or ""
        if auth.startswith("Bearer "):
            return auth[7:].strip()
        c = SimpleCookie(self.headers.get("Cookie") or "")
        return c["wima"].value if "wima" in c else None

    def auth_user(self):
        worker = self.headers.get("X-Wima-Worker")
        if not ONLINE and worker in USERS and self.client_address[0] in ("127.0.0.1", "::1"):
            return worker  # lokaler Worker auf demselben Rechner
        return session_user(self.token())

    def send_login(self, res):
        cookie = f"wima={res['token']}; Path=/; Max-Age={COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax"
        return self.send_json(res, extra=[("Set-Cookie", cookie + ("; Secure" if ONLINE else ""))])

    def route(self, method):
        u = urlparse(self.path)
        p, qs = u.path.rstrip("/"), parse_qs(u.query)
        parts = p.split("/")[1:]
        m = lambda pattern: re.fullmatch(pattern, p)

        if not (p.startswith("/api") or m(r"/files/\d+")):
            return False
        if method == "GET" and p == "/api/health":
            return self.send_json({"ok": True, "speicher": "postgres" if store.PG else "sqlite",
                                   "dateien": "blob" if store.BLOB_TOKEN else "platte"})
        if method == "GET" and p == "/api/users":
            return self.send_json(users_info())
        if method == "POST" and p == "/api/login":
            return self.send_login(login(self.body_json()))
        user = self.auth_user()
        if not user:
            raise ApiError(401, "nicht angemeldet")
        if method == "POST" and p == "/api/logout":
            with db() as con:
                con.execute("DELETE FROM sessions WHERE token=?", (self.token(),))
            return self.send_json({"ok": True})
        if method == "GET" and m(r"/files/\d+"):
            return self.serve_file(int(parts[1]))

        if method == "GET" and p == "/api/state":
            return self.send_json(dict(state(user), user=user))
        if method == "PUT" and p == "/api/einstellungen":
            return self.send_json(einstellungen_setzen(user, self.body_json()))
        if method == "POST" and p == "/api/courses":
            return self.send_json(create_course(self.body_json()))
        if m(r"/api/courses/\d+"):
            cid = int(parts[2])
            if method == "PATCH":
                return self.send_json(update("courses", cid, pick(
                    self.body_json(), ["name", "kuerzel", "farbe", "semester", "pos"])))
            if method == "DELETE":
                return self.send_json(delete_with_files("courses", cid))
        if method == "GET" and m(r"/api/courses/\d+/items"):
            return self.send_json(course_items(int(parts[2]), user))
        if method == "POST" and p == "/api/items":
            return self.send_json(create_item(self.body_json()))
        if m(r"/api/items/\d+"):
            iid = int(parts[2])
            if method == "PATCH":
                return self.send_json(update("items", iid, pick(
                    self.body_json(), ["art", "nummer", "titel", "datum"])))
            if method == "DELETE":
                return self.send_json(delete_with_files("items", iid))
        if method == "POST" and p == "/api/upload":
            return self.send_json(save_upload(qs, self.body_bytes(), user))
        if method == "PATCH" and m(r"/api/files/\d+"):
            return self.send_json(set_prio(int(parts[2]), self.body_json()))
        if method == "DELETE" and m(r"/api/files/\d+"):
            return self.send_json(delete_file(int(parts[2])))
        if method == "GET" and p == "/api/notizen":
            return self.send_json(notizen_lesen(qs))
        if method == "PUT" and p == "/api/notizen":
            return self.send_json(notizen_schreiben(qs, self.body_bytes(), user))
        if method == "POST" and p == "/api/jobs":
            return self.send_json(create_job(self.body_json(), user))
        if method == "POST" and m(r"/api/jobs/\d+/(retry|done|fail)"):
            jid, action = int(parts[2]), parts[3]
            body = self.body_json()
            status = {"retry": "offen", "done": "fertig", "fail": "fehler"}[action]
            return self.send_json(job_status(jid, status, body.get("ergebnis")))
        if method == "DELETE" and m(r"/api/jobs/\d+"):
            with db() as con:
                con.execute("DELETE FROM jobs WHERE id=?", (int(parts[2]),))
            return self.send_json({"ok": True})
        if method == "GET" and p == "/api/wissen":
            return self.send_json(wissen_lesen(user))
        if method == "PUT" and p == "/api/wissen":
            return self.send_json(wissen_schreiben(qs.get("pfad", [""])[0],
                                                   self.body_bytes().decode("utf-8"), user))
        if method == "POST" and p == "/api/worker/claim":
            res = claim(user)
            if res is None:
                self.send_response(204)
                self.end_headers()
                return True
            return self.send_json(res)
        raise ApiError(404, "unbekannter Endpunkt")

    def serve_file(self, fid):
        with db() as con:
            f = one(con.execute("SELECT * FROM files WHERE id=?", (fid,)))
        data = f and f["pfad"] and store.datei_lesen(f["pfad"])
        if not data:
            raise ApiError(404, "Datei nicht gefunden")
        self.send_response(200)
        mime = f["mime"]
        if mime.startswith("text/") or f["name"].endswith((".md", ".tex")):
            mime = ("text/markdown" if f["name"].endswith(".md") else "text/plain") + "; charset=utf-8"
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", f"inline; filename*=UTF-8''{quote(f['name'])}")
        self.send_header("Cache-Control", "private, max-age=3600")
        self.end_headers()
        self.wfile.write(data)
        return True

    def handle_any(self, method):
        try:
            if self.route(method) is False:
                if method == "GET":
                    return super().do_GET()
                self.send_json({"error": "nicht erlaubt"}, 405)
        except ApiError as e:
            self.send_json({"error": str(e), **e.extra}, e.status)
        except (ValueError, KeyError, TypeError) as e:
            self.send_json({"error": f"Ungueltige Anfrage: {e}"}, 400)
        except Exception as e:  # z. B. Datenbank oder Blob nicht erreichbar
            self.log_error("Fehler bei %s %s: %r", method, self.path, e)
            self.send_json({"error": f"Serverfehler: {type(e).__name__}: {e}"}, 500)

    def do_GET(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")

    def do_PATCH(self):
        self.handle_any("PATCH")

    def do_DELETE(self):
        self.handle_any("DELETE")

    def do_PUT(self):
        self.handle_any("PUT")


class Server(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=int(os.environ.get("WIMA_PORT", 8790)))
    ap.add_argument("--lan", action="store_true", help="auf 0.0.0.0 lauschen (WLAN)")
    args = ap.parse_args()
    store.init_db()
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    print(f"Wima laeuft auf http://{'<deine-IP>' if args.lan else '127.0.0.1'}:{args.port}  (Nutzer: {', '.join(USERS)})")
    Server((host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
