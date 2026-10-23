#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wima — lokale Lernplattform fuer Wirtschaftsmathematik (Carl & Emil).

Statische Dateien aus ./public + JSON-API + Job-Queue. Die agentischen Aufgaben
(Loesung aufbereiten, Vergleich, Skript verbessern, Herden-Skript) erledigt
NICHT der Server, sondern der Worker (worker.py) jedes Nutzers mit seiner
eigenen lokalen Claude-Installation. Der Server verteilt nur Jobs und Dateien.

  python3 server.py                  startet http://127.0.0.1:8790
  python3 server.py --port 9000      anderer Port
  python3 server.py --lan            auch im WLAN erreichbar (Handy-Upload, Emil)

API (alles ausser /api/users und /api/login braucht eine Anmeldung:
Cookie "wima", "Authorization: Bearer <token>" oder — nur von 127.0.0.1 —
der Header "X-Wima-Worker: <Name>" fuer den lokalen Worker):
  GET    /api/users                      -> {users:[{name, hat_passwort}]}
  POST   /api/login                      <- {user, passwort}  (erstes Mal: legt Passwort fest)
  POST   /api/logout
  GET    /api/state                      -> {users, courses, worker}
  POST   /api/courses                    <- {name, kuerzel, farbe, semester}
  PATCH  /api/courses/<id>               <- Teilfelder
  DELETE /api/courses/<id>
  GET    /api/courses/<id>/items         -> {items:[{..., files:[], jobs:[]}]}
  POST   /api/items                      <- {course_id, art, nummer, titel, datum}
  PATCH  /api/items/<id>                 <- Teilfelder
  DELETE /api/items/<id>
  POST   /api/upload?item=&rolle=&owner=&name=[&job=]   Body = rohe Datei
  DELETE /api/files/<id>
  GET    /files/<id>                     Datei selbst
  POST   /api/jobs                       <- {item_id, typ, owner, hinweis}
  POST   /api/jobs/<id>/retry | /done | /fail
  DELETE /api/jobs/<id>
  POST   /api/worker/claim               -> {job, kontext, inputs} oder 204
  GET    /api/wissen                     -> {dateien:{pfad: text}}  (fremde Fehlerprofile ausgenommen)
  PUT    /api/wissen?pfad=               Body = Text; nur pruefkatalog.md, kurse/**, personen/<ich>.md

Automatik: Neues Original -> Job "verbessern" (Worker von WIMA_HAUPT, Standard: erster Nutzer);
"verbessern"/"lang" fertig -> "personalisieren" fuer alle; "vergleich" fertig -> "personalisieren".

Alle Daten liegen in ./data (wima.db + files/). Die Anmeldung trennt Carl und Emil,
ist aber kein Schutz fuer offene Netze: nur localhost bzw. ein vertrauenswuerdiges WLAN.
"""

import argparse
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
from datetime import datetime
from http.cookies import SimpleCookie
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs, quote

DIR = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(DIR, "data")
FILES = os.path.join(DATA, "files")
DB_PATH = os.path.join(DATA, "wima.db")
PUBLIC = os.path.join(DIR, "public")
WISSEN = os.path.join(DIR, "wissen")

USERS = [u.strip() for u in os.environ.get("WIMA_USERS", "Carl,Emil").split(",") if u.strip()]
ARTEN = ["skript", "uebung", "tutorium", "sonstiges"]
HAUPT = os.environ.get("WIMA_HAUPT") or USERS[0]  # erledigt die gemeinsamen Jobs
ROLLEN = ["original", "musterloesung", "verbessert", "lang", "fuer", "foto", "notiz",
          "aufbereitet", "vergleich", "begleitskript", "herde"]
JOB_TYPEN = {
    # typ: Rolle der Ergebnisdateien, Ergebnis gehoert dem Nutzer (False = allen)
    "aufbereiten":       ("aufbereitet", True),
    "vergleich":         ("vergleich", True),
    "verbessern":        ("verbessert", False),
    "lang":              ("lang", False),
    "personalisieren":   ("fuer", True),
}
MAX_UPLOAD = 200 * 1024 * 1024
LOCK = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS courses(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kuerzel TEXT, farbe TEXT,
  semester TEXT, pos INTEGER DEFAULT 0, created TEXT,
  owner TEXT);  -- NULL = fuer alle, sonst nur fuer diesen Nutzer
CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  art TEXT NOT NULL, nummer TEXT, titel TEXT, datum TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  rolle TEXT NOT NULL, owner TEXT, name TEXT, mime TEXT, pfad TEXT,
  groesse INTEGER, job_id INTEGER, created TEXT);
CREATE TABLE IF NOT EXISTS jobs(
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  typ TEXT NOT NULL, owner TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offen',
  hinweis TEXT, ergebnis TEXT, created TEXT, started TEXT, finished TEXT);
CREATE TABLE IF NOT EXISTS worker(user TEXT PRIMARY KEY, last_seen TEXT);
CREATE TABLE IF NOT EXISTS logins(user TEXT PRIMARY KEY, salt TEXT, hash TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user TEXT NOT NULL, created TEXT);
"""
COOKIE_MAX_AGE = 365 * 24 * 3600


def now():
    return datetime.now().isoformat(timespec="seconds")


def db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init_db():
    os.makedirs(FILES, exist_ok=True)
    with db() as con:
        con.executescript(SCHEMA)
        if "owner" not in [r[1] for r in con.execute("PRAGMA table_info(courses)")]:
            con.execute("ALTER TABLE courses ADD COLUMN owner TEXT")


def rows(cur):
    return [dict(r) for r in cur.fetchall()]


def safe_name(name):
    name = os.path.basename(name or "datei")
    name = re.sub(r"[^\w.\-äöüÄÖÜß ]+", "_", name).strip() or "datei"
    return name[:120]


class ApiError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


# ---------------------------------------------------------------- Anmeldung
def pw_hash(passwort, salt):
    return hashlib.pbkdf2_hmac("sha256", passwort.encode(), bytes.fromhex(salt), 200_000).hex()


def users_info():
    with db() as con:
        gesetzt = {r["user"] for r in con.execute("SELECT user FROM logins")}
    return {"users": [{"name": u, "hat_passwort": u in gesetzt} for u in USERS]}


def login(body):
    user, passwort = body.get("user"), body.get("passwort") or ""
    if user not in USERS:
        raise ApiError(400, "unbekannter Nutzer")
    if len(passwort) < 4:
        raise ApiError(400, "Passwort zu kurz (mind. 4 Zeichen)")
    with db() as con:
        row = con.execute("SELECT * FROM logins WHERE user=?", (user,)).fetchone()
        if row is None:  # erste Anmeldung legt das Passwort fest
            salt = secrets.token_hex(16)
            con.execute("INSERT INTO logins(user,salt,hash) VALUES(?,?,?)", (user, salt, pw_hash(passwort, salt)))
        elif not hmac.compare_digest(row["hash"], pw_hash(passwort, row["salt"])):
            raise ApiError(401, "Falsches Passwort")
        token = secrets.token_urlsafe(32)
        con.execute("INSERT INTO sessions(token,user,created) VALUES(?,?,?)", (token, user, now()))
    return {"user": user, "token": token}


def session_user(token):
    if not token:
        return None
    with db() as con:
        row = con.execute("SELECT user FROM sessions WHERE token=?", (token,)).fetchone()
    return row["user"] if row and row["user"] in USERS else None


# ---------------------------------------------------------------- Logik
def state(user):
    with db() as con:
        courses = rows(con.execute("SELECT * FROM courses WHERE owner IS NULL OR owner=? ORDER BY pos, id",
                                   (user,)))
        worker = {r["user"]: r["last_seen"] for r in con.execute("SELECT * FROM worker")}
    return {"users": USERS, "arten": ARTEN, "courses": courses, "worker": worker, "now": now()}


def course_items(course_id):
    with db() as con:
        items = rows(con.execute(
            "SELECT * FROM items WHERE course_id=? ORDER BY datum DESC, id DESC", (course_id,)))
        ids = [i["id"] for i in items] or [-1]
        marks = ",".join("?" * len(ids))
        files = rows(con.execute(
            f"SELECT id,item_id,rolle,owner,name,mime,groesse,job_id,created FROM files "
            f"WHERE item_id IN ({marks}) ORDER BY id", ids))
        jobs = rows(con.execute(
            f"SELECT * FROM jobs WHERE item_id IN ({marks}) ORDER BY id DESC", ids))
    by_id = {i["id"]: dict(i, files=[], jobs=[]) for i in items}
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
        cur = con.execute(
            "INSERT INTO courses(name,kuerzel,farbe,semester,pos,created,owner) VALUES(?,?,?,?,?,?,?)",
            (body["name"].strip(), body.get("kuerzel"), body.get("farbe"),
             body.get("semester"), body.get("pos", 0), now(), body.get("owner")))
        return dict(con.execute("SELECT * FROM courses WHERE id=?", (cur.lastrowid,)).fetchone())


def update(table, row_id, fields):
    if not fields:
        raise ApiError(400, "keine Felder")
    sets = ", ".join(f"{k}=?" for k in fields)
    with db() as con:
        con.execute(f"UPDATE {table} SET {sets} WHERE id=?", (*fields.values(), row_id))
        row = con.execute(f"SELECT * FROM {table} WHERE id=?", (row_id,)).fetchone()
    if not row:
        raise ApiError(404, "nicht gefunden")
    return dict(row)


def delete_with_files(table, row_id):
    """Loescht Kurs/Eintrag/Datei samt Dateien auf der Platte."""
    q = {
        "courses": "SELECT f.pfad FROM files f JOIN items i ON f.item_id=i.id WHERE i.course_id=?",
        "items": "SELECT pfad FROM files WHERE item_id=?",
        "files": "SELECT pfad FROM files WHERE id=?",
    }[table]
    with db() as con:
        paths = [r["pfad"] for r in con.execute(q, (row_id,))]
        con.execute(f"DELETE FROM {table} WHERE id=?", (row_id,))
    for p in paths:
        try:
            os.remove(os.path.join(FILES, p))
        except OSError:
            pass
    return {"ok": True}


def create_item(body):
    if body.get("art") not in ARTEN:
        raise ApiError(400, f"art muss eins von {ARTEN} sein")
    with db() as con:
        cur = con.execute(
            "INSERT INTO items(course_id,art,nummer,titel,datum,created) VALUES(?,?,?,?,?,?)",
            (body["course_id"], body["art"], body.get("nummer"), body.get("titel"),
             body.get("datum") or datetime.now().date().isoformat(), now()))
        return dict(con.execute("SELECT * FROM items WHERE id=?", (cur.lastrowid,)).fetchone())


def save_upload(qs, data, user):
    item = int(qs.get("item", ["0"])[0])
    rolle = qs.get("rolle", [""])[0]
    owner = user if qs.get("owner", [""])[0] else None  # private Dateien gehoeren immer dem Angemeldeten
    job = qs.get("job", [""])[0] or None
    name = safe_name(qs.get("name", ["datei"])[0])
    if rolle not in ROLLEN:
        raise ApiError(400, f"rolle muss eins von {ROLLEN} sein")
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    with db() as con:
        if not con.execute("SELECT 1 FROM items WHERE id=?", (item,)).fetchone():
            raise ApiError(404, "Eintrag nicht gefunden")
        cur = con.execute(
            "INSERT INTO files(item_id,rolle,owner,name,mime,groesse,job_id,created) "
            "VALUES(?,?,?,?,?,?,?,?)", (item, rolle, owner, name, mime, len(data), job, now()))
        fid = cur.lastrowid
        pfad = f"{fid}_{name}"
        with open(os.path.join(FILES, pfad), "wb") as fh:
            fh.write(data)
        con.execute("UPDATE files SET pfad=? WHERE id=?", (pfad, fid))
        if rolle == "original" and not job:
            queue_job(con, item, "verbessern", HAUPT)
        return dict(con.execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone())


def queue_job(con, item_id, typ, owner, hinweis=None):
    """Legt einen Job an, ausser es wartet schon derselbe (dann zaehlt der)."""
    row = con.execute("SELECT id FROM jobs WHERE item_id=? AND typ=? AND owner=? AND status='offen'",
                      (item_id, typ, owner)).fetchone()
    if row:
        return row["id"]
    return con.execute("INSERT INTO jobs(item_id,typ,owner,hinweis,created) VALUES(?,?,?,?,?)",
                       (item_id, typ, owner, hinweis, now())).lastrowid


def create_job(body, user):
    if body.get("typ") not in JOB_TYPEN:
        raise ApiError(400, f"typ muss eins von {list(JOB_TYPEN)} sein")
    owner = HAUPT if not JOB_TYPEN[body["typ"]][1] else user  # gemeinsame Jobs macht HAUPT
    with db() as con:
        jid = queue_job(con, body["item_id"], body["typ"], owner, body.get("hinweis"))
        return dict(con.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone())


def folgejobs(con, job):
    # "lang" startet (noch) nicht automatisch, erst testen wir es an Stochastik
    if job["typ"] in ("verbessern", "lang"):
        owner = con.execute("SELECT c.owner FROM courses c JOIN items i ON i.course_id=c.id WHERE i.id=?",
                            (job["item_id"],)).fetchone()["owner"]
        for u in ([owner] if owner else USERS):
            queue_job(con, job["item_id"], "personalisieren", u)
    elif job["typ"] == "vergleich":
        queue_job(con, job["item_id"], "personalisieren", job["owner"])


def job_status(job_id, status, ergebnis=None):
    with db() as con:
        if status == "offen":
            con.execute("UPDATE jobs SET status='offen', started=NULL, finished=NULL, ergebnis=NULL "
                        "WHERE id=?", (job_id,))
        else:
            con.execute("UPDATE jobs SET status=?, ergebnis=?, finished=? WHERE id=?",
                        (status, ergebnis, now(), job_id))
        row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if row and status == "fertig":
            folgejobs(con, row)
    if not row:
        raise ApiError(404, "Job nicht gefunden")
    return dict(row)


def latest_job(files):
    """Von generierten Dateien nur die des neuesten Jobs (z. B. .pdf + .tex)."""
    last = max((f["job_id"] or 0 for f in files), default=None)
    return [f for f in files if (f["job_id"] or 0) == last]


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
        kontext = rows(con.execute(
            "SELECT f.*, i.art AS i_art, i.nummer AS i_nummer FROM files f "
            "JOIN items i ON f.item_id=i.id WHERE i.course_id=? AND i.id<>? "
            "AND f.rolle='original' AND f.id=(SELECT MAX(id) FROM files WHERE item_id=i.id AND rolle='original') "
            "ORDER BY i.datum", (item["course_id"], item["id"])))
        add("kontext", kontext)
    elif typ == "lang":
        add("verbessert", latest_job(rolle("verbessert")))
        add("vorherige_version", latest_job(rolle("lang")))
        kontext = rows(con.execute(
            "SELECT f.*, i.art AS i_art, i.nummer AS i_nummer FROM files f "
            "JOIN items i ON f.item_id=i.id WHERE i.course_id=? AND i.id<>? "
            "AND f.rolle='original' AND f.id=(SELECT MAX(id) FROM files WHERE item_id=i.id AND rolle='original') "
            "ORDER BY i.datum", (item["course_id"], item["id"])))
        add("kontext", kontext)
    elif typ == "personalisieren":
        # Grundlage ist die ausfuehrlichste vorhandene Fassung: Lang, sonst Verbessert
        add("verbessert", latest_job(rolle("lang")) or latest_job(rolle("verbessert")))
        add("notizen", rolle("notiz", True))
        add("vergleich", latest_job(rolle("vergleich", True)))
        add("fotos", rolle("foto", True))
        add("vorherige_version", latest_job(rolle("fuer", True)))
    out = []
    for sub, f in picks:
        prefix = f"{f['owner']}_" if f["owner"] else ""
        if sub == "kontext":
            prefix = f"{f['i_art']}{f['i_nummer'] or ''}_"
        out.append({"id": f["id"], "pfad": f"{sub}/{prefix}{f['id']}_{f['name']}",
                    "url": f"/files/{f['id']}"})
    return out


# ---------------------------------------------------------------- Wissensbasis
def wissen_lesen(user):
    out = {}
    for root, _, names in os.walk(WISSEN):
        for n in names:
            if not n.endswith(".md"):
                continue
            rel = os.path.relpath(os.path.join(root, n), WISSEN)
            if rel.startswith("personen/") and rel != f"personen/{user}.md":
                continue  # Fehlerprofile sind privat
            with open(os.path.join(WISSEN, rel), encoding="utf-8") as fh:
                out[rel] = fh.read()
    return {"dateien": out}


def wissen_schreiben(pfad, text, user):
    erlaubt = (pfad == "pruefkatalog.md" or pfad == f"personen/{user}.md"
               or re.fullmatch(r"kurse/[\w\-]+/[\w\-]+\.md", pfad))
    if not erlaubt or ".." in pfad:
        raise ApiError(403, f"{pfad} darf nicht automatisch geaendert werden")
    ziel = os.path.join(WISSEN, pfad)
    os.makedirs(os.path.dirname(ziel), exist_ok=True)
    with open(ziel, "w", encoding="utf-8") as fh:
        fh.write(text)
    return {"ok": True}


def claim(user):
    with LOCK, db() as con:
        con.execute("INSERT INTO worker(user,last_seen) VALUES(?,?) "
                    "ON CONFLICT(user) DO UPDATE SET last_seen=excluded.last_seen", (user, now()))
        job = con.execute("SELECT * FROM jobs WHERE status='offen' AND owner=? ORDER BY id LIMIT 1",
                          (user,)).fetchone()
        if not job:
            return None
        con.execute("UPDATE jobs SET status='laeuft', started=? WHERE id=?", (now(), job["id"]))
        job = dict(job, status="laeuft")
        item = dict(con.execute("SELECT * FROM items WHERE id=?", (job["item_id"],)).fetchone())
        course = dict(con.execute("SELECT * FROM courses WHERE id=?", (item["course_id"],)).fetchone())
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

    def send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def body_bytes(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD:
            raise ApiError(413, "Datei zu gross")
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
        if worker in USERS and self.client_address[0] in ("127.0.0.1", "::1"):
            return worker  # lokaler Worker auf demselben Rechner
        return session_user(self.token())

    def send_login(self, res):
        data = json.dumps(res, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Set-Cookie", f"wima={res['token']}; Path=/; Max-Age={COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax")
        self.end_headers()
        self.wfile.write(data)
        return True

    def route(self, method):
        u = urlparse(self.path)
        p, qs = u.path.rstrip("/"), parse_qs(u.query)
        parts = p.split("/")[1:]
        m = lambda pattern: re.fullmatch(pattern, p)

        if not (p.startswith("/api") or m(r"/files/\d+")):
            return False
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
            return self.send_json(course_items(int(parts[2])))
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
        if method == "DELETE" and m(r"/api/files/\d+"):
            return self.send_json(delete_with_files("files", int(parts[2])))
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
            f = con.execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone()
        path = f and os.path.join(FILES, f["pfad"])
        if not path or not os.path.exists(path):
            raise ApiError(404, "Datei nicht gefunden")
        with open(path, "rb") as fh:
            data = fh.read()
        self.send_response(200)
        mime = f["mime"]
        if mime.startswith("text/") or f["name"].endswith((".md", ".tex")):
            mime = ("text/markdown" if f["name"].endswith(".md") else "text/plain") + "; charset=utf-8"
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", f"inline; filename*=UTF-8''{quote(f['name'])}")
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
            self.send_json({"error": str(e)}, e.status)
        except (ValueError, KeyError, sqlite3.IntegrityError) as e:
            self.send_json({"error": f"Ungueltige Anfrage: {e}"}, 400)

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
    init_db()
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    print(f"Wima laeuft auf http://{'<deine-IP>' if args.lan else '127.0.0.1'}:{args.port}  (Nutzer: {', '.join(USERS)})")
    Server((host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
