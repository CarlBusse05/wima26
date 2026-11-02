// Eigener Einstiegspunkt für den PDF-Worker: erst die Polyfills, dann der Legacy-Worker von pdf.js.
import "./polyfills";
import "pdfjs-dist/legacy/build/pdf.worker.mjs";
