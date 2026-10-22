# /// script
# requires-python = ">=3.10"
# dependencies = ["opencv-python-headless>=4.8", "numpy>=1.24"]
# ///
"""
Handschrift-Fotos fuer die Abgabe aufbereiten. Aufruf ueber `uv run handschrift.py ...`.

  saeubern     IN OUT [--staerke 1.0] [--schwarz] [--gitterlinien] [--max-breite 2400]
               Kariertes/liniertes Papier -> weisser Hintergrund, Tinte bleibt (in Farbe).
  raster       IN OUT [--schritt 100]
               Bild mit beschriftetem Koordinatenraster, um Pixel-Boxen abzulesen.
  weiss        IN OUT --boxen "x1,y1,x2,y2;x1,y1,x2,y2"
               Rechtecke weiss uebermalen (Durchgestrichenes entfernen).
  zuschneiden  IN OUT [--box x1,y1,x2,y2] [--rand 40]
               Auf Box bzw. (ohne --box) automatisch auf den beschriebenen Bereich.
"""

import argparse
import sys

import cv2
import numpy as np


def lesen(pfad):
    img = cv2.imread(pfad, cv2.IMREAD_COLOR)
    if img is None:
        sys.exit(f"Kann {pfad} nicht lesen")
    return img


def schreiben(pfad, img):
    if not cv2.imwrite(pfad, img):
        sys.exit(f"Kann {pfad} nicht schreiben")
    print(f"{pfad}  ({img.shape[1]}x{img.shape[0]})")


