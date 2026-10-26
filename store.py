# -*- coding: utf-8 -*-
"""
Speicher fuer Wima, je nach Umgebung:

  lokal (Standard)             SQLite data/wima.db, Dateien in data/files/, Wissen in wissen/
  DATABASE_URL gesetzt         Postgres (Neon) statt SQLite, Wissen in der Tabelle "wissen"
  BLOB_READ_WRITE_TOKEN        Dateien im privaten Vercel-Blob-Store statt data/files/

Auf Vercel sind beide Variablen gesetzt (Integrationen Neon und Blob). Die SQL-Befehle in
server.py sind in SQLite-Schreibweise mit ?-Platzhaltern; fuer Postgres werden sie hier
umgeschrieben.
"""

import json
import os
import re
import sqlite3
import urllib.parse
import urllib.request
from contextlib import contextmanager

DIR = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(DIR, "data")
FILES = os.path.join(DATA, "files")
DB_PATH = os.path.join(DATA, "wima.db")
WISSEN = os.path.join(DIR, "wissen")

DB_URL = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or ""
BLOB_TOKEN = os.environ.get("BLOB_READ_WRITE_TOKEN") or ""
PG = bool(DB_URL)

# Diese Wissensdateien kommen immer aus dem Repo (nur Carl aendert sie, per Commit).
WISSEN_FEST = ("didaktik.md", "README.md")

SCHEMA = """
CREATE TABLE IF NOT EXISTS courses(
  id {ID}, name TEXT NOT NULL, kuerzel TEXT, farbe TEXT,
  semester TEXT, pos INTEGER DEFAULT 0, created TEXT,
  owner TEXT);  -- NULL = fuer alle, sonst nur fuer diesen Nutzer
CREATE TABLE IF NOT EXISTS items(
  id {ID},
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  art TEXT NOT NULL, nummer TEXT, titel TEXT, datum TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS files(
  id {ID},
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  rolle TEXT NOT NULL, owner TEXT, name TEXT, mime TEXT, pfad TEXT,
  groesse INTEGER, job_id INTEGER, created TEXT,
  prio INTEGER DEFAULT 0);  -- 1 = beim Job "loesung" vorziehen (z. B. Lehrerloesung)
CREATE TABLE IF NOT EXISTS jobs(
  id {ID},
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  typ TEXT NOT NULL, owner TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offen',
  hinweis TEXT, ergebnis TEXT, created TEXT, started TEXT, finished TEXT);
CREATE TABLE IF NOT EXISTS worker(nutzer TEXT PRIMARY KEY, last_seen TEXT);
CREATE TABLE IF NOT EXISTS logins(nutzer TEXT PRIMARY KEY, salt TEXT, hash TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, nutzer TEXT NOT NULL, created TEXT);
CREATE TABLE IF NOT EXISTS wissen(pfad TEXT PRIMARY KEY, text TEXT NOT NULL, geaendert TEXT);
"""


# ---------------------------------------------------------------- Datenbank
class Con:
    """Duenne Huelle, damit server.py fuer SQLite und Postgres gleich aussieht."""

    def __init__(self, raw):
        self.raw = raw

    def execute(self, sql, params=()):
        if PG:
            cur = self.raw.cursor()
            cur.execute(sql.replace("?", "%s"), params)
            return cur
        return self.raw.execute(sql, params)


_pg = None


def _pg_connect():
    global _pg
    import psycopg
    from psycopg.rows import dict_row
    if _pg is None or _pg.closed:
        _pg = psycopg.connect(DB_URL, row_factory=dict_row)
    return _pg


@contextmanager
def db():
    """Eine Transaktion: Commit bei Erfolg, Rollback bei Fehler."""
    if PG:
        import psycopg
        try:
            raw = _pg_connect()
            raw.execute("SELECT 1")
        except psycopg.OperationalError:  # Neon hat die Verbindung nach dem Schlafen beendet
            global _pg
            _pg = None
            raw = _pg_connect()
    else:
        raw = sqlite3.connect(DB_PATH, timeout=10)
        raw.row_factory = sqlite3.Row
        raw.execute("PRAGMA foreign_keys = ON")
    try:
        yield Con(raw)
        raw.commit()
    except BaseException:
        raw.rollback()
        raise
    finally:
        if not PG:
            raw.close()


def rows(cur):
    return [dict(r) for r in cur.fetchall()]


def one(cur):
    r = cur.fetchone()
    return dict(r) if r is not None else None


