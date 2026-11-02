// Ergänzt Browser-Funktionen, die pdf.js 6 voraussetzt, Safari/iPadOS aber (noch) nicht hat.
// Wird im Hauptthread UND im PDF-Worker geladen – deshalb keine DOM-Zugriffe.
// Weitere fehlende Funktionen (Iterator-Helfer, Map.getOrInsertComputed, Uint8Array.toHex, …)
// bringt der Legacy-Build von pdf.js über core-js selbst mit.

type Resolvers<T> = { promise: Promise<T>; resolve: (v: T | PromiseLike<T>) => void; reject: (e?: unknown) => void };

// Safari < 17.4
if (typeof (Promise as { withResolvers?: unknown }).withResolvers !== "function") {
  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: function withResolvers<T>(): Resolvers<T> {
      let resolve!: Resolvers<T>["resolve"];
      let reject!: Resolvers<T>["reject"];
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
  });
}

// Safari kann `for await (const x of readableStream)` nicht – genau daran scheiterte der Import
// ("undefined is not a function (near '...e of t...')" in page.getTextContent()).
if (typeof ReadableStream !== "undefined") {
  const proto = ReadableStream.prototype as ReadableStream & {
    values?: (opts?: { preventCancel?: boolean }) => AsyncIterableIterator<unknown>;
    [Symbol.asyncIterator]?: () => AsyncIterableIterator<unknown>;
  };
  if (typeof proto[Symbol.asyncIterator] !== "function") {
    const values = function (this: ReadableStream, opts?: { preventCancel?: boolean }): AsyncIterableIterator<unknown> {
      const reader = this.getReader();
      const preventCancel = !!opts?.preventCancel;
      const it: AsyncIterableIterator<unknown> = {
        async next() {
          try {
            const r = await reader.read();
            if (r.done) reader.releaseLock();
            return r.done ? { done: true, value: undefined } : { done: false, value: r.value };
          } catch (e) {
            reader.releaseLock();
            throw e;
          }
        },
        async return(value?: unknown) {
          if (!preventCancel) {
            const cancelled = reader.cancel(value);
            reader.releaseLock();
            await cancelled;
          } else reader.releaseLock();
          return { done: true, value };
        },
        [Symbol.asyncIterator]() {
          return it;
        },
      };
      return it;
    };
    Object.defineProperty(proto, "values", { configurable: true, writable: true, value: values });
    Object.defineProperty(proto, Symbol.asyncIterator, { configurable: true, writable: true, value: values });
  }
}

export {};
