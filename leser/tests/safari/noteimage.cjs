// Test: Bilder in Notizen vergrößern/verkleinern. Antippen wählt das Bild aus (Rahmen, Griff, Leiste – keine
// Tastatur), Ziehen am Griff ändert die Größe ohne Verzerrung (Ecke oben links bleibt, verkleinert bündig am Textrand),
// daneben steht nie Text, der Text darunter rückt bis eine halbe Zeile unter das Bild. ½ / Volle Breite / Löschen,
// Doppeltipp = volle Breite. Die Größe bleibt nach Schließen und Wiederöffnen erhalten.
//
//   npx vite --port 5173 &
//   node tests/safari/noteimage.cjs [http://localhost:5173/]
const { chromium } = require('playwright')
const path = require('path')
const BASE = process.argv[2] || 'http://localhost:5173/'

;(async () => {
  const b = await chromium.launch()
  const p = await (await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true })).newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(BASE)
  await p.setInputFiles('input[type=file][accept="application/pdf"][multiple]', path.join(__dirname, 'test-skript.pdf'))
  await p.waitForSelector('.script-tile')
  await p.locator('.script-tile').first().click()
  await p.waitForSelector('.page[data-page="1"] canvas')
  const png = await p.screenshot({ clip: { x: 0, y: 0, width: 400, height: 200 } }) // Seitenverhältnis 2:1
  await p.locator('button[aria-label="Notiz hinzufügen"]').click()
  const pg = await p.locator('.page[data-page="1"]').boundingBox()
  await p.mouse.click(pg.x + 200, pg.y + 200)
  await p.waitForSelector('.side-note')
  await (async () => { const e = await p.locator('.note-editor').boundingBox(); await p.mouse.click(e.x + e.width / 2, e.y + e.height - 40) })()
  await p.keyboard.type('Oben')
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.locator('.note-head button[aria-label="Bild einfügen"]').click()])
  await chooser.setFiles({ name: 'bild.png', mimeType: 'image/png', buffer: png })
  await p.waitForSelector('.note-editor img')
  await p.keyboard.type('Darunter')
  await p.waitForTimeout(300)

  const geo = () => p.evaluate(() => {
    const ed = document.querySelector('.note-editor'); const e = ed.getBoundingClientRect()
    const img = ed.querySelector('img'); if (!img) return null
    const i = img.getBoundingClientRect()
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) if (t.textContent.includes('Darunter')) break
    const rg = document.createRange(); rg.selectNodeContents(t); const tr = rg.getBoundingClientRect()
    const pad = parseFloat(getComputedStyle(ed).paddingLeft)
    return { left: Math.round(i.left - e.left), w: Math.round(i.width), h: Math.round(i.height), col: Math.round(ed.clientWidth - 2 * pad), full: Math.round(ed.clientWidth), pad, gap: Math.round(tr.top - i.bottom), textLeftOfImg: tr.top < i.bottom - 2 }
  })
  const r = {}
  r.full = await geo()
  // Bild antippen → Auswahl, keine Schreibmarke
  const ib = await p.locator('.note-editor img').boundingBox()
  await p.mouse.click(ib.x + ib.width / 2, ib.y + ib.height / 2)
  await p.waitForTimeout(200)
  r.selected = (await p.locator('.img-sel').count()) === 1 && (await p.locator('.img-bar').count()) === 1
  r.noCaret = await p.evaluate(() => !document.activeElement?.classList.contains('note-editor'))
  // am Griff nach links ziehen: auf etwa die Hälfte der Textbreite
  const h = await p.locator('.img-handle').boundingBox()
  const target = r.full.col / 2
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await p.mouse.down()
  await p.mouse.move(h.x + h.width / 2 - (ib.width - target), h.y + h.height / 2 + 30, { steps: 8 })
  await p.mouse.up()
  await p.waitForTimeout(700)
  r.half = await geo()
  r.frameFollows = await p.evaluate(() => { const s = document.querySelector('.img-sel').getBoundingClientRect(); const i = document.querySelector('.note-editor img').getBoundingClientRect(); return Math.abs(s.width - i.width) < 2 && Math.abs(s.top - i.top) < 2 })
  // schließen und wieder öffnen: Größe bleibt
  await p.locator('button[aria-label="Notiz schließen"]').click()
  await p.waitForTimeout(500)
  r.stored = await p.evaluate(async () => { const db = await import('/src/lib/db.ts'); const [a] = await db.getAll('annotations'); return a.notes[0].html.match(/data-w="([\d.]+)"/)?.[1] ?? null })
  await p.locator('.note-marker').click()
  await p.waitForSelector('.note-editor img')
  await p.waitForTimeout(400)
  r.reopened = await geo()
  // Leiste: Volle Breite, ½, Doppeltipp, Löschen
  const tapImg = async () => { const x = await p.locator('.note-editor img').boundingBox(); await p.mouse.click(x.x + x.width / 2, x.y + x.height / 2); await p.waitForTimeout(200) }
  await tapImg()
  await p.locator('.img-bar button[aria-label="Volle Breite"]').click(); await p.waitForTimeout(300)
  r.fullAgain = await geo()
  await p.locator('.img-bar button[aria-label="Halbe Breite"]').click(); await p.waitForTimeout(300)
  r.halfBtn = await geo()
  const x = await p.locator('.note-editor img').boundingBox()
  await p.mouse.dblclick(x.x + x.width / 2, x.y + x.height / 2); await p.waitForTimeout(300)
  r.dbl = await geo()
  await tapImg()
  await p.locator('.img-bar button[aria-label="Bild löschen"]').click(); await p.waitForTimeout(600)
  r.deleted = (await p.locator('.note-editor img').count()) === 0 && (await p.locator('.img-sel').count()) === 0
  await b.close()

  const near = (a, c, d = 3) => Math.abs(a - c) <= d
  const ratio = (g) => g.w / g.h
  const checks = [
    ['eingefügt über die ganze Breite des Felds', near(r.full.w, r.full.full) && near(r.full.left, 0)],
    ['Antippen wählt aus (Rahmen, Griff, Leiste), ohne Schreibmarke/Tastatur', r.selected && r.noCaret],
    ['Griff: verkleinert ohne Verzerrung, bündig am Textrand', near(r.half.w, r.full.col / 2, 6) && near(r.half.left, r.half.pad) && near(ratio(r.half), ratio(r.full), 0.05) && r.frameFollows],
    ['Text daneben nie, darunter mit einer halben Zeile Abstand', !r.half.textLeftOfImg && r.half.gap >= 8 && r.half.gap <= 16],
    ['Größe gespeichert und nach Wiederöffnen gleich', r.stored && near(Number(r.stored), 0.5, 0.05) && near(r.reopened.w, r.half.w, 2)],
    ['Volle Breite / ½ / Doppeltipp', near(r.fullAgain.w, r.full.full) && near(r.halfBtn.w, r.full.col / 2, 2) && near(r.dbl.w, r.full.full)],
    ['Löschen entfernt das Bild', r.deleted],
    ['keine Fehler', !errors.length],
  ]
  let ok = true
  for (const [n, pass] of checks) { ok &&= !!pass; console.log(`${pass ? '✓' : '✗'} ${n}`) }
  if (!ok) console.log(JSON.stringify(r, null, 1))
  process.exit(ok ? 0 : 1)
})()
