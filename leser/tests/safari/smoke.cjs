// Smoke-Test „Safari/iPad“: entfernt in Chromium die APIs, die Safari fehlen (auch im PDF-Worker),
// emuliert ein iPad mit Touch und prüft PDF-Import, Verlinkung, Stift, PDF-Export und Datensicherung.
//
//   npm run build && npx vite preview --port 4173 &
//   node tests/safari/smoke.cjs [http://localhost:4173/]
//
// Benötigt Playwright mit Chromium (require('playwright')).
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = process.argv[2] || 'http://localhost:4173/'
const PDF = path.join(__dirname, 'test-skript.pdf')

async function run(simFile) {
  const SIM = fs.readFileSync(path.join(__dirname, simFile), 'utf8')
  const b = await chromium.launch()
  const ctx = await b.newContext({
    viewport: { width: 1024, height: 1366 },
    hasTouch: true,
    isMobile: true,
    acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  })
  await ctx.addInitScript(SIM)
  let workers = 0
  await ctx.route(/worker[^/]*\.m?js(\?.*)?$/, async (route) => {
    const resp = await route.fetch()
    workers++
    await route.fulfill({ response: resp, body: SIM + '\n' + (await resp.text()) })
  })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
  p.on('worker', (w) => w.on('console', (m) => m.type() === 'error' && errors.push('worker: ' + m.text())))

  const result = { sim: simFile }
  try {
    await p.goto(BASE)
    await p.setInputFiles('input[type=file][accept="application/pdf"]', PDF)
    await p.waitForSelector('.script-tile', { timeout: 20000 })
    result.import = true
    await p.locator('.script-tile').first().tap()
    await p.waitForSelector('.page[data-page="5"]', { timeout: 20000 })
    await p.evaluate(() => document.querySelector('.page[data-page="5"]').scrollIntoView())
    await p.waitForSelector('.page[data-page="5"] span.dl', { timeout: 20000 })
    result.links = await p.$$eval('.page[data-page="5"] span.dl', (e) => e.length)

    const pb = await p.locator('.page[data-page="5"]').boundingBox()

    // Stift + Export
    await p.locator('.reader-bar button[title^="Mit Stift"]').tap()
    // gezeichnet wird nur mit dem Apple Pencil (pointerType "pen")
    await p.evaluate(({ x, y }) => {
      const c = document.querySelector('.page[data-page="5"] canvas.ink')
      const ev = (t, i) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 5, pointerType: 'pen', pressure: 0.5, clientX: x + i * 10, clientY: y + (i % 2) * 8, buttons: 1 }))
      ev('pointerdown', 0)
      for (let i = 1; i < 12; i++) ev('pointermove', i)
      ev('pointerup', 12)
    }, { x: pb.x + 100, y: pb.y + 300 })
    // Pfeile rechts oben: ← nimmt den Strich zurück, → stellt ihn wieder her; beendet wird über „Stift“
    await p.locator('.ink-history button[aria-label="Rückgängig"]').tap()
    result.undo = await p.locator('.ink-history button[aria-label="Wiederholen"]').isEnabled()
    await p.locator('.ink-history button[aria-label="Wiederholen"]').tap()
    result.redo = !(await p.locator('.ink-history button[aria-label="Wiederholen"]').isEnabled())
    await p.locator('.reader-bar button[title^="Mit Stift"]').tap()
    result.drawEnded = !(await p.locator('.ink-history').count())
    await p.evaluate(() => { navigator.canShare = undefined })
    await p.locator('.reader-bar button[aria-label="Als PDF exportieren"]').tap()
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.locator('.mini-popup button[title^="Skript inkl."]').tap()])
    result.export = dl.suggestedFilename()
    // ohne Notizen: das unveränderte Original
    await p.locator('.reader-bar button[aria-label="Als PDF exportieren"]').tap()
    const [plain] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.locator('.mini-popup button[title^="Skript ohne"]').tap()])
    result.exportPlain = plain.suggestedFilename()
    result.plainIsOriginal = fs.readFileSync(await plain.path()).equals(fs.readFileSync(PDF))

    // Datensicherung
    await p.goto(BASE + '#/settings')
    await p.locator('text=Daten exportieren').tap()
    const [bk] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.locator('text=Datei sichern').tap()])
    result.backup = bk.suggestedFilename()
  } catch (e) {
    result.failure = e.message.split('\n')[0]
  }
  result.workersPatched = workers
  result.errors = errors
  await b.close()
  return result
}

;(async () => {
  let ok = true
  for (const sim of ['sim-ipados-16.js', 'sim-ipados-18.js']) {
    const r = await run(sim)
    const pass = r.import && r.links > 0 && r.undo && r.redo && r.drawEnded && r.export && r.plainIsOriginal && r.backup && r.workersPatched > 0 && !r.errors.length && !r.failure
    ok &&= !!pass
    console.log(`${pass ? '✓' : '✗'} ${sim}`, JSON.stringify(r))
  }
  process.exit(ok ? 0 : 1)
})()
