// Test für Notiz-Zettel: Icon wählen → auf das Skript tippen → Feld rechts mit Text und Bildern im Textfluss,
// Schließen mit X, Symbol bleibt an der Stelle, Inhalt übersteht ein Neuladen; leere Notizen verschwinden.
//
//   npx vite --port 5173 &
//   node tests/safari/notes.cjs [http://localhost:5173/]
const { chromium } = require('playwright')
const path = require('path')
const BASE = process.argv[2] || 'http://localhost:5173/'

;(async () => {
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(BASE)
  await p.setInputFiles('input[type=file][accept="application/pdf"][multiple]', path.join(__dirname, 'test-skript.pdf'))
  await p.waitForSelector('.script-tile')
  await p.locator('.script-tile').first().tap()
  await p.waitForSelector('.page[data-page="1"] canvas')
  const png = await p.screenshot({ clip: { x: 0, y: 0, width: 300, height: 120 } })
  const r = {}

  // Notiz setzen
  await p.locator('button[aria-label="Notiz hinzufügen"]').tap()
  const pg = await p.locator('.page[data-page="1"]').boundingBox()
  await p.mouse.click(pg.x + 200, pg.y + 150)
  await p.waitForSelector('.side-note')
  r.noAutoFocus = !(await p.evaluate(() => document.activeElement?.classList.contains('note-editor')))
  await (async () => { const e = await p.locator('.note-editor').boundingBox(); await p.mouse.click(e.x + e.width / 2, e.y + e.height - 40) })() // Tipp auf den leeren Teil der Notiz
  r.focused = await p.evaluate(() => document.activeElement?.classList.contains('note-editor'))
  r.docVisible = await p.evaluate(() => { const a = document.querySelector('.pages').getBoundingClientRect(); const n = document.querySelector('.side-note').getBoundingClientRect(); return a.width > 300 && a.right <= n.left + 1 })

  // Text, dann ein Bild zwischen die beiden Zeilen
  await p.keyboard.type('Erste Zeile')
  await p.keyboard.press('Enter')
  await p.keyboard.type('Zweite Zeile')
  await p.evaluate(() => {
    const ed = document.querySelector('.note-editor')
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT)
    let t; while ((t = walker.nextNode())) if (t.textContent === 'Erste Zeile') break
    const range = document.createRange(); range.setStart(t, t.length); range.collapse(true)
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range)
  })
  await p.waitForTimeout(100)
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.locator('.note-head button[aria-label="Bild einfügen"]').click()])
  await chooser.setFiles({ name: 'bild.png', mimeType: 'image/png', buffer: png })
  await p.waitForSelector('.note-editor img')
  r.order = await p.evaluate(() => {
    const ed = document.querySelector('.note-editor'); const out = []
    const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3 && c.textContent.trim()) out.push(c.textContent.trim()); else if (c.nodeName === 'IMG') out.push('[Bild]'); else walk(c) } }
    walk(ed); return out
  })
  r.fullWidth = await p.evaluate(() => { const i = document.querySelector('.note-editor img').getBoundingClientRect(); const s = document.querySelector('.side-note').getBoundingClientRect(); return Math.abs(i.left - s.left) <= 2 && Math.abs(i.right - s.right) <= 2 })
  const openBox = await p.locator('.note-marker').boundingBox()
  await p.locator('.note-head button[aria-label="Notiz schließen"]').click()
  r.closed = !(await p.locator('.side-note').count())
  r.markers = await p.locator('.note-marker').count()
  const mk = await p.locator('.note-marker').boundingBox()
  // Schließen: links wieder genau die Ansicht von vorher – das Symbol steht an der angetippten Stelle (siehe notepos.cjs)
  r.markerAtSpot = Math.abs(mk.y + mk.height / 2 - (pg.y + 150)) <= 3 && Math.abs(mk.x + mk.width / 2 - (pg.x + 200)) <= 3 && !!openBox

  // leere Notiz verschwindet beim Schließen
  await p.locator('button[aria-label="Notiz hinzufügen"]').tap()
  await p.mouse.click(pg.x + 300, pg.y + 300)
  await p.waitForSelector('.side-note')
  await p.locator('.note-head button[aria-label="Notiz schließen"]').click()
  r.emptyRemoved = (await p.locator('.note-marker').count()) === 1

  // nach dem Neuladen: Symbol antippen öffnet die Notiz mit Inhalt
  await p.waitForTimeout(800)
  await p.reload()
  await p.waitForSelector('.note-marker', { timeout: 20000 })
  await p.locator('.note-marker').click()
  await p.waitForSelector('.side-note .note-editor img')
  r.persisted = await p.evaluate(() => { const t = document.querySelector('.note-editor').textContent; return t.includes('Erste Zeile') && t.includes('Zweite Zeile') })

  // Farben: Farb-Icon ganz links in der Leiste → Popup mit Verlauf, neue Farbe, Farbe entfernen, ohne Farbe
  r.paletteFirst = await p.evaluate(() => document.querySelector('.note-head .row button')?.getAttribute('aria-label') === 'Farbe der Notiz')
  await p.locator('.note-head button[aria-label="Farbe der Notiz"]').click()
  const swatches = () => p.$$eval('.note-swatch', (s) => s.map((x) => x.title))
  r.seed = await swatches()
  await p.locator('.note-swatch').nth(1).click() // zweite Farbe wählen
  r.markerColor = await p.$eval('.note-marker', (m) => getComputedStyle(m).backgroundColor)
  r.headerColor = await p.$eval('.note-head', (h) => getComputedStyle(h).backgroundColor)
  await p.locator('.note-head button[aria-label="Farbe der Notiz"]').click()
  r.recentFirst = (await swatches())[0] === r.seed[1]
  await p.locator('.note-swatch-del').last().click() // eine Farbe aus der Liste löschen
  r.afterDelete = (await swatches()).length
  await p.locator('.note-color-pop button', { hasText: 'Neue Farbe' }).click()
  const wb = await p.locator('.color-modal .wheel canvas').boundingBox()
  await p.mouse.click(wb.x + wb.width * 0.2, wb.y + wb.height * 0.5) // andere Farbe im Farbkreis wählen
  await p.locator('.color-modal button', { hasText: 'Hinzufügen' }).click()
  await p.locator('.note-head button[aria-label="Farbe der Notiz"]').click()
  r.afterAdd = (await swatches()).length
  await p.locator('.note-color-pop button', { hasText: 'Ohne Farbe' }).click()
  r.cleared = await p.$eval('.note-marker', (m) => getComputedStyle(m).backgroundColor)
  await p.locator('.note-head button[aria-label="Farbe der Notiz"]').click()
  await p.locator('.note-swatch').first().click()
  await p.waitForTimeout(800)
  await p.reload()
  await p.waitForSelector('.note-marker', { timeout: 20000 })
  r.colorPersisted = await p.$eval('.note-marker', (m) => getComputedStyle(m).backgroundColor)

  // Tipp ins Skript schließt die Notiz; gerade Getipptes ist gespeichert, leere Notizen verschwinden
  const tapScript = async () => { const pb = await p.locator('.page[data-page="1"]').boundingBox(); await p.mouse.click(pb.x + 30, pb.y + pb.height - 60) }
  await p.locator('.note-marker').first().click()
  await p.waitForSelector('.side-note')
  await (async () => { const e = await p.locator('.note-editor').boundingBox(); await p.mouse.click(e.x + e.width / 2, e.y + e.height - 40) })()
  await p.keyboard.type('Direkt danach geschlossen')
  await tapScript()
  await p.waitForTimeout(300)
  r.scriptTapCloses = (await p.locator('.side-note').count()) === 0
  await p.waitForTimeout(700)
  await p.reload()
  await p.waitForSelector('.note-marker', { timeout: 20000 })
  await p.locator('.note-marker').first().click()
  await p.waitForSelector('.note-editor')
  r.typedKept = await p.evaluate(() => document.querySelector('.note-editor').textContent.includes('Direkt danach geschlossen'))
  await tapScript()
  await p.waitForTimeout(300)
  const markersBefore = await p.locator('.note-marker').count()
  await p.locator('button[aria-label="Notiz hinzufügen"]').click()
  const pb2 = await p.locator('.page[data-page="1"]').boundingBox()
  await p.mouse.click(pb2.x + 150, pb2.y + 400)
  await p.waitForSelector('.side-note')
  await tapScript()
  await p.waitForTimeout(300)
  r.emptyGone = (await p.locator('.side-note').count()) === 0 && (await p.locator('.note-marker').count()) === markersBefore
  await b.close()

  const checks = [
    ['Feld rechts öffnet sich ohne Schreibmarke; Tipp auf die leere Notiz startet den Text', r.noAutoFocus && r.focused],
    ['Skript bleibt links sichtbar', r.docVisible],
    ['Bild zwischen zwei Textzeilen im Textfluss', JSON.stringify(r.order) === JSON.stringify(['Erste Zeile', '[Bild]', 'Zweite Zeile'])],
    ['Bild über die ganze Breite des Felds', r.fullWidth],
    ['X schließt das Feld, Symbol bleibt an der Stelle', r.closed && r.markers === 1 && r.markerAtSpot],
    ['leere Notiz wird nicht gespeichert', r.emptyRemoved],
    ['Inhalt übersteht Neuladen', r.persisted],
    ['Farb-Icon ganz links in der Leiste des Felds', r.paletteFirst],
    ['Farbe wählen: am Symbol und im Feld sichtbar', r.markerColor === 'rgb(168, 230, 161)' && r.headerColor === 'rgb(168, 230, 161)'],
    ['zuletzt verwendete Farbe zuerst', r.recentFirst],
    ['Farbe aus der Liste löschen, neue hinzufügen', r.afterDelete === 3 && r.afterAdd === 4],
    ['„Ohne Farbe“ setzt die Notiz zurück', r.cleared === 'rgb(255, 255, 255)'],
    ['Farbe bleibt nach Neuladen', r.colorPersisted !== 'rgb(255, 255, 255)'],
    ['Tipp ins Skript schließt die Notiz', r.scriptTapCloses],
    ['gerade Getipptes bleibt dabei gespeichert', r.typedKept],
    ['leere Notiz verschwindet beim Schließen per Tipp ins Skript', r.emptyGone],
    ['keine Fehler', !errors.length],
  ]
  let ok = true
  for (const [n, pass] of checks) { ok &&= !!pass; console.log(`${pass ? '✓' : '✗'} ${n}`) }
  if (!ok) console.log(JSON.stringify({ r, errors }))
  process.exit(ok ? 0 : 1)
})()
