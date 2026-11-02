// Regressionstest für Erkennung und Verlinkung (src/lib/indexer.ts) an einem Test-Skript mit Fallen:
// fett/kursiv gesetzte Begriffe, "heißt …"-Sätze, Begriffe vor ihrer Definition, doppelte Definitionen,
// Silbentrennung, Vorwärtsverweise, ein nie definierter Fachbegriff (Äquivalenzrelation → erstes Vorkommen). definitionen-cmbx.pdf ist dasselbe mit LaTeX-Schriftnamen (CMBX10).
//
//   npx vite --port 5173 &
//   node tests/linking/check.cjs [http://localhost:5173/]
//
// Benötigt Playwright mit Chromium.
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = process.argv[2] || 'http://localhost:5173/'

// Seite → erwartete Links "Text → Seite Ziel". Ziel ist immer die ERSTE Stelle davor.
const EXPECTED = {
  1: ['Ordnungsrelation → 1', 'Ordnungsrelation → 1', 'reflexiv → 1'], // "Supremum" steht VOR seiner Definition → kein Link
  2: ['Ordnungsrelation → 1', 'total → 1', 'Teilmenge → 2', 'reflexiv → 1', 'transitiv → 1'],
  3: ['obere Schranke → 2', 'injektive → 2'], // "Supremum" in Definition 3.2 selbst → kein Link
  4: ['Supremum → 3', 'totale → 1', 'Ordnungs-relation → 1', 'Teilmenge → 2', 'Kette → 2', 'reflexiv → 1', 'transitiv → 1', 'Halbordnung → 4'], // "Satz 5.1" = Vorwärtsverweis → kein Link
  5: ['Satz 4.1 → 4', 'Definition 3.2 → 3', 'Supremum → 3'],
  // Halbordnung → erste Definition (S. 4), nicht die spätere 5.1; Äquivalenzrelation → erstes Vorkommen (S. 2)
  6: ['Halbordnung → 4', 'total → 1', 'Kette → 2', 'obere Schranken → 2', 'Ordnungsrelation → 1', 'Halbordnung → 4', 'Äquivalenzrelation → 2', 'Äquivalenzrelation → 2'],
}
const EXPECTED_TERMS = ['Ordnungsrelation', 'total', 'oberen Schranken', 'injektiv', 'Kette', 'Supremum', 'Halbordnung', 'Äquivalenzrelation']
const NOT_TERMS = ['Beweis', 'Achtung', 'Grundlagen', 'Schranken'] // Gliederung/Überschriften, keine Begriffe

;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage()
  await p.goto(BASE)
  let ok = true
  for (const file of ['definitionen.pdf', 'definitionen-cmbx.pdf']) {
    const b64 = fs.readFileSync(path.join(__dirname, file)).toString('base64')
    const r = await p.evaluate(async (b64) => {
      const pdf = await import('/src/lib/pdf.ts')
      const ix = await import('/src/lib/indexer.ts')
      const doc = await pdf.loadPdf(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]))
      const pages = await pdf.extractAll(doc)
      const entries = ix.detectEntries(pages)
      const linker = ix.buildLinker(entries)
      const byId = new Map(entries.map((e) => [e.id, e]))
      const links = {}
      for (const pg of pages) {
        const { text } = pdf.pageString(pg)
        links[pg.page] = linker.link(pg, text).map((l) => `${text.slice(l.start, l.end).replace(/\n/g, '')} → ${byId.get(l.entryId).page}`)
      }
      return { links, terms: entries.flatMap((e) => e.terms) }
    }, b64)
    const errors = []
    for (const [pg, exp] of Object.entries(EXPECTED)) {
      if (JSON.stringify(r.links[pg]) !== JSON.stringify(exp)) errors.push(`S. ${pg}: erwartet ${JSON.stringify(exp)}, bekommen ${JSON.stringify(r.links[pg])}`)
    }
    for (const t of EXPECTED_TERMS) if (!r.terms.includes(t)) errors.push(`Begriff fehlt: ${t}`)
    for (const t of NOT_TERMS) if (r.terms.includes(t)) errors.push(`fälschlich als Begriff erkannt: ${t}`)
    console.log(`${errors.length ? '✗' : '✓'} ${file}${errors.length ? '\n  ' + errors.join('\n  ') : ''}`)
    ok &&= !errors.length
  }
  await b.close()
  process.exit(ok ? 0 : 1)
})()
