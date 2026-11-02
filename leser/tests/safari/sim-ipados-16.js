// Simuliert Safari/iPadOS 16.4–18.3: zusätzlich ohne Iterator-Helfer.
// Entfernt im Browser (und per Testskript in jedem Worker) APIs, die Safari fehlen.
(() => {
  const g = typeof globalThis !== "undefined" ? globalThis : self;
  const del = (o, k) => { try { if (o && k in o) { delete o[k]; if (k in o) Object.defineProperty(o, k, { value: undefined, configurable: true, writable: true }); } } catch { /* nicht löschbar */ } };
  if (g.ReadableStream) { del(g.ReadableStream.prototype, Symbol.asyncIterator); del(g.ReadableStream.prototype, "values"); del(g.ReadableStream, "from"); }
  del(g.Promise, "withResolvers"); del(g.Promise, "try");
  del(g.Map.prototype, "getOrInsertComputed"); del(g.Map.prototype, "getOrInsert");
  del(g.WeakMap.prototype, "getOrInsertComputed"); del(g.WeakMap.prototype, "getOrInsert");
  del(g.Map, "groupBy"); del(g.Object, "groupBy");
  del(g.Array, "fromAsync");
  del(g.Uint8Array.prototype, "toHex"); del(g.Uint8Array.prototype, "toBase64"); del(g.Uint8Array, "fromBase64"); del(g.Uint8Array, "fromHex");
  del(g.Uint8Array.prototype, "setFromBase64"); del(g.Uint8Array.prototype, "setFromHex");
  del(g.Math, "sumPrecise"); del(g.URL, "parse"); del(g.RegExp, "escape"); del(g.Error, "isError");
  for (const k of ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"]) del(g.Set.prototype, k);
  if (g.Iterator) { for (const k of ["map", "filter", "take", "drop", "flatMap", "reduce", "toArray", "forEach", "some", "every", "find"]) del(g.Iterator.prototype, k); del(g, "Iterator"); }
  del(g, "Float16Array");
  if (g.HTMLCanvasElement) del(g.HTMLCanvasElement.prototype, "transferControlToOffscreen");
})();
