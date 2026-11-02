// Test: Antippen einer Verknüpfung springt nicht, sondern zeigt die Definition als Ausschnitt in der Mitte
// (wie die Vorschau beim Abfragen). „Zur Stelle“ springt weiterhin.
//
//   npx vite --port 5173 &
//   node tests/safari/lookup.cjs [http://localhost:5173/]
const { chromium } = require('playwright')
const path = require('path')
const BASE = process.argv[2] || 'http://localhost:5173/'

;(async () => {
  const b = await chromium.launch()
  const p = await (await b.newContext({ viewport: { width: 1024, height: 1000 }, hasTouch: true, isMobile: true })).newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(BASE)
  await p.setInputFiles('input[type=file][accept="application/pdf"][multiple]', path.join(__dirname, 'test-skript.pdf'))
  await p.waitForSelector('.script-tile')
  await p.locator('.script-tile').first().tap()
  await p.waitForSelector('.page[data-page="5"]')
  await p.evaluate(() => document.querySelector('.page[data-page="5"]').scrollIntoView())
  await p.waitForSelector('.page[data-page="5"] span.dl')
  await p.waitForTimeout(400)
  const r = {}
  const top0 = await p.evaluate(() => document.querySelector('.pages').scrollTop)
  await p.locator('.page[data-page="5"] span.dl').first().tap()
  await p.waitForSelector('.lookup-card img', { timeout: 15000 })
  await p.waitForTimeout(400)
  r.noJump = (await p.evaluate(() => document.querySelector('.pages').scrollTop)) === top0
  r.centered = await p.evaluate(() => {
    const c = document.querySelector('.lookup-card').getBoundingClientRect()
    const v = document.querySelector('.reader-body').getBoundingClientRect()
    return Math.abs(c.left + c.width / 2 - (v.left + v.width / 2)) < 3 && Math.abs(c.top + c.height / 2 - (v.top + v.height / 2)) < 3
  })
  r.noBackbar = !(await p.locator('.backbar').count())
  await p.locator('.lookup-card button', { hasText: 'Zur Stelle' }).tap()
  await p.waitForTimeout(900)
  r.jumped = (await p.evaluate(() => document.querySelector('.pages').scrollTop)) !== top0 && (await p.locator('.backbar').count()) === 1
  await b.close()
  const checks = [
    ['kein Sprung beim Antippen', r.noJump && r.noBackbar],
    ['Ausschnitt in der Mitte des Lesebereichs', r.centered],
    ['„Zur Stelle“ springt weiterhin', r.jumped],
    ['keine Fehler', !errors.length],
  ]
  let ok = true
  for (const [n, pass] of checks) { ok &&= !!pass; console.log(`${pass ? '✓' : '✗'} ${n}`) }
  if (!ok) console.log(JSON.stringify({ r, errors }))
  process.exit(ok ? 0 : 1)
})()
