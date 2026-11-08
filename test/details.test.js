import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankFromSortCode, bankFromText, extractDetails, suggestAccountName } from '../src/lib/parse/details.js';

test('sort code → bank', () => {
  assert.equal(bankFromSortCode('07-04-36'), 'Nationwide');
  assert.equal(bankFromSortCode('04-00-04'), 'Monzo');
  assert.equal(bankFromSortCode('60-84-64'), 'Chase');
  assert.equal(bankFromSortCode('60-83-71'), 'Starling');
  assert.equal(bankFromSortCode('20-45-77'), 'Barclays');
  assert.equal(bankFromSortCode('40-47-84'), 'First Direct');
  assert.equal(bankFromSortCode('04-12-34'), null, 'shared e-money range: unknown, not a guess');
  assert.equal(bankFromSortCode('123'), null);
});

test('the statement issuer wins over banks mentioned in "how to pay" boxes', () => {
  const amex = 'American Express\nPreferred Rewards Gold Credit Card\n...\nHow you can pay your statement\nInternet Banking - Please use account name American Express Services, sort code 30-00-00 (Lloyds)';
  assert.equal(bankFromText(amex), 'American Express');
  const d = extractDetails(amex);
  assert.equal(d.sortCode, null, 'the issuer\'s own bank details are not your account');
});

test('current account statement: holder, sort code, product, name, mismatch check', () => {
  const text = `Nationwide Building Society
FlexDirect statement
MR PRAISE MAKU                                   Sort code 07-04-36
12 HIGH STREET                                   Account number 12345678
MANCHESTER M1 2AB
Balance brought forward 100.00`;
  const d = extractDetails(text);
  assert.equal(d.bank, 'Nationwide');
  assert.equal(d.bankFromSort, 'Nationwide');
  assert.equal(d.bankMismatch, false);
  assert.equal(d.sortCode, '07-04-36');
  assert.equal(d.last4, '5678');
  assert.equal(d.holder, 'Mr Praise Maku');
  assert.equal(d.postcode, 'M1 2AB');
  assert.equal(d.product, 'FlexDirect');
  assert.equal(suggestAccountName(d, 'current'), 'Nationwide FlexDirect ••5678');
  assert.equal(extractDetails(text.replace('07-04-36', '20-45-77')).bankMismatch, true, 'Barclays sort code on a Nationwide statement is flagged');
});

test('label above value (Amex layout)', () => {
  const text = `             American Express®
             Platinum Card
Prepared for                                                 Membership Number                                  Date
SARAH MACPHAIL                                               xxxx-xxxxxx-41002                           10/07/26`;
  const d = extractDetails(text);
  assert.equal(d.holder, 'Sarah MacPhail');
  assert.equal(d.last4, '1002');
  assert.equal(suggestAccountName(d, 'credit'), 'American Express Platinum Card ••1002');
});

test('holder on the same line as the card number', () => {
  const d = extractDetails('American Express\nPrepared for SARAH MACPHAIL Membership Number xxxx-xxxxxx-47777\nStatement 11 September 2026 to 10 October 2026');
  assert.equal(d.holder, 'Sarah MacPhail');
  assert.equal(d.last4, '7777');
});

test('whose name is it: first names decide, a shared surname does not', async () => {
  const { state, personForName } = await import('../src/state.js');
  state.settings.people = [{ id: 'p1', name: 'Me' }, { id: 'p2', name: 'Sarah Maku', aliases: ['Sarah MacPhail'] }];
  assert.equal(personForName('MR PRAISE MAKU'), null, 'not Sarah just because of "Maku"');
  assert.equal(personForName('SARAH MACPHAIL'), 'p2');
  assert.equal(personForName('Mrs S. Maku'), null, 'initial only: not certain');
  state.settings.people[0].name = 'Praise Maku';
  assert.equal(personForName('Mr Praise Maku'), 'p1');
});
