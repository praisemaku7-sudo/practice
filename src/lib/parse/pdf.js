// Browser-only: extracts positioned text lines from a PDF with pdf.js, or renders pages to images.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function open(arrayBuffer, password) {
  // pdf.js transfers the buffer to its worker, so always hand it a copy.
  return pdfjs.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)), password }).promise;
}

/** @returns {Promise<{lines: Array, pageCount: number, hasText: boolean}>} */
export async function extractPdfLines(arrayBuffer, { password } = {}) {
  const doc = await open(arrayBuffer, password);
  const pages = await Promise.all(Array.from({ length: doc.numPages }, async (_, i) => {
    const p = i + 1;
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = [];
    let chars = 0;
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      chars += it.str.length;
      const x = it.transform[4];
      const y = it.transform[5];
      const h = Math.abs(it.transform[3]) || 8;
      // Group items whose baselines are within ~40% of the font height.
      let row = rows.find((r) => Math.abs(r.y - y) < h * 0.4);
      if (!row) { row = { page: p, y, items: [] }; rows.push(row); }
      row.items.push({ x, w: it.width, str: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) r.items.sort((a, b) => a.x - b.x);
    return { rows, chars };
  }));
  const lines = pages.flatMap((p) => p.rows);
  const chars = pages.reduce((a, p) => a + p.chars, 0);
  const pageCount = doc.numPages;
  doc.destroy();
  return { lines, pageCount, hasText: chars > 50 };
}

/** Render pages to JPEG (base64) for scanned statements with no text layer. */
export async function renderPageImages(arrayBuffer, { password, maxDim = 1568 } = {}) {
  const doc = await open(arrayBuffer, password);
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, maxDim / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    out.push(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
  }
  doc.destroy();
  return out;
}
