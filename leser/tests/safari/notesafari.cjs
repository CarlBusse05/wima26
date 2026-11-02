// Test: Notiz öffnen/schließen bei verkleinertem Skript, mit nachgestelltem Safari-Verhalten auf dem iPad – dort
// springt die Scrollhöhe nach einer Größenänderung des Lesebereichs auf den alten Wert zurück. Ohne Gegenmaßnahme
// zeigt das Öffnen dann eine viel spätere Seite (kleinere Seiten, gleiche Scrollhöhe), das Schließen eine frühere.
//
//   npx vite --port 5173 &
//   node tests/safari/notesafari.cjs [http://localhost:5173/]
const { chromium } = require('playwright')
const path = require('path')
const BASE = process.argv[2] || 'http://localhost:5173/'

;(async () => {
  const b = await chromium.launch()
  const p = await (await b.newContext({ viewport: { width: 1000, height: 540 }, hasTouch: true })).newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(BASE)
  await p.setInputFiles('input[type=file][accept="application/pdf"][multiple]', path.join(__dirname, 'lang-skript.pdf'))
  await p.waitForSelector('.script-tile')
  await p.locator('.script-tile').first().click()
  await p.waitForSelector('.page[data-page="2"] canvas')
  for (let i = 0; i < 4; i++) { await p.locator('button[aria-label="Verkleinern"]').click(); await p.waitForTimeout(150) }
  await p.waitForTimeout(500)
  // Safari nachstellen: nach einer Größenänderung springt die Scrollhöhe auf den Wert davor zurück
  await p.evaluate(() => {
    const el = document.querySelector('.pages'); let last = el.scrollTop; let w = el.clientWidth
    el.addEventListener('scroll', () => { if (el.clientWidth === w) last = el.scrollTop })
    new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; const keep = last; setTimeout(() => { el.scrollTop = keep }, 0) } }).observe(el)
  })
  const mid = () => p.evaluate(() => {
    const el = document.querySelector('.pages'); const v = el.getBoundingClientRect(); const y = v.top + v.height / 2
    const pg = [...document.querySelectorAll('.page')].find((x) => { const r = x.getBoundingClientRect(); return r.top - 8 <= y && r.bottom + 8 >= y })
    if (!pg) return null
    const r = pg.getBoundingClientRect()
    return { page: Number(pg.dataset.page), fy: (y - r.top) / r.height }
  })
  const same = (a, c) => !!a && !!c && a.page === c.page && Math.abs(a.fy - c.fy) < 0.02
  await p.evaluate(() => document.querySelector('.page[data-page="14"]').scrollIntoView())
  await p.evaluate(() => { document.querySelector('.pages').scrollTop -= 150 })
  await p.waitForTimeout(600)
  const r = {}
  r.before = await mid()
  const pg = await p.locator('.page[data-page="14"]').boundingBox()
  await p.locator('button[aria-label="Notiz hinzufügen"]').click()
  await p.mouse.click(pg.x + pg.width * 0.85, pg.y + 120)
  await p.waitForSelector('.side-note')
  const e = await p.locator('.note-editor').boundingBox(); await p.mouse.click(e.x + 50, e.y + 30); await p.keyboard.type('x')
  await p.waitForTimeout(900)
  r.open = await mid()
  r.locateHidden = !(await p.locator('.note-locate').count())
  await p.locator('button[aria-label="Notiz schließen"]').click()
  await p.waitForTimeout(900)
  r.closed = await mid()
  // bei offener Notiz etwas weiterlesen (S. 13/14), dann schließen: diese Ansicht bleibt
  await p.locator('.note-marker').click()
  await p.waitForTimeout(900)
  await p.mouse.wheel(0, -120)
  await p.waitForTimeout(600)
  r.reading = await mid()
  await p.locator('button[aria-label="Notiz schließen"]').click()
  await p.waitForTimeout(900)
  r.closedAfterReading = await mid()
  await b.close()

  const checks = [
    ['Öffnen: links bleibt S. 14 (Mitte gleich), nicht eine viel spätere Seite', same(r.open, r.before) && r.locateHidden],
    ['Schließen: wieder genau die Ansicht von vorher', same(r.closed, r.before)],
    ['Schließen nach Weiterlesen: die zuletzt links gesehene Stelle bleibt in der Mitte', same(r.closedAfterReading, r.reading)],
    ['keine Fehler', !errors.length],
  ]
  let ok = true
  for (const [n, pass] of checks) { ok &&= !!pass; console.log(`${pass ? '✓' : '✗'} ${n}`) }
  if (!ok) console.log(JSON.stringify(r, null, 1))
  process.exit(ok ? 0 : 1)
})()