def init_db():
    if PG:
        with db() as con:
            con.raw.execute(SCHEMA.replace("{ID}", "BIGSERIAL PRIMARY KEY"))
            con.raw.execute("ALTER TABLE files ADD COLUMN IF NOT EXISTS prio INTEGER DEFAULT 0")
        return
    os.makedirs(FILES, exist_ok=True)
    with db() as con:
        cols = lambda t: [r[1] for r in con.raw.execute(f"PRAGMA table_info({t})")]
        # Aeltere lokale Datenbanken: Spalte "user" hiess frueher so (in Postgres reserviert)
        for t in ("worker", "logins", "sessions"):
            if "user" in cols(t):
                con.raw.execute(f'ALTER TABLE {t} RENAME COLUMN "user" TO nutzer')
        con.raw.executescript(SCHEMA.replace("{ID}", "INTEGER PRIMARY KEY"))
        if "owner" not in cols("courses"):
            con.raw.execute("ALTER TABLE courses ADD COLUMN owner TEXT")
        if "prio" not in cols("files"):
            con.raw.execute("ALTER TABLE files ADD COLUMN prio INTEGER DEFAULT 0")


# ---------------------------------------------------------------- Dateien
def _blob_headers():
    return {"authorization": "Bearer " + BLOB_TOKEN, "x-api-version": "13",
            "x-vercel-blob-store-id": BLOB_TOKEN.split("_")[3]}


def datei_speichern(fid, name, data, mime):
    """Legt die Datei ab und gibt den Wert fuer files.pfad zurueck."""
    pfad = f"{fid}_{name}"
    if not BLOB_TOKEN:
        with open(os.path.join(FILES, pfad), "wb") as fh:
            fh.write(data)
        return pfad
    req = urllib.request.Request(
        "https://vercel.com/api/blob/?" + urllib.parse.urlencode({"pathname": f"files/{pfad}"}),
        data=data, method="PUT",
        headers=dict(_blob_headers(), **{"x-vercel-blob-access": "private", "x-add-random-suffix": "1",
                                        "x-content-type": mime}))
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["url"]


def datei_lesen(pfad):
    if pfad.startswith("https://"):
        req = urllib.request.Request(pfad, headers={"authorization": "Bearer " + BLOB_TOKEN})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()
    path = os.path.join(FILES, pfad)
    if not os.path.exists(path):
        return None
    with open(path, "rb") as fh:
        return fh.read()


def dateien_loeschen(pfade):
    urls = [p for p in pfade if p and p.startswith("https://")]
    for p in pfade:
        if p and not p.startswith("https://"):
            try:
                os.remove(os.path.join(FILES, p))
            except OSError:
                pass
    if urls and BLOB_TOKEN:
        req = urllib.request.Request("https://vercel.com/api/blob/delete", method="POST",
                                     data=json.dumps({"urls": urls}).encode(),
                                     headers=dict(_blob_headers(), **{"content-type": "application/json"}))
        urllib.request.urlopen(req, timeout=30).close()


# ---------------------------------------------------------------- Wissensbasis
def _wissen_dateien():
    out = {}
    for root, _, names in os.walk(WISSEN):
        for n in names:
            if n.endswith(".md"):
                rel = os.path.relpath(os.path.join(root, n), WISSEN)
                with open(os.path.join(WISSEN, rel), encoding="utf-8") as fh:
                    out[rel] = fh.read()
    return out


def wissen_alle():
    """Alle Wissensdateien {pfad: text}. In Postgres zaehlt die Datenbank, das Repo ist
    nur der Startwert; didaktik.md und README.md kommen immer aus dem Repo."""
    dateien = _wissen_dateien()
    if not PG:
        return dateien
    with db() as con:
        for r in con.execute("SELECT pfad, text FROM wissen"):
            if r["pfad"] not in WISSEN_FEST:
                dateien[r["pfad"]] = r["text"]
    return dateien


def wissen_setzen(pfad, text, zeit):
    if not PG:
        ziel = os.path.join(WISSEN, pfad)
        os.makedirs(os.path.dirname(ziel), exist_ok=True)
        with open(ziel, "w", encoding="utf-8") as fh:
            fh.write(text)
        return
    with db() as con:
        con.execute("INSERT INTO wissen(pfad,text,geaendert) VALUES(?,?,?) "
                    "ON CONFLICT(pfad) DO UPDATE SET text=excluded.text, geaendert=excluded.geaendert",
                    (pfad, text, zeit))
