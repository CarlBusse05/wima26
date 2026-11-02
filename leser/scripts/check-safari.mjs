// Prüft, ob der eigene Code nur Funktionen nutzt, die Safari/iPadOS (Mindestversion aus
// package.json → "browserslist") kennt. Aufruf: npm run check:safari
//  1. Web-APIs (requestIdleCallback, navigator.*, …): eslint-plugin-compat
//  2. JavaScript-Builtins (Promise.try, Set.prototype.union, Iterator, …): direkt gegen die
//     MDN-Kompatibilitätsdaten, denn eslint-plugin-compat kennt neuere JS-Funktionen nicht.
// Typen werden vorher mit Vites oxc-Compiler entfernt.
import { readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { transformWithOxc } from 'vite'
import { ESLint } from 'eslint'
import compat from 'eslint-plugin-compat'
import * as espree from 'espree'
import { createRequire } from 'node:module'

const bcd = createRequire(import.meta.url)('@mdn/browser-compat-data')

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(os.tmpdir(), 'mathe-studium-check-safari')
const { browserslist } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
await rm(out, { recursive: true, force: true })

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) yield p
  }
}

const files = []
const sources = []
for await (const file of walk(path.join(root, 'src'))) {
  const rel = path.relative(root, file)
  const { code } = await transformWithOxc(await readFile(file, 'utf8'), file, { jsx: 'preserve', sourcemap: false })
  const target = path.join(out, rel.replace(/\.tsx?$/, '.jsx'))
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, code)
  files.push(target)
  sources.push({ rel, code })
}

const eslint = new ESLint({
  cwd: out,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.jsx'],
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { compat },
      settings: {
        browsers: browserslist,
        // ergänzt durch src/lib/polyfills.ts
        polyfills: ['Promise.withResolvers', 'ReadableStream'], // siehe POLYFILLED unten
      },
      rules: { 'compat/compat': 'error' },
    },
  ],
  ignore: false,
})
const results = await eslint.lintFiles(files)
let problems = 0
for (const r of results) {
  for (const m of r.messages) {
    problems++
    console.log(`${path.relative(out, r.filePath)}:${m.line}:${m.column}  ${m.message}`)
  }
}

// ---------- 2. JavaScript-Builtins gegen MDN-Daten ----------
const minVersion = (browser) => {
  const v = browserslist.filter((q) => q.startsWith(browser + ' ')).map((q) => parseFloat(q.split('>=')[1]))
  return v.length ? Math.min(...v) : null
}
const targets = { safari: minVersion('safari'), safari_ios: minVersion('ios_saf') }
const supported = (compat) =>
  Object.entries(targets).every(([b, min]) => {
    if (min == null) return true
    const entries = [compat.support[b]].flat().filter(Boolean)
    return entries.some((e) => {
      if (e.flags || e.partial_implementation || e.version_removed) return false
      const v = typeof e.version_added === 'string' ? parseFloat(e.version_added.replace('≤', '')) : NaN
      return !Number.isNaN(v) && v <= min
    })
  })

const badGlobals = new Map() // Iterator, Float16Array, …
const badStatics = new Map() // "Promise.try" → Hinweis
const memberOk = new Set() // Methodennamen, die es irgendwo unterstützt gibt (z. B. Array.prototype.map)
const badMembers = new Map() // ".union(" → "Set.prototype.union"
for (const [obj, data] of Object.entries(bcd.javascript.builtins)) {
  if (data.__compat && !supported(data.__compat)) badGlobals.set(obj, obj)
  const g = globalThis[obj]
  for (const [m, d] of Object.entries(data)) {
    if (m === '__compat' || !d.__compat) continue
    const isStatic = g != null && Object.prototype.hasOwnProperty.call(g, m)
    const isProto = g?.prototype != null && m in g.prototype
    const ok = supported(d.__compat)
    if (ok) memberOk.add(m)
    else if (isStatic || !isProto) badStatics.set(`${obj}.${m}`, `${obj}.${m}`)
    if (!ok && (isProto || !isStatic)) badMembers.set(m, `${obj}.prototype.${m}`)
  }
}
for (const m of memberOk) badMembers.delete(m)

// ergänzt durch src/lib/polyfills.ts
const POLYFILLED = ['Promise.withResolvers', 'ReadableStream.prototype.values']
for (const p of POLYFILLED) badStatics.delete(p)

let jsProblems = 0
for (const { rel, code } of sources) {
  if (rel.endsWith(path.join('lib', 'polyfills.ts'))) continue
  const toks = espree.tokenize(code, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true })
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.type !== 'Identifier') continue
    const prev = toks[i - 1]?.value
    const afterDot = prev === '.' || prev === '?.'
    const report = (what) => {
      jsProblems++
      console.log(`${rel}:${t.loc.start.line}:${t.loc.start.column + 1}  ${what} wird von Safari/iOS ${targets.safari} nicht unterstützt`)
    }
    if (!afterDot && badGlobals.has(t.value) && toks[i + 1]?.value !== ':') report(t.value)
    if (!afterDot && (toks[i + 1]?.value === '.' || toks[i + 1]?.value === '?.') && badStatics.has(`${t.value}.${toks[i + 2]?.value}`))
      report(`${t.value}.${toks[i + 2].value}`)
    if (afterDot && toks[i + 1]?.value === '(' && badMembers.has(t.value) && !badStatics.has(`${toks[i - 2]?.value}.${t.value}`))
      report(badMembers.get(t.value))
  }
}
problems += jsProblems

console.log(problems ? `\n${problems} Kompatibilitätsproblem(e) gefunden.` : `✓ ${files.length} Dateien: keine Web-APIs oder JS-Funktionen, die Safari/iPadOS ${targets.safari}+ fehlen.`)
process.exit(problems ? 1 : 0)
