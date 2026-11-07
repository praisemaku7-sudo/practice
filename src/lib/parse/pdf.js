// Browser-only: extracts positioned text lines from a PDF with pdf.js.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** @returns {Promise<{lines: Array, pageCount: number, hasText: boolean}>} */
export async function extractPdfLines(arrayBuffer, { password } = {}) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), password }).promise;
  const lines = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = [];
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
    lines.push(...rows);
  }
  return { lines, pageCount: doc.numPages, hasText: chars > 50 };
}
