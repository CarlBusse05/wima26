# -*- coding: utf-8 -*-
"""
Setzt das Wima-Passwort eines Nutzers von Hand (online: Postgres aus .env.local).

  uv run --python 3.12 --with "psycopg[binary]" tools/passwort.py Carl
"""

import getpass
import os
import secrets
import sys

DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for zeile in open(os.path.join(DIR, ".env.local"), encoding="utf-8"):
    if "=" in zeile and not zeile.startswith("#"):
        k, v = zeile.rstrip("\n").split("=", 1)
        os.environ.setdefault(k, v.strip('"'))
sys.path.insert(0, DIR)

import store                      # noqa: E402
from server import USERS, pw_hash  # noqa: E402

user = next((u for u in USERS if u.lower() == sys.argv[1].lower()), None) if len(sys.argv) > 1 else None
if not user:
    sys.exit(f"Nutzung: tools/passwort.py <{'|'.join(USERS)}>")
passwort = getpass.getpass(f"Neues Passwort für {user}: ")
salt = secrets.token_hex(16)
with store.db() as con:
    con.execute("INSERT INTO logins(nutzer,salt,hash) VALUES(?,?,?) ON CONFLICT(nutzer) "
                "DO UPDATE SET salt=excluded.salt, hash=excluded.hash", (user, salt, pw_hash(passwort, salt)))
print(f"Passwort für {user} gesetzt.")
