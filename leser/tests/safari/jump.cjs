// Test: Sprünge zu Wörtern setzen das Wort in die Mitte des Lesebereichs – Suche (Enter: nächste Fundstelle,
// Shift+Enter: vorige) und Sprünge zu Definitionen (Index, „Zur Stelle“).
//
//   npx vite --port 5173 &
//   node tests/safari/jump.cjs [http://localhost:5173/]
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
  await p.waitForTimeout(500)
  const r = {}

  // Abstand eines Elements zur Mitte des Lesebereichs (px)
  const offCenter = (sel) => p.evaluate((sel) => {
    const v = document.querySelector('.pages').getBoundingClientRect()
    const els = [...document.querySelectorAll(sel)]
    if (!els.length) return null
    const cy = v.top + v.height / 2
    return Math.min(...els.map((e) => { const b = e.getBoundingClientRect(); return Math.round(Math.abs(b.top + b.height / 2 - cy)) }))
  }, sel)

  // Suchbegriff, der auf mehreren Seiten vorkommt: ein Begriff aus dem Index einer späteren Seite
  const entry = await p.evaluate(async () => {
    const db = await import('/src/lib/db.ts')
    const [s] = await db.getAll('scripts')
    const idx = await db.get('indexes', s.id)
    const e = idx.entries.filter((x) => x.terms.length && x.page >= 3).sort((a, b) => b.page - a.page)[0]
    return { page: e.page, term: e.terms[0], id: e.id }
  })
  r.entry = entry
  await p.fill('input[placeholder^="Im Skript suchen"]', entry.term)
  await p.press('input[placeholder^="Im Skript suchen"]', 'Enter')
  await p.waitForTimeout(1500)
  r.hit1 = await offCenter('.flash')
  r.hitMarked = await offCenter('.page .hit, .page .dl')
  r.counter1 = await p.locator('.search-count').textContent()
  const top1 = await p.evaluate(() => document.querySelector('.pages').scrollTop)
  await p.press('input[placeholder^="Im Skript suchen"]', 'Enter')
  await p.waitForTimeout(1500)
  r.hit2 = await offCenter('.flash')
  r.counter2 = await p.locator('.search-count').textContent()
  r.moved2 = (await p.evaluate(() => document.querySelector('.pages').scrollTop)) !== top1
  await p.press('input[placeholder^="Im Skript suchen"]', 'Shift+Enter')
  await p.waitForTimeout(1500)
  r.counter3 = await p.locator('.search-count').textContent()
  await p.fill('input[placeholder^="Im Skript suchen"]', '')

  // Sprung zur Definition über den Index: der Begriff steht in der Mitte
  await p.evaluate(() => { document.querySelector('.pages').scrollTop = 0 })
  await p.waitForTimeout(400)
  await p.locator('button[aria-label="Index"]').click()
  await p.locator('.side-left .entry', { hasText: entry.term }).first().click()
  await p.waitForTimeout(1500)
  r.def = await p.evaluate((term) => {
    const v = document.querySelector('.pages').getBoundingClientRect()
    const cy = v.top + v.height / 2
    const spans = [...document.querySelectorAll('.page .textLayer span')].filter((s) => s.textContent.toLowerCase().includes(term.toLowerCase()))
    if (!spans.length) return null
    return Math.min(...spans.map((s) => { const b = s.getBoundingClientRect(); return Math.round(Math.abs(b.top + b.height / 2 - cy)) }))
  }, entry.term)
  await b.close()

  const checks = [
    ['Suche: Fundstelle in der Mitte des Lesebereichs', r.hit1 !== null && r.hit1 < 30],
    ['Enter: nächste Fundstelle, wieder in der Mitte; Zähler', r.hit2 !== null && r.hit2 < 30 && /^1\//.test(r.counter1.trim()) && /^2\//.test(r.counter2.trim()) && /^1\//.test(r.counter3.trim())],
    ['Sprung zur Definition: Begriff in der Mitte', r.def !== null && r.def < 30],
    ['keine Fehler', !errors.length],
  ]
  let ok = true
  for (const [n, pass] of checks) { ok &&= !!pass; console.log(`${pass ? '✓' : '✗'} ${n}`) }
  if (!ok) console.log(JSON.stringify(r, null, 1))
  process.exit(ok ? 0 : 1)
})()
