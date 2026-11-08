// Minimal .xlsx reader (no library): an .xlsx file is a zip of XML files. Reads every sheet's
// cell values (numbers, text, cached formula results) into rows. Works in the browser and Node 18+.

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Files in a zip: { name: Uint8Array }. */
async function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // End of central directory: last 22+ bytes, signature 0x06054b50.
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid .xlsx file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.xml$|\.rels$/.test(name)) continue;
    const lNameLen = dv.getUint16(local + 26, true), lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = u8.subarray(start, start + csize);
    files[name] = method === 0 ? data : method === 8 ? await inflate(data) : null;
  }
  return files;
}

const text = (u8) => (u8 ? new TextDecoder().decode(u8) : '');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** @returns {Promise<Array<{name: string, rows: Array<Array<string|number|null>>}>>} */
export async function readXlsx(buf) {
  const files = await unzip(buf);
  const shared = [...text(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const wb = text(files['xl/workbook.xml']);
  const rels = text(files['xl/_rels/workbook.xml.rels']);
  const target = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const sheets = [...wb.matchAll(/<sheet\b[^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)].map((m) => ({ name: unesc(m[1]), path: 'xl/' + String(target[m[2]] || '').replace(/^\/?xl\//, '') }));
  return sheets.map(({ name, path }) => {
    const xml = text(files[path]);
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], body = c[2] || '';
        const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
        const type = (attrs.match(/\bt="([^"]+)"/) || [])[1];
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = null;
        if (type === 's' && v != null) val = shared[+v] ?? null;
        else if (type === 'inlineStr') val = unesc([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        else if (type === 'str' || type === 'e') val = v != null ? unesc(v) : null;
        else if (type === 'b') val = v === '1';
        else if (v != null) val = Number.isNaN(+v) ? unesc(v) : +v;
        if (ref) row[colIndex(ref)] = val; else row.push(val);
      }
      rows.push(Array.from(row, (x) => (x === undefined ? null : x)));
    }
    return { name, rows };
  });
}
