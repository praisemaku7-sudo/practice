// Export formats from the main UK banks (synthetic rows in each bank's layout, no real data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSVStatement } from '../src/lib/parse/csv.js';
import { parseTextStatement } from '../src/lib/parse/formats.js';

const amounts = (r) => r.transactions.map((t) => [t.date, t.amount]);

const CSV = {
  monzo: ['Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Money Out,Money In',
    'tx_1,03/10/2026,12:01:22,Card payment,Pret A Manger,,Eating out,-4.50,GBP,-4.50,GBP,,,,PRET,,-4.50,',
    'tx_2,05/10/2026,09:00:00,Faster payment,ACME LTD,,Income,2603.40,GBP,2603.40,GBP,,,,SALARY,,,2603.40'],
  starling: ['Date,Counter Party,Reference,Type,Amount (GBP),Balance (GBP),Spending Category,Notes',
    '03/10/2026,Pret A Manger,PRET,CONTACTLESS,-4.50,995.50,EATING_OUT,', '05/10/2026,ACME LTD,SALARY,FASTER PAYMENT,2603.40,3598.90,INCOME,'],
  barclays: ['Number,Date,Account,Amount,Subcategory,Memo', ',03/10/2026,20-00-00 12345678,-4.50,PAYMENT,PRET A MANGER    ON 02 OCT CLP', ',05/10/2026,20-00-00 12345678,2603.40,DIRECTDEP,ACME LTD SALARY'],
  hsbcNoHeader: ['03/10/2026,PRET A MANGER LONDON,-4.50', '05/10/2026,ACME LTD SALARY,"2,603.40"'],
  lloyds: ['Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance',
    '03/10/2026,DEB,\'30-00-00,12345678,PRET A MANGER,4.50,,995.50', '05/10/2026,FPI,\'30-00-00,12345678,ACME LTD SALARY,,2603.40,3598.90'],
  nationwide: ['"Account Name:","FlexDirect ****5678"', '"Account Balance:","£3,598.90"', '"Available Balance: ","£3,598.90"', '',
    '"Date","Transaction type","Description","Paid out","Paid in","Balance"', '"03 Oct 2026","Contactless Payment","PRET A MANGER","£4.50","","£995.50"', '"05 Oct 2026","Bank credit ACME LTD","ACME LTD SALARY","","£2,603.40","£3,598.90"'],
  revolut: ['Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
    'CARD_PAYMENT,Current,2026-10-03 12:01:22,2026-10-03 14:00:00,Pret A Manger,-4.50,0.00,GBP,COMPLETED,995.50',
    'CARD_PAYMENT,Current,2026-10-04 10:00:00,,Zara,-30.00,0.00,GBP,REVERTED,',
    'TOPUP,Current,2026-10-05 09:00:00,2026-10-05 09:00:01,Payment from ACME LTD,2603.40,0.00,GBP,COMPLETED,3598.90',
    'EXCHANGE,Current,2026-10-06 09:00:00,2026-10-06 09:00:01,Exchanged to EUR,-100.00,-0.50,GBP,COMPLETED,3498.40'],
  natwest: ['Date, Type, Description, Value, Balance, Account Name, Account Number', '03 Oct 2026,POS,"PRET A MANGER",-4.50,995.50,\'MR A DOE,\'600000-12345678', '05 Oct 2026,BAC,"ACME LTD SALARY",2603.40,3598.90,\'MR A DOE,\'600000-12345678'],
  amex: ['Date,Description,Amount,Extended Details,Appears On Your Statement As,Address,Town/City,Postcode,Country,Reference,Category',
    '03/10/2026,PRET A MANGER,4.50,,PRET,,,,,\'AT1\',Restaurant', '05/10/2026,PAYMENT RECEIVED - THANK YOU,-100.00,,,,,,,\'AT2\','],
  capitalOne: ['Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit', '2026-10-03,2026-10-04,3915,PRET A MANGER,Dining,4.50,', '2026-10-05,2026-10-05,3915,PAYMENT RECEIVED,Payment,,100.00'],
  tsb: ['Transaction date,Transaction type,Sort code,Account number,Transaction description,Debit amount,Credit amount,Balance', '03/10/2026,DEB,77-00-00,12345678,PRET A MANGER,4.50,,995.50', '05/10/2026,FPI,77-00-00,12345678,ACME LTD SALARY,,2603.40,3598.90'],
  semicolon: ['Date;Description;Amount', '03.10.2026;PRET A MANGER;-4,50', '05.10.2026;ACME LTD SALARY;2.603,40'],
};

