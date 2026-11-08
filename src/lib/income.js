// Income: each person's take-home (payslip / SA302 / typed, or estimated from statements),
// temporary income that replaces it for a while (maternity pay…), and household income such as
// Child Benefit. Worked out month by month, so the forecast knows when maternity pay ends.

export const FREQ = { week: 'a week', '2week': 'every 2 weeks', '4week': 'every 4 weeks', month: 'a month', year: 'a year' };

/** pence per period → pence per month */
export function toMonthly(amount, freq = 'month') {
  const f = { week: 52 / 12, '2week': 26 / 12, '4week': 13 / 12, month: 1, year: 1 / 12 }[freq] ?? 1;
  return Math.round(amount * f);
}

const inRange = (month, from, until) => (!from || month >= from) && (!until || month <= until);

/** A temporary income (e.g. maternity) that applies in this month, or null. */
export function tempFor(settings, personId, month) {
  const t = settings.tempIncome?.[personId];
  return t && t.monthly && inRange(month, t.from, t.until) ? t : null;
}

/** Household extras (Child Benefit…) in this month; scope = 'all' or a person's id. */
export function otherFor(settings, month, scope = 'all') {
  return (settings.otherIncome || []).filter((x) => inRange(month, x.from, x.until) && (scope === 'all' || x.owner === scope || (!x.owner && false)))
    .map((x) => ({ ...x, monthly: toMonthly(x.amount, x.freq) }));
}

/**
 * Where a person's money comes from in a month.
 * @returns {{monthly, kind: 'temp'|'payslip'|'sa302'|'typed'|'estimate'|'none', label}}
 */
export function personFor(settings, personId, month, estimate = () => 0) {
  const t = tempFor(settings, personId, month);
  if (t) return { monthly: t.monthly, kind: 'temp', label: t.label };
  const usual = settings.scoped?.[personId]?.income;
  if (usual != null) {
    const kind = settings.payslips?.[personId] ? 'payslip' : settings.sa302s?.[personId]?.length ? 'sa302' : 'typed';
    return { monthly: usual, kind, label: kind === 'payslip' ? 'Payslip' : kind === 'sa302' ? 'SA302' : 'Typed in' };
  }
  const e = estimate(personId);
  return e ? { monthly: e, kind: 'estimate', label: 'Estimated from statements' } : { monthly: 0, kind: 'none', label: 'Not set' };
}

/** Total take-home for a month: everyone in scope plus household extras. */
export function householdFor(settings, month, { scope = 'all', estimate } = {}) {
  const people = scope === 'all' ? settings.people : settings.people.filter((p) => p.id === scope);
  const lines = people.map((p) => ({ who: p.id, name: p.name, ...personFor(settings, p.id, month, estimate) }));
  const extras = otherFor(settings, month, scope).map((x) => ({ who: x.owner || 'joint', name: x.label, monthly: x.monthly, kind: 'other', label: FREQ[x.freq] }));
  const all = [...lines, ...extras];
  return { total: all.reduce((a, l) => a + l.monthly, 0), lines: all };
}

/** The next n months of income, and what changes when (maternity ends, Child Benefit starts…). */
export function incomeTimeline(settings, fromMonth, n, { scope = 'all', estimate, addMonths } = {}) {
  const months = [];
  for (let k = 0; k < n; k++) {
    const m = addMonths(fromMonth, k);
    months.push({ month: m, ...householdFor(settings, m, { scope, estimate }) });
  }
  const changes = [];
  for (let k = 1; k < months.length; k++) {
    const prev = new Map(months[k - 1].lines.map((l) => [`${l.who}|${l.kind === 'other' ? l.name : 'p'}`, l]));
    for (const l of months[k].lines) {
      const p = prev.get(`${l.who}|${l.kind === 'other' ? l.name : 'p'}`);
      const before = p?.monthly || 0;
      if (l.monthly !== before) changes.push({ month: months[k].month, name: l.name, from: before, to: l.monthly, why: p && p.kind === 'temp' && l.kind !== 'temp' ? `${p.label} ends` : l.kind === 'temp' && (!p || p.kind !== 'temp') ? `${l.label} starts` : l.kind === 'other' && !p ? 'starts' : 'changes' });
      prev.delete(`${l.who}|${l.kind === 'other' ? l.name : 'p'}`);
    }
    for (const p of prev.values()) changes.push({ month: months[k].month, name: p.name, from: p.monthly, to: 0, why: 'ends' });
  }
  return { months, changes };
}
