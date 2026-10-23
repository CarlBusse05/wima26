# -*- coding: utf-8 -*-
"""
Einmaliger Umzug: lokale Daten (data/wima.db, data/files/, wissen/) -> Postgres + Vercel Blob.

  vercel env pull .env.local            # DATABASE_URL und BLOB_READ_WRITE_TOKEN holen
  uv run --python 3.12 --with "psycopg[binary]" tools/migrieren.py

Die ids bleiben erhalten (Dateien verweisen auf Jobs). Laeuft nur gegen eine leere
Online-Datenbank, damit nichts doppelt angelegt wird. Sitzungen werden nicht uebernommen:
Online meldet man sich einmal neu an, die Passwoerter bleiben dieselben.
"""

import os
import sqlite3
import sys

DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for zeile in open(os.path.join(DIR, ".env.local"), encoding="utf-8"):
    if "=" in zeile and not zeile.startswith("#"):
        k, v = zeile.rstrip("\n").split("=", 1)
        os.environ.setdefault(k, v.strip('"'))
sys.path.insert(0, DIR)

import store  # noqa: E402  (liest die Umgebung beim Import)

assert store.PG and store.BLOB_TOKEN, "DATABASE_URL oder BLOB_READ_WRITE_TOKEN fehlt"

lokal = sqlite3.connect(os.path.join(DIR, "data", "wima.db"))
lokal.row_factory = sqlite3.Row
spalten = lambda t: [r[1] for r in lokal.execute(f"PRAGMA table_info({t})")]
nutzer = lambda t: "nutzer" if "nutzer" in spalten(t) else '"user"'

store.init_db()
with store.db() as con:
    if store.one(con.execute("SELECT COUNT(*) AS n FROM courses"))["n"]:
        sys.exit("Online-Datenbank ist nicht leer, Abbruch.")

    def kopieren(tabelle, felder):
        n = 0
        for r in lokal.execute(f"SELECT * FROM {tabelle} ORDER BY id"):
            werte = [r[f] for f in felder]
            con.execute(f"INSERT INTO {tabelle}({','.join(felder)}) VALUES({','.join('?' * len(felder))})", werte)
            n += 1
        con.execute(f"SELECT setval(pg_get_serial_sequence('{tabelle}','id'), "
                    f"GREATEST((SELECT MAX(id) FROM {tabelle}), 1))")
        print(f"{tabelle}: {n}")

    kopieren("courses", ["id", "name", "kuerzel", "farbe", "semester", "pos", "created", "owner"])
    kopieren("items", ["id", "course_id", "art", "nummer", "titel", "datum", "created"])
    kopieren("jobs", ["id", "item_id", "typ", "owner", "status", "hinweis", "ergebnis",
                      "created", "started", "finished"])

    n = 0
    for f in lokal.execute("SELECT * FROM files ORDER BY id"):
        with open(os.path.join(store.FILES, f["pfad"]), "rb") as fh:
            daten = fh.read()
        url = store.datei_speichern(f["id"], f["name"], daten, f["mime"])
        con.execute("INSERT INTO files(id,item_id,rolle,owner,name,mime,pfad,groesse,job_id,created) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (f["id"], f["item_id"], f["rolle"], f["owner"], f["name"], f["mime"], url,
                     len(daten), f["job_id"], f["created"]))
        n += 1
    con.execute("SELECT setval(pg_get_serial_sequence('files','id'), (SELECT MAX(id) FROM files))")
    print(f"files: {n} (in Blob hochgeladen)")

    sp = nutzer("logins")
    for r in lokal.execute(f"SELECT {sp} AS nutzer, salt, hash FROM logins"):
        con.execute("INSERT INTO logins(nutzer,salt,hash) VALUES(?,?,?)", (r["nutzer"], r["salt"], r["hash"]))
        print(f"login: {r['nutzer']}")

    for rel, text in store._wissen_dateien().items():
        if rel not in store.WISSEN_FEST:
            con.execute("INSERT INTO wissen(pfad,text,geaendert) VALUES(?,?,NOW()::text)", (rel, text))
            print(f"wissen: {rel}")
print("fertig")
