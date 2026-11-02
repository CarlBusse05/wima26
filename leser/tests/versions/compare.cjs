// Test der Verbesserungsansicht: skript-v1.pdf mit Notizen auf S. 3 hochladen, skript-v2.pdf als neue Version
// (S. 3 wurde geändert und ist dort S. 4). Dann: Vergleich öffnen (alt links, neu rechts), mit dem Lasso links
// auswählen und rechts einfügen bzw. hinüberziehen, alte Notiz kopieren, rechts zeichnen, alles übernehmen, alte Seite behalten – bzw. „Fertig“.
//
//   npx vite --port 5173 &
//   node tests/versions/compare.cjs [http://localhost:5173/]
const { chromium } = require('playwright')
const path = require('path')
const BASE = process.argv[2] || 'http://localhost:5173/'
const stroke = (id, y) => ({ id, tool: 'pen', color: '#1f4fc4', width: 1.6, points: [100, y, 0.5, 160, y + 4, 0.5, 220, y, 0.5] })

async function setup(b) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 1024 }, hasTouch: true })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('dialog', (d) => d.accept())
  await p.goto(BASE)
  await p.setInputFiles('input[type=file][accept="application/pdf"][multiple]', path.join(__dirname, 'skript-v1.pdf'))
  await p.waitForSelector('.script-tile')
  const id = await p.evaluate(async ({ a, c }) => {
    const db = await import('/src/lib/db.ts')
    const [s] = await db.getAll('scripts')
    await db.put('annotations', {
      scriptId: s.id, updatedAt: Date.now(),
      pages: { 3: [a, c] },
      notes: [{ id: 'alt', page: 3, x: 300, y: 250, html: '<div>Alte Notiz</div>', createdAt: 1, updatedAt: 1 }],
    })
    await db.put('scripts', { ...s, lastPage: 5 })
    return s.id
  }, { a: stroke('a', 100), c: stroke('c', 400) })
  await p.reload()
  await p.waitForSelector('.script-tile')
  await p.locator('.tile-more').click()
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.locator('.tile-menu button', { hasText: 'Neue Version hochladen' }).click()])
  await ch.setFiles(path.join(__dirname, 'skript-v2.pdf'))
  await p.waitForSelector('.version-report', { timeout: 20000 })
  await p.locator('.script-tile').first().click()
  await p.waitForSelector('.version-banner')
  return { p, id, errors }
}
const state = (p, id) => p.evaluate(async (id) => {
  const db = await import('/src/lib/db.ts')
  const s = await db.get('scripts', id); const idx = await db.get('indexes', id); const ann = await db.get('annotations', id)
  const files = (await db.getAll('files')).map((f) => f.id)
  return {
    pageCount: s.pageCount, lastPage: s.lastPage,
    text4: idx.pages[3]?.items.map((i) => i.s).join(' '), text5: idx.pages[4]?.items.map((i) => i.s).join(' '),
    ink: Object.fromEntries(Object.entries(ann.pages).map(([k, v]) => [k, v.map((x) => x.id.length > 3 ? 'neu' : x.id)])),
    notes: (ann.notes ?? []).map((n) => `${n.page}:${n.html.replace(/<[^>]+>/g, '')}`),
    pending: (ann.compare ?? []).filter((c) => !c.done).length, compareFile: ann.compareFile ?? null, files,
  }
}, id)

