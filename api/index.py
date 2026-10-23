# -*- coding: utf-8 -*-
"""
Einziger Einstiegspunkt fuer Vercel (festgelegt in pyproject.toml unter [tool.vercel]).

Vercel liefert public/ als statische Dateien aus und leitet alles andere — /api/... und
/files/... — mit dem urspruenglichen Pfad hierher. Die Logik steckt in server.py, der
Speicher (Postgres + Blob) in store.py.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import store                                        # noqa: E402
from server import Handler                          # noqa: E402

store.init_db()  # einmal pro Kaltstart; CREATE TABLE IF NOT EXISTS ist billig


class handler(Handler):
    pass
