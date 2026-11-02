// Test für Pinch-Zoom: Zoom um den Punkt zwischen den Fingern, Safaris eigenes Scrollen ist während der Geste
// angehalten, und mit zwei Fingern lässt sich höchstens eine Seite nach oben/unten verschieben.
//
//   npx vite --port 5173 &
//   node tests/safari/pinch.cjs [http://localhost:5173/]
const { chromium } = require('playwright')
const path = require('path')
const BASE = process.argv[2] || 'http://localhost:5173/'

;(async () => {
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(BASE)
  // 24 Seiten, damit beim Verschieben genug Platz nach oben und unten ist
  await p.setInputFiles('input[type=file][accept="application/pdf"][multiple]', path.join(__dirname, 'lang-skript.pdf'))
  await p.waitForSelector('.script-tile')
  await p.locator('.script-tile').first().tap()
  await p.waitForSelector('.page[data-page="2"] canvas')
  const cdp = await ctx.newCDPSession(p)
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) })
  const probe = (x, y) => p.evaluate(({ x, y }) => {
    // Seite an der Stelle (oder die nächstgelegene, falls die Stelle im Zwischenraum liegt)
    const pg = [...document.querySelectorAll('.page')].reduce((best, el) => {
      const r = el.getBoundingClientRect(); const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
      return !best || d < best.d ? { el, d } : best
    }, null).el
    const r = pg.getBoundingClientRect()
    return { page: Number(pg.dataset.page), fx: +((x - r.left) / r.width).toFixed(3), fy: +((y - r.top) / r.height).toFixed(3) }
  }, { x, y })
  const gesture = async (from, to, steps = 12) => {
    await touch('touchStart', from)
    let overflow = ''
    for (let i = 1; i <= steps; i++) {
      const pts = from.map(([x, y], k) => [x + ((to[k][0] - x) * i) / steps, y + ((to[k][1] - y) * i) / steps])
      await touch('touchMove', pts)
      if (i === 2) overflow = await p.evaluate(() => document.querySelector('.pages').style.overflow)
      await p.waitForTimeout(16)
    }
    await touch('touchEnd', [])
    await p.waitForTimeout(700)
    return overflow
  }
  const r = {}
  await p.evaluate(() => { document.querySelector('.pages').scrollTop = 500 })
  await p.waitForTimeout(300)

  // 1. Zoomen ohne Verschieben: Punkt zwischen den Fingern bleibt
  const before = await probe(600, 700)
  r.overflowDuring = await gesture([[550, 700], [650, 700]], [[450, 700], [750, 700]])
  r.overflowAfter = await p.evaluate(() => document.querySelector('.pages').style.overflow)
  const after = await probe(600, 700)
  r.focus = before.page === after.page && Math.abs(before.fx - after.fx) < 0.01 && Math.abs(before.fy - after.fy) < 0.01

  // 2. Zwei Finger weit nach oben ziehen (ohne Zoom): höchstens eine Seite
  const p0 = await probe(512, 683)
  await gesture([[462, 1200], [562, 1200]], [[462, 100], [562, 100]], 20)
  const p1 = await probe(512, 683)
  r.pan = [p0.page, p1.page]

  // 3. Auf 25 % rauszoomen (Seiten sind dann klein), in die Mitte des Skripts, dann weit ziehen: höchstens eine Seite
  for (let i = 0; i < 20; i++) await p.locator('button[aria-label="Verkleinern"]').tap()
  await p.evaluate(() => { const el = document.querySelector('.pages'); el.scrollTop = el.scrollHeight / 2 - el.clientHeight / 2 })
  await p.waitForTimeout(500)
  r.minZoom = await p.locator('.reader-bar span.small.muted', { hasText: '%' }).textContent()
  const q0 = await probe(512, 683)
  await gesture([[462, 1250], [562, 1250]], [[462, 80], [562, 80]], 20)
  const q1 = await probe(512, 683)
  r.smallPan = [q0.page, q1.page]
  const z0 = await probe(512, 683)
  await gesture([[312, 683], [712, 683]], [[492, 1300], [532, 1300]], 20)
  const z1 = await probe(512, 683)
  r.zoomPan = [z0.page, z1.page]
  await b.close()

  const checks = [
    ['Safaris Scrollen während der Geste angehalten, danach wieder frei', r.overflowDuring === 'hidden' && r.overflowAfter === ''],
    ['Zoom um den Punkt zwischen den Fingern', r.focus],
    ['Verschieben mit zwei Fingern: höchstens 1 Seite', Math.abs(r.pan[1] - r.pan[0]) <= 1],
    ['bei 25 % weit ziehen: höchstens 1 Seite', r.minZoom === '25%' && Math.abs(r.smallPan[1] - r.smallPan[0]) <= 1],
    ['bei 25 % zoomen und dabei weit ziehen: höchstens 1 Seite', Math.abs(r.zoomPan[1] - r.zoomPan[0]) <= 1],
    ['keine Fehler', !errors.length],
  ]
  let ok = true
  for (const [n, pass] of checks) { ok &&= !!pass; console.log(`${pass ? '✓' : '✗'} ${n}`) }
  if (!ok) console.log(JSON.stringify({ r, errors }))
  process.exit(ok ? 0 : 1)
})()
