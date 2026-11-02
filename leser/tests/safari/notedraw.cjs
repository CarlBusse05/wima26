// Test für Zeichenfelder in Notizen: Stift-Symbol fügt an der Schreibmarke ein Zeichenfeld ein (zwischen zwei
// Textzeilen) und schaltet das Zeichnen ein. Werkzeugleiste: eine Zeile mit Stift, Radierer, zwei Farben (antippen:
// wechseln, gewählte Farbe antippen oder gedrückt halten: ändern), Rückgängig und Wiederholen am rechten Rand. Das Feld ist höchstens eine halbe Feldhöhe leer, Scrollen lässt es unverändert; beim Beenden
// endet es kurz unter dem tiefsten Strich. Der Marker hebt Text hervor (nicht im Zeichenfeld).
//
//   npx vite --port 5173 &
//   node tests/safari/notedraw.cjs [http://localhost:5173/]
const { chromium } = require('playwright')
const path = require('path')
const BASE = process.argv[2] || 'http://localhost:5173/'

;(async () => {
  const b = await chromium.launch()
  const p = await (await b.newContext({ viewport: { width: 1180, height: 900 }, hasTouch: true })).newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('dialog', (d) => d.accept())
  await p.goto(BASE)
  await p.setInputFiles('input[type=file][accept="application/pdf"][multiple]', path.join(__dirname, 'test-skript.pdf'))
  await p.waitForSelector('.script-tile')
  await p.locator('.script-tile').first().click()
  await p.waitForSelector('.page[data-page="1"] canvas')
  await p.locator('button[aria-label="Notiz hinzufügen"]').click()
  const pg = await p.locator('.page[data-page="1"]').boundingBox()
  await p.mouse.click(pg.x + 200, pg.y + 250)
  await p.waitForSelector('.side-note')
  await (async () => { const e = await p.locator('.note-editor').boundingBox(); await p.mouse.click(e.x + e.width / 2, e.y + e.height - 40) })() // Tipp auf den leeren Teil der Notiz
  await p.keyboard.type('Formel:')
  await p.keyboard.press('Enter')
  await p.keyboard.type('Danach Text')
  const caretAfter = (needle) => p.evaluate((needle) => {
    const w = document.createTreeWalker(document.querySelector('.note-editor'), NodeFilter.SHOW_TEXT)
    let t; while ((t = w.nextNode())) if (t.textContent === needle) break
    const r = document.createRange(); r.setStart(t, t.length); r.collapse(true)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
  }, needle)
  await caretAfter('Formel:')
  await p.waitForTimeout(100)

  const r = {}
  const penBtn = '.note-head button[aria-pressed]'
  const stroke = (type, fromY, toY, id = 9) => p.evaluate(({ type, fromY, toY, id }) => {
    const c = document.querySelector('.ink-block canvas'); const rc = c.getBoundingClientRect()
    const ev = (t, i) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: id, pointerType: type, pressure: 0.6, clientX: rc.left + 40 + i * 20, clientY: rc.top + fromY + ((toY - fromY) * i) / 10, buttons: 1 }))
    ev('pointerdown', 0); for (let i = 1; i <= 10; i++) ev('pointermove', i); ev('pointerup', 10)
  }, { type, fromY, toY, id })
  const ink = () => p.evaluate(() => JSON.parse(document.querySelector('.ink-block').dataset.ink))
  const canvasH = () => p.evaluate(() => Math.round(document.querySelector('.ink-block canvas').getBoundingClientRect().height))
  const editorH = () => p.evaluate(() => document.querySelector('.note-editor').clientHeight)
  const gapToText = (needle) => p.evaluate((needle) => {
    const c = document.querySelector('.ink-block').getBoundingClientRect()
    const w = document.createTreeWalker(document.querySelector('.note-editor'), NodeFilter.SHOW_TEXT)
    let t; while ((t = w.nextNode())) if (t.textContent.includes(needle)) break
    const rg = document.createRange(); rg.selectNodeContents(t)
    return Math.round(rg.getBoundingClientRect().top - c.bottom)
  }, needle)

  // Einfügen
  await p.locator('.note-head button[aria-label="Zeichenfeld einfügen"]').click()
  await p.waitForSelector('.note-editor .ink-block canvas')
  r.pressed = await p.getAttribute(penBtn, 'aria-pressed')
  // Kopfzeile der Notiz sitzt in der Leiste des Skripts; das Notizfeld beginnt direkt oben
  r.headInBar = await p.evaluate(() => {
    const head = document.querySelector('.reader-bar .note-head')
    const panel = document.querySelector('.side-note').getBoundingClientRect()
    const bar = document.querySelector('.note-ink-bar').getBoundingClientRect()
    return !!head && !document.querySelector('.side-note .note-head') && Math.abs(bar.top - panel.top) <= 1
  })
  r.toolsHidden = (await p.locator('.reader-bar button[aria-label="Ausschnitt"]').count()) === 0
  // kein Text-Modus: keine Schreibmarke/Tastatur nach dem Einfügen
  const textFocus = () => p.evaluate(() => {
    const ed = document.querySelector('.note-editor'); const sel = getSelection()
    return ed.contains(document.activeElement) || (!!sel.anchorNode && ed.contains(sel.anchorNode))
  })
  r.noKeyboardOnInsert = !(await textFocus())
  r.order = await p.evaluate(() => {
    const out = []
    const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3 && c.textContent.trim()) out.push(c.textContent.trim()); else if (c.classList?.contains('ink-block')) out.push('[Zeichnung]'); else walk(c) } }
    walk(document.querySelector('.note-editor')); return out
  })
  r.fullWidth = await p.evaluate(() => { const i = document.querySelector('.ink-block').getBoundingClientRect(); const s = document.querySelector('.side-note').getBoundingClientRect(); return Math.abs(i.left - s.left) <= 2 && Math.abs(i.right - s.right) <= 2 })
  // Werkzeugleiste: eine Zeile, nur Stift, Radierer, Farbe
  r.bar = await p.evaluate(() => {
    const bar = document.querySelector('.note-ink-bar'); const br = bar.getBoundingClientRect()
    const redo = bar.querySelector('button[aria-label="Wiederholen"]').getBoundingClientRect()
    const color = bar.querySelector('.pen-color').getBoundingClientRect()
    const undo = bar.querySelector('button[aria-label="Rückgängig"]').getBoundingClientRect()
    return {
      height: Math.round(br.height),
      labels: [...bar.querySelectorAll('button')].map((x) => x.getAttribute('aria-label')),
      arrowsRight: br.right - redo.right < 16 && undo.left - color.right > 60,
    }
  })
  // Feld: halbe Höhe des sichtbaren Notizfelds
  const h0 = await canvasH()
  const eh = await editorH()
  r.halfHeight = Math.abs(h0 - eh / 2) <= eh * 0.05

  // Schreiben: Finger nicht, Pencil schon
  await stroke('touch', 40, 60)
  r.fingerNoInk = (await ink()).s.length === 0
  await stroke('pen', 40, 60)
  r.penInk = (await ink()).s.length === 1
  // Scrollen: Feld bleibt gleich, die leere Notiz geht darunter weiter
  const st = await p.evaluate(async () => { const ed = document.querySelector('.note-editor'); ed.scrollTop += 600; await new Promise((res) => setTimeout(res, 100)); const v = ed.scrollTop; ed.scrollTop = 0; return v })
  r.scrollNoGrow = (await canvasH()) === (await canvasH()) && (await canvasH()) <= h0 + 1 && st > 300
  // nahe am unteren Rand schreiben → wächst, aber höchstens eine halbe Feldhöhe bleibt leer
  await stroke('pen', h0 - 60, h0 - 20)
  const afterGrow = await ink()
  const scale = await p.evaluate(() => document.querySelector('.ink-block').clientWidth / 400)
  const lowest = Math.max(...afterGrow.s.flatMap((s) => s.points.filter((_, i) => i % 3 === 1)))
  r.grew = (await canvasH()) > h0
  r.emptyAtMostHalf = (afterGrow.h - lowest) * scale <= eh / 2 + 2
  // Radierer
  await p.locator('.note-ink-bar button[aria-label="Radierer"]').click()
  await stroke('pen', 50, 50)
  r.erased = (await ink()).s.length === 1
  // Rückgängig holt den wegradierten Strich zurück, Wiederholen radiert ihn wieder
  await p.locator('.note-ink-bar button[aria-label="Rückgängig"]').click()
  r.undo = (await ink()).s.length === 2
  await p.locator('.note-ink-bar button[aria-label="Wiederholen"]').click()
  r.redo = (await ink()).s.length === 1
  await p.locator('.note-ink-bar button[aria-label="Stift"]').click()
  // Farbe: die gewählte Farbe antippen öffnet den Farbkreis (Abbrechen); gedrückt halten → Farbkreis → neue Farbe
  await p.locator('.note-ink-bar .pen-color').nth(0).click()
  await p.waitForSelector('.color-modal')
  r.tapActiveWheel = true
  await p.locator('.color-modal button', { hasText: 'Abbrechen' }).click()
  await p.waitForTimeout(200)
  const cb = await p.locator('.note-ink-bar .pen-color').nth(0).boundingBox()
  await p.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2)
  await p.mouse.down()
  await p.waitForTimeout(700)
  await p.mouse.up()
  await p.waitForSelector('.color-modal')
  const wb = await p.locator('.color-modal .wheel canvas').boundingBox()
  await p.mouse.click(wb.x + wb.width * 0.8, wb.y + wb.height * 0.5)
  await p.locator('.color-modal button', { hasText: 'Hinzufügen' }).click()
  await stroke('pen', 70, 90, 13)
  const colors = (await ink()).s.map((s) => s.color)
  r.colorChanged = colors.length === 2 && colors[0] !== colors[1]
  // zweite Farbe antippen: wechselt (ohne Farbkreis), Strich in Farbe 2; zurück zu Farbe 1 ohne sie neu zu suchen
  await p.locator('.note-ink-bar .pen-color').nth(1).click()
  r.noWheelOnSwitch = (await p.locator('.color-modal').count()) === 0
  await stroke('pen', 100, 110, 14)
  await p.locator('.note-ink-bar .pen-color').nth(0).click()
  r.noWheelOnSwitchBack = (await p.locator('.color-modal').count()) === 0
  await stroke('pen', 120, 130, 15)
  const c3 = (await ink()).s.map((s) => s.color)
  r.twoColors = c3.length === 4 && c3[2] !== c3[1] && c3[3] === c3[1]
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('mathe-studium.notePenColors') || 'null'))
  r.colorSaved = saved && saved.colors[0] === c3[1] && saved.colors[1] === c3[2] && saved.active === 0 ? saved.colors[0] : null

  // Zeichnen beenden: Feld endet kurz unter dem tiefsten Strich, Text rückt direkt darunter
  await p.locator(penBtn).click()
  await p.waitForTimeout(200)
  r.off = (await p.getAttribute(penBtn, 'aria-pressed')) === 'false' && (await p.locator('.note-ink-bar').count()) === 0
  const gap = await gapToText('Danach Text')
  r.textBack = gap >= 0 && gap < 30

  // vorhandenes Feld antippen → Zeichnen an, kein neues Feld, Feld bekommt wieder Platz
  const hClosed = await canvasH()
  const fields0 = await p.locator('.note-editor .ink-block').count()
  await p.locator('.ink-block canvas').click({ position: { x: 100, y: 20 } })
  await p.waitForTimeout(150)
  r.tapReopens = (await p.getAttribute(penBtn, 'aria-pressed')) === 'true' && (await p.locator('.note-ink-bar').count()) === 1
  r.noNewField = (await p.locator('.note-editor .ink-block').count()) === fields0
  r.reopenedBig = (await canvasH()) > hClosed
  // in den Text wechseln → Zeichnen aus, Feld sofort klein
  await p.waitForTimeout(350)
  await caretAfter('Danach Text')
  await p.waitForTimeout(150)
  r.textSwitchCloses = (await p.getAttribute(penBtn, 'aria-pressed')) === 'false' && (await p.locator('.note-ink-bar').count()) === 0 && (await canvasH()) === hClosed
  // erneut öffnen, dann auf den leeren Teil der Notiz tippen → ebenfalls sofort klein
  await p.locator('.ink-block canvas').click({ position: { x: 100, y: 20 } })
  await p.waitForTimeout(400)
  await p.evaluate(() => { const e = document.querySelector('.note-editor'); e.scrollTop = e.scrollHeight }) // zur leeren Notiz unter dem Inhalt
  await (async () => { const e = await p.locator('.note-editor').boundingBox(); await p.mouse.click(e.x + e.width / 2, e.y + e.height - 40) })()
  await p.waitForTimeout(150)
  await p.evaluate(() => { document.querySelector('.note-editor').scrollTop = 0 })
  r.emptyTapCloses = (await p.getAttribute(penBtn, 'aria-pressed')) === 'false' && (await canvasH()) === hClosed

  // Marker: markierten Text hervorheben und wieder entfernen
  await p.evaluate(() => {
    const w = document.createTreeWalker(document.querySelector('.note-editor'), NodeFilter.SHOW_TEXT)
    let t; while ((t = w.nextNode())) if (t.textContent === 'Danach Text') break
    const rg = document.createRange(); rg.setStart(t, 0); rg.setEnd(t, 6) // "Danach"
    const s = getSelection(); s.removeAllRanges(); s.addRange(rg)
  })
  await p.locator('.note-head button[aria-label="Text hervorheben"]').click()
  r.marked = await p.evaluate(() => [...document.querySelectorAll('.note-editor mark')].map((m) => m.textContent))
  r.inkHasNoMarker = !(await p.locator('.note-ink-bar button[aria-label="Textmarker"]').count())

  // Pencil auf vorhandenem Feld → Zeichnen wieder an, Tastatur (Schreibmarke im Text) verschwindet
  await caretAfter(' Text') // „Danach“ ist seit dem Marker ein eigenes <mark>
  await p.evaluate(() => document.querySelector('.note-editor').focus())
  await stroke('pen', 20, 30, 12)
  r.autoOn = (await p.getAttribute(penBtn, 'aria-pressed')) === 'true'
  r.keyboardHiddenOnPen = !(await textFocus())
  const strokesBefore = (await ink()).s.length

  // Schließen und wieder öffnen
  await p.waitForTimeout(600)
  await p.locator('button[aria-label="Notiz schließen"]').click()
  await p.waitForTimeout(800)
  await p.reload()
  await p.waitForSelector('.note-marker', { timeout: 20000 })
  await p.locator('.note-marker').click()
  await p.waitForSelector('.note-editor .ink-block canvas')
  await p.waitForTimeout(300)
  r.persisted = (await ink()).s.length === strokesBefore
  r.markPersisted = await p.evaluate(() => document.querySelector('.note-editor mark')?.textContent === 'Danach')
  // Hervorhebung wieder entfernen (Auswahl in der Markierung → Marker)
  await p.evaluate(() => {
    const m = document.querySelector('.note-editor mark'); const rg = document.createRange(); rg.selectNodeContents(m)
    const s = getSelection(); s.removeAllRanges(); s.addRange(rg)
  })
  await p.locator('.note-head button[aria-label="Text hervorheben"]').click()
  r.unmarked = (await p.locator('.note-editor mark').count()) === 0
  r.drawnPixels = await p.evaluate(() => {
    const c = document.querySelector('.ink-block canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n
  })

  // löschen – ohne dass der Text-Modus (Tastatur) aufgeht
  await p.evaluate(() => { getSelection().removeAllRanges(); document.activeElement?.blur?.() })
  await p.locator('.ink-block-del').click()
  await p.waitForTimeout(200)
  r.deleted = (await p.locator('.note-editor .ink-block').count()) === 0
  r.deleteNoKeyboard = !(await textFocus())

  // leere Notiz: Stift-Symbol → nur das Zeichenfeld (keine Textzeile, keine Tastatur);
  // erst ein Tipp auf den leeren Teil darunter startet den Text in einer neuen Zeile
  await p.locator('button[aria-label="Notiz schließen"]').click()
  await p.locator('button[aria-label="Notiz hinzufügen"]').click()
  await p.mouse.click(pg.x + 300, pg.y + 420)
  await p.waitForSelector('.side-note')
  await p.locator('.note-head button[aria-label="Zeichenfeld einfügen"]').click()
  await p.waitForSelector('.note-editor .ink-block canvas')
  r.onlyField = await p.evaluate(() => [...document.querySelector('.note-editor').children].map((c) => (c.classList.contains('ink-block') ? 'feld' : 'zeile')))
  r.emptyNoKeyboard = !(await textFocus())
  await (async () => { const e = await p.locator('.note-editor').boundingBox(); await p.mouse.click(e.x + e.width / 2, e.y + e.height - 40) })()
  await p.keyboard.type('Text unten')
  r.textBelow = await p.evaluate(() => {
    const ch = [...document.querySelector('.note-editor').children]
    return ch[0].classList.contains('ink-block') && ch[1]?.textContent === 'Text unten'
  })
  await b.close()

  const checks = [
    ['Zeichenfeld an der Schreibmarke, zwischen zwei Textzeilen', JSON.stringify(r.order) === JSON.stringify(['Formel:', '[Zeichnung]', 'Danach Text']) && r.pressed === 'true'],
    ['über die ganze Breite des Felds', r.fullWidth],
    ['Werkzeugleiste: eine Zeile mit Stift, Radierer, zwei Farben, Pfeile am rechten Rand', r.bar.height < 50 && r.bar.arrowsRight && JSON.stringify(r.bar.labels) === JSON.stringify(['Stift', 'Radierer', 'Farbe 1', 'Farbe 2', 'Rückgängig', 'Wiederholen'])],
    ['Feld ist halb so hoch wie das sichtbare Notizfeld', r.halfHeight],
    ['nur der Pencil zeichnet, Finger nicht', r.fingerNoInk && r.penInk],
    ['Scrollen: Feld bleibt gleich, die leere Notiz geht darunter weiter', r.scrollNoGrow],
    ['Schreiben am unteren Rand: Feld wächst, höchstens halbe Feldhöhe leer', r.grew && r.emptyAtMostHalf],
    ['Radierer', r.erased],
    ['Rückgängig / Wiederholen', r.undo && r.redo],
    ['gewählte Farbe antippen oder gedrückt halten ändert sie (bleibt gespeichert)', r.tapActiveWheel && r.colorChanged && /^#[0-9a-f]{6}$/i.test(r.colorSaved || '')],
    ['zwei Farben: Wechsel per Antippen, ohne die Farbe neu zu suchen', r.noWheelOnSwitch && r.noWheelOnSwitchBack && r.twoColors],
    ['Zeichnen beenden: Text rückt direkt unter das Feld', r.off && r.textBack],
    ['vorhandenes Feld antippen: Werkzeuge an, kein neues Feld, Platz zum Weiterzeichnen', r.tapReopens && r.noNewField && r.reopenedBig],
    ['Wechsel in den Text: Zeichnen aus, Feld sofort klein', r.textSwitchCloses],
    ['Tipp auf den leeren Teil der Notiz: Zeichnen aus, Feld sofort klein', r.emptyTapCloses],
    ['Marker hebt Text hervor (nicht im Zeichenfeld)', JSON.stringify(r.marked) === '["Danach"]' && r.inkHasNoMarker],
    ['Pencil auf vorhandenem Feld schaltet Zeichnen ein, Tastatur verschwindet', r.autoOn && r.keyboardHiddenOnPen],
    ['Handschrift und Markierung bleiben nach Neuladen', r.persisted && r.markPersisted && r.drawnPixels > 50],
    ['Hervorhebung lässt sich wieder entfernen', r.unmarked],
    ['Zeichenfeld löschen, ohne dass die Tastatur aufgeht', r.deleted && r.deleteNoKeyboard],
    ['Notiz-Kopfzeile in der Leiste des Skripts, mehr Platz im Notizfeld', r.headInBar && r.toolsHidden],
    ['Zeichenfeld einfügen: keine Tastatur', r.noKeyboardOnInsert && r.emptyNoKeyboard],
    ['leere Notiz: nur das Zeichenfeld, keine Textzeile', JSON.stringify(r.onlyField) === '["feld"]'],
    ['Tipp auf den leeren Teil startet Text unter dem Feld', r.textBelow],
    ['keine Fehler', !errors.length],
  ]
  let ok = true
  for (const [n, pass] of checks) { ok &&= !!pass; console.log(`${pass ? '✓' : '✗'} ${n}`) }
  if (!ok) console.log(JSON.stringify({ r, errors }))
  process.exit(ok ? 0 : 1)
})()
