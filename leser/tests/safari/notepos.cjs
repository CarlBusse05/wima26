// Test: Öffnen/Schließen einer Notiz verschiebt das Skript nicht – in der Mitte des Lesebereichs bleibt dieselbe Stelle,
// die Ansicht wird nur kleiner/größer gezeichnet; nach dem Schließen ist alles wieder wie vorher.
// Das Notiz-Symbol wird mit der Seite kleiner/größer, und Pinch-Zoom links funktioniert bei offener Notiz.
//
//   npx vite --port 5173 &
//   node tests/safari/notepos.cjs [http://localhost:5173/]
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
  await p.locator('.script-tile').first().click()
  await p.waitForSelector('.page[data-page="2"] canvas')
  await p.evaluate(() => { document.querySelector('.pages').scrollTop = 900 })
  await p.waitForTimeout(400)
  // Stelle in der Mitte des Lesebereichs (Seite + Anteil der Seitenhöhe)
  const topSpot = () => p.evaluate(() => {
    const el = document.querySelector('.pages'); const v = el.getBoundingClientRect(); const y = v.top + v.height / 2
    const pg = [...document.querySelectorAll('.page')].find((x) => { const b = x.getBoundingClientRect(); return b.top <= y && b.bottom >= y })
    if (!pg) return null
    const b = pg.getBoundingClientRect()
    return { page: Number(pg.dataset.page), fy: (y - b.top) / b.height }
  })
  const same = (a, b) => !!a && !!b && a.page === b.page && Math.abs(a.fy - b.fy) < 0.01
  const top0 = await topSpot()
  await p.locator('button[aria-label="Notiz hinzufügen"]').click()
  await p.mouse.click(700, 500)
  await p.waitForSelector('.side-note')
  await (async () => { const e = await p.locator('.note-editor').boundingBox(); await p.mouse.click(e.x + e.width / 2, e.y + e.height - 40) })() // Tipp auf den leeren Teil der Notiz
  await p.keyboard.type('Test')
  await p.waitForTimeout(700)
  const marker = async () => {
    const m = await p.locator('.note-marker').boundingBox()
    return { y: Math.round(m.y + m.height / 2), size: Math.round(m.width) }
  }
  const r = {}
  r.open1 = await marker()
  r.topOpen1 = same(await topSpot(), top0)
  await p.locator('button[aria-label="Notiz schließen"]').click(); await p.waitForTimeout(700)
  r.closed = await marker()
  r.topClosed = same(await topSpot(), top0)
  await p.locator('.note-marker').click(); await p.waitForTimeout(700)
  r.open2 = await marker()
  r.topOpen2 = same(await topSpot(), top0)
  // Index-Leiste bei offener Notiz → Breite ändert sich erneut
  await p.locator('button[aria-label="Index"]').click(); await p.waitForTimeout(700)
  r.withIndex = await marker()
  await p.locator('button[aria-label="Index"]').click(); await p.waitForTimeout(700)

  // „Zur Notiz“-Symbol: nur sichtbar, wenn die Notiz aus dem Bild gescrollt ist; Antippen scrollt zurück
  r.locateHiddenWhileVisible = !(await p.locator('.note-locate').count())
  await p.evaluate(() => { document.querySelector('.pages').scrollTop += 2500 })
  await p.waitForTimeout(400)
  r.locateShownWhenAway = (await p.locator('.note-locate').count()) === 1
  r.locateRightOfTitle = await p.evaluate(() => {
    const t = document.querySelector('.note-head .with-icon').getBoundingClientRect()
    const b = document.querySelector('.note-locate').getBoundingClientRect()
    return b.left >= t.left && b.right <= t.right + 1 // im Titelbereich, rechts neben „Notiz · S. x“
  })
  await p.locator('.note-locate').click()
  await p.waitForTimeout(1200)
  const back = await p.locator('.note-marker').boundingBox()
  const area = await p.locator('.pages').boundingBox()
  r.backInView = back.y > area.y && back.y + back.height < area.y + area.height
  r.locateGoneAfter = !(await p.locator('.note-locate').count())

  // Bei offener Notiz woanders lesen und schließen → die Ansicht links bleibt (nur größer), kein Sprung zur Notiz
  await p.evaluate(() => { document.querySelector('.pages').scrollTop += 1800 })
  await p.waitForTimeout(400)
  r.noteOffBefore = (await p.locator('.note-locate').count()) === 1
  const before = await topSpot()
  await p.locator('button[aria-label="Notiz schließen"]').click()
  await p.waitForTimeout(700)
  r.closeKeepsView = same(await topSpot(), before)
  // Notiz öffnen, die gerade nicht zu sehen ist → ihre Seite wird angezeigt, die Notiz im oberen Bereich
  await p.evaluate(() => document.querySelector('.note-marker').click())
  await p.waitForSelector('.side-note')
  await p.waitForTimeout(800)
  r.openShowsNote = await p.evaluate(() => {
    const m = document.querySelector('.note-marker').getBoundingClientRect(); const v = document.querySelector('.pages').getBoundingClientRect()
    return m.top > v.top && m.bottom < v.top + v.height * 0.6
  })

  // Pinch-Zoom links bei offener Notiz
  // (bei offener Notiz steht deren Kopfzeile in der Leiste – Zoom über die Seitenbreite messen)
  const zoomText = () => p.evaluate(() => Math.round(document.querySelector('.page[data-page="2"]').getBoundingClientRect().width))
  r.zoom0 = await zoomText()
  const cdp = await ctx.newCDPSession(p)
  const pages = await p.locator('.pages').boundingBox()
  const cx = pages.x + pages.width / 2, cy = pages.y + 300
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) })
  await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]])
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[cx - 40 - i * 10, cy], [cx + 40 + i * 10, cy]]); await p.waitForTimeout(16) }
  await touch('touchEnd', [])
  await p.waitForTimeout(800)
  r.zoom1 = await zoomText()
  r.panelStillOpen = (await p.locator('.side-note').count()) === 1
  r.zoomed = await marker()

  // „Zur Notiz“ und sofort schließen (der Bildlauf läuft noch): die Notiz-Seite wird zur Ansicht – nicht die Stelle,
  // an der man vorher war, und nicht eine Zwischenposition
  await p.evaluate(() => { document.querySelector('.pages').scrollTop += 6000 })
  await p.waitForTimeout(400)
  await p.locator('.note-locate').click()
  await p.locator('button[aria-label="Notiz schließen"]').click()
  await p.waitForTimeout(1200)
  r.locateThenClose = await p.evaluate(() => {
    const m = document.querySelector('.note-marker').getBoundingClientRect(); const v = document.querySelector('.pages').getBoundingClientRect()
    return Math.round(Math.abs(m.top + m.height / 2 - (v.top + v.height / 2)))
  })
  await b.close()

  const near = (a, b) => Math.abs(a - b) <= 3
  const checks = [
    ['Öffnen: links dieselbe Ansicht, nur verkleinert (Mitte zeigt dieselbe Stelle)', r.topOpen1],
    ['Schließen: genau die Ansicht von vorher (Notiz wieder an der angetippten Stelle)', r.topClosed && near(r.closed.y, 500)],
    ['Wieder öffnen: dieselbe Ansicht', r.topOpen2 && near(r.open2.y, r.open1.y)],
    ['Index-Leiste bei offener Notiz: keine Verschiebung', near(r.withIndex.y, r.open2.y)],
    ['Symbol wird mit der Seite kleiner/größer', r.open2.size < r.closed.size && r.zoomed.size > r.open2.size],
    ['„Zur Notiz“ nur, wenn die Notiz nicht sichtbar ist', r.locateHiddenWhileVisible && r.locateShownWhenAway && r.locateRightOfTitle],
    ['„Zur Notiz“ scrollt zurück, danach verschwindet das Symbol', r.backInView && r.locateGoneAfter],
    ['Schließen nach Weiterlesen: die gelesene Ansicht bleibt (kein Sprung)', r.noteOffBefore && r.closeKeepsView],
    ['Öffnen einer nicht sichtbaren Notiz zeigt ihre Seite mit der Notiz', r.openShowsNote],
    ['„Zur Notiz“ und gleich schließen: die Notiz-Seite bleibt (Notiz in der Mitte)', r.locateThenClose < 40],
    ['Pinch-Zoom links bei offener Notiz', r.zoom1 !== r.zoom0 && r.panelStillOpen],
    ['keine Fehler', !errors.length],
  ]
  let ok = true
  for (const [n, pass] of checks) { ok &&= !!pass; console.log(`${pass ? '✓' : '✗'} ${n}`) }
  if (!ok) console.log(JSON.stringify({ r, errors }))
  process.exit(ok ? 0 : 1)
})()
