# Erzeugt die Test-Skripte für tests/linking/check.cjs (benötigt reportlab und die Liberation-Schriften).
#   python3 tests/linking/make-fixture.py
# definitionen-cmbx.pdf: gleiche Datei, aber die fette Schrift heißt intern wie LaTeX ("CMBX10…").
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
D='/usr/share/fonts/truetype/liberation/'
pdfmetrics.registerFont(TTFont('R', D+'LiberationSerif-Regular.ttf'))
pdfmetrics.registerFont(TTFont('B', D+'LiberationSerif-Bold.ttf'))
pdfmetrics.registerFont(TTFont('I', D+'LiberationSerif-Italic.ttf'))
W,H=A4
import os
OUT=os.path.dirname(os.path.abspath(__file__))
c=canvas.Canvas(os.path.join(OUT,'definitionen.pdf'), pagesize=A4)
y=[H-80]
def line(*runs, size=11, gap=16):
    x=72
    for txt, f in runs:
        c.setFont(f, size); c.drawString(x, y[0], txt); x+=pdfmetrics.stringWidth(txt, f, size)
    y[0]-=gap
def page():
    c.showPage(); y[0]=H-80
# --- S. 1
line(('1 Grundlagen','B'), size=16, gap=26)
line(('Definition 1.1 (Ordnungsrelation)','B'), (' Eine Relation R auf einer Menge M heißt Ordnungsrelation,','R'))
line(('falls sie reflexiv, antisymmetrisch und transitiv ist.','R'), gap=24)
line(('Später werden wir das Supremum kennenlernen.','R'), gap=24)
line(('Eine Ordnungsrelation heißt ','R'), ('total','B'), (', wenn je zwei Elemente vergleichbar sind.','R'), gap=24)
line(('Beweis.','B'), (' Klar, da jede Ordnungsrelation reflexiv ist.','R'), gap=24)
line(('Achtung: dies gilt nur für endliche Mengen und nicht allgemein.','B'), gap=24)
# --- S. 2
page()
line(('2 Schranken','B'), size=16, gap=26)
line(('Sei M eine Menge mit einer Ordnungsrelation und A eine Teilmenge. Die Menge der ','R'), ('oberen Schranken','B'))
line(('von A bezeichnen wir mit S(A).','R'), gap=24)
line(('Definition 2.3','B'), (' Eine Abbildung f heißt ','R'), ('injektiv','I'), (', falls aus f(x) = f(y) stets x = y folgt.','R'), gap=24)
line(('Definition 2.4','B'), (' Eine ','R'), ('Kette','I'), (' ist eine total geordnete Teilmenge von M.','R'), gap=24)
line(('Eine Äquivalenzrelation ist reflexiv, symmetrisch und transitiv.','R'), gap=24)
# --- S. 3
page()
line(('Definition 3.2 (Supremum)','B'), (' Die kleinste obere Schranke von A heißt Supremum von A.','R'))
line(('Das Supremum ist eindeutig bestimmt.','R'), gap=24)
line(('Bemerkung 3.3','B'), (' Jede injektive Abbildung ist ein Spezialfall.','R'), gap=24)
# --- S. 4
page()
line(('Satz 4.1','B'), (' Jede nach oben beschränkte Menge besitzt ein Supremum (siehe Satz 5.1).','R'), gap=24)
line(('Ist R eine totale Ordnungs-','R'))
line(('relation, so ist jede Teilmenge eine Kette.','R'), gap=24)
line(('Eine Relation heißt Halbordnung, falls sie reflexiv und transitiv ist.','R'), gap=24)
line(('Jede Halbordnung auf einer endlichen Menge hat ein minimales Element.','R'), gap=24)
# --- S. 5
page()
line(('Definition 5.1 (Halbordnung)','B'), (' Hier verstehen wir unter einer Halbordnung eine strikte Ordnung.','R'), gap=24)
line(('Satz 5.2','B'), (' Nach Satz 4.1 und Definition 3.2 existiert das Supremum.','R'), gap=24)
# --- S. 6
page()
line(('Jede Halbordnung ist total, wenn sie eine Kette ist. Zwei obere Schranken sind vergleichbar.','R'), gap=24)
line(('Jede Ordnungsrelation ist eine Halbordnung.','R'), gap=24)
line(('Jede Äquivalenzrelation zerlegt M in Klassen; die Gleichheit ist eine Äquivalenzrelation.','R'), gap=24)
c.save()
d=open(os.path.join(OUT,'definitionen.pdf'),'rb').read()
n=d.count(b'LiberationSerif-Bold')
open(os.path.join(OUT,'definitionen-cmbx.pdf'),'wb').write(d.replace(b'LiberationSerif-Bold', b'CMBX10-Liberation-AB'))
print('bold name occurrences replaced:', n)
