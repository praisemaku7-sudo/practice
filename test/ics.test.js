import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billsCalendar } from '../src/lib/ics.js';

test('bills calendar has monthly repeating events with a reminder', () => {
  const ics = billsCalendar([
    { key: 'out|NETFLIX', name: 'NETFLIX', amount: 1299, direction: 'out', active: true, day: 8, nextDue: '2026-11-08', accountId: 'a', type: 'Card / Subscription' },
    { key: 'out|RENT', name: 'RENT, LTD', amount: 115000, direction: 'out', active: true, day: 31, nextDue: '2026-11-30', accountId: 'a', type: 'Standing Order' },
    { key: 'in|SALARY', name: 'SALARY', amount: 250000, direction: 'in', active: true, day: 25, nextDue: '2026-11-25', accountId: 'a' },
  ], { a: { name: 'Main' } }, { now: new Date('2026-11-08T10:00:00Z') });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2, 'income excluded');
  assert.match(ics, /DTSTART;VALUE=DATE:20261108/);
  assert.match(ics, /RRULE:FREQ=MONTHLY;BYMONTHDAY=8/);
  assert.match(ics, /BYMONTHDAY=-1/, '31st becomes last day of month');
  assert.match(ics, /SUMMARY:£1150.00 RENT\\, LTD/);
  assert.match(ics, /TRIGGER:-PT15H/);
  assert.ok(ics.includes('\r\n'));
});
