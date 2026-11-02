# Erzeugt zwei Fassungen eines Skripts für tests/versions/check.cjs (benötigt reportlab und die Liberation-Schriften).
#   python3 tests/versions/make-fixture.py
# v1: 5 Seiten. v2: neue Seite nach S. 1 eingeschoben, S. 3 (alt) korrigiert und um eine Zeile nach unten
# verschoben, alte S. 4 gestrichen, zwei neue Seiten (neues Kapitel) am Ende. Jede Seite trägt unten ihre Seitenzahl –
# verschobene Seiten (alt S. 2 → neu S. 3) gelten trotzdem als unverändert.
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os
D='/usr/share/fonts/truetype/liberation/'
pdfmetrics.registerFont(TTFont('R', D+'LiberationSerif-Regular.ttf'))
pdfmetrics.registerFont(TTFont('B', D+'LiberationSerif-Bold.ttf'))
W,H=A4
OUT=os.path.dirname(os.path.abspath(__file__))

FILL = ['Wir betrachten in diesem Abschnitt Mengen, Relationen und Abbildungen zwischen Mengen.',
        'Dabei sei stets M eine nichtleere Menge und R eine Relation auf M.',
        'Die folgenden Begriffe werden im weiteren Verlauf der Vorlesung immer wieder gebraucht.',
        'Zur Übung empfiehlt es sich, zu jedem Begriff ein eigenes Beispiel zu finden.']

def page_text(n):
    return {
        'A': [('1 Relationen', 'B'), ('Definition 1.1 (Ordnungsrelation) Eine Relation heißt Ordnungsrelation, falls sie reflexiv ist.', 'R')] + [(f'Seite A Zeile {i}: ' + FILL[i % 4], 'R') for i in range(12)],
        'B': [('Bemerkung 1.2 Jede Ordnungsrelation ist eine Relation.', 'R')] + [(f'Seite B Zeile {i}: ' + FILL[(i+1) % 4], 'R') for i in range(12)],
        'C': [('Satz 1.3 Für jede Ordnungsrelation gilt die Reflexivität.', 'R')] + [(f'Seite C Zeile {i}: ' + FILL[(i+2) % 4], 'R') for i in range(12)],
        'C2': [('Satz 1.3 Für jede Ordnungsrelation gilt die Reflexivität (korrigiert).', 'R'), ('Eine zusätzliche Zeile wurde ergänzt.', 'R')] + [(f'Seite C Zeile {i}: ' + FILL[(i+2) % 4], 'R') for i in range(12)],
        'D': [('Beispiel 1.4 Die Kleiner-gleich-Relation auf den reellen Zahlen.', 'R')] + [(f'Seite D Zeile {i}: ' + FILL[(i+3) % 4], 'R') for i in range(12)],
        'E': [('2 Abbildungen', 'B'), ('Definition 2.1 Eine Abbildung heißt injektiv, falls sie verschiedene Elemente trennt.', 'R')] + [(f'Seite E Zeile {i}: ' + FILL[i % 4], 'R') for i in range(12)],
        'X': [('Einschub: Wiederholung', 'B'), ('Hier steht eine neu eingefügte Seite mit Wiederholungsaufgaben.', 'R')] + [(f'Seite X Zeile {i}: Aufgabe zur Wiederholung Nummer {i}.', 'R') for i in range(12)],
        'F': [('3 Neue Kapitel', 'B'), ('Definition 3.1 Eine Abbildung heißt bijektiv, falls sie injektiv und surjektiv ist.', 'R')] + [(f'Seite F Zeile {i}: Ganz neuer Stoff über Bijektivität, Teil {i}.', 'R') for i in range(12)],
        'G': [('Satz 3.2 Die Injektivität folgt aus der Bijektivität.', 'R')] + [(f'Seite G Zeile {i}: Weiterer neuer Stoff, Absatz {i}.', 'R') for i in range(12)],
    }[n]

def build(name, order):
    c = canvas.Canvas(os.path.join(OUT, name), pagesize=A4)
    for n, key in enumerate(order, 1):
        c.setFont('R', 10); c.drawCentredString(W / 2, 40, f'Seite {n}')
        y = H - 80
        for txt, f in page_text(key):
            c.setFont(f, 11); c.drawString(72, y, txt); y -= 18
        c.showPage()
    c.save()

build('skript-v1.pdf', ['A', 'B', 'C', 'D', 'E'])
build('skript-v2.pdf', ['A', 'X', 'B', 'C2', 'E', 'F', 'G'])
