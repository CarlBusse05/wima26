// Test: Stift-Leiste oben, dazu kleine Werkzeug-Leisten am linken/rechten Rand (Halbkreis, nur eine Seite offen), entweder Stift oder Notiz offen, „Neu in Version“
// per Kreuz entfernen.
//
//   npx vite --port 5173 &
//   node tests/safari/inkbar.cjs [http://localhost:5173/]
const { chromium } = require('playwright')
const path = require('path')
const BASE = process.argv[2] || 'http://localhost:5173/'

;(async () => {
  const b = await chromium.launch()
  const p = await (await b.newContext({ viewport: { width: 1180, height: 900 }, hasTouch: true })).newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(BASE)
  await p.setInputFiles('input[type=file][accept="application/pdf"][multiple]', path.join(__dirname, 'lang-skript.pdf'))
  await p.waitForSelector('.script-tile')
  const id = await p.evaluate(async () => {
    const db = await import('/src/lib/db.ts')
    const [s] = await db.getAll('scripts')
    const now = Date.now()
    await db.put('scripts', { ...s, version: 2, changes: { version: 2, at: now, fromPages: 20, newPages: [1, 2], newUntil: now + 86400000, review: [], movedPages: 0, orphaned: 0, droppedEntries: 0 } })
    return s.id
  })
  await p.reload()
  await p.locator('.script-tile').first().click()
  await p.waitForSelector('.page[data-page="1"] canvas')
  await p.waitForTimeout(400)
  const r = {}
  const pen = '.reader-bar button[title^="Mit Stift"]'
  const noteBtn = 'button[aria-label="Notiz hinzufügen"]'

  // vor dem Stift: keine Werkzeug-Leisten am Rand
  r.noDockBefore = (await p.locator('.tool-dock').count()) === 0
  await p.locator(pen).click()
  // Stift-Leiste oben wie zuvor (mit Farben), dazu zwei Halbkreise am Rand
  r.topBar = await p.evaluate(() => {
    const bar = document.querySelector('.ink-bar').getBoundingClientRect()
    const pages = document.querySelector('.pages').getBoundingClientRect()
    return bar.bottom <= pages.top + 1 && bar.width > 600 && document.querySelectorAll('.ink-bar .swatch').length > 0
  })
  const tabs = () => p.evaluate(() => [...document.querySelectorAll('.tool-dock')].map((d) => d.className.replace('tool-dock ', '') + ':' + d.querySelectorAll('.dock-pill button').length))
  r.closed = await tabs()
  // links öffnen: nur Werkzeugwechsel, rechter Halbkreis verschwindet; liegt über dem Skript
  await p.locator('.dock-tab[aria-label="Werkzeuge links öffnen"]').click()
  r.leftOpen = await tabs()
  r.leftTools = await p.evaluate(() => {
    const pill = document.querySelector('.tool-dock.left .dock-pill').getBoundingClientRect()
    const pages = document.querySelector('.pages').getBoundingClientRect()
    return { labels: [...document.querySelectorAll('.tool-dock.left .dock-pill button')].map((b) => b.getAttribute('aria-label')), overlay: pill.left >= pages.left && pill.left < pages.left + 20 }
  })
  await p.locator('.tool-dock.left button[aria-label="Radierer"]').click()
  r.eraser = await p.evaluate(() => document.querySelector('.ink-bar button[aria-label="Radierer"]').classList.contains('on'))
  await p.locator('.tool-dock.left button[aria-label="Lasso"]').click()
  r.lasso = (await p.locator('.lasso-layer').count()) === 1
  await p.locator('.tool-dock.left button[aria-label="Stift"]').click()
  await p.locator('.dock-tab[aria-label="Werkzeuge links schließen"]').click()
  r.bothClosed = await tabs()
  await p.locator('.dock-tab[aria-label="Werkzeuge rechts öffnen"]').click()
  r.rightOpen = await tabs()
  await p.locator('.tool-dock.right button[aria-label="Textmarker"]').click()
  r.hl = await p.evaluate(() => document.querySelector('.ink-bar button[aria-label="Textmarker"]').classList.contains('on'))
  await p.locator('.tool-dock.right button[aria-label="Stift"]').click()

  // Notiz setzen → Stift aus
  await p.locator(noteBtn).click()
  r.penOffForPlacing = (await p.locator('.ink-bar').count()) === 0 && (await p.locator('.tool-dock').count()) === 0
  const pg = await p.locator('.page[data-page="1"]').boundingBox()
  await p.mouse.click(pg.x + 300, pg.y + 300)
  await p.waitForSelector('.side-note')
  await (async () => { const e = await p.locator('.note-editor').boundingBox(); await p.mouse.click(e.x + e.width / 2, e.y + 30) })()
  await p.keyboard.type('Hallo')
  r.noInkWhileNote = (await p.locator('.ink-bar').count()) === 0
  await p.mouse.click(pg.x + 300, pg.y + 700) // Tipp ins Skript schließt die Notiz
  await p.waitForTimeout(300)
  await p.locator(pen).click()
  r.penOn = (await p.locator('.side-note').count()) === 0 && (await p.locator('.ink-bar').count()) === 1
  // Notiz öffnen → Stift aus
  await p.locator('.note-marker').first().click()
  await p.waitForSelector('.side-note')
  r.penOffByNote = (await p.locator('.ink-bar').count()) === 0
  await p.keyboard.press('Escape')

  // „Neu in Version 2“ auf S. 1 entfernen
  r.flagsBefore = await p.locator('.page-flag.new').count()
  await p.locator('.page-flag.new button[aria-label*="Seite 1"]').click()
  await p.waitForTimeout(900)
  r.flagsAfter = await p.locator('.page-flag.new').count()
  r.stored = await p.evaluate(async (id) => (await (await import('/src/lib/db.ts')).get('scripts', id)).changes.newPages, id)
  r.banner = await p.locator('.version-banner').textContent()
  await b.close()

  const checks = [
    ['Halbkreise erst mit dem Stift', r.noDockBefore && JSON.stringify(r.closed) === '["left:0","right:0"]'],
    ['Stift-Leiste oben wie zuvor', r.topBar],
    ['links geöffnet: nur Stift/Textmarker/Radierer/Lasso, über dem Skript; rechts dann nicht zu öffnen', JSON.stringify(r.leftOpen) === '["left open:4"]' && JSON.stringify(r.leftTools.labels) === '["Stift","Textmarker","Radierer","Lasso"]' && r.leftTools.overlay],
    ['Werkzeugwechsel über die Randleiste', r.eraser && r.lasso && r.hl],
    ['beide zu → rechts öffnen', JSON.stringify(r.bothClosed) === '["left:0","right:0"]' && JSON.stringify(r.rightOpen) === '["right open:4"]'],
    ['Notiz setzen beendet den Stift', r.penOffForPlacing],
    ['nie Stift-Leiste und Notiz gleichzeitig', r.noInkWhileNote && r.penOn],
    ['Notiz öffnen beendet den Stift', r.penOffByNote],
    ['Kreuz entfernt „Neu in Version“ der Seite', r.flagsBefore >= 1 && r.flagsAfter === r.flagsBefore - 1 && JSON.stringify(r.stored) === '[2]' && /1 neue Seite/.test(r.banner)],
    ['keine Fehler', !errors.length],
  ]
  let ok = true
  for (const [n, pass] of checks) { ok &&= !!pass; console.log(`${pass ? '✓' : '✗'} ${n}`) }
  if (!ok) console.log(JSON.stringify(r, null, 1))
  process.exit(ok ? 0 : 1)
})()
