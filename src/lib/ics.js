// Calendar file of your regular bills: the iPhone's Calendar app then reminds you
// the day before each one, with no server or push notifications needed.
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const ymd = (iso) => iso.replace(/-/g, '');
const money = (p) => `£${(p / 100).toFixed(2)}`;

/**
 * @param recurring  detectRecurring() output
 * @param accountsById
 * @returns {string} iCalendar text
 */
export function billsCalendar(recurring, accountsById = {}, { now = new Date(), alarmHoursBefore = 15 } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const events = recurring.filter((r) => r.direction === 'out' && r.active).map((r) => {
    const acc = accountsById[r.accountId];
    const uid = `${r.key.replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}-${r.accountId}@pocket-ledger`;
    const byDay = r.day >= 29 ? '-1' : String(r.day); // 29th-31st: last day of each month
    const next = new Date(Date.parse(r.nextDue + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(r.nextDue)}`,
      `DTEND;VALUE=DATE:${ymd(next)}`,
      `RRULE:FREQ=MONTHLY;BYMONTHDAY=${byDay}`,
      `SUMMARY:${esc(`${money(r.amount)} ${r.name}`)}`,
      `DESCRIPTION:${esc(`${r.type} from ${acc?.name || 'your account'}. Added by Pocket Ledger.`)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(`${r.name} ${money(r.amount)} due tomorrow`)}`,
      `TRIGGER:-PT${alarmHoursBefore}H`,
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pocket Ledger//Bills//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Bills (Pocket Ledger)', ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
