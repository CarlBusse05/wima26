// Vorschaubilder der ersten Seite für die Kacheln der Startseite. Werden bei Bedarf erzeugt und in der
// IndexedDB zwischengespeichert (nicht in der Datensicherung – sie lassen sich jederzeit neu erzeugen).

import { get, put } from "./db";
import { closePdf, loadPdf } from "./pdf";

const WIDTH = 360; // Pixel – reicht für eine Kachel auch auf Retina-Bildschirmen

interface Thumb {
  id: string;
  version: number;
  blob: Blob;
}

let queue: Promise<unknown> = Promise.resolve();

/** Vorschaubild als Blob; erzeugt es, falls es fehlt oder zu einer älteren Version gehört. */
export function thumbnail(scriptId: string, version: number): Promise<Blob | null> {
  // nacheinander erzeugen, damit das iPad nicht mehrere PDFs gleichzeitig im Speicher hält
  const job = queue.then(async () => {
    const cached = await get<Thumb>("thumbs", scriptId);
    if (cached?.blob && cached.version === version) return cached.blob;
    const file = await get<{ id: string; blob: Blob }>("files", scriptId);
    if (!file) return null;
    const doc = await loadPdf(file.blob);
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: WIDTH / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
      canvas.width = canvas.height = 0;
      if (blob) await put<Thumb>("thumbs", { id: scriptId, version, blob });
      return blob;
    } finally {
      await closePdf(doc);
    }
  });
  queue = job.catch(() => null);
  return job.catch(() => null);
}
