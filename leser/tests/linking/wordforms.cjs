// Regressionstest für verwandte Wortformen (src/lib/wordforms.ts + buildLinker): Adjektiv ↔ Nomen in beide
// Richtungen, gebeugte Formen, eigene Wortpaare – und Wörter, die NICHT verknüpft werden dürfen.
//
//   npx vite --port 5173 &
//   node tests/linking/wordforms.cjs [http://localhost:5173/]
const { chromium } = require('playwright')

const BASE = process.argv[2] || 'http://localhost:5173/'

// Seite 1: Definitionen, Seite 2: Text mit Verweisen
const DEFS = [
  ['injektiv', 100], ['Surjektivität', 110], ['symmetrisch', 120], ['Antisymmetrie', 130], ['disjunkt', 140],
  ['reflexiv', 150], ['Transitivität', 160], ['assoziativ', 170], ['Kommutativität', 180], ['bijektiv', 190],
  ['Geometrie', 200], ['Gleichheit', 210], ['Häufungspunkt', 220], ['stetig', 400],
]
const LINES = [
  'Die Injektivität und die injektiven, injektiver Abbildungen.',
  'Jede surjektive Abbildung, surjektiv.',
  'Die Symmetrie, Symmetrien und symmetrischen Relationen.',
  'Eine antisymmetrische Relation ist antisymmetrisch.',
  'Die Disjunktheit disjunkter Mengen.',
  'Reflexivität, transitive Relation, Assoziativität, kommutativ, die Bijektivität.',
  'Eine geometrische Reihe ist gleich der Summe.',
  'Ein Häufungswert ist ein Häufungspunkt.',
  'Stetigkeit und stetige Funktionen.',
]
// erwartet: verlinkter Text → Begriff, auf den verwiesen wird
const EXPECTED = [
  'Injektivität → injektiv', 'injektiven → injektiv', 'injektiver → injektiv',
  'surjektive → Surjektivität', 'surjektiv → Surjektivität',
  'Symmetrie → symmetrisch', 'Symmetrien → symmetrisch', 'symmetrischen → symmetrisch',
  'antisymmetrische → Antisymmetrie', 'antisymmetrisch → Antisymmetrie',
  'Disjunktheit → disjunkt', 'disjunkter → disjunkt',
  'Reflexivität → reflexiv', 'transitive → Transitivität', 'Assoziativität → assoziativ', 'kommutativ → Kommutativität', 'Bijektivität → bijektiv',
  // "geometrische" ≠ Geometrie, "gleich" ≠ Gleichheit → keine Links
  'Häufungspunkt → Häufungspunkt',
  'Stetigkeit → stetig', 'stetige → stetig',
]
const EXPECTED_WITH_PAIR = [...EXPECTED.slice(0, 17), 'Häufungswert → Häufungspunkt', ...EXPECTED.slice(17)]

;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage()
  await p.goto(BASE)
  const r = await p.evaluate(async ({ DEFS, LINES }) => {
    const ix = await import('/src/lib/indexer.ts')
    const pdf = await import('/src/lib/pdf.ts')
    const page2 = { page: 2, width: 600, height: 800, items: LINES.map((s, i) => ({ s, x: 50, y: 100 + i * 20, w: 500, h: 10, eol: true })) }
    const entries = DEFS.map(([t, y], i) => ({ id: 'e' + i, kind: 'Definition', terms: [t], page: 1, y: y - 2, yEnd: y + 9, source: 'auto', text: t }))
    // "Stetigkeit" hat nur ein erstes Vorkommen VOR der Definition von "stetig" → Familie verweist auf die Definition
    entries.push({ id: 'b1', kind: 'Begriff', terms: ['Stetigkeit'], page: 1, y: 40, yEnd: 50, source: 'auto', hint: 'erstes Vorkommen', text: '' })
    const run = (pairs) => {
      const byId = new Map(entries.map((e) => [e.id, e]))
      const { text } = pdf.pageString(page2)
      return ix.buildLinker(entries, [], [], pairs).link(page2, text).map((l) => `${text.slice(l.start, l.end)} → ${byId.get(l.entryId).terms[0]}`)
    }
    const wf = await import('/src/lib/wordforms.ts')
    return { plain: run([]), pair: run([['Häufungspunkt', 'Häufungswert']]), forms: wf.relatedForms('injektive') }
  }, { DEFS, LINES })
  await b.close()
  let ok = true
  for (const [name, got, exp] of [['ohne Paare', r.plain, EXPECTED], ['mit eigenem Paar', r.pair, EXPECTED_WITH_PAIR]]) {
    const pass = JSON.stringify(got) === JSON.stringify(exp)
    ok &&= pass
    console.log(`${pass ? '✓' : '✗'} ${name}${pass ? '' : `\n  erwartet ${JSON.stringify(exp)}\n  bekommen ${JSON.stringify(got)}`}`)
  }
  process.exit(ok ? 0 : 1)
})()
