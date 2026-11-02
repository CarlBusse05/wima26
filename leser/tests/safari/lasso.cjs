// Test für das Lasso (Werkzeug der Stift-Leiste): Zeichnungen umkreisen, verschieben (auch auf die nächste Seite),
// vergrößern/verkleinern (Griff und − / +), Rückgängig/Wiederholen, Löschen. Umkreist wird mit Pencil oder Maus (hier:
// Maus), der Finger scrollt; keine Hinweisleiste über dem Skript.
//
//   npx vite --port 5173 &
//   node tests/safari/lasso.cjs [http://localhost:5173/]
const { chromium } = require('playwright')
const path = require('path')
const BASE = process.argv[2] || 'http://localhost:5173/'
const stroke = (id, x, y) => ({ id, tool: 'pen', color: '#1f4fc4', width: 1.6, points: [x, y, 0.5, x + 60, y + 4, 0.5, x + 120, y, 0.5] })

;(async () => {
  const b = await chromium.launch()
  const p = await (await b.newContext({ viewport: { width: 1180, height: 900 }, hasTouch: true })).newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(BASE)
  await p.setInputFiles('input[type=file][accept="application/pdf"][multiple]', path.join(__dirname, 'lang-skript.pdf'))
  await p.waitForSelector('.script-tile')
  const id = await p.evaluate(async (strokes) => {
    const db = await import('/src/lib/db.ts')
    const [s] = await db.getAll('scripts')
    await db.put('annotations', { scriptId: s.id, updatedAt: Date.now(), pages: { 1: strokes } })
    return s.id
  }, [stroke('a', 100, 150), stroke('b', 100, 300), stroke('c', 300, 700)])
  await p.reload()
  await p.locator('.script-tile').first().click()
  await p.waitForSelector('.page[data-page="1"] canvas.ink')
  await p.waitForTimeout(500)

  const ink = () => p.evaluate(async (id) => {
    const ann = await (await import('/src/lib/db.ts')).get('annotations', id)
    return Object.fromEntries(Object.entries(ann.pages).filter(([, v]) => v.length).map(([k, v]) => [k, v.map((s) => `${s.id}@${Math.round(s.points[0])},${Math.round(s.points[1])}`)]))
  }, id)
  const pageBox = (n) => p.locator(`.page[data-page="${n}"]`).boundingBox()
  const scale = async () => (await pageBox(1)).width / (await p.evaluate(() => 595.28))
  // Lasso als Kreis um eine Stelle der Seite (Seiteneinheiten)
  const lassoAround = async (n, x, y, r) => {
    const pg = await pageBox(n); const s = pg.width / 595.28
    const cx = pg.x + x * s; const cy = pg.y + y * s
    await p.mouse.move(cx + r * s, cy)
    await p.mouse.down()
    for (let i = 1; i <= 24; i++) await p.mouse.move(cx + Math.cos((i / 24) * 2 * Math.PI) * r * s, cy + Math.sin((i / 24) * 2 * Math.PI) * r * s)
    await p.mouse.up()
  }
  const dragSelection = async (dx, dy) => {
    const bx = await p.locator('.lasso-box').boundingBox()
    await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
    await p.mouse.down()
    await p.mouse.move(bx.x + bx.width / 2 + dx, bx.y + bx.height / 2 + dy, { steps: 8 })
    await p.mouse.up()
  }
  const selected = () => p.locator('.lasso-box').count()
  const sizeOf = async (strokeId) => p.evaluate(async ({ sid, id }) => {
    const ann = await (await import('/src/lib/db.ts')).get('annotations', sid)
    const s = Object.values(ann.pages).flat().find((x) => x.id === id)
    const xs = s.points.filter((_, i) => i % 3 === 0)
    return { w: Math.round(Math.max(...xs) - Math.min(...xs)), x0: Math.round(Math.min(...xs)), width: s.width }
  }, { sid: id, id: strokeId })
  const r = {}

  r.noBarButton = (await p.locator('.reader-bar button[aria-label="Lasso"]').count()) === 0
  await p.locator('.reader-bar button[title^="Mit Stift"]').click()
  await p.locator('.ink-bar button[aria-label="Lasso"]').click()
  r.layer = await p.locator('.lasso-layer').count()
  r.colorsHidden = (await p.locator('.ink-bar .swatch').count()) === 0
  // Strich a umkreisen (Mitte bei x≈160, y≈152)
  await lassoAround(1, 160, 152, 90)
  r.sel = await selected()
  r.noHint = (await p.locator('.lasso-hint, .snip-hint').count()) === 0
  const s = await scale()
  await dragSelection(100 * s, 50 * s)
  await p.waitForTimeout(1200)
  r.moved = await ink()
  // Rückgängig / Wiederholen
  await p.keyboard.press('Control+z')
  await p.waitForTimeout(1200)
  r.undone = await ink()
  await p.keyboard.press('Control+Shift+z')
  await p.waitForTimeout(1200)
  r.redone = await ink()

  // Strich c (unten auf S. 1, y≈700) auf S. 2 ziehen
  await p.evaluate(() => { const el = document.querySelector('.pages'); el.scrollTop += 700 })
  await p.waitForTimeout(400)
  await lassoAround(1, 360, 702, 90)
  r.selC = await selected()
  const p1 = await pageBox(1); const p2 = await pageBox(2)
  await dragSelection(0, p2.y - p1.y - 600 * s) // → S. 2 bei y≈100+
  await p.waitForTimeout(1200)
  r.toPage2 = await ink()
  r.stillSelected = await selected()

  // Vergrößern über den Griff (Breite 120 → 240) und − / +
  const before = await sizeOf('c')
  const h = await p.locator('.lasso-handle').boundingBox()
  const bx = await p.locator('.lasso-box').boundingBox()
  const inner = bx.width - 16
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await p.mouse.down()
  await p.mouse.move(h.x + h.width / 2 + inner, h.y + h.height / 2 + 5, { steps: 6 })
  await p.mouse.up()
  await p.waitForTimeout(1200)
  r.bigger = { before, after: await sizeOf('c') }
  await p.locator('.lasso-actions button[aria-label="Auswahl verkleinern"]').click()
  await p.waitForTimeout(1200)
  r.smaller = await sizeOf('c')
  await p.locator('.lasso-actions button[aria-label="Auswahl vergrößern"]').click()
  await p.waitForTimeout(1200)
  r.again = await sizeOf('c')

  // Löschen
  await p.locator('.lasso-actions button[aria-label="Auswahl löschen"]').click()
  await p.waitForTimeout(1200)
  r.deleted = await ink()
  // zurück zum Stift: Lasso aus
  await p.locator('.ink-bar button[aria-label="Stift"]').click()
  r.closed = (await p.locator('.lasso-layer').count()) === 0
  await b.close()

  const checks = [
    ['Lasso ist ein Werkzeug der Stift-Leiste (keine Farben), nicht in der oberen Leiste', r.noBarButton && r.layer === 1 && r.colorsHidden],
    ['Umkreisen wählt den Strich aus – ohne Hinweisleiste über dem Skript', r.sel === 1 && r.noHint],
    ['Ziehen verschiebt den Strich', JSON.stringify(r.moved) === JSON.stringify({ 1: ['b@100,300', 'c@300,700', 'a@200,200'] })],
    ['Rückgängig / Wiederholen', JSON.stringify(r.undone['1'].sort()) === JSON.stringify(['a@100,150', 'b@100,300', 'c@300,700']) && JSON.stringify(r.redone) === JSON.stringify(r.moved)],
    ['Auf die nächste Seite gezogen', r.selC === 1 && JSON.stringify(r.toPage2['1']) === JSON.stringify(['b@100,300', 'a@200,200']) && r.toPage2['2']?.length === 1 && /^c@300,(9[0-9]|1[0-2][0-9])$/.test(r.toPage2['2'][0]) && r.stillSelected === 1],
    ['Griff vergrößert (Schrift und Strichstärke)', r.bigger.before.w === 120 && Math.abs(r.bigger.after.w - 240) <= 8 && Math.abs(r.bigger.after.x0 - 300) <= 2 && r.bigger.after.width > 3],
    ['− verkleinert, + vergrößert', r.smaller.w < r.bigger.after.w && Math.abs(r.again.w - r.bigger.after.w) <= 2],
    ['Löschen entfernt die Auswahl', !r.deleted['2'] && r.deleted['1'].length === 2],
    ['Wechsel zum Stift beendet das Lasso', r.closed],
    ['keine Fehler', !errors.length],
  ]
  let ok = true
  for (const [n, pass] of checks) { ok &&= !!pass; console.log(`${pass ? '✓' : '✗'} ${n}`) }
  if (!ok) console.log(JSON.stringify(r, null, 1))
  process.exit(ok ? 0 : 1)
})()