for (const [bank, lines] of Object.entries(CSV)) {
  test(`CSV: ${bank}`, () => {
    const r = parseCSVStatement(lines.join('\n'), { fallbackYear: 2026 });
    const got = amounts(r);
    const second = ['amex', 'capitalOne'].includes(bank) ? 10000 : 260340; // card files: a £100 payment
    assert.deepEqual(got.slice(0, 2), [['2026-10-03', -450], ['2026-10-05', second]], JSON.stringify(r));
    if (bank === 'revolut') assert.deepEqual(got[2], ['2026-10-06', -10050]); // reverted dropped, fee included
  });
}

test('Amex/Capital One CSV: the card statement signs (purchases positive in the file) are turned round', () => {
  const r = parseCSVStatement(CSV.amex.join('\n'));
  assert.equal(r.transactions[1].amount, 10000);
});

test('OFX (Money/Quicken export)', () => {
  const ofx = `OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>GBP<BANKACCTFROM><BANKID>070436<ACCTID>12345678</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003120000<TRNAMT>-4.50<FITID>1<NAME>PRET A MANGER</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005<TRNAMT>2603.40<FITID>2<NAME>ACME LTD<MEMO>SALARY</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>3598.90<DTASOF>20261031</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const r = parseTextStatement(ofx, 'statement.ofx');
  assert.deepEqual(amounts(r), [['2026-10-03', -450], ['2026-10-05', 260340]]);
  assert.equal(r.closingBalance, 359890);
  assert.equal(r.transactions[1].description, 'ACME LTD SALARY');
});

test('QIF', () => {
  const qif = '!Type:Bank\nD03/10/2026\nT-4.50\nPPRET A MANGER\n^\nD05/10/2026\nT2,603.40\nPACME LTD SALARY\n^\n';
  assert.deepEqual(amounts(parseTextStatement(qif, 'x.qif')), [['2026-10-03', -450], ['2026-10-05', 260340]]);
});

test('Santander text export', () => {
  const txt = 'From: 01/10/2026 to 31/10/2026\n\nAccount: XXXX XXXX XXXX 5678\n\nDate: 03/10/2026\nDescription: CARD PAYMENT TO PRET A MANGER\nAmount: -4.50 GBP\nBalance: 995.50 GBP\n\nDate: 05/10/2026\nDescription: BANK GIRO CREDIT REF ACME LTD SALARY\nAmount: 2603.40 GBP\nBalance: 3598.90 GBP\n';
  const r = parseTextStatement(txt, 'Statement.txt');
  assert.deepEqual(amounts(r), [['2026-10-03', -450], ['2026-10-05', 260340]]);
  assert.equal(r.closingBalance, 359890);
});

test('plain CSV still goes through the CSV reader', () => {
  assert.equal(parseTextStatement(CSV.starling.join('\n'), 'a.csv').transactions.length, 2);
});

import { decodeText } from '../src/lib/parse/formats.js';
test('Windows-1252 file keeps the £ sign', () => {
  const bytes = new Uint8Array([...Buffer.from('Date,Description,Amount\n03/10/2026,PRET,'), 0xa3, ...Buffer.from('-4.50\n')]);
  assert.equal(parseCSVStatement(decodeText(bytes)).transactions[0].amount, -450);
});
