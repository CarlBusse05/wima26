// Test der Datumserkennung (src/lib/docdate.ts): neuester Aufschrieb ("Vorlesung 23. Oktober") statt Hochladedatum,
// ohne falsche Treffer aus Nummern ("Satz 2.3.") oder Terminen in Aufgaben.
//
//   npx vite --port 5173 &
//   node tests/library/docdate.cjs [http://localhost:5173/]
const { chromium } = require('playwright')
const BASE = process.argv[2] || 'http://localhost:5173/'
const UPLOAD = '2025-10-28T10:00:00'

const CASES = [
  ['Vorlesungen ohne Jahr', ['Vorlesung 16. Oktober', 'Text', 'Vorlesung 23. Oktober', 'Satz 2.3. Sei x gegeben.'], '23.10.'],
  ['Stand mit Jahr', ['Stand: 23.10.2025', 'Definition 1.1 Eine Relation'], '23.10.2025'],
  ['nur Nummern', ['Satz 2.3. Sei R eine Relation.', 'Kapitel 1.2. Grundlagen', 'Woche 3: Kapitel 1.2. Relationen'], null],
  ['Zinstermine in Aufgaben', ['Berechnen Sie die Zinsen für ein Darlehen vom 01.03.2025 bis 30.09.2025 bei 4 % p. a.'], null],
  ['Vorlesungsplan in der Zukunft', ['Vorlesung 15. Januar 2026', 'Vorlesung 23. Oktober 2025'], '23.10.2025'],
  ['Überschrift mit Wochentag', ['Montag, 6. Oktober 2025', 'Mittwoch, 22. Oktober 2025', 'Inhalt der Sitzung'], '22.10.2025'],
  // "30.10." ohne Jahr liegt nach dem Hochladen (28.10.2025) → gilt als 30.10.2024 und ist damit älter als der 23.10.
  ['Kürzel VL', ['VL 7 (30.10.)', 'VL 6 (23.10.)'], '23.10.'],
]

;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage()
  await p.goto(BASE)
  const got = await p.evaluate(async ({ CASES, UPLOAD }) => {
    const dd = await import('/src/lib/docdate.ts')
    return CASES.map(([, lines]) => {
      const page = { page: 1, width: 600, height: 800, items: lines.map((s, i) => ({ s, x: 50, y: 100 + i * 20, w: 500, h: 10, eol: true })) }
      const d = dd.findDocDate([page], new Date(UPLOAD).getTime())
      return d ? dd.formatDocDate(d) : null
    })
  }, { CASES, UPLOAD })
  await b.close()
  let ok = true
  CASES.forEach(([name, , exp], i) => {
    const pass = got[i] === exp
    ok &&= pass
    console.log(`${pass ? '✓' : '✗'} ${name}${pass ? '' : `: erwartet ${exp}, bekommen ${got[i]}`}`)
  })
  process.exit(ok ? 0 : 1)
})()