def saeubern(img, staerke=1.0, schwarz=False, gitterlinien=False, max_breite=2400):
    h, w = img.shape[:2]
    if w > max_breite:
        img = cv2.resize(img, (max_breite, int(h * max_breite / w)), interpolation=cv2.INTER_AREA)
        h, w = img.shape[:2]

    # Papierhelligkeit schaetzen (Tinte und Gitter wegdilatieren) und herausdividieren:
    # gleicht Schatten und ungleichmaessige Beleuchtung aus.
    k = max(15, (min(h, w) // 60) | 1)
    bg = cv2.dilate(img, np.ones((k, k), np.uint8))
    bg = cv2.medianBlur(bg, 2 * k + 1).astype(np.float32) + 1
    norm = np.clip(img.astype(np.float32) / bg * 255, 0, 255)

    # Tinte ist dunkel, Gitterlinien sind hell (nach Normierung ~190-235).
    # Weicher Uebergang statt harter Schwelle, damit Kanten glatt bleiben.
    grau = cv2.cvtColor(norm.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    lo, hi = 200 - 90 * staerke, 200 - 15 * staerke
    alpha = np.clip((hi - grau) / (hi - lo), 0, 1)

    # Farbige Gitter (blau/grau) zusaetzlich ueber Saettigung + Helligkeit daempfen
    hsv = cv2.cvtColor(norm.astype(np.uint8), cv2.COLOR_BGR2HSV)
    hell_und_blass = (hsv[..., 2] > 170) & (hsv[..., 1] < 90)
    alpha[hell_und_blass] *= 0.2

    maske = (alpha > 0.35).astype(np.uint8)
    if gitterlinien:
        # lange, gerade Linien (Raster ueber die ganze Seite) entfernen
        for kern in ((w // 6, 1), (1, h // 6)):
            linien = cv2.morphologyEx(maske, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, kern))
            alpha[cv2.dilate(linien, np.ones((3, 3), np.uint8)) > 0] = 0
            maske = (alpha > 0.35).astype(np.uint8)

    # Staubkoerner: winzige Zusammenhangskomponenten verwerfen
    n, lab, stats, _ = cv2.connectedComponentsWithStats(maske, 8)
    min_flaeche = max(6, (w * h) // 400000)
    klein = np.zeros(n, bool)
    klein[1:] = stats[1:, cv2.CC_STAT_AREA] < min_flaeche
    alpha[klein[lab]] = 0

    if schwarz:
        tinte = np.full_like(norm, 25)
    else:
        # Originalfarbe der Tinte, etwas abgedunkelt und gesaettigt
        tinte = np.clip(norm * 0.75, 0, 255)
    a = alpha[..., None]
    out = 255 * (1 - a) + tinte * a
    return out.astype(np.uint8)


def raster(img, schritt=100):
    out = img.copy()
    h, w = out.shape[:2]
    farbe = (0, 0, 230)
    skala = max(0.5, w / 2400)
    for x in range(0, w, schritt):
        cv2.line(out, (x, 0), (x, h), farbe, 1)
        cv2.putText(out, str(x), (x + 3, int(22 * skala)), cv2.FONT_HERSHEY_SIMPLEX, 0.6 * skala, farbe, 2)
    for y in range(0, h, schritt):
        cv2.line(out, (0, y), (w, y), farbe, 1)
        cv2.putText(out, str(y), (3, y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.6 * skala, farbe, 2)
    return out


def boxen_parsen(text, w, h):
    boxen = []
    for teil in filter(None, (t.strip() for t in text.split(";"))):
        x1, y1, x2, y2 = (int(float(v)) for v in teil.split(","))
        x1, x2 = sorted((max(0, x1), min(w, x2)))
        y1, y2 = sorted((max(0, y1), min(h, y2)))
        boxen.append((x1, y1, x2, y2))
    return boxen


def weiss(img, boxen):
    """Boxen weiss machen; ausserdem jeden Strich, der ueberwiegend in einer Box liegt,
    komplett entfernen — so bleiben bei zu knappen Boxen keine Reste stehen."""
    h, w = img.shape[:2]
    in_box = np.zeros((h, w), bool)
    for x1, y1, x2, y2 in boxen:
        in_box[y1:y2, x1:x2] = True
    tinte = (cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) < 245).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(tinte, 8)
    drin = np.bincount(lab[in_box], minlength=n)
    weg = np.zeros(n, bool)
    weg[1:] = drin[1:] >= 0.5 * stats[1:, cv2.CC_STAT_AREA]
    out = img.copy()
    out[in_box | weg[lab]] = 255
    return out


def auto_box(img, rand):
    grau = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    ys, xs = np.where(grau < 200)
    if len(xs) == 0:
        return 0, 0, img.shape[1], img.shape[0]
    h, w = grau.shape
    return (max(0, xs.min() - rand), max(0, ys.min() - rand),
            min(w, xs.max() + rand), min(h, ys.max() + rand))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("saeubern")
    s.add_argument("--staerke", type=float, default=1.0, help=">1 behaelt mehr (blasse Tinte), <1 entfernt mehr")
    s.add_argument("--schwarz", action="store_true", help="Tinte einheitlich schwarz")
    s.add_argument("--gitterlinien", action="store_true", help="lange gerade Linien zusaetzlich entfernen")
    s.add_argument("--max-breite", type=int, default=2400)
    r = sub.add_parser("raster")
    r.add_argument("--schritt", type=int, default=100)
    wb = sub.add_parser("weiss")
    wb.add_argument("--boxen", required=True)
    z = sub.add_parser("zuschneiden")
    z.add_argument("--box")
    z.add_argument("--rand", type=int, default=40)
    for p in (s, r, wb, z):
        p.add_argument("eingabe")
        p.add_argument("ausgabe")
    a = ap.parse_args()

    img = lesen(a.eingabe)
    h, w = img.shape[:2]
    if a.cmd == "saeubern":
        out = saeubern(img, a.staerke, a.schwarz, a.gitterlinien, a.max_breite)
    elif a.cmd == "raster":
        out = raster(img, a.schritt)
    elif a.cmd == "weiss":
        out = weiss(img, boxen_parsen(a.boxen, w, h))
    else:
        x1, y1, x2, y2 = boxen_parsen(a.box, w, h)[0] if a.box else auto_box(img, a.rand)
        out = img[y1:y2, x1:x2]
    schreiben(a.ausgabe, out)


if __name__ == "__main__":
    main()
