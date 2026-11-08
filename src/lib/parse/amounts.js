// Find the money amount that belongs to a label, whether it's on the same line ("Net Pay  £2,603.40")
// or printed underneath it in a table ("Net Pay" heading, amount on the next line, same column).
const MONEY = /£?\s*(-?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|-?\d+\.\d{2}|-?\d{4,7})(?![\d/])/;

const toPence = (s) => Math.round(parseFloat(String(s).replace(/,/g, '')) * 100);

export function amountFor(text, labelRe, { maxBelow = 2 } = {}) {
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelRe);
    if (!m) continue;
    const after = lines[i].slice(m.index + m[0].length);
    const same = after.match(MONEY);
    if (same && !/^\s*(ytd|year to date)/i.test(after)) return toPence(same[1]);
    // Underneath: take the amount closest to the label's column on the next lines.
    for (let k = 1; k <= maxBelow && i + k < lines.length; k++) {
      const row = lines[i + k];
      const re = new RegExp(MONEY.source, 'g');
      let best = null, x;
      while ((x = re.exec(row))) {
        const dist = Math.abs(x.index - m.index);
        if (dist < 30 && (!best || dist < best.dist)) best = { v: x[1], dist };
      }
      if (best) return toPence(best.v);
    }
  }
  return null;
}
