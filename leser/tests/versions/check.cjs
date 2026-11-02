// Test für "Neue Version hochladen" (src/lib/versions.ts) über die Oberfläche:
// skript-v1.pdf hochladen, Notizen/eigene Einträge/entfernte Verknüpfungen anlegen, dann skript-v2.pdf als neue
// Version hochladen und prüfen, dass alles über den Seiteninhalt richtig übertragen wurde.
//
//   npx vite --port 5173 &
//   node tests/versions/check.cjs [http://localhost:5173/]
const { chromium } = require('playwright')
const path = require('path')

const BASE = process.argv[2] || 'http://localhost:5173/'
const stroke = (id, y) => ({ id, tool: 'pen', color: '#1f4fc4', width: 1.6, points: [100, y, 0.5, 140, y + 4, 0.5] })

;(async () => {
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(BASE)
  await p.fill('input[placeholder^="Fach"]', 'Analysis I')
  await p.setInputFiles('input[type=file][accept="application/pdf"][multiple]', path.join(__dirname, 'skript-v1.pdf'))
  await p.waitForSelector('.script-tile', { timeout: 20000 })

  // Ausgangslage: Notizen auf S. 1, 2, 3, 4 (fällt weg) und 5, eigener Eintrag auf S. 3, Verknüpfungen entfernt, Leseposition S. 5
  const before = await p.evaluate(async (strokes) => {
    const db = await import('/src/lib/db.ts')
    const ix = await import('/src/lib/indexer.ts')
    const pdf = await import('/src/lib/pdf.ts')
    const [s] = await db.getAll('scripts')
    const idx = await db.get('indexes', s.id)
    // die Fundstelle "Ordnungsrelation" auf S. 3 einzeln entfernen
    const text3 = pdf.pageString(idx.pages[2]).text
    const at = text3.indexOf('Ordnungsrelation')
    idx.disabledLinks = [ix.linkKey(3, at, 'Ordnungsrelation')]
    idx.disabledTerms = ['reflexiv']
    idx.entries.push({ id: 'manual1', kind: 'Definition', terms: ['Kleiner-gleich'], page: 4, y: 60, yEnd: 90, source: 'manual', text: 'Beispiel 1.4' })
    await db.put('indexes', idx)
    await db.put('annotations', { scriptId: s.id, updatedAt: Date.now(), pages: { 1: [strokes[0]], 2: [strokes[4]], 3: [strokes[1]], 4: [strokes[2]], 5: [strokes[3]] } })
    await db.put('scripts', { ...s, lastPage: 5 })
    return { id: s.id, pages: s.pageCount }
  }, [stroke('s1', 200), stroke('s3', 300), stroke('s4', 400), stroke('s5', 500), stroke('s2', 250)])
  await p.reload()
  await p.waitForSelector('.script-tile')

  // Kachel: Vorschaubild, Fach, Leseposition
  await p.waitForSelector('.script-tile .thumb img', { timeout: 20000 })
  const tile = await p.$eval('.script-tile', (t) => t.innerText.replace(/\s+/g, ' '))

  // Neue Version über das ⋯-Menü
  await p.locator('.tile-more').tap()
  await p.waitForSelector('.tile-menu')
  const menu = await p.$$eval('.tile-menu button', (bs) => bs.map((x) => x.textContent.trim()))
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.locator('.tile-menu button', { hasText: 'Neue Version hochladen' }).tap()])
  await chooser.setFiles(path.join(__dirname, 'skript-v2.pdf'))
  await p.waitForSelector('.version-report', { timeout: 20000 })
  const report = await p.$eval('.version-report', (r) => r.innerText)

  const after = await p.evaluate(async (id) => {
    const db = await import('/src/lib/db.ts')
    const s = await db.get('scripts', id)
    const idx = await db.get('indexes', id)
    const ann = await db.get('annotations', id)
    return {
      scripts: (await db.getAll('scripts')).length,
      title: s.title, course: s.course, version: s.version, pageCount: s.pageCount, lastPage: s.lastPage, changes: s.changes,
      ink: Object.fromEntries(Object.entries(ann.pages).map(([k, v]) => [k, v.map((x) => `${x.id}@${x.points[1]}`)])),
      orphans: (ann.orphans ?? []).map((o) => `${o.oldPage}:${o.strokes.map((x) => x.id)}`),
      compare: (ann.compare ?? []).map((c) => `${c.oldPage}→${c.newPage}:${c.strokes.map((x) => x.id)}`),
      compareFile: ann.compareFile, oldKept: !!(ann.compareFile && (await db.get('files', ann.compareFile))),
      footers: idx.pages.map((pg) => pg.items.filter((it) => it.y > pg.height * 0.9).map((it) => it.s).join(' ')),
      manual: idx.entries.filter((e) => e.source === 'manual').map((e) => `${e.terms[0]}@${e.page}`),
      disabledTerms: idx.disabledTerms, disabledLinks: idx.disabledLinks,
    }
  }, before.id)
  const tiles = await p.$$eval('.script-tile', (t) => t.map((x) => x.innerText.replace(/\s+/g, ' ')))

  // Im Skript: Hinweisleiste, Markierungen, Notizen ohne Seite
  await p.locator('.script-tile').first().click()
  await p.waitForSelector('.version-banner', { timeout: 20000 })
  const banner = await p.$eval('.version-banner', (x) => x.innerText.replace(/\s+/g, ' '))
  await p.waitForSelector('.page-flag', { timeout: 20000 })
  const flags = await p.$$eval('.page-flags', (fs) => fs.map((f) => f.innerText.replace(/\s+/g, ' ')))
  await p.locator('.version-banner button', { hasText: 'ohne Seite' }).click()
  await p.waitForSelector('.orphan canvas')
  await p.locator('.orphan button', { hasText: 'legen' }).click()
  await p.waitForTimeout(800)
  const orphansLeft = await p.evaluate(async (id) => ((await (await import('/src/lib/db.ts')).get('annotations', id)).orphans ?? []).length, before.id)

  await b.close()

  const checks = [
    ['Kachel zeigt Fach und Leseposition', /Analysis I/.test(tile) && /Seite 5 von 5/.test(tile)],
    ['Menü mit Umbenennen/Fach/Neue Version/Löschen', ['Umbenennen', 'Fach ändern', 'Neue Version hochladen', 'Löschen'].every((x) => menu.some((m) => m.includes(x)))],
    ['dasselbe Skript (eine Kachel, gleicher Name/Fach)', after.scripts === 1 && after.title === 'skript-v1' && after.course === 'Analysis I' && tiles.length === 1],
    ['Version 2 mit 7 Seiten', after.version === 2 && after.pageCount === 7],
    ['Leseposition bleibt (alte S. 5 = neue S. 5)', after.lastPage === 5],
    ['Notizen unveränderter Seiten über den Inhalt zugeordnet (S. 2 → 3, S. 5 bleibt 5)', JSON.stringify(after.ink) === JSON.stringify({ 1: ['s1@200'], 3: ['s2@250'], 5: ['s5@500'] })],
    ['andere Seitenzahl in der Fußzeile zählt nicht als Änderung – verschobene Seite mit neuer Seitenzahl', after.footers.join('|') === 'Seite 1|Seite 2|Seite 3|Seite 4|Seite 5|Seite 6|Seite 7'],
    ['geänderte Seite mit Notizen → Verbesserungsansicht (alt S. 3 ↔ neu S. 4)', JSON.stringify(after.compare) === JSON.stringify(['3→4:s3']) && after.oldKept],
    ['unveränderte Seiten ohne Vergleich übernommen', after.changes.unchanged === 3],
    ['Notizen der gestrichenen Seite gesammelt', JSON.stringify(after.orphans) === JSON.stringify(['4:s4'])],
    ['neue Seiten erkannt', JSON.stringify(after.changes.newPages) === JSON.stringify([2, 6, 7])],
    ['geänderte Seite mit Notizen markiert', JSON.stringify(after.changes.review) === JSON.stringify([4])],
    ['eigener Eintrag der gestrichenen Seite gemeldet', after.changes.droppedEntries === 1 && after.manual.length === 0],
    ['entfernte Verknüpfungen bleiben entfernt', JSON.stringify(after.disabledTerms) === '["reflexiv"]' && after.disabledLinks.length === 1 && after.disabledLinks[0].startsWith('4:')],
    ['Zusammenfassung', /5 → 7 Seiten/.test(report) && /3 neue Seiten/.test(report) && /ohne Gegenstück/.test(report) && /3 unveränderte Seiten/.test(report) && /Verbesserungsansicht/.test(report)],
    ['Hinweisleiste im Skript', /Neue Version 2/.test(banner) && /3 neue Seiten/.test(banner) && /vergleichen/.test(banner)],
    ['Seiten markiert (neu / geändert)', flags.filter((f) => /Neu in Version 2/.test(f)).length === 3 && flags.some((f) => /Inhalt geändert/.test(f))],
    ['Notiz ohne Seite auf aktuelle Seite gelegt', orphansLeft === 0],
    ['keine Fehler', !errors.length],
  ]
  let ok = true
  for (const [name, pass] of checks) {
    ok &&= !!pass
    console.log(`${pass ? '✓' : '✗'} ${name}`)
  }
  if (!ok) console.log(JSON.stringify({ tile, menu, report, after, banner, flags, orphansLeft, errors }, null, 1))
  process.exit(ok ? 0 : 1)
})()
