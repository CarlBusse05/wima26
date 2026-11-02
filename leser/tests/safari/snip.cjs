// Test für das Ausschnitt-Werkzeug (✂️): Bereich mit dem Finger aufziehen → PNG in der Zwischenablage;
// außerdem Rückgängig/Wiederholen-Pfeile in der Stift-Leiste und das Start-Symbol oben links.
//
//   npx vite --port 5173 &
//   node tests/safari/snip.cjs [http://localhost:5173/]
const { chromium } = require('playwright')
const path = require('path')
const BASE = process.argv[2] || 'http://localhost:5173/'

;(async () => {
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(BASE)
  await p.setInputFiles('input[type=file][accept="application/pdf"][multiple]', path.join(__dirname, 'test-skript.pdf'))
  await p.waitForSelector('.script-tile')
  await p.locator('.script-tile').first().tap()
  await p.waitForSelector('.page[data-page="1"] canvas')
  await p.waitForTimeout(500)
  const r = {}

  // Ausschnitt mit dem Finger aufziehen
  await p.locator('.reader-bar button[aria-label="Ausschnitt"]').tap()
  await p.waitForSelector('.snip-overlay')
  const pg = await p.locator('.page[data-page="1"]').boundingBox()
  const cdp = await ctx.newCDPSession(p)
  const x0 = pg.x + 40, y0 = pg.y + 40
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 30, y: y0 + i * 15 }] })
    await p.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await p.waitForSelector('.snip-img', { timeout: 15000 })
  r.status = await p.$eval('.snip-modal [role=status]', (x) => x.textContent)
  r.clipboard = await p.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const blob = await items[0].getType('image/png')
    const bmp = await createImageBitmap(blob)
    // nicht leer: einige dunkle Pixel (Text)
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const g = c.getContext('2d')
    g.drawImage(bmp, 0, 0)
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data
    let dark = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 100) dark++
    return { type: blob.type, w: bmp.width, h: bmp.height, dark }
  })
  await p.locator('.snip-modal button[aria-label="Schließen"]').tap()

  // Zeichnen: ← / → rechts oben, Ende nur über „Stift“
  await p.locator('.reader-bar button[title^="Mit Stift"]').tap()
  r.noExitArrow = !(await p.locator('.draw-exit').count())
  const box = await p.locator('.page[data-page="1"]').boundingBox()
  const draw = (y) => p.evaluate(({ x, y }) => {
    const c = document.querySelector('.page[data-page="1"] canvas.ink')
    const ev = (t, i) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'pen', pressure: 0.5, clientX: x + i * 10, clientY: y, buttons: 1 }))
    ev('pointerdown', 0); for (let i = 1; i < 8; i++) ev('pointermove', i); ev('pointerup', 8)
  }, { x: box.x + 100, y })
  const count = () => p.evaluate(async () => {
    await new Promise((res) => setTimeout(res, 700))
    const db = await import('/src/lib/db.ts')
    const [s] = await db.getAll('scripts')
    const a = await db.get('annotations', s.id)
    return (a?.pages?.[1] ?? []).length
  })
  await draw(box.y + 200)
  await draw(box.y + 260)
  r.drawn = await count()
  await p.locator('.ink-history button[aria-label="Rückgängig"]').tap()
  r.afterUndo = await count()
  await p.locator('.ink-history button[aria-label="Wiederholen"]').tap()
  r.afterRedo = await count()
  r.historyPos = await p.evaluate(() => { const h = document.querySelector('.ink-history').getBoundingClientRect(); return [Math.round(innerWidth - h.right), !!document.querySelector('.ink-bar .ink-history')] })
  r.stillDrawing = await p.locator('.ink-bar').count()
  await p.locator('.reader-bar button[title^="Mit Stift"]').tap()
  r.ended = !(await p.locator('.ink-bar').count())

  // Start-Knopf oben links
  const home = await p.locator('.reader-bar .home-btn').boundingBox()
  r.homeText = (await p.locator('.reader-bar .home-btn').textContent()).trim()
  await p.locator('.reader-bar .home-btn').tap()
  await p.waitForSelector('.script-tile')
  r.home = { x: Math.round(home.x), y: Math.round(home.y), back: p.url().endsWith('#/') || !p.url().includes('#/script') }
  await b.close()

  const checks = [
    ['Ausschnitt in der Zwischenablage (PNG mit Inhalt)', r.clipboard.type === 'image/png' && r.clipboard.w > 500 && r.clipboard.dark > 50 && /kopiert/.test(r.status)],
    ['kein Pfeil zum Beenden mehr', r.noExitArrow],
    ['← nimmt den letzten Strich zurück, → stellt ihn wieder her', r.drawn === 2 && r.afterUndo === 1 && r.afterRedo === 2],
    ['Pfeile rechts in der Stift-Leiste', r.historyPos[0] < 40 && r.historyPos[1] && r.stillDrawing === 1],
    ['Zeichnen endet über „Stift“', r.ended],
    ['Start-Symbol oben links (ohne Text) führt zur Startseite', r.home.x < 40 && r.home.y < 40 && r.home.back && r.homeText === ''],
    ['keine Fehler', !errors.length],
  ]
  let ok = true
  for (const [n, pass] of checks) {
    ok &&= !!pass
    console.log(`${pass ? '✓' : '✗'} ${n}`)
  }
  if (!ok) console.log(JSON.stringify({ r, errors }))
  process.exit(ok ? 0 : 1)
})()