;(async () => {
  const b = await chromium.launch()
  const r = {}

  // ---------- Szenario 1: kopieren, einfügen, zeichnen, alles übernehmen, alte Seite behalten ----------
  const { p, id, errors } = await setup(b)
  await p.locator('.version-banner button', { hasText: 'vergleichen' }).click()
  await p.waitForSelector('.compare .compare-old-page canvas')
  await p.waitForTimeout(800)
  r.twoColumns = await p.evaluate(() => {
    const cols = [...document.querySelectorAll('.compare-col')].map((c) => c.getBoundingClientRect())
    return cols.length === 2 && cols[0].right <= cols[1].left
  })
  r.oldShowsNotes = await p.evaluate(() => {
    const c = document.querySelector('.compare-old-page canvas.ink'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n > 20 && !!document.querySelector('.compare-old-page .note-marker')
  })
  const oldBox = await p.locator('.compare-old-page').boundingBox()
  const newBox = await p.locator('.compare-new .page').boundingBox()
  const sc = oldBox.width / 595.28
  // Lasso: oberen Strich (y≈100) links umkreisen, rechts antippen → eingefügt
  const lassoAround = async (box, x, y, rad) => {
    const cx = box.x + x * sc; const cy = box.y + y * sc
    await p.mouse.move(cx + rad * sc, cy)
    await p.mouse.down()
    for (let i = 1; i <= 24; i++) await p.mouse.move(cx + Math.cos((i / 24) * 2 * Math.PI) * rad * sc, cy + Math.sin((i / 24) * 2 * Math.PI) * rad * sc)
    await p.mouse.up()
  }
  await p.locator('.reader-bar button[title^="Mit Stift"]').click()
  await p.locator('.ink-bar button[aria-label="Lasso"]').click()
  await p.waitForTimeout(300)
  Object.assign(oldBox, await p.locator('.compare-old-page').boundingBox()) // die Stift-Leiste verschiebt die Ansicht
  Object.assign(newBox, await p.locator('.compare-new .page').boundingBox())
  await lassoAround(oldBox, 160, 102, 80)
  r.copySel = await p.locator('.lasso-box.copy').count()
  await p.mouse.click(newBox.x + 100 * sc, newBox.y + 600 * sc) // rechts antippen = einfügen
  await p.waitForTimeout(900)
  r.afterTap = (await state(p, id)).ink['4']?.length ?? 0
  // unteren Strich (y≈400) links umkreisen und auf die neue Seite hinüberziehen
  await lassoAround(oldBox, 160, 402, 80)
  const lb = await p.locator('.lasso-box').boundingBox()
  await p.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2)
  await p.mouse.down()
  await p.mouse.move(lb.x + lb.width / 2 + (newBox.x - oldBox.x), lb.y + lb.height / 2 + 100 * sc, { steps: 10 })
  await p.mouse.up()
  await p.waitForTimeout(900)
  r.afterDrag = (await state(p, id)).ink['4']?.length ?? 0
  r.noHint = (await p.locator('.lasso-hint, .snip-hint').count()) === 0
  await p.locator('.reader-bar button[title^="Mit Stift"]').click() // Stift-Werkzeuge aus
  // alte Notiz kopieren und rechts einfügen
  await p.locator('.compare-old-page .note-marker').click()
  await p.mouse.click(newBox.x + 350 * sc, newBox.y + 650 * sc)
  // rechts mit dem Pencil zeichnen
  await p.locator('.reader-bar button[title^="Mit Stift"]').click()
  await p.locator('.ink-bar button[aria-label="Stift"]').click()
  const nb = await p.locator('.compare-new .page').boundingBox()
  await p.evaluate(({ x, y }) => {
    const c = document.querySelector('.compare-new canvas.ink')
    const ev = (t, i) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 4, pointerType: 'pen', pressure: 0.5, clientX: x + i * 10, clientY: y, buttons: 1 }))
    ev('pointerdown', 0); for (let i = 1; i < 8; i++) ev('pointermove', i); ev('pointerup', 8)
  }, { x: nb.x + 60, y: nb.y + nb.height * 0.8 })
  await p.locator('.reader-bar button[title^="Mit Stift"]').click()
  // alles übernehmen
  await p.locator('.compare-bar button', { hasText: 'Alles übernehmen' }).click()
  await p.waitForTimeout(900)
  const mid = await state(p, id)
  r.afterCopy = mid
  // alte Seite behalten
  await p.locator('.compare-bar button', { hasText: 'Alte Seite behalten' }).click()
  await p.waitForTimeout(2500)
  const fin = await state(p, id)
  r.afterKeep = fin
  r.compareClosed = (await p.locator('.compare').count()) === 0
  r.bannerNoCompare = !/vergleichen/.test((await p.locator('.version-banner').textContent().catch(() => '')) || '')
  r.errors1 = errors
  await p.context().close()

  // ---------- Szenario 2: nur prüfen („Fertig“) ----------
  const s2 = await setup(b)
  await s2.p.locator('.version-banner button', { hasText: 'vergleichen' }).click()
  await s2.p.waitForSelector('.compare')
  await s2.p.locator('.compare-bar button', { hasText: 'Fertig' }).click()
  await s2.p.waitForTimeout(800)
  r.done = await state(s2.p, s2.id)
  r.doneClosed = (await s2.p.locator('.compare').count()) === 0
  r.errors2 = s2.errors
  await b.close()

  const checks = [
    ['Vergleich: alte Fassung links, neue rechts', r.twoColumns],
    ['links die alte Seite mit ihren Zeichnungen und Notizen', r.oldShowsNotes],
    ['Lasso (Stift-Leiste) links wählt aus, Tippen rechts fügt ein, Hinüberziehen kopiert', r.copySel === 1 && r.afterTap === 1 && r.afterDrag === 2 && r.noHint],
    ['Kopiertes, alte Notiz, Gezeichnetes und „Alles übernehmen“ landen auf der neuen Seite',
      JSON.stringify(r.afterCopy.ink['4']) === JSON.stringify(['neu', 'neu', 'neu', 'neu', 'neu']) && r.afterCopy.notes.filter((n) => n.startsWith('4:Alte Notiz')).length === 2],
    ['alte Seite behalten: steht vor der neuen, Skript hat eine Seite mehr', r.afterKeep.pageCount === 8 && /Reflexivität\./.test(r.afterKeep.text4) && !/korrigiert/.test(r.afterKeep.text4) && /korrigiert/.test(r.afterKeep.text5)],
    ['alte Seite behält ihre Notizen, die neue ihre Übernahmen', JSON.stringify(r.afterKeep.ink['4']) === JSON.stringify(['a', 'c']) && (r.afterKeep.ink['5'] || []).length === 5 && r.afterKeep.notes.includes('4:Alte Notiz') && r.afterKeep.notes.filter((n) => n.startsWith('5:')).length === 2],
    ['Leseposition rückt mit (S. 5 → 6)', r.afterKeep.lastPage === 6],
    ['danach: Vergleich erledigt, alte PDF aufgeräumt', r.afterKeep.pending === 0 && r.afterKeep.compareFile === null && r.afterKeep.files.length === 1 && r.compareClosed && r.bannerNoCompare],
    ['„Fertig“: geprüft, nichts übernommen, alte PDF aufgeräumt', r.done.pending === 0 && r.done.compareFile === null && !r.done.ink['4'] && r.done.pageCount === 7 && r.doneClosed],
    ['keine Fehler', !r.errors1.length && !r.errors2.length],
  ]
  let ok = true
  for (const [n, pass] of checks) { ok &&= !!pass; console.log(`${pass ? '✓' : '✗'} ${n}`) }
  if (!ok) console.log(JSON.stringify(r, null, 1))
  process.exit(ok ? 0 : 1)
})()
